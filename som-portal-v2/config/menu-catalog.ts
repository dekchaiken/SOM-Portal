// som-portal-v2/config/menu-catalog.ts
//
// 1:1 mirror of the v1 PHP/JS permission vocabulary. Nothing here is invented:
// every constant has a named v1 source so dual-run (PHP ↔ v2) stays consistent.
//
//   CORE_MENUS        ← api/menu-permissions/index.php  `const CORE_MENUS`
//   SUB_PAGE_MAP      ← api/menu-permissions/index.php  `const SUB_PAGE_MAP`
//   KNOWN_ROLES       ← api/menu-permissions/index.php  `known_roles`
//   ALWAYS_VISIBLE    ← api/menu-permissions/index.php  default `always_visible`
//   DEFAULT_FEATURES  ← api/helpers.php `defaultFeatures()`
//                       (= assets/pages/admin/super-team-permissions DEFAULT_FEATURES)
//   FEATURE_CATALOGUE ← assets/pages/admin/super-team-permissions/…js FEATURE_CATALOGUE
//   PAGE_MODES        ← assets/pages/admin/super-team-permissions/…js PAGE_MODES
//   DEFAULT_NAV_GROUPS← api/nav-groups/index.php `$defaultGroups`
//
// This file is pure data + pure functions: no node:*, no next/*. Safe to import
// from the Edge runtime, from tests, and from client components.

/** v1: api/menu-permissions/index.php — CORE_MENUS. Order preserved. */
export const CORE_MENUS: readonly string[] = [
  "dashboard", "my-team", "board", "sheets", "sabai", "schedule", "pw-schedule",
  "ma-services", "ma-test",
  "learn", "weekly-report", "report-center", "analytics", "send-email", "inbox", "admin",
  "restart-monitor", "service-performance", "restart-analyzer", "log-explorer",
  "alert-monitor", "grafana-alerts",
  "about-som",
  // Requestable feature pages (added as features are unlocked)
  "batch-monitor", "batch-file-search",
  // Jenkins Build Launcher — 'jenkins-build' = submit/trigger,
  // 'jenkins-build-approve' = checker permission (approve/reject submissions).
  "jenkins-build", "jenkins-build-approve",
  // Jenkins Portal (Unbind Trigger)
  "jenkins-portal",
  // SO Jenkins (CLT RAG pipeline)
  "so-jenkins",
  "monitoring", "monitoring-wall", "syncup", "uptime", "test-service", "onboarding",
  "sms-gateway-switches",
  // View-only sidebar entries for SM-shared config libraries
  "jira-templates",
  // Oversight (super_viewer / super_admin) — cross-team read-only reports
  "learn-reports", "exam-reports",
  // Dev tools
  "devtools", "dev-system", "dev-api", "dev-logs", "dev-email", "dev-data",
  // GenZ Team (SM-only)
  "genz-hub", "genz-team", "genz-notes",
  // Automation group (SM-only)
  "incident-launcher",
  "incident-launcher-config",
  "migrate-user",
  // Case Incidents (SM-only)
  "case-incidents",
] as const;

/**
 * v1: api/menu-permissions/index.php — SUB_PAGE_MAP.
 * Sub-page slug → parent menu id. If the parent is allowed, the sub-page is too.
 */
export const SUB_PAGE_MAP: Readonly<Record<string, string>> = {
  "learn-course": "learn",
  "learn-phase": "learn",
  onboarding: "learn",
  exam: "learn",
  "weekly-report-form": "weekly-report",
  "batch-file-search": "batch-monitor",
};

/** v1 `known_roles` from the menu-permissions GET payload. */
export const KNOWN_ROLES: readonly string[] = [
  "sm_admin",
  "dev_sm",
  "sm_lead",
  "sm_user",
  "dev_user",
  "external",
] as const;

/** v1 default `always_visible`. */
export const DEFAULT_ALWAYS_VISIBLE: readonly string[] = [
  "profile",
  "change-password",
] as const;

