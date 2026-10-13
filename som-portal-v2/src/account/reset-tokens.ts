// som-portal-v2/src/account/reset-tokens.ts
//
// Port of v1 `api/helpers.php` password-reset token helpers (lines 993-1065).
// Same GLOBAL file (`data/password_reset_tokens.json`), same field names, same
// single-use + single-active-token-per-user semantics, so a token minted by
// PHP can be consumed by v2 and vice versa during dual-run.

import crypto from 'node:crypto';
import { readGlobalFile, updateGlobalFile } from '@/data/global-scope';
import { v1Date, v1Strtotime } from '@/lib/v1-date';

export const RESET_TOKEN_FILE = 'password_reset_tokens.json';

export interface ResetTokenEntry {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  invalidated_by_new?: boolean;
}

/** v1 `_resetTokenGc` — drop tokens expired / used more than 7 days ago. */
export function gcTokens(store: ResetTokenEntry[], nowSec = Math.floor(Date.now() / 1000)): ResetTokenEntry[] {
  return store.filter((t) => {
    const exp = v1Strtotime(t.expires_at);
    if (exp > 0 && exp < nowSec - 7 * 86400) return false;
    if (t.used_at && v1Strtotime(t.used_at) < nowSec - 7 * 86400) return false;
    return true;
  });
}

/** v1 token format: `bin2hex(random_bytes(32))` → 64 lowercase hex chars. */
const TOKEN_RE = /^[a-f0-9]{64}$/;

export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

async function readStore(): Promise<ResetTokenEntry[]> {
  const raw = await readGlobalFile<unknown>(RESET_TOKEN_FILE, []);
  return Array.isArray(raw) ? (raw as ResetTokenEntry[]) : [];
}

/** v1 `createResetToken($userId, $ttlHours = 24)`. */
export async function createResetToken(userId: string, ttlHours = 24): Promise<ResetTokenEntry> {
  const now = new Date();
  const entry: ResetTokenEntry = {
    token: crypto.randomBytes(32).toString('hex'),
    user_id: userId,
    created_at: v1Date(now),
    expires_at: v1Date(new Date(now.getTime() + ttlHours * 3600 * 1000)),
    used_at: null,
  };

  await updateGlobalFile<ResetTokenEntry[]>(RESET_TOKEN_FILE, [], (current) => {
    const store = gcTokens(Array.isArray(current) ? current : []);
    // Only one active token per user — invalidate previous unused ones.
    for (const t of store) {
      if (t.user_id === userId && !t.used_at) {
        t.used_at = v1Date(now);
        t.invalidated_by_new = true;
      }
    }
    store.push(entry);
    return store;
  });

  return entry;
}

/** v1 `verifyResetToken` — returns user_id without consuming, else null. */
export async function verifyResetToken(
  token: string,
): Promise<{ userId: string; expiresAt: string } | null> {
  if (!isWellFormedToken(token)) return null;
  const store = await readStore();
  const nowSec = Math.floor(Date.now() / 1000);
  for (const t of store) {
    if (!timingSafeEqual(t.token, token)) continue;
    if (t.used_at) return null;
    if (v1Strtotime(t.expires_at) <= nowSec) return null;
    return { userId: t.user_id, expiresAt: t.expires_at };
  }
  return null;
}

/** v1 `consumeResetToken` — atomically marks used, returns user_id or null. */
export async function consumeResetToken(token: string): Promise<string | null> {
  if (!isWellFormedToken(token)) return null;
  let userId: string | null = null;
  const nowSec = Math.floor(Date.now() / 1000);

  await updateGlobalFile<ResetTokenEntry[]>(RESET_TOKEN_FILE, [], (current) => {
    const store = gcTokens(Array.isArray(current) ? current : []);
    for (const t of store) {
      if (!timingSafeEqual(t.token, token)) continue;
      if (t.used_at) return store;
      if (v1Strtotime(t.expires_at) <= nowSec) return store;
      t.used_at = v1Date();
      userId = t.user_id;
      break;
    }
    return store;
  });

  return userId;
}

/** Test/cleanup helper — removes specific tokens from the store. */
export async function deleteResetTokens(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  const drop = new Set(tokens);
  await updateGlobalFile<ResetTokenEntry[]>(RESET_TOKEN_FILE, [], (current) =>
    (Array.isArray(current) ? current : []).filter((t) => !drop.has(t.token)),
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
