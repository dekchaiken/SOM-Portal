// som-portal-v2/src/opensearch/creds.ts
// AES-256-CBC per-user OpenSearch credential encrypt/decrypt.
// Round-trips with v1 PHP blobs — same JWT_SECRET, same envelope.
// See research/opensearch-creds.md for full crypto spec.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Session } from '@/auth/session';
import { env } from '@/lib/env';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { logSecurity } from '@/logging/security';
import { logActivity } from '@/logging/activity';
import { UserCredsFileSchema, type UserCredsFile, type CredEntry } from './schema';

// ─── Crypto ─────────────────────────────────────────────────────────────────

/**
 * Derive 32-byte AES key from JWT_SECRET.
 * v1: hash('sha256', JWT_SECRET, true) — raw 32-byte SHA-256 digest.
 * No salt, no PBKDF2.
 */
function deriveKey(): Buffer {
  return createHash('sha256').update(env().JWT_SECRET).digest();
}

/**
 * Encrypt plaintext to base64(IV[16] || ciphertext).
 * Uses AES-256-CBC with PKCS#7 padding (node default for CBC).
 */
export function encryptCreds(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct]).toString('base64');
}

/**
 * Decrypt base64(IV[16] || ciphertext) to plaintext.
 * Returns null on short input, wrong key, bad padding, or garbage.
 */
export function decryptCreds(b64: string): string | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (raw.length < 17) return null; // v1 guard: IV + at least 1 CT byte
  const iv = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  try {
    const key = deriveKey();
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null; // tampered / wrong key / bad padding
  }
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

const CREDS_FILE = 'opensearch_user_creds.json';

export interface DecryptedCreds {
  username: string;
  password: string;
}

/**
 * Load decrypted credentials for a user+endpoint pair.
 * Returns null when no creds exist (proxy responds 422 no_user_creds).
 */
export async function loadUserCreds(
  userId: string,
  endpointId: string,
): Promise<DecryptedCreds | null> {
  const all = await readTeamFile<UserCredsFile>(CREDS_FILE, UserCredsFileSchema);
  const entry = all[userId]?.[endpointId];
  if (!entry?.username || !entry?.password_enc) return null;
  const pw = decryptCreds(entry.password_enc);
  if (pw === null) return null;
  return { username: entry.username, password: pw };
}

/**
 * Save (or update) credentials for a user+endpoint pair.
 * Password is encrypted before storage; plaintext never persists.
 */
export async function saveUserCreds(
  session: Session,
  endpointId: string,
  username: string,
  password: string,
): Promise<void> {
  const all = await readTeamFile<UserCredsFile>(CREDS_FILE, UserCredsFileSchema);
  if (!all[session.sub]) all[session.sub] = {};
  all[session.sub][endpointId] = {
    username,
    password_enc: encryptCreds(password),
    saved_at: Math.floor(Date.now() / 1000),
  };
  await writeTeamFile(CREDS_FILE, all, UserCredsFileSchema);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'opensearch_user_creds_save',
    meta: { endpoint_id: endpointId },
  });
  await logSecurity({
    user: session.sub,
    team: session.team,
    event: 'opensearch_creds_saved',
    meta: { endpoint_id: endpointId },
  });
}

/**
 * Delete credentials for a user+endpoint pair.
 */
export async function deleteUserCreds(
  session: Session,
  endpointId: string,
): Promise<void> {
  const all = await readTeamFile<UserCredsFile>(CREDS_FILE, UserCredsFileSchema);
  if (all[session.sub]?.[endpointId]) {
    delete all[session.sub][endpointId];
    if (Object.keys(all[session.sub]).length === 0) {
      delete all[session.sub];
    }
    await writeTeamFile(CREDS_FILE, all, UserCredsFileSchema);
    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'opensearch_user_creds_remove',
      meta: { endpoint_id: endpointId },
    });
    await logSecurity({
      user: session.sub,
      team: session.team,
      event: 'opensearch_creds_deleted',
      meta: { endpoint_id: endpointId },
    });
  }
}

/**
 * List credential status for all configured endpoints.
 * Never exposes passwords.
 */
export async function listEndpointStatus(
  userId: string,
  validEndpointIds: string[],
): Promise<Array<{ endpoint_id: string; has_creds: boolean; username: string | null; saved_at: number | null }>> {
  const all = await readTeamFile<UserCredsFile>(CREDS_FILE, UserCredsFileSchema);
  const userCreds = all[userId] ?? {};
  return validEndpointIds.map((epId) => ({
    endpoint_id: epId,
    has_creds: !!userCreds[epId],
    username: userCreds[epId]?.username ?? null,
    saved_at: userCreds[epId]?.saved_at ?? null,
  }));
}