/** v1: api/helpers.php defaultFeatures() — granted to every team, not revocable. */
export const DEFAULT_FEATURES: readonly string[] = [
  "dashboard",
  "board",
  "team-docs",
  "sabai",
  "schedule",
  "learning",
] as const;

export interface FeatureCatalogueEntry {
  label: string;
  /** Lucide icon name available in src/icons — no emoji (feedback_no_emoji_use_svg_icons). */
  icon: string;
  user_pages: readonly string[];
  admin_pages: readonly string[];
}

/**
 * v1: FEATURE_CATALOGUE in assets/pages/admin/super-team-permissions.
 * Page lists are byte-identical to v1; only the icon representation changed
 * (v1 stored raw `<i data-icon>` HTML, v2 stores the icon name).
 */
export const FEATURE_CATALOGUE: Readonly<Record<string, FeatureCatalogueEntry>> = {
  "jira-templates": { label: "Jira Templates", icon: "file", user_pages: ["send-email"], admin_pages: ["templates", "jira-config"] },
  jenkins: { label: "Jenkins", icon: "hammer", user_pages: [], admin_pages: ["jenkins-servers"] },
  "jenkins-build": { label: "Jenkins Build Launcher", icon: "play", user_pages: ["jenkins-build"], admin_pages: ["jenkins-servers"] },
  "jenkins-portal": { label: "Jenkins Portal (Unbind)", icon: "shield", user_pages: ["jenkins-portal"], admin_pages: ["jenkins-portal"] },
  "so-jenkins": { label: "SO Jenkins (CLT RAG)", icon: "git-branch", user_pages: ["so-jenkins"], admin_pages: ["so-jenkins"] },
  "migrate-user": { label: "Migrate User (Rundeck)", icon: "git-branch", user_pages: ["migrate-user"], admin_pages: [] },
  // Batch Monitor is Jenkins-backed: it cannot function without
  // jenkins_servers.json, so 'jenkins-servers' is included here too.
  "batch-monitor": { label: "Batch Monitor", icon: "package", user_pages: ["batch-monitor"], admin_pages: ["batch-monitor", "batch-meta", "batch-monitor-noti", "jenkins-servers"] },
  "alert-monitor": { label: "Alert Monitor", icon: "bell", user_pages: ["alert-monitor"], admin_pages: ["alert-monitor-config"] },
  analytics: { label: "Analytics", icon: "trending-up", user_pages: ["analytics"], admin_pages: ["analytics"] },
  "ma-services": { label: "MA Services", icon: "hammer", user_pages: ["ma-services"], admin_pages: ["ma-config"] },
  syncup: { label: "Sync Up", icon: "refresh", user_pages: ["syncup"], admin_pages: ["syncup-config"] },
  "weekly-report": { label: "Weekly Report", icon: "pencil", user_pages: ["weekly-report"], admin_pages: ["weekly-report"] },
  monitoring: { label: "Monitoring", icon: "gauge", user_pages: ["monitoring"], admin_pages: ["system-monitor"] },
  "sms-gateway": { label: "SMS Gateway", icon: "message", user_pages: ["sms-gateway-switches"], admin_pages: ["sms-gateway-config"] },
  sheets: { label: "Sheets Embed", icon: "layers", user_pages: ["sheets"], admin_pages: ["sheets"] },
  inbox: { label: "Team Inbox", icon: "mail", user_pages: ["inbox"], admin_pages: ["fh-config"] },
  notifications: { label: "Notifications", icon: "bell", user_pages: [], admin_pages: ["scheduled-noti", "email-noti"] },
  onboarding: { label: "Onboarding", icon: "flag", user_pages: ["onboarding"], admin_pages: ["onboarding"] },
  uptime: { label: "Uptime Monitor", icon: "clock", user_pages: ["uptime"], admin_pages: [] },
  links: { label: "Quick Links", icon: "link", user_pages: [], admin_pages: ["links"] },
  "test-service": { label: "Service Test", icon: "activity", user_pages: ["test-service"], admin_pages: ["test-service"] },
  achievements: { label: "Achievements", icon: "star", user_pages: [], admin_pages: ["achievements"] },
  "restart-monitor": { label: "Restart Monitor", icon: "refresh", user_pages: ["restart-monitor"], admin_pages: [] },
  "service-severity": { label: "Service Severity", icon: "alert-triangle", user_pages: [], admin_pages: ["service-severity"] },
  // View-only shares of SM-shared JSON — Copy-from-SM is a no-op for these keys.
  "batch-file-search": { label: "Batch File Lookup", icon: "search", user_pages: ["batch-file-search"], admin_pages: [] },
  "grafana-alerts": { label: "Paused Alerts", icon: "bell", user_pages: ["grafana-alerts"], admin_pages: [] },
  "jira-templates-shared": { label: "Jira Templates (View)", icon: "file", user_pages: ["jira-templates"], admin_pages: [] },
  "pw-schedule": { label: "PW Schedule (View)", icon: "calendar", user_pages: ["pw-schedule"], admin_pages: [] },
};

