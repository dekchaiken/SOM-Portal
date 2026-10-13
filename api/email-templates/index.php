<?php
/**
 * email-templates/index.php
 * Per-team overrides for transactional email subject/intro copy.
 * Storage: data/{team}/email_templates.json  (empty {} = use defaults)
 *
 * GET → { templates: {key: {subject, intro}}, defaults: {...}, placeholders: [...] }
 * PUT → { welcome?: {subject, intro}, reset_password_admin?: {...}, reset_password_forgot?: {...} }
 *
 * Only super_admin may edit (uses X-Admin-Team view-as context to target a team).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_defaults.php';

$method  = $_SERVER['REQUEST_METHOD'];
$payload = requireAuth();
requireRole($payload, ['super_admin']);

const TEMPLATE_FILE = 'email_templates.json';

// Keys we accept. Anything else is dropped.
$ALLOWED_KEYS = ['welcome', 'reset_password_admin', 'reset_password_forgot'];

if ($method === 'GET') {
    $saved    = readJson(TEMPLATE_FILE);
    $defaults = emailTemplateDefaults();
    $out = [];
    foreach ($ALLOWED_KEYS as $key) {
        $out[$key] = [
            'subject' => trim((string)($saved[$key]['subject'] ?? '')) !== ''
                ? (string)$saved[$key]['subject']
                : $defaults[$key]['subject'],
            'intro'   => trim((string)($saved[$key]['intro'] ?? '')) !== ''
                ? (string)$saved[$key]['intro']
                : $defaults[$key]['intro'],
            'is_default' => empty($saved[$key]['subject']) && empty($saved[$key]['intro']),
        ];
    }
    respondOk([
        'templates'    => $out,
        'defaults'     => $defaults,
        'placeholders' => [
            ['token' => '{name}',     'desc' => 'ชื่อผู้รับ'],
            ['token' => '{app_name}', 'desc' => 'ชื่อระบบของทีม (จาก Mail Config → from_name)'],
        ],
    ]);
}

if ($method === 'PUT') {
    requireCsrf();
    $body = getBody();
    $saved = readJson(TEMPLATE_FILE);

    foreach ($ALLOWED_KEYS as $key) {
        if (!isset($body[$key]) || !is_array($body[$key])) continue;
        $subject = trim((string)($body[$key]['subject'] ?? ''));
        $intro   = trim((string)($body[$key]['intro']   ?? ''));
        // Empty → clear override (falls back to default)
        if ($subject === '' && $intro === '') {
            unset($saved[$key]);
            continue;
        }
        $saved[$key] = ['subject' => $subject, 'intro' => $intro];
    }

    writeJson(TEMPLATE_FILE, $saved);
    logActivity('email_templates_updated', [
        'team' => $GLOBALS['_current_team'] ?? 'unknown',
        'keys' => array_values(array_intersect(array_keys((array)$body), $ALLOWED_KEYS)),
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk($saved, 'Email templates saved');
}

respondError('Method not allowed', 405);
