<?php
// ─── Menu Permissions — Role × Menu access matrix ────────────────────────────
// GET  → return the raw config (admin only)
// PUT  → replace the full config (admin only)
// GET ?resolve=1 → return the CURRENT USER's resolved menu list (any role)
//                  Used by layout.js to filter the sidebar. Shape:
//                    { allowed: [ids], mode: 'wildcard'|'explicit', role }
require_once __DIR__ . '/../helpers.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ── The canonical menu id list. Kept in sync with layout.js coreNavItems. ────
// (We accept unknown IDs too — admin UI may show them for older/newer builds.)
const CORE_MENUS = [
    'dashboard', 'my-team', 'board', 'sheets', 'sabai', 'schedule', 'pw-schedule',
    'ma-services', 'ma-test',
    'learn', 'weekly-report', 'report-center', 'analytics', 'send-email', 'inbox', 'admin',
    'restart-monitor', 'service-performance', 'restart-analyzer', 'log-explorer', 'alert-monitor', 'grafana-alerts',
    'about-som',
    // Requestable feature pages (added as features are unlocked)
    'batch-monitor', 'batch-file-search',
    // Jenkins Build Launcher — 'jenkins-build' = submit/trigger, 'jenkins-build-approve'
    // = checker permission (approve/reject pending submissions).
    'jenkins-build', 'jenkins-build-approve',
    // Jenkins Portal (Unbind Trigger) — single wealth-style page (trigger + logs + admin panels)
    'jenkins-portal',
    // SO Jenkins (CLT RAG pipeline) — single wealth-style page (trigger + history + logs + admin)
    'so-jenkins',
    'monitoring', 'monitoring-wall', 'syncup', 'uptime', 'test-service', 'onboarding',
    'sms-gateway-switches',
    // View-only sidebar entries for SM-shared config libraries
    'jira-templates',
    // Oversight (super_viewer / super_admin) — cross-team read-only reports
    'learn-reports', 'exam-reports',
    // Dev tools
    'devtools', 'dev-system', 'dev-api', 'dev-logs', 'dev-email', 'dev-data',
    // GenZ Team (SM-only) — perk hub for is_genz users, plus admin toggle page + case notes runbook
    'genz-hub', 'genz-team', 'genz-notes',
    // Automation group (SM-only)
    'incident-launcher',
    'incident-launcher-config',
    'migrate-user',
    // Case Incidents (SM-only)
    'case-incidents',
];

// Sub-pages served by top-level menus. Slug → parent-menu id.
// If the parent is in `allowed`, the sub-page is allowed too.
// Kept here so the guard in layout.js can reuse the same map (via resolve).
const SUB_PAGE_MAP = [
    'learn-course'       => 'learn',
    'learn-phase'        => 'learn',
    'onboarding'         => 'learn',
    'exam'               => 'learn',
    'weekly-report-form' => 'weekly-report',
    // File → Job Lookup lives beside Batch Monitor: if a role can see the
    // batch-monitor parent, they can also open the file-search sub-page.
    'batch-file-search'  => 'batch-monitor',
];

// Sidebar-tools' internal page slugs (from `data/sidebar_tools.json`) merge
// into KNOWN_MENUS so the admin matrix can toggle them and wildcard '*' resolves
// to include them. Extracted from `path` (not `page_id`, which can differ).
function sidebarToolMenus(): array {
    $tools = readJson('sidebar_tools.json');
    if (!is_array($tools)) return [];
    $out = [];
    foreach ($tools as $t) {
        if (($t['link_type'] ?? '') !== 'internal') continue;
        $path = $t['path'] ?? '';
        if (!$path) continue;
        $slug = preg_replace('/\.html.*$/', '', basename($path));
        if ($slug !== '') $out[] = $slug;
    }
    return array_values(array_unique($out));
}

function knownMenus(): array {
    return array_values(array_unique(array_merge(CORE_MENUS, sidebarToolMenus())));
}

// ── Resolve current user's allowed menus (all roles, no auth escalation) ─────
if ($method === 'GET' && isset($_GET['resolve'])) {
    $known = knownMenus();
    $r = resolveUserMenus($user['sub'] ?? '', $user['role'] ?? 'sm_user', $known);
    respondOk([
        'allowed'     => $r['allowed'],
        'mode'        => $r['mode'],
        'role'        => $user['role'] ?? 'sm_user',
        'known_menus' => $known,
        'sub_pages'   => SUB_PAGE_MAP,
    ]);
}

// ── Everything below is admin-only ───────────────────────────────────────────
requireRole($user, ADMIN_ROLES);

if ($method === 'GET') {
    $cfg = readJson('menu-permissions.json');
    if (empty($cfg)) $cfg = [
        'version'         => 1,
        'roles'           => [ 'sm_admin'=>'*','dev_sm'=>'*','sm_lead'=>'*','sm_user'=>'*','dev_user'=>['service-performance','restart-monitor'],'external'=>['dashboard','board'] ],
        'always_visible'  => ['profile', 'change-password'],
        'updated_at'      => 0,
    ];
    respondOk([
        'config'      => $cfg,
        'known_menus' => knownMenus(),
        'known_roles' => ['sm_admin','dev_sm','sm_lead','sm_user','dev_user','external'],
        'sub_pages'   => SUB_PAGE_MAP,
    ]);
}

if ($method === 'PUT' || $method === 'PATCH') {
    $body = getBody();
    if (!isset($body['roles']) || !is_array($body['roles'])) {
        respondError('Invalid config: roles map required', 400);
    }
    // Sanitise each role: '*' or array-of-strings
    $roles = [];
    foreach ($body['roles'] as $role => $val) {
        if ($val === '*' || $val === true) {
            $roles[$role] = '*';
        } elseif (is_array($val)) {
            $roles[$role] = array_values(array_unique(array_map('strval', $val)));
        } else {
            $roles[$role] = [];
        }
    }
    $always = $body['always_visible'] ?? ['profile', 'change-password'];
    if (!is_array($always)) $always = ['profile', 'change-password'];

    $next = [
        'version'        => 1,
        'roles'          => $roles,
        'always_visible' => array_values($always),
        'updated_at'     => time(),
    ];
    writeJson('menu-permissions.json', $next);
    logActivity('menu_permissions_update', [
        'roles' => array_keys($roles)
    ], $user['sub'] ?? null, $user['name'] ?? null);
    respondOk($next, 'Menu permissions saved');
}

respondError('Method not allowed', 405);
