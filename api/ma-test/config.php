<?php
/**
 * MA Test - Team config (SM-only)
 *
 * Stores per-team config for the MA Test feature. Currently: Google Chat
 * webhooks used by the "แจ้งเริ่ม / แจ้งเสร็จ" template Send buttons on
 * ma-test.html. Admin-only writes; non-admin SM can list webhook names/ids
 * but does NOT see URLs (so they can pick a destination and let the server
 * dispatch via ma-test/notify.php without ever handling the URL).
 *
 * GET    /config.php                       → { webhooks:[{id,name,url?}] }
 * POST   /config.php                       → add   { name, url }
 * PUT    /config.php?id=<id>               → update { name?, url? }
 * DELETE /config.php?id=<id>               → remove
 *
 * Storage: data/sm/ma-test-config.json  = { webhooks: [...], next_id: N }
 */

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireSmTeamOnly('MA Test');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(200); exit; }

const MTC_FILE = 'ma-test-config.json';

function _mtcLoad(): array {
    $d = readJson(MTC_FILE);
    if (!isset($d['webhooks']) || !is_array($d['webhooks'])) $d['webhooks'] = [];
    if (!isset($d['next_id'])) $d['next_id'] = count($d['webhooks']) + 1;
    return $d;
}
function _mtcSave(array $d): void { writeJson(MTC_FILE, $d); }

function _mtcRequireAdmin(array $payload): void {
    if (!in_array($payload['role'] ?? '', ['super_admin', 'sm_admin', 'sm_lead', 'dev_sm'], true)) {
        respondError('Admin/Lead only', 403);
    }
}

function _mtcIsAdmin(array $payload): bool {
    return in_array($payload['role'] ?? '', ['super_admin', 'sm_admin', 'sm_lead', 'dev_sm'], true);
}

function _mtcValidUrl(string $u): bool {
    return (bool)preg_match('#^https://chat\.googleapis\.com/#', $u);
}

// ── GET: list ────────────────────────────────────────────────
if ($method === 'GET') {
    $d = _mtcLoad();
    $isAdmin = _mtcIsAdmin($payload);
    $out = [];
    foreach ($d['webhooks'] as $w) {
        $item = [
            'id'   => $w['id'] ?? '',
            'name' => $w['name'] ?? '',
        ];
        if ($isAdmin) $item['url'] = $w['url'] ?? '';
        else          $item['has_url'] = !empty($w['url']);
        $out[] = $item;
    }
    respondOk(['webhooks' => $out]);
}

// ── POST: create ─────────────────────────────────────────────
if ($method === 'POST') {
    _mtcRequireAdmin($payload);
    requireCsrf();
    $body = getBody();
    $name = trim($body['name'] ?? '');
    $url  = trim($body['url']  ?? '');
    if ($name === '') respondError('name required');
    if ($url === '')  respondError('url required');
    if (!_mtcValidUrl($url)) respondError('Invalid webhook URL — must start with https://chat.googleapis.com/');

    $d = _mtcLoad();
    $item = [
        'id'         => 'mtw_' . $d['next_id']++,
        'name'       => $name,
        'url'        => $url,
        'created_by' => $payload['name'] ?? $payload['sub'],
        'created_at' => date('Y-m-d H:i:s'),
    ];
    $d['webhooks'][] = $item;
    _mtcSave($d);
    logActivity('ma_test_webhook_add', ['id' => $item['id'], 'name' => $name], $payload['sub'], $payload['name'] ?? '');
    respondOk(['webhook' => $item], 'Webhook added');
}

// ── PUT: update ──────────────────────────────────────────────
if ($method === 'PUT') {
    _mtcRequireAdmin($payload);
    requireCsrf();
    $id = (string)($_GET['id'] ?? '');
    if ($id === '') respondError('Missing id');
    $body = getBody();
    $d = _mtcLoad();
    $found = false;
    foreach ($d['webhooks'] as &$w) {
        if ((string)($w['id'] ?? '') !== $id) continue;
        if (isset($body['name'])) {
            $name = trim((string)$body['name']);
            if ($name === '') respondError('name cannot be empty');
            $w['name'] = $name;
        }
        if (isset($body['url'])) {
            $url = trim((string)$body['url']);
            if ($url === '' || !_mtcValidUrl($url)) respondError('Invalid webhook URL — must start with https://chat.googleapis.com/');
            $w['url'] = $url;
        }
        $w['updated_by'] = $payload['name'] ?? $payload['sub'];
        $w['updated_at'] = date('Y-m-d H:i:s');
        $found = true;
        break;
    }
    unset($w);
    if (!$found) respondError('Webhook not found', 404);
    _mtcSave($d);
    logActivity('ma_test_webhook_update', ['id' => $id], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, 'Webhook updated');
}

// ── DELETE: remove ───────────────────────────────────────────
if ($method === 'DELETE') {
    _mtcRequireAdmin($payload);
    requireCsrf();
    $id = (string)($_GET['id'] ?? '');
    if ($id === '') respondError('Missing id');
    $d = _mtcLoad();
    $before = count($d['webhooks']);
    $d['webhooks'] = array_values(array_filter($d['webhooks'], fn($w) => (string)($w['id'] ?? '') !== $id));
    if (count($d['webhooks']) === $before) respondError('Webhook not found', 404);
    _mtcSave($d);
    logActivity('ma_test_webhook_delete', ['id' => $id], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, 'Webhook removed');
}

respondError('Method not allowed', 405);
