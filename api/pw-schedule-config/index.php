<?php
/**
 * pw-schedule-config/index.php
 *
 * Config for the PW Schedule feature.
 *
 *   GET   → fetch config (non-admin gets webhook masked)
 *   PUT   → replace config (admin only)
 *
 * Shape (data/pw_schedule_config.json):
 *   {
 *     "google_chat_webhook": "...",
 *     "lead_minutes": [10, 5],      // browser notification lead times
 *     "sound_enabled": true,         // sound on lead-time trigger
 *     "updated_at": "...",
 *     "updated_by": "..."
 *   }
 */
require_once __DIR__ . '/../helpers.php';

$method  = $_SERVER['REQUEST_METHOD'];
$payload = requireAuth();

const PW_CFG_FILE = 'pw_schedule_config.json';

function pwDefaultConfig(): array {
    return [
        'google_chat_webhook' => '',
        'lead_minutes'        => [10, 5],
        'sound_enabled'       => true,
        'n8n_sync_webhook'    => '',
        'n8n_sync_secret'     => '',
        'teamup_calendar_key' => '',
        'teamup_mode'         => 'share', // 'share' | 'ics' | 'api'
        'teamup_api_token'    => '',
    ];
}

if ($method === 'GET') {
    $cfg = array_merge(pwDefaultConfig(), readJson(PW_CFG_FILE));
    $isAdmin = in_array($payload['role'], ADMIN_ROLES);
    if (!$isAdmin) {
        // Non-admin: expose lead-time + sound + has_* flags, hide secret URLs
        $cfg['has_webhook']    = !empty($cfg['google_chat_webhook']);
        $cfg['has_n8n_sync']   = !empty($cfg['n8n_sync_webhook']);
        $cfg['has_teamup']     = !empty($cfg['teamup_calendar_key']);
        $cfg['teamup_mode']    = $cfg['teamup_mode'] ?? 'ics';
        unset(
            $cfg['google_chat_webhook'],
            $cfg['n8n_sync_webhook'],
            $cfg['n8n_sync_secret'],
            $cfg['teamup_calendar_key'],
            $cfg['teamup_api_token']
        );
    } else {
        $cfg['has_webhook']  = !empty($cfg['google_chat_webhook']);
        $cfg['has_n8n_sync'] = !empty($cfg['n8n_sync_webhook']);
        $cfg['has_teamup']   = !empty($cfg['teamup_calendar_key']);
    }
    respondOk($cfg);
}

// ── admin-only below ─────────────────────────────────────────────
// pw_schedule_config.json is SM-shared (see smSharedFiles) — non-SM admins
// must not be able to overwrite SM's webhook / Teamup key even if they had
// admin role. requireSmForShared narrows the write to SM + super_admin.
requireSmForShared();
requireRole($payload, ADMIN_ROLES);

if ($method === 'PUT') {
    $body = getBody();
    $cfg  = array_merge(pwDefaultConfig(), readJson(PW_CFG_FILE));

    if (array_key_exists('google_chat_webhook', $body)) {
        $url = trim((string)$body['google_chat_webhook']);
        if ($url !== '' && !filter_var($url, FILTER_VALIDATE_URL)) {
            respondError('Invalid webhook URL', 400);
        }
        $cfg['google_chat_webhook'] = $url;
    }

    if (array_key_exists('n8n_sync_webhook', $body)) {
        $url = trim((string)$body['n8n_sync_webhook']);
        if ($url !== '' && !filter_var($url, FILTER_VALIDATE_URL)) {
            respondError('Invalid n8n sync webhook URL', 400);
        }
        $cfg['n8n_sync_webhook'] = $url;
    }

    if (array_key_exists('n8n_sync_secret', $body)) {
        $cfg['n8n_sync_secret'] = trim((string)$body['n8n_sync_secret']);
    }

    if (array_key_exists('lead_minutes', $body)) {
        $leads = $body['lead_minutes'];
        if (!is_array($leads)) respondError('lead_minutes must be an array', 400);
        $cleaned = [];
        foreach ($leads as $v) {
            $n = (int)$v;
            if ($n > 0 && $n <= 120) $cleaned[] = $n;
        }
        $cleaned = array_values(array_unique($cleaned));
        rsort($cleaned);
        $cfg['lead_minutes'] = $cleaned ?: [10, 5];
    }

    if (array_key_exists('sound_enabled', $body)) {
        $cfg['sound_enabled'] = (bool)$body['sound_enabled'];
    }

    if (array_key_exists('teamup_calendar_key', $body)) {
        // Allow key OR a full teamup URL — extract the key.
        $raw = trim((string)$body['teamup_calendar_key']);
        if ($raw !== '' && preg_match('#teamup\.com/([A-Za-z0-9]{8,})#', $raw, $m)) {
            $raw = $m[1];
        }
        if ($raw !== '' && !preg_match('/^[A-Za-z0-9]{8,}$/', $raw)) {
            respondError('Invalid Teamup calendar key', 400);
        }
        $cfg['teamup_calendar_key'] = $raw;
    }

    if (array_key_exists('teamup_mode', $body)) {
        $mode = strtolower(trim((string)$body['teamup_mode']));
        if (!in_array($mode, ['share', 'ics', 'api'], true)) {
            respondError("teamup_mode must be 'share', 'ics' or 'api'", 400);
        }
        $cfg['teamup_mode'] = $mode;
    }

    if (array_key_exists('teamup_api_token', $body)) {
        $cfg['teamup_api_token'] = trim((string)$body['teamup_api_token']);
    }

    $cfg['updated_at'] = date('c');
    $cfg['updated_by'] = $payload['name'] ?? $payload['sub'];

    writeJson(PW_CFG_FILE, $cfg);
    logActivity('pw_config_updated', [
        'lead_minutes'  => $cfg['lead_minutes'],
        'sound_enabled' => $cfg['sound_enabled'],
        'has_webhook'   => !empty($cfg['google_chat_webhook']),
    ], $payload['sub'], $payload['name'] ?? '');

    $cfg['has_webhook']  = !empty($cfg['google_chat_webhook']);
    $cfg['has_n8n_sync'] = !empty($cfg['n8n_sync_webhook']);
    $cfg['has_teamup']   = !empty($cfg['teamup_calendar_key']);
    respondOk($cfg);
}

respondError('Method not allowed', 405);
