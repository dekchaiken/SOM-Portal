<?php
require_once __DIR__ . '/config.php';

// ─── Timezone Setting ─────────────────────────────────────────────────────────
date_default_timezone_set('Asia/Bangkok');

// ─── Security Headers (set on every response) ─────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Cache-Control: no-store, no-cache, must-revalidate');

// ─── Fatal-error safety net: ensure clients always get JSON, never empty body ──
// Without this, a PHP fatal (E_ERROR, max_execution_time, OOM) closes the
// response with no payload and the browser shows "Unexpected end of JSON input".
// Also mirrors the fatal into security.json so super_admin has a server-side
// audit trail even when the client can't POST to /log/client-error.php
// (browser closed, token expired, cron with no browser at all).
register_shutdown_function(function () {
    $err = error_get_last();
    if (!$err) return;
    if (!in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) return;
    // Try to log — never let the logger itself derail the fatal response
    try {
        if (function_exists('logSecurity')) {
            logSecurity('fatal_error', [
                'message' => $err['message'],
                'file'    => basename($err['file']),
                'line'    => $err['line'],
                'type'    => $err['type'],
            ]);
        }
    } catch (\Throwable $_) { /* swallow — response first */ }
    if (headers_sent()) return;
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => 'Fatal: ' . $err['message'] . ' (' . basename($err['file']) . ':' . $err['line'] . ')',
    ], JSON_UNESCAPED_UNICODE);
});

// ─── Uncaught exception handler ────────────────────────────────────────────
// Anything that bubbles up without a catch — log it then return a JSON 500.
// Without this the response is empty (PHP prints a stack trace only if
// display_errors is on, which prod normally turns off).
set_exception_handler(function (\Throwable $ex) {
    try {
        if (function_exists('logSecurity')) {
            logSecurity('uncaught_exception', [
                'class'   => get_class($ex),
                'message' => $ex->getMessage(),
                'file'    => basename($ex->getFile()),
                'line'    => $ex->getLine(),
                // First 8 stack frames are usually enough to locate the bug
                'trace'   => array_slice(explode("\n", $ex->getTraceAsString()), 0, 8),
            ]);
        }
    } catch (\Throwable $_) { /* swallow */ }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'message' => 'Server error: ' . $ex->getMessage(),
        ], JSON_UNESCAPED_UNICODE);
    }
});

// ─── Role Constants ───────────────────────────────────────────────────────────
define('SUPER_ADMIN_ROLE', 'super_admin');
define('ADMIN_ROLES',      ['super_admin', 'sm_admin', 'dev_sm']);
define('LEAD_ROLES',       ['super_admin', 'sm_admin', 'dev_sm', 'sm_lead']);
define('ALL_STAFF_ROLES',  ['super_admin', 'super_viewer', 'sm_admin', 'dev_sm', 'sm_lead', 'sm_user', 'dev_user', 'external']);
// Roles that can view any team globally (via X-Admin-Team header) but not
// necessarily write. super_viewer is a read-only oversight role: sees every
// menu, can view-as any team like super_admin, cannot mutate anything, and
// cannot enter /admin/*. Intentionally NOT in ADMIN_ROLES / LEAD_ROLES so
// existing requireRole() calls deny write by default (defense-in-depth).
define('GLOBAL_READ_ROLES', ['super_admin', 'super_viewer']);
// Roles allowed to READ course/exam progress reports across teams. Extends
// ADMIN_ROLES with super_viewer so oversight can view team learning metrics
// without granting mutation rights. WRITE branches (DELETE progress, etc.)
// must still gate on ADMIN_ROLES — super_viewer is blocked by requireAuth().
define('REPORT_READ_ROLES', ['super_admin', 'sm_admin', 'dev_sm', 'super_viewer']);

// ─── Constants ────────────────────────────────────────────────────────────────
define('LOG_DIR',         DATA_DIR . 'logs/');
define('LOG_MAX_ACTIVITY', PHP_INT_MAX); // no cap — keep all entries
define('LOG_MAX_SECURITY', 2000);

// ─── Env Fallback ─────────────────────────────────────────────────────────────
// getenv() reads from process env — populated once at the first config.php
// load per PHP worker. If .env was edited after the worker started (or the
// worker was spawned before secrets landed), getenv() returns empty and any
// constant defined from it (e.g. JIRA_EMAIL) stays empty for the whole
// request. envFallback() re-parses .env directly as a safety net; the result
// is cached in a static for the rest of the request so multiple lookups don't
// re-read the file. Constants defined via define() at config-load time can't
// be refreshed after the fact, so callers should prefer envFallback('X') over
// the raw constant when the value must reflect *current* .env state.
function envFallback(string $key): string {
    $v = getenv($key);
    if ($v !== false && $v !== '') return $v;
    static $envFile = null;
    if ($envFile === null) {
        $envFile = [];
        $path = __DIR__ . '/../.env';
        if (is_readable($path)) {
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $ln) {
                $ln = trim($ln);
                if ($ln === '' || $ln[0] === '#' || !str_contains($ln, '=')) continue;
                [$k, $val] = explode('=', $ln, 2);
                $envFile[trim($k)] = trim($val);
            }
        }
    }
    return $envFile[$key] ?? '';
}

