// som-portal-v2/src/jira/access.ts
//
// Multi-team access control for the Jira Templates module.
//
// v1 reference:
//   • api/templates/index.php GET  — super_admin OR team==='sm' OR the team has
//     'jira-templates' / 'jira-templates-shared' in teams.json features[].
//   • api/helpers.php requireSmForShared() — writes to an SM-shared file are
//     rejected for any team other than 'sm'.
//   • assets/pages/jira-templates/jira-templates.js canManage — role must be one
//     of super_admin | sm_lead | sm_admin | dev_sm AND effective team 'sm'
//     (or raw super_admin).
//   • data/<team>/menu-permissions.json — superadmin-configured per-role page list.
//
// templates.json + jira_config.json are SM-shared (helpers.php smSharedFiles()),
// so reads go through readSharedFile and land on data/sm/*. Never read data/ root.

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataDirAbsolute } from "@/lib/env";
import { ForbiddenError } from "@/lib/errors";
import { requireAuth, SM_WRITE_SHARED_ROLES, SUPER_ADMIN, LEAD_ROLES } from "@/auth/policy";
import type { Session } from "@/auth/session";
import { readTeamFile } from "@/team/scope";
import { getDataAdapter } from "@/data/json-adapter";
import { canSeePage } from "@/config/permissions";
import type { SessionLike } from "@/config/nav";

export const PAGE_ID = "jira-templates";
export const FEATURE_FULL = "jira-templates";
export const FEATURE_SHARED = "jira-templates-shared";

// ── teams.json (global file — not team-scoped) ──────────────────────────────

const TeamSchema = z.object({
  id: z.string().optional(),
  slug: z.string(),
  name: z.string().optional(),
  features: z.array(z.string()).default([]),
});
const TeamsFileSchema = z.array(TeamSchema).catch([]);
export type TeamRecord = z.infer<typeof TeamSchema>;

function teamsDirAbsolute(): string {
  // Read DATA_DIR directly: teams.json is a global (not team-scoped) file and
  // we don't want strict env validation (e.g. missing JWT_SECRET in tests) to
  // mask a real teams.json read.
  const raw = process.env.DATA_DIR && process.env.DATA_DIR !== "" ? process.env.DATA_DIR : "../data";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export async function readTeams(): Promise<TeamRecord[]> {
  try {
    const raw = await fs.readFile(path.join(teamsDirAbsolute(), "teams.json"), "utf8");
    return TeamsFileSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function teamFeatures(slug: string): Promise<string[]> {
  const teams = await readTeams();
  return teams.find((t) => t.slug === slug)?.features ?? [];
}

// ── menu-permissions.json (per-team, superadmin-configured) ─────────────────

const MenuPermsObject = z.object({
  roles: z.record(z.union([z.literal("*"), z.array(z.string())])).catch({}),
  always_visible: z.array(z.string()).catch([]),
});
type MenuPerms = z.infer<typeof MenuPermsObject>;
const MenuPermsSchema: z.ZodType<MenuPerms, z.ZodTypeDef, unknown> = MenuPermsObject.catch({
  roles: {},
  always_visible: [],
});

/**
 * Is `pageId` allowed for this session's role by the team's menu-permissions?
 * A missing file or a role with no entry means "not restricted" (v1 falls back
 * to CORE_MENUS defaults), so we allow — we never *widen* beyond the role/feature
 * gates, we only honour an explicit narrowing.
 */
export async function menuAllows(session: Session, pageId: string): Promise<boolean> {
  if (session.role === SUPER_ADMIN) return true;
  // Read via the adapter directly, scoped to the session's own team. We can't
  // use readTeamFile here because that resolves the team through getSession(),
  // which would re-check auth and widen the surface. Our caller already has the
  // Session, so just read `data/<session.team>/menu-permissions.json`.
  let perms: MenuPerms;
  try {
    const raw = await getDataAdapter().read<unknown>({ team: session.team }, "menu-permissions.json");
    if (raw == null) return true; // no file → default visibility
    const parsed = MenuPermsSchema.safeParse(raw);
    if (!parsed.success) return true;
    perms = parsed.data;
  } catch {
    return true;
  }
  if (perms.always_visible.includes(pageId)) return true;
  const entry = perms.roles[session.role];
  if (entry === undefined) return true; // not configured → default visibility
  if (entry === "*") return true;
  return entry.includes(pageId);
}

// ── Gates ──────────────────────────────────────────────────────────────────

export interface JiraAccess {
  session: Session;
  /** May read the shared template library. */
  canRead: boolean;
  /** May create/edit templates + jira_config (SM team, lead-level roles). */
  canManage: boolean;
  /** May delete templates (v1: requireSmForShared + LEAD_ROLES). */
  canDelete: boolean;
  /** Full per-team ticket creation, vs. view-only share. */
  canCreateIssue: boolean;
}

export async function getJiraAccess(session: Session): Promise<JiraAccess> {
  const isSuper = session.role === SUPER_ADMIN;
  const isSm = session.team === "sm";

  const features = isSm || isSuper ? [FEATURE_FULL, FEATURE_SHARED] : await teamFeatures(session.team);
  const hasFull = features.includes(FEATURE_FULL);
  const hasShared = features.includes(FEATURE_SHARED);

  const featureOk = isSuper || isSm || hasFull || hasShared;
  const navOk =
    canSeePage(PAGE_ID, {
      role: session.role as SessionLike["role"],
      team: session.team,
      isGenz: session.is_genz ?? false,
    }) && (await menuAllows(session, PAGE_ID));

  const canRead = featureOk && navOk;
  const writeRole = (SM_WRITE_SHARED_ROLES as readonly string[]).includes(session.role);
  const canManage = canRead && writeRole && (isSm || isSuper);

  return {
    session,
    canRead,
    canManage,
    canDelete: canManage && (LEAD_ROLES as readonly string[]).includes(session.role),
    canCreateIssue: canRead && (isSuper || isSm || hasFull),
  };
}

/** Throws 401/403 — use at the top of every route in this module. */
export async function requireJiraRead(): Promise<JiraAccess> {
  const session = await requireAuth();
  const access = await getJiraAccess(session);
  if (!access.canRead) {
    throw new ForbiddenError("Your team does not have access to jira templates");
  }
  return access;
}

export async function requireJiraManage(): Promise<JiraAccess> {
  const access = await requireJiraRead();
  if (!access.canManage) {
    throw new ForbiddenError(
      `This resource is managed by the SM team and is view-only for team "${access.session.team}"`,
    );
  }
  return access;
}

export async function requireJiraDelete(): Promise<JiraAccess> {
  const access = await requireJiraManage();
  if (!access.canDelete) {
    throw new ForbiddenError("Forbidden: insufficient permissions");
  }
  return access;
}

export async function requireJiraCreateIssue(): Promise<JiraAccess> {
  const access = await requireJiraRead();
  if (!access.canCreateIssue) {
    throw new ForbiddenError(
      `Ticket creation is not enabled for team "${access.session.team}" (view-only share)`,
    );
  }
  return access;
}
