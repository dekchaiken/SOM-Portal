<?php
/**
 * SMC Analytics — aggregated stats for the Batchfile & Monitoring dashboard tabs.
 * GET /api/jira/smc-analytics.php?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD[&refresh=1][&debug=1]
 *
 * Data source: project = SMC, issuetype in (Monitoring, Batchfile).
 * Same PER-MONTH CACHE strategy as incidents-analytics.php, plus one extra rule:
 *   the cache is also invalidated when data/team-config.json changes (because the
 *   "Action by SM/TS" split depends on it) — cachedAt < team-config.updated_at ⇒ stale.
 *
 * Classification (⚠ verify field values via ?debug=1 before trusting):
 *   - detectedBy  customfield_17016 → SM / SS / Other
 *   - origin      customfield_17238 ("Caused by 3rd Party") has a value ⇒ External, else Internal
 *   - closed      status.statusCategory.key === 'done'
 *   - actionBy    assignee.emailAddress ∈ team-config SM / TS list ⇒ SM / TS / Other
 */
require_once __DIR__ . '/../helpers.php';

const SMC_CACHE_DIR   = __DIR__ . '/../../data/analytics-cache';
const SMC_MONTH_TTL   = 600;   // current-month re-fetch window (10 min)
const SMC_CACHE_VERSION = 3;   // bump when aggregation logic changes → auto rebuild
const SMC_JIRA_TIMEOUT = 60;

