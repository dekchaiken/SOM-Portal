// som-portal-v2/config/nav.ts

/*
 * Single-source navigation registry.
 *
 * Every page in v2 is declared here. The admin UI (phase-7) will eventually
 * edit this file + the persisted `menu-permissions.json`. Until then, treat
 * this as the authoritative source for sidebar + command-palette entries.
 */

import type { IconName } from "@/icons";

export type NavGroup =
  | "home"
  | "monitor"
  | "ma"
  | "ops"
  | "automation"
  | "learn"
  | "genz"
  | "admin";

export type Role =
  | "super_admin"
  | "super_viewer"
  | "sm_admin"
  | "dev_sm"
  | "sm_lead"
  | "sm_user"
  | "dev_user"
  | "external";

export interface NavItem {
  id: string;
  path: string;
  label: string;
  icon: IconName;
  group: NavGroup;
  /** If omitted, visible to any authenticated user. */
  roles?: readonly Role[];
  /** If omitted, visible to any team. */
  teams?: readonly string[];
  /** Feature-flag key (checked against system-settings). Optional. */
  feature?: string;
  /** Maintenance key (checked against maintenance.json). Optional. */
  maintenance?: string;
  /** Lower order sorts first within its group. */
  order: number;
  /** GenZ-only perk (requires is_genz flag). */
  genzOnly?: boolean;

  // ── v1 parity fields (api/menu-permissions + layout.js coreNavItems) ──────
  /**
   * The v1 menu id this page is gated by in `menu-permissions.json`.
   * Omit for pages v1 never gated (they stay visible to any authorised role).
   * v1 source: `layout.js coreNavItems[].id`.
   */
  menuId?: string;
  /** v1 `coreNavItems[].section` — MAIN | ADMIN | DEV | GENZ | OVERSIGHT. */
  section?: "MAIN" | "ADMIN" | "DEV" | "GENZ" | "OVERSIGHT";
  /** v1 `coreNavItems[].adminOnly` — super_admin | sm_admin | dev_sm. */
  adminOnly?: boolean;
  /** v1 `coreNavItems[].denyRoles` — explicit role deny-list. */
  denyRoles?: readonly Role[];
}

export interface SessionLike {
  role: Role;
  team: string;
  isGenz?: boolean;
  features?: Readonly<Record<string, boolean>>;
  maintenance?: Readonly<Record<string, boolean>>;

  // ── v1 parity (optional; when absent the corresponding gate is skipped) ───
  /** Resolved menu ids from `menu-permissions.json` (resolveUserMenus). */
  allowedMenus?: readonly string[];
  /** The team's `features[]` from teams.json. `null` = global reader, no gate. */
  teamFeatures?: readonly string[] | null;
  /** The team's `feature_pages{}` from teams.json. */
  teamFeaturePages?: Readonly<
    Record<string, { user_pages?: readonly string[]; admin_pages?: readonly string[] }>
  >;
  /** The team's `page_modes{}` from teams.json (pageId → 'read'). */
  pageModes?: Readonly<Record<string, string>>;
  /** Per-user cross-team page grants (`users.json[].extra_pages`). */
  extraPages?: readonly { page: string; source_team?: string }[];
  /** super_viewer denied page ids (`super-viewer-config.json.denied_pages`). */
  svDenied?: readonly string[];
}

/**
 * Backward-compat shim for middleware/bridge code that imported the stub shape
 * (`{ key, label, href }`). Prefer `NavItem` for new code.
 */
export type NavEntry = { key: string; label: string; href: string };

/**
 * NAV — Phase 1 seed (Login + Dashboard + Settings + first-cutover admin).
 * Expand as modules land per T-08.
 */
