// som-portal-v2/src/perms/context.ts
//
// Builds the PermissionContext that `config/permissions.ts` reasons over, from
// the REAL v1 files. This is the only place that knows where the data lives;
// the decision logic itself stays pure and unit-testable.

import { getSession, type Session } from "@/auth/session";
import { ForbiddenError, AuthError } from "@/lib/errors";
import { logSecurity } from "@/logging/security";
import { CORE_MENUS } from "@/config/menu-catalog";
import {
  resolveUserMenus,
  canSeePageEffective,
  explainPage,
  getEffectiveNav,
  getPageMode,
  type PermissionContext,
  type MenuPermissionsConfig,
  type PageDecision,
} from "@/config/permissions";
import type { NavItem, Role } from "@/config/nav";
import { asRecord } from "./schemas";
import {
  readMenuPermissions,
  readTeams,
  readPermUser,
  readMaintenanceFlags,
  readSvDenied,
} from "./store";

/** v1 `Auth.isGlobalReader()`. */
const GLOBAL_READER_ROLES: readonly string[] = ["super_admin", "super_viewer"];

/**
 * Assemble the effective-permission context for a session.
 *
 * Mirrors what the v1 browser assembles from four sources:
 *   • `menu-permissions.json` via `GET /api/menu-permissions?resolve=1`
 *   • `teams.json` via `Auth.getTeamFeatures()` / `getTeamFeaturePages()`
 *   • `users.json` via the JWT-adjacent user record (grant/deny + extra_pages)
 *   • `maintenance.json` via `maintenance.js`
 *
 * `viewAsTeam` is the super_admin "view-as" switch: a global reader with no
 * team selected keeps `teamFeatures = null`, which disables the feature gate
 * exactly as v1 does.
 */
export async function buildPermissionContext(
  session: Session,
  viewAsTeam?: string | null,
): Promise<PermissionContext> {
  const isGlobalReader = GLOBAL_READER_ROLES.includes(session.role);
  const effectiveTeam = isGlobalReader ? (viewAsTeam ?? null) : session.team;

  // Feature gate source — teams.json (global file, keyed by slug).
  let teamFeatures: readonly string[] | null = null;
  let teamFeaturePages: PermissionContext["teamFeaturePages"] = {};
  let pageModes: Record<string, string> = {};
  if (effectiveTeam) {
    const teams = await readTeams();
    const team = teams.find((t) => t.slug === effectiveTeam);
    teamFeatures = team?.features ?? [];
    teamFeaturePages = asRecord(team?.feature_pages);
    pageModes = asRecord<string>(team?.page_modes);
  }

  // Menu gate source — data/<team>/menu-permissions.json + per-user override.
  const menuCfg = await readMenuPermissions(
    effectiveTeam && effectiveTeam !== session.team ? effectiveTeam : undefined,
  );
  const user = await readPermUser(session.sub);
  const { allowed } = resolveUserMenus(
    menuCfg as MenuPermissionsConfig,
    session.role,
    CORE_MENUS,
    user?.menu_permissions ?? null,
  );

  return {
    role: session.role as Role,
    team: effectiveTeam ?? session.team,
    userId: session.sub,
    isGenz: session.is_genz ?? user?.is_genz ?? false,
    teamFeatures,
    teamFeaturePages,
    pageModes,
    allowedMenus: allowed,
    extraPages: user?.extra_pages ?? [],
    svDenied: session.role === "super_viewer" ? await readSvDenied() : null,
    maintenance: await readMaintenanceFlags(),
  };
}

/** Context for the caller of the current request. Throws if unauthenticated. */
export async function currentPermissionContext(
  viewAsTeam?: string | null,
): Promise<{ session: Session; ctx: PermissionContext }> {
  const session = await getSession();
  if (!session) throw new AuthError();
  return { session, ctx: await buildPermissionContext(session, viewAsTeam) };
}

/**
 * THE server-side gate. Call from a page's server component or a route handler.
 *
 * A direct URL hit never runs the nav filter, so hiding a link is not a gate —
 * this is. Denials are written to the security log like v1's `logSecurity()`.
 */
export async function requirePageAccess(pageId: string): Promise<{
  session: Session;
  ctx: PermissionContext;
}> {
  const { session, ctx } = await currentPermissionContext();
  const decision: PageDecision = explainPage(pageId, ctx);
  if (!decision.allowed) {
    await logSecurity({
      user: session.sub,
      team: session.team,
      event: "page_access_denied",
      meta: { page: pageId, role: session.role, reason: decision.reason ?? "unknown" },
    });
    throw new ForbiddenError(
      `You do not have access to this page (${decision.reason ?? "denied"})`,
    );
  }
  return { session, ctx };
}

/** Non-throwing variant for conditional rendering inside an allowed page. */
export async function hasPageAccess(pageId: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  return canSeePageEffective(pageId, await buildPermissionContext(session));
}

/** The nav this session actually gets. `showLocked` keeps "No Access" entries. */
export async function effectiveNavFor(
  session: Session,
  showLocked = false,
): Promise<(NavItem & { locked?: boolean })[]> {
  return getEffectiveNav(await buildPermissionContext(session), showLocked);
}

/** v1 `Auth.getPageMode()` — 'full' | 'read' for the current session. */
export async function currentPageMode(pageId: string): Promise<"full" | "read"> {
  const session = await getSession();
  if (!session) return "full";
  return getPageMode(pageId, await buildPermissionContext(session));
}
