<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// ── GET — return all monitors + computed stats ─────────────────────────────────
if ($method === 'GET') {
    $monitors = readJson('uptime_monitors.json') ?: [];
    $history  = readJson('uptime_history.json')  ?: [];

    $result = [];
    foreach ($monitors as $mon) {
        $id   = $mon['id'];
        $hist = $history[$id] ?? [];
        $len  = count($hist);

        $last60  = array_slice($hist, -60);
        $last60c = count($last60);

        // Uptime percentages
        $allUp  = $len      > 0 ? count(array_filter($hist,   fn($h) => $h[1])) : null;
        $l60Up  = $last60c  > 0 ? count(array_filter($last60, fn($h) => $h[1])) : null;
        $uptime7d = $allUp  !== null ? round($allUp  / $len      * 100, 2) : null;
        $uptime1h = $l60Up  !== null ? round($l60Up  / $last60c  * 100, 2) : null;

        // Latency (successful checks in last 60)
        $latencies = array_filter(
            array_map(fn($h) => ($h[1] && $h[2] > 0) ? $h[2] : null, $last60),
            fn($v) => $v !== null
        );
        $latencyAvg  = count($latencies) ? (int)(array_sum($latencies) / count($latencies)) : null;
        $latencyLast = null;
        foreach (array_reverse($hist) as $h) {
            if ($h[1] && $h[2] > 0) { $latencyLast = $h[2]; break; }
        }

        $lastH  = $hist ? $hist[$len - 1] : null;
        $isUp   = $lastH !== null ? (bool)$lastH[1] : null;
        $lastTs = $lastH ? date('c', $lastH[0]) : null;

        $result[] = [
            'id'           => $id,
            'name'         => $mon['name'],
            'url'          => $mon['url'],
            'is_up'        => $isUp,
            'last_checked' => $lastTs,
            'uptime_7d'    => $uptime7d,
            'uptime_1h'    => $uptime1h,
            'latency_avg'  => $latencyAvg,
            'latency_last' => $latencyLast,
            'history'      => array_values(array_map(fn($h) => [
                'ts'      => $h[0],
                'up'      => (bool)$h[1],
                'latency' => $h[2],
                'code'    => $h[3] ?? 0,
            ], $last60)),
        ];
    }

    respondOk($result);
}

// ── POST — add monitor (admin) ─────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = trim($body['name'] ?? '');
    $url  = trim($body['url']  ?? '');

    if (!$name || !$url) respondError('name and url required');
    if (!filter_var($url, FILTER_VALIDATE_URL)) respondError('Invalid URL format');

    $monitors = readJson('uptime_monitors.json') ?: [];

    foreach ($monitors as $m) {
        if ($m['url'] === $url) respondError('URL นี้มีอยู่แล้ว');
    }

    $id = 'mon_' . substr(md5(uniqid()), 0, 8);
    $monitors[] = ['id' => $id, 'name' => $name, 'url' => $url, 'created_at' => date('c')];
    writeJson('uptime_monitors.json', $monitors);

    logActivity('uptime_monitor_add', ['id' => $id, 'name' => $name, 'url' => $url], $payload['sub'], $payload['name']);
    respondOk(['id' => $id], 'Monitor added');
}

// ── DELETE — remove monitor (admin) ───────────────────────────────────────────
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);

    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required');

    $monitors = readJson('uptime_monitors.json') ?: [];
    $monitors = array_values(array_filter($monitors, fn($m) => $m['id'] !== $id));
    writeJson('uptime_monitors.json', $monitors);

    $hist = readJson('uptime_history.json') ?: [];
    unset($hist[$id]);
    writeJson('uptime_history.json', $hist);

    logActivity('uptime_monitor_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
