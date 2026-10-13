// som-portal-v2/src/opensearch/sessions.ts
// Dashboards session cookie cache.
// Cache key = endpoint_id:user_id (matches v1 for interop).
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { SessionsFileSchema, type SessionsFile } from './schema';

const SESSIONS_FILE = 'opensearch_sessions.json';
const SESSION_TTL_SEC = 1800; // 30 min — v1 constant

/**
 * Load a cached session cookie. Returns null if expired or absent.
 */
export async function loadSessionCookie(
  endpointId: string,
  userId: string,
): Promise<string | null> {
  const sessions = await readTeamFile<SessionsFile>(SESSIONS_FILE, SessionsFileSchema);
  const key = `${endpointId}:${userId}`;
  const entry = sessions[key];
  if (!entry) return null;
  if (entry.expires_at <= Math.floor(Date.now() / 1000)) return null;
  return entry.cookie || null;
}

/**
 * Save a session cookie to cache.
 */
export async function saveSessionCookie(
  endpointId: string,
  userId: string,
  cookie: string,
): Promise<void> {
  const sessions = await readTeamFile<SessionsFile>(SESSIONS_FILE, SessionsFileSchema);
  const key = `${endpointId}:${userId}`;
  sessions[key] = {
    cookie,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  await writeTeamFile(SESSIONS_FILE, sessions, SessionsFileSchema);
}

/**
 * Invalidate a cached session cookie.
 */
export async function clearSessionCookie(
  endpointId: string,
  userId: string,
): Promise<void> {
  const sessions = await readTeamFile<SessionsFile>(SESSIONS_FILE, SessionsFileSchema);
  const key = `${endpointId}:${userId}`;
  if (sessions[key]) {
    delete sessions[key];
    await writeTeamFile(SESSIONS_FILE, sessions, SessionsFileSchema);
  }
}
