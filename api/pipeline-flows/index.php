<?php
// Pipeline Flows — multi-org, multi-flow registry.
//
// Storage: data/{team}/pipeline_flows.json
//   {
//     "orgs": ["NANO", "TMN", "WEALTH"],
//     "flows": [
//       {
//         "id": "nano_collection_lead",
//         "org": "NANO",
//         "name": "Collection Lead",
//         "source": "...",
//         "jobs":       [{ pattern, category, schedule:{...}, critical, monitor, rerun, ... }],
//         "auto_edges": [{from,to,kind}],
//         "user_edges": [{from,to,note,by,at}],
//         "notes":      { "<pattern>": { text, by, at } },
//         "created_at": "...", "created_by": "..."
//       }
//     ]
//   }
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action'] ?? '';
$flowId  = $_GET['flow']   ?? '';

function _pfLoad(): array {
    $d = readJson('pipeline_flows.json');
    if (!is_array($d)) $d = [];
    if (!isset($d['orgs'])  || !is_array($d['orgs']))  $d['orgs']  = ['NANO', 'TMN', 'WEALTH'];
    if (!isset($d['flows']) || !is_array($d['flows'])) $d['flows'] = [];
    foreach ($d['flows'] as &$f) {
        foreach (['jobs','auto_edges','user_edges'] as $k) {
            if (!isset($f[$k]) || !is_array($f[$k])) $f[$k] = [];
        }
        if (!isset($f['notes']) || !is_array($f['notes'])) $f['notes'] = [];
    }
    unset($f);
    return $d;
}

function _pfFindIdx(array $d, string $id): int {
    foreach ($d['flows'] as $i => $f) if (($f['id'] ?? '') === $id) return $i;
    return -1;
}

function _pfSlug(string $s): string {
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9]+/', '_', $s);
    return trim($s, '_');
}

function _pfRequireSm(array $p) {
    if (($p['team'] ?? '') !== 'sm') respondError('SM Team only', 403);
}

// ── GET — list all flows (with jobs stripped for index) or one full flow ────
if ($method === 'GET') {
    $d = _pfLoad();
    if ($flowId !== '') {
        $i = _pfFindIdx($d, $flowId);
        if ($i < 0) respondError('Flow not found', 404);
        $f = $d['flows'][$i];
        $f['notes'] = (object)$f['notes'];
        respondOk(['flow' => $f, 'orgs' => $d['orgs']]);
    }
    // Index only — send lightweight summary per flow (no full jobs array)
    $summary = array_map(fn($f) => [
        'id'         => $f['id'],
        'org'        => $f['org'],
        'name'       => $f['name'],
        'job_count'  => count($f['jobs']),
        'edge_count' => count($f['auto_edges']) + count($f['user_edges']),
        'source'     => $f['source'] ?? '',
        'created_at' => $f['created_at'] ?? null,
    ], $d['flows']);
    respondOk(['orgs' => $d['orgs'], 'flows' => $summary]);
}

// ── POST ?action=create — create a new flow ─────────────────────────────────
if ($method === 'POST' && $action === 'create') {
    _pfRequireSm($payload);
    requireCsrf();
    $body = getBody();
    $org  = trim($body['org']  ?? '');
    $name = trim($body['name'] ?? '');
    if (!$org)  respondError('org required');
    if (!$name) respondError('name required');

    $d = _pfLoad();
    if (!in_array($org, $d['orgs'], true)) $d['orgs'][] = $org;

    $baseId = _pfSlug($org) . '_' . _pfSlug($name);
    $id = $baseId; $n = 2;
    while (_pfFindIdx($d, $id) >= 0) { $id = $baseId . '_' . $n; $n++; }

    $flow = [
        'id'         => $id,
        'org'        => $org,
        'name'       => $name,
        'source'     => trim($body['source'] ?? 'manual'),
        'jobs'       => [],
        'auto_edges' => [],
        'user_edges' => [],
        'notes'      => new stdClass(),
        'created_at' => date('c'),
        'created_by' => $payload['name'] ?? $payload['sub'],
    ];
    $d['flows'][] = $flow;
    writeJson('pipeline_flows.json', $d);
    logActivity('pf_create', ['id' => $id, 'org' => $org, 'name' => $name], $payload['sub'], $payload['name']);
    respondOk(['flow' => $flow], 'Flow created');
}

