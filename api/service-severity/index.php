<?php
/**
 * /api/service-severity/index.php
 *
 * GET  ?action=list[&search=x]          — list all services
 * GET  ?action=stats                    — P1/P2/P3 counts
 * POST (JSON body)  action=upsert       — add/update one service
 * POST (JSON body)  action=import       — bulk import [{name,priority,serviceGroup,bu}]
 * POST (JSON body)  action=delete       — delete one service by name
 */

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'list' : '');

// Team-scoped: reads/writes go to data/{team}/service-severity.json so each
// team owns its own severity registry (matches every other feature).
$file = _teamDataPath('service-severity.json', $GLOBALS['_current_team'] ?? null);

function _loadData(string $file): array {
    if (!file_exists($file)) return ['services' => [], 'lastUpdated' => null, 'updatedBy' => null, 'count' => 0];
    $d = json_decode(file_get_contents($file), true);
    return is_array($d) ? $d : ['services' => [], 'lastUpdated' => null, 'updatedBy' => null, 'count' => 0];
}

function _saveData(string $file, array $data, string $updatedBy): bool {
    ksort($data['services']);
    $data['count']       = count($data['services']);
    $data['lastUpdated'] = (new DateTime('now', new DateTimeZone('Asia/Bangkok')))->format('c');
    $data['updatedBy']   = $updatedBy;
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp  = $file . '.tmp.' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $json) === false) return false;
    return rename($tmp, $file);
}

// ── GET list ──────────────────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'list') {
    $data     = _loadData($file);
    $services = $data['services'] ?? [];
    $search   = strtolower(trim($_GET['search'] ?? ''));

    $rows = [];
    foreach ($services as $name => $svc) {
        if ($search && strpos(strtolower($name), $search) === false
                    && strpos(strtolower($svc['serviceGroup'] ?? ''), $search) === false) {
            continue;
        }
        $rows[] = [
            'name'         => $name,
            'priority'     => $svc['priority'] ?? 'P3',
            'serviceGroup' => $svc['serviceGroup'] ?? '',
            'bu'           => $svc['bu'] ?? '',
            'runway'       => $svc['runway'] ?? '',
        ];
    }

    respondOk([
        'services'    => $rows,
        'total'       => count($services),
        'filtered'    => count($rows),
        'lastUpdated' => $data['lastUpdated'] ?? null,
        'updatedBy'   => $data['updatedBy'] ?? null,
    ]);
}

// ── GET stats ─────────────────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'stats') {
    $data     = _loadData($file);
    $services = $data['services'] ?? [];
    $counts   = ['P1' => 0, 'P2' => 0, 'P3' => 0];
    foreach ($services as $svc) {
        $p = $svc['priority'] ?? 'P3';
        $counts[$p] = ($counts[$p] ?? 0) + 1;
    }
    respondOk(['total' => count($services), 'byPriority' => $counts, 'lastUpdated' => $data['lastUpdated'] ?? null]);
}

// ── POST actions ──────────────────────────────────────────────────────────────
if ($method !== 'POST') respondError('Method not allowed', 405);
requireRole($payload, ADMIN_ROLES);

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) respondError('Invalid JSON body', 400);

$action = $body['action'] ?? $action;

// ── upsert ────────────────────────────────────────────────────────────────────
if ($action === 'upsert') {
    $name   = trim($body['name'] ?? '');
    $prio   = strtoupper(trim($body['priority'] ?? 'P3'));
    $group  = trim($body['serviceGroup'] ?? '');
    $bu     = trim($body['bu'] ?? 'Truemoney');
    $runway = trim($body['runway'] ?? '');

    if (!$name)                         respondError('name is required', 400);
    if (!in_array($prio, ['P1','P2','P3'])) respondError('priority must be P1, P2, or P3', 400);

    $data = _loadData($file);
    $isNew = !isset($data['services'][$name]);
    $data['services'][$name] = ['priority' => $prio, 'serviceGroup' => $group, 'bu' => $bu, 'runway' => $runway];

    if (!_saveData($file, $data, $payload['username'] ?? 'unknown')) {
        respondError('Failed to save', 500);
    }

    logActivity('service_severity_upsert', ['name' => $name, 'priority' => $prio, 'new' => $isNew]);
    respondOk(['name' => $name, 'priority' => $prio, 'created' => $isNew]);
}

// ── delete ────────────────────────────────────────────────────────────────────
if ($action === 'delete') {
    $name = trim($body['name'] ?? '');
    if (!$name) respondError('name is required', 400);

    $data = _loadData($file);
    if (!isset($data['services'][$name])) respondError('Service not found', 404);

    unset($data['services'][$name]);

    if (!_saveData($file, $data, $payload['username'] ?? 'unknown')) {
        respondError('Failed to save', 500);
    }

    logActivity('service_severity_delete', ['name' => $name]);
    respondOk(['deleted' => $name]);
}

// ── import ────────────────────────────────────────────────────────────────────
if ($action === 'import') {
    $rows = $body['data'] ?? [];
    if (!is_array($rows) || !count($rows)) respondError('data array is required', 400);
    if (count($rows) > 2000) respondError('Too many rows (max 2000)', 400);

    $data    = _loadData($file);
    $mode    = $body['mode'] ?? 'merge'; // merge | replace
    if ($mode === 'replace') $data['services'] = [];

    $imported = 0;
    $skipped  = 0;
    foreach ($rows as $row) {
        $name   = trim($row['name']         ?? $row['Service name']  ?? '');
        $prio   = strtoupper(trim($row['priority'] ?? $row['Priority']     ?? 'P3'));
        $group  = trim($row['serviceGroup'] ?? $row['Service group'] ?? '');
        $bu     = trim($row['bu']           ?? $row['BU']            ?? 'Truemoney');
        $runway = trim($row['runway']       ?? $row['Runway']        ?? '');

        if (!$name || !in_array($prio, ['P1','P2','P3'])) { $skipped++; continue; }
        $data['services'][$name] = ['priority' => $prio, 'serviceGroup' => $group, 'bu' => $bu, 'runway' => $runway];
        $imported++;
    }

    if (!_saveData($file, $data, $payload['username'] ?? 'unknown')) {
        respondError('Failed to save', 500);
    }

    logActivity('service_severity_import', ['imported' => $imported, 'skipped' => $skipped, 'mode' => $mode, 'total' => count($data['services'])]);
    respondOk(['imported' => $imported, 'skipped' => $skipped, 'total' => count($data['services'])]);
}

respondError('Unknown action', 400);
