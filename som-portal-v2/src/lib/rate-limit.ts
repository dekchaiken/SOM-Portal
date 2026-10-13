// som-portal-v2/src/lib/rate-limit.ts
// Mirrors v1 `data/rate_limit.json` semantics so counters are shared during dual-run.
// See D-04 for buckets: `login:<ip>` 5/15min, `api:<userId>:<group>` 120/60s.

import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { dataDirAbsolute } from './env';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAtMs: number;
  retryAfterMs: number;
}

export interface RateLimitBackend {
  check(bucket: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}

type Store = Record<string, { count: number; resetAt: number }>;

async function readStore(file: string): Promise<Store> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Store;
    return {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

async function writeStore(file: string, store: Store): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8');
}

export class FileRateLimitBackend implements RateLimitBackend {
  private readonly file: string;

  constructor(file?: string) {
    this.file = file ?? path.join(dataDirAbsolute(), 'rate_limit.json');
  }

  async check(bucket: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    // Ensure the file exists before locking.
    try {
      await fs.access(this.file);
    } catch {
      await writeStore(this.file, {});
    }

    const release = await lockfile.lock(this.file, {
      retries: { retries: 5, minTimeout: 20, maxTimeout: 200 },
      stale: 5000,
    });
    try {
      const store = await readStore(this.file);
      const now = Date.now();
      const entry = store[bucket];
      let count: number;
      let resetAt: number;
      if (!entry || now >= entry.resetAt) {
        count = 0;
        resetAt = now + windowSec * 1000;
      } else {
        count = entry.count;
        resetAt = entry.resetAt;
      }
      if (count >= limit) {
        return {
          ok: false,
          remaining: 0,
          resetAtMs: resetAt,
          retryAfterMs: Math.max(0, resetAt - now),
        };
      }
      count += 1;
      store[bucket] = { count, resetAt };
      await writeStore(this.file, store);
      return {
        ok: true,
        remaining: Math.max(0, limit - count),
        resetAtMs: resetAt,
        retryAfterMs: 0,
      };
    } finally {
      await release();
    }
  }
}

// Convenience buckets.
export const BUCKETS = {
  login: (ip: string) => ({ key: `login:${ip}`, limit: 5, windowSec: 15 * 60 }),
  api: (userId: string, group: string) => ({
    key: `api:${userId}:${group}`,
    limit: 120,
    windowSec: 60,
  }),
} as const;

let defaultBackend: RateLimitBackend | null = null;
export function getRateLimitBackend(): RateLimitBackend {
  if (!defaultBackend) defaultBackend = new FileRateLimitBackend();
  return defaultBackend;
}

export function __setRateLimitBackend(b: RateLimitBackend | null): void {
  defaultBackend = b;
}
