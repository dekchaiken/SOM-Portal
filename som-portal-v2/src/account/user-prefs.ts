// som-portal-v2/src/account/user-prefs.ts
//
// Team-scoped per-user preferences. ALWAYS goes through readTeamFile/
// writeTeamFile so the team slug comes from the verified JWT claim and never
// from user input — `data/<team>/user-prefs.json`, never `data/user-prefs.json`.

import type { ZodSchema } from 'zod';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import {
  DEFAULT_USER_PREFS,
  UserPrefsFileSchema,
  UserPrefsSchema,
  mergePrefs,
  normalisePrefs,
  type UserPrefs,
  type UserPrefsFile,
  type UserPrefsPatch,
} from '@/data/schemas/user-prefs';
import { v1Date } from '@/lib/v1-date';

export const USER_PREFS_FILE = 'user-prefs.json';

/**
 * `readTeamFile`/`writeTeamFile` take `ZodSchema<T>`, whose Input is pinned to
 * T. Our schema intentionally has defaults, so its Input (everything optional)
 * differs from its Output. The cast reconciles the two; runtime behaviour is
 * unchanged because both helpers only ever call `.safeParse()` / `.parse()`.
 */
const FILE_SCHEMA = UserPrefsFileSchema as unknown as ZodSchema<UserPrefsFile>;

export async function readAllUserPrefs(): Promise<UserPrefsFile> {
  return readTeamFile(USER_PREFS_FILE, FILE_SCHEMA);
}

export async function readUserPrefs(userId: string): Promise<UserPrefs> {
  const all = await readAllUserPrefs();
  const raw = all[userId];
  if (!raw) return DEFAULT_USER_PREFS;
  const parsed = UserPrefsSchema.safeParse(raw);
  return normalisePrefs(parsed.success ? parsed.data : DEFAULT_USER_PREFS);
}

export async function patchUserPrefs(
  userId: string,
  patch: UserPrefsPatch,
): Promise<UserPrefs> {
  const all = await readAllUserPrefs();
  const currentParsed = UserPrefsSchema.safeParse(all[userId] ?? {});
  const current = currentParsed.success ? currentParsed.data : DEFAULT_USER_PREFS;
  const next = mergePrefs(current, patch, v1Date());
  await writeTeamFile(USER_PREFS_FILE, { ...all, [userId]: next }, FILE_SCHEMA);
  return next;
}

/** "Sign out everywhere" marker. v2-only — see schema note. */
export async function revokeUserSessions(userId: string): Promise<UserPrefs> {
  const all = await readAllUserPrefs();
  const parsed = UserPrefsSchema.safeParse(all[userId] ?? {});
  const current = parsed.success ? parsed.data : DEFAULT_USER_PREFS;
  const stamp = v1Date();
  const next: UserPrefs = { ...current, sessions_revoked_at: stamp, updated_at: stamp };
  await writeTeamFile(USER_PREFS_FILE, { ...all, [userId]: next }, FILE_SCHEMA);
  return next;
}