// Jira credential helpers — always resolve to the current .env values so a
// worker started before secrets were configured doesn't get stuck with empty
// credentials for its entire lifetime.
function jiraEmail(): string { return JIRA_EMAIL ?: envFallback('JIRA_EMAIL'); }
function jiraToken(): string { return JIRA_TOKEN ?: envFallback('JIRA_TOKEN'); }
function jiraCredsReady(): bool { return jiraEmail() !== '' && jiraToken() !== ''; }
function jiraAuthHeader(): string { return 'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()); }

// ─── Multi-Team Path Helpers ──────────────────────────────────────────────────

// Files that always live at DATA_DIR root regardless of team context.
// Rate-limit, auth, and system files are global — never scoped to a team.
// n8n webhook configs are global because a single n8n workflow serves the
// whole company (external on-call schedule, service-severity sheet sync) —
// every team's dashboard reads from the same URL, so per-team storage would
// force super_admin to re-configure identical URLs for every new team.
// (Per-team caches — n8n_oncall_cache.json, n8n_severity_last_sync.json —
//  stay team-scoped by design; they're per-team optimisation state.)
function _isGlobalFile(string $file): bool {
    static $globals = [
        'users.json', 'teams.json', 'feature_requests.json',
        'system-settings.json',
        'rate_limit.json', 'api_rate_limit.json', 'forgot_rate_limit.json',
        'password_reset_tokens.json',
        'metrics.json', 'server_metrics.json',
        'n8n_oncall_config.json', 'n8n_severity_config.json',
        // Maintenance affects every team on the platform (Global MA blocks all
        // users at login; page/tool MA hides features for all teams). Only
        // super_admin can edit it, so a single platform-wide file is correct.
        'maintenance.json',
        // Feature Request & Bug Report submissions from every team funnel to
        // super_admin (single platform-wide inbox). Each entry carries a `team`
        // field so super_admin can tell where each report came from.
        'requests.json',
    ];
    return in_array($file, $globals, true);
}

// ─── SM-Shared Files (SM owns data, other teams view read-only) ──────────────
// Some features are curated by the SM team as the source of truth for the whole
// company — e.g. MA Usecases and Cut-off Services runbooks. Other teams need
// to see the same data (for on-call/handover) but must not edit it. For these
// files:
//   • Reads from ANY team transparently route to sm/{file} — new teams get the
//     full dataset for free, no per-team provisioning required.
//   • Writes must be gated by requireSmForShared() at the top of each write
//     endpoint — non-SM teams (including super_admin with view-as) get 403.
//
// Add a file here when a feature should be "SM-managed, everyone-views". Keep
// in sync with NEW-FEATURE-CHECKLIST.md (shared-from-SM pattern). Patterns
// with '*' are matched via fnmatch, so yearly caches match with a single entry.
function smSharedFiles(): array {
    return [
        'ma-services.json',
        'ma-modules.json',
        'ma-types.json',
        'ma-services-log.json',
        'ma-services-jira-stats-*.json',
        'cutoff-services.json',
        // Batch File Index (SM-managed catalog of Jenkins jobs + files they produce).
        // SM runs the crawler/indexer; every team can look up "file X came from which job".
        'jenkins_jobs_catalog.json',
        'batch_file_index.json',
        'batch_file_index_meta.json',
        'batch_file_index_progress.json',
        // Grafana paused-alerts monitor: SM curates the source list, all teams view.
        'grafana-alert-sources.json',
        // Restart Monitor: SM curates runway config, cron fetches into data/sm/
        // grafana-monitoring/{daily,raw}/{slug}/*.json + monthly-recipients.
        // Every team views the same dashboards; sending emails / editing recipients
        // / triggering fetches is SM-only (write endpoints call requireSmForShared).
        'grafana-runways.json',
        'grafana-monitoring/*',
        // Service Performance dashboard: SM curates the source list + sheet URL,
        // all teams view. Cache lives under service-performance/cache/{slug}.json
        // (also SM-shared so a single fetch serves the whole company).
        'service-performance-sources.json',
        'service-performance/*',
        // Service Inventory CSV — SM uploads via admin/service-inventory.html,
        // every team's Service Performance dashboard reads from the same file.
        // Old versions are archived under service-inventory-history/*.
        'service-inventory.csv',
        'service-inventory-history/*',
        // Jira Templates view-share (feature: 'jira-templates-shared'). SM
        // owns the template library + field mappings; other teams get a
        // read-only look at the same JSON. Writes stay SM via requireSmForShared
        // at the admin endpoints — the full 'jira-templates' feature (per-team)
        // never got granted outside SM, so nothing is stranded.
        'templates.json',
        'jira_config.json',
        // PW Schedule view-share (feature: 'pw-schedule'). Same pattern: SM
        // curates the overnight planwork rounds, all teams view the same shift
        // in the sidebar. Write endpoints (POST/PUT/DELETE) call requireSmForShared.
        'pw_schedule.json',
        // Companion config: Teamup calendar key + Google Chat webhook. Non-SM
        // teams need to read the same values so teamup.php / notify preview
        // work; admin edit is SM-only (admin/pw-schedule.html is `team:'sm'`).
        'pw_schedule_config.json',
    ];
}

function _isSmSharedFile(string $file): bool {
    foreach (smSharedFiles() as $pattern) {
        if ($pattern === $file) return true;
        if (strpos($pattern, '*') !== false && fnmatch($pattern, $file)) return true;
    }
    return false;
}

// Resolve the filesystem path for a data file given a team slug.
// Rules:
//   • Global files      → DATA_DIR/{file}          (always, regardless of team)
//   • SM-shared files   → DATA_DIR/sm/{file}       (all teams read the same)
//   • team = null       → DATA_DIR/{file}          (unauthenticated / system calls)
//   • team = any        → DATA_DIR/{team}/{file}   (all teams including sm)
function _teamDataPath(string $file, ?string $team): string {
    if (_isGlobalFile($file)) return DATA_DIR . $file;
    if (_isSmSharedFile($file)) return DATA_DIR . 'sm/' . $file;
    if (!$team) return DATA_DIR . $file;
    return DATA_DIR . rtrim($team, '/') . '/' . $file;
}

// Public helper — resolve a data-file path using the current team context.
// Use this when you need a raw filesystem path (e.g. for flock() dedup logic)
// where readJson/writeJson doesn't fit. Falls back to a caller-provided team.
function teamDataPath(string $file, ?string $team = null): string {
    return _teamDataPath($file, $team ?? ($GLOBALS['_current_team'] ?? null));
}

// ─── Feature → Data Files Map (canonical source of truth) ────────────────────
// Both /api/teams/index.php (_provisionFeatureFiles → create empty files when
// super_admin grants a feature) and /api/teams/copy-config.php ($FEATURE_FILES
// → copy files from SM when super_admin clicks "📥 Copy from SM") derive from
// this single map. Keeping them in sync is the point.
//
// Every feature key in FEATURE_CATALOGUE (admin/super-team-permissions.html)
// and REQUESTABLE_FEATURES (api/feature-requests/index.php) should appear here
// — even features with no config file map to [] to make intent explicit.
//
// Related invariants documented in /Users/warapon.lea/.claude/.../memory/multi_team_arch.md.
// Features every team gets automatically — cannot be requested/revoked.
// Duplicated as `const DEFAULT_FEATURES` in /api/feature-requests/index.php
// only because that file can't be included from CLI (has requireAuth at top).
// This function is the canonical source; the const there is kept in sync manually.
function defaultFeatures(): array {
    return ['dashboard', 'board', 'team-docs', 'sabai', 'schedule', 'learning'];
}

// Create empty JSON files (`[]`) for every file mapped to $featureKey when
// super_admin grants a feature to a team. Idempotent — existing files are
// left as-is. Used by /api/teams/index.php PATCH.
function _provisionFeatureFiles(string $featureKey, string $teamSlug): void {
    $map = featureDataFiles();
    foreach ($map[$featureKey] ?? [] as $file) {
        $path = DATA_DIR . $teamSlug . '/' . $file;
        $dir  = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        if (!file_exists($path)) file_put_contents($path, '[]');
    }
}

// Operational-data files (things users write to via normal use). These are
// distinct from feature-config files, which come from featureDataFiles().
// Used by initTeamDirectory() and the backfill migration.
function teamOperationalFiles(): array {
    return [
        'board.json',
        'board-comments.json',
        'templates.json',
        'jira_config.json',
        'jenkins_servers.json',
        // Jenkins Build Launcher — config-driven trigger tools + per-team audit trail
        // (build history + maker/checker approval queue). All three are team-scoped.
        'jenkins-build-tools.json',
        'jenkins-build-history.json',
        'jenkins-build-approvals.json',
        // Jenkins Portal (Unbind Trigger) — team-scoped applications, history,
        // sessions + build logs migrated from the standalone jenkins-portal app.
        'jenkins-portal-tools.json',
        'jenkins-portal-apps.json',
        'jenkins-portal-history.json',
        'jenkins-portal-sessions.json',
        'jenkins-portal-logs.json',
        // SO Jenkins (CLT RAG pipeline) — builds, activity logs + build-user
        // mapping migrated from the standalone so-jenkins app.
        'so-jenkins-tools.json',
        'so-jenkins-builds.json',
        'so-jenkins-logs.json',
        'so-jenkins-build-users.json',
        'links.json',
        'sheets.json',
        'sidebar_tools.json',
        'service_types.json',
        'service-severity.json',
        'notifications.json',
        'scheduled-noti.json',
        'noti-chat-log.json',
        'announcements.json',
        'presence.json',
        'stars.json',
        'team-config.json',
        'mail_config.json',
        'mail_logs.json',
        'user-colors.json',
    ];
}

// Scaffold a team's data directory. Idempotent — safe to re-run on existing
// teams to backfill missing files (never overwrites what's there).
// Creates: operational-data files + default-feature config files + logs dir +
// default menu-permissions (only if not already present).
function initTeamDirectory(string $slug): void {
    // Operational files
    foreach (teamOperationalFiles() as $file) {
        $path = DATA_DIR . $slug . '/' . $file;
        $dir  = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        if (!file_exists($path)) {
            file_put_contents($path, json_encode([], JSON_PRETTY_PRINT));
        }
    }
    // Default-feature config files (schedule.json, holiday-plans.json,
    // board_categories.json, ops_runbook.json, knowledge-base.json etc.)
    foreach (defaultFeatures() as $feature) {
        _provisionFeatureFiles($feature, $slug);
    }
    // Logs directory
    $logsDir = DATA_DIR . $slug . '/logs/';
    if (!is_dir($logsDir)) @mkdir($logsDir, 0755, true);
    foreach (['activity.json', 'security.json'] as $logFile) {
        $p = $logsDir . $logFile;
        if (!file_exists($p)) file_put_contents($p, '[]');
    }
    // Default menu-permissions — create only if missing (don't clobber
    // super-admin's grants)
    $mp = DATA_DIR . $slug . '/menu-permissions.json';
    if (!file_exists($mp)) {
        $prevTeam = $GLOBALS['_current_team'] ?? null;
        $GLOBALS['_current_team'] = $slug;
        writeJson('menu-permissions.json', [
            'roles' => [
                'sm_admin' => '*',
                'sm_lead'  => '*',
                'sm_user'  => '*',
                'dev_user' => [],
                'external' => [],
            ],
            'always_visible' => ['profile', 'change-password'],
        ]);
        $GLOBALS['_current_team'] = $prevTeam;
    }
}

function featureDataFiles(): array {
    static $map = null;
    if ($map !== null) return $map;
    $map = [
        // ── Requestable features (mirror REQUESTABLE_FEATURES in feature-requests) ─
        'jira-templates'   => ['templates.json', 'jira_config.json'],
        'jenkins'          => ['jenkins_servers.json'],
        // Jenkins Build Launcher — config-driven build pages (form + maker/checker
        // approval) for teams & external users. The tool definitions reference
        // server ids from jenkins_servers.json (seeded by the 'jenkins' feature or
        // via Copy-from-SM), so both files are provisioned together.
        'jenkins-build'    => [
            'jenkins-build-tools.json',
            'jenkins-build-history.json',
            'jenkins-build-approvals.json',
            'jenkins_servers.json',
        ],
        // Jenkins Portal (Unbind Trigger) — applications list, build history,
        // sessions + build logs (migrated from the standalone jenkins-portal
        // app). Config files live in data/{team}/ and are team-scoped.
        'jenkins-portal'   => [
            'jenkins-portal-tools.json',
            'jenkins-portal-apps.json',
            'jenkins-portal-history.json',
            'jenkins-portal-sessions.json',
            'jenkins-portal-logs.json',
            'jenkins_servers.json',
        ],
        // SO Jenkins (CLT RAG pipeline) — one no-parameter trigger tool, build
        // history + activity logs migrated from the standalone so-jenkins app.
        'so-jenkins'       => [
            'so-jenkins-tools.json',
            'so-jenkins-builds.json',
            'so-jenkins-logs.json',
            'so-jenkins-build-users.json',
            'jenkins_servers.json',
        ],
        'batch-monitor'    => [
            'batch_meta.json',
            'batch-monitor-noti-config.json',
            'batch-monitor-noti-log.json',
            'batch-monitor-noti-state.json',
            // batch-records-YYYY-MM.json are dynamic per-month, created on write
            // Jenkins credentials — batch-monitor is Jenkins-backed and unusable
            // without them, so Copy-from-SM must seed this too. Kept in the
            // 'jenkins' feature list as well for teams that enable Jenkins alone.
            'jenkins_servers.json',
        ],
        'alert-monitor'    => ['alert-monitor-config.json', 'alert-monitor-state.json'],
        'analytics'        => ['analytics_events.json'],
        'ma-services'      => ['ma-modules.json', 'ma-services.json', 'ma-types.json', 'weekly-report-jira.json'],
        'syncup'           => ['syncup.json', 'syncup-config.json'],
        'sms-gateway'      => ['sms_gateway_tmn.json', 'sms_gateway_nano.json', 'sms_gateway_welth.json'],
        'sheets'           => ['sheets.json'],
        'notifications'    => ['scheduled-noti.json', 'notifications.json'],
        'uptime'           => ['uptime_config.json', 'uptime_monitors.json'],
        'links'            => ['links.json'],
        'test-service'     => ['test-service-config.json'],
        'service-severity' => ['service-severity.json'],
        'weekly-report'    => ['weekly-report-jira.json'],
        'monitoring'       => [],  // Grafana embed only — no data file
        'inbox'            => ['fh_email_config.json'],
        'onboarding'       => [],  // Data under onboarding/ subdir, auto-created on first write
        'achievements'     => [],  // Aggregates from courses/exams/onboarding — no own file
        // grafana-runways.json is SM-shared (see smSharedFiles) — do NOT list here
        // or _provisionFeatureFiles would create an empty per-team file that never
        // gets read anyway. Only restart-monitor-webhooks.json remains per-team.
        'restart-monitor'  => ['restart-monitor-webhooks.json'],
        // View-only shares of SM-shared data. Every data file these pages read
        // (batch_file_index.json, jenkins_jobs_catalog.json, grafana-alert-sources.json,
        // grafana-monitoring/*) is already in smSharedFiles(), so per-team files
        // are neither needed nor useful — Copy-from-SM is a no-op here.
        'batch-file-search'=> [],
        'grafana-alerts'   => [],
        // Same "view-only share of SM-shared data" pattern — templates.json,
        // jira_config.json, pw_schedule.json are all in smSharedFiles() so
        // per-team files are unnecessary. Copy-from-SM is a no-op for these.
        'jira-templates-shared' => [],
        'pw-schedule'      => [],

        // ── Default features that carry config worth seeding via Copy-from-SM ────
        'team-docs'        => ['knowledge-base.json', 'ops_runbook.json'],  // note: underscore
        'schedule'         => ['schedule.json', 'holiday-plans.json'],
        'board'            => ['board_categories.json', 'board_service_types.json'],
        // Learning = courses + exams. Seeded as empty per-team so each team
        // starts with their own curriculum (no leak of SM's data via fallback).
        // Per-course subfolders (course_*/phases.json etc.) are created on demand
        // when an admin creates a course, so they don't need to be listed here.
        'learning'         => [
            'courses/courses.json',
            'courses/progress.json',
            'exams/exams.json',
            'exams/attempts.json',
        ],

        // ── Cross-cutting (not in FEATURE_CATALOGUE but has copyable config) ─────
        'email-templates'  => ['email_templates.json'],
    ];
    return $map;
}

// ─── JSON Helpers ─────────────────────────────────────────────────────────────
// Team context is automatically sourced from $GLOBALS['_current_team'], which
// requireAuth() injects from the JWT 'team' claim on every authenticated request.
// Global files (users, teams, rate limits, etc.) always bypass team scoping.

function readJson(string $file): array {
    $path = _teamDataPath($file, $GLOBALS['_current_team'] ?? null);
    if (!file_exists($path)) return [];
    $raw = file_get_contents($path);
    if ($raw === '' || $raw === false) return [];
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        // Surface parse failures instead of returning an empty array silently —
        // silent [] previously masked truncated writes (see batch-records-2026-05
        // incident 2026-07-16). Callers still get [] so the page renders, but
        // ops now sees the corruption in error logs.
        error_log(sprintf(
            '[readJson] parse failed for %s: %s (size=%d)',
            $path, json_last_error_msg(), strlen($raw)
        ));
        return [];
    }
    return $decoded;
}

