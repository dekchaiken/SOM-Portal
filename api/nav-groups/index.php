<?php
require_once __DIR__ . '/../helpers.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$defaultGroups = [
    ['id'=>'home',    'label'=>'Home',       'icon'=>'dashboard',  'items'=>['dashboard','my-team','about-som','schedule','pw-schedule','sheets','sabai','onboarding']],
    ['id'=>'monitor', 'label'=>'Monitor',    'icon'=>'monitor',    'items'=>['service-performance','restart-monitor','restart-analyzer','log-explorer','alert-monitor','monitoring','uptime','grafana-alerts','begin-grafana','syncup']],
    ['id'=>'ma',      'label'=>'MA Tools',   'icon'=>'wrench',     'items'=>['ma-services','ma-test']],
    ['id'=>'ops',     'label'=>'Operations', 'icon'=>'board',      'items'=>['board','send-email','jira-templates','case-incidents','inbox','batch-monitor','batch-file-search','jenkins-build','jenkins-portal','so-jenkins','migrate-user','sms-gateway-switches','test-service','analytics','weekly-report','report-center']],
    ['id'=>'learn',   'label'=>'Learn',      'icon'=>'book-open',  'items'=>['learn','learn-reports','exam-reports']],
    ['id'=>'genz',    'label'=>'GenZ',       'icon'=>'sparkles',   'items'=>['genz-hub','genz-notes']],
    ['id'=>'admin',   'label'=>'Admin',      'icon'=>'settings',   'items'=>['admin','genz-team','nav-groups','devtools','dev-system','dev-api','dev-logs','dev-email','dev-data']],
];

if ($method === 'GET') {
    $data = readJson('nav-groups.json');
    if (empty($data) || empty($data['groups'])) {
        echo json_encode(['ok'=>true, 'data'=>['groups'=>$defaultGroups, 'is_default'=>true]]);
    } else {
        echo json_encode(['ok'=>true, 'data'=>$data]);
    }
    exit;
}

if ($method === 'POST') {
    requireRole($user, ['sm_admin','dev_sm','super_admin']);

    $body = json_decode(file_get_contents('php://input'), true);
    if (!isset($body['groups']) || !is_array($body['groups'])) {
        http_response_code(400);
        echo json_encode(['ok'=>false,'error'=>'groups array required']);
        exit;
    }

    foreach ($body['groups'] as $g) {
        if (empty($g['id']) || empty($g['label']) || !isset($g['items']) || !is_array($g['items'])) {
            http_response_code(400);
            echo json_encode(['ok'=>false,'error'=>'Each group needs id, label, items[]']);
            exit;
        }
    }

    $groups = array_map(function($g) {
        return [
            'id'    => preg_replace('/[^a-z0-9_-]/', '', strtolower($g['id'])),
            'label' => substr(trim($g['label']), 0, 32),
            'icon'  => preg_replace('/[^a-z0-9_-]/', '', $g['icon'] ?? 'dashboard'),
            'items' => array_values(array_filter(array_map(function($i) {
                return preg_replace('/[^a-z0-9_-]/', '', $i);
            }, $g['items']))),
        ];
    }, $body['groups']);

    $save = [
        'groups'     => $groups,
        'updated_at' => date('c'),
        'updated_by' => $user['username'] ?? $user['name'] ?? 'admin',
    ];

    writeJson('nav-groups.json', $save);
    logActivity('nav_groups_update', ['groups_count' => count($groups)]);
    echo json_encode(['ok'=>true,'data'=>$save]);
    exit;
}

if ($method === 'DELETE') {
    requireRole($user, ['sm_admin','dev_sm','super_admin']);
    $path = teamDataPath('nav-groups.json');
    if (file_exists($path)) unlink($path);
    echo json_encode(['ok'=>true,'message'=>'Reset to default']);
    exit;
}

http_response_code(405);
echo json_encode(['ok'=>false,'error'=>'Method not allowed']);
