// som-portal-v2/config/permissions.ts

import { getNavById, type NavItem, type Role, type SessionLike } from "./nav";
import { NAV, GROUP_META } from "./nav";
import {
  CORE_MENUS,
  SUB_PAGE_MAP,
  DEFAULT_ALWAYS_VISIBLE,
  type NavGroupConfig,
} from "./menu-catalog";

/**
 * canSeePage — gate check for a single page id.
 *
 * Mirrors `getVisibleNav` logic but keeps the single-id path cheap for
 * middleware / layout gates. Returns true for pages that aren't in the nav
 * registry (e.g. detail routes); those pages must enforce their own guards.
 */
export function canSeePage(
  pageId: string,
  session: SessionLike | null,
): boolean {
  if (!session) return false;
  const item = getNavById(pageId);
  if (!item) return true;
  return matchesSession(item, session);
}

export function matchesSession(
  item: NavItem,
  session: SessionLike,
): boolean {
  if (item.roles && !item.roles.includes(session.role)) return false;
  if (item.teams && !item.teams.includes(session.team)) return false;
  if (item.genzOnly && !session.isGenz) return false;
  if (item.feature && session.features && !session.features[item.feature]) {
    return false;
  }
  if (
    item.maintenance &&
    session.maintenance &&
    session.maintenance[item.maintenance]
  ) {
    return false;
  }
  return true;
}

/** Roles that bypass maintenance locks (per feedback_frontend_dos_donts). */
export const MAINTENANCE_BYPASS_ROLES: readonly Role[] = [
  "super_admin",
  "sm_admin",
];