function writeJson(string $file, array $data): bool {
    $path = _teamDataPath($file, $GLOBALS['_current_team'] ?? null);
    // Auto-create directory for new teams (e.g. data/ss/, data/ts/logs/)
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = fopen($path, 'c+');
    if (!$fp) return false;
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return true;
}

// ─── Response Helpers ─────────────────────────────────────────────────────────
function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function respondError(string $message, int $code = 400): void {
    // Mirror server-side failures (5xx) into security.json so super_admin has
    // a trail even when the client never manages to POST client-error.
    // 4xx codes are client errors (bad request / not found) — no audit needed.
    if ($code >= 500 && function_exists('logSecurity')) {
        try {
            logSecurity('server_error', [
                'code'    => $code,
                'message' => $message,
                'path'    => strtok($_SERVER['REQUEST_URI'] ?? '', '?'),
                'method'  => $_SERVER['REQUEST_METHOD'] ?? '',
            ]);
        } catch (\Throwable $_) { /* swallow — response first */ }
    }
    respond(['success' => false, 'message' => $message], $code);
}

function respondOk($data = null, string $message = 'OK'): void {
    respond(['success' => true, 'message' => $message, 'data' => $data]);
}

// ─── JWT Implementation (HS256, no library) ───────────────────────────────────
function b64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function b64url_decode(string $data): string {
    return base64_decode(strtr($data, '-_', '+/'));
}

function jwt_create(array $payload, int $expiry = 0): string {
    $header = b64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
    $payload['exp'] = time() + ($expiry > 0 ? $expiry : JWT_EXPIRY);
    $payload['iat'] = time();
    $p = b64url_encode(json_encode($payload));
    $sig = b64url_encode(hash_hmac('sha256', "$header.$p", JWT_SECRET, true));
    return "$header.$p.$sig";
}

