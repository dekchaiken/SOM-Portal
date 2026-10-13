<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ['super_admin']);

$type   = $_GET['type']   ?? 'activity';  // activity | security | errors | client_error
$limit  = min((int)($_GET['limit']  ?? 100), 500);
$offset = max((int)($_GET['offset'] ?? 0), 0);
$search = strtolower(trim($_GET['search'] ?? ''));
$user   = strtolower(trim($_GET['user']   ?? ''));
$action = strtolower(trim($_GET['action'] ?? ''));
$date    = $_GET['date']    ?? ''; // YYYY-MM-DD
$dateTo  = $_GET['date_to'] ?? ''; // YYYY-MM-DD
$teamFilter = trim($_GET['team'] ?? ''); // '' or 'all' = aggregate; slug = that team only

// Events that belong to the Errors tab. Everything in security.json that
// matches one of these gets split out — Security tab hides them, Errors tab
// only shows them. Keeps Security focused on auth/access events.
const ERROR_EVENTS = ['fatal_error', 'uncaught_exception', 'server_error', 'integration_error'];

$file = match($type) {
    'security', 'errors' => 'security.json',
    'client_error'       => 'client-errors.json',
    default              => 'activity.json',
};

// ── Build source list ────────────────────────────────────────────────────
// Log files live under per-team directories: data/logs/ (SM + unauthenticated)
// and data/{slug}/logs/ for every other team. When aggregating we scan all
// registered teams so no team's audit trail is hidden.
$sources = [];
if ($teamFilter !== '' && $teamFilter !== 'all') {
    $sources[] = ($teamFilter === 'sm')
        ? ['team' => 'sm', 'path' => LOG_DIR . $file]
        : ['team' => $teamFilter, 'path' => DATA_DIR . $teamFilter . '/logs/' . $file];
} else {
    $sources[] = ['team' => 'sm', 'path' => LOG_DIR . $file];
    $teams = readJson('teams.json');
    foreach ($teams as $t) {
        $slug = $t['slug'] ?? '';
        if (!$slug || $slug === 'sm') continue;
        $sources[] = ['team' => $slug, 'path' => DATA_DIR . $slug . '/logs/' . $file];
    }
}

// ── Read + tag with _team ────────────────────────────────────────────────
$logs = [];
foreach ($sources as $src) {
    if (!file_exists($src['path'])) continue;
    $raw   = file_get_contents($src['path']);
    $items = json_decode($raw, true) ?? [];
    foreach ($items as &$e) { $e['_team'] = $src['team']; }
    unset($e);
    $logs = array_merge($logs, $items);
}

// Sort newest-first (merging across teams disrupts the per-file order)
usort($logs, fn($a, $b) => strcmp($b['ts'] ?? '', $a['ts'] ?? ''));

// ── Filter out health_check noise from activity ───────────────────────────
if ($type === 'activity') {
    $logs = array_values(array_filter($logs, fn($e) =>
        ($e['action'] ?? '') !== 'health_check'
    ));
}

// ── Split security.json into Security tab vs Errors tab ──────────────────
if ($type === 'errors') {
    $logs = array_values(array_filter($logs, fn($e) =>
        in_array($e['event'] ?? '', ERROR_EVENTS, true)
    ));
} elseif ($type === 'security') {
    $logs = array_values(array_filter($logs, fn($e) =>
        !in_array($e['event'] ?? '', ERROR_EVENTS, true)
    ));
}

// Snapshot for stats before user-supplied filters (health_check already stripped)
$allLogs = $logs;

// ── Apply filters ────────────────────────────────────────────────────────
if ($user) {
    $logs = array_values(array_filter($logs, fn($e) =>
        str_contains(strtolower($e['user_name'] ?? ''), $user) ||
        str_contains(strtolower($e['user_id']   ?? ''), $user)
    ));
}

if ($action) {
    if ($type === 'client_error') {
        $logs = array_values(array_filter($logs, fn($e) =>
            str_contains(strtolower($e['type'] ?? ''), $action)
        ));
    } else {
        $key = ($type === 'security' || $type === 'errors') ? 'event' : 'action';
        $logs = array_values(array_filter($logs, fn($e) =>
            str_contains(strtolower($e[$key] ?? ''), $action)
        ));
    }
}