export const NAV: readonly NavItem[] = [
  // ── home ─────────────────────────────────────────────────────────────────
  { id: "dashboard", path: "/dashboard", label: "Dashboard", icon: "dashboard", group: "home", order: 10, menuId: "dashboard", section: "MAIN" },
  { id: "board", path: "/board", label: "Service Board", icon: "message", group: "home", order: 20, menuId: "board", section: "MAIN", feature: "board" },
  { id: "search", path: "/search", label: "Search", icon: "search", group: "home", order: 30 },

  // ── monitoring ───────────────────────────────────────────────────────────
  { id: "service-performance", path: "/service-performance", label: "Service Performance", icon: "line-chart", group: "monitor", order: 10, menuId: "service-performance", section: "MAIN" },
  { id: "restart-monitor", path: "/restart-monitor", label: "Restart Monitor", icon: "refresh", group: "monitor", order: 20, menuId: "restart-monitor", section: "MAIN", feature: "restart-monitor" },
  { id: "log-explorer", path: "/log-explorer", label: "Log Explorer", icon: "database", group: "monitor", order: 30, menuId: "log-explorer", section: "MAIN", teams: ["sm"], denyRoles: ["super_viewer"] },

  // ── ma ───────────────────────────────────────────────────────────────────
  { id: "ma-status", path: "/ma-status", label: "MA Status", icon: "activity", group: "ma", order: 10 },

  // ── operations ───────────────────────────────────────────────────────────
  // Feature keys are verbatim from teams.json. Granting stays with super_admin.
  { id: "jenkins", path: "/jenkins", label: "Jenkins", icon: "hammer", group: "ops", order: 10, menuId: "jenkins", section: "MAIN", feature: "jenkins" },
  { id: "batch-monitor", path: "/batch-monitor", label: "Batch Monitor", icon: "boxes", group: "ops", order: 20, menuId: "batch-monitor", section: "MAIN", feature: "batch-monitor", denyRoles: ["super_viewer"] },
  { id: "batch-file-search", path: "/batch-file-search", label: "File → Job Lookup", icon: "search", group: "ops", order: 30, menuId: "batch-file-search", section: "MAIN", feature: "batch-file-search", denyRoles: ["super_viewer"] },

  // ── automation ───────────────────────────────────────────────────────────
  { id: "jira-templates", path: "/jira-templates", label: "Jira Templates", icon: "file", group: "automation", order: 10, menuId: "jira-templates", section: "MAIN", feature: "jira-templates-shared" },
  {
    id: "incident-launcher",
    path: "/incident-launcher",
    label: "Incident Launcher",
    icon: "life-buoy",
    group: "automation",
    order: 20,
    roles: ["sm_user", "sm_lead", "sm_admin", "super_admin"],
  },

  // ── learning ─────────────────────────────────────────────────────────────
  { id: "learn", path: "/learn", label: "Learn", icon: "book", group: "learn", order: 10, menuId: "learn", section: "MAIN", feature: "learning" },

  // ── admin ────────────────────────────────────────────────────────────────
  { id: "admin-overview", path: "/admin", label: "Admin Overview", icon: "shield", group: "admin", order: 10, roles: ["sm_admin", "super_admin"], menuId: "admin", section: "ADMIN", adminOnly: true },
  { id: "admin-users", path: "/admin/users", label: "Users", icon: "users", group: "admin", order: 20, roles: ["sm_admin", "super_admin"] },
  { id: "admin-system-settings", path: "/admin/system-settings", label: "System Settings", icon: "settings", group: "admin", order: 30, roles: ["sm_admin", "super_admin"] },
  { id: "admin-nav-groups", path: "/admin/nav-groups", label: "Nav Groups", icon: "layers", group: "admin", order: 40, roles: ["sm_admin", "super_admin"], menuId: "nav-groups", section: "ADMIN" },
  { id: "admin-menu-permissions", path: "/admin/menu-permissions", label: "Menu Permissions", icon: "shield", group: "admin", order: 50, roles: ["sm_admin", "super_admin"], section: "ADMIN" },
  { id: "admin-super-team-permissions", path: "/admin/super-team-permissions", label: "Super Team Permissions", icon: "boxes", group: "admin", order: 60, roles: ["super_admin"], section: "ADMIN" },
  { id: "admin-jenkins-servers", path: "/admin/jenkins-servers", label: "Jenkins Servers", icon: "server", group: "admin", order: 70, roles: ["super_admin", "sm_admin", "dev_sm"], menuId: "jenkins-servers", section: "ADMIN", adminOnly: true, feature: "jenkins" },
  { id: "admin-mail-config", path: "/admin/mail-config", label: "Mail Config", icon: "mail", group: "admin", order: 80, roles: ["sm_admin", "super_admin"], section: "ADMIN", adminOnly: true },
  { id: "admin-mail-send", path: "/admin/mail-send", label: "Send Email", icon: "mail", group: "admin", order: 81, roles: ["sm_admin", "super_admin"], section: "ADMIN", adminOnly: true },
  { id: "admin-mail-logs", path: "/admin/mail-logs", label: "Mail Logs", icon: "file", group: "admin", order: 82, roles: ["sm_admin", "super_admin"], section: "ADMIN", adminOnly: true },
  { id: "admin-mail-templates", path: "/admin/mail-templates", label: "Mail Templates", icon: "pencil", group: "admin", order: 83, roles: ["sm_admin", "super_admin"], section: "ADMIN", adminOnly: true },
  { id: "admin-scheduled-noti", path: "/admin/scheduled-noti", label: "Scheduled Notifications", icon: "clock", group: "admin", order: 90, roles: ["sm_admin", "super_admin"], section: "ADMIN", adminOnly: true },
] as const;

/** Items indexed by group, each list pre-sorted by `order`. */
export const NAV_BY_GROUP: Readonly<Record<NavGroup, readonly NavItem[]>> =
  (function build() {
    const groups: NavGroup[] = [
      "home",
      "monitor",
      "ma",
      "ops",
      "automation",
      "learn",
      "genz",
      "admin",
    ];
    const out = {} as Record<NavGroup, NavItem[]>;
    for (const g of groups) out[g] = [];
    for (const item of NAV) out[item.group].push(item);
    for (const g of groups) out[g].sort((a, b) => a.order - b.order);
    return out as Readonly<Record<NavGroup, readonly NavItem[]>>;
  })();

export const GROUP_META: Readonly<
  Record<NavGroup, { label: string; order: number }>
> = {
  home: { label: "Home", order: 1 },
  monitor: { label: "Monitoring", order: 2 },
  ma: { label: "MA", order: 3 },
  ops: { label: "Operations", order: 4 },
  automation: { label: "Automation", order: 5 },
  learn: { label: "Learning", order: 6 },
  genz: { label: "GenZ", order: 7 },
  admin: { label: "Admin", order: 8 },
};

export const NAV_GROUPS_ORDERED: readonly NavGroup[] = (
  Object.keys(GROUP_META) as NavGroup[]
).sort((a, b) => GROUP_META[a].order - GROUP_META[b].order);

/**
 * Filter NAV against a session. Keep the signature narrow so server + client
 * can share it without pulling the full user record.
 */
export function getVisibleNav(session: SessionLike | null): NavItem[] {
  if (!session) return [];
  return NAV.filter((item) => {
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
  }).sort((a, b) => {
    const ga = GROUP_META[a.group].order;
    const gb = GROUP_META[b.group].order;
    return ga === gb ? a.order - b.order : ga - gb;
  });
}

export function getNavById(id: string): NavItem | undefined {
  return NAV.find((item) => item.id === id);
}

export function getNavByPath(path: string): NavItem | undefined {
  return NAV.find((item) => item.path === path);
}
