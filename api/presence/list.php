<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$presence = readJson('presence.json');
if (!is_array($presence)) $presence = [];

$now      = time();
$onlineTh = 90; // 90 seconds = still online

$online = [];
foreach ($presence as $entry) {
    if (!is_array($entry)) continue;
    $ts = (int)($entry['ts'] ?? 0);
    if ($ts >= $now - $onlineTh) {
        // don't leak avatar (can be huge base64) — office view will fetch via users API
        unset($entry['avatar_url']);
        $entry['seconds_ago'] = $now - $ts;
        $online[] = $entry;
    }
}

respondOk($online);