// ── DELETE ?flow=xxx — remove entire flow ───────────────────────────────────
if ($method === 'DELETE' && $flowId) {
    _pfRequireSm($payload);
    requireCsrf();
    $d = _pfLoad();
    $i = _pfFindIdx($d, $flowId);
    if ($i < 0) respondError('Flow not found', 404);
    array_splice($d['flows'], $i, 1);
    writeJson('pipeline_flows.json', $d);
    logActivity('pf_delete', ['id' => $flowId], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

// ── POST ?flow=xxx&action=rename — rename or move to different org ─────────
if ($method === 'POST' && $action === 'rename' && $flowId) {
    _pfRequireSm($payload);
    requireCsrf();
    $body = getBody();
    $d = _pfLoad();
    $i = _pfFindIdx($d, $flowId);
    if ($i < 0) respondError('Flow not found', 404);
    if (isset($body['name'])) $d['flows'][$i]['name'] = trim($body['name']);
    if (isset($body['org'])) {
        $org = trim($body['org']);
        $d['flows'][$i]['org'] = $org;
        if (!in_array($org, $d['orgs'], true)) $d['orgs'][] = $org;
    }
    writeJson('pipeline_flows.json', $d);
    respondOk(null, 'Updated');
}

// ── POST ?flow=xxx&action=add-job — SM adds/updates a job in a flow ────────
if ($method === 'POST' && $action === 'add-job' && $flowId) {
    _pfRequireSm($payload);
    requireCsrf();
    $body = getBody();
    $pattern = trim($body['pattern'] ?? '');
    if (!$pattern) respondError('pattern required');

    $d = _pfLoad();
    $i = _pfFindIdx($d, $flowId);
    if ($i < 0) respondError('Flow not found', 404);

    $job = [
        'pattern'    => $pattern,
        'jenkins_raw'=> trim($body['jenkins_raw'] ?? $pattern),
        'category'   => trim($body['category']    ?? $d['flows'][$i]['name']),
        'label'      => trim($body['label']       ?? $pattern),
        'purpose'    => trim($body['purpose']     ?? ''),
        'schedule'   => [
            'frequency' => trim($body['frequency'] ?? ''),
            'date'      => trim($body['sched_date'] ?? ''),
            'time'      => trim($body['sched_time'] ?? ''),
            'sort_key'  => (int)($body['sort_key'] ?? 9999),
        ],
        'critical'   => trim($body['critical']    ?? ''),
        'monitor'    => trim($body['monitor']     ?? ''),
        'rerun'      => trim($body['rerun']       ?? ''),
        'params'     => trim($body['params']      ?? ''),
        'confluence' => trim($body['confluence']  ?? ''),
        'dev_owner'  => trim($body['dev_owner']   ?? ''),
        'user_owners'=> trim($body['user_owners'] ?? ''),
        'files'      => is_array($body['files'] ?? null) ? $body['files'] : [],
        'dbs'        => is_array($body['dbs']   ?? null) ? $body['dbs']   : [],
    ];

    // Upsert by pattern
    $found = false;
    foreach ($d['flows'][$i]['jobs'] as &$existing) {
        if (strtolower($existing['pattern']) === strtolower($pattern)) {
            $existing = $job; $found = true; break;
        }
    }
    unset($existing);
    if (!$found) $d['flows'][$i]['jobs'][] = $job;

    writeJson('pipeline_flows.json', $d);
    logActivity('pf_add_job', ['flow' => $flowId, 'pattern' => $pattern], $payload['sub'], $payload['name']);
    respondOk(['job' => $job], $found ? 'Updated' : 'Added');
}

// ── POST ?flow=xxx&action=delete-job ────────────────────────────────────────
if ($method === 'POST' && $action === 'delete-job' && $flowId) {
    _pfRequireSm($payload);
    requireCsrf();
    $body = getBody();
    $pattern = trim($body['pattern'] ?? '');
    if (!$pattern) respondError('pattern required');
    $d = _pfLoad();
    $i = _pfFindIdx($d, $flowId);
    if ($i < 0) respondError('Flow not found', 404);
    $d['flows'][$i]['jobs'] = array_values(array_filter(
        $d['flows'][$i]['jobs'],
        fn($j) => strtolower($j['pattern']) !== strtolower($pattern)
    ));
    // Also drop edges that mention this job
    $d['flows'][$i]['auto_edges'] = array_values(array_filter(
        $d['flows'][$i]['auto_edges'],
        fn($e) => $e['from'] !== $pattern && $e['to'] !== $pattern
    ));
    $d['flows'][$i]['user_edges'] = array_values(array_filter(
        $d['flows'][$i]['user_edges'],
        fn($e) => $e['from'] !== $pattern && $e['to'] !== $pattern
    ));
    unset($d['flows'][$i]['notes'][$pattern]);
    writeJson('pipeline_flows.json', $d);
    logActivity('pf_delete_job', ['flow' => $flowId, 'pattern' => $pattern], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

// ── POST ?flow=xxx&action=add-edge / delete-edge / set-note ─────────────────
if ($method === 'POST' && in_array($action, ['add-edge','delete-edge','set-note'], true) && $flowId) {
    _pfRequireSm($payload);
    requireCsrf();
    $body = getBody();
    $d = _pfLoad();
    $i = _pfFindIdx($d, $flowId);
    if ($i < 0) respondError('Flow not found', 404);
    $f = &$d['flows'][$i];

    if ($action === 'add-edge') {
        $from = trim($body['from'] ?? '');
        $to   = trim($body['to']   ?? '');
        $note = trim($body['note'] ?? '');
        if (!$from || !$to) respondError('from and to required');
        if ($from === $to)  respondError('cannot link a job to itself');
        foreach ($f['user_edges'] as $e) {
            if ($e['from'] === $from && $e['to'] === $to)
                respondError('edge already exists', 409);
        }
        $f['user_edges'][] = [
            'from' => $from, 'to' => $to, 'note' => $note,
            'by'   => $payload['name'] ?? $payload['sub'],
            'at'   => date('c'),
        ];
    } elseif ($action === 'delete-edge') {
        $from = trim($body['from'] ?? '');
        $to   = trim($body['to']   ?? '');
        if (!$from || !$to) respondError('from and to required');
        $f['user_edges'] = array_values(array_filter(
            $f['user_edges'],
            fn($e) => !($e['from'] === $from && $e['to'] === $to)
        ));
    } elseif ($action === 'set-note') {
        $job  = trim($body['job']  ?? '');
        $text = trim($body['text'] ?? '');
        if (!$job) respondError('job required');
        if (!is_array($f['notes'])) $f['notes'] = (array)$f['notes'];
        if ($text === '') unset($f['notes'][$job]);
        else $f['notes'][$job] = [
            'text' => $text,
            'by'   => $payload['name'] ?? $payload['sub'],
            'at'   => date('c'),
        ];
    }
    unset($f);
    writeJson('pipeline_flows.json', $d);
    logActivity('pf_' . str_replace('-','_',$action), ['flow' => $flowId], $payload['sub'], $payload['name']);
    respondOk(null, 'Saved');
}

respondError('Method not allowed', 405);