export function canBypassMaintenance(role: Role): boolean {
  return MAINTENANCE_BYPASS_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// v1-parity effective visibility (A5)
//
// Reproduces, in order, the gate chain that v1 applies to every nav entry:
//
//   1. layout.js `_getFilteredNavItems()` — adminOnly / roles / denyRoles /
//      super_viewer denied set / genzOnly / external-section / team pin
//   2. teams.json `features[]`     → feature gate
//   3. teams.json `feature_pages{}` → per-feature page grant
//   4. menu-permissions.json       → helpers.php `resolveUserMenus()`
//   5. users.json `extra_pages[]`  → bypasses 2–4 for that one page
//   6. maintenance.json            → page lock (bypassed by MAINTENANCE_BYPASS_ROLES)
//
// Keep `canSeePage` / `matchesSession` above untouched — siblings import them.
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of `data/<team>/menu-permissions.json` (v1 field names, 1:1). */
export interface MenuPermissionsConfig {
  version: number;
  /** role → `"*"` (all) or an explicit list of menu ids. */
  roles: Record<string, "*" | string[]>;
  always_visible: string[];
  updated_at: number;
}

export interface MenuResolution {
  allowed: string[];
  mode: "wildcard" | "explicit";
}

/** Per-user override block from `users.json[].menu_permissions`. */
export interface UserMenuOverride {
  grant?: readonly string[];
  deny?: readonly string[];
}

/** The reason a page was denied — surfaced by APIs and the admin diff view. */
export type DenyReason =
  | "no_session"
  | "admin_only"
  | "role"
  | "deny_role"
  | "super_viewer_denied"
  | "genz_only"
  | "external_section"
  | "team"
  | "feature"
  | "feature_page"
  | "menu_permissions"
  | "maintenance";

export interface PageDecision {
  allowed: boolean;
  reason?: DenyReason;
  /** v1 "locked" entries: hard-hidden vs shown with a No Access badge. */
  locked?: boolean;
}

/**
 * helpers.php `resolveUserMenus($userId, $role, $allMenuIds)` — ported exactly.
 *
 * 1. role default (`"*"` → every known menu, array → that array)
 * 2/3. per-user grant then deny
 * 4. `always_visible` union
 */
export function resolveUserMenus(
  config: MenuPermissionsConfig | null,
  role: string,
  allMenuIds: readonly string[] = CORE_MENUS,
  userOverride?: UserMenuOverride | null,
): MenuResolution {
  const roleCfg = config?.roles?.[role] ?? "*"; // v1 safe default
  const always = config?.always_visible ?? [...DEFAULT_ALWAYS_VISIBLE];

  let allowed: string[];
  let mode: "wildcard" | "explicit";
  if (roleCfg === "*") {
    allowed = [...allMenuIds];
    mode = "wildcard";
  } else if (Array.isArray(roleCfg)) {
    allowed = [...roleCfg];
    mode = "explicit";
  } else {
    allowed = [...allMenuIds];
    mode = "wildcard";
  }

  if (userOverride?.grant?.length) {
    allowed = [...new Set([...allowed, ...userOverride.grant])];
  }
  if (userOverride?.deny?.length) {
    const deny = new Set(userOverride.deny);
    allowed = allowed.filter((m) => !deny.has(m));
  }

  allowed = [...new Set([...allowed, ...always])];
  return { allowed, mode };
}

/**
 * v1 SUB_PAGE_MAP expansion: a sub-page is allowed when its parent menu is.
 * Applied on top of `resolveUserMenus` so direct-URL checks behave like v1's
 * `layout.js` page guard.
 */
export function expandSubPages(allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  for (const [sub, parent] of Object.entries(SUB_PAGE_MAP)) {
    if (set.has(parent)) set.add(sub);
  }
  return [...set];
}

/** Everything the gate needs. Built server-side by `src/perms/context.ts`. */
export interface PermissionContext {
  role: Role;
  team: string;
  userId?: string;
  isGenz?: boolean;
  /** `null` = global reader with no view-as team → no feature gate (v1 Auth.getTeamFeatures). */
  teamFeatures: readonly string[] | null;
  teamFeaturePages: Readonly<
    Record<string, { user_pages?: readonly string[]; admin_pages?: readonly string[] }>
  >;
  pageModes: Readonly<Record<string, string>>;
  /** Resolved allowed menu ids, or `null` to skip the menu gate entirely. */
  allowedMenus: readonly string[] | null;
  extraPages: readonly { page: string; source_team?: string }[];
  svDenied: readonly string[] | null;
  maintenance: Readonly<Record<string, boolean>>;
}

const ADMIN_NAV_ROLES: readonly string[] = ["super_admin", "sm_admin", "dev_sm"];

/**
 * The effective gate. Mirrors `_getFilteredNavItems()` in assets/js/layout.js
 * plus the maintenance lock, then returns *why* a page was denied so the API
 * and the admin UI can explain it.
 *
 * `showLocked` mirrors the v1 argument of the same name: soft gates (feature /
 * feature_pages / menu-permissions) produce `locked: true` instead of a hard
 * hide, which is how the v1 sidebar renders the "No Access" badge.
 */
export function decidePage(
  item: NavItem,
  ctx: PermissionContext | null,
  showLocked = false,
): PageDecision {
  if (!ctx) return { allowed: false, reason: "no_session" };

  const isAdmin = ADMIN_NAV_ROLES.includes(ctx.role);
  const isExternal = ctx.role === "external";

  // ── 1. Hard gates — never shown, regardless of showLocked ────────────────
  if (item.adminOnly && !isAdmin) return { allowed: false, reason: "admin_only" };
  if (item.roles && !item.roles.includes(ctx.role)) {
    return { allowed: false, reason: "role" };
  }
  if (isExternal && item.denyRoles?.includes("external")) {
    return { allowed: false, reason: "deny_role" };
  }
  if (ctx.role === "super_viewer") {
    const denied = ctx.svDenied
      ? ctx.svDenied.includes(item.menuId ?? item.id)
      : !!item.denyRoles?.includes("super_viewer");
    if (denied) return { allowed: false, reason: "super_viewer_denied" };
  } else if (item.denyRoles?.includes(ctx.role)) {
    return { allowed: false, reason: "deny_role" };
  }
  if (item.genzOnly && !ctx.isGenz) return { allowed: false, reason: "genz_only" };
  if (isExternal && (item.section === "ADMIN" || item.section === "DEV")) {
    return { allowed: false, reason: "external_section" };
  }
  // v1 team pin: `item.team && effectiveTeam !== null && effectiveTeam !== item.team`
  if (item.teams && item.teams.length > 0 && !item.teams.includes(ctx.team)) {
    return { allowed: false, reason: "team" };
  }

  // ── 2. Maintenance lock (global maintenance.json) ────────────────────────
  const mKey = item.maintenance ?? item.menuId ?? item.id;
  if (ctx.maintenance[mKey] === true && !MAINTENANCE_BYPASS_ROLES.includes(ctx.role)) {
    return { allowed: false, reason: "maintenance" };
  }

  // ── 3. Soft gates — bypassed entirely by a per-user extra_pages grant ────
  const menuId = item.menuId ?? item.id;
  const hasExtraPage = ctx.extraPages.some((ep) => ep.page === menuId);
  if (hasExtraPage) return { allowed: true };

  let locked = false;
  let reason: DenyReason | undefined;

  if (item.feature && ctx.teamFeatures !== null) {
    if (!ctx.teamFeatures.includes(item.feature)) {
      if (!showLocked) return { allowed: false, reason: "feature" };
      locked = true;
      reason = "feature";
    } else {
      const plan = ctx.teamFeaturePages[item.feature];
      if (plan && Array.isArray(plan.user_pages) && !plan.user_pages.includes(menuId)) {
        if (!showLocked) return { allowed: false, reason: "feature_page" };
        locked = true;
        reason = "feature_page";
      }
    }
  }

  if (!locked && ctx.allowedMenus !== null && item.menuId) {
    // Only pages v1 actually gates (those with a menu id) are menu-gated.
    if (!expandSubPages(ctx.allowedMenus).includes(item.menuId)) {
      if (!showLocked) return { allowed: false, reason: "menu_permissions" };
      locked = true;
      reason = "menu_permissions";
    }
  }

  if (locked) return { allowed: showLocked, reason, locked: true };
  return { allowed: true };
}

/**
 * Server-side page gate. Call this from a page's server component or a route
 * handler — NEVER rely on the nav being filtered, since a direct URL skips it.
 */
export function canSeePageEffective(
  pageId: string,
  ctx: PermissionContext | null,
): boolean {
  if (!ctx) return false;
  const item = getNavById(pageId) ?? NAV.find((n) => n.menuId === pageId);
  if (!item) {
    // Not in the registry (detail routes). Fall back to the raw menu gate so an
    // unknown-but-gated v1 menu id still resolves the same way.
    if (ctx.allowedMenus === null) return true;
    if (!CORE_MENUS.includes(pageId)) return true;
    return expandSubPages(ctx.allowedMenus).includes(pageId);
  }
  return decidePage(item, ctx, false).allowed;
}

/** Why a page is denied — for 403 copy and the admin diff indicator. */
export function explainPage(
  pageId: string,
  ctx: PermissionContext | null,
): PageDecision {
  const item = getNavById(pageId) ?? NAV.find((n) => n.menuId === pageId);
  if (!item) return { allowed: canSeePageEffective(pageId, ctx) };
  return decidePage(item, ctx, false);
}

/** The effective nav for a session. `showLocked` keeps soft-denied entries. */
export function getEffectiveNav(
  ctx: PermissionContext | null,
  showLocked = false,
): (NavItem & { locked?: boolean })[] {
  if (!ctx) return [];
  const out: (NavItem & { locked?: boolean })[] = [];
  for (const item of NAV) {
    const d = decidePage(item, ctx, showLocked);
    if (!d.allowed) continue;
    out.push(d.locked ? { ...item, locked: true } : item);
  }
  return out.sort((a, b) => {
    const ga = GROUP_META[a.group].order;
    const gb = GROUP_META[b.group].order;
    return ga === gb ? a.order - b.order : ga - gb;
  });
}

/**
 * v1 `Auth.getPageMode(pageId)` — 'full' | 'read'.
 * super_viewer is always read-only; everyone else takes the team's page_modes.
 */
export function getPageMode(pageId: string, ctx: PermissionContext | null): "full" | "read" {
  if (!ctx) return "full";
  if (ctx.role === "super_viewer") return "read";
  return ctx.pageModes[pageId] === "read" ? "read" : "full";
}

/**
 * Lock-out guard for the Menu Permissions editor: an admin must never save a
 * config that strips their own role's access to the page they are editing.
 * Mirrors the intent of the brief's "don't lock out" rule.
 */
export function wouldLockOutSelf(
  next: MenuPermissionsConfig,
  selfRole: string,
  requiredMenus: readonly string[],
): string[] {
  const cfg = next.roles?.[selfRole];
  if (cfg === "*" || cfg === undefined) return [];
  const allowed = new Set([
    ...(Array.isArray(cfg) ? cfg : []),
    ...(next.always_visible ?? []),
  ]);
  return requiredMenus.filter((m) => !allowed.has(m));
}

/** Only groups that still hold a visible item, in nav-groups.json order. */
export function visibleNavGroups(
  groups: readonly NavGroupConfig[],
  allowedMenuIds: readonly string[],
): NavGroupConfig[] {
  const set = new Set(allowedMenuIds);
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => set.has(i)) }))
    .filter((g) => g.items.length > 0);
}
