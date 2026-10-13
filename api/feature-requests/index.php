<?php
// ─── Feature Request API ─────────────────────────────────────────────────────
// GET    /api/feature-requests/         → list requests
//   super_admin: all requests (optionally ?status=pending|approved|denied)
//   sm_admin:    own team's requests only
//
// POST   /api/feature-requests/         → submit new request (sm_admin)
//   body: { feature_key, reason }
//
// PATCH  /api/feature-requests/?id=xxx  → approve or deny (super_admin only)
//   body: { action: 'approve'|'deny', note? }

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// ─── Catalogue: requestable feature keys ──────────────────────────────────────
// Each feature defines:
//   user_pages  → IDs matching coreNavItems in layout.js (left sidebar)
//   admin_pages → IDs matching admin-nav.js pages (admin top-nav)
const REQUESTABLE_FEATURES = [
    'jira-templates'  => ['label'=>'Jira Templates','icon'=>'🎫','desc'=>'สร้าง Jira ticket อัตโนมัติจาก template',
        'user_pages'=>['send-email'],'admin_pages'=>['templates','jira-config']],
    'jenkins'         => ['label'=>'Jenkins','icon'=>'🔧','desc'=>'ดู / trigger Jenkins pipeline · per-server auth',
        'user_pages'=>[],'admin_pages'=>['jenkins-servers']],
    'jenkins-build'   => ['label'=>'Jenkins Build Launcher','icon'=>'🚀','desc'=>'Trigger Jenkins job จากฟอร์ม config-driven · รองรับ maker/checker approval · เหมาะกับ external user',
        'user_pages'=>['jenkins-build'],'admin_pages'=>['jenkins-servers']],
    'jenkins-portal'  => ['label'=>'Jenkins Portal (Unbind)','icon'=>'🔓','desc'=>'Trigger Jenkins Unbind job (TMN ID + Ticket + App) · Build History / Logs / Admin panels · user/admin roles',
        'user_pages'=>['jenkins-portal'],'admin_pages'=>['jenkins-portal']],
    'so-jenkins'      => ['label'=>'SO Jenkins (CLT RAG)','icon'=>'🚀','desc'=>'Trigger CLT RAG Service Pipeline (Production) · Build History / Logs / Admin panels · user/admin roles',
        'user_pages'=>['so-jenkins'],'admin_pages'=>['so-jenkins']],
    'batch-monitor'   => ['label'=>'Batch Monitor','icon'=>'📦','desc'=>'ติดตาม Jenkins batch jobs · TMN / NANO / WEALTH',
        // 'jenkins-servers' included: Batch Monitor is Jenkins-backed and needs the servers admin page.
        'user_pages'=>['batch-monitor'],'admin_pages'=>['batch-monitor','batch-meta','batch-monitor-noti','jenkins-servers']],
    'alert-monitor'   => ['label'=>'Alert Monitor','icon'=>'🔔','desc'=>'รับ alert จาก monitoring system',
        'user_pages'=>['alert-monitor'],'admin_pages'=>['alert-monitor-config']],
    'analytics'       => ['label'=>'Analytics','icon'=>'📈','desc'=>'Dashboard การใช้งาน · top features',
        'user_pages'=>['analytics'],'admin_pages'=>['analytics']],
    'ma-services'     => ['label'=>'MA Services','icon'=>'🛠','desc'=>'จัดการ MA service list · import',
        'user_pages'=>['ma-services'],'admin_pages'=>['ma-config']],
    'syncup'          => ['label'=>'Sync Up','icon'=>'🔄','desc'=>'บันทึก sync-up meeting · notify ทีม',
        'user_pages'=>['syncup'],'admin_pages'=>['syncup-config']],
    'weekly-report'   => ['label'=>'Weekly Report','icon'=>'📝','desc'=>'รายงานประจำสัปดาห์',
        'user_pages'=>['weekly-report'],'admin_pages'=>['weekly-report']],
    'monitoring'      => ['label'=>'Monitoring','icon'=>'📡','desc'=>'Grafana dashboards · real-time metrics',
        'user_pages'=>['monitoring'],'admin_pages'=>['system-monitor']],
    'sms-gateway'     => ['label'=>'SMS Gateway','icon'=>'📱','desc'=>'จัดการ SMS gateway switches',
        'user_pages'=>['sms-gateway-switches'],'admin_pages'=>['sms-gateway-config']],
    'sheets'          => ['label'=>'Sheets Embed','icon'=>'📊','desc'=>'Embed Google Sheets',
        'user_pages'=>['sheets'],'admin_pages'=>['sheets']],
    'inbox'           => ['label'=>'Team Inbox','icon'=>'📬','desc'=>'รับ/ส่งอีเมลภายในทีม',
        'user_pages'=>['inbox'],'admin_pages'=>['fh-config']],
    'notifications'   => ['label'=>'Scheduled Notifications','icon'=>'💬','desc'=>'ตั้ง scheduled notification',
        'user_pages'=>[],'admin_pages'=>['scheduled-noti','email-noti']],
    'onboarding'      => ['label'=>'Team Onboarding','icon'=>'👋','desc'=>'Portal onboarding สมาชิกใหม่',
        'user_pages'=>['onboarding'],'admin_pages'=>['onboarding']],
    'uptime'          => ['label'=>'Uptime Monitor','icon'=>'⏱','desc'=>'ตรวจสอบ uptime ของ service endpoints',
        'user_pages'=>['uptime'],'admin_pages'=>[]],
    'links'           => ['label'=>'Quick Links','icon'=>'🔗','desc'=>'Quick link shortcuts ใน sidebar',
        'user_pages'=>[],'admin_pages'=>['links']],
    'test-service'    => ['label'=>'Service Test','icon'=>'🧪','desc'=>'Test portal · reconcile',
        'user_pages'=>['test-service'],'admin_pages'=>['test-service']],
    'achievements'    => ['label'=>'Achievements','icon'=>'🏆','desc'=>'ระบบ achievement / badge',
        'user_pages'=>[],'admin_pages'=>['achievements']],
    'restart-monitor' => ['label'=>'Restart Monitor','icon'=>'🔁','desc'=>'ติดตาม pod/service restart',
        'user_pages'=>['restart-monitor'],'admin_pages'=>[]],
    'service-severity'=> ['label'=>'Service Severity','icon'=>'⚠️','desc'=>'กำหนด severity level',
        'user_pages'=>[],'admin_pages'=>['service-severity']],
    // View-only shares of SM-shared data: the underlying JSON files live under
    // data/sm/ (see smSharedFiles()) so no per-team data files are provisioned,
    // hence the empty admin_pages list — teams get read access to SM's dataset.
    'batch-file-search'=> ['label'=>'Batch File Lookup','icon'=>'🔎','desc'=>'ค้น "file X มาจาก Jenkins job ไหน" · index จาก SM',
        'user_pages'=>['batch-file-search'],'admin_pages'=>[]],
    'grafana-alerts'  => ['label'=>'Paused Alerts','icon'=>'⏸','desc'=>'ดู Grafana paused alerts ที่ SM curate ให้',
        'user_pages'=>['grafana-alerts'],'admin_pages'=>[]],
];

