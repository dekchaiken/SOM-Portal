// som-portal-v2/src/opensearch/dsl.ts
// Server-side DSL composition for OpenSearch queries.
// Ports v1's _osBuildQuery + _osParseTime exactly.
// Never accepts raw DSL from the browser.
import type { SearchParams, TimeRangeType } from './schema';

// ─── Time range ─────────────────────────────────────────────────────────────

const RANGE_MINUTES: Record<TimeRangeType, number> = {
  last_5m: 5,
  last_15m: 15,
  last_30m: 30,
  last_1h: 60,
  last_4h: 4 * 60,
  last_12h: 12 * 60,
  last_24h: 24 * 60,
  last_3d: 3 * 24 * 60,
  last_7d: 7 * 24 * 60,
};

export function parseTimeRange(
  input: Pick<SearchParams, 'range' | 'start' | 'end'>,
): { gte: number; lte: number; interval: string } {
  const now = Date.now();
  let gte: number;
  let lte: number;
  if (input.start && input.end) {
    const s = Date.parse(input.start);
    const e = Date.parse(input.end);
    if (isNaN(s) || isNaN(e) || e <= s) {
      throw new Error('Invalid start/end');
    }
    gte = s;
    lte = e;
  } else {
    const m = RANGE_MINUTES[input.range] ?? 15;
    gte = now - m * 60_000;
    lte = now;
  }
  const spanSec = Math.max(60, (lte - gte) / 1000);
  const interval =
    spanSec <= 15 * 60 ? '30s' :
    spanSec <= 60 * 60 ? '2m' :
    spanSec <= 4 * 60 * 60 ? '10m' :
    spanSec <= 12 * 60 * 60 ? '30m' :
    spanSec <= 24 * 60 * 60 ? '1h' :
    spanSec <= 3 * 24 * 60 * 60 ? '3h' : '12h';
  return { gte, lte, interval };
}

// ─── Search DSL ─────────────────────────────────────────────────────────────

export function buildSearchDsl(input: SearchParams): Record<string, unknown> {
  const { gte, lte, interval } = parseTimeRange(input);
  const filter: unknown[] = [
    { range: { '@timestamp': { gte, lte, format: 'epoch_millis' } } },
  ];
  const must: unknown[] = [];

  if (input.module) {
    filter.push({
      bool: {
        should: [
          { term: { 'Module.keyword': input.module } },
          { term: { Module: input.module } },
        ],
        minimum_should_match: 1,
      },
    });
  }
  if (input.log_level) {
    filter.push({
      bool: {
        should: [
          { term: { 'Log_Level.keyword': input.log_level } },
          { term: { Log_Level: input.log_level } },
        ],
        minimum_should_match: 1,
      },
    });
  }
  if (input.correlation_id) {
    filter.push({
      bool: {
        should: [
          { term: { 'CORRELATION_ID.keyword': input.correlation_id } },
          { term: { CORRELATION_ID: input.correlation_id } },
        ],
        minimum_should_match: 1,
      },
    });
  }
  if (input.q) {
    must.push({
      query_string: {
        query: input.q,
        default_field: 'REST',
        analyze_wildcard: true,
        lenient: true,
      },
    });
  }
  if (input.regexp_rest) {
    must.push({
      regexp: {
        REST: { value: input.regexp_rest, flags: 'ALL', case_insensitive: true },
      },
    });
  }

  return {
    size: input.size,
    from: input.from,
    sort: [{ '@timestamp': { order: 'desc' } }],
    query: { bool: { must, filter } },
    aggs: {
      histogram: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: interval,
          min_doc_count: 0,
          extended_bounds: { min: gte, max: lte },
        },
        aggs: {
          by_level: {
            terms: { field: 'Log_Level.keyword', size: 6, missing: 'UNKNOWN' },
          },
        },
      },
      top_pods: {
        terms: { field: 'kubernetes.pod_name.keyword', size: 10, missing: '' },
      },
    },
    track_total_hits: 10000,
    timeout: '30s',
  };
}

// ─── Trace DSL ──────────────────────────────────────────────────────────────

export function buildTraceDsl(
  correlationId: string,
  input: Pick<SearchParams, 'range' | 'start' | 'end' | 'size'> & { index_pattern?: string },
): Record<string, unknown> {
  const { gte, lte: rawLte } = parseTimeRange(input);
  // Extend by 90s for log-shipping skew (same as v1)
  const lte = rawLte + 90 * 1000;
  const size = Math.min(input.size ?? 500, 1000);

  // Escape for query_string literal search
  const cidEscaped = correlationId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  return {
    size,
    sort: [{ '@timestamp': { order: 'asc' } }],
    query: {
      bool: {
        filter: [
          { range: { '@timestamp': { gte, lte, format: 'epoch_millis' } } },
          {
            bool: {
              should: [
                { term: { 'CORRELATION_ID.keyword': correlationId } },
                {
                  query_string: {
                    query: `"${cidEscaped}"`,
                    analyze_wildcard: true,
                    lenient: true,
                    default_operator: 'AND',
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
    aggs: {
      by_module: {
        terms: { field: 'Module.keyword', size: 20, missing: 'UNKNOWN' },
      },
    },
    track_total_hits: 5000,
  };
}
