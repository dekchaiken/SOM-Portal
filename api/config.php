<?php
// ─── SOM-Portal Config ───────────────────────────────────────────────────

// ── Load .env (secrets live there, NOT in this file) ──────────────────────────
$_envPath = __DIR__ . '/../.env';
if (file_exists($_envPath)) {
    foreach (file($_envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $_line) {
        $_line = trim($_line);
        if ($_line === '' || str_starts_with($_line, '#') || !str_contains($_line, '=')) continue;
        [$_k, $_v] = explode('=', $_line, 2);
        putenv(trim($_k) . '=' . trim($_v));
    }
}
unset($_envPath, $_line, $_k, $_v);

// ── Constants (read from env, with safe fallbacks) ────────────────────────────
define('JWT_SECRET',  getenv('JWT_SECRET') ?: 'FALLBACK_CHANGE_ME_SET_JWT_SECRET_IN_ENV');
define('DATA_DIR',    __DIR__ . '/../data/');
define('UPLOADS_DIR', __DIR__ . '/../uploads/');

// Public base URL of this app — used to build links inside outbound emails
// (password reset, account creation). Should NOT have a trailing slash.
//
// Resolution order:
//   1) APP_BASE_URL env var (explicit override — set in .env when needed)
//   2) Auto-detect from the current HTTP request (works for any deploy where
//      the user is hitting the server through its real public URL — covers
//      production "http://10.164.16.47/centralize-som" without any env config)
//   3) Hardcoded localhost fallback (last resort, e.g. CLI / cron with no env)
$_envBase = getenv('APP_BASE_URL') ?: '';
if (!$_envBase && !empty($_SERVER['HTTP_HOST'])) {
    $_scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $_script = $_SERVER['SCRIPT_NAME'] ?? '';
    // Trim everything from /api/... onward → app root, e.g. /centralize-som
    $_appRoot = preg_replace('#/api/.*$#', '', $_script);
    $_envBase = $_scheme . '://' . $_SERVER['HTTP_HOST'] . $_appRoot;
}
define('APP_BASE_URL', rtrim($_envBase ?: 'http://localhost:8000', '/'));
unset($_envBase, $_scheme, $_script, $_appRoot);

// Read system settings (dynamic config — admin-configurable)
$_sf  = DATA_DIR . 'system-settings.json';
$_cfg = file_exists($_sf) ? (json_decode(file_get_contents($_sf), true) ?? []) : [];
define('JWT_EXPIRY',       (int)(($_cfg['session_timeout_hours']  ?? 8)  * 3600)); // default 8h
define('REMEMBER_ME_DAYS', (int) ($_cfg['remember_me_days']       ?? 30));         // default 30d
define('PW_EXPIRY_DAYS',   (int) ($_cfg['password_expiry_days']   ?? 60));         // default 60d
define('PW_HIST_COUNT',    (int) ($_cfg['password_history_count'] ?? 5));          // default 5
define('SYS_SETTINGS',  $_cfg);
unset($_sf, $_cfg);

define('JIRA_BASE_URL',    'https://truemoney.atlassian.net');
define('JIRA_EMAIL',       getenv('JIRA_EMAIL') ?: '');
define('JIRA_TOKEN',       getenv('JIRA_TOKEN') ?: '');
define('JIRA_PROJECT_KEY', 'SMC');

// Grafana read-only service account (used by cron/restart-monitor-fetch.php)
define('GRAFANA_URL',    getenv('GRAFANA_URL')                   ?: 'https://grafana-thanos.truemoney.com');
define('GRAFANA_TOKEN',  getenv('GRAFANA_SERVICE_ACCOUNT_TOKEN') ?: '');
define('GRAFANA_ORG_ID', getenv('GRAFANA_ORG_ID')                ?: '2');
define('GRAFANA_DS_UID', getenv('GRAFANA_DATASOURCE_UID')        ?: 'e4b184ea-3a40-4b6a-b6cb-fa6f2ba17c1e');

// Shared secret for the daily restart-monitor upload endpoint
// (allows the local scheduled task to push JSON without JWT)
define('RESTART_MONITOR_UPLOAD_TOKEN', getenv('RESTART_MONITOR_UPLOAD_TOKEN') ?: '');

define('OLLAMA_HOST',  getenv('OLLAMA_HOST')  ?: 'http://localhost:11434');
define('OLLAMA_MODEL', getenv('OLLAMA_MODEL') ?: 'qwen2.5:7b');

define('MAX_UPLOAD_SIZE',     5 * 1024 * 1024); // 5MB
define('ALLOWED_IMAGE_TYPES', ['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// ── CORS — allow from localhost for MAMP/XAMPP ────────────────────────────────
$allowed_origins = ['http://localhost', 'http://localhost:8888', 'http://127.0.0.1', 'http://127.0.0.1:8888'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    // Explicit allow for matched origins only — never fall back to wildcard
    header('Access-Control-Allow-Origin: ' . $origin);
}
// No Origin header = direct / same-origin request — no CORS header needed
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Allow-Credentials: true');
header('Content-Type: application/json; charset=UTF-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