// Default features every team gets — cannot be requested (already included)
const DEFAULT_FEATURES = ['dashboard', 'board', 'team-docs', 'sabai', 'schedule', 'learning'];

// ─── GET ──────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $requests = readJson('feature_requests.json'); // global

    if ($payload['role'] === 'super_admin') {
        // Optional status filter: ?status=pending|approved|denied
        $status = $_GET['status'] ?? null;
        if ($status) {
            $requests = array_values(array_filter($requests, fn($r) => $r['status'] === $status));
        }
    } else {
        // sm_admin/dev_sm: own team only
        $myTeam   = $payload['team'] ?? null;
        $requests = array_values(array_filter($requests, fn($r) => ($r['team_slug'] ?? '') === $myTeam));
    }

    // Attach feature metadata (label, icon, desc) for display
    foreach ($requests as &$r) {
        $key = $r['feature_key'] ?? '';
        $r['feature_meta'] = REQUESTABLE_FEATURES[$key] ?? ['label' => $key, 'icon' => '?', 'desc' => ''];
    }
    unset($r);

    // Also include catalogue when team admin calls GET (so they can build the request form)
    $includeCatalogue = in_array($payload['role'], ['sm_admin', 'dev_sm']);
    $teamFeatures     = [];
    if ($includeCatalogue) {
        $teams = readJson('teams.json');
        foreach ($teams as $t) {
            if (($t['slug'] ?? '') === ($payload['team'] ?? '')) {
                $teamFeatures = $t['features'] ?? [];
                break;
            }
        }
    }

    respondOk([
        'requests'  => $requests,
        'catalogue' => $includeCatalogue ? REQUESTABLE_FEATURES : null,
        'team_features' => $includeCatalogue ? $teamFeatures : null,
    ]);
}

