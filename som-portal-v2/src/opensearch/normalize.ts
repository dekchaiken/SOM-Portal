// som-portal-v2/src/opensearch/normalize.ts
// Port of v1 _osNormalizeHit — normalize OpenSearch hits for frontend display.
import type { NormalizedHit } from './schema';

/**
 * Parse status code from REST log line.
 * Matches v1 regex chain exactly.
 */
function parseStatus(rest: string): number | null {
  let m: RegExpMatchArray | null;
  m = rest.match(/status_code\s*[:=]\s*\[?(\d{3})/i);
  if (m) return parseInt(m[1], 10);
  m = rest.match(/http_status\s*[:=]\s*\[?(\d{3})/i);
  if (m) return parseInt(m[1], 10);
  m = rest.match(/responseStatus\s*[:=]\s*(\d{3})/i);
  if (m) return parseInt(m[1], 10);
  m = rest.match(/\bHTTP\/?[\d.]+\s+(\d{3})\b/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * Parse latency from REST log line.
 * "Response time = 1376 ms" or "[1378 ms]"
 */
function parseLatency(rest: string): number | null {
  let m: RegExpMatchArray | null;
  m = rest.match(/Response time\s*=\s*(\d+)\s*ms/i);
  if (m) return parseInt(m[1], 10);
  m = rest.match(/\[(\d+)\s*ms\]/);
  if (m) return parseInt(m[1], 10);
  return null;
}

export function normalizeHit(hit: Record<string, unknown>): NormalizedHit {
  const src = (hit._source ?? {}) as Record<string, unknown>;
  const rest = String(src.REST ?? src.log_message ?? '');
  const kube = (src.kubernetes ?? {}) as Record<string, unknown>;

  return {
    id: String(hit._id ?? ''),
    index: String(hit._index ?? ''),
    timestamp: src['@timestamp'] != null ? String(src['@timestamp']) : null,
    module: String(src.Module ?? ''),
    log_level: String(src.Log_Level ?? ''),
    correlation_id: String(src.CORRELATION_ID ?? ''),
    rest,
    status_code: parseStatus(rest),
    latency_ms: parseLatency(rest),
    pod: String(src['kubernetes.pod_name'] ?? kube.pod_name ?? ''),
    namespace: String(src['kubernetes.namespace_name'] ?? kube.namespace_name ?? ''),
    host: String(src.Host ?? src.host ?? ''),
    source: src,
  };
}

/**
 * Read hits.total from OpenSearch response (handles both int and {value,relation} forms).
 */
export function readTotal(data: Record<string, unknown>): { total: number; relation: string } {
  const hits = (data.hits ?? {}) as Record<string, unknown>;
  const t = hits.total;
  if (t && typeof t === 'object' && 'value' in t) {
    const tv = t as { value: number; relation?: string };
    return { total: tv.value ?? 0, relation: tv.relation ?? 'eq' };
  }
  return { total: typeof t === 'number' ? t : 0, relation: 'eq' };
}

/**
 * Extract shard info from response.
 */
export function readShards(data: Record<string, unknown>): Record<string, unknown> {
  const s = (data._shards ?? {}) as Record<string, unknown>;
  return {
    total: Number(s.total ?? 0),
    successful: Number(s.successful ?? 0),
    failed: Number(s.failed ?? 0),
    skipped: Number(s.skipped ?? 0),
    timed_out: Boolean(data.timed_out ?? false),
  };
}

export { parseStatus, parseLatency };
