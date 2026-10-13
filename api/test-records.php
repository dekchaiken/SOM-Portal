<?php
/**
 * test-records.php
 * ?action=submit   POST { timestamp, reporter, services, backfill? }  → save to monthly file
 * ?action=list     GET  [&month=YYYY-MM]                              → records for that month
 * ?action=months   GET                                                → ["2026-04","2026-05",…]
 * ?action=coverage GET  [&month=YYYY-MM&tz=+07:00]                    → per-hour submission status
 */
require_once __DIR__ . '/helpers.php';

function tryGetUser(): ?array {
    $auth = getRequestHeader('Authorization');
    if (!str_starts_with($auth, 'Bearer ')) return null;
    return jwt_verify(substr($auth, 7));
}

$action = $_GET['action'] ?? '';
$month  = $_GET['month']  ?? null; // YYYY-MM, null = current month

// ── months ───────────────────────────────────────────────────
if ($action === 'months') {
    respondOk(listMonths('test-records'));
}

// ── submit ───────────────────────────────────────────────────
if ($action === 'submit') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    requireCsrf();
    $input = getBody();
    if (empty($input['reporter']) || empty($input['services'])) respondError('Invalid payload', 400);

    // Inject team context so the record lands in the same team dir the admin
    // list endpoint reads from (data/{team}/test-records-YYYY-MM.json).
    // Without this, submit writes to DATA_DIR root while list reads per-team →
    // the record appears to vanish. Super_admin's X-Admin-Team override
    // (from the View-as switcher) is respected here too.
    $submitUser = tryGetUser();
    if ($submitUser) {
        $GLOBALS['_current_team'] = $submitUser['team'] ?? null;
        if (($submitUser['role'] ?? '') === 'super_admin') {
            $ctxTeam = getRequestHeader('X-Admin-Team');
            if ($ctxTeam && preg_match('/^[a-z0-9_-]+$/', $ctxTeam)) {
                $GLOBALS['_current_team'] = $ctxTeam;
            }
        }
    }

    $ts = $input['timestamp'] ?? date('c');
    $brand = in_array($input['brand'] ?? '', ['tmn', 'vb']) ? $input['brand'] : 'tmn';
    $record = [
        'id'        => uniqid('tr_', true),
        'timestamp' => $ts,
        'reporter'  => trim($input['reporter']),
        'brand'     => $brand,
        'services'  => $input['services'],
    ];
    if (!empty($input['backfill'])) {
        if (!$submitUser) respondError('Unauthorized', 401);
        requireSmCoverageAdmin($submitUser, 'test backfill');
        $record['backfilled']    = true;
        $record['backfilled_at'] = date('c');
        $record['backfilled_by'] = $submitUser['name'] ?? $submitUser['sub'] ?? $record['reporter'];
    }

    // Derive month from the record's timestamp
    $recMonth = substr($ts, 0, 7);
    if (!preg_match('/^\d{4}-\d{2}$/', $recMonth)) $recMonth = date('Y-m');
    $file    = monthlyFilename('test-records', $recMonth);
    $records = readJson($file);
    $records[] = $record;
    writeJson($file, $records);

    $user = tryGetUser();
    logActivity('test_service_submitted', [
        'record_id' => $record['id'],
        'reporter'  => $record['reporter'],
        'month'     => $recMonth,
        'timestamp' => $record['timestamp'],
    ], $user['sub'] ?? '', $user['name'] ?? $record['reporter']);

    respondOk(['id' => $record['id'], 'month' => $recMonth]);
}

// ── list ─────────────────────────────────────────────────────
if ($action === 'list') {
    $authUser = requireAuth();
    requirePagePermission($authUser, 'test-service');
    $file    = monthlyFilename('test-records', $month);
    $records = readJson($file);
    usort($records, fn($a, $b) => strcmp($b['timestamp'] ?? '', $a['timestamp'] ?? ''));
    respondOk($records);
}

