// som-portal-v2/src/service-performance/cache.ts
//
// In-memory + file cache for Service Performance snapshots.
// Mirrors v1's spReadCache/spWriteCache pattern:
//   Cache file: data/sm/service-performance/cache/{slug}.json
//   TTL: configurable, default 60s (from cacheTtlSeconds in sources config).

import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDirAbsolute } from '@/lib/env';
import type { RunwaySnapshot } from './schema';

const DEFAULT_TTL_MS = 60_000;

// ─── In-memory cache layer (per-process, fast path) ─────────────────────────
const memCache = new Map<string, { data: RunwaySnapshot; at: number }>();

/** Cache directory — SM-shared, same layout as v1. */
function cacheDir(): string {
  return path.join(dataDirAbsolute(), 'sm', 'service-performance', 'cache');
}

function cacheFile(key: string): string {
  // Sanitize key to filesystem-safe chars
  const safe = key.replace(/[^a-z0-9._-]/gi, '_');
  return path.join(cacheDir(), `${safe}.json`);
}

/** Read from cache (mem first, then disk). Returns null if stale/missing. */
export async function readCache(
  key: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<RunwaySnapshot | null> {
  const now = Date.now();

  // Check memory
  const mem = memCache.get(key);
  if (mem && now - mem.at < ttlMs) {
    return { ...mem.data, _cacheAgeSeconds: Math.floor((now - mem.at) / 1000) };
  }

  // Check disk
  try {
    const file = cacheFile(key);
    const stat = await fs.stat(file);
    const age = now - stat.mtimeMs;
    if (age > ttlMs) return null;
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw) as RunwaySnapshot;
    // Warm memory cache from disk
    memCache.set(key, { data, at: now - age });
    return { ...data, _cacheAgeSeconds: Math.floor(age / 1000) };
  } catch {
    return null;
  }
}

/** Write to both memory and disk cache (atomic rename). */
export async function writeCache(
  key: string,
  snapshot: RunwaySnapshot,
): Promise<void> {
  const now = Date.now();
  memCache.set(key, { data: snapshot, at: now });

  try {
    const dir = cacheDir();
    await fs.mkdir(dir, { recursive: true });
    const file = cacheFile(key);
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    await fs.rename(tmp, file);
  } catch (e) {
    // Disk write failure is non-fatal — memory cache still works
    console.error('[service-performance cache] write failed:', e);
  }
}

/** Detail-level cache key for per-service detail. */
export function detailCacheKey(
  service: string,
  runway: string,
  cluster: string,
  windowMin: number,
): string {
  return `detail/${service}_${runway || 'auto'}_c${cluster || 'auto'}_w${windowMin}`;
}

/** Test-only: clear in-memory cache. */
export function __clearMemCache(): void {
  memCache.clear();
}
