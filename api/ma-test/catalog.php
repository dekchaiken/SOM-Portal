<?php
/**
 * MA Test - Catalog CRUD (SM-only)
 * GET    /catalog.php              → list all catalog items (with optional ?q=, ?service=, ?tool=)
 * GET    /catalog.php?id=xxx       → single item
 * POST   /catalog.php              → create
 * PUT    /catalog.php?id=xxx       → update
 * DELETE /catalog.php?id=xxx       → soft-delete (active=false)  | ?hard=1 → hard delete
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_hydrate.php';

$payload = requireAuth();
requireSmTeamOnly('MA Test');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(200); exit; }

$FILE = 'ma-test-catalog.json';

function _load(): array {
    $d = readJson('ma-test-catalog.json');
    if (!isset($d['catalog']) || !is_array($d['catalog'])) $d = ['catalog' => [], 'next_id' => 1];
    if (!isset($d['next_id'])) $d['next_id'] = count($d['catalog']) + 1;
    return $d;
}
function _save(array $d): void { writeJson('ma-test-catalog.json', $d); }
function _now(): string { return date('Y-m-d H:i:s'); }

// ── Guards for writes ────────────────────────────────────────
function _requireAdmin(array $payload): void {
    if (!in_array($payload['role'] ?? '', ['super_admin', 'sm_admin', 'sm_lead', 'dev_sm'], true)) {
        respondError('Admin/Lead only', 403);
    }
}

if ($method === 'GET') {
    $d = _load();
    // Hydrate: fill catalog empty fields from linked usecase (live sync)
    $items = hydrateCatalogList($d['catalog']);

    if (isset($_GET['id'])) {
        $id = (string)$_GET['id'];
        foreach ($items as $it) {
            if ((string)$it['id'] === $id) { respondOk($it); }
        }
        respondError('Not found', 404);
    }

    // Optional filters (run AFTER hydration so filters match inherited values too)
    $q       = strtolower(trim($_GET['q'] ?? ''));
    $service = trim($_GET['service'] ?? '');
    $tool    = trim($_GET['tool'] ?? '');
    $activeOnly = ($_GET['active'] ?? '') !== '0';

    $out = [];
    foreach ($items as $it) {
        if ($activeOnly && !($it['active'] ?? true)) continue;
        if ($service !== '' && ($it['service'] ?? '') !== $service) continue;
        if ($tool    !== '' && ($it['tool']    ?? '') !== $tool)    continue;
        if ($q !== '') {
            $hay = strtolower(($it['name'] ?? '') . ' ' . ($it['remark'] ?? '') . ' ' . ($it['service'] ?? ''));
            if (strpos($hay, $q) === false) continue;
        }
        $out[] = $it;
    }
    respondOk(['items' => $out, 'total' => count($items), 'count' => count($out)]);
}

if ($method === 'POST') {
    _requireAdmin($payload);
    requireCsrf();

    // ── Batch action: auto-link catalog entries to ma-services usecases by name ──
    $action = $_GET['action'] ?? '';
    if ($action === 'auto_link') {
        $usecasesFile = teamDataPath('ma-services.json');
        $usecases = [];
        if (file_exists($usecasesFile)) {
            $ud = json_decode(file_get_contents($usecasesFile), true);
            $usecases = $ud['services'] ?? [];
        }
        // Build lookup: normalized name → id
        $byName = [];
        foreach ($usecases as $u) {
            $key = strtolower(trim($u['service_name'] ?? ''));
            if ($key !== '') $byName[$key] = (int)$u['id'];
        }
        $d = _load();
        $linked = 0;
        foreach ($d['catalog'] as &$it) {
            if (!empty($it['usecase_id'])) continue;
            $key = strtolower(trim($it['name'] ?? ''));
            if (isset($byName[$key])) {
                $it['usecase_id'] = $byName[$key];
                $it['updated_at'] = _now();
                $it['updated_by'] = $payload['name'] ?? $payload['sub'];
                $linked++;
            }
        }
        unset($it);
        _save($d);
        logActivity('ma_test_catalog_auto_link', ['linked' => $linked], $payload['sub'], $payload['name'] ?? '');
        respondOk(['linked' => $linked, 'total' => count($d['catalog'])], "Auto-linked $linked entries by name");
    }

    // ── Batch action: bulk create catalog entries from a list of usecase IDs ──
    if ($action === 'bulk_from_usecases') {
        $input = json_decode(file_get_contents('php://input'), true) ?: [];
        $ids   = $input['usecase_ids'] ?? [];
        if (!is_array($ids) || empty($ids)) respondError('usecase_ids required (array)');
        $usecasesFile = teamDataPath('ma-services.json');
        if (!file_exists($usecasesFile)) respondError('Usecases file not found');
        $ud = json_decode(file_get_contents($usecasesFile), true);
        $usecases = $ud['services'] ?? [];
        $byId = [];
        foreach ($usecases as $u) $byId[(int)$u['id']] = $u;

        $d = _load();
        $created = 0;
        $skipped = 0;
        // Build set of already-linked usecase ids to skip duplicates
        $linkedSet = [];
        foreach ($d['catalog'] as $it) {
            if (!empty($it['usecase_id'])) $linkedSet[(int)$it['usecase_id']] = true;
        }
        foreach ($ids as $uid) {
            $uid = (int)$uid;
            if (!$uid || !isset($byId[$uid])) { $skipped++; continue; }
            if (!empty($linkedSet[$uid])) { $skipped++; continue; }
            $u = $byId[$uid];
            // Bulk-create leaves overlapping fields blank on purpose — GET-time
            // hydration fills them from the linked usecase so live-sync works.
            $d['catalog'][] = [
                'id'                  => 'mtc_' . $d['next_id'],
                'usecase_id'          => $uid,
                'name'                => '',
                'service'             => '',
                'priority'            => '',
                'graph_url'           => '',
                'tool'                => '',
                'can_change_message'  => '',
                'link_manual'         => '',
                'opensearch_url'      => '',
                'remark'              => '',
                'active'              => true,
                'created_at'          => _now(),
                'created_by'          => $payload['name'] ?? $payload['sub'],
                'updated_at'          => _now(),
            ];
            $d['next_id']++;
            $linkedSet[$uid] = true;
            $created++;
        }
        _save($d);
        logActivity('ma_test_catalog_bulk_create', ['created' => $created, 'skipped' => $skipped], $payload['sub'], $payload['name'] ?? '');
        respondOk(['created' => $created, 'skipped' => $skipped, 'total' => count($d['catalog'])], "Created $created entries (skipped $skipped)");
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    if (empty($input['name']) || empty($input['service']) || empty($input['tool'])) {
        respondError('Missing required: name, service, tool');
    }
    $d = _load();
    $usecaseId = $input['usecase_id'] ?? null;
    if ($usecaseId !== null && $usecaseId !== '') {
        $usecaseId = is_numeric($usecaseId) ? (int)$usecaseId : null;
    } else {
        $usecaseId = null;
    }
    $item = [
        'id'                  => 'mtc_' . $d['next_id'],
        'usecase_id'          => $usecaseId,
        'name'                => trim($input['name']),
        'service'             => strtoupper(trim($input['service'])),
        'priority'            => trim($input['priority'] ?? ''),
        'graph_url'           => trim($input['graph_url'] ?? ''),
        'tool'                => trim($input['tool']),
        'can_change_message'  => strtoupper(trim($input['can_change_message'] ?? 'NO')),
        'link_manual'         => trim($input['link_manual'] ?? ''),
        'opensearch_url'      => trim($input['opensearch_url'] ?? ''),
        'remark'              => trim($input['remark'] ?? ''),
        'active'              => (bool)($input['active'] ?? true),
        'created_at'          => _now(),
        'created_by'          => $payload['name'] ?? $payload['sub'],
        'updated_at'          => _now(),
    ];
    // Strip fields matching the linked usecase so live-sync stays intact
    $item = stripInheritedValues($item);
    $d['catalog'][] = $item;
    $d['next_id']++;
    _save($d);
    logActivity('ma_test_catalog_create', ['id' => $item['id'], 'name' => $item['name']], $payload['sub'], $payload['name'] ?? '');
    respondOk($item, 'Catalog item created');
}

if ($method === 'PUT') {
    _requireAdmin($payload);
    requireCsrf();
    $id = (string)($_GET['id'] ?? '');
    if ($id === '') respondError('Missing id');
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $d = _load();
    $found = false;
    foreach ($d['catalog'] as &$it) {
        if ((string)$it['id'] !== $id) continue;
        foreach (['name','service','priority','graph_url','tool','can_change_message','link_manual','opensearch_url','remark'] as $f) {
            if (array_key_exists($f, $input)) $it[$f] = is_string($input[$f]) ? trim($input[$f]) : $input[$f];
        }
        if (array_key_exists('active', $input)) $it['active'] = (bool)$input['active'];
        if (array_key_exists('usecase_id', $input)) {
            $uid = $input['usecase_id'];
            $it['usecase_id'] = ($uid === null || $uid === '') ? null : (is_numeric($uid) ? (int)$uid : null);
        }
        // Strip fields matching the linked usecase so live-sync stays intact
        $it = stripInheritedValues($it);
        $it['service'] = strtoupper($it['service'] ?? '');
        $it['can_change_message'] = strtoupper($it['can_change_message'] ?? 'NO');
        $it['updated_at'] = _now();
        $it['updated_by'] = $payload['name'] ?? $payload['sub'];
        $found = true;
        $updated = $it;
        break;
    }
    unset($it);
    if (!$found) respondError('Not found', 404);
    _save($d);
    logActivity('ma_test_catalog_update', ['id' => $id], $payload['sub'], $payload['name'] ?? '');
    respondOk($updated, 'Catalog item updated');
}

if ($method === 'DELETE') {
    _requireAdmin($payload);
    requireCsrf();
    $id   = (string)($_GET['id'] ?? '');
    $hard = ($_GET['hard'] ?? '') === '1';
    if ($id === '') respondError('Missing id');
    $d = _load();
    $found = false;
    if ($hard) {
        $before = count($d['catalog']);
        $d['catalog'] = array_values(array_filter($d['catalog'], fn($it) => (string)$it['id'] !== $id));
        $found = count($d['catalog']) < $before;
    } else {
        foreach ($d['catalog'] as &$it) {
            if ((string)$it['id'] !== $id) continue;
            $it['active'] = false;
            $it['updated_at'] = _now();
            $it['updated_by'] = $payload['name'] ?? $payload['sub'];
            $found = true;
            break;
        }
        unset($it);
    }
    if (!$found) respondError('Not found', 404);
    _save($d);
    logActivity('ma_test_catalog_delete', ['id' => $id, 'hard' => $hard], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, $hard ? 'Catalog item deleted' : 'Catalog item deactivated');
}

respondError('Method not allowed', 405);
