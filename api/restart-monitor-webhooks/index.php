<?php
/**
 * /api/restart-monitor-webhooks/index.php — Admin CRUD for per-runway Google
 * Chat webhook URLs used by api/restart-monitor/upload.php → _notify.php.
 *
 * Storage: data/restart-monitor-webhooks.json
 *   { "webhooks": { "<slug>": "<webhook URL>", ... } }
 *
 * Resolution order in _notify.php::_resolveRunwayWebhook():
 *   JSON override → .env[chatWebhookEnv] → .env[RESTART_MONITOR_CHAT_WEBHOOK]
 *
 * Routes:
 *   GET  /                 → list runways + effective URL + source
 *   PUT  /?slug=EKS-TMN    → save override URL                (admin)
 *   DELETE /?slug=EKS-TMN  → clear override (revert to .env)  (admin)
 *   POST /?action=test     → send a test card to a given URL  (admin)
 *
 * All admin writes require CSRF.
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../restart-monitor/_notify.php';

const RM_WEBHOOK_FILE = 'restart-monitor-webhooks.json';

function rmwLoadStore(): array {
    $data = readJson(RM_WEBHOOK_FILE);
    if (!isset($data['webhooks']) || !is_array($data['webhooks'])) {
        $data = ['webhooks' => []];
    }
    if (!isset($data['enabled']) || !is_array($data['enabled'])) {
        $data['enabled'] = [];
    }
    return $data;
}

function rmwSaveStore(array $data): bool {
    // Preserve the file comment if a previous version had one
    $existing = readJson(RM_WEBHOOK_FILE);
    if (isset($existing['_comment'])) {
        $data = ['_comment' => $existing['_comment']] + $data;
    }
    return writeJson(RM_WEBHOOK_FILE, $data);
}

function rmwLoadRunways(): array {
    $cfg = readJson('grafana-runways.json');
    return $cfg['runways'] ?? [];
}

// Mask the middle of a webhook URL so it can be shown in the UI without
// exposing the secret token. Keeps the host + first/last 4 chars of the path.
function rmwMaskUrl(string $url): string {
    if ($url === '') return '';
    $parts = parse_url($url);
    if (!$parts || empty($parts['host'])) return '***';
    $scheme = $parts['scheme'] ?? 'https';
    $host   = $parts['host'];
    $path   = $parts['path'] ?? '';
    if (strlen($path) > 12) {
        $path = substr($path, 0, 6) . '…' . substr($path, -4);
    }
    return "{$scheme}://{$host}{$path}?…";
}

// ── GET: list ────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);

    $store    = rmwLoadStore();
    $runways  = rmwLoadRunways();
    $rows     = [];

    foreach ($runways as $rw) {
        $name = $rw['name'] ?? '';
        $slug = $rw['slug'] ?? '';
        if (!$slug) continue;

        $overrideUrl = trim($store['webhooks'][$slug] ?? '');
        $envName     = $rw['chatWebhookEnv'] ?? '';
        $envUrl      = $envName ? (getenv($envName) ?: '') : '';

        if ($overrideUrl !== '') {
            $effective = $overrideUrl;
            $source    = 'override';
        } elseif ($envUrl !== '') {
            $effective = $envUrl;
            $source    = 'env';
        } else {
            $effective = '';
            $source    = 'none';
        }

        // Per-runway notification enable flag (admin/scheduled-noti.html).
        // Missing entry → default enabled (true).
        $enabled = array_key_exists($slug, $store['enabled'])
            ? (bool)$store['enabled'][$slug]
            : true;

        $rows[] = [
            'name'         => $name,
            'slug'         => $slug,
            'cluster'      => $rw['cluster'] ?? '',
            'color'        => $rw['color']   ?? '',
            'envName'      => $envName,
            'hasEnv'       => $envUrl !== '',
            'hasOverride'  => $overrideUrl !== '',
            'overrideUrl'  => $overrideUrl,         // editable in UI
            'effectiveUrl' => $effective,           // for diagnostics
            'maskedUrl'    => rmwMaskUrl($effective),
            'source'       => $source,
            'enabled'      => $enabled,             // noti kill-switch
        ];
    }

    respondOk([
        'runways'        => $rows,
        'legacyFallback' => (bool)getenv('RESTART_MONITOR_CHAT_WEBHOOK'),
        'updatedAt'      => $store['updatedAt'] ?? null,
        'updatedBy'      => $store['updatedBy'] ?? null,
    ]);
}

// ── PUT: save override ───────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $slug = trim($_GET['slug'] ?? '');
    $body = getBody();
    $url  = trim($body['url'] ?? '');

    if ($slug === '') respondError('slug required', 400);
    if ($url === '')  respondError('url required (use DELETE to clear)', 400);
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        respondError('url must be a valid URL', 400);
    }

    // Verify the slug exists in grafana-runways.json
    $runways  = rmwLoadRunways();
    $known    = array_filter($runways, fn($r) => ($r['slug'] ?? '') === $slug);
    if (!$known) respondError("Unknown runway slug '{$slug}'", 400);

    $store = rmwLoadStore();
    $store['webhooks'][$slug] = $url;
    $store['updatedAt'] = date('c');
    $store['updatedBy'] = $payload['username'] ?? 'unknown';

    if (!rmwSaveStore($store)) respondError('Failed to write store', 500);

    logActivity('restart_monitor_webhook_save', ['slug' => $slug]);
    respondOk(['slug' => $slug, 'maskedUrl' => rmwMaskUrl($url)], 'Saved');
}

// ── DELETE: clear override ───────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $slug = trim($_GET['slug'] ?? '');
    if ($slug === '') respondError('slug required', 400);

    $store = rmwLoadStore();
    if (!isset($store['webhooks'][$slug])) {
        respondOk(['slug' => $slug], 'No override to clear');
    }
    unset($store['webhooks'][$slug]);
    $store['updatedAt'] = date('c');
    $store['updatedBy'] = $payload['username'] ?? 'unknown';

    if (!rmwSaveStore($store)) respondError('Failed to write store', 500);

    logActivity('restart_monitor_webhook_clear', ['slug' => $slug]);
    respondOk(['slug' => $slug], 'Cleared (fallback to .env)');
}

// ── PATCH: toggle notification enable/disable (admin/scheduled-noti.html) ───
if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $slug = trim($_GET['slug'] ?? '');
    $body = getBody();
    if ($slug === '') respondError('slug required', 400);
    if (!array_key_exists('enabled', $body)) respondError('enabled (bool) required', 400);
    $enabled = (bool)$body['enabled'];

    $runways = rmwLoadRunways();
    $known   = array_filter($runways, fn($r) => ($r['slug'] ?? '') === $slug);
    if (!$known) respondError("Unknown runway slug '{$slug}'", 400);

    $store = rmwLoadStore();
    $store['enabled'][$slug] = $enabled;
    $store['updatedAt'] = date('c');
    $store['updatedBy'] = $payload['username'] ?? 'unknown';

    if (!rmwSaveStore($store)) respondError('Failed to write store', 500);

    logActivity('restart_monitor_webhook_toggle', ['slug' => $slug, 'enabled' => $enabled]);
    respondOk(['slug' => $slug, 'enabled' => $enabled], $enabled ? 'Enabled' : 'Disabled');
}

// ── POST: test-send ──────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $action = $_GET['action'] ?? '';
    if ($action !== 'test') respondError('Unknown action', 400);

    $body = getBody();
    $slug = trim($body['slug'] ?? '');
    if ($slug === '') respondError('slug required', 400);

    // Prefer explicit URL in body (so admins can test before saving);
    // otherwise resolve effective URL for this slug.
    $url = trim($body['url'] ?? '');

    $runways = rmwLoadRunways();
    $rwName  = '';
    foreach ($runways as $rw) {
        if (($rw['slug'] ?? '') === $slug) { $rwName = $rw['name'] ?? ''; break; }
    }
    if ($rwName === '') respondError("Unknown runway slug '{$slug}'", 400);

    if ($url === '') {
        $url = _resolveRunwayWebhook($rwName);
    }
    if ($url === '') respondError('No webhook URL to test (set one or pass `url` in body)', 400);
    if (!filter_var($url, FILTER_VALIDATE_URL)) respondError('url must be a valid URL', 400);

    $now      = (new DateTime('now', new DateTimeZone('Asia/Bangkok')))->format('Y-m-d H:i:s');
    $username = $payload['username'] ?? 'admin';

    $testCard = [
        'cardsV2' => [[
            'cardId' => 'restart-monitor-webhook-test-' . $slug,
            'card'   => [
                'header' => [
                    'title'    => "{$rwName} · Webhook test",
                    'subtitle' => 'SOM-Portal · restart-monitor',
                ],
                'sections' => [[
                    'widgets' => [
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'check_circle']],
                            'topLabel'  => 'Result',
                            'text'      => '<b><font color="#16a34a">Webhook reachable</font></b>',
                        ]],
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'person']],
                            'topLabel'  => 'Triggered by',
                            'text'      => htmlspecialchars($username, ENT_QUOTES, 'UTF-8'),
                        ]],
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'schedule']],
                            'topLabel'  => 'Time (Asia/Bangkok)',
                            'text'      => $now,
                        ]],
                        ['decoratedText' => [
                            'startIcon' => ['materialIcon' => ['name' => 'info']],
                            'topLabel'  => 'Note',
                            'text'      => 'This is a test message from the admin panel. The next real notification fires after the 09:00 ICT pod-restart scan.',
                        ]],
                    ],
                ]],
            ],
        ]],
    ];

    $threadKey = 'restart-monitor-webhook-test-' . strtolower(preg_replace('/\W+/', '-', $slug));
    $result    = postToChatThread($url, $testCard, $threadKey);

    logActivity('restart_monitor_webhook_test', [
        'slug'     => $slug,
        'sent'     => $result['sent'] ?? false,
        'httpCode' => $result['httpCode'] ?? null,
    ]);

    if (!($result['sent'] ?? false)) {
        respondError('Test send failed: ' . ($result['reason'] ?? 'unknown'), 502);
    }
    respondOk(['slug' => $slug, 'httpCode' => $result['httpCode'] ?? 200], 'Test sent');
}

respondError('Method not allowed', 405);
