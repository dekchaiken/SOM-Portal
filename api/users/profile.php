<?php
require_once __DIR__ . '/../helpers.php';

// Try to get auth from bearer token first, then fall back to session
$payload = null;
$auth = getRequestHeader('Authorization');

if (str_starts_with($auth, 'Bearer ')) {
    // Bearer token provided
    $token = substr($auth, 7);
    $payload = jwt_verify($token);
    if (!$payload) {
        respondError('Token invalid or expired', 401);
    }
    // Inject team context so per-team log dir resolves correctly below.
    // Mirrors requireAuth() in helpers.php (including super_admin override).
    $GLOBALS['_current_team'] = $payload['team'] ?? null;
    if (($payload['role'] ?? '') === 'super_admin') {
        $ctxTeam = getRequestHeader('X-Admin-Team');
        if ($ctxTeam && preg_match('/^[a-z0-9_-]+$/', $ctxTeam)) {
            $GLOBALS['_current_team'] = $ctxTeam;
        }
    }
} else {
    // Fall back to session-based auth
    session_start();
    if (!isset($_SESSION['user_id']) || !isset($_SESSION['role'])) {
        respondError('Authentication required', 401);
    }
    $payload = [
        'sub'  => $_SESSION['user_id'],
        'name' => $_SESSION['user_name'] ?? 'Unknown',
        'role' => $_SESSION['role'] ?? 'sm_user'
    ];
}

$userId = $_GET['user_id'] ?? $_GET['id'] ?? null;

if (!$userId) {
    respondError('User ID required in ?user_id=xxx parameter', 400);
}

// ── Role-based access control ──────────────────────────────
// Allow viewing own profile, or if user is sm_admin/sm_lead
$isOwnProfile = ($userId === $payload['sub']);
$canViewProfiles = in_array($payload['role'] ?? '', ['super_admin', 'sm_admin', 'dev_sm', 'sm_lead']);

if (!$isOwnProfile && !$canViewProfiles) {
    respondError('Access denied. Only SM team members can view other profiles', 403);
}

// ── Get user data ──────────────────────────────────────────
try {
    $users = readJson('users.json');
} catch (Exception $e) {
    respondError('Failed to read users: ' . $e->getMessage(), 500);
}

if (!$users || !is_array($users)) {
    respondError('Invalid users data', 500);
}

$user = null;
foreach ($users as $u) {
    if (($u['id'] ?? null) === $userId) {
        $user = $u;
        break;
    }
}

if (!$user) {
    respondError('User ' . $userId . ' not found in system', 404);
}

// ── Get activity logs ──────────────────────────────────────
// Per-team log dir: SM/unauthenticated → global LOG_DIR, others → data/{team}/logs/
// (mirrors _appendLog() in helpers.php so heatmap reflects the correct team)
try {
    $team     = $GLOBALS['_current_team'] ?? null;
    $logDir   = (!$team || $team === 'sm') ? LOG_DIR : DATA_DIR . $team . '/logs/';
    $logsPath = $logDir . 'activity.json';
    $logs = [];
    if (file_exists($logsPath)) {
        $raw = file_get_contents($logsPath);
        if ($raw !== false) {
            $logs = json_decode($raw, true) ?? [];
        }
    }
} catch (Exception $e) {
    respondError('Failed to read activity logs: ' . $e->getMessage(), 500);
}

// Filter logs for this user
$userLogs = array_values(array_filter($logs, fn($log) =>
    ($log['user_id'] ?? '') === $userId
));

// ── Build activity heatmap (by day and hour) ───────────────
$heatmapData = [];
foreach ($userLogs as $log) {
    $ts = $log['ts'] ?? '';
    if (!$ts) continue;
    
    $datetime = new DateTime($ts);
    $date = $datetime->format('Y-m-d');
    $hour = (int)$datetime->format('H');
    
    if (!isset($heatmapData[$date])) {
        $heatmapData[$date] = array_fill(0, 24, 0);
    }
    $heatmapData[$date][$hour]++;
}

// Convert to array format
$heatmapArray = [];
foreach ($heatmapData as $date => $hours) {
    $heatmapArray[] = [
        'date' => $date,
        'hours' => $hours,
        'total' => array_sum($hours)
    ];
}

// Sort by date descending (most recent first)
usort($heatmapArray, fn($a, $b) => strcmp($b['date'], $a['date']));

// ── Get recent posts (board_create, board_update, board_comment, board_delete) ──
$types = ['board_create', 'board_update', 'board_comment', 'board_delete'];
$recentPosts = array_values(array_filter(
    $userLogs,
    fn($log) => in_array($log['action'] ?? '', $types)
));
$recentPosts = array_slice($recentPosts, 0, 10); // Limit to 10

// ── Get activity feed (all actions) ───────────────────────
$activityFeed = array_slice($userLogs, 0, 50); // Limit to 50 most recent

// ── Build response ─────────────────────────────────────────
$response = [
    'profile' => [
        'id'         => $user['id'],
        'name'       => $user['name'],
        'nickname'   => $user['nickname'] ?? '',
        'username'   => $user['username'],
        'email'      => $user['email'] ?? '',
        'role'       => $user['role'],
        'avatar_url' => $user['avatar_url'] ?? null,
        'created_at' => $user['created_at'] ?? '',
        'team'       => $user['team'] ?? null,
        'name_th'    => $user['name_th']    ?? '',
        'emp_id'     => $user['emp_id']     ?? '',
        'phone'      => $user['phone']      ?? '',
        'tmn_id'     => $user['tmn_id']     ?? '',
        'net_home'   => $user['net_home']   ?? '',
        'net_mobile' => $user['net_mobile'] ?? '',
    ],
    'heatmap' => $heatmapArray,
    'recent_posts' => array_map(fn($log) => [
        'id'       => $log['id'] ?? '',
        'ts'       => $log['ts'] ?? '',
        'action'   => $log['action'] ?? '',
        'detail'   => $log['detail'] ?? [],
    ], $recentPosts),
    'activity_feed' => array_map(fn($log) => [
        'id'       => $log['id'] ?? '',
        'ts'       => $log['ts'] ?? '',
        'action'   => $log['action'] ?? '',
        'detail'   => $log['detail'] ?? [],
        'ip'       => $log['ip'] ?? '',
        'ua'       => $log['ua'] ?? '',
    ], $activityFeed),
    'stats' => [
        'total_actions' => count($userLogs),
        'days_active' => count($heatmapArray),
        'recent_posts_count' => count($recentPosts),
    ]
];

respondOk($response);
?>