function jwt_verify(string $token): ?array {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$header, $payload, $sig] = $parts;
    $expected = b64url_encode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
    if (!hash_equals($expected, $sig)) return null;
    $data = json_decode(b64url_decode($payload), true);
    if (!$data || $data['exp'] < time()) return null;
    return $data;
}

// ─── Header helper ────────────────────────────────────────────────────────────
// Robustly read a request header regardless of the SAPI (Apache module, CGI,
// FastCGI, PHP built-in server). On Apache+CGI the Authorization header is
// stripped from getallheaders() unless .htaccess forwards it — falling back
// to $_SERVER makes this survive that misconfiguration.
function getRequestHeader(string $name): string {
    $headers = function_exists('getallheaders') ? (getallheaders() ?: []) : [];
    foreach ($headers as $k => $v) {
        if (strcasecmp($k, $name) === 0) return (string)$v;
    }
    // $_SERVER fallback: HTTP_X_FOO for header "X-Foo"
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$serverKey]))          return (string)$_SERVER[$serverKey];
    // Apache "REDIRECT_" prefix under mod_rewrite forwarding
    if (isset($_SERVER['REDIRECT_' . $serverKey])) return (string)$_SERVER['REDIRECT_' . $serverKey];
    return '';
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────
// $allowExpiredPw=true → skip password-expiry check (use for change-password, logout, me)
// $allowSuperViewerWrite=true → skip the super_viewer read-only auto-block. Only
//   endpoints where a super_viewer legitimately mutates their OWN state pass true
//   (logout, change-password, profile update, presence heartbeat, ai query).
function requireAuth(bool $allowExpiredPw = false, bool $allowSuperViewerWrite = false): array {
    $auth = getRequestHeader('Authorization');
    if (!str_starts_with($auth, 'Bearer ')) {
        logSecurity('auth_no_token', ['path' => strtok($_SERVER['REQUEST_URI'] ?? '', '?')]);
        respondError('Unauthorized', 401);
    }
    $token = substr($auth, 7);
    $payload = jwt_verify($token);
    if (!$payload) {
        logSecurity('token_invalid', ['path' => strtok($_SERVER['REQUEST_URI'] ?? '', '?')]);
        respondError('Token invalid or expired', 401);
    }

    // ── Inject team context so readJson/writeJson resolve the correct data path ──
    $GLOBALS['_current_team'] = $payload['team'] ?? null;

    // ── super_admin / super_viewer: allow team context override via X-Admin-Team
    // header. This lets them "act as" a team without re-logging in. Only honoured
    // for these global-read roles.
    if (in_array($payload['role'] ?? '', GLOBAL_READ_ROLES, true)) {
        $ctxTeam = getRequestHeader('X-Admin-Team');
        if ($ctxTeam && preg_match('/^[a-z0-9_-]+$/', $ctxTeam)) {
            $GLOBALS['_current_team'] = $ctxTeam;
        }
    }

    // ── super_viewer read-only auto-block ────────────────────────────────────
    // Reject any state-changing method by default. Endpoints that are legitimate
    // super_viewer writes (logout, own password, own profile, presence, ai query)
    // opt out by passing $allowSuperViewerWrite=true. Everything else 403s.
    if (!$allowSuperViewerWrite && ($payload['role'] ?? '') === 'super_viewer') {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            logSecurity('super_viewer_write_blocked', [
                'method' => $method,
                'path'   => strtok($_SERVER['REQUEST_URI'] ?? '', '?'),
            ], $payload['sub'] ?? '', $payload['name'] ?? '');
            respondError('super_viewer is a read-only role — this action is not permitted', 403);
        }
    }

    if (!$allowExpiredPw) {
        $users = readJson('users.json');
        foreach ($users as $u) {
            if ($u['id'] !== $payload['sub']) continue;
            if (empty($u['first_login'])) {
                $ch = $u['password_changed_at'] ?? $u['created_at'] ?? date('c');
                if ((time() - strtotime($ch)) / 86400 >= PW_EXPIRY_DAYS) {
                    respond(['success' => false, 'message' => 'Password expired', 'code' => 'PASSWORD_EXPIRED'], 403);
                }
            }
            if (!empty($u['must_reset_password'])) {
                respond(['success' => false, 'message' => 'Password reset required', 'code' => 'MUST_RESET_PASSWORD'], 403);
            }
            break;
        }
    }

    return $payload;
}

// ─── CSRF Middleware ──────────────────────────────────────────────────────────
function requireCsrf(): void {
    // Only check CSRF for state-changing methods
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'])) {
        return;
    }
    
    require_once __DIR__ . '/security/CsrfProtector.php';
    $csrf = new CsrfProtector();
    $csrf->requireValidToken();
}

// ─── Monthly File Helpers ─────────────────────────────────────────────────────

// Returns filename for a monthly record file, e.g. "test-records-2026-06.json"
function monthlyFilename(string $prefix, ?string $month = null): string {
    $m = ($month && preg_match('/^\d{4}-\d{2}$/', $month)) ? $month : date('Y-m');
    return $prefix . '-' . $m . '.json';
}

// Returns sorted list of months (newest first) that have data for a given prefix
function listMonths(string $prefix): array {
    // Resolve team data directory same way as readJson/writeJson
    $team = $GLOBALS['_current_team'] ?? null;
    $dir  = (!$team || $team === 'sm') ? DATA_DIR : DATA_DIR . $team . '/';
    $files = glob($dir . $prefix . '-????-??.json') ?: [];
    $months = [];
    foreach ($files as $f) {
        $base = basename($f, '.json');
        $month = substr($base, strlen($prefix) + 1);
        if (preg_match('/^\d{4}-\d{2}$/', $month)) {
            $months[] = $month;
        }
    }
    rsort($months);
    return $months;
}

// Deny super_viewer entirely from an endpoint (e.g. inbox, personal mail).
// Some data — team members' emails, personal drafts — is too sensitive for
// a global-read oversight role even in read mode. Call this after requireAuth()
// at the top of any endpoint that should be invisible to super_viewer.
function denySuperViewer(array $payload, string $resourceLabel = 'this resource'): void {
    if (($payload['role'] ?? '') === 'super_viewer') {
        logSecurity('super_viewer_access_denied', [
            'resource' => $resourceLabel,
            'path'     => strtok($_SERVER['REQUEST_URI'] ?? '', '?'),
        ], $payload['sub'] ?? '', $payload['name'] ?? '');
        respondError(
            "super_viewer role does not have access to {$resourceLabel}",
            403
        );
    }
}

// Write guard for SM-shared files (see smSharedFiles()). Call this after
// requireAuth() in every endpoint that mutates a shared file. Non-SM teams
// get 403 — including super_admin currently viewing-as a non-SM team; to
// edit, super_admin must clear the view-as context or switch to SM.
function requireSmForShared(): void {
    $team = $GLOBALS['_current_team'] ?? null;
    if ($team && $team !== 'sm') {
        respondError(
            'This resource is managed by the SM team and is view-only for team "' . $team . '"',
            403
        );
    }
}

// Full-lockout guard for SM-only features (no read for other teams either).
// Distinct from requireSmForShared() which allows non-SM to read.
// Use for features that are entirely private to the SM team (e.g. MA Test).
// super_admin viewing-as SM is allowed (team context = 'sm').
function requireSmTeamOnly(string $featureLabel = 'this feature'): void {
    $team = $GLOBALS['_current_team'] ?? null;
    if ($team !== 'sm') {
        respondError(
            "{$featureLabel} is available to the SM team only",
            403
        );
    }
}

function requireRole(array $payload, array $roles): void {
    // super_admin bypasses all role checks — has global access
    if (($payload['role'] ?? '') === 'super_admin') return;

    if (!in_array($payload['role'], $roles)) {
        logSecurity('forbidden', [
            'required_roles' => $roles,
            'user_role'      => $payload['role'],
        ], $payload['sub'], $payload['name'] ?? '');
        respondError('Forbidden: insufficient permissions', 403);
    }
}

