<?php
// ══════════════════════════════════════════════════════════════════
//  Admin: CRUD for the Jenkins jobs list used by MA Status.
//    GET  → { jobs: [...], source: 'default'|'override' }
//    PUT  → { jobs: [...] }        (replace list; empty array = reset to defaults)
//  Requires admin role.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $override = readJson('ma-status-jenkins.json');
    $isOverride = is_array($override) && !empty($override);
    respondOk([
        'jobs'   => $isOverride ? $override : ma_default_jenkins_jobs(),
        'source' => $isOverride ? 'override' : 'default',
    ]);
}

if ($method === 'PUT' || $method === 'POST') {
    $body = getBody();
    $jobs = $body['jobs'] ?? null;
    if (!is_array($jobs)) respondError('jobs must be an array', 400);

    // Empty array → clear override, revert to defaults
    if (count($jobs) === 0) {
        writeJson('ma-status-jenkins.json', []);
        logActivity('ma_status_jobs_reset', ['count' => 0]);
        // Invalidate the response cache so users see the new list on next fetch
        writeJson('ma-status-cache.json', []);
        respondOk(['jobs' => ma_default_jenkins_jobs(), 'source' => 'default', 'reset' => true]);
    }

    // Validate & normalize each entry
    $clean = [];
    $required = ['label', 'server', 'path', 'state_param'];
    foreach ($jobs as $i => $j) {
        foreach ($required as $k) {
            if (empty($j[$k])) respondError("Job #$i is missing '$k'", 400);
        }
        // on_values: accept array or comma-separated string
        $onValues = $j['on_values'] ?? [];
        if (is_string($onValues)) {
            $onValues = array_map('trim', explode(',', $onValues));
            $onValues = array_values(array_filter($onValues, fn($v) => $v !== ''));
        }
        if (!is_array($onValues) || count($onValues) === 0) {
            respondError("Job #$i needs at least one 'on_value'", 400);
        }
        $clean[] = [
            'label'       => (string)$j['label'],
            'server'      => (string)$j['server'],
            'path'        => (string)$j['path'],
            'state_param' => (string)$j['state_param'],
            'on_values'   => array_values($onValues),
            'critical'    => !empty($j['critical']),
            'extra_param' => !empty($j['extra_param']) ? (string)$j['extra_param'] : null,
            'note'        => !empty($j['note']) ? (string)$j['note'] : null,
        ];
    }

    writeJson('ma-status-jenkins.json', $clean);
    writeJson('ma-status-cache.json', []); // invalidate the shared response cache
    logActivity('ma_status_jobs_saved', ['count' => count($clean)]);
    respondOk(['jobs' => $clean, 'source' => 'override', 'saved' => count($clean)]);
}

respondError('Method not allowed', 405);
