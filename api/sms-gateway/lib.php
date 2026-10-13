<?php
// ─── Shared SMS Gateway sync logic ───────────────────────────────────────
// Used by both sync.php (per-project button) and sync-all.php (auto-sync on
// page load — one HTTP request instead of 3 parallel to avoid race conditions
// with PHP's built-in dev server env-loading).
require_once __DIR__ . '/../helpers.php';

const SMSGW_VALID_PROJECTS = ['tmn', 'nano', 'welth'];

const SMSGW_GATEWAY_MAP = [
    'FH'     => 'Firt-hop',
    'IFB_HK' => 'Infobip HK',
    'IFB_SG' => 'Infobip SG',
];

// Uses envFallback() from helpers.php — see comments there for why this is
// necessary (getenv/constants can be stale on long-lived FPM workers).
function smsgwProjectConfig(string $project): ?array {
    if ($project === 'tmn') {
        return [
            'user'     => envFallback('JENKINS_USER'),
            'baseUrl'  => 'https://jenkins-ops.private-a-cloud1p.ascendmoney.io/job/acm-config-server-sms-notification',
            'token'    => envFallback('JENKINS_TMN_TOKEN'),
            'paramKey' => 'presets',
        ];
    }
    if ($project === 'nano') {
        return [
            'user'     => envFallback('JENKINS_USER'),
            'baseUrl'  => 'https://jenkins-eks-cicd.private-a-cloud1p.ascendnano.io/job/Change%20SMS%20provider',
            'token'    => envFallback('JENKINS_NANO_TOKEN'),
            'paramKey' => 'PROVIDER',
        ];
    }
    if ($project === 'welth') {
        return [
            'user'     => envFallback('JENKINS_WELTH_USER') ?: envFallback('JENKINS_USER'),
            'baseUrl'  => 'https://core-jenkins-eks-cicd.private-cloud1p.ascendwealth.io/view/SMC/job/Change%20SMS',
            'token'    => envFallback('JENKINS_WELTH_TOKEN'),
            'paramKey' => 'PROVIDER',
        ];
    }
    return null;
}

function smsgwGet(string $url, string $user, string $token): ?array {
    $host = hostFromUrl($url);
    // Skip the request entirely if this Jenkins host just failed. Sync loops
    // walk N build numbers — without this, one dead host burned 3s × N per
    // page load, freezing SMS Gateway for everyone.
    if (hostCooldownActive($host)) return null;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD        => "$user:$token",
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_NOSIGNAL       => 1,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);
    applyDnsOverrides($ch, $url);
    $body   = curl_exec($ch);
    $err    = curl_error($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($err || !$body || $status !== 200) {
        if ($err !== '' || $status === 0 || $status >= 500) {
            hostCooldownMark($host, $err !== '' ? $err : "HTTP {$status}");
        }
        return null;
    }
    return json_decode($body, true) ?: null;
}

function smsgwGetParam(array $actions, string $key): ?string {
    foreach ($actions as $action) {
        if (($action['_class'] ?? '') === 'hudson.model.ParametersAction') {
            foreach ($action['parameters'] ?? [] as $p) {
                if (($p['name'] ?? '') === $key) return $p['value'] ?? null;
            }
        }
    }
    return null;
}

function smsgwTriggeredBy(array $actions): string {
    foreach ($actions as $action) {
        if (($action['_class'] ?? '') === 'hudson.model.CauseAction') {
            return $action['causes'][0]['userName'] ?? '';
        }
    }
    return '';
}

// Sync one project. Returns ['ok' => bool, 'added' => int, 'error' => string?,
// 'records' => array]. Never throws / never respondError — caller decides.
function smsgwSyncProject(string $project, array $payload): array {
    $cfg = smsgwProjectConfig($project);
    if (!$cfg) return ['ok' => false, 'added' => 0, 'error' => 'Invalid project', 'records' => []];

    if (!$cfg['token']) {
        // Missing env — treat as a soft failure so other projects still run.
        // Include which env var is missing so the user can fix it.
        $envVar = $project === 'tmn' ? 'JENKINS_TMN_TOKEN'
                : ($project === 'nano' ? 'JENKINS_NANO_TOKEN' : 'JENKINS_WELTH_TOKEN');
        return ['ok' => false, 'added' => 0, 'error' => "Jenkins token missing ($envVar in .env)", 'records' => []];
    }

    $file      = "sms_gateway_{$project}.json";
    $records   = readJson($file);
    $lastBuild = 0;
    foreach ($records as $r) {
        if (($r['build_number'] ?? 0) > $lastBuild) $lastBuild = $r['build_number'];
    }

    $latest = smsgwGet("{$cfg['baseUrl']}/lastBuild/api/json", $cfg['user'], $cfg['token']);
    if (!$latest) return ['ok' => false, 'added' => 0, 'error' => 'เชื่อมต่อ Jenkins ไม่ได้', 'records' => []];

    $latestNum = (int)($latest['number'] ?? 0);
    if (!$latestNum || $latestNum <= $lastBuild) {
        return ['ok' => true, 'added' => 0, 'error' => null, 'records' => []];
    }

    $currentYear = (int)date('Y');
    $startNum    = max($lastBuild + 1, $lastBuild === 0 ? max(1, $latestNum - 199) : 1);

    $newRecords  = [];
    $existingIds = array_column($records, 'build_number');

    for ($n = $startNum; $n <= $latestNum; $n++) {
        if (in_array($n, $existingIds)) continue;

        $build = smsgwGet("{$cfg['baseUrl']}/{$n}/api/json", $cfg['user'], $cfg['token']);
        if (!$build) continue;

        $startMs   = (int)($build['timestamp'] ?? 0);
        $buildYear = $startMs ? (int)date('Y', (int)($startMs / 1000)) : 0;
        if ($buildYear && $buildYear < $currentYear) continue;

        $fromVal = null;
        if ($n > 1) {
            $prevUrl = !empty($build['previousBuild']['url'])
                ? $build['previousBuild']['url'] . 'api/json'
                : "{$cfg['baseUrl']}/" . ($n - 1) . '/api/json';
            $prev = smsgwGet($prevUrl, $cfg['user'], $cfg['token']);
            if ($prev) $fromVal = smsgwGetParam($prev['actions'] ?? [], $cfg['paramKey']);
        }

        $toVal = smsgwGetParam($build['actions'] ?? [], $cfg['paramKey']);
        $durMs = (int)($build['duration'] ?? 0);

        $newRecords[] = [
            'id'           => genId('smsgw'),
            'build_number' => (int)$build['number'],
            'switch_start' => $startMs ? date('c', (int)($startMs / 1000)) : '',
            'switch_end'   => ($startMs && $durMs) ? date('c', (int)(($startMs + $durMs) / 1000)) : '',
            'from_gateway' => SMSGW_GATEWAY_MAP[$fromVal] ?? ($fromVal ?: '—'),
            'to_gateway'   => SMSGW_GATEWAY_MAP[$toVal]   ?? ($toVal   ?: '—'),
            'triggered_by' => smsgwTriggeredBy($build['actions'] ?? []),
            'remark'       => '',
            'created_at'   => date('c'),
        ];
    }

    if (!empty($newRecords)) {
        foreach ($newRecords as $r) $records[] = $r;
        writeJson($file, $records);
        logActivity('sms_gateway_sync', [
            'project' => $project,
            'added'   => count($newRecords),
        ], $payload['sub'], $payload['name']);
    }

    return ['ok' => true, 'added' => count($newRecords), 'error' => null, 'records' => $newRecords];
}