// ─── POST — submit request (sm_admin / dev_sm) ────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, ['sm_admin', 'dev_sm']);

    $body       = getBody();
    $featureKey = trim($body['feature_key'] ?? '');
    $reason     = trim($body['reason'] ?? '');
    $team       = $payload['team'] ?? null;

    if (!$featureKey)                              respondError('feature_key is required');
    if (!isset(REQUESTABLE_FEATURES[$featureKey])) respondError("Unknown feature: {$featureKey}");
    if (!$team)                                    respondError('No team associated with your account');

    // Is team already on a default feature?
    if (in_array($featureKey, DEFAULT_FEATURES, true)) {
        respondError("'{$featureKey}' is a default feature — your team already has it");
    }

    // Check if team already has this feature
    $teams = readJson('teams.json');
    foreach ($teams as $t) {
        if (($t['slug'] ?? '') === $team && in_array($featureKey, $t['features'] ?? [], true)) {
            respondError("Your team already has the '{$featureKey}' feature", 409);
        }
    }

    // Check for duplicate pending request
    $requests = readJson('feature_requests.json');
    foreach ($requests as $r) {
        if ($r['team_slug'] === $team && $r['feature_key'] === $featureKey && $r['status'] === 'pending') {
            respondError('A pending request for this feature already exists', 409);
        }
    }

    $req = [
        'id'           => genId('freq'),
        'team_slug'    => $team,
        'feature_key'  => $featureKey,
        'feature_label'=> REQUESTABLE_FEATURES[$featureKey]['label'],
        'requested_by' => $payload['sub'],
        'requester_name'=> $payload['name'] ?? '',
        'requested_at' => date('c'),
        'status'       => 'pending',
        'reason'       => $reason,
        'reviewed_by'  => null,
        'reviewer_name'=> null,
        'reviewed_at'  => null,
        'review_note'  => null,
    ];

    $requests[] = $req;
    writeJson('feature_requests.json', $requests);
    logActivity('feature_requested', [
        'feature' => $featureKey,
        'team'    => $team,
        'reason'  => mb_substr($reason, 0, 100),
    ], $payload['sub'], $payload['name'] ?? '');

    // Notify super_admin(s)
    $allUsers  = readJson('users.json');
    $saIds     = array_column(array_filter($allUsers, fn($u) => $u['role'] === 'super_admin'), 'id');
    if (!empty($saIds)) {
        $teamName = '';
        foreach ($teams as $t) { if ($t['slug'] === $team) { $teamName = $t['name']; break; } }
        createNotification($saIds, 'feature_request',
            "Feature Request: {$req['feature_label']}",
            "{$teamName} wants access to {$req['feature_label']}",
            ['feature_key' => $featureKey, 'team_slug' => $team]
        );
    }

    respondOk($req, 'Feature request submitted — waiting for super admin approval');
}

