<?php
/**
 * GET    /api/restart-monitor/monthly-recipients.php   → { to: [...], cc: [...] }
 * POST   /api/restart-monitor/monthly-recipients.php   → replace stored lists
 *        body: { to: [...emails], cc: [...emails] }
 *        legacy body: { recipients: [...emails] }  (treated as `to`)
 *
 * Stored at data/grafana-monitoring/monthly-recipients.json:
 *   { "to": [...], "cc": [...], "recipients": [...] }
 *   `recipients` is kept in sync with `to` so older readers (autonomous monthly
 *   routine, send-monthly.php fallback) keep working.
 */

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

$file = teamDataPath('grafana-monitoring/monthly-recipients.json');
$dir  = dirname($file);
if (!is_dir($dir)) @mkdir($dir, 0775, true);

function loadList(string $file): array {
    if (!file_exists($file)) return ['to' => ['warapon.lea@ascendcorp.com'], 'cc' => [], 'recipients' => ['warapon.lea@ascendcorp.com']];
    $d = json_decode(file_get_contents($file), true);
    if (!is_array($d)) return ['to' => [], 'cc' => [], 'recipients' => []];

    // Backward-compat: file stored only `recipients` originally.
    $to = isset($d['to']) && is_array($d['to'])
        ? array_values($d['to'])
        : (isset($d['recipients']) && is_array($d['recipients']) ? array_values($d['recipients']) : []);
    $cc = isset($d['cc']) && is_array($d['cc']) ? array_values($d['cc']) : [];
    return ['to' => $to, 'cc' => $cc, 'recipients' => $to];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    respondOk(loadList($file));
}

if ($method === 'POST') {
    requireRole($payload, LEAD_ROLES);
    // Recipient list lives under data/sm/grafana-monitoring/ (SM-shared) — only
    // SM can edit; non-SM teams get 403 even if their user is sm_lead+.
    requireSmForShared();
    $body = getBody();

    $sanitize = function ($raw): array {
        $out = [];
        foreach ((array)$raw as $e) {
            $e = trim((string)$e);
            if ($e === '') continue;
            if (!filter_var($e, FILTER_VALIDATE_EMAIL)) {
                respondError("Invalid email: $e", 400);
            }
            $out[] = $e;
        }
        return array_values(array_unique($out));
    };

    // Accept new shape { to, cc } OR legacy { recipients }
    $toIn = $body['to']         ?? $body['recipients'] ?? [];
    $ccIn = $body['cc']         ?? [];

    $to = $sanitize($toIn);
    $cc = $sanitize($ccIn);

    // Prevent the same email from appearing in both lists (CC wins removal)
    $cc = array_values(array_diff($cc, $to));

    $stored = ['to' => $to, 'cc' => $cc, 'recipients' => $to];
    if (!writeJson('grafana-monitoring/monthly-recipients.json', $stored)) {
        respondError('Failed to save recipient list', 500);
    }

    logActivity('restart_monitor_recipients_update', [
        'to_count' => count($to),
        'cc_count' => count($cc),
        'by'       => $payload['userName'] ?? $payload['userId'] ?? '',
    ]);

    respondOk($stored);
}

respondError('Method not allowed', 405);
