<?php
/**
 * MA Test - Monthly Plans (SM-only)
 *
 * GET    /plans.php?month=YYYY-MM             → list plan items in month (joined with catalog)
 * GET    /plans.php?months=1                  → list available months (newest first)
 * POST   /plans.php?month=YYYY-MM             → add one/many catalog items to plan
 *                                                body: { catalog_ids: ["mtc_1", ...], note? }
 * DELETE /plans.php?month=YYYY-MM&id=<planId> → remove plan item
 *
 * Storage: data/sm/ma-test-plans-YYYY-MM.json  = { items: [...], next_id: N }
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_hydrate.php';

$payload = requireAuth();
requireSmTeamOnly('MA Test');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(200); exit; }

function _requireAdmin(array $payload): void {
    if (!in_array($payload['role'] ?? '', ['super_admin', 'sm_admin', 'sm_lead', 'dev_sm'], true)) {
        respondError('Admin/Lead only', 403);
    }
}
function _validMonth(string $m): bool { return (bool)preg_match('/^\d{4}-\d{2}$/', $m); }
function _monthFile(string $m): string { return 'ma-test-plans-' . $m . '.json'; }

function _loadPlan(string $m): array {
    $d = readJson(_monthFile($m));
    if (!isset($d['items']) || !is_array($d['items'])) $d = ['items' => [], 'next_id' => 1];
    if (!isset($d['next_id'])) $d['next_id'] = count($d['items']) + 1;
    return $d;
}
function _loadCatalogMap(): array {
    $d = readJson('ma-test-catalog.json');
    $map = [];
    foreach (($d['catalog'] ?? []) as $it) $map[(string)$it['id']] = hydrateCatalogItem($it);
    return $map;
}

// ── List available months ────────────────────────────────────
if ($method === 'GET' && ($_GET['months'] ?? '') === '1') {
    $files = glob(DATA_DIR . 'sm/ma-test-plans-????-??.json') ?: [];
    $months = [];
    foreach ($files as $f) {
        if (preg_match('/ma-test-plans-(\d{4}-\d{2})\.json$/', $f, $mm)) $months[] = $mm[1];
    }
    rsort($months);
    respondOk(['months' => $months]);
}

$month = $_GET['month'] ?? date('Y-m');
if (!_validMonth($month)) respondError('month must be YYYY-MM');

if ($method === 'GET') {
    $plan = _loadPlan($month);
    $catalog = _loadCatalogMap();
    $out = [];
    foreach ($plan['items'] as $it) {
        $cat = $catalog[(string)($it['catalog_id'] ?? '')] ?? null;
        $out[] = array_merge($it, ['catalog' => $cat]);
    }
    respondOk(['month' => $month, 'items' => $out]);
}

if ($method === 'POST') {
    _requireAdmin($payload);
    requireCsrf();
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $ids   = $input['catalog_ids'] ?? [];
    if (!is_array($ids) || empty($ids)) respondError('catalog_ids required (non-empty array)');
    $note  = trim($input['note'] ?? '');
    $plannedDate = trim($input['planned_date'] ?? '');
    if ($plannedDate && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $plannedDate)) {
        respondError('planned_date must be YYYY-MM-DD');
    }

    $catalog = _loadCatalogMap();
    $plan = _loadPlan($month);
    $existingCatIds = array_column($plan['items'], 'catalog_id');

    $added = [];
    foreach ($ids as $cid) {
        $cid = (string)$cid;
        if (!isset($catalog[$cid])) continue;                 // silently skip unknown
        if (in_array($cid, $existingCatIds, true)) continue;  // dedup within month
        $item = [
            'id'           => 'mtp_' . $month . '_' . $plan['next_id']++,
            'catalog_id'   => $cid,
            'month'        => $month,
            'planned_date' => $plannedDate,
            'note'         => $note,
            'added_by'     => $payload['name'] ?? $payload['sub'],
            'added_at'     => date('Y-m-d H:i:s'),
        ];
        $plan['items'][] = $item;
        $added[] = $item;
    }
    writeJson(_monthFile($month), $plan);
    logActivity('ma_test_plan_add', ['month' => $month, 'count' => count($added)], $payload['sub'], $payload['name'] ?? '');
    respondOk(['added' => $added, 'count' => count($added)], count($added) . ' item(s) added');
}

if ($method === 'DELETE') {
    _requireAdmin($payload);
    requireCsrf();
    $id = (string)($_GET['id'] ?? '');
    if ($id === '') respondError('Missing id');
    $plan = _loadPlan($month);
    $before = count($plan['items']);
    $plan['items'] = array_values(array_filter($plan['items'], fn($it) => (string)$it['id'] !== $id));
    if (count($plan['items']) === $before) respondError('Plan item not found', 404);
    writeJson(_monthFile($month), $plan);
    logActivity('ma_test_plan_delete', ['month' => $month, 'id' => $id], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, 'Plan item removed');
}

respondError('Method not allowed', 405);
