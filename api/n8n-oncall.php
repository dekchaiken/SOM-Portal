<?php
/**
 * n8n-oncall.php
 * ดึงข้อมูล External On-call จาก n8n workflow
 * 
 * Endpoints:
 *  GET ?date=YYYY-MM-DD    → on-call for that date (default = today)
 *  GET ?refresh=1          → bypass cache
 */
require_once __DIR__ . '/helpers.php';

// Team context — required so cache & config are per-team, not shared across tenants.
$payload = requireAuth();

const CACHE_TTL = 1800;  // 30 min

// ── Load n8n configuration ─────────────────────────────────────────
function getN8nConfig(): array {
    $config = readJson('n8n_oncall_config.json');
    if (empty($config)) {
        writeJson('n8n_oncall_config.json', ['webhook_url' => '']);
        respondError(
            'ยังไม่ได้ตั้งค่า n8n webhook URL — ' .
            'ไปที่ Admin → n8n On-call Config',
            400
        );
    }
    if (empty($config['webhook_url'])) {
        respondError('ยังไม่ได้ตั้งค่า webhook URL — ไปที่ Admin → n8n On-call Config', 400);
    }
    return $config;
}

// ── Call n8n webhook ───────────────────────────────────────────────
function callN8nWebhook(string $url, array $params = []): array {
    // Build URL with query params
    if (!empty($params)) {
        $url .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($params);
    }
    
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Content-Type: application/json',
        ],
    ]);
    
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($err) {
        respondError('n8n webhook error: ' . $err, 502);
    }

    if ($status !== 200) {
        $snippet = $body ? ' | body: ' . substr(strip_tags($body), 0, 120) : '';
        respondError('n8n webhook returned HTTP ' . $status . $snippet, 502);
    }

    // Empty body → treat as "no data" (valid — n8n workflow ran but returned nothing)
    if ($body === '' || $body === false || $body === null) {
        return [];
    }

    $json = json_decode($body, true);

    // Not parseable at all
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        $snippet = substr(strip_tags($body), 0, 120);
        respondError('n8n webhook returned non-JSON: ' . $snippet, 502);
    }

    // n8n sometimes returns a single object instead of an array — wrap it
    if (is_array($json) && !isset($json[0])) {
        // Could be associative (single record) or empty {}
        $json = empty($json) ? [] : [$json];
    }

    // Still not array after all that
    if (!is_array($json)) {
        respondError('n8n webhook returned unexpected format: ' . substr($body, 0, 120), 502);
    }

    return $json;
}

// ── Parse n8n response to standard format ──────────────────────────
function parseN8nResponse(array $data, string $date): array {
    $oncall = [];

    if (empty($data)) return [];

    // n8n can return data in several formats:
    // 1. Direct:   [{"team":"TMN","name":"...","phone":"...","date":"..."}]
    // 2. Wrapped:  [{"json":{"team":"TMN",...}}]  ← default n8n output node format
    // 3. Nested:   {"data":[...]} or {"oncall":[...]}

    // Unwrap n8n's default [{"json":{...}}] format
    if (isset($data[0]['json']) && is_array($data[0]['json'])) {
        $data = array_map(fn($row) => $row['json'], $data);
    }

    // Unwrap nested {data:[...]} or {oncall:[...]}
    if (!isset($data[0]) && isset($data['data'])) $data = $data['data'];
    if (!isset($data[0]) && isset($data['oncall'])) $data = $data['oncall'];

    foreach ($data as $item) {
        if (!is_array($item)) continue;

        // Filter by date if provided in response
        if (!empty($item['date']) && $item['date'] !== $date) continue;
        
        $oncall[] = [
            'team'  => $item['team'] ?? 'Unknown',
            'name'  => $item['name'] ?? 'Unknown',
            'phone' => $item['phone'] ?? '',
            'date'  => $item['date'] ?? $date,
        ];
    }

    return $oncall;
}

// ── Cache helpers (team-scoped via readJson/writeJson) ─────────────
function loadCache(string $date): ?array {
    $d = readJson('n8n_oncall_cache.json');
    if (empty($d)) return null;
    if (($d['date'] ?? '') !== $date) return null;
    if ((time() - ($d['ts'] ?? 0)) > CACHE_TTL) return null;
    return $d;
}

function saveCache(string $date, array $oncall): void {
    writeJson('n8n_oncall_cache.json', [
        'ts'     => time(),
        'date'   => $date,
        'oncall' => $oncall,
    ]);
}

// ════════════════════════════════════════════════════════════════════

$date    = $_GET['date']    ?? date('Y-m-d');
$refresh = !empty($_GET['refresh']);

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    respondError('date ต้องเป็นรูปแบบ YYYY-MM-DD', 400);
}

// Check cache first
if (!$refresh) {
    $cached = loadCache($date);
    if ($cached) {
        respondOk([
            'date'      => $date,
            'oncall'    => $cached['oncall'],
            'count'     => count($cached['oncall']),
            'cached'    => true,
            'cache_age' => time() - $cached['ts'],
            'source'    => 'n8n',
        ], 'On-call for ' . $date . ' (cached)');
    }
}

// Fetch from n8n
$config = getN8nConfig();
$data   = callN8nWebhook($config['webhook_url'], ['date' => $date]);
$oncall = parseN8nResponse($data, $date);

// Save to cache
saveCache($date, $oncall);

respondOk([
    'date'   => $date,
    'oncall' => $oncall,
    'count'  => count($oncall),
    'cached' => false,
    'source' => 'n8n',
], 'On-call for ' . $date);
