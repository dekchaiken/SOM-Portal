<?php
/**
 * GET  /api/onboarding/config.php            → onboarding config (any authed user)
 * PUT  /api/onboarding/config.php            → replace config (admin)
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $isAdmin = in_array($payload['role'] ?? '', ADMIN_ROLES, true);
    $cfg = onboardingGetConfig();
    if (!$isAdmin) {
        // Strip correct_choice_id and explain from scored_quiz questions so answers can't be read from API
        foreach ($cfg['chapters'] as &$ch) {
            foreach ($ch['blocks'] as &$block) {
                if (($block['type'] ?? '') !== 'scored_quiz') continue;
                foreach ($block['questions'] as &$q) {
                    unset($q['correct_choice_id'], $q['explain']);
                }
                unset($q);
            }
            unset($block);
        }
        unset($ch);
    }
    respondOk($cfg);
}

requireRole($payload, ADMIN_ROLES);
requireCsrf();

if ($method === 'PUT') {
    $body = getBody();
    if (!isset($body['chapters']) || !is_array($body['chapters'])) {
        respondError('chapters array is required');
    }

    // Normalize + basic validation
    $chapters = [];
    foreach ($body['chapters'] as $i => $raw) {
        if (!is_array($raw)) continue;
        $chapters[] = [
            'id'          => trim($raw['id'] ?? ('ch' . ($i + 1))),
            'order'       => (int)($raw['order'] ?? ($i + 1)),
            'label'       => trim($raw['label'] ?? ('บทที่ ' . ($i + 1))),
            'title'       => trim($raw['title'] ?? ''),
            'description' => trim($raw['description'] ?? ''),
            'blocks'      => is_array($raw['blocks'] ?? null) ? array_values($raw['blocks']) : [],
            'tasks'       => is_array($raw['tasks']  ?? null) ? array_values($raw['tasks'])  : [],
        ];
    }

    $cfg = [
        'version'            => (int)($body['version'] ?? 1),
        'updated_at'         => date('c'),
        'intro'              => $body['intro'] ?? null,
        'chapters'           => $chapters,
        'flow_architecture'  => $body['flow_architecture'] ?? null,
    ];

    onboardingWriteJson('config.json', $cfg);
    logActivity('onboarding_config_update', ['chapters' => count($chapters)], $payload['sub'], $payload['name']);
    respondOk($cfg, 'Config updated');
}

respondError('Method not allowed', 405);
