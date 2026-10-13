<?php
/**
 * MA Test - Test Results (SM-only)
 *
 * GET  /results.php?month=YYYY-MM                → all results for that month (joined with catalog)
 * GET  /results.php?month=YYYY-MM&plan_id=xxx    → all results for one plan item
 * POST /results.php?month=YYYY-MM                → create new result
 *                                                   body: plan_id | catalog_id, type, test_date,
 *                                                         before_test, during_test, screenshots[],
 *                                                         start_time, end_time, result, refer_ticket,
 *                                                         jenkins_build_up_url, jenkins_build_down_url
 * PUT  /results.php?month=YYYY-MM&id=xxx         → update existing result (any SM member; tested_by reassigned to editor)
 * DELETE /results.php?month=YYYY-MM&id=xxx       → delete (admin only)
 *
 * Storage: data/sm/ma-test-results-YYYY-MM.json = { items: [...], next_id: N }
 *
 * Jenkins-URL validation: enforced on POST/PUT — jenkins_build_*_url may only
 * be set when the catalog item's tool === 'Jenkins'. Otherwise stripped.
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_hydrate.php';

$payload = requireAuth();
requireSmTeamOnly('MA Test');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(200); exit; }

$ADMIN_ROLES = ['super_admin', 'sm_admin', 'sm_lead', 'dev_sm'];
$isAdmin = in_array($payload['role'] ?? '', $ADMIN_ROLES, true);

function _validMonth(string $m): bool { return (bool)preg_match('/^\d{4}-\d{2}$/', $m); }
function _monthFile(string $m): string { return 'ma-test-results-' . $m . '.json'; }
function _load(string $m): array {
    $d = readJson(_monthFile($m));
    if (!isset($d['items']) || !is_array($d['items'])) $d = ['items' => [], 'next_id' => 1];
    if (!isset($d['next_id'])) $d['next_id'] = count($d['items']) + 1;
    return $d;
}
function _catalog(): array {
    $d = readJson('ma-test-catalog.json');
    $map = [];
    foreach (($d['catalog'] ?? []) as $it) $map[(string)$it['id']] = hydrateCatalogItem($it);
    return $map;
}
function _plan(string $m): array {
    $d = readJson('ma-test-plans-' . $m . '.json');
    $map = [];
    foreach (($d['items'] ?? []) as $it) $map[(string)$it['id']] = $it;
    return $map;
}

$VALID_TYPES   = ['Planwork', 'Auto', 'Test', 'Incident'];
$VALID_RESULTS = ['Successed', 'Failed', 'Pending', '-'];
$VALID_YESNO   = ['Yes', 'No', '-'];

$month = $_GET['month'] ?? date('Y-m');
if (!_validMonth($month)) respondError('month must be YYYY-MM');

// ── GET ──────────────────────────────────────────────────────
if ($method === 'GET') {
    $d = _load($month);
    $catMap  = _catalog();
    $planMap = _plan($month);
    $planId  = (string)($_GET['plan_id'] ?? '');

    $out = [];
    foreach ($d['items'] as $it) {
        if ($planId !== '' && (string)($it['plan_id'] ?? '') !== $planId) continue;
        $cat = $catMap[(string)($it['catalog_id'] ?? '')] ?? null;
        $plan = $planMap[(string)($it['plan_id'] ?? '')] ?? null;
        $out[] = array_merge($it, ['catalog' => $cat, 'plan' => $plan]);
    }
    respondOk(['month' => $month, 'items' => $out]);
}

// ── Helper: normalize + validate input against the catalog ──
function _prepareItem(array $in, array $catMap, array $VALID_TYPES, array $VALID_RESULTS, array $VALID_YESNO): array {
    $catId  = (string)($in['catalog_id'] ?? '');
    $planId = (string)($in['plan_id']    ?? '');
    if ($catId === '') respondError('catalog_id required');
    $cat = $catMap[$catId] ?? null;
    if (!$cat) respondError('catalog_id not found', 404);

    $type   = trim($in['type'] ?? '');
    if ($type !== '' && !in_array($type, $VALID_TYPES, true)) respondError('type must be one of ' . implode('/', $VALID_TYPES));

    $result = trim($in['result'] ?? '-');
    if (!in_array($result, $VALID_RESULTS, true)) $result = '-';

    $before = trim($in['before_test'] ?? '-');
    $during = trim($in['during_test'] ?? '-');
    if (!in_array($before, $VALID_YESNO, true)) $before = '-';
    if (!in_array($during, $VALID_YESNO, true)) $during = '-';

    $screenshots = $in['screenshots'] ?? [];
    if (!is_array($screenshots)) $screenshots = [];
    $screenshots = array_values(array_filter(array_map(fn($s) => trim((string)$s), $screenshots), fn($s) => $s !== ''));

    $isJenkins = strtolower(trim($cat['tool'] ?? '')) === 'jenkins';
    $juu = $isJenkins ? trim($in['jenkins_build_up_url']   ?? '') : '';
    $jud = $isJenkins ? trim($in['jenkins_build_down_url'] ?? '') : '';
    if ($isJenkins) {
        if ($juu === '' || $jud === '') {
            respondError('Jenkins Build URL — MA Up and MA Down are required when tool is Jenkins');
        }
        if (!preg_match('#^https?://#i', $juu) || !preg_match('#^https?://#i', $jud)) {
            respondError('Jenkins Build URLs must start with http:// or https://');
        }
    }

    $testDate = trim($in['test_date'] ?? '');
    if ($testDate && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $testDate)) respondError('test_date must be YYYY-MM-DD');

    $timeRe = '/^\d{1,2}:\d{2}$/';
    $start = trim($in['start_time'] ?? '');
    $end   = trim($in['end_time']   ?? '');
    if ($start && !preg_match($timeRe, $start)) respondError('start_time must be HH:MM');
    if ($end   && !preg_match($timeRe, $end))   respondError('end_time must be HH:MM');

    return [
        'plan_id'                => $planId,
        'catalog_id'             => $catId,
        'type'                   => $type,
        'test_date'              => $testDate,
        'before_test'            => $before,
        'during_test'            => $during,
        'screenshots'            => $screenshots,
        'start_time'             => $start,
        'end_time'               => $end,
        'result'                 => $result,
        'refer_ticket'           => trim($in['refer_ticket'] ?? ''),
        'jenkins_build_up_url'   => $juu,
        'jenkins_build_down_url' => $jud,
    ];
}

// ── POST ─────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    $in = json_decode(file_get_contents('php://input'), true) ?: [];
    $catMap = _catalog();
    $fields = _prepareItem($in, $catMap, $VALID_TYPES, $VALID_RESULTS, $VALID_YESNO);

    $d = _load($month);
    $item = array_merge($fields, [
        'id'             => 'mtr_' . $month . '_' . $d['next_id']++,
        'tested_by'      => $payload['sub'],
        'tested_by_name' => $payload['name'] ?? '',
        'contributors'   => [['id' => $payload['sub'], 'name' => $payload['name'] ?? '']],
        'created_at'     => date('Y-m-d H:i:s'),
        'updated_at'     => date('Y-m-d H:i:s'),
    ]);
    $d['items'][] = $item;
    writeJson(_monthFile($month), $d);
    logActivity('ma_test_result_create', ['month' => $month, 'id' => $item['id'], 'catalog_id' => $fields['catalog_id']], $payload['sub'], $payload['name'] ?? '');
    respondOk($item, 'Result saved');
}

// ── PUT ──────────────────────────────────────────────────────
if ($method === 'PUT') {
    requireCsrf();
    $id = (string)($_GET['id'] ?? '');
    if ($id === '') respondError('Missing id');
    $in = json_decode(file_get_contents('php://input'), true) ?: [];
    $catMap = _catalog();
    $d = _load($month);
    $found = false; $updated = null;
    foreach ($d['items'] as &$it) {
        if ((string)$it['id'] !== $id) continue;
        // Merge over previous values, so client can PATCH-style
        $merged = array_merge($it, $in);
        // Ensure catalog_id remains set (client may omit)
        if (empty($merged['catalog_id'])) $merged['catalog_id'] = $it['catalog_id'];
        $fields = _prepareItem($merged, $catMap, $VALID_TYPES, $VALID_RESULTS, $VALID_YESNO);
        foreach ($fields as $k => $v) $it[$k] = $v;
        // Accumulate contributors — add current editor if not already listed
        $contribs = $it['contributors'] ?? [['id' => $it['tested_by'] ?? '', 'name' => $it['tested_by_name'] ?? '']];
        $existingIds = array_column($contribs, 'id');
        if (!in_array($payload['sub'], $existingIds, true)) {
            $contribs[] = ['id' => $payload['sub'], 'name' => $payload['name'] ?? ''];
        }
        $it['contributors'] = $contribs;
        $it['updated_at'] = date('Y-m-d H:i:s');
        $it['updated_by'] = $payload['name'] ?? $payload['sub'];
        $found = true;
        $updated = $it;
        break;
    }
    unset($it);
    if (!$found) respondError('Not found', 404);
    writeJson(_monthFile($month), $d);
    logActivity('ma_test_result_update', ['month' => $month, 'id' => $id], $payload['sub'], $payload['name'] ?? '');
    respondOk($updated, 'Result updated');
}

// ── DELETE ───────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireCsrf();
    $id = (string)($_GET['id'] ?? '');
    if ($id === '') respondError('Missing id');
    $d = _load($month);
    $target = null;
    foreach ($d['items'] as $it) {
        if ((string)$it['id'] === $id) { $target = $it; break; }
    }
    if (!$target) respondError('Not found', 404);

    // Allow: admin/lead OR the original recorder OR any contributor
    $uid = $payload['sub'] ?? '';
    $contribIds = array_column($target['contributors'] ?? [], 'id');
    $isOwner = ($target['tested_by'] ?? '') === $uid || in_array($uid, $contribIds, true);
    if (!$isAdmin && !$isOwner) respondError('คุณไม่มีสิทธิ์ลบ result นี้', 403);

    $d['items'] = array_values(array_filter($d['items'], fn($it) => (string)$it['id'] !== $id));
    writeJson(_monthFile($month), $d);
    logActivity('ma_test_result_delete', ['month' => $month, 'id' => $id], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, 'Result deleted');
}

respondError('Method not allowed', 405);
