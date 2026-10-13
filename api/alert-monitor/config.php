<?php
// ─── Alert Monitor config CRUD ────────────────────────────────────────────────
// GET  → read config (all authenticated users — needed to render UI)
// PUT  → replace config (LEAD_ROLES only)
// PATCH → partial update: { classification_rules: [...] } etc. (LEAD_ROLES only)
require_once __DIR__ . '/../helpers.php';

$user = requireAuth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $cfg = readJson('alert-monitor-config.json');
    respondOk($cfg);
}

requireRole($user, LEAD_ROLES);

if ($method !== 'PUT' && $method !== 'PATCH') {
    respondError('Method not allowed', 405);
}

$body = getBody();
$cur  = readJson('alert-monitor-config.json') ?: [];

if ($method === 'PUT') {
    // Full replace — validate minimum shape
    if (!isset($body['jsm']['cloud_id']) || !isset($body['classification_rules'])) {
        respondError('Invalid config: jsm.cloud_id and classification_rules required', 400);
    }
    $next = $body;
} else {
    // PATCH — merge top-level keys shallowly
    $next = $cur;
    foreach ($body as $k => $v) $next[$k] = $v;
}

// Sanitise classification_rules — enforce known fields, categories, order
if (isset($next['classification_rules']) && is_array($next['classification_rules'])) {
    $validCats = array_map(fn($c) => $c['id'] ?? '', $next['categories'] ?? [
        ['id' => 'monitoring'], ['id' => 'batch'], ['id' => 'other']
    ]);
    $clean = [];
    foreach ($next['classification_rules'] as $r) {
        if (!is_array($r)) continue;
        $cat = $r['category'] ?? 'other';
        if (!in_array($cat, $validCats, true)) $cat = 'other';
        $clean[] = [
            'id'          => $r['id']          ?? genId('rule'),
            'priority'    => (int)($r['priority'] ?? 100),
            'match_field' => in_array($r['match_field'] ?? '', ['message','tags','source','alias'], true)
                                ? $r['match_field'] : 'message',
            'match_type'  => in_array($r['match_type'] ?? '', ['contains','starts_with','equals','regex'], true)
                                ? $r['match_type'] : 'contains',
            'keyword'     => (string)($r['keyword'] ?? ''),
            'category'    => $cat,
            'enabled'     => (bool)($r['enabled'] ?? true),
        ];
    }
    usort($clean, fn($a, $b) => ($a['priority'] ?? 0) <=> ($b['priority'] ?? 0));
    $next['classification_rules'] = $clean;
}

writeJson('alert-monitor-config.json', $next);
logActivity('alert_monitor_config_update', [
    'method' => $method,
    'rules_count' => count($next['classification_rules'] ?? [])
], $user['sub'] ?? null, $user['name'] ?? null);
respondOk($next, 'Config saved');
