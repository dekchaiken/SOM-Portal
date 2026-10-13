<?php
/**
 * syncup/index.php
 * GET              → get today's record
 * GET ?date=YYYY-MM-DD  → get record for a specific date
 * GET ?range=N     → get last N days (max 90)
 * GET ?config=1    → get config (admin only)
 * PUT ?config=1    → save config (admin only)
 */
require_once __DIR__ . '/../helpers.php';

$method  = $_SERVER['REQUEST_METHOD'];
$payload = requireAuth();

const SYNCUP_FILE   = 'syncup.json';
const SYNCUP_CONFIG = 'syncup-config.json';

// ── GET ─────────────────────────────────────────────────────────────────
if ($method === 'GET') {

    // Config (admin only)
    if (!empty($_GET['config'])) {
        requireRole($payload, ADMIN_ROLES);
        $cfg = readJson(SYNCUP_CONFIG);
        foreach (['morning', 'evening'] as $s) {
            $cfg[$s] = array_merge([
                'time'                => $s === 'morning' ? '08:45' : '20:45',
                'days'                => ['mon','tue','wed','thu','fri'],
                'enabled'             => false,
                'popup_message'       => '',
                'google_chat_webhooks'=> [],
            ], $cfg[$s] ?? []);
        }
        respondOk($cfg);
    }

    // Range of days (for log view)
    if (isset($_GET['range'])) {
        $n    = min(90, max(1, (int)$_GET['range']));
        $data = readJson(SYNCUP_FILE);
        $out  = [];
        for ($i = 0; $i < $n; $i++) {
            $d = date('Y-m-d', strtotime("-{$i} days"));
            $out[$d] = $data[$d] ?? null;
        }
        respondOk($out);
    }

    // Single date
    $date = $_GET['date'] ?? date('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('Invalid date format', 400);
    $data = readJson(SYNCUP_FILE);
    respondOk($data[$date] ?? null);
}

// ── PUT ?config=1 (admin) ────────────────────────────────────────────────
if ($method === 'PUT' && !empty($_GET['config'])) {
    requireRole($payload, ADMIN_ROLES);
    $body = getBody();
    $cfg  = readJson(SYNCUP_CONFIG);

    foreach (['morning', 'evening'] as $s) {
        if (!isset($body[$s])) continue;
        $in = $body[$s];

        if (isset($in['time']) && !preg_match('/^\d{2}:\d{2}$/', $in['time'])) {
            respondError("Invalid time format for {$s}", 400);
        }

        $cfg[$s] = [
            'time'                => $in['time']    ?? ($s === 'morning' ? '08:45' : '20:45'),
            'days'                => $in['days']    ?? ['mon','tue','wed','thu','fri'],
            'enabled'             => (bool)($in['enabled'] ?? false),
            'popup_message'       => trim($in['popup_message'] ?? ''),
            'google_chat_webhooks'=> array_values(array_filter(
                array_map('trim', $in['google_chat_webhooks'] ?? [])
            )),
        ];
    }

    writeJson(SYNCUP_CONFIG, $cfg);

    logActivity('syncup_config_saved', [
        'morning_enabled' => $cfg['morning']['enabled'],
        'evening_enabled' => $cfg['evening']['enabled'],
        'morning_time'    => $cfg['morning']['time'],
        'evening_time'    => $cfg['evening']['time'],
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk($cfg);
}

// ── DELETE ?date=YYYY-MM-DD&shift=morning|evening (admin) ────────────────
if ($method === 'DELETE') {
    requireRole($payload, ADMIN_ROLES);
    $date  = $_GET['date']  ?? '';
    $shift = $_GET['shift'] ?? '';

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('date required', 400);
    if (!in_array($shift, ['morning', 'evening', 'both'])) respondError('shift required', 400);

    $data = readJson(SYNCUP_FILE);

    if ($shift === 'both') {
        // Delete image files
        foreach (['morning', 'evening'] as $s) {
            $rec = $data[$date][$s] ?? null;
            if ($rec && !empty($rec['image_path'])) {
                $p = __DIR__ . '/../../' . ltrim($rec['image_path'], '/');
                if (file_exists($p)) @unlink($p);
            }
        }
        unset($data[$date]);
    } else {
        $rec = $data[$date][$shift] ?? null;
        if ($rec && !empty($rec['image_path'])) {
            $p = __DIR__ . '/../../' . ltrim($rec['image_path'], '/');
            if (file_exists($p)) @unlink($p);
        }
        unset($data[$date][$shift]);
        if (empty($data[$date])) unset($data[$date]);
    }

    writeJson(SYNCUP_FILE, $data);

    logActivity('syncup_deleted', [
        'date'  => $date,
        'shift' => $shift,
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk(['deleted' => true]);
}

respondError('Method not allowed', 405);
