<?php
/**
 * GET  /api/courses/page-config.php   → fetch learn-page UI config (any auth)
 * PUT  /api/courses/page-config.php   → update learn-page UI config (admin)
 *
 * Stored at data/courses/page-config.json
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

$defaults = [
    'hero_title'      => '',           // empty → use "สวัสดี {name} 👋" on learn.html
    'hero_subtitle'   => '',           // empty → use the original bolded HTML default
    'accent_color'    => '#f26419',
    'layout_density'  => 'comfortable', // 'compact' | 'comfortable' | 'spacious'
    'show_tab_badge'  => true,
];

function pageConfigGet(array $defaults): array {
    $current = coursesReadJson('page-config.json');
    if (!is_array($current)) $current = [];
    return array_merge($defaults, $current);
}

if ($method === 'GET') {
    respondOk(pageConfigGet($defaults));
}

if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    $body    = getBody();
    $current = pageConfigGet($defaults);

    if (isset($body['hero_title']))    $current['hero_title']    = trim((string)$body['hero_title']);
    if (isset($body['hero_subtitle'])) $current['hero_subtitle'] = trim((string)$body['hero_subtitle']);

    if (isset($body['accent_color'])) {
        $c = trim((string)$body['accent_color']);
        if (preg_match('/^#[0-9a-fA-F]{6}$/', $c)) $current['accent_color'] = $c;
    }

    if (isset($body['layout_density'])) {
        $d = (string)$body['layout_density'];
        if (in_array($d, ['compact', 'comfortable', 'spacious'], true)) {
            $current['layout_density'] = $d;
        }
    }

    if (isset($body['show_tab_badge'])) {
        $current['show_tab_badge'] = (bool)$body['show_tab_badge'];
    }

    coursesWriteJson('page-config.json', $current);
    logActivity('learn_page_config_update', array_keys($body), $payload['sub'], $payload['name']);
    respondOk($current, 'Saved');
}

respondError('Method not allowed', 405);
