<?php
// ══════════════════════════════════════════════════════════════════
//  Admin: manage the "hidden items" ignore list for the MA dashboard.
//    GET  → { nano:[], tmn_jenkins:[], tmn_features:[], tmn_backoffice:[] }
//    PUT  → same shape (replace whole map)
//  Items whose stable key is in the corresponding array are filtered
//  out of /api/ma-status/ responses so they never render on the board.
//
//  Stable keys per source:
//    nano           → item.name  (e.g. "PAYNEXTEXTRA:payment")
//    tmn_jenkins    → item.name  (job path, e.g. "/view/…/job/xxx")
//    tmn_features   → feature name (e.g. "promptpay-transfer")
//    tmn_backoffice → use_case_id (int)
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$FILE = 'ma-status-hidden.json';
$SOURCES = ['nano', 'tmn_jenkins', 'tmn_features', 'tmn_backoffice'];

function _empty_hidden(array $sources): array {
    $out = [];
    foreach ($sources as $s) $out[$s] = [];
    return $out;
}

if ($method === 'GET') {
    $cur = readJson($FILE);
    if (!is_array($cur)) $cur = [];
    // Normalize: ensure every known source key exists
    $out = _empty_hidden($SOURCES);
    foreach ($SOURCES as $s) {
        $out[$s] = array_values(array_filter($cur[$s] ?? [], fn($v) => $v !== null && $v !== ''));
    }
    respondOk($out);
}

if ($method === 'PUT' || $method === 'POST') {
    $body = getBody();
    if (!is_array($body)) respondError('body must be an object', 400);

    $out = _empty_hidden($SOURCES);
    foreach ($SOURCES as $s) {
        if (!isset($body[$s])) continue;
        if (!is_array($body[$s])) respondError("$s must be an array", 400);
        // Backoffice ids are integers; everything else is string keys
        if ($s === 'tmn_backoffice') {
            $out[$s] = array_values(array_unique(array_map('intval', $body[$s])));
        } else {
            $out[$s] = array_values(array_unique(array_map(fn($v) => (string)$v, $body[$s])));
        }
    }
    writeJson($FILE, $out);
    // Invalidate the aggregator cache so hidden items disappear on next fetch
    writeJson('ma-status-cache.json', []);
    $totalHidden = array_sum(array_map('count', $out));
    logActivity('ma_status_hidden_saved', ['total' => $totalHidden]);
    respondOk($out);
}

respondError('Method not allowed', 405);