// ── coverage ─────────────────────────────────────────────────
// Per-day 24-hour bucketing of test-records. Test-service is expected to run
// every hour → cells count records/hour so the UI can flag missing hours and
// duplicate (>1) hours. Bucketing is local-time (default Asia/Bangkok, override
// via ?tz=+HH:MM). Records are drawn from the target month + its edges of the
// prior/next month files, so a record whose local hour crosses month boundary
// still shows up on the correct local day.
if ($action === 'coverage') {
    $authUser = requireAuth();
    requirePagePermission($authUser, 'test-service');
    requireSmCoverageAdmin($authUser, 'test coverage');

    $ymRe = '/^\d{4}-\d{2}$/';
    $ym   = ($month && preg_match($ymRe, $month)) ? $month : date('Y-m');
    [$yr, $mo] = array_map('intval', explode('-', $ym));

    $tzParam = $_GET['tz'] ?? '+07:00';
    if (!preg_match('/^[+-]\d{2}:\d{2}$/', $tzParam)) $tzParam = '+07:00';
    try { $tz = new DateTimeZone($tzParam); }
    catch (Throwable $e) { $tz = new DateTimeZone('+07:00'); }

    // Pull the target month plus prior/next month so records near the edge
    // still bucket to the correct local day.
    $priorYm = date('Y-m', strtotime($ym . '-01 -1 month'));
    $nextYm  = date('Y-m', strtotime($ym . '-01 +1 month'));
    $allRecs = array_merge(
        readJson(monthlyFilename('test-records', $priorYm)),
        readJson(monthlyFilename('test-records', $ym)),
        readJson(monthlyFilename('test-records', $nextYm))
    );

    // byDay[YYYY-MM-DD] = [
    //   'hours'     => int[24],
    //   'bf'        => int,
    //   'reporters' => [str=>true],
    //   'perHour'   => [hour => [{id, timestamp, reporter, backfilled}, …]]
    // ]
    // perHour is later collapsed to dup_details (only hours with >1 record) so
    // the wire payload stays small while the dup-cell popover has everything
    // it needs to render + delete without another round-trip.
    $byDay = [];
    foreach ($allRecs as $r) {
        $ts = $r['timestamp'] ?? '';
        if (!$ts) continue;
        try { $dt = new DateTime($ts); }
        catch (Throwable $e) { continue; }
        $dt->setTimezone($tz);
        $localDate = $dt->format('Y-m-d');
        if (substr($localDate, 0, 7) !== $ym) continue;
        $h = (int) $dt->format('G');
        if (!isset($byDay[$localDate])) {
            $byDay[$localDate] = [
                'hours'     => array_fill(0, 24, 0),
                'bf'        => 0,
                'reporters' => [],
                'perHour'   => [],
            ];
        }
        $byDay[$localDate]['hours'][$h]++;
        if (!empty($r['backfilled'])) $byDay[$localDate]['bf']++;
        $rep = trim($r['reporter'] ?? '');
        if ($rep !== '') $byDay[$localDate]['reporters'][$rep] = true;
        $byDay[$localDate]['perHour'][$h][] = [
            'id'         => $r['id']         ?? '',
            'timestamp'  => $ts,
            'reporter'   => $rep,
            'backfilled' => !empty($r['backfilled']),
        ];
    }

    // Holidays (per-team via readJson)
    $holRows = readJson('holidays.json');
    $holMap  = [];
    foreach ($holRows as $h) {
        $hd = $h['date'] ?? '';
        if ($hd && substr($hd, 0, 7) === $ym) $holMap[$hd] = $h['name'] ?? '';
    }

    // "Today" and "current hour" in requested tz — needed to cap expected-hours
    // for the current day so it isn't flagged missing for hours that haven't
    // happened yet.
    $nowLocal   = (new DateTime('now', $tz));
    $today      = $nowLocal->format('Y-m-d');
    $todayHour  = (int) $nowLocal->format('G');

    $daysInMonth = (int) date('t', mktime(0, 0, 0, $mo, 1, $yr));
    $days = [];
    $totExpected = 0;
    $totCovered  = 0;
    $totMissing  = 0;
    $totDup      = 0;
    $sumStatus   = ['ok' => 0, 'partial' => 0, 'missing' => 0, 'future' => 0];

    for ($d = 1; $d <= $daysInMonth; $d++) {
        $ds  = sprintf('%04d-%02d-%02d', $yr, $mo, $d);
        $ts  = mktime(0, 0, 0, $mo, $d, $yr);
        $dow = (int) date('w', $ts);
        $isWeekend = ($dow === 0 || $dow === 6);
        $isFuture  = ($ds > $today);
        $entry     = $byDay[$ds] ?? ['hours' => array_fill(0, 24, 0), 'bf' => 0, 'reporters' => [], 'perHour' => []];
        $hours     = $entry['hours'];

        // Expected hours = 24 for past days, 0 for future days, (hour+1) for today.
        if ($isFuture)          $expH = 0;
        elseif ($ds === $today) $expH = $todayHour + 1;
        else                    $expH = 24;

        $covered = 0; $dup = 0;
        for ($h = 0; $h < $expH; $h++) {
            if ($hours[$h] >= 1) $covered++;
            if ($hours[$h] >  1) $dup++;
        }
        $missing = max(0, $expH - $covered);

        if ($isFuture)         $status = 'future';
        elseif ($expH === 0)   $status = 'future';
        elseif ($covered === 0) $status = 'missing';
        elseif ($covered < $expH) $status = 'partial';
        else                   $status = 'ok';

        $sumStatus[$status] = ($sumStatus[$status] ?? 0) + 1;
        $totExpected += $expH;
        $totCovered  += $covered;
        $totMissing  += $missing;
        $totDup      += $dup;

        // Only include per-record details for hours that are actually
        // duplicated, so the response stays small.
        $dupDetails = [];
        foreach ($entry['perHour'] as $h => $recs) {
            if (count($recs) > 1) {
                usort($recs, fn($a, $b) => strcmp($a['timestamp'], $b['timestamp']));
                $dupDetails[(string) $h] = $recs;
            }
        }

        $days[] = [
            'date'          => $ds,
            'weekday'       => date('D', $ts),
            'dow'           => $dow,
            'is_weekend'    => $isWeekend,
            'holiday'       => $holMap[$ds] ?? null,
            'future'        => $isFuture,
            'hours'         => $hours,                // int[24], record count per hour
            'expected_hours'=> $expH,
            'covered'       => $covered,
            'missing_count' => $missing,
            'dup_count'     => $dup,
            'dup_details'   => (object) $dupDetails,  // { "8": [{id,ts,reporter,backfilled}, …] }
            'backfilled'    => $entry['bf'],
            'reporters'     => array_keys($entry['reporters']),
            'status'        => $status,
        ];
    }

    respondOk([
        'month'      => $ym,
        'today'      => $today,
        'today_hour' => $todayHour,
        'tz'         => $tzParam,
        'days'       => $days,
        'summary'    => [
            'expected_hours' => $totExpected,
            'covered'        => $totCovered,
            'missing'        => $totMissing,
            'duplicates'     => $totDup,
            'by_status'      => $sumStatus,
        ],
    ]);
}

respondError('Invalid action', 400);
