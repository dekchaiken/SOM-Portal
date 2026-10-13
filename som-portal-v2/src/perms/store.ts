// som-portal-v2/src/perms/store.ts
//
// Server-only I/O for the permission files. Every read is team-scoped unless
// the v1 file is explicitly global (teams.json / users.json / maintenance.json —
// see helpers.php `_isGlobalFile()`), so nothing leaks across teams.
//
//   menu-permissions.json  → data/<team>/   (readTeamFile / writeTeamFile)
//   nav-groups.json        → data/<team>/   (readTeamFile / writeTeamFile)
//   teams.json             → data/          (global)
//   users.json             → data/          (global, read-only here)
//   maintenance.json       → data/          (global, read-only here)

import { z } from "zod";
import { readTeamFile, writeTeamFile } from "@/team/scope";
import { readGlobalFile } from "@/team/features";
import { getDataAdapter } from "@/data/json-adapter";
import { getSession } from "@/auth/session";
import { ForbiddenError, AuthError } from "@/lib/errors";
import { logSecurity } from "@/logging/security";
import { SUPER_ADMIN } from "@/auth/policy";
import { DEFAULT_ALWAYS_VISIBLE, DEFAULT_NAV_GROUPS } from "@/config/menu-catalog";
import {
  out,
  MenuPermissionsSchema,
  NavGroupsSchema,
  TeamsFileSchema,
  PermUsersFileSchema,
  MaintenanceFileSchema,
  type MenuPermissionsFile,
  type NavGroupsFile,
  type TeamRecord,
} from "./schemas";

export const MENU_PERMISSIONS_FILE = "menu-permissions.json";
export const NAV_GROUPS_FILE = "nav-groups.json";
export const TEAMS_FILE = "teams.json";

/**
 * v1 fallback when a team has no menu-permissions.json yet
 * (api/menu-permissions/index.php GET, `if (empty($cfg))`).
 */
export function defaultMenuPermissions(): MenuPermissionsFile {
  return {
    version: 1,
    roles: {
      sm_admin: "*",
      dev_sm: "*",
      sm_lead: "*",
      sm_user: "*",
      dev_user: ["service-performance", "restart-monitor"],
      external: ["dashboard", "board"],
    },
    always_visible: [...DEFAULT_ALWAYS_VISIBLE],
    updated_at: 0,
  };
}

/** Read `data/<team>/menu-permissions.json`. Missing file → v1 default. */
export async function readMenuPermissions(team?: string): Promise<MenuPermissionsFile> {
  const cfg = await readTeamFile(
    MENU_PERMISSIONS_FILE,
    out(MenuPermissionsSchema),
    team ? { team } : undefined,
  );
  if (!cfg || Object.keys(cfg.roles ?? {}).length === 0) return defaultMenuPermissions();
  return cfg;
}

export async function writeMenuPermissions(
  cfg: MenuPermissionsFile,
  team?: string,
): Promise<void> {
  await writeTeamFile(
    MENU_PERMISSIONS_FILE,
    cfg,
    out(MenuPermissionsSchema),
    team ? { team } : undefined,
  );
}

/** Read `data/<team>/nav-groups.json`. Missing/empty → v1 `$defaultGroups`. */
export async function readNavGroups(team?: string): Promise<NavGroupsFile> {
  const data = await readTeamFile(
    NAV_GROUPS_FILE,
    out(NavGroupsSchema),
    team ? { team } : undefined,
  );
  if (!data || !data.groups?.length) {
    return { groups: DEFAULT_NAV_GROUPS.map((g) => ({ ...g, items: [...g.items] })), is_default: true };
  }
  return data;
}

export async function writeNavGroups(file: NavGroupsFile, team?: string): Promise<void> {
  await writeTeamFile(NAV_GROUPS_FILE, file, out(NavGroupsSchema), team ? { team } : undefined);
}

// ─── Global files ────────────────────────────────────────────────────────────
// `{ team: '.' }` resolves to DATA_DIR root through JsonAdapter.resolvePath().
const GLOBAL_SCOPE = { team: "." } as const;

export async function readTeams(): Promise<TeamRecord[]> {
  return readGlobalFile(TEAMS_FILE, out(TeamsFileSchema));
}

export async function getTeamBySlug(slug: string): Promise<TeamRecord | null> {
  return (await readTeams()).find((t) => t.slug === slug) ?? null;
}

/**
 * Write `data/teams.json`. super_admin ONLY — this is the critical boundary of
 * the whole module (brief: "Super Team Permissions MUST requireRole(SUPER_ADMIN)").
 */
export async function writeTeams(teams: TeamRecord[]): Promise<void> {
  const sess = await getSession();
  if (!sess) throw new AuthError();
  if (sess.role !== SUPER_ADMIN) {
    await logSecurity({
      user: sess.sub,
      team: sess.team,
      event: "teams_write_denied",
      meta: { role: sess.role },
    });
    throw new ForbiddenError("Editing team permissions requires super_admin");
  }
  const parsed = TeamsFileSchema.parse(teams);
  await getDataAdapter().write(GLOBAL_SCOPE, TEAMS_FILE, parsed);
  await logSecurity({
    user: sess.sub,
    team: sess.team,
    event: "global_file_write",
    meta: { file: TEAMS_FILE },
  });
}

/** Per-user grant/deny + extra_pages from the GLOBAL users.json (v1 parity). */
export async function readPermUser(userId: string): Promise<{
  menu_permissions?: { grant?: string[]; deny?: string[] } | null;
  extra_pages?: { page: string; source_team?: string }[];
  is_genz?: boolean;
} | null> {
  if (!userId) return null;
  const users = await readGlobalFile("users.json", out(PermUsersFileSchema));
  return users.find((u) => u.id === userId) ?? null;
}

/** `data/maintenance.json` → `{ pageId: true }` for pages currently locked. */
export async function readMaintenanceFlags(): Promise<Record<string, boolean>> {
  const raw = await readGlobalFile("maintenance.json", out(MaintenanceFileSchema));
  const flags: Record<string, boolean> = {};
  const pages = raw.pages ?? {};
  for (const [id, state] of Object.entries(pages)) {
    const active =
      typeof state === "object" && state !== null
        ? (state as { active?: unknown }).active === true
        : state === true;
    if (active) flags[id] = true;
  }
  return flags;
}

/** Super-viewer denied page ids (`data/<team>/super-viewer-config.json`). */
const SvConfigSchema = z
  .object({ denied_pages: z.array(z.string()).default([]) })
  .passthrough()
  .default({ denied_pages: [] });

export async function readSvDenied(): Promise<string[] | null> {
  try {
    const cfg = await readTeamFile("super-viewer-config.json", out(SvConfigSchema));
    return cfg?.denied_pages ?? null;
  } catch {
    return null;
  }
}