// ─── Team-Feature Gate ───────────────────────────────────────────────────────
// Rejects the request unless the caller's team has $featureKey in its features
// array (see teams.json). super_admin always passes. Use at the top of API
// endpoints whose parent page is `feature: '<X>'` gated in layout.js so backend
// enforcement matches the sidebar visibility rule.
//
// Prefer this over hard-coded `team !== 'sm'` checks — those don't respect the
// requestable-feature workflow (feature-requests.html) where super_admin grants
// features to other teams.
function requireTeamFeature(array $payload, string $featureKey): void {
    if (($payload['role'] ?? '') === 'super_admin') return;

    $teamSlug = $GLOBALS['_current_team'] ?? ($payload['team'] ?? null);
    if (!$teamSlug) {
        respondError('Forbidden: no team context', 403);
    }

    $teams = readJson('teams.json');
    foreach ($teams as $t) {
        if (($t['slug'] ?? '') !== $teamSlug) continue;
        $features = $t['features'] ?? [];
        if (in_array($featureKey, $features, true)) return;
        logSecurity('feature_forbidden', [
            'feature' => $featureKey,
            'team'    => $teamSlug,
        ], $payload['sub'], $payload['name'] ?? '');
        respondError("Your team does not have access to this feature ({$featureKey})", 403);
    }
    // Team slug not found in teams.json — treat as unauthorised.
    respondError('Forbidden: unknown team', 403);
}

// ─── All-Teams fallback for global-read roles ────────────────────────────────
// super_admin / super_viewer see every feature, but their default "All Teams"
// context resolves to their home team (superadmin → sm), which may have no
// tools configured for a per-team feature page (e.g. jenkins-build tools only
// exist under data/wealth/). Without an explicit view-as team (X-Admin-Team
// header), fall back to the first team that actually has data for $file so
// "All Teams" shows content instead of an empty "no tools" screen.
function teamContextFallbackForGlobalRole(array $payload, string $file): void {
    if (!in_array($payload['role'] ?? '', GLOBAL_READ_ROLES, true)) return;
    if (getRequestHeader('X-Admin-Team')) return; // explicit view-as team — respect it
    $ctx = $GLOBALS['_current_team'] ?? null;
    if ($ctx && $ctx !== ($payload['team'] ?? null)) return; // already on another team
    // Home-team file exists with data → keep the home team as the context.
    $cur = _teamDataPath($file, $ctx);
    if (file_exists($cur)) {
        $raw = @json_decode((string)file_get_contents($cur), true);
        if (is_array($raw) && count($raw) > 0) return;
    }
    // Fall back to the first team that has data for this file.
    foreach (glob(DATA_DIR . '*/' . $file) ?: [] as $p) {
        $raw = @json_decode((string)@file_get_contents($p), true);
        if (is_array($raw) && count($raw) > 0) {
            $GLOBALS['_current_team'] = basename(dirname($p));
            return;
        }
    }
}

// ─── Extra-page cross-team context switch ────────────────────────────────────
// Allows any user to access a page that belongs to another team's data when an
// admin has granted them per-page cross-team access via the `extra_pages` field
// on their user record.
//
// Call BEFORE requireTeamFeature() so the team-feature check and all readJson()
// calls inside the handler use the source team, not the user's home team.
// If the user has no extra_pages entry for $pageKey this is a no-op.
function applyExtraPageTeam(array $payload, string $pageKey): void {
    // Global roles (super_admin/super_viewer) bypass everything — no action needed.
    if (in_array($payload['role'] ?? '', GLOBAL_READ_ROLES, true)) return;
    // Already switched to a non-home team (e.g. explicit X-Admin-Team) — don't clobber.
    $home = $payload['team'] ?? null;
    $cur  = $GLOBALS['_current_team'] ?? $home;
    if ($cur && $cur !== $home) return;

    foreach (readJson('users.json') as $u) {
        if (($u['id'] ?? '') !== $payload['sub']) continue;
        foreach (($u['extra_pages'] ?? []) as $ep) {
            if (($ep['page'] ?? '') === $pageKey && !empty($ep['source_team'])) {
                $GLOBALS['_current_team'] = $ep['source_team'];
                return;
            }
        }
        break; // found user but no matching extra page
    }
}

// ─── Page Access Mode Middleware ──────────────────────────────────────────────
// Checks whether the current team has 'full' or 'read' mode for a page.
// Call this at the top of write handlers (POST/PUT/PATCH/DELETE) to block
// teams that have the page set to read-only.
// super_admin always has full access.
function requirePageMode(array $payload, string $pageId, string $requiredMode = 'full'): void {
    if (($payload['role'] ?? '') === 'super_admin') return;
    if ($requiredMode !== 'full') return; // 'read' is never a write requirement

    $teamSlug = $GLOBALS['_current_team'] ?? null;
    if (!$teamSlug) return; // no team context = SM (full access)

    $teams = readJson('teams.json'); // global
    foreach ($teams as $t) {
        if (($t['slug'] ?? '') !== $teamSlug) continue;
        $mode = ($t['page_modes'] ?? [])[$pageId] ?? 'full';
        if ($mode === 'read') {
            logSecurity('page_mode_forbidden', [
                'page'     => $pageId,
                'team'     => $teamSlug,
                'mode'     => 'read',
            ], $payload['sub'], $payload['name'] ?? '');
            respondError("This page is read-only for your team", 403);
        }
        return;
    }
}

// True if the caller is an SM-team admin — i.e. either `super_admin` (global,
// bypasses team) or an admin-role user (`sm_admin` / `dev_sm`) whose JWT team
// claim is `sm`. Used to gate cross-team ops features like Coverage / backfill
// that SM owns but shouldn't be exposed to other teams' admins.
function isSmCoverageAdmin(array $payload): bool {
    $role = $payload['role'] ?? '';
    if ($role === 'super_admin') return true;
    if (!in_array($role, ['sm_admin', 'dev_sm'], true)) return false;
    return (($payload['team'] ?? '') === 'sm');
}

// Terminate with 403 unless the caller is an SM-team admin. See
// isSmCoverageAdmin() for the exact rule.
function requireSmCoverageAdmin(array $payload, string $resource = 'this resource'): void {
    if (isSmCoverageAdmin($payload)) return;
    logSecurity('sm_coverage_denied', [
        'resource' => $resource,
        'role'     => $payload['role'] ?? '',
        'team'     => $payload['team'] ?? '',
    ], $payload['sub'] ?? '', $payload['name'] ?? '');
    respondError('เฉพาะ admin ของทีม sm เท่านั้น', 403);
}

// For external users: verify they have the required page permission.
// SM roles bypass this check automatically.
function requirePagePermission(array $payload, string $page): void {
    if ($payload['role'] !== 'external') return; // SM roles always pass
    $users = readJson('users.json');
    foreach ($users as $u) {
        if ($u['id'] === $payload['sub']) {
            if (in_array($page, $u['permissions'] ?? [])) return;
            break;
        }
    }
    logSecurity('forbidden_page', [
        'page'      => $page,
        'user_role' => 'external',
    ], $payload['sub'], $payload['name'] ?? '');
    respondError('Forbidden: no permission for this page', 403);
}

/**
 * Resolve the sidebar menu IDs a specific user is allowed to see.
 *
 * Merge order:
 *   1) role default from menu-permissions.json ("*" = all)
 *   2) user.menu_permissions.grant   (extra menus added)
 *   3) user.menu_permissions.deny    (menus subtracted)
 *   4) always_visible list           (profile, change-password)
 *
 * @param string $userId  Effective user id (from JWT.sub)
 * @param string $role    Effective role
 * @param array  $allMenuIds  Full canonical menu list from coreNavItems (for '*' resolution)
 * @return array{allowed: string[], mode: string}   'wildcard' or 'explicit'
 */