export interface PageModeEntry {
  id: string;
  label: string;
  icon: string;
  feature: string;
}

/** v1: PAGE_MODES — pages that support full vs read-only access mode. */
export const PAGE_MODES: readonly PageModeEntry[] = [
  { id: "ma-services", label: "MA Services", icon: "hammer", feature: "ma-services" },
  { id: "board", label: "Web Board", icon: "message", feature: "board" },
  { id: "templates", label: "Jira Templates", icon: "file", feature: "jira-templates" },
  { id: "knowledge-base", label: "Knowledge Base", icon: "book", feature: "team-docs" },
  { id: "ops-runbook", label: "Ops Runbook", icon: "book", feature: "team-docs" },
  { id: "schedule", label: "Shift Schedule", icon: "calendar", feature: "schedule" },
  { id: "syncup", label: "Sync Up", icon: "refresh", feature: "syncup" },
  { id: "batch-monitor", label: "Batch Monitor", icon: "package", feature: "batch-monitor" },
  { id: "analytics", label: "Analytics", icon: "trending-up", feature: "analytics" },
  { id: "announcements", label: "Announcements", icon: "bell", feature: "board" },
] as const;

export interface NavGroupConfig {
  id: string;
  label: string;
  icon: string;
  items: string[];
}

/** v1: api/nav-groups/index.php `$defaultGroups` — used when the team has no file. */
export const DEFAULT_NAV_GROUPS: readonly NavGroupConfig[] = [
  { id: "home", label: "Home", icon: "dashboard", items: ["dashboard", "my-team", "about-som", "schedule", "pw-schedule", "sheets", "sabai", "onboarding"] },
  { id: "monitor", label: "Monitor", icon: "monitor", items: ["service-performance", "restart-monitor", "restart-analyzer", "log-explorer", "alert-monitor", "monitoring", "uptime", "grafana-alerts", "begin-grafana", "syncup"] },
  { id: "ma", label: "MA Tools", icon: "wrench", items: ["ma-services", "ma-test"] },
  { id: "ops", label: "Operations", icon: "board", items: ["board", "send-email", "jira-templates", "case-incidents", "inbox", "batch-monitor", "batch-file-search", "jenkins-build", "jenkins-portal", "so-jenkins", "migrate-user", "sms-gateway-switches", "test-service", "analytics", "weekly-report", "report-center"] },
  { id: "learn", label: "Learn", icon: "book-open", items: ["learn", "learn-reports", "exam-reports"] },
  { id: "genz", label: "GenZ", icon: "sparkles", items: ["genz-hub", "genz-notes"] },
  { id: "admin", label: "Admin", icon: "settings", items: ["admin", "genz-team", "nav-groups", "devtools", "dev-system", "dev-api", "dev-logs", "dev-email", "dev-data"] },
] as const;

/** Mirrors the v1 sanitiser in api/nav-groups/index.php POST. */
export function sanitiseSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/** Mirrors v1 `substr(trim($g['label']), 0, 32)`. */
export function sanitiseGroupLabel(s: string): string {
  return s.trim().slice(0, 32);
}
