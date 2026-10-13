<?php
// ══════════════════════════════════════════════════════════════════
//  Jenkins Server Config — reads from data/jenkins_servers.json
//  Credentials are managed in Admin → Jenkins Servers
// ══════════════════════════════════════════════════════════════════

$_rows = readJson('jenkins_servers.json'); // readJson() available from helpers.php

$_result = [];
foreach ($_rows as $_s) {
    if (empty($_s['enabled'])) continue;
    $_result[$_s['id']] = [
        'display'   => $_s['display']   ?? '',
        'base_url'  => $_s['base_url']  ?? '',
        'job_rules' => $_s['job_rules'] ?? [],
        'auth' => [
            'mode'   => $_s['auth_mode']   ?? 'token',
            'user'   => $_s['auth_user']   ?? '',
            'token'  => $_s['auth_token']  ?? '',
            'cookie' => $_s['auth_cookie'] ?? '',
        ],
    ];
}

return $_result;