function resolveUserMenus(string $userId, string $role, array $allMenuIds): array {
    $mp = readJson('menu-permissions.json');
    $roleCfg = $mp['roles'][$role] ?? '*';   // safe default
    $always  = $mp['always_visible'] ?? [];

    // 1) Role default
    if ($roleCfg === '*' || (is_string($roleCfg) && $roleCfg === '*')) {
        $allowed = $allMenuIds;
        $mode    = 'wildcard';
    } elseif (is_array($roleCfg)) {
        $allowed = $roleCfg;
        $mode    = 'explicit';
    } else {
        $allowed = $allMenuIds;
        $mode    = 'wildcard';
    }

    // 2/3) Per-user grant/deny override
    if ($userId) {
        foreach (readJson('users.json') as $u) {
            if (($u['id'] ?? '') !== $userId) continue;
            $ovr = $u['menu_permissions'] ?? [];
            if (!empty($ovr['grant']) && is_array($ovr['grant'])) {
                $allowed = array_values(array_unique(array_merge($allowed, $ovr['grant'])));
            }
            if (!empty($ovr['deny']) && is_array($ovr['deny'])) {
                $deny = $ovr['deny'];
                $allowed = array_values(array_filter($allowed, fn($m) => !in_array($m, $deny, true)));
            }
            break;
        }
    }

    // 4) Always-visible
    $allowed = array_values(array_unique(array_merge($allowed, $always)));

    return ['allowed' => $allowed, 'mode' => $mode];
}

// ─── ID Generator ─────────────────────────────────────────────────────────────
function genId(string $prefix = 'id'): string {
    return $prefix . '_' . bin2hex(random_bytes(6));
}

// ─── Body Parser ──────────────────────────────────────────────────────────────
function getBody(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}

// ─── Password helpers ─────────────────────────────────────────────────────────
function hashPassword(string $pw): string {
    return password_hash($pw, PASSWORD_BCRYPT, ['cost' => 10]);
}

function verifyPassword(string $pw, string $hash): bool {
    // Support both PHP bcrypt ($2y$) and Python bcrypt ($2b$)
    $hash = str_replace('$2b$', '$2y$', $hash);
    return password_verify($pw, $hash);
}

// ─── Password Reset Tokens (file-based, 24h default TTL) ─────────────────────
// Tokens live in data/password_reset_tokens.json — see helpers below.
// Used by: admin-triggered reset, account creation, forgot-password flow.

const RESET_TOKEN_FILE = 'password_reset_tokens.json';

function _resetTokenGc(array $store): array {
    $now = time();
    return array_values(array_filter($store, function ($t) use ($now) {
        // Drop tokens expired more than 7 days ago, or already-used > 7 days ago
        $expSec = strtotime($t['expires_at'] ?? '0') ?: 0;
        if ($expSec > 0 && $expSec < $now - 7 * 86400) return false;
        if (!empty($t['used_at']) && (strtotime($t['used_at']) ?: 0) < $now - 7 * 86400) return false;
        return true;
    }));
}

function createResetToken(string $userId, int $ttlHours = 24): array {
    $token = bin2hex(random_bytes(32)); // 64-char URL-safe hex
    $now   = time();
    $entry = [
        'token'      => $token,
        'user_id'    => $userId,
        'created_at' => date('c', $now),
        'expires_at' => date('c', $now + $ttlHours * 3600),
        'used_at'    => null,
    ];
    $store = _resetTokenGc(readJson(RESET_TOKEN_FILE));
    // Invalidate any previous unused tokens for this user (only one active at a time)
    foreach ($store as &$t) {
        if ($t['user_id'] === $userId && empty($t['used_at'])) {
            $t['used_at'] = date('c', $now);
            $t['invalidated_by_new'] = true;
        }
    }
    unset($t);
    $store[] = $entry;
    writeJson(RESET_TOKEN_FILE, $store);
    return $entry;
}

// Returns the user_id if the token is valid (not expired, not used), else null.
// Does NOT mark the token as used — use consumeResetToken() for that.
function verifyResetToken(string $token): ?string {
    if (!$token || !preg_match('/^[a-f0-9]{64}$/', $token)) return null;
    $store = readJson(RESET_TOKEN_FILE);
    $now   = time();
    foreach ($store as $t) {
        if (!hash_equals($t['token'], $token)) continue;
        if (!empty($t['used_at'])) return null;
        $exp = strtotime($t['expires_at'] ?? '0') ?: 0;
        if ($exp <= $now) return null;
        return $t['user_id'];
    }
    return null;
}

// Returns the user_id and marks the token as used (single-use).
// Returns null if invalid/expired/already-used.
function consumeResetToken(string $token): ?string {
    if (!$token || !preg_match('/^[a-f0-9]{64}$/', $token)) return null;
    $store = _resetTokenGc(readJson(RESET_TOKEN_FILE));
    $now   = time();
    $userId = null;
    foreach ($store as &$t) {
        if (!hash_equals($t['token'], $token)) continue;
        if (!empty($t['used_at'])) return null;
        $exp = strtotime($t['expires_at'] ?? '0') ?: 0;
        if ($exp <= $now) return null;
        $t['used_at'] = date('c', $now);
        $userId = $t['user_id'];
        break;
    }
    unset($t);
    if ($userId !== null) writeJson(RESET_TOKEN_FILE, $store);
    return $userId;
}

// ─── Login Rate Limiting (file-based, no Redis required) ─────────────────────
// Tracks failed attempts per username. Limits driven by system settings.

define('RL_MAX_ATTEMPTS',   (int)(SYS_SETTINGS['max_login_attempts'] ?? 5));
define('RL_WINDOW_SECONDS', (int)((SYS_SETTINGS['lockout_minutes']   ?? 15) * 60));
define('RL_BLOCK_SECONDS',  (int)((SYS_SETTINGS['lockout_minutes']   ?? 15) * 60));

function _rlKey(string $username): string {
    return substr(hash('sha256', strtolower(trim($username))), 0, 16);
}

function rl_check(string $username): void {
    $key   = _rlKey($username);
    $store = readJson('rate_limit.json');
    $now   = time();

    // Garbage-collect entries older than 2 windows
    foreach ($store as $k => $v) {
        if (($v['first'] ?? 0) < $now - (RL_WINDOW_SECONDS * 2)) unset($store[$k]);
    }

    $e = $store[$key] ?? null;

    if ($e) {
        // If still blocked
        if (($e['blocked_until'] ?? 0) > $now) {
            $mins = max(1, (int)ceil(($e['blocked_until'] - $now) / 60));
            writeJson('rate_limit.json', $store); // save GC changes
            logSecurity('brute_force_blocked', ['username' => $username, 'attempts' => $e['count'], 'blocked_min' => $mins]);
            respondError("Too many failed login attempts. Please wait {$mins} minute(s) and try again.", 429);
        }
        // If window expired, reset silently
        if ($e['first'] < $now - RL_WINDOW_SECONDS) {
            unset($store[$key]);
        }
    }

    writeJson('rate_limit.json', $store);
}

function rl_fail(string $username): void {
    $key   = _rlKey($username);
    $store = readJson('rate_limit.json');
    $now   = time();

    $e = $store[$key] ?? ['count' => 0, 'first' => $now, 'blocked_until' => 0];

    // Reset window if expired
    if ($e['first'] < $now - RL_WINDOW_SECONDS) {
        $e = ['count' => 0, 'first' => $now, 'blocked_until' => 0];
    }

    $e['count']++;
    if ($e['count'] >= RL_MAX_ATTEMPTS) {
        $e['blocked_until'] = $now + RL_BLOCK_SECONDS;
    }

    $store[$key] = $e;
    writeJson('rate_limit.json', $store);
}

function rl_success(string $username): void {
    $key   = _rlKey($username);
    $store = readJson('rate_limit.json');
    unset($store[$key]);
    writeJson('rate_limit.json', $store);
}

// ─── API Rate Limiting (per-user per-group) ───────────────────────────────────
// Groups: 'board', 'comments', 'upload', 'search', 'stars'
// Limits driven by system settings: api_rate_limit_requests / api_rate_limit_window_seconds

define('API_RL_MAX',    (int)(SYS_SETTINGS['api_rate_limit_requests']       ?? 120));
define('API_RL_WINDOW', (int)(SYS_SETTINGS['api_rate_limit_window_seconds'] ?? 60));