// ─── PATCH — approve or deny (super_admin only) ───────────────────────────────
// body: { action: 'approve'|'deny', note?, granted_pages?: {user_pages:[...], admin_pages:[...]} }
if ($method === 'PATCH') {
    requireCsrf();
    requireRole($payload, ['super_admin']);

    $id     = $_GET['id'] ?? '';
    $body   = getBody();
    $action = $body['action'] ?? '';
    $note   = trim($body['note'] ?? '');
    // granular override — null means "grant all default pages for this feature"
    $grantedPages = $body['granted_pages'] ?? null;

    if (!$id)                                    respondError('Request ID required');
    if (!in_array($action, ['approve', 'deny'])) respondError('action must be approve or deny');

    $requests = readJson('feature_requests.json');
    $updated  = false;
    $reqSlug  = null;
    $reqKey   = null;

    foreach ($requests as &$r) {
        if ($r['id'] !== $id) continue;
        if ($r['status'] !== 'pending') respondError('Request already resolved', 409);

        $r['status']        = ($action === 'approve') ? 'approved' : 'denied';
        $r['reviewed_by']   = $payload['sub'];
        $r['reviewer_name'] = $payload['name'] ?? '';
        $r['reviewed_at']   = date('c');
        $r['review_note']   = $note;
        if ($action === 'approve' && $grantedPages !== null) {
            $r['granted_pages'] = $grantedPages; // store the super_admin's selection
        }
        $reqSlug  = $r['team_slug'];
        $reqKey   = $r['feature_key'];
        $reqLabel = $r['feature_label'];
        $reqBy    = $r['requested_by'];
        $updated  = true;
        break;
    }
    unset($r);

    if (!$updated) respondError('Request not found', 404);
    writeJson('feature_requests.json', $requests);

    if ($action === 'approve') {
        _provisionFeature($reqSlug, $reqKey, $grantedPages);
    }

    // Notify requester
    $allUsers = readJson('users.json');
    foreach ($allUsers as $u) {
        if ($u['id'] === $reqBy) {
            $msg  = $action === 'approve'
                ? "✅ '{$reqLabel}' approved! Refresh to see your new feature."
                : "❌ '{$reqLabel}' request was denied." . ($note ? " Note: {$note}" : '');
            $type = $action === 'approve' ? 'feature_approved' : 'feature_denied';
            $GLOBALS['_current_team'] = $reqSlug;
            createNotification([$reqBy], $type, "Feature Request {$action}d", $msg,
                ['feature_key' => $reqKey]);
            $GLOBALS['_current_team'] = null;
            break;
        }
    }

    logActivity("feature_request_{$action}d", [
        'request_id' => $id, 'feature' => $reqKey, 'team' => $reqSlug,
        'granted_pages' => $grantedPages,
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk(null, "Request {$action}d");
}

// ─── Helper: provision feature for a team ────────────────────────────────────
// $grantedPages: null = grant all default pages; array = custom selection
//   { user_pages: [...], admin_pages: [...] }
function _provisionFeature(string $teamSlug, string $featureKey, ?array $grantedPages = null): void {
    // 1. Add feature key to teams.json features array
    $teams = readJson('teams.json');
    foreach ($teams as &$t) {
        if (($t['slug'] ?? '') !== $teamSlug) continue;
        $t['features'] = array_values(array_unique(
            array_merge($t['features'] ?? [], [$featureKey])
        ));
        // 2. Store granted pages override (if custom selection was made)
        if ($grantedPages !== null) {
            if (!isset($t['feature_pages'])) $t['feature_pages'] = [];
            $t['feature_pages'][$featureKey] = [
                'user_pages'  => array_values($grantedPages['user_pages']  ?? []),
                'admin_pages' => array_values($grantedPages['admin_pages'] ?? []),
            ];
        }
        break;
    }
    unset($t);
    writeJson('teams.json', $teams);

    // 2. Create data files the feature needs
    $dataFiles = [
        'jira-templates'  => ['templates.json', 'jira_config.json'],
        'jenkins'         => ['jenkins_servers.json'],
        'jenkins-build'   => ['jenkins-build-tools.json', 'jenkins-build-history.json', 'jenkins-build-approvals.json', 'jenkins_servers.json'],
        'jenkins-portal'  => ['jenkins-portal-tools.json', 'jenkins-portal-apps.json', 'jenkins-portal-history.json', 'jenkins-portal-sessions.json', 'jenkins-portal-logs.json', 'jenkins_servers.json'],
        'so-jenkins'      => ['so-jenkins-tools.json', 'so-jenkins-builds.json', 'so-jenkins-logs.json', 'so-jenkins-build-users.json', 'jenkins_servers.json'],
        'batch-monitor'   => ['batch_meta.json', 'jenkins_servers.json'],
        'alert-monitor'   => ['alert-monitor-config.json', 'alert-monitor-state.json'],
        'analytics'       => ['analytics_events.json'],
        'ma-services'     => ['ma-modules.json', 'ma-services.json', 'ma-types.json'],
        'syncup'          => ['syncup.json', 'syncup-config.json'],
        'weekly-report'   => [],
        'monitoring'      => [],
        'sms-gateway'     => ['sms_gateway_tmn.json', 'sms_gateway_nano.json', 'sms_gateway_welth.json'],
        'sheets'          => ['sheets.json'],
        'inbox'           => [],
        'notifications'   => ['scheduled-noti.json', 'notifications.json'],
        'onboarding'      => [],
        'uptime'          => ['uptime_config.json', 'uptime_monitors.json'],
        'links'           => ['links.json'],
        'test-service'    => ['test-service-config.json'],
        'achievements'    => [],
        'restart-monitor' => [],
        'service-severity'=> ['service-severity.json'],
    ];

    $files = $dataFiles[$featureKey] ?? [];
    foreach ($files as $file) {
        $path = DATA_DIR . $teamSlug . '/' . $file;
        $dir  = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        if (!file_exists($path)) {
            file_put_contents($path, json_encode([], JSON_PRETTY_PRINT));
        }
    }
}

respondError('Method not allowed', 405);
