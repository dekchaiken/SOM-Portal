<?php
/**
 * Incidents Analytics — aggregated stats for the Analytics dashboard.
 * GET /api/jira/incidents-analytics.php?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD[&refresh=1]
 *
 * Strategy: PER-MONTH CACHE
 *   - Split the requested range into month buckets (YYYY-MM).
 *   - For each month: read from data/analytics-cache/incidents-YYYY-MM.json.
 *       • Past months (< current month) → immutable, use cache forever unless ?refresh=1.
 *       • Current month → re-fetch if cached > CURRENT_MONTH_TTL seconds ago.
 *       • Miss → fetch that single month from Jira, aggregate, write cache.
 *   - Merge all monthly buckets into the final response.
 *
 * Classification rules:
 *   - detectedBy (customfield_17016) in ("SM","SS")               ⇒ "Detected by SM"
 *   - "Caused by 3rd Party" (customfield_17238) has a value        ⇒ External, else Internal.
 */
require_once __DIR__ . '/../helpers.php';

const CACHE_DIR         = __DIR__ . '/../../data/analytics-cache';
const CURRENT_MONTH_TTL = 600;   // 10 minutes
const JIRA_TIMEOUT      = 60;    // seconds per page
// Bump whenever the aggregation logic changes (fields, classifiers, test filter)
// so every cached month is recomputed automatically — no manual Force needed.
const CACHE_VERSION     = 5;

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

    // ── Debug mode: fetch 3 raw issues from the latest month & dump fields ─
    if ($debug) {
        $month = substr($toDate, 0, 7);
        $first = $month . '-01';
        $last  = date('Y-m-d', strtotime($first . ' +1 month -1 day'));
        $jql   = '"Ticket category" = Incidents AND project = TJCR '
               . 'AND issuetype in ("Sub-incidents", "TH incident") '
               . "AND created >= \"{$first}\" AND created <= \"{$last} 23:59\" ORDER BY created DESC";
        // Dump ALL fields for a few issues so we can discover the real field ids
        // (e.g. which customfield holds "Detecting outage by SM" / "Caused by 3rd Party").
        $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query([
            'jql' => $jql, 'maxResults' => 3, 'fields' => '*all',
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
        respondOk(['month' => $month, 'raw' => json_decode($resp, true)]);
    }

    // ── Detail mode: the actual issues behind one KPI cell ────────────────
    //    &detail=1 &sev=1|2|3|all &origin=all|internal|external &detected=all|sm|other
    if (!empty($_GET['detail'])) {
        $sev      = (string)($_GET['sev']      ?? 'all');
        $origin   = (string)($_GET['origin']   ?? 'all');
        $detected = (string)($_GET['detected'] ?? 'all');

        $jql = '"Ticket category" = Incidents AND project = TJCR '
             . 'AND issuetype in ("Sub-incidents", "TH incident") '
             . "AND created >= \"{$fromDate}\" AND created <= \"{$toDate} 23:59\" "
             . 'ORDER BY created DESC';

        // Paginate with nextPageToken (the /search/jql endpoint ignores startAt),
        // dedupe by issue key so overlapping pages never double-count.
        $issuesById = [];
        $pageSize = 100; $iter = 0; $cap = 1000; $nextToken = null;
        do {
            $iter++;
            $params = ['jql' => $jql, 'maxResults' => $pageSize,
                       'fields' => 'created,summary,status,customfield_17031,customfield_17016,customfield_17238'];
            if ($nextToken) $params['nextPageToken'] = $nextToken;
            $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query($params);
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => JIRA_TIMEOUT,
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
            $f = $issue['fields'] ?? [];
            if (isTestIssue($f) || isCancelled($f)) continue;   // skip test + cancelled
            $s = '3';
            if (isset($f['customfield_17031']['value']) &&
                preg_match('/(\d)/', (string)$f['customfield_17031']['value'], $m)) $s = $m[1];
            if (!in_array($s, ['1','2','3'], true)) $s = '3';

            $db   = strtoupper(extractFieldValue($f['customfield_17016'] ?? null));
            $isSM = isDetectedSM($f);
            $c3   = extractFieldValue($f['customfield_17238'] ?? null);
            $og   = classifyOrigin($f);

            if ($sev !== 'all' && $s !== $sev)                 continue;
            if ($origin !== 'all' && $og !== $origin)          continue;
            if ($detected === 'sm' && !$isSM)                  continue;
            if ($detected === 'other' && $isSM)                continue;

            $rows[] = [
                'key'        => $issue['key'],
                'summary'    => $f['summary']            ?? '',
                'created'    => $f['created']            ?? '',
                'severity'   => $s,
                'detectedBy' => $db !== '' ? $db : '—',
                'isSM'       => $isSM,
                'thirdParty' => $c3 !== '' ? $c3 : '—',
                'origin'     => $og,
                'status'     => $f['status']['name']     ?? '—',
                'url'        => JIRA_BASE_URL . '/browse/' . $issue['key'],
            ];
        }

        respondOk([
            'filter'    => ['sev'=>$sev, 'origin'=>$origin, 'detected'=>$detected,
                            'fromDate'=>$fromDate, 'toDate'=>$toDate],
            'count'     => count($rows),
            'truncated' => count($issues) >= $cap,
            'rows'      => $rows,
        ]);
    }

    if (!is_dir(CACHE_DIR)) @mkdir(CACHE_DIR, 0775, true);

    // ── Iterate months ────────────────────────────────────────────────────
    $currentMonth = date('Y-m');
    $monthBuckets = [];   // month => bucket
    $cacheStatus  = [];   // month => 'hit'|'miss'|'stale'|'refresh'

    $cur = strtotime(substr($fromDate, 0, 7) . '-01');
    $end = strtotime(substr($toDate,   0, 7) . '-01');
    while ($cur <= $end) {
        $month     = date('Y-m', $cur);
        $cacheFile = CACHE_DIR . "/incidents-{$month}.json";
        $bucket    = null;
        $status    = 'miss';

        if (!$force && is_file($cacheFile)) {
            $cached = json_decode((string)@file_get_contents($cacheFile), true);
            if (is_array($cached) && isset($cached['month']) && ($cached['v'] ?? 0) === CACHE_VERSION) {
                if ($month < $currentMonth) {
                    $bucket = $cached; $status = 'hit';
                } else {
                    $age = time() - (int)($cached['cachedAt'] ?? 0);
                    if ($age < CURRENT_MONTH_TTL) { $bucket = $cached; $status = 'hit'; }
                    else { $status = 'stale'; }
                }
            }
        } elseif ($force) {
            $status = 'refresh';
        }

        if ($bucket === null) {
            $bucket = fetchMonthBucket($month);
            @file_put_contents($cacheFile, json_encode($bucket, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
        }

        $monthBuckets[$month] = $bucket;
        $cacheStatus[$month]  = $status;
        $cur = strtotime('+1 month', $cur);
    }

    // ── Merge into overall + severity + monthly list ──────────────────────
    $overall = ['total'=>0,'detectedSM'=>0,
                'internal'=>['total'=>0,'detectedSM'=>0],
                'external'=>['total'=>0,'detectedSM'=>0]];
    $bySev = [];
    foreach (['1','2','3'] as $s) {
        $bySev[$s] = ['total'=>0,'detectedSM'=>0,
                      'internal'=>['total'=>0,'detectedSM'=>0],
                      'external'=>['total'=>0,'detectedSM'=>0]];
    }
    $causedByValues = [];
    $detectedByValues = [];
    $fetchedCount = 0;

    $monthly = [];
    foreach ($monthBuckets as $month => $b) {
        $fetchedCount += (int)($b['count'] ?? 0);
        $ov = $b['overall'] ?? [];
        addBucket($overall, $ov);
        foreach (['1','2','3'] as $s) {
            addBucket($bySev[$s], $b['bySev'][$s] ?? []);
        }
        foreach ((array)($b['causedByValues'] ?? []) as $k => $v) {
            $causedByValues[$k] = ($causedByValues[$k] ?? 0) + $v;
        }
        foreach ((array)($b['detectedByValues'] ?? []) as $k => $v) {
            $detectedByValues[$k] = ($detectedByValues[$k] ?? 0) + $v;
        }
        $mTotal      = (int)($ov['total'] ?? 0);
        $mDetectedSM = (int)($ov['detectedSM'] ?? 0);
        $monthly[] = [
            'month'         => $month,
            'total'         => $mTotal,
            'detectedSM'    => $mDetectedSM,
            'detectedOther' => max(0, $mTotal - $mDetectedSM),
            'smPct'         => $mTotal > 0 ? round($mDetectedSM * 100 / $mTotal, 2) : 0,
            'missedIssues'  => $b['missedIssues'] ?? [],
        ];
    }

    // Percent helper
    $pct = function(int $num, int $den): float {
        return $den > 0 ? round($num * 100 / $den, 2) : 0.0;
    };
    $overall['smPct']             = $pct($overall['detectedSM'],             $overall['total']);
    $overall['internal']['smPct'] = $pct($overall['internal']['detectedSM'], $overall['internal']['total']);
    $overall['external']['smPct'] = $pct($overall['external']['detectedSM'], $overall['external']['total']);
    foreach (['1','2','3'] as $s) {
        $bySev[$s]['smPct']             = $pct($bySev[$s]['detectedSM'],             $bySev[$s]['total']);
        $bySev[$s]['internal']['smPct'] = $pct($bySev[$s]['internal']['detectedSM'], $bySev[$s]['internal']['total']);
        $bySev[$s]['external']['smPct'] = $pct($bySev[$s]['external']['detectedSM'], $bySev[$s]['external']['total']);
    }

    respondOk([
        'range'         => ['fromDate' => $fromDate, 'toDate' => $toDate],
        'fetchedCount'  => $fetchedCount,
        'monthly'       => $monthly,
        'overall'       => $overall,
        'bySeverity'    => $bySev,
        'cache'         => $cacheStatus,
        'diagnostics'   => [
            'causedByValues'   => $causedByValues,
            'detectedByValues' => $detectedByValues,
        ],
    ]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine(), 500);
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers (defined outside try block via closure re-declare pattern)
// ─────────────────────────────────────────────────────────────────────────

function addBucket(array &$dst, array $src): void {
    $dst['total']       += (int)($src['total']       ?? 0);
    $dst['detectedSM']  += (int)($src['detectedSM']  ?? 0);
    foreach (['internal','external'] as $k) {
        $dst[$k]['total']      += (int)($src[$k]['total']      ?? 0);
        $dst[$k]['detectedSM'] += (int)($src[$k]['detectedSM'] ?? 0);
    }
}

/**
 * Jira custom-field values come in many shapes:
 *   - null / missing
 *   - "string"                             (plain text / short text)
 *   - { value: "Foo" }                     (single-select)
 *   - { name: "Foo" }                      (some picker fields)
 *   - [ { value: "A" }, { value: "B" } ]   (multi-select)
 *   - [ "A", "B" ]                         (labels)
 * Normalise to a single trimmed string; multi-values joined by "|".
 */
function extractFieldValue($v): string {
    if ($v === null) return '';
    if (is_string($v)) return trim($v);
    if (is_array($v)) {
        // Object with value/name
        if (isset($v['value'])) return trim((string)$v['value']);
        if (isset($v['name']))  return trim((string)$v['name']);
        // List
        $parts = [];
        foreach ($v as $it) {
            if (is_string($it)) $parts[] = trim($it);
            elseif (is_array($it)) $parts[] = trim((string)($it['value'] ?? $it['name'] ?? ''));
        }
        return implode('|', array_filter($parts));
    }
    return trim((string)$v);
}

/** Detected By (customfield_17016) reads as SM — anything else (incl. SS) = Other. */
function isDetectedSM(array $f): bool {
    $db = strtoupper(extractFieldValue($f['customfield_17016'] ?? null));
    return $db === 'SM' || (bool)preg_match('/\bSM\b/', $db);
}

/**
 * Internal vs External via "Caused by 3rd Party" (customfield_17238):
 * any real 3rd-party value ⇒ External; empty / explicit "No" ⇒ Internal.
 */
function classifyOrigin(array $f): string {
    $c3 = strtolower(extractFieldValue($f['customfield_17238'] ?? null));
    $isExt = ($c3 !== '' && !preg_match('~^(no|none|n/?a|-|false|internal)$~', $c3));
    return $isExt ? 'external' : 'internal';
}

/** Exclude test tickets — summary contains "test" as a standalone word. */
function isTestIssue(array $f): bool {
    return (bool)preg_match('/\btest\b/i', (string)($f['summary'] ?? ''));
}

/** Exclude cancelled tickets — status name contains "cancel". */
function isCancelled(array $f): bool {
    return (bool)preg_match('/cancel/i', (string)($f['status']['name'] ?? ''));
}

/**
 * Fetch & aggregate a single month (YYYY-MM) from Jira.
 * Returns bucket:
 *   { month, count, cachedAt, overall{}, bySev{1,2,3}, causedByValues, detectedByValues }
 */
function fetchMonthBucket(string $month): array {
    $first = $month . '-01';
    $last  = date('Y-m-d', strtotime($first . ' +1 month -1 day'));
    $jql   = '"Ticket category" = Incidents AND project = TJCR '
           . 'AND issuetype in ("Sub-incidents", "TH incident") '
           . "AND created >= \"{$first}\" AND created <= \"{$last} 23:59\" "
           . 'ORDER BY created ASC';

    // Paginate with nextPageToken (the /search/jql endpoint ignores startAt),
    // dedupe by key so overlapping pages never inflate the counts.
    $issuesById = [];
    $pageSize   = 100;
    $iter       = 0;
    $nextToken  = null;
    do {
        $iter++;
        $params = ['jql' => $jql, 'maxResults' => $pageSize,
                   'fields' => 'summary,status,created,customfield_17031,customfield_17016,customfield_17238'];
        if ($nextToken) $params['nextPageToken'] = $nextToken;
        $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query($params);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => JIRA_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => [
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
            $msg  = $body['errorMessages'][0] ?? $body['message'] ?? substr((string)$resp, 0, 300);
            respondError("Jira HTTP {$code} for {$month}: {$msg}", 502);
        }
        $data = json_decode($resp, true);
        if (!$data || !isset($data['issues'])) break;
        foreach ($data['issues'] as $iss) { if (isset($iss['key'])) $issuesById[$iss['key']] = $iss; }
        $nextToken = $data['nextPageToken'] ?? null;
    } while ($nextToken && $iter < 50);
    $issues = array_values($issuesById);

    // Aggregate
    $overall = ['total'=>0,'detectedSM'=>0,
                'internal'=>['total'=>0,'detectedSM'=>0],
                'external'=>['total'=>0,'detectedSM'=>0]];
    $bySev = [];
    foreach (['1','2','3'] as $s) {
        $bySev[$s] = ['total'=>0,'detectedSM'=>0,
                      'internal'=>['total'=>0,'detectedSM'=>0],
                      'external'=>['total'=>0,'detectedSM'=>0]];
    }
    $causedByValues = [];
    $detectedByValues = [];
    $missedIssues = [];

    foreach ($issues as $issue) {
        $f = $issue['fields'] ?? [];
        if (isTestIssue($f) || isCancelled($f)) continue;   // skip test + cancelled
        $sev = '3';
        if (isset($f['customfield_17031']['value']) &&
            preg_match('/(\d)/', (string)$f['customfield_17031']['value'], $m)) $sev = $m[1];
        if (!isset($bySev[$sev])) $sev = '3';

        // Detected By (customfield_17016) — for SM/SS detection + diagnostics
        $detectedBy = strtoupper(extractFieldValue($f['customfield_17016'] ?? null));
        if ($detectedBy !== '') $detectedByValues[$detectedBy] = ($detectedByValues[$detectedBy] ?? 0) + 1;
        $isDetectedSM = isDetectedSM($f);

        // Internal vs External via "Caused by 3rd Party" (customfield_17238)
        $causedBy = extractFieldValue($f['customfield_17238'] ?? null);
        if ($causedBy !== '') $causedByValues[$causedBy] = ($causedByValues[$causedBy] ?? 0) + 1;
        $bucket = classifyOrigin($f);

        $overall['total']++;
        if ($isDetectedSM) $overall['detectedSM']++;
        $overall[$bucket]['total']++;
        if ($isDetectedSM) $overall[$bucket]['detectedSM']++;

        $bySev[$sev]['total']++;
        if ($isDetectedSM) $bySev[$sev]['detectedSM']++;
        $bySev[$sev][$bucket]['total']++;
        if ($isDetectedSM) $bySev[$sev][$bucket]['detectedSM']++;

        if (!$isDetectedSM) {
            $missedIssues[] = [
                'key'     => $issue['key'],
                'summary' => $f['summary'] ?? '',
                'url'     => JIRA_BASE_URL . '/browse/' . $issue['key'],
            ];
        }
    }

    return [
        'month'            => $month,
        'v'                => CACHE_VERSION,
        'count'            => count($issues),
        'cachedAt'         => time(),
        'overall'          => $overall,
        'bySev'            => $bySev,
        'causedByValues'   => $causedByValues,
        'detectedByValues' => $detectedByValues,
        'missedIssues'     => $missedIssues,
    ];
}