function apiRateLimit(string $userId, string $group): void {
    $key   = substr(hash('sha256', $userId . ':' . $group), 0, 16);
    $store = readJson('api_rate_limit.json');
    $now   = time();

    // Garbage-collect expired entries
    foreach ($store as $k => $v) {
        if (($v['first'] ?? 0) < $now - (API_RL_WINDOW * 2)) unset($store[$k]);
    }

    $e = $store[$key] ?? ['count' => 0, 'first' => $now];

    // Reset window if expired
    if ($e['first'] < $now - API_RL_WINDOW) {
        $e = ['count' => 0, 'first' => $now];
    }

    $e['count']++;
    $store[$key] = $e;
    writeJson('api_rate_limit.json', $store);

    if ($e['count'] > API_RL_MAX) {
        $retry = API_RL_WINDOW - ($now - $e['first']);
        logSecurity('api_rate_limit_exceeded', [
            'group'   => $group,
            'user_id' => $userId,
            'count'   => $e['count'],
            'retry_in'=> max(1, $retry),
        ], $userId);
        header('Retry-After: ' . max(1, $retry));
        respondError('Rate limit exceeded. Please slow down.', 429);
    }
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function _getClientIp(): string {
    foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_FORWARDED_FOR','HTTP_X_REAL_IP','REMOTE_ADDR'] as $key) {
        $v = $_SERVER[$key] ?? '';
        if ($v) return explode(',', $v)[0];
    }
    return '0.0.0.0';
}

function _getShortUA(): string {
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    // Extract browser name only for readability
    if (preg_match('/(Chrome|Firefox|Safari|Edge|OPR|Trident)[\/\s]([\d.]+)/i', $ua, $m)) {
        return $m[1] . '/' . $m[2];
    }
    return mb_substr($ua, 0, 60);
}

function _appendLog(string $file, array $entry, int $maxEntries): void {
    // Per-team log directory: SM team and unauthenticated events use global LOG_DIR.
    // Other teams write to data/{team}/logs/ so each team owns its own audit trail.
    $team   = $GLOBALS['_current_team'] ?? null;
    $logDir = (!$team || $team === 'sm') ? LOG_DIR : DATA_DIR . $team . '/logs/';
    if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
    $path = $logDir . $file;
    $fp   = fopen($path, 'c+');
    if (!$fp) return;
    if (flock($fp, LOCK_EX)) {
        $raw  = stream_get_contents($fp);
        $logs = ($raw && $raw[0] === '[') ? (json_decode($raw, true) ?? []) : [];
        array_unshift($logs, $entry);           // newest first
        if (count($logs) > $maxEntries) {
            $logs = array_slice($logs, 0, $maxEntries);
        }
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode($logs, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

function logActivity(string $action, array $detail = [], ?string $userId = null, ?string $userName = null): void {
    _appendLog('activity.json', [
        'id'        => genId('log'),
        'ts'        => date('c'),
        'action'    => $action,
        'user_id'   => $userId   ?? '',
        'user_name' => $userName ?? '',
        'ip'        => _getClientIp(),
        'ua'        => _getShortUA(),
        'detail'    => $detail,
    ], LOG_MAX_ACTIVITY);
}

function logSecurity(string $event, array $detail = [], ?string $userId = null, ?string $userName = null): void {
    _appendLog('security.json', [
        'id'        => genId('sec'),
        'ts'        => date('c'),
        'event'     => $event,
        'user_id'   => $userId   ?? '',
        'user_name' => $userName ?? '',
        'ip'        => _getClientIp(),
        'ua'        => _getShortUA(),
        'path'      => strtok($_SERVER['REQUEST_URI'] ?? '', '?'),
        'detail'    => $detail,
    ], LOG_MAX_SECURITY);
}

/**
 * Log a failed third-party integration call (Jenkins, Jira, SMTP, Grafana,
 * webhook, etc). Use in the catch/failure branch of any outbound call:
 *
 *   $res = curl_exec($ch);
 *   if ($err = curl_error($ch)) {
 *       logIntegrationError('jenkins', $url, $err, ['http_code' => $code]);
 *   }
 *
 * Ends up in security.json as event 'integration_error' so super_admin can
 * spot silent failures in cron/webhook flows that never reach a browser.
 */
function logIntegrationError(string $service, string $endpoint, string $error, array $context = []): void {
    logSecurity('integration_error', array_merge([
        'service'  => $service,
        'endpoint' => $endpoint,
        'error'    => $error,
    ], $context));
}

// ─── Host cooldown (upstream circuit breaker) ────────────────────────────────
// When an upstream host (Jenkins, Jira, Grafana, etc.) fails, mark it. For the
// next HOST_COOLDOWN_TTL seconds, callers can short-circuit and skip the curl
// call entirely — so a DNS timeout on one host doesn't pile up 8-second waits
// across every browser tab and PHP-FPM worker in the pool. First real request
// after the cooldown expires probes again.
//
//   $host = hostFromUrl($url);
//   if ($cd = hostCooldownActive($host)) { return ['', 0, 'cooldown: ' . $cd['reason']]; }
//   [$body, $code, $err] = curl_do($url);
//   if ($err || $code >= 500) hostCooldownMark($host, $err ?: "HTTP $code");
const HOST_COOLDOWN_FILE = 'host-cooldown.json';
const HOST_COOLDOWN_TTL  = 30; // seconds — how long we skip a failing host

function hostFromUrl(string $url): string {
    $h = parse_url($url, PHP_URL_HOST);
    return is_string($h) ? strtolower($h) : '';
}

function _hostCooldownData(): array {
    if (isset($GLOBALS['_host_cooldown_cache'])) return $GLOBALS['_host_cooldown_cache'];
    $path = DATA_DIR . HOST_COOLDOWN_FILE;
    $raw  = @file_get_contents($path);
    $data = $raw ? json_decode($raw, true) : null;
    return $GLOBALS['_host_cooldown_cache'] = is_array($data) ? $data : [];
}

function hostCooldownActive(string $host): ?array {
    if ($host === '') return null;
    $entry = _hostCooldownData()[$host] ?? null;
    if (!$entry) return null;
    $expiresAt = (int)($entry['fail_at'] ?? 0) + HOST_COOLDOWN_TTL;
    if (time() >= $expiresAt) return null;
    return [
        'reason'     => (string)($entry['reason'] ?? 'previous failure'),
        'fail_at'    => (int)($entry['fail_at'] ?? 0),
        'expires_at' => $expiresAt,
    ];
}

function hostCooldownMark(string $host, string $reason): void {
    if ($host === '') return;
    $path = DATA_DIR . HOST_COOLDOWN_FILE;
    $fp = @fopen($path, 'c+');
    if (!$fp) return;
    if (!@flock($fp, LOCK_EX)) { fclose($fp); return; }
    rewind($fp);
    $raw  = stream_get_contents($fp);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) $data = [];
    // GC entries whose cooldown has been expired for a while so the file stays small.
    $now = time();
    foreach ($data as $h => $e) {
        if ((int)($e['fail_at'] ?? 0) + (HOST_COOLDOWN_TTL * 4) < $now) unset($data[$h]);
    }
    $data[$host] = [
        'fail_at' => $now,
        'reason'  => mb_substr($reason, 0, 200),
    ];
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    @flock($fp, LOCK_UN);
    fclose($fp);
    $GLOBALS['_host_cooldown_cache'] = $data;
}

/** Clear the cooldown entry for one host (used right after ops fixes an override). */
function hostCooldownClear(string $host): void {
    if ($host === '') return;
    $path = DATA_DIR . HOST_COOLDOWN_FILE;
    if (!file_exists($path)) return;
    $fp = @fopen($path, 'c+');
    if (!$fp) return;
    if (!@flock($fp, LOCK_EX)) { fclose($fp); return; }
    rewind($fp);
    $raw  = stream_get_contents($fp);
    $data = $raw ? json_decode($raw, true) : null;
    if (is_array($data) && isset($data[$host])) {
        unset($data[$host]);
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
        $GLOBALS['_host_cooldown_cache'] = $data;
    }
    @flock($fp, LOCK_UN);
    fclose($fp);
}

// ─── DNS override (CURLOPT_RESOLVE) ──────────────────────────────────────────
// Bypass system DNS for hosts we know the IP of. Used when the SOM server can't
// resolve the upstream hostname (e.g. DRP moved DNS records or detached a view)
// but Jenkins/Jira is still reachable by IP. Two config sources are merged, both
// keyed by lowercase hostname:
//   1. data/dns-overrides.json           { "host.example.com": "10.1.2.3", ... }
//   2. data/jenkins_servers.json entries — each server may carry an `ip_override`
//      string; the host from `base_url` maps to that IP. Managed via admin UI.
// Per-Jenkins-server config wins on collision. Call applyDnsOverrides($ch, $url)
// after your other curl_setopt calls, before curl_exec.
const DNS_OVERRIDE_FILE = 'dns-overrides.json';

function _dnsOverrideMap(): array {
    if (isset($GLOBALS['_dns_override_cache'])) return $GLOBALS['_dns_override_cache'];
    $map = [];

    // Global file (root DATA_DIR, cross-team) — for any upstream not in jenkins_servers.json.
    $path = DATA_DIR . DNS_OVERRIDE_FILE;
    $raw  = @file_get_contents($path);
    $data = $raw ? json_decode($raw, true) : null;
    if (is_array($data)) {
        foreach ($data as $host => $ip) {
            $h = strtolower(trim((string)$host));
            $i = trim((string)$ip);
            if ($h !== '' && $i !== '') $map[$h] = $i;
        }
    }

    // Per-Jenkins-server override (from jenkins_servers.json) — wins on collision.
    // Route through readJson() so multi-team callers (e.g. team=sm reads data/sm/…)
    // see the correct file. Raw DATA_DIR access would miss team-scoped entries.
    $jsArr = readJson('jenkins_servers.json');
    if (is_array($jsArr)) {
        foreach ($jsArr as $s) {
            $ip = trim((string)($s['ip_override'] ?? ''));
            if ($ip === '') continue;
            $h = strtolower((string)(parse_url($s['base_url'] ?? '', PHP_URL_HOST) ?: ''));
            if ($h !== '') $map[$h] = $ip;
        }
    }
    return $GLOBALS['_dns_override_cache'] = $map;
}

function dnsOverrideForHost(string $host): ?string {
    if ($host === '') return null;
    $map = _dnsOverrideMap();
    return $map[strtolower($host)] ?? null;
}

function applyDnsOverrides($ch, string $url): void {
    $host = hostFromUrl($url);
    $ip   = dnsOverrideForHost($host);
    if ($ip === null) return;
    $scheme = strtolower((string)(parse_url($url, PHP_URL_SCHEME) ?: 'https'));
    $port   = (int)(parse_url($url, PHP_URL_PORT) ?: ($scheme === 'https' ? 443 : 80));
    // Pin both the declared port and the standard scheme port, so redirects
    // between http↔https (or explicit :port URLs) stay pinned to our IP.
    $pins = ["{$host}:{$port}:{$ip}"];
    if ($port !== 443) $pins[] = "{$host}:443:{$ip}";
    if ($port !== 80)  $pins[] = "{$host}:80:{$ip}";
    @curl_setopt($ch, CURLOPT_RESOLVE, $pins);
}

// ─── Google Chat Card Sender ──────────────────────────────────────────────────
/**
 * Send a Google Chat Card v2 payload to one or more incoming-webhook URLs.
 * Used by email-noti broadcast + exam reminder — the two features that need
 * to deliver the same card to multiple webhook URLs and report success/errors
 * uniformly. Keep in sync with the copy in api/scheduled-noti/send-chat.php
 * (that file has its own dedup+lock logic that isn't reused here).
 *
 * @param string[] $webhookUrls  Full webhook URLs; empties/whitespace stripped
 * @param array    $card         Card payload — usually { cardsV2: [...] } or { text: "...", cardsV2: [...] }
 * @param string   $source       Tag for logIntegrationError (e.g. 'email-noti', 'exam-reminder')
 * @return array   { success: bool, sent: int, failed: int, errors: string[], last_http_code: int }
 */
function sendGoogleChatCard(array $webhookUrls, array $card, string $source = 'chat-card'): array {
    $urls = array_values(array_filter(array_map('trim', $webhookUrls)));
    if (empty($urls)) {
        return ['success' => false, 'sent' => 0, 'failed' => 0, 'errors' => ['no webhook URL provided'], 'last_http_code' => 0];
    }
    $payload = json_encode($card, JSON_UNESCAPED_UNICODE);

    $sent = 0; $failed = 0; $errors = []; $lastCode = 0;
    foreach ($urls as $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_TIMEOUT        => 10,
        ]);
        $resp    = curl_exec($ch);
        $code    = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);
        $lastCode = $code;

        if ($curlErr) {
            $errors[] = 'cURL: ' . $curlErr;
            logIntegrationError('google-chat-webhook', $url, $curlErr, ['source' => $source]);
            $failed++;
        } elseif ($code !== 200) {
            $decoded = json_decode($resp, true);
            $msg     = $decoded['error']['message'] ?? $decoded['error']['status'] ?? substr($resp ?? '', 0, 200);
            $errors[] = "HTTP {$code}: {$msg}";
            logIntegrationError('google-chat-webhook', $url, "HTTP {$code}: {$msg}", [
                'http_code' => $code,
                'source'    => $source,
            ]);
            $failed++;
        } else {
            $sent++;
        }
    }
    return [
        'success'        => $sent > 0,
        'sent'           => $sent,
        'failed'         => $failed,
        'errors'         => $errors,
        'last_http_code' => $lastCode,
    ];
}

