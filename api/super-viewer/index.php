<?php
/**
 * Super Viewer — admin control-panel data endpoint (super_admin only).
 *
 * GET /api/super-viewer/  → one-shot payload for admin/super-viewer.html:
 *   {
 *     stats:  { total_users, last_created_at, blocked_events_24h, denied_events_24h },
 *     users:  [ { id, name, username, email, created_at, ... } ],
 *     audit:  [ { ts, event, user_name, path, detail } ]  // last 100 super_viewer events
 *     rules:  { sidebar_hidden, pages_bounced, api_denied, writes_whitelisted }
 *   }
 *
 * Design: everything a super_admin needs to understand + manage the super_viewer
 * role from one page. User CRUD still happens via /api/users/ (this endpoint is
 * read-only intelligence).
 */
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ['super_admin']);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respondError('Method not allowed — this endpoint is read-only', 405);
}

// ── Super viewer users ────────────────────────────────────────────────────────
$allUsers = readJson('users.json');
$viewers  = array_values(array_filter($allUsers, fn($u) => ($u['role'] ?? '') === 'super_viewer'));
$viewers  = array_map(fn($u) => [
    'id'                   => $u['id'],
    'name'                 => $u['name'] ?? '',
    'nickname'             => $u['nickname'] ?? '',
    'username'             => $u['username'] ?? '',
    'email'                => $u['email'] ?? '',
    'created_at'           => $u['created_at'] ?? '',
    'created_by'           => $u['created_by'] ?? '',
    'password_changed_at'  => $u['password_changed_at'] ?? '',
    'first_login'          => (bool)($u['first_login'] ?? false),
    'must_reset_password'  => (bool)($u['must_reset_password'] ?? false),
    'avatar_url'           => $u['avatar_url'] ?? null,
], $viewers);

// Newest first
usort($viewers, fn($a, $b) => strcmp($b['created_at'], $a['created_at']));

// ── Audit events (security.json) ─────────────────────────────────────────────
$logPath = LOG_DIR . 'security.json';
$audit   = [];
$blocked24 = 0;
$denied24  = 0;
if (file_exists($logPath)) {
    $raw = json_decode(file_get_contents($logPath), true) ?: [];
    $svEvents = ['super_viewer_write_blocked', 'super_viewer_access_denied'];
    $cutoff24 = time() - 86400;
    foreach ($raw as $e) {
        if (!in_array($e['event'] ?? '', $svEvents, true)) continue;
        $audit[] = [
            'id'        => $e['id']        ?? '',
            'ts'        => $e['ts']        ?? '',
            'event'     => $e['event']     ?? '',
            'user_id'   => $e['user_id']   ?? '',
            'user_name' => $e['user_name'] ?? '',
            'ip'        => $e['ip']        ?? '',
            'path'      => $e['path']      ?? '',
            'detail'    => $e['detail']    ?? [],
        ];
        $t = strtotime($e['ts'] ?? '');
        if ($t !== false && $t >= $cutoff24) {
            if ($e['event'] === 'super_viewer_write_blocked') $blocked24++;
            elseif ($e['event'] === 'super_viewer_access_denied') $denied24++;
        }
    }
    // Newest first, cap at 100
    usort($audit, fn($a, $b) => strcmp($b['ts'], $a['ts']));
    $audit = array_slice($audit, 0, 100);
}

// ── Rules reference (single source of truth for admin UI) ────────────────────
// Reflects what's actually hardcoded across the codebase. When behavior changes
// (new denied endpoint, new whitelist etc.) update BOTH the code and this list.
$rules = [
    'sidebar_hidden' => [
        // From assets/js/layout.js coreNavItems denyRoles.
        ['id' => 'inbox',             'label' => 'Team Inbox',        'reason' => 'Team mail is sensitive personal content'],
        ['id' => 'batch-monitor',     'label' => 'Batch Monitor',     'reason' => 'Team ops surface (writes to Jenkins/notifications)'],
        ['id' => 'batch-file-search', 'label' => 'File → Job Lookup', 'reason' => 'SM-only team-scoped ops'],
        ['id' => 'monitoring',        'label' => 'Monitoring',        'reason' => 'Team ops surface'],
        ['id' => 'syncup',            'label' => 'Sync Up',           'reason' => 'Team-daily-ritual page (writes)'],
        ['id' => 'uptime',            'label' => 'Uptime Monitor',    'reason' => 'Team ops surface'],
        ['id' => 'test-service',      'label' => 'Service Test',      'reason' => 'Team ops surface'],
    ],
    'pages_bounced' => [
        // Direct-URL access redirected to a safe page.
        ['path' => 'inbox.html',              'redirect_to' => 'dashboard.html',       'reason' => 'Full inbox block'],
        ['path' => 'weekly-report-form.html', 'redirect_to' => 'weekly-report.html',   'reason' => 'Data-entry form (writes)'],
    ],
    'api_denied' => [
        // Endpoints that 403 super_viewer even on GET.
        ['prefix' => '/api/inbox/', 'reason' => 'Team mail data'],
    ],
    'writes_whitelisted' => [
        // Endpoints super_viewer can write to (own state only).
        ['path' => '/api/auth/logout.php',          'reason' => 'End own session'],
        ['path' => '/api/auth/change-password.php', 'reason' => 'Change own password'],
        ['path' => '/api/auth/profile.php',         'reason' => 'Update own profile (PATCH)'],
        ['path' => '/api/presence/heartbeat.php',   'reason' => 'Keep own session alive'],
        ['path' => '/api/analytics/track.php',      'reason' => 'Pure telemetry event'],
        ['path' => '/api/log/client-error.php',     'reason' => 'JS error reporting'],
        ['path' => '/api/ai/index.php',             'reason' => 'LLM query (POST-shaped read)'],
    ],
    'special_behavior' => [
        ['name' => 'Cross-team course merge', 'where' => 'learn.html + /api/courses/courses.php',
         'desc' => 'In "All Teams" view, published courses from every team are merged with a team badge.'],
        ['name' => 'Read-only page mode',     'where' => 'Every page via Layout.render()',
         'desc' => 'body[data-page-mode="read"] is always set; hides [data-action="add|edit|delete|write"] via CSS.'],
        ['name' => 'View-as team switcher',   'where' => 'Topbar bar on every non-admin page',
         'desc' => 'Same segmented switch as super_admin (All Teams / SM / SS / TS / ...).'],
    ],
    'read_only_reports' => [
        // Dedicated user-facing pages (NOT under /admin/) that super_viewer can
        // reach via the OVERSIGHT sidebar section. Backed by GET-only calls to
        // ADMIN_ROLES endpoints extended with REPORT_READ_ROLES.
        ['id'   => 'learn-reports',
         'path' => '/learn-reports.html',
         'apis' => '/api/courses/progress.php (GET), /api/courses/courses.php (GET)',
         'reason' => 'Cross-team course progress oversight (no reset/delete)'],
        ['id'   => 'exam-reports',
         'path' => '/exam-reports.html',
         'apis' => '/api/exams/exams.php (GET), /api/exams/report.php (GET)',
         'reason' => 'Cross-team exam pass-rate + leaderboard oversight (no reminder/attempt mgmt)'],
    ],
];

respondOk([
    'stats' => [
        'total_users'        => count($viewers),
        'last_created_at'    => $viewers[0]['created_at'] ?? null,
        'blocked_events_24h' => $blocked24,
        'denied_events_24h'  => $denied24,
        'audit_total'        => count($audit),
    ],
    'users' => $viewers,
    'audit' => $audit,
    'rules' => $rules,
]);
