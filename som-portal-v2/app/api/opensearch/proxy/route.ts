// som-portal-v2/app/api/opensearch/proxy/route.ts
// POST ?action=search|trace|deeplink|test-creds|list-endpoints
// SM team only, denyRoles: ["super_viewer"]
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/auth/session';
import { ForbiddenError } from '@/lib/errors';
import { ok, err } from '@/lib/result';
import { SearchParamsSchema } from '@/opensearch/schema';
import { loadUserCreds } from '@/opensearch/creds';
import { listEndpoints, getEndpoint, loadConfig, redactEndpoint } from '@/opensearch/endpoints';
import { buildSearchDsl, buildTraceDsl, parseTimeRange } from '@/opensearch/dsl';
import { normalizeHit, readTotal, readShards } from '@/opensearch/normalize';
import { OpenSearchClient } from '@/opensearch/client';

function assertSmTeam(session: { team: string; role: string }): void {
  if (session.team !== 'sm') throw new ForbiddenError('SM team only');
  if (session.role === 'super_viewer') throw new ForbiddenError('super_viewer denied');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') ?? '';
    const body = await req.json().catch(() => ({}));

    // ── list-endpoints ────────────────────────────────────────────────────
    if (action === 'list-endpoints') {
      const cfg = await loadConfig();
      const endpoints = cfg.endpoints
        .filter((e) => e.enabled !== false)
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        .map(redactEndpoint);
      return NextResponse.json(ok({ endpoints, defaults: cfg.defaults }));
    }

    // ── test-creds ────────────────────────────────────────────────────────
    if (action === 'test-creds') {
      const epId = String(body.endpoint_id ?? '').trim();
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      if (!epId || !username || !password) {
        return NextResponse.json(err('endpoint_id, username and password are required'), { status: 400 });
      }
      const ep = await getEndpoint(epId);
      if (!ep) return NextResponse.json(err('Unknown endpoint id'), { status: 404 });

      const client = new OpenSearchClient(ep, { username, password }, session.sub);
      const result = await client.testConnection();
      if (!result.ok) {
        return NextResponse.json(err(result.error ?? 'Connection failed'), { status: 422 });
      }
      return NextResponse.json(ok({ latency_ms: result.latencyMs, mode: result.mode }));
    }

    // ── search ────────────────────────────────────────────────────────────
    if (action === 'search') {
      const parsed = SearchParamsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Invalid params'), { status: 400 });
      }
      const params = parsed.data;
      const ep = await getEndpoint(params.endpoint_id);
      if (!ep) return NextResponse.json(err('Unknown endpoint id'), { status: 404 });

      // Per-user credential injection
      const creds = await loadUserCreds(session.sub, params.endpoint_id);
      if (creds === null) {
        // Exact v1 shape for frontend compat
        return NextResponse.json(
          { ok: false, message: 'no_user_creds', data: { endpoint_id: params.endpoint_id } },
          { status: 422 },
        );
      }

      const indexPattern = (params.index_pattern ?? ep.default_index_pattern ?? '').trim();
      if (!indexPattern) {
        return NextResponse.json(err('index_pattern is required'), { status: 400 });
      }

      const cfg = await loadConfig();
      const maxSize = cfg.defaults.max_size ?? 1000;
      const size = Math.min(maxSize, Math.max(1, params.size));
      const from = Math.max(0, Math.min(9000, params.from));

      const dsl = buildSearchDsl({ ...params, size, from });
      const client = new OpenSearchClient(ep, creds, session.sub);
      const result = await client.search(indexPattern, dsl);

      if (result.code === 401) {
        return NextResponse.json(err('OpenSearch rejected credentials / session'), { status: 422 });
      }
      if (result.code === 404) {
        return NextResponse.json(err('Index pattern matches no indices'), { status: 404 });
      }
      if (result.code !== 200) {
        return NextResponse.json(err(`OpenSearch HTTP ${result.code}`), { status: 502 });
      }

      const data = result.data;
      const hits = ((data.hits as Record<string, unknown>)?.hits as unknown[] ?? []).map(
        (h) => normalizeHit(h as Record<string, unknown>),
      );
      const { gte, lte, interval } = parseTimeRange(params);

      // Summary
      const sum = { ok: 0, warn: 0, error: 0, other: 0, unknown: 0 };
      let latSum = 0;
      let latN = 0;
      let latMax = 0;
      for (const h of hits) {
        const sc = h.status_code;
        if (sc === null) sum.unknown++;
        else if (sc >= 500) sum.error++;
        else if (sc >= 400) sum.warn++;
        else if (sc >= 200 && sc < 300) sum.ok++;
        else sum.other++;
        if (h.latency_ms !== null) {
          latSum += h.latency_ms;
          latN++;
          if (h.latency_ms > latMax) latMax = h.latency_ms;
        }
      }

      const aggs = data.aggregations as Record<string, unknown> | undefined;
      const histAgg = (aggs?.histogram ?? {}) as Record<string, unknown>;
      const histBuckets = (histAgg.buckets ?? []) as Array<Record<string, unknown>>;
      const buckets = histBuckets.map((b) => ({
        time: Number(b.key ?? 0),
        count: Number(b.doc_count ?? 0),
        levels: ((b.by_level as Record<string, unknown>)?.buckets as Array<Record<string, unknown>> ?? []).map((lb) => ({
          key: String(lb.key ?? ''),
          count: Number(lb.doc_count ?? 0),
        })),
      }));

      const topPodsAgg = (aggs?.top_pods ?? {}) as Record<string, unknown>;
      const topPods = ((topPodsAgg.buckets ?? []) as Array<Record<string, unknown>>)
        .map((b) => ({ key: String(b.key ?? ''), count: Number(b.doc_count ?? 0) }))
        .filter((r) => r.key !== '');

      const { total, relation: totalRel } = readTotal(data);

      return NextResponse.json(ok({
        endpoint_id: params.endpoint_id,
        index_pattern: indexPattern,
        time: { gte, lte, interval },
        total,
        total_relation: totalRel,
        shards: readShards(data),
        returned: hits.length,
        took_ms: Number(data.took ?? 0),
        summary: {
          status: sum,
          latency_avg: latN > 0 ? Math.round(latSum / latN) : null,
          latency_max: latMax || null,
          latency_n: latN,
        },
        histogram: buckets,
        top_pods: topPods,
        hits,
      }));
    }

    // ── trace ─────────────────────────────────────────────────────────────
    if (action === 'trace') {
      const epId = String(body.endpoint_id ?? '').trim();
      if (!epId) return NextResponse.json(err('endpoint_id is required'), { status: 400 });
      const ep = await getEndpoint(epId);
      if (!ep) return NextResponse.json(err('Unknown endpoint id'), { status: 404 });

      const creds = await loadUserCreds(session.sub, epId);
      if (creds === null) {
        return NextResponse.json(
          { ok: false, message: 'no_user_creds', data: { endpoint_id: epId } },
          { status: 422 },
        );
      }

      const cid = String(body.correlation_id ?? '').trim();
      if (!cid) return NextResponse.json(err('correlation_id is required'), { status: 400 });

      const indexPattern = (String(body.index_pattern ?? '') || ep.default_index_pattern || '').trim();
      if (!indexPattern) return NextResponse.json(err('index_pattern is required'), { status: 400 });

      const dsl = buildTraceDsl(cid, {
        range: body.range ?? 'last_15m',
        start: body.start,
        end: body.end,
        size: body.size ?? 500,
        index_pattern: indexPattern,
      });

      const client = new OpenSearchClient(ep, creds, session.sub);
      const result = await client.search(indexPattern, dsl);

      if (result.code !== 200) {
        return NextResponse.json(err(`OpenSearch HTTP ${result.code}`), { status: 502 });
      }

      const data = result.data;
      const hits = ((data.hits as Record<string, unknown>)?.hits as unknown[] ?? []).map(
        (h) => normalizeHit(h as Record<string, unknown>),
      );

      const byModuleAgg = ((data.aggregations as Record<string, unknown>)?.by_module ?? {}) as Record<string, unknown>;
      const modules = ((byModuleAgg.buckets ?? []) as Array<Record<string, unknown>>).map((b) => ({
        module: String(b.key ?? ''),
        count: Number(b.doc_count ?? 0),
      }));

      const { total, relation: totalRel } = readTotal(data);

      return NextResponse.json(ok({
        correlation_id: cid,
        total,
        total_relation: totalRel,
        shards: readShards(data),
        returned: hits.length,
        took_ms: Number(data.took ?? 0),
        modules,
        hits,
      }));
    }

    // ── deeplink ──────────────────────────────────────────────────────────
    if (action === 'deeplink') {
      const epId = String(body.endpoint_id ?? '').trim();
      if (!epId) return NextResponse.json(err('endpoint_id is required'), { status: 400 });
      const ep = await getEndpoint(epId);
      if (!ep) return NextResponse.json(err('Unknown endpoint id'), { status: 404 });

      const dashUrl = (ep.dashboards_url || ep.base_url).replace(/\/+$/, '');
      const indexPattern = (String(body.index_pattern ?? '') || ep.default_index_pattern || '').trim();
      const { gte, lte } = parseTimeRange(body);
      const module = String(body.module ?? '').trim();
      const lvl = String(body.log_level ?? '').trim().toUpperCase();
      const cid = String(body.correlation_id ?? '').trim();
      const q = String(body.q ?? '').trim();

      const qParts: string[] = [];
      if (module) qParts.push(`Module:"${module.replace(/"/g, '\\"')}"`);
      if (lvl) qParts.push(`Log_Level:${lvl}`);
      if (cid) qParts.push(`CORRELATION_ID:"${cid.replace(/"/g, '\\"')}"`);
      if (q) qParts.push(`(${q})`);
      const queryStr = qParts.join(' AND ');

      const gIso = new Date(gte).toISOString().replace(/\.\d{3}Z$/, '.000Z');
      const lIso = new Date(lte).toISOString().replace(/\.\d{3}Z$/, '.000Z');

      const gParam = `(time:(from:'${gIso}',to:'${lIso}'))`;
      const aParam = `(columns:!(Module,Log_Level,REST,CORRELATION_ID),index:'${indexPattern.replace(/'/g, "\\'")}',query:(language:kuery,query:'${queryStr.replace(/'/g, "\\'")}'))`;

      const url = `${dashUrl}/app/data-explorer/discover#/?_g=${encodeURIComponent(gParam)}&_a=${encodeURIComponent(aParam)}`;

      return NextResponse.json(ok({ url }));
    }

    return NextResponse.json(err('Unknown action'), { status: 400 });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json(err(e.message, e.code), { status: 403 });
    }
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(String((e as Error).message ?? 'Server error')), { status });
  }
}

// list-endpoints also accepts GET
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    assertSmTeam(session);

    const cfg = await loadConfig();
    const endpoints = cfg.endpoints
      .filter((e) => e.enabled !== false)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map(redactEndpoint);
    return NextResponse.json(ok({ endpoints, defaults: cfg.defaults }));
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json(err(e.message, e.code), { status: 403 });
    }
    return NextResponse.json(err('Server error'), { status: 500 });
  }
}