if ($date) {
    $logs = array_values(array_filter($logs, function($e) use ($date, $dateTo) {
        $ts = $e['ts'] ?? '';
        return $ts >= $date && (!$dateTo || $ts <= $dateTo . 'T23:59:59');
    }));
}

if ($search) {
    if ($type === 'client_error') {
        $logs = array_values(array_filter($logs, fn($e) =>
            str_contains(strtolower($e['user_name'] ?? ''), $search) ||
            str_contains(strtolower($e['message']   ?? ''), $search) ||
            str_contains(strtolower($e['page']       ?? ''), $search) ||
            str_contains(strtolower($e['type']       ?? ''), $search) ||
            str_contains(strtolower($e['ip']         ?? ''), $search)
        ));
    } else {
        $logs = array_values(array_filter($logs, fn($e) =>
            str_contains(strtolower($e['user_name'] ?? ''), $search) ||
            str_contains(strtolower($e['ip']        ?? ''), $search) ||
            str_contains(strtolower($e['action']    ?? ''), $search) ||
            str_contains(strtolower($e['event']     ?? ''), $search) ||
            str_contains(strtolower(json_encode($e['detail'] ?? [])), $search)
        ));
    }
}

$total = count($logs);

// Export mode: return every matching row (respects all filters), skip pagination.
// Capped so a runaway export can't OOM the server; UI warns on truncation.
$isExport = ($_GET['export'] ?? '') === '1';
if ($isExport) {
    $items = array_slice($logs, 0, 5000);
} else {
    $items = array_slice($logs, $offset, $limit);
}

// Newest timestamp — client uses this as the "since" cursor for live-tail mode
$newestTs = $logs[0]['ts'] ?? '';

// Hourly buckets (last 24h) for the sparkline. Uses $allLogs so the shape of
// the sparkline reflects the raw scope, not whichever user/search filter the
// operator is currently narrowing to.
//   $hourly[b]                — total events in hour bucket b (used as fallback)
//   $hourlyByTeam[b][team]    — per-team count in that bucket for stacked bars
$hourly = array_fill(0, 24, 0);
$hourlyByTeam = array_fill(0, 24, []);
$now = time();
$cutoff = $now - 24 * 3600;
foreach ($allLogs as $e) {
    $ts = strtotime($e['ts'] ?? '');
    if (!$ts || $ts < $cutoff) continue;
    $bucket = 23 - (int)floor(($now - $ts) / 3600);
    if ($bucket < 0 || $bucket >= 24) continue;
    $hourly[$bucket]++;
    $team = $e['_team'] ?? 'unknown';
    $hourlyByTeam[$bucket][$team] = ($hourlyByTeam[$bucket][$team] ?? 0) + 1;
}

// ── Summary stats (over $allLogs — respects team filter but not user filters) ─
$today = date('Y-m-d');
$todayCount  = count(array_filter($allLogs, fn($e) => str_starts_with($e['ts'] ?? '', $today)));
$uniqueUsers = count(array_unique(array_filter(array_column($allLogs, 'user_id'))));

if ($type === 'client_error') {
    $countKey = 'type';
} elseif ($type === 'security' || $type === 'errors') {
    $countKey = 'event';
} else {
    $countKey = 'action';
}
$actionCounts = array_count_values(array_column($allLogs, $countKey));
arsort($actionCounts);
$topActions = array_slice($actionCounts, 0, 5, true);

// Per-team breakdown — handy for the aggregate view
$teamCounts = array_count_values(array_column($allLogs, '_team'));
arsort($teamCounts);

// Distinct action keys seen in this scope. Frontend uses this to auto-append
// undocumented actions to the filter dropdown so nothing stays invisible.
$allActions = array_values(array_unique(array_filter(array_column($allLogs, $countKey))));
sort($allActions);

respondOk([
    'items'        => $items,
    'total'        => $total,
    'today_count'  => $todayCount,
    'unique_users' => $uniqueUsers,
    'top_actions'  => $topActions,
    'team_counts'  => $teamCounts,
    'all_actions'  => $allActions,
    'hourly'          => array_values($hourly),
    'hourly_by_team'  => array_values($hourlyByTeam),
    'newest_ts'    => $newestTs,
    'exported'     => $isExport ? count($items) : null,
    'export_truncated' => $isExport && $total > count($items),
]);
