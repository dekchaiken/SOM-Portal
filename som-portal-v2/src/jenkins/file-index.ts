// som-portal-v2/src/jenkins/file-index.ts
//
// Batch File Index — "file X was produced by which Jenkins job?".
// Port of api/batch-file-index/lookup.php.
//
// The index itself (data/sm/batch_file_index.json) is SM-SHARED: SM runs the
// crawler, every granted team reads the same catalog. The enrichment file
// (batch_meta.json) is per-team, so a team only sees its own dev_owner /
// sm_rerun notes while sharing SM's job catalog.
//
// Match strategy — first non-empty tier wins:
//   1) exact     normalized filename hits an index key
//   2) partial   normalized filename contains a key, or a key contains it
//   3) fuzzy     token overlap >= 2, ranked by overlap count
import { readSharedFile } from '@/team/scope';
import { readTeamFile, type Scope } from '@/team/scope';
import {
  BatchFileIndexSchema,
  BatchMetaFileSchema,
  type BatchMetaEntry,
  type FileIndexLookupResult,
  type FileIndexMatch,
  type MatchConfidence,
} from './types';

export const FILE_INDEX_FILE = 'batch_file_index.json';
export const BATCH_META_FILE = 'batch_meta.json';

/** Runs of 6+ digits collapse to `<N>` — same normalisation the indexer uses. */
export function normalizeFilename(raw: string): string {
  return raw.replace(/\d{6,}/g, '<N>');
}

/** Strip whitespace, wrapping quotes/backticks — users paste from chat. */
export function cleanFilename(raw: string): string {
  return raw.replace(/^[\r\n \t"'`]+|[\r\n \t"'`]+$/g, '');
}

/** Alphanumeric tokens of length >= 3 that aren't pure digits. */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

const RANK: Record<MatchConfidence, number> = { exact: 0, partial: 1, fuzzy: 2 };

export interface LookupOptions {
  /** Hard cap on returned matches. v1 slices to 25. */
  limit?: number;
  scope?: Scope;
}

export async function lookupFile(
  filename: string,
  opts: LookupOptions = {},
): Promise<FileIndexLookupResult> {
  const limit = opts.limit ?? 25;
  const cleaned = cleanFilename(filename);
  const normalized = normalizeFilename(cleaned);

  const index = (await readSharedFile(FILE_INDEX_FILE, BatchFileIndexSchema)) ?? {
    patterns: {},
    generated_at: null,
  };
  const patterns = (index.patterns ?? {}) as Record<string, FileIndexMatch['entry'][]>;

  let matches: FileIndexMatch[] = [];
  let tier: MatchConfidence | null = null;

  // ── Tier 1 — exact normalized key hit ──────────────────────────────────────
  if (Object.prototype.hasOwnProperty.call(patterns, normalized)) {
    tier = 'exact';
    for (const entry of patterns[normalized] ?? []) {
      matches.push({ pattern: normalized, confidence: 'exact', entry });
    }
  }

  // ── Tier 2 — substring, bidirectional ──────────────────────────────────────
  if (matches.length === 0) {
    const needle = normalized.toLowerCase();
    for (const [key, entries] of Object.entries(patterns)) {
      const kl = key.toLowerCase();
      if (kl === '' || kl === needle) continue;
      if (needle.includes(kl) || kl.includes(needle)) {
        for (const entry of entries) {
          matches.push({ pattern: key, confidence: 'partial', entry });
        }
      }
      if (matches.length >= 40) break;
    }
    if (matches.length) tier = 'partial';
  }

  // ── Tier 3 — token overlap ─────────────────────────────────────────────────
  if (matches.length === 0) {
    const needleToks = tokens(cleaned);
    if (needleToks.length) {
      const needleSet = new Set(needleToks);
      const scored: Array<{ key: string; entries: FileIndexMatch['entry'][]; score: number }> = [];
      for (const [key, entries] of Object.entries(patterns)) {
        const keyToks = tokens(key);
        if (!keyToks.length) continue;
        let overlap = 0;
        for (const t of keyToks) if (needleSet.has(t)) overlap += 1;
        if (overlap < 2) continue;
        scored.push({ key, entries, score: overlap });
      }
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored.slice(0, 15)) {
        for (const entry of s.entries) {
          matches.push({ pattern: s.key, confidence: 'fuzzy', score: s.score, entry });
        }
      }
      if (matches.length) tier = 'fuzzy';
    }
  }

  // ── Enrich with batch_meta (per-team) ──────────────────────────────────────
  const meta =
    (await readTeamFile(BATCH_META_FILE, BatchMetaFileSchema, opts.scope).catch(
      () => ({ entries: [] as BatchMetaEntry[], configs: [] as unknown[] }),
    )) ?? { entries: [] as BatchMetaEntry[], configs: [] as unknown[] };
  const entries = (meta.entries ?? []) as BatchMetaEntry[];
  const byExact = new Map<string, BatchMetaEntry>();
  for (const e of entries) {
    if (e.pattern) byExact.set(e.pattern, e);
  }
  const findMeta = (jobName: string): BatchMetaEntry | null => {
    const hit = byExact.get(jobName);
    if (hit) return hit;
    // Fall back to the first entry whose pattern is contained in the job name.
    for (const e of entries) {
      if (e.pattern && jobName.includes(e.pattern)) return e;
    }
    return null;
  };
  for (const m of matches) {
    const bm = findMeta(m.entry.job_name ?? '');
    if (bm) {
      m.batch_meta = {
        dev_owner: bm.dev_owner ?? '',
        sm_rerun: bm.sm_rerun ?? '',
        manual_url: bm.manual_url ?? '',
        category: bm.category ?? '',
        note: bm.note ?? '',
      };
    }
  }

  // ── De-duplicate by (server_id, job_path), keeping best confidence ─────────
  const dedup = new Map<string, FileIndexMatch>();
  for (const m of matches) {
    const key = `${m.entry.server_id ?? ''}|${m.entry.job_path ?? ''}`;
    const prev = dedup.get(key);
    if (!prev || RANK[m.confidence] < RANK[prev.confidence]) dedup.set(key, m);
  }
  matches = [...dedup.values()];

  // ── Sort: tier, then fuzzy score desc, then last_seen recency ─────────────
  matches.sort((a, b) => {
    if (RANK[a.confidence] !== RANK[b.confidence]) return RANK[a.confidence] - RANK[b.confidence];
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
    return (b.entry.last_seen_at ?? '').localeCompare(a.entry.last_seen_at ?? '');
  });

  return {
    filename,
    cleaned,
    normalized,
    tier,
    total: matches.length,
    matches: matches.slice(0, limit),
    index_size: Object.keys(patterns).length,
    index_generated: index.generated_at ?? null,
  };
}
