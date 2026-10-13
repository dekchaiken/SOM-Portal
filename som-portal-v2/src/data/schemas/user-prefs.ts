// som-portal-v2/src/data/schemas/user-prefs.ts
//
// `user-prefs.json` is NEW in v2 (v1 kept the theme in localStorage only, see
// assets/js/theme.js), so there is no v1 field map to match. It IS team-scoped:
// the file lives at `data/<team>/user-prefs.json` and is only ever reached via
// readTeamFile/writeTeamFile, so one team can never read another's prefs.

import { z } from 'zod';

export const ThemeNameSchema = z.enum(['glass', 'enterprise', 'console', 'warm']);
export const ModeNameSchema = z.enum(['light', 'dark']);

export const NotificationPrefsSchema = z
  .object({
    board: z.boolean().default(true),
    jira: z.boolean().default(true),
    jenkins: z.boolean().default(true),
    incident: z.boolean().default(true),
  })
  .default({ board: true, jira: true, jenkins: true, incident: true });

export const UserPrefsSchema = z
  .object({
    theme: ThemeNameSchema.default('enterprise'),
    mode: ModeNameSchema.default('light'),
    /** User's opt-in to the GenZ overlay. Only honoured when the record is is_genz. */
    genz_overlay: z.boolean().default(true),
    notifications: NotificationPrefsSchema,
    /**
     * Set by "Sign out everywhere". v2-only (v1 JWTs are stateless and PHP does
     * not consult this field) — see the Sessions tab note in the settings page.
     */
    sessions_revoked_at: z.string().nullable().default(null),
    updated_at: z.string().nullable().default(null),
  })
  .strip();

/** The whole file: a map of user id → prefs. */
export const UserPrefsFileSchema = z.record(z.string(), UserPrefsSchema).default({});

export type ThemeNamePref = z.infer<typeof ThemeNameSchema>;
export type ModeNamePref = z.infer<typeof ModeNameSchema>;
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;
export type UserPrefs = z.infer<typeof UserPrefsSchema>;
export type UserPrefsFile = z.infer<typeof UserPrefsFileSchema>;

export const DEFAULT_USER_PREFS: UserPrefs = UserPrefsSchema.parse({});

/** Console is always dark (project rule) — applied on read AND write. */
export function normalisePrefs(prefs: UserPrefs): UserPrefs {
  if (prefs.theme === 'console' && prefs.mode !== 'dark') {
    return { ...prefs, mode: 'dark' };
  }
  return prefs;
}

export const UserPrefsPatchSchema = z
  .object({
    theme: ThemeNameSchema.optional(),
    mode: ModeNameSchema.optional(),
    genz_overlay: z.boolean().optional(),
    notifications: z
      .object({
        board: z.boolean().optional(),
        jira: z.boolean().optional(),
        jenkins: z.boolean().optional(),
        incident: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export type UserPrefsPatch = z.infer<typeof UserPrefsPatchSchema>;

/** Pure merge used by PATCH /api/v1/user-prefs (unit-tested). */
export function mergePrefs(
  current: UserPrefs,
  patch: UserPrefsPatch,
  now: string,
): UserPrefs {
  const merged: UserPrefs = {
    ...current,
    ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
    ...(patch.genz_overlay !== undefined ? { genz_overlay: patch.genz_overlay } : {}),
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    updated_at: now,
  };
  return normalisePrefs(merged);
}
