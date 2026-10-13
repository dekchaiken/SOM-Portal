<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$FILE    = 'fh_email_config.json';
$PROJECTS = ['tmn', 'nano', 'welth', 'all'];

if ($method === 'GET') {
    $cfg = readJson($FILE);
    respondOk($cfg);
}

if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);

    $body = getBody();
    $cfg  = readJson($FILE);

    foreach ($PROJECTS as $proj) {
        if (!isset($body[$proj])) continue;
        $p = $body[$proj];

        $to  = array_values(array_filter(
            array_map('trim', (array)($p['to'] ?? [])),
            fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
        ));
        $cc  = array_values(array_filter(
            array_map('trim', (array)($p['cc'] ?? [])),
            fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
        ));

        $cfg[$proj] = [
            'to'      => $to,
            'cc'      => $cc,
            'dear'    => trim($p['dear']    ?? ''),
            'subject' => trim($p['subject'] ?? ''),
        ];
    }

    writeJson($FILE, $cfg);
    logActivity('fh_email_config_save', [], $payload['sub'], $payload['name']);
    respondOk(null, 'บันทึก Email Config แล้ว');
}

respondError('Method not allowed', 405);
