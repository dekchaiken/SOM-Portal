<?php
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/metrics.php';

$payload = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$action = $_GET['action'] ?? 'stats';

// ── Action: lightweight sample heartbeat (any auth'd user) ───────────────────
// Hit by the heartbeat snippet in layout.js from every open page so that
// server metrics are recorded as long as *someone* has the app open.
// Throttled server-side to 60s — extra calls are O(1) no-ops.
if ($action === 'server-sample-ping') {
    $sampled = tryAppendMetricsSample();
    respondOk(['sampled' => $sampled, 'throttle_sec' => SRV_METRICS_THROTTLE]);
}

// Everything below requires the dev_sm role
requireRole($payload, ['dev_sm']);

// ── Action: server resource metrics (CPU, RAM, disk, load, uptime) ───────────
if ($action === 'server') {
    $m = collectServerMetrics();
    appendServerMetricsSample($m); // throttled internally (60s)

    // Lightweight sampler-status probe (last sample age across all writers)
    $hist  = readJson(SRV_METRICS_FILE);
    $lastT = is_array($hist) && $hist ? (int)(end($hist)['t'] ?? 0) : 0;
    $m['sampler'] = [
        'active'         => $lastT > 0 && (time() - $lastT) < (SRV_METRICS_THROTTLE * 3),
        'last_sample_ts' => $lastT ?: null,
        'total_points'   => $hist ? count($hist) : 0,
        'throttle_sec'   => SRV_METRICS_THROTTLE,
        'retention_pts'  => SRV_METRICS_MAX_POINTS,
    ];

    respondOk($m);
}

// ── Action: read rolling server metrics history ──────────────────────────────
if ($action === 'server-history') {
    // Range presets in seconds; 0 = all (up to 7d retained)
    $rangeMap = ['30m' => 1800, '6h' => 21600, '24h' => 86400, '7d' => 604800];
    $range    = $_GET['range'] ?? '24h';
    $since    = isset($_GET['since']) ? (int)$_GET['since'] : ($rangeMap[$range] ?? 86400);
    $maxPts   = max(50, min(1000, (int)($_GET['max'] ?? 500)));

    $hist = readServerMetricsHistory($since, $maxPts);

    // Detect if the sampler is running: latest entry should be < 3 × throttle old
    $lastT     = $hist ? (int)(end($hist)['t'] ?? 0) : 0;
    $samplerOk = $lastT > 0 && (time() - $lastT) < (SRV_METRICS_THROTTLE * 3);

    respondOk([
        'history'        => $hist,
        'count'          => count($hist),
        'range'          => $range,
        'sampler_active' => $samplerOk,
        'last_sample_ts' => $lastT ?: null,
        'throttle_sec'   => SRV_METRICS_THROTTLE,
        'retention_pts'  => SRV_METRICS_MAX_POINTS,
    ]);
}

// ── Action: read a specific data file ────────────────────────────────────────
if ($action === 'file') {
    $name = $_GET['name'] ?? '';
    // Allow only simple filenames inside DATA_DIR (no path traversal)
    if (!preg_match('/^[a-zA-Z0-9_\-]+\.json$/', $name)) {
        respondError('Invalid filename', 400);
    }
    $path = DATA_DIR . $name;
    if (!file_exists($path)) respondError('File not found', 404);

    $raw  = file_get_contents($path);
    $data = json_decode($raw, true);
    $size = filesize($path);

    $meta = [
        'name'   => $name,
        'size'   => $size,
        'mtime'  => filemtime($path),
        'count'  => is_array($data) ? count($data) : null,
        'is_map' => is_array($data) && !array_is_list($data),
    ];

    // For large files, return only first 200 records to avoid browser hanging
    $preview = $data;
    $truncated = false;
    if (is_array($data) && array_is_list($data) && count($data) > 200) {
        $preview   = array_slice($data, 0, 200);
        $truncated = true;
    }

    respondOk(['meta' => $meta, 'data' => $preview, 'truncated' => $truncated]);
}

// ── Action: default stats ─────────────────────────────────────────────────────
// ── Data files ────────────────────────────────────────────────────────────────
$files = glob(DATA_DIR . '*.json') ?: [];
$dataFiles = [];
foreach ($files as $f) {
    $dataFiles[] = [
        'name'  => basename($f),
        'size'  => filesize($f),
        'mtime' => filemtime($f),
    ];
}
usort($dataFiles, fn($a, $b) => $b['size'] - $a['size']);

// ── Log files ─────────────────────────────────────────────────────────────────
$logFiles = [];
foreach (glob(LOG_DIR . '*.json') ?: [] as $f) {
    $logFiles[] = ['name' => basename($f), 'size' => filesize($f), 'mtime' => filemtime($f)];
}
usort($logFiles, fn($a, $b) => $b['mtime'] - $a['mtime']);

// ── Rate limit snapshot ───────────────────────────────────────────────────────
$rlData = readJson('rate_limit.json');
$apiRl  = readJson('api_rate_limit.json');

$now           = time();
$activeWindows = 0;
$topUsers      = [];
foreach ($apiRl as $key => $entry) {
    if (($entry['first'] ?? 0) + API_RL_WINDOW > $now) {
        $activeWindows++;
        $topUsers[] = ['key' => $key, 'count' => $entry['count'] ?? 0, 'first' => $entry['first'] ?? 0];
    }
}
usort($topUsers, fn($a, $b) => $b['count'] - $a['count']);
$topUsers = array_slice($topUsers, 0, 10);

// ── Users snapshot ────────────────────────────────────────────────────────────
$users      = readJson('users.json');
$roleCounts = [];
foreach ($users as $u) {
    $r = $u['role'] ?? 'unknown';
    $roleCounts[$r] = ($roleCounts[$r] ?? 0) + 1;
}

// ── Board snapshot ────────────────────────────────────────────────────────────
$board      = readJson('board.json');
$boardStats = ['total' => count($board), 'open' => 0, 'in_progress' => 0, 'resolved' => 0, 'trashed' => 0];
foreach ($board as $item) {
    $s = $item['status'] ?? '';
    if (isset($boardStats[$s])) $boardStats[$s]++;
    if (!empty($item['deleted_at'])) $boardStats['trashed']++;
}

// ── Recent security events (last 10) ─────────────────────────────────────────
$secLogs   = [];
$secFiles  = glob(LOG_DIR . 'security-*.json') ?: [];
rsort($secFiles);
if ($secFiles) {
    $raw = file_get_contents($secFiles[0]);
    $all = json_decode($raw, true) ?? [];
    $secLogs = array_slice(array_reverse($all), 0, 10);
}

respondOk([
    'server_time'    => $now,
    'php_version'    => PHP_VERSION,
    'php_sapi'       => PHP_SAPI,
    'memory_usage'   => memory_get_usage(true),
    'memory_peak'    => memory_get_peak_usage(true),
    'memory_limit'   => ini_get('memory_limit'),
    'upload_max'     => ini_get('upload_max_filesize'),
    'post_max'       => ini_get('post_max_size'),
    'data_files'     => $dataFiles,
    'log_files'      => $logFiles,
    'rate_limit'     => [
        'login_locked'   => count(array_filter($rlData, fn($v) => ($v['locked_until'] ?? 0) > $now)),
        'api_max'        => API_RL_MAX,
        'api_window'     => API_RL_WINDOW,
        'active_windows' => $activeWindows,
        'top_users'      => $topUsers,
    ],
    'users'          => ['total' => count($users), 'by_role' => $roleCounts],
    'board'          => $boardStats,
    'recent_security'=> $secLogs,
]);
