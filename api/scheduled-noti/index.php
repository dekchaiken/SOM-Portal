<?php
/**
 * scheduled-noti/index.php
 * GET              → list all enabled schedules (any auth user)
 * GET ?all=1       → list all including disabled (admin only)
 * POST             → create (admin only)
 * PUT  ?id=        → update / toggle enabled (admin only)
 * DELETE ?id=      → delete (admin only)
 */
require_once __DIR__ . '/../helpers.php';

$method  = $_SERVER['REQUEST_METHOD'];
$payload = requireAuth();

const SNOTI_FILE = 'scheduled-noti.json';

// ── GET: list ─────────────────────────────────────────────────────
if ($method === 'GET') {
    $items   = readJson(SNOTI_FILE);
    $isAdmin = in_array($payload['role'], ADMIN_ROLES);

    if (!$isAdmin || empty($_GET['all'])) {
        $items = array_values(array_filter($items, fn($i) => !empty($i['enabled'])));
    }

    // Non-admin: replace webhook URLs with boolean (security — don't expose URLs)
    if (!$isAdmin) {
        $items = array_map(function($i) {
            $hooks = !empty($i['google_chat_webhooks']) ? $i['google_chat_webhooks']
                   : (!empty($i['google_chat_webhook']) ? [$i['google_chat_webhook']] : []);
            $i['has_chat_webhook'] = !empty($hooks);
            unset($i['google_chat_webhooks'], $i['google_chat_webhook']);
            return $i;
        }, $items);
    } else {
        $items = array_map(function($i) {
            $hooks = !empty($i['google_chat_webhooks']) ? $i['google_chat_webhooks']
                   : (!empty($i['google_chat_webhook']) ? [$i['google_chat_webhook']] : []);
            $i['google_chat_webhooks'] = array_values(array_filter($hooks));
            $i['has_chat_webhook']     = !empty($i['google_chat_webhooks']);
            unset($i['google_chat_webhook']);
            return $i;
        }, $items);
    }

    usort($items, fn($a, $b) => strcmp($a['time'] ?? '', $b['time'] ?? ''));
    respondOk($items);
}

// ── admin-only below ─────────────────────────────────────────────
requireRole($payload, ADMIN_ROLES);