// ─── Notification Helper ──────────────────────────────────────────────────────
/**
 * Create notification for specific user(s)
 * 
 * @param string|array $userIds Single user ID or array of user IDs
 * @param string $type Notification type (e.g., 'leave_request', 'mention', 'comment')
 * @param string $title Notification title
 * @param string|null $body Optional notification body text
 * @param array $meta Optional metadata (e.g., post_id, post_title, etc.)
 */
function createNotification($userIds, string $type, string $title, ?string $body = null, array $meta = []): void {
    if (!is_array($userIds)) {
        $userIds = [$userIds];
    }
    
    $notifications = readJson('notifications.json');
    
    foreach ($userIds as $userId) {
        $notification = [
            'id'         => genId('notif'),
            'user_id'    => $userId,
            'type'       => $type,
            'title'      => $title,
            'body'       => $body,
            'read'       => false,
            'created_at' => date('c'),
        ];
        
        // Merge any additional metadata
        $notification = array_merge($notification, $meta);
        
        $notifications[] = $notification;
    }
    
    writeJson('notifications.json', $notifications);
}

/**
 * Create notification for all admin users
 * @param string $type Notification type
 * @param string $title Notification title
 * @param string|null $body Optional notification body text
 * @param int|null $postId Optional post ID
 * @param array $meta Optional metadata
 */
function createNotificationForAdmins(string $type, string $title, ?string $body = null, ?int $postId = null, array $meta = []): void {
    $users = readJson('users.json'); // global file — reads from root always
    $currentTeam = $GLOBALS['_current_team'] ?? null;

    // Only notify admins belonging to the current team context.
    // super_admin (team=null) is excluded from per-team admin notifications.
    $adminIds = array_column(
        array_filter($users, fn($u) =>
            in_array($u['role'], ['sm_admin', 'dev_sm']) &&
            ($currentTeam === null || ($u['team'] ?? '') === $currentTeam)
        ),
        'id'
    );

    if (empty($adminIds)) return;

    $notifMeta = $meta;
    if ($postId !== null) {
        $notifMeta['post_id'] = $postId;
    }

    createNotification($adminIds, $type, $title, $body, $notifMeta);
}

// ─── Self-seed admin on first run ─────────────────────────────────────────────
function ensureAdminExists(): void {
    $users = readJson('users.json');
    if (empty($users)) {
        $admin = [
            'id'          => 'usr_001',
            'name'        => 'SM Admin',
            'username'    => 'admin',
            'email'       => JIRA_EMAIL,
            'role'        => 'sm_admin',
            'team'        => 'sm',
            'password'    => hashPassword('Admin@SM2024!'),
            'first_login' => true,
            'created_at'  => date('c'),
            'created_by'  => 'system',
        ];
        writeJson('users.json', [$admin]);
    } else {
        // Fix placeholder hash only — write only if changes were made
        $dirty = false;
        foreach ($users as &$u) {
            if (str_contains($u['password'], 'placeholder')) {
                $u['password'] = hashPassword('Admin@SM2024!');
                $dirty = true;
            }
        }
        unset($u);
        if ($dirty) writeJson('users.json', $users);
    }
}

ensureAdminExists();