@set_time_limit(120);

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) {
        respondError('Jira credentials not configured (.env JIRA_EMAIL / JIRA_TOKEN)', 500);
    }

    // ── Params ────────────────────────────────────────────────────────────
    $fromDate = trim($_GET['fromDate'] ?? '');
    $toDate   = trim($_GET['toDate']   ?? '');
    $force    = !empty($_GET['refresh']);
    $debug    = !empty($_GET['debug']);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate)) $fromDate = date('Y') . '-01-01';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $toDate))   $toDate   = date('Y-m-d');
    if ($fromDate > $toDate) { $tmp = $fromDate; $fromDate = $toDate; $toDate = $tmp; }

    // Team config (for Action by SM/TS) + its mtime (for cache invalidation)
    $teamCfg = readJson('team-config.json');
    if (empty($teamCfg)) $teamCfg = ['SM' => [], 'TS' => [], 'updated_at' => 0];
    $teamUpdatedAt = (int)($teamCfg['updated_at'] ?? 0);

    // ── Debug mode: dump raw fields of a few SMC issues for discovery ─────
    if ($debug) {
        $month = substr($toDate, 0, 7);
        $first = $month . '-01';
        $last  = date('Y-m-d', strtotime($first . ' +1 month -1 day'));
        $jql   = 'project = SMC AND issuetype in ("Monitoring", "Batchfile") '
               . "AND created >= \"{$first}\" AND created <= \"{$last} 23:59\" ORDER BY created DESC";
        $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query([
            'jql' => $jql, 'maxResults' => 5, 'fields' => '*all',
        ]);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER => [
                'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
                'Accept: application/json',
            ],
        ]);
        $resp = curl_exec($ch); curl_close($ch);
        respondOk(['month' => $month, 'teamConfig' => $teamCfg, 'raw' => json_decode($resp, true)]);
    }

    // ── Detail mode: the actual SMC tickets behind a cell ─────────────────
    //  &detail=1 &type=batch|monitoring &origin=all|internal|external
    //  &action=all|sm|ts|other &detected=all|sm|ss|other &closed=all|closed|open
    if (!empty($_GET['detail'])) {
        $type    = strtolower((string)($_GET['type']     ?? 'batch'));
        $origin  = (string)($_GET['origin']   ?? 'all');
        $action  = (string)($_GET['action']   ?? 'all');
        $detFilt = (string)($_GET['detected'] ?? 'all');
        $closedF = (string)($_GET['closed']   ?? 'all');

        $smSet = array_flip(array_map('strtolower', $teamCfg['SM'] ?? []));
        $tsSet = array_flip(array_map('strtolower', $teamCfg['TS'] ?? []));

        $jql = 'project = SMC AND issuetype in ("Monitoring", "Batchfile") '
             . "AND created >= \"{$fromDate}\" AND created <= \"{$toDate} 23:59\" ORDER BY created DESC";

        $issuesById = []; $pageSize = 100; $iter = 0; $cap = 1000; $nextToken = null;
        do {
            $iter++;
            $params = ['jql' => $jql, 'maxResults' => $pageSize,
                       'fields' => 'created,summary,status,assignee,issuetype,customfield_17016,customfield_17238'];
            if ($nextToken) $params['nextPageToken'] = $nextToken;
            $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query($params);
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => SMC_JIRA_TIMEOUT,
                CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
                CURLOPT_HTTPHEADER => [
                    'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
                    'Accept: application/json',
                ],
            ]);
            $resp = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err  = curl_error($ch);
            curl_close($ch);
            if ($err)          respondError("Cannot reach Jira: {$err}", 502);
            if ($code !== 200) {
                $body = json_decode($resp, true);
                respondError("Jira HTTP {$code}: " . ($body['errorMessages'][0] ?? substr((string)$resp, 0, 200)), 502);
            }
            $data = json_decode($resp, true);
            if (!$data || !isset($data['issues'])) break;
            foreach ($data['issues'] as $iss) { if (isset($iss['key'])) $issuesById[$iss['key']] = $iss; }
            $nextToken = $data['nextPageToken'] ?? null;
        } while ($nextToken && $iter < 50 && count($issuesById) < $cap);
        $issues = array_values($issuesById);

        $rows = [];
        foreach ($issues as $issue) {
            $f       = $issue['fields'] ?? [];
            if (smcIsTest($f) || smcIsCancelled($f)) continue;   // skip test + cancelled
            $isBatch = strpos(strtolower($f['issuetype']['name'] ?? ''), 'batch') !== false;
            $t       = $isBatch ? 'batch' : 'monitoring';
            if ($type !== $t) continue;

            $isClosed = (($f['status']['statusCategory']['key'] ?? '') === 'done');
            $c3   = smcExtractField($f['customfield_17238'] ?? null);
            $c3Lc = strtolower($c3);
            $og   = ($c3Lc !== '' && !preg_match('~^(no|none|n/?a|-|false|internal)$~', $c3Lc)) ? 'external' : 'internal';
            $email = strtolower($f['assignee']['emailAddress'] ?? '');
            $act  = isset($smSet[$email]) ? 'sm' : (isset($tsSet[$email]) ? 'ts' : 'other');
            $db   = strtoupper(smcExtractField($f['customfield_17016'] ?? null));
            $det  = ($db === 'SM' || preg_match('/\bSM\b/', $db)) ? 'sm'
                    : (preg_match('/\bSS\b/', $db) ? 'ss' : 'other');

            if ($origin  !== 'all' && $og  !== $origin)   continue;
            if ($action  !== 'all' && $act !== $action)   continue;
            if ($detFilt !== 'all' && $det !== $detFilt)  continue;
            if ($closedF === 'closed' && !$isClosed)      continue;
            if ($closedF === 'open'   &&  $isClosed)      continue;

            $rows[] = [
                'key'        => $issue['key'],
                'type'       => $isBatch ? 'Batchfile' : 'Monitoring',
                'summary'    => $f['summary'] ?? '',
                'created'    => $f['created'] ?? '',
                'status'     => $f['status']['name'] ?? '—',
                'closed'     => $isClosed,
                'origin'     => $og,
                'detectedBy' => $db !== '' ? $db : '—',
                'actionBy'   => $act,
                'assignee'   => $f['assignee']['displayName'] ?? 'Unassigned',
                'url'        => JIRA_BASE_URL . '/browse/' . $issue['key'],
            ];
        }

        respondOk([
            'filter'    => ['type'=>$type, 'origin'=>$origin, 'action'=>$action, 'detected'=>$detFilt,
                            'closed'=>$closedF, 'fromDate'=>$fromDate, 'toDate'=>$toDate],
            'count'     => count($rows),
            'truncated' => count($issues) >= $cap,
            'rows'      => $rows,
        ]);
    }

    if (!is_dir(SMC_CACHE_DIR)) @mkdir(SMC_CACHE_DIR, 0775, true);

    // ── Iterate months ────────────────────────────────────────────────────
    $currentMonth = date('Y-m');
    $monthBuckets = [];
    $cacheStatus  = [];

    $cur = strtotime(substr($fromDate, 0, 7) . '-01');
    $end = strtotime(substr($toDate,   0, 7) . '-01');
    while ($cur <= $end) {
        $month     = date('Y-m', $cur);
        $cacheFile = SMC_CACHE_DIR . "/smc-{$month}.json";
        $bucket    = null;
        $status    = 'miss';

        if (!$force && is_file($cacheFile)) {
            $cached = json_decode((string)@file_get_contents($cacheFile), true);
            if (is_array($cached) && isset($cached['month']) && ($cached['v'] ?? 0) === SMC_CACHE_VERSION) {
                $cachedAt = (int)($cached['cachedAt'] ?? 0);
                if ($cachedAt < $teamUpdatedAt) {
                    $status = 'stale';                   // team-config changed → recompute actionBy
                } elseif ($month < $currentMonth) {
                    $bucket = $cached; $status = 'hit';
                } else {
                    $age = time() - $cachedAt;
                    if ($age < SMC_MONTH_TTL) { $bucket = $cached; $status = 'hit'; }
                    else { $status = 'stale'; }
                }
            }
        } elseif ($force) {
            $status = 'refresh';
        }

        if ($bucket === null) {
            $bucket = smcFetchMonthBucket($month, $teamCfg);
            @file_put_contents($cacheFile, json_encode($bucket, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
        }

        $monthBuckets[$month] = $bucket;
        $cacheStatus[$month]  = $status;
        $cur = strtotime('+1 month', $cur);
    }

    // ── Merge ─────────────────────────────────────────────────────────────
    $batch = smcEmptyType();   // { total, closed, internal{}, external{}, actionBy{} }
    $mon   = smcEmptyType();   // reuse shape; monitoring adds detectedBy
    $mon['detectedBy'] = ['sm'=>0,'ss'=>0,'other'=>0];

    $monthlyBatch = [];
    $monthlyMon   = [];
    $fetchedCount = 0;
    $detectedByValues = [];
    $causedByValues   = [];

    foreach ($monthBuckets as $month => $b) {
        $fetchedCount += (int)($b['count'] ?? 0);
        smcAddType($batch, $b['batchfile']  ?? []);
        smcAddType($mon,   $b['monitoring'] ?? []);
        foreach (['sm','ss','other'] as $k) {
            $mon['detectedBy'][$k] += (int)($b['monitoring']['detectedBy'][$k] ?? 0);
        }
        foreach ((array)($b['diagnostics']['detectedByValues'] ?? []) as $k => $v) $detectedByValues[$k] = ($detectedByValues[$k] ?? 0) + $v;
        foreach ((array)($b['diagnostics']['causedByValues']   ?? []) as $k => $v) $causedByValues[$k]   = ($causedByValues[$k]   ?? 0) + $v;

        $bt = $b['batchfile']  ?? [];
        $mo = $b['monitoring'] ?? [];
        $monthlyBatch[] = ['month'=>$month, 'total'=>(int)($bt['total']??0), 'closed'=>(int)($bt['closed']??0)];
        $monthlyMon[]   = ['month'=>$month, 'total'=>(int)($mo['total']??0), 'closed'=>(int)($mo['closed']??0)];
    }

    smcFinalize($batch);
    smcFinalize($mon);

    respondOk([
        'range'        => ['fromDate' => $fromDate, 'toDate' => $toDate],
        'fetchedCount' => $fetchedCount,
        'monthly'      => ['batchfile' => $monthlyBatch, 'monitoring' => $monthlyMon],
        'batchfile'    => $batch,
        'monitoring'   => $mon,
        'cache'        => $cacheStatus,
        'diagnostics'  => [
            'detectedByValues' => $detectedByValues,
            'causedByValues'   => $causedByValues,
            'teamConfigCounts' => ['SM' => count($teamCfg['SM'] ?? []), 'TS' => count($teamCfg['TS'] ?? [])],
        ],
    ]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine(), 500);
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function smcEmptyType(): array {
    return [
        'total'    => 0, 'closed' => 0,
        'internal' => ['total'=>0, 'closed'=>0],
        'external' => ['total'=>0, 'closed'=>0],
        'actionBy' => ['sm'=>0, 'ts'=>0, 'other'=>0],
    ];
}

function smcAddType(array &$dst, array $src): void {
    $dst['total']  += (int)($src['total']  ?? 0);
    $dst['closed'] += (int)($src['closed'] ?? 0);
    foreach (['internal','external'] as $k) {
        $dst[$k]['total']  += (int)($src[$k]['total']  ?? 0);
        $dst[$k]['closed'] += (int)($src[$k]['closed'] ?? 0);
    }
    foreach (['sm','ts','other'] as $k) {
        $dst['actionBy'][$k] += (int)($src['actionBy'][$k] ?? 0);
    }
}

function smcFinalize(array &$t): void {
    $pct = fn(int $n, int $d): float => $d > 0 ? round($n * 100 / $d, 2) : 0.0;
    $t['closePct'] = $pct($t['closed'], $t['total']);
    $t['internal']['closePct'] = $pct($t['internal']['closed'], $t['internal']['total']);
    $t['external']['closePct'] = $pct($t['external']['closed'], $t['external']['total']);
}

/** Exclude test tickets — summary contains "test" as a standalone word. */
function smcIsTest(array $f): bool {
    return (bool)preg_match('/\btest\b/i', (string)($f['summary'] ?? ''));
}

/** Exclude cancelled tickets — status name contains "cancel". */
function smcIsCancelled(array $f): bool {
    return (bool)preg_match('/cancel/i', (string)($f['status']['name'] ?? ''));
}

/** Normalise a Jira custom-field value of any shape to a trimmed string. */
function smcExtractField($v): string {
    if ($v === null) return '';
    if (is_string($v)) return trim($v);
    if (is_array($v)) {
        if (isset($v['value'])) return trim((string)$v['value']);
        if (isset($v['name']))  return trim((string)$v['name']);
        $parts = [];
        foreach ($v as $it) {
            if (is_string($it)) $parts[] = trim($it);
            elseif (is_array($it)) $parts[] = trim((string)($it['value'] ?? $it['name'] ?? ''));
        }
        return implode('|', array_filter($parts));
    }
    return trim((string)$v);
}

/** Fetch & aggregate a single month for both SMC issue types. */
function smcFetchMonthBucket(string $month, array $teamCfg): array {
    $first = $month . '-01';
    $last  = date('Y-m-d', strtotime($first . ' +1 month -1 day'));
    $jql   = 'project = SMC AND issuetype in ("Monitoring", "Batchfile") '
           . "AND created >= \"{$first}\" AND created <= \"{$last} 23:59\" ORDER BY created ASC";

    $smSet = array_flip(array_map('strtolower', $teamCfg['SM'] ?? []));
    $tsSet = array_flip(array_map('strtolower', $teamCfg['TS'] ?? []));

    // Paginate with nextPageToken (the /search/jql endpoint ignores startAt),
    // dedupe by key so overlapping pages never inflate the counts.
    $issuesById = []; $pageSize = 100; $iter = 0; $nextToken = null;
    do {
        $iter++;
        $params = ['jql' => $jql, 'maxResults' => $pageSize,
                   'fields' => 'summary,created,status,assignee,issuetype,customfield_17016,customfield_17238'];
        if ($nextToken) $params['nextPageToken'] = $nextToken;
        $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query($params);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => SMC_JIRA_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER => [
                'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
                'Accept: application/json',
            ],
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($err)          respondError("Cannot reach Jira for {$month}: {$err}", 502);
        if ($code !== 200) {
            $body = json_decode($resp, true);
            respondError("Jira HTTP {$code} for {$month}: " . ($body['errorMessages'][0] ?? substr((string)$resp, 0, 200)), 502);
        }
        $data = json_decode($resp, true);
        if (!$data || !isset($data['issues'])) break;
        foreach ($data['issues'] as $iss) { if (isset($iss['key'])) $issuesById[$iss['key']] = $iss; }
        $nextToken = $data['nextPageToken'] ?? null;
    } while ($nextToken && $iter < 50);
    $issues = array_values($issuesById);

    $batch = smcEmptyType();
    $mon   = smcEmptyType();
    $mon['detectedBy'] = ['sm'=>0,'ss'=>0,'other'=>0];
    $detectedByValues = [];
    $causedByValues   = [];

    foreach ($issues as $issue) {
        $f    = $issue['fields'] ?? [];
        if (smcIsTest($f) || smcIsCancelled($f)) continue;   // skip test + cancelled
        $type = strtolower($f['issuetype']['name'] ?? '');
        $isClosed = (($f['status']['statusCategory']['key'] ?? '') === 'done');

        // Origin: internal vs external via "Caused by 3rd Party" (customfield_17238)
        $cb   = smcExtractField($f['customfield_17238'] ?? null);
        if ($cb !== '') $causedByValues[$cb] = ($causedByValues[$cb] ?? 0) + 1;
        $cbLc = strtolower($cb);
        $origin = ($cbLc !== '' && !preg_match('~^(no|none|n/?a|-|false|internal)$~', $cbLc))
                  ? 'external' : 'internal';

        // Action by SM / TS via assignee email
        $email = strtolower($f['assignee']['emailAddress'] ?? '');
        $action = isset($smSet[$email]) ? 'sm' : (isset($tsSet[$email]) ? 'ts' : 'other');

        if (strpos($type, 'batch') !== false) {
            $batch['total']++;
            if ($isClosed) $batch['closed']++;
            $batch[$origin]['total']++;
            if ($isClosed) $batch[$origin]['closed']++;
            $batch['actionBy'][$action]++;
        } else { // Monitoring
            $mon['total']++;
            if ($isClosed) $mon['closed']++;
            $mon[$origin]['total']++;
            if ($isClosed) $mon[$origin]['closed']++;
            $mon['actionBy'][$action]++;

            $db = strtoupper(smcExtractField($f['customfield_17016'] ?? null));
            if ($db !== '') $detectedByValues[$db] = ($detectedByValues[$db] ?? 0) + 1;
            if (preg_match('/\bSM\b/', $db))      $mon['detectedBy']['sm']++;
            elseif (preg_match('/\bSS\b/', $db))  $mon['detectedBy']['ss']++;
            else                                  $mon['detectedBy']['other']++;
        }
    }

    return [
        'month'      => $month,
        'v'          => SMC_CACHE_VERSION,
        'count'      => count($issues),
        'cachedAt'   => time(),
        'batchfile'  => $batch,
        'monitoring' => $mon,
        'diagnostics'=> ['detectedByValues' => $detectedByValues, 'causedByValues' => $causedByValues],
    ];
}