// ── POST: create ──────────────────────────────────────────────────
if ($method === 'POST') {
    $body = getBody();
    if (empty($body['time'])) respondError('time is required', 400);

    // Validate HH:MM format
    if (!preg_match('/^\d{2}:\d{2}$/', $body['time'])) {
        respondError('time must be in HH:MM format', 400);
    }

    $type = $body['type'] ?? 'general';
    if (!in_array($type, ['general', 'shift_summary', 'grafana_paused'])) respondError('Invalid type', 400);

    if ($type === 'general' && empty($body['message'])) respondError('message is required', 400);

    $dayMode = $body['day_mode'] ?? 'weekly';
    if (!in_array($dayMode, ['weekly', 'monthly'])) respondError('Invalid day_mode', 400);

    $dates = [];
    if ($dayMode === 'monthly') {
        $dates = array_values(array_unique(array_filter(array_map('intval', $body['dates'] ?? []),
            fn($d) => $d >= 1 && $d <= 31)));
        if (!$dates) respondError('dates is required for monthly mode (1-31)', 400);
        sort($dates);
    }

    $excludeDates = array_values(array_unique(array_filter(array_map('intval', $body['exclude_dates'] ?? []),
        fn($d) => $d >= 1 && $d <= 31)));
    sort($excludeDates);

    $item = [
        'id'                  => genId('noti'),
        'type'                => $type,
        'time'                => $body['time'],
        'day_mode'            => $dayMode,
        'days'                => $body['days'] ?? ['mon','tue','wed','thu','fri'],
        'dates'               => $dates,
        'exclude_dates'       => $excludeDates,
        'message'             => $type === 'shift_summary' ? '' : trim($body['message']),
        'action_label'        => trim($body['action_label'] ?? ''),
        'action_url'          => trim($body['action_url'] ?? ''),
        'google_chat_webhooks' => array_values(array_filter(array_map('trim', $body['google_chat_webhooks'] ?? []))),
        'enabled'             => (bool)($body['enabled'] ?? true),
        'created_at'          => date('c'),
        'created_by'          => $payload['name'] ?? $payload['sub'],
    ];

    if ($type === 'shift_summary') {
        $item['shifts_today']    = $body['shifts_today']    ?? [];
        $item['shifts_tomorrow'] = $body['shifts_tomorrow'] ?? [];
    }

    $items = readJson(SNOTI_FILE);
    $items[] = $item;
    writeJson(SNOTI_FILE, $items);

    logActivity('noti_schedule_created', [
        'noti_id' => $item['id'],
        'time'    => $item['time'],
        'days'    => implode(',', $item['days']),
        'message' => mb_substr($item['message'], 0, 80),
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk($item);
}

// ── PUT: update ────────────────────────────────────────────────────
if ($method === 'PUT') {
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required', 400);
    $body = getBody();

    if (isset($body['time']) && !preg_match('/^\d{2}:\d{2}$/', $body['time'])) {
        respondError('time must be in HH:MM format', 400);
    }

    if (isset($body['day_mode']) && !in_array($body['day_mode'], ['weekly', 'monthly'])) {
        respondError('Invalid day_mode', 400);
    }

    if (isset($body['dates'])) {
        $dates = array_values(array_unique(array_filter(array_map('intval', $body['dates']),
            fn($d) => $d >= 1 && $d <= 31)));
        sort($dates);
        $body['dates'] = $dates;
        if (($body['day_mode'] ?? null) === 'monthly' && !$dates) {
            respondError('dates is required for monthly mode (1-31)', 400);
        }
    }

    if (isset($body['exclude_dates'])) {
        $ex = array_values(array_unique(array_filter(array_map('intval', $body['exclude_dates']),
            fn($d) => $d >= 1 && $d <= 31)));
        sort($ex);
        $body['exclude_dates'] = $ex;
    }

    $items   = readJson(SNOTI_FILE);
    $found   = false;
    $updated = null;
    foreach ($items as &$item) {
        if ($item['id'] !== $id) continue;
        if (isset($body['time']))         $item['time']         = $body['time'];
        if (isset($body['day_mode']))     $item['day_mode']     = $body['day_mode'];
        if (isset($body['days']))         $item['days']         = $body['days'];
        if (isset($body['dates']))        $item['dates']        = $body['dates'];
        if (isset($body['exclude_dates'])) $item['exclude_dates'] = $body['exclude_dates'];
        if (isset($body['message']))      $item['message']      = trim($body['message']);
        if (isset($body['action_label']))        $item['action_label']        = trim($body['action_label']);
        if (isset($body['action_url']))          $item['action_url']          = trim($body['action_url']);
        if (isset($body['google_chat_webhooks'])) $item['google_chat_webhooks'] = array_values(array_filter(array_map('trim', $body['google_chat_webhooks'])));
        unset($item['google_chat_webhook']); // migrate old field
        if (isset($body['enabled']))             $item['enabled']             = (bool)$body['enabled'];
        if (isset($body['shifts_today']))        $item['shifts_today']        = $body['shifts_today'];
        if (isset($body['shifts_tomorrow']))     $item['shifts_tomorrow']     = $body['shifts_tomorrow'];
        $item['updated_at'] = date('c');
        $item['updated_by'] = $payload['name'] ?? $payload['sub'];
        $found   = true;
        $updated = $item;
        break;
    }
    unset($item);

    if (!$found) respondError('Not found', 404);
    writeJson(SNOTI_FILE, $items);

    logActivity('noti_schedule_updated', [
        'noti_id' => $id,
        'fields'  => implode(',', array_keys($body)),
        'enabled' => $updated['enabled'] ? 'true' : 'false',
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk($updated);
}

// ── DELETE ─────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required', 400);

    $items    = readJson(SNOTI_FILE);
    $filtered = array_values(array_filter($items, fn($i) => $i['id'] !== $id));
    if (count($filtered) === count($items)) respondError('Not found', 404);

    writeJson(SNOTI_FILE, $filtered);

    logActivity('noti_schedule_deleted', ['noti_id' => $id], $payload['sub'], $payload['name'] ?? '');

    respondOk(['deleted' => true]);
}

respondError('Method not allowed', 405);
