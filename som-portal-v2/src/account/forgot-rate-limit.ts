// som-portal-v2/src/account/forgot-rate-limit.ts
//
// Port of the per-IP rate limiter embedded in v1 `api/auth/forgot-password.php`.
// Deliberately NOT the generic `@/lib/rate-limit` backend: v1 uses its OWN
// global file with a different record shape, and dual-run requires v2 to share
// the same counters.
//
//   file   : data/forgot_rate_limit.json   (GLOBAL)
//   key    : substr(sha256(ip), 0, 16)
//   record : { count: number, first: unixSeconds }
//   limit  : 3 requests / 15 minutes   (FORGOT_RL_MAX / FORGOT_RL_WINDOW_SEC)
//   GC     : entries older than 2 windows are dropped
//
// v1 increments BEFORE the limit test, so the 4th request in a window is the
// first rejected one. Reproduced exactly.

import crypto from 'node:crypto';
import { updateGlobalFile } from '@/data/global-scope';

export const FORGOT_RL_FILE = 'forgot_rate_limit.json';
export const FORGOT_RL_MAX = 3;
export const FORGOT_RL_WINDOW_SEC = 15 * 60;

/** Reset flow is cheaper to brute force, so v1-style but 5/hour per the brief. */
export const RESET_RL_MAX = 5;
export const RESET_RL_WINDOW_SEC = 60 * 60;

interface RlEntry {
  count: number;
  first: number;
}
type RlStore = Record<string, RlEntry>;

export function rlKey(ip: string, prefix = ''): string {
  return crypto.createHash('sha256').update(prefix + ip).digest('hex').slice(0, 16);
}

export interface ForgotRlResult {
  allowed: boolean;
  count: number;
  /** Seconds the caller should wait — v1 sends this as the `Retry-After` header. */
  retryAfterSec: number;
}

export async function hitForgotRateLimit(
  ip: string,
  opts: { max?: number; windowSec?: number; keyPrefix?: string } = {},
): Promise<ForgotRlResult> {
  const max = opts.max ?? FORGOT_RL_MAX;
  const windowSec = opts.windowSec ?? FORGOT_RL_WINDOW_SEC;
  const key = rlKey(ip, opts.keyPrefix ?? '');
  const now = Math.floor(Date.now() / 1000);

  let entry: RlEntry = { count: 0, first: now };

  await updateGlobalFile<RlStore>(FORGOT_RL_FILE, {}, (current) => {
    const store: RlStore =
      current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};

    // GC entries outside two windows (v1 does the same before touching ours).
    for (const [k, v] of Object.entries(store)) {
      if ((v?.first ?? 0) < now - 2 * windowSec) delete store[k];
    }

    const existing = store[key];
    entry =
      existing && existing.first >= now - windowSec
        ? { count: existing.count, first: existing.first }
        : { count: 0, first: now };
    entry.count += 1;
    store[key] = entry;
    return store;
  });

  if (entry.count > max) {
    return {
      allowed: false,
      count: entry.count,
      retryAfterSec: Math.max(60, windowSec - (now - entry.first)),
    };
  }
  return { allowed: true, count: entry.count, retryAfterSec: 0 };
}

/** Test/cleanup helper. */
export async function clearForgotRateLimit(ip: string, keyPrefix = ''): Promise<void> {
  const key = rlKey(ip, keyPrefix);
  await updateGlobalFile<RlStore>(FORGOT_RL_FILE, {}, (current) => {
    const store: RlStore =
      current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
    delete store[key];
    return store;
  });
}
