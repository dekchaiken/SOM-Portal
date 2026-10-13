<?php
/**
 * push.php — n8n external push endpoint (no JWT, uses pre-shared key)
 *
 * GET  → returns monitor list (for n8n to know what to check)
 * POST → receives check results from n8n, writes to uptime_history.json
 */
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';

define('MAX_HISTORY', 10080); // 7 days × 24h × 60min

// ── Team context (M2M: n8n supplies ?team= or falls back to sm) ──────────────
$_teamParam = trim((string)($_GET['team'] ?? 'sm'));
if (!preg_match('/^[a-z0-9_-]+$/', $_teamParam)) $_teamParam = 'sm';
$GLOBALS['_current_team'] = $_teamParam;

// ── Key management ────────────────────────────────────────────────────────────
function _uptimeCfgPath(): string { return teamDataPath('uptime_config.json'); }

function _readCfg(): array {
    $p = _uptimeCfgPath();
    return file_exists($p) ? (json_decode(file_get_contents($p), true) ?? []) : [];
}

function _saveCfg(array $d): void {
    $p = _uptimeCfgPath();
    $d2 = dirname($p);
    if (!is_dir($d2)) @mkdir($d2, 0755, true);
    file_put_contents($p,
        json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function getOrCreatePushKey(): string {
    $cfg = _readCfg();
    if (empty($cfg['push_key'])) {
        $cfg['push_key'] = bin2hex(random_bytes(24)); // 48-char hex
        _saveCfg($cfg);
    }
    return $cfg['push_key'];
}

// ── Response helpers ──────────────────────────────────────────────────────────
function pushOk($data = null, string $msg = 'OK'): void {
    echo json_encode(['success' => true, 'data' => $data, 'message' => $msg]);
    exit;
}
function pushErr(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg]);
    exit;
}

// ── JSON helpers (team-scoped) ────────────────────────────────────────────────
function readJ(string $f): array {
    $p = teamDataPath($f);
    return file_exists($p) ? (json_decode(file_get_contents($p), true) ?? []) : [];
}
function writeJ(string $f, array $d): void {
    $p = teamDataPath($f);
    $dir = dirname($p);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    file_put_contents($p,
        json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

// ── Auth (pre-shared key) ─────────────────────────────────────────────────────
$validKey = getOrCreatePushKey();
$reqKey   = $_SERVER['HTTP_X_UPTIME_KEY'] ?? '';
if (!$reqKey || !hash_equals($validKey, $reqKey)) {
    pushErr('Invalid or missing X-Uptime-Key', 401);
}

$method = $_SERVER['REQUEST_METHOD'];

// ── GET — return monitor list for n8n ─────────────────────────────────────────
if ($method === 'GET') {
    $monitors = readJ('uptime_monitors.json');
    pushOk($monitors);
}

// ── POST — receive check results from n8n ────────────────────────────────────
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body) || empty($body)) pushErr('Invalid payload');

    $history = readJ('uptime_history.json');

    foreach ($body as $r) {
        $id = $r['id'] ?? '';
        if (!$id) continue;

        if (!isset($history[$id])) $history[$id] = [];
        $history[$id][] = [
            (int)($r['ts']      ?? time()),
            (int)(bool)($r['up']    ?? false),
            (int)($r['latency'] ?? 0),
            (int)($r['code']    ?? 0),
        ];

        if (count($history[$id]) > MAX_HISTORY) {
            $history[$id] = array_slice($history[$id], -MAX_HISTORY);
        }
    }

    writeJ('uptime_history.json', $history);
    pushOk(['recorded' => count($body)], 'Recorded ' . count($body) . ' results');
}

pushErr('Method not allowed', 405);
