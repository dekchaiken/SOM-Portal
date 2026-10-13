<?php
/**
 * /api/batch-monitor-noti/index.php
 *
 * Admin CRUD for per-Jenkins-server webhook config used by tick.php.
 * Storage: data/batch-monitor-noti-config.json
 *   { "servers": { "<serverId>": { "enabled": bool, "webhook_url": "...",
 *                                  "updated_at": "...", "updated_by": "..." } } }
 *
 * Routes:
 *   GET    /                          → list servers + effective config + recent log
 *   PUT    /?server=<id>              → save { enabled, webhook_url }         (admin, CSRF)
 *   DELETE /?server=<id>              → clear config for that server           (admin, CSRF)
 *   POST   /?action=test&server=<id>  → send test card                         (admin, CSRF)
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../restart-monitor/_notify.php'; // postToChatThread()

const BMN_CONFIG_FILE = 'batch-monitor-noti-config.json';
const BMN_LOG_FILE    = 'batch-monitor-noti-log.json';
const BMN_STATE_FILE  = 'batch-monitor-noti-state.json';

function bmnLoadConfig(): array {
    $c = readJson(BMN_CONFIG_FILE);
    if (!isset($c['servers']) || !is_array($c['servers'])) $c = ['servers' => []];
    return $c;
}

function bmnSaveConfig(array $c): bool {
    return writeJson(BMN_CONFIG_FILE, $c);
}

function bmnMaskUrl(string $url): string {
    if ($url === '') return '';
    $parts = @parse_url($url);
    if (!$parts || empty($parts['host'])) return '***';
    $scheme = $parts['scheme'] ?? 'https';
    $host   = $parts['host'];
    $path   = $parts['path'] ?? '';
    if (strlen($path) > 12) {
        $path = substr($path, 0, 6) . '…' . substr($path, -4);
    }
    return "{$scheme}://{$host}{$path}?…";
}

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: list ──────────────────────────────────────────────────────
if ($method === 'GET') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);

    $config    = bmnLoadConfig();
    $servers   = readJson('jenkins_servers.json');   // full list, including disabled
    $log       = readJson(BMN_LOG_FILE);
    $state     = readJson(BMN_STATE_FILE);

    // ── Roll up state.json → per-server counts by result ─────
    // state key format is "<serverId>__<jobPath>" — parse it to bucket by server
    $stateSummary = [];  // serverId → { total, statusCounts, jobs[] }
    foreach ($state as $key => $entry) {
        $parts = explode('__', $key, 2);
        if (count($parts) !== 2) continue;
        [$sid, $jobPath] = $parts;
        if (!isset($stateSummary[$sid])) {
            $stateSummary[$sid] = [
                'total'        => 0,
                'statusCounts' => ['SUCCESS'=>0,'FAILURE'=>0,'ABORTED'=>0,'UNSTABLE'=>0],
                'lastUpdated'  => null,
                'jobs'         => [],
            ];
        }
        $result = $entry['result'] ?? '';
        $stateSummary[$sid]['total']++;
        if (isset($stateSummary[$sid]['statusCounts'][$result])) {
            $stateSummary[$sid]['statusCounts'][$result]++;
        }
        $upd = $entry['updatedAt'] ?? null;
        if ($upd && (!$stateSummary[$sid]['lastUpdated'] || $upd > $stateSummary[$sid]['lastUpdated'])) {
            $stateSummary[$sid]['lastUpdated'] = $upd;
        }
        $stateSummary[$sid]['jobs'][] = [
            'jobPath'     => $jobPath,
            'result'      => $result,
            'buildNumber' => $entry['buildNumber'] ?? null,
            'updatedAt'   => $upd,
        ];
    }

    $rows = [];
    foreach ($servers as $srv) {
        $id      = $srv['id'] ?? '';
        if ($id === '') continue;
        $entry   = $config['servers'][$id] ?? [];
        $webhook = trim($entry['webhook_url'] ?? '');
        $summary = $stateSummary[$id] ?? null;
        $rows[] = [
            'id'          => $id,
            'display'     => $srv['display'] ?? $id,
            'base_url'    => $srv['base_url'] ?? '',
            'enabled'     => (bool)($entry['enabled'] ?? false),
            'hasWebhook'  => $webhook !== '',
            'webhookMasked' => bmnMaskUrl($webhook),
            'srvEnabled'  => (bool)($srv['enabled'] ?? false),
            'ignoreRules' => count(array_filter($srv['job_rules'] ?? [], fn($r) => ($r['type'] ?? '') === 'ignore')),
            'trackedTotal'   => $summary['total']        ?? 0,
            'trackedCounts'  => $summary['statusCounts'] ?? ['SUCCESS'=>0,'FAILURE'=>0,'ABORTED'=>0,'UNSTABLE'=>0],
            'trackedUpdated' => $summary['lastUpdated']  ?? null,
            'updated_at'  => $entry['updated_at'] ?? null,
            'updated_by'  => $entry['updated_by'] ?? null,
        ];
    }

    // Recent log (last 100, newest first) — enough for per-server tabs to still show plenty
    $recent = array_slice(array_reverse($log, true), 0, 100, true);
    $recentList = [];
    foreach ($recent as $key => $entry) {
        $recentList[] = [
            'key'         => $key,
            'sent_at'     => $entry['sent_at']     ?? '',
            'status'      => $entry['status']      ?? '',
            'server'      => $entry['server']      ?? '',
            'job'         => $entry['job']         ?? '',
            'buildNumber' => $entry['buildNumber'] ?? null,
            'transition'  => $entry['transition']  ?? '',
            'reason'      => $entry['reason']      ?? null,
        ];
    }

    // Per-server tracked jobs (for inspector panel)
    $trackedByServer = [];
    foreach ($stateSummary as $sid => $sum) {
        // Sort jobs: FAILURE/UNSTABLE first, then most-recent updates
        usort($sum['jobs'], function($a, $b) {
            $rank = ['FAILURE'=>0,'UNSTABLE'=>1,'ABORTED'=>2,'SUCCESS'=>3];
            $ra = $rank[$a['result']] ?? 9;
            $rb = $rank[$b['result']] ?? 9;
            if ($ra !== $rb) return $ra - $rb;
            return strcmp($b['updatedAt'] ?? '', $a['updatedAt'] ?? '');
        });
        $trackedByServer[$sid] = $sum['jobs'];
    }

    respondOk([
        'servers'         => $rows,
        'recent'          => $recentList,
        'trackedByServer' => $trackedByServer,
        'storage'         => [
            'stateEntries' => count($state),
            'logEntries'   => count($log),
            'stateBytes'   => @filesize(DATA_DIR . BMN_STATE_FILE) ?: 0,
            'logBytes'     => @filesize(DATA_DIR . BMN_LOG_FILE)   ?: 0,
            'logCap'       => 500,
        ],
    ]);
}

// ── admin + CSRF for state-changing routes ─────────────────────────
$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);
requireCsrf();

// ── PUT: save webhook + enabled for one server ─────────────────────
if ($method === 'PUT') {
    $serverId = trim($_GET['server'] ?? '');
    if ($serverId === '') respondError('server (id) required', 400);

    $servers = readJson('jenkins_servers.json');
    $known   = array_filter($servers, fn($s) => ($s['id'] ?? '') === $serverId);
    if (!$known) respondError("Unknown Jenkins server '{$serverId}'", 404);

    $body    = getBody();
    $enabled = (bool)($body['enabled'] ?? false);

    // If webhook_url is omitted (not just empty string), keep the existing one
    // so admin can toggle enabled without re-pasting the URL.
    $config  = bmnLoadConfig();
    $existing = $config['servers'][$serverId] ?? [];
    $urlProvided = array_key_exists('webhook_url', $body);
    $url = $urlProvided ? trim((string)$body['webhook_url']) : trim($existing['webhook_url'] ?? '');

    if ($enabled && $url === '') respondError('webhook_url required when enabled', 400);
    if ($url !== '' && !filter_var($url, FILTER_VALIDATE_URL)) {
        respondError('webhook_url must be a valid URL', 400);
    }

    $config['servers'][$serverId] = [
        'enabled'     => $enabled,
        'webhook_url' => $url,
        'updated_at'  => date('c'),
        'updated_by'  => $payload['name'] ?? $payload['sub'],
    ];
    if (!bmnSaveConfig($config)) respondError('Failed to write config', 500);

    logActivity('batch_monitor_noti_webhook_save', [
        'server'  => $serverId,
        'enabled' => $enabled,
        'hasUrl'  => $url !== '',
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk([
        'server'        => $serverId,
        'enabled'       => $enabled,
        'hasWebhook'    => $url !== '',
        'webhookMasked' => bmnMaskUrl($url),
    ], 'Saved');
}

// ── DELETE: clear config for one server ────────────────────────────
if ($method === 'DELETE') {
    $serverId = trim($_GET['server'] ?? '');
    if ($serverId === '') respondError('server (id) required', 400);

    $config = bmnLoadConfig();
    if (!isset($config['servers'][$serverId])) {
        respondOk(['server' => $serverId], 'Nothing to clear');
    }
    unset($config['servers'][$serverId]);
    if (!bmnSaveConfig($config)) respondError('Failed to write config', 500);

    logActivity('batch_monitor_noti_webhook_clear', [
        'server' => $serverId,
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk(['server' => $serverId], 'Cleared');
}

// ── POST ?action=test — send a test card ───────────────────────────
if ($method === 'POST') {
    $action = $_GET['action'] ?? '';
    if ($action !== 'test') respondError('Unknown action', 400);

    $serverId = trim($_GET['server'] ?? '');
    if ($serverId === '') respondError('server (id) required', 400);

    $servers = readJson('jenkins_servers.json');
    $srvRow  = null;
    foreach ($servers as $s) {
        if (($s['id'] ?? '') === $serverId) { $srvRow = $s; break; }
    }
    if (!$srvRow) respondError("Unknown Jenkins server '{$serverId}'", 404);
    $serverDisp = $srvRow['display'] ?? $serverId;

    $body = getBody();
    // Prefer URL in body (test-before-save); otherwise use configured URL
    $url = trim($body['url'] ?? '');
    if ($url === '') {
        $config = bmnLoadConfig();
        $url    = trim($config['servers'][$serverId]['webhook_url'] ?? '');
    }
    if ($url === '') respondError('No webhook URL to test — set one or pass `url` in body', 400);
    if (!filter_var($url, FILTER_VALIDATE_URL)) respondError('URL is not valid', 400);

    $now      = (new DateTime('now', new DateTimeZone('Asia/Bangkok')))->format('Y-m-d H:i:s');
    $username = $payload['name'] ?? $payload['sub'] ?? 'admin';

    $card = [
        'cardsV2' => [[
            'cardId' => 'batch-monitor-noti-test-' . $serverId,
            'card'   => [
                'header' => [
                    'title'    => $serverDisp,
                    'subtitle' => '🧪 Batch Monitor Noti · Test',
                ],
                'sections' => [
                    ['widgets' => [
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'check_circle']],
                            'topLabel'  => 'Result',
                            'text'      => '<b><font color="#16a34a">Webhook reachable</font></b>',
                        ]],
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'person']],
                            'topLabel'  => 'Triggered by',
                            'text'      => htmlspecialchars($username, ENT_QUOTES, 'UTF-8'),
                        ]],
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'schedule']],
                            'topLabel'  => 'Time (Asia/Bangkok)',
                            'text'      => $now,
                        ]],
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'info']],
                            'topLabel'  => 'Note',
                            'text'      => 'Test message from admin panel. Real cards fire when a build\'s state changes (fail / aborted / recover).',
                        ]],
                    ]],
                ],
            ],
        ]],
    ];

    $threadKey = 'batch-monitor-noti-test-' . strtolower(preg_replace('/\W+/', '-', $serverId));
    $res       = postToChatThread($url, $card, $threadKey);

    logActivity('batch_monitor_noti_webhook_test', [
        'server'   => $serverId,
        'sent'     => $res['sent']     ?? false,
        'httpCode' => $res['httpCode'] ?? null,
    ], $payload['sub'], $payload['name'] ?? '');

    if (!($res['sent'] ?? false)) {
        respondError('Test send failed: ' . ($res['reason'] ?? 'unknown'), 502);
    }
    respondOk(['server' => $serverId, 'httpCode' => $res['httpCode'] ?? 200], 'Test sent');
}

respondError('Method not allowed', 405);
