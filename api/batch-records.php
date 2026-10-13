<?php
/**
 * batch-records.php
 * ?action=submit   POST { timestamp, reporter, server, jobs, backfill? }  → save to monthly file
 * ?action=list     GET  [&month=YYYY-MM]                                  → records for that month
 * ?action=months   GET                                                    → ["2026-04","2026-05",…]
 * ?action=coverage GET  [&month=YYYY-MM]                                  → per-day submission status
 */
require_once __DIR__ . '/helpers.php';

function tryGetUser(): ?array {
    $auth = getRequestHeader('Authorization');
    if (!str_starts_with($auth, 'Bearer ')) return null;
    return jwt_verify(substr($auth, 7));
}

$action = $_GET['action'] ?? '';
$month  = $_GET['month']  ?? null;

// ── months ───────────────────────────────────────────────────
if ($action === 'months') {
    respondOk(listMonths('batch-records'));
}

// ── submit ───────────────────────────────────────────────────
if ($action === 'submit') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $user = requireAuth();
    requireCsrf();
    $input = getBody();
    if (empty($input['reporter']) || empty($input['jobs'])) respondError('Invalid payload', 400);

    $ts = $input['timestamp'] ?? date('c');
    $record = [
        'id'        => uniqid('br_', true),
        'timestamp' => $ts,
        'reporter'  => trim($input['reporter']),
        'server'    => $input['server'] ?? '',
        'jobs'      => $input['jobs'],
    ];
    if (!empty($input['backfill'])) {
        requireSmCoverageAdmin($user, 'batch backfill');
        $record['backfilled']    = true;
        $record['backfilled_at'] = date('c');
        $record['backfilled_by'] = $user['name'] ?? $user['sub'] ?? '';
    }

    $recMonth = substr($ts, 0, 7);
    if (!preg_match('/^\d{4}-\d{2}$/', $recMonth)) $recMonth = date('Y-m');
    $file    = monthlyFilename('batch-records', $recMonth);
    $records = readJson($file);
    $records[] = $record;
    writeJson($file, $records);

    logActivity('batch_report_submitted', [
        'record_id' => $record['id'],
        'reporter'  => $record['reporter'],
        'server'    => $record['server'],
        'month'     => $recMonth,
        'timestamp' => $record['timestamp'],
    ], $user['sub'] ?? '', $user['name'] ?? $record['reporter']);

    respondOk(['id' => $record['id'], 'month' => $recMonth]);
}

// ── list ─────────────────────────────────────────────────────
if ($action === 'list') {
    $authUser = requireAuth();
    requirePagePermission($authUser, 'batch-monitor');
    $file    = monthlyFilename('batch-records', $month);
    $records = readJson($file);
    usort($records, fn($a, $b) => strcmp($b['timestamp'] ?? '', $a['timestamp'] ?? ''));
    respondOk($records);
}

// ── coverage ─────────────────────────────────────────────────
// Returns per-day submission status for the requested month, so the UI can
// highlight days where nobody submitted a Batch Daily Report. Expected-server
// set is the union of servers observed in the requested month + the two prior
// months, so a fresh month doesn't come back with "no servers expected".
if ($action === 'coverage') {
    $authUser = requireAuth();
    requirePagePermission($authUser, 'batch-monitor');
    requireSmCoverageAdmin($authUser, 'batch coverage');

    $ymRe = '/^\d{4}-\d{2}$/';
    $ym   = ($month && preg_match($ymRe, $month)) ? $month : date('Y-m');
    [$yr, $mo] = array_map('intval', explode('-', $ym));

    // Records for the target month (grouped by yyyy-mm-dd → set of servers)
    $records = readJson(monthlyFilename('batch-records', $ym));
    $byDay   = [];   // date => ['servers' => [srv=>true], 'records' => n, 'backfilled' => n]
    foreach ($records as $r) {
        $ts = $r['timestamp'] ?? '';
        if (strlen($ts) < 10) continue;
        $d = substr($ts, 0, 10);
        if (substr($d, 0, 7) !== $ym) continue;
        $srv = trim($r['server'] ?? '');
        if (!isset($byDay[$d])) $byDay[$d] = ['servers' => [], 'records' => 0, 'backfilled' => 0];
        if ($srv !== '') $byDay[$d]['servers'][$srv] = true;
        $byDay[$d]['records']++;
        if (!empty($r['backfilled'])) $byDay[$d]['backfilled']++;
    }

    // Expected-server set: union across target month + 2 prior months.
    $expectedSet = [];
    $probeMonths = [$ym];
    for ($i = 1; $i <= 2; $i++) {
        $pm = date('Y-m', strtotime($ym . '-01 -' . $i . ' month'));
        $probeMonths[] = $pm;
    }
    foreach ($probeMonths as $pm) {
        $recs = ($pm === $ym) ? $records : readJson(monthlyFilename('batch-records', $pm));
        foreach ($recs as $r) {
            $s = trim($r['server'] ?? '');
            if ($s !== '') $expectedSet[$s] = true;
        }
    }
    $expected = array_keys($expectedSet);
    sort($expected);

    // Holidays (per-team via readJson — falls back to root holidays.json).
    $holRows = readJson('holidays.json');
    $holMap  = [];
    foreach ($holRows as $h) {
        $hd = $h['date'] ?? '';
        if ($hd && substr($hd, 0, 7) === $ym) $holMap[$hd] = $h['name'] ?? '';
    }

    $today       = date('Y-m-d');
    $daysInMonth = (int) date('t', mktime(0, 0, 0, $mo, 1, $yr));
    $days        = [];
    $sum         = ['ok' => 0, 'partial' => 0, 'missing' => 0, 'future' => 0];

    for ($d = 1; $d <= $daysInMonth; $d++) {
        $ds  = sprintf('%04d-%02d-%02d', $yr, $mo, $d);
        $ts  = mktime(0, 0, 0, $mo, $d, $yr);
        $dow = (int) date('w', $ts);            // 0=Sun … 6=Sat
        $isWeekend = ($dow === 0 || $dow === 6);
        $isFuture  = ($ds > $today);
        $entry     = $byDay[$ds] ?? ['servers' => [], 'records' => 0, 'backfilled' => 0];
        $submitted = array_keys($entry['servers']);
        sort($submitted);
        $missing = array_values(array_diff($expected, $submitted));

        if ($isFuture) {
            $status = 'future';
        } elseif (!$expected) {
            $status = $submitted ? 'ok' : 'missing';
        } elseif (!$missing) {
            $status = 'ok';
        } elseif (!$submitted) {
            $status = 'missing';
        } else {
            $status = 'partial';
        }
        $sum[$status] = ($sum[$status] ?? 0) + 1;

        $days[] = [
            'date'              => $ds,
            'weekday'           => date('D', $ts),         // Mon, Tue, …
            'dow'               => $dow,
            'is_weekend'        => $isWeekend,
            'holiday'           => $holMap[$ds] ?? null,
            'future'            => $isFuture,
            'submitted_servers' => $submitted,
            'missing_servers'   => $missing,
            'records'           => $entry['records'],
            'backfilled'        => $entry['backfilled'],
            'status'            => $status,
        ];
    }

    respondOk([
        'month'            => $ym,
        'today'            => $today,
        'expected_servers' => $expected,
        'days'             => $days,
        'summary'          => $sum,
    ]);
}

respondError('Invalid action', 400);
