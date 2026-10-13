// som-portal-v2/src/board/global-data.ts
//
// Readers for v1's *global* data files — the ones `_isGlobalFile()` in
// api/helpers.php keeps at `data/` root regardless of team context:
// `users.json`, `teams.json`, `menu-permissions.json`, `system-settings.json`.
//
// These are deliberately NOT read through `readTeamFile()` — doing so would
// look in `data/<team>/` and silently miss them. Team-scoped board data always
// goes through `src/board/storage.ts` instead.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ZodType, ZodTypeDef } from 'zod';
import { z } from 'zod';
import { dataDirAbsolute } from '@/lib/env';

async function readGlobalJson<T>(
  file: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  fallback: T,
): Promise<T> {
  const full = path.join(dataDirAbsolute(), file);
  let raw: string;
  try {
    raw = await fs.readFile(full, 'utf8');
  } catch {
    return fallback;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    console.error(`[board.global-data] parse failed: ${file}`);
    return fallback;
  }
  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    console.error(`[board.global-data] schema drift: ${file}`, result.error.flatten());
    return fallback;
  }
  return result.data;
}

// ── users.json (global) ──────────────────────────────────────────────────────
const ExtraPageSchema = z
  .object({ page: z.string().default(''), source_team: z.string().optional().default('') })
  .passthrough();

const MenuOverrideSchema = z
  .object({
    grant: z.array(z.string()).optional().default([]),
    deny: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export const GlobalUserSchema = z
  .object({
    id: z.string(),
    name: z.string().optional().default(''),
    username: z.string().optional().default(''),
    role: z.string().optional().default(''),
    team: z.string().nullish().default(null),
    nickname: z.string().optional().default(''),
    avatar_url: z.string().optional(),
    permissions: z.array(z.string()).optional().default([]),
    menu_permissions: MenuOverrideSchema.optional(),
    extra_pages: z.array(ExtraPageSchema).optional().default([]),
  })
  .passthrough();
export type GlobalUser = z.infer<typeof GlobalUserSchema>;
const GlobalUsersFileSchema = z.array(GlobalUserSchema);

export function readUsers(): Promise<GlobalUser[]> {
  return readGlobalJson('users.json', GlobalUsersFileSchema, []);
}

export async function findUserById(id: string): Promise<GlobalUser | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

/**
 * Display name for a session. v1 puts `name` in the JWT and writes it to
 * `author_name`; the v2 token only carries `username`, so resolve through
 * users.json and fall back to the username.
 */
export async function resolveDisplayName(userId: string, username: string): Promise<string> {
  const user = await findUserById(userId);
  const name = user?.name?.trim();
  return name && name.length > 0 ? name : username;
}

/** Users that belong to a team — the mention candidates for that team's board. */
export async function listTeamUsers(team: string): Promise<GlobalUser[]> {
  const users = await readUsers();
  return users
    .filter((u) => (u.team ?? '') === team)
    .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
}

// ── teams.json (global) ──────────────────────────────────────────────────────
export const TeamSchema = z
  .object({
    id: z.string().optional().default(''),
    slug: z.string().optional().default(''),
    name: z.string().optional().default(''),
    features: z.array(z.string()).optional().default([]),
    // v1 writes `page_modes: []` on fresh teams; coerce an empty array to {}.
    page_modes: z
      .union([z.record(z.string(), z.string()), z.array(z.unknown())])
      .optional()
      .default({})
      .transform((v) => (Array.isArray(v) ? {} : v)),
  })
  .passthrough();
export type TeamRecord = z.infer<typeof TeamSchema>;
const TeamsFileSchema = z.array(TeamSchema);

export function readTeams(): Promise<TeamRecord[]> {
  return readGlobalJson('teams.json', TeamsFileSchema, []);
}

export async function findTeam(slug: string): Promise<TeamRecord | null> {
  const teams = await readTeams();
  return teams.find((t) => t.slug === slug) ?? null;
}

// ── menu-permissions.json (global) ───────────────────────────────────────────
const MenuPermissionsSchema = z
  .object({
    version: z.number().optional(),
    roles: z.record(z.string(), z.union([z.literal('*'), z.array(z.string())])).optional().default({}),
    always_visible: z.array(z.string()).optional().default([]),
  })
  .passthrough();
export type MenuPermissions = z.infer<typeof MenuPermissionsSchema>;

/** Fail-closed-ish default: `*` for unknown roles is v1's `resolveUserMenus`. */
const MENU_FALLBACK: MenuPermissions = { roles: {}, always_visible: [] };

export function readMenuPermissions(): Promise<MenuPermissions> {
  return readGlobalJson('menu-permissions.json', MenuPermissionsSchema, MENU_FALLBACK);
}

// ── system-settings.json (global) ────────────────────────────────────────────
const SystemSettingsSchema = z
  .object({
    trash_retention_days: z.coerce.number().optional().default(30),
    api_rate_limit_requests: z.coerce.number().optional().default(120),
    api_rate_limit_window_seconds: z.coerce.number().optional().default(60),
    enable_markdown: z.boolean().optional().default(true),
  })
  .passthrough();
export type SystemSettings = z.infer<typeof SystemSettingsSchema>;

const SETTINGS_FALLBACK: SystemSettings = {
  trash_retention_days: 30,
  api_rate_limit_requests: 120,
  api_rate_limit_window_seconds: 60,
  enable_markdown: true,
};

export function readSystemSettings(): Promise<SystemSettings> {
  return readGlobalJson('system-settings.json', SystemSettingsSchema, SETTINGS_FALLBACK);
}
