<?php
/**
 * _fetch_lib.php — shared runway-fetch logic.
 *
 * Extracted from fetch.php so both HTTP (fetch.php) and CLI (backfill.php)
 * entry points can drive the same pipeline. fetch.php handles auth + today's
 * anchor; backfill.php handles historical anchor sweeps without auth.
 *
 * Callers must have already loaded api/helpers.php and
 * api/service-severity/_lookup.php.
 */

// Prometheus instant query helper — used for the 6 restart/mem/cpu queries
// anchored at a specific timestamp.
function _rmFetchPromQ(string $url, string $token, string $orgId, string $dsUid, string $query, int $ts): array {
    $endpoint = $url . '/api/datasources/proxy/uid/' . $dsUid . '/api/v1/query';
    $ch  = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query(['query' => $query, 'time' => $ts]),
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $token,
            'X-Grafana-Org-Id: '     . $orgId,
            'Content-Type: application/x-www-form-urlencoded',
        ],
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $d = json_decode((string)$body, true);
    $ok = ($d['status'] ?? '') === 'success';
    if (!$ok) {
        logIntegrationError('grafana-prometheus', $endpoint, $err ?: "HTTP {$code}", [
            'http_code'  => $code,
            'query'      => mb_substr($query, 0, 200),
            'body_start' => substr((string)$body, 0, 200),
        ]);
    }
    return $ok ? ($d['data']['result'] ?? []) : [];
}

// Prometheus range query — used for the HPA scale-timeline pass so we can
// reconstruct WHEN each transition happened + the from→to replica delta.
// changes()[24h] only gives us the count; the raw series does the rest.
function _rmFetchPromRange(string $url, string $token, string $orgId, string $dsUid, string $query, int $start, int $end, string $step): array {
    $endpoint = $url . '/api/datasources/proxy/uid/' . $dsUid . '/api/v1/query_range';
    $ch  = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query([
            'query' => $query, 'start' => $start, 'end' => $end, 'step' => $step,
        ]),
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $token,
            'X-Grafana-Org-Id: '     . $orgId,
            'Content-Type: application/x-www-form-urlencoded',
        ],
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $d = json_decode((string)$body, true);
    $ok = ($d['status'] ?? '') === 'success';
    if (!$ok) {
        logIntegrationError('grafana-prometheus', $endpoint, $err ?: "HTTP {$code}", [
            'http_code'  => $code,
            'query'      => mb_substr($query, 0, 200),
            'body_start' => substr((string)$body, 0, 200),
        ]);
    }
    return $ok ? ($d['data']['result'] ?? []) : [];
}

function _rmMk(array $m): string {
    return ($m['pod'] ?? '') . '|' . ($m['container'] ?? '') . '|' . ($m['namespace'] ?? '');
}

/**
 * Run the full fetch pipeline for ONE runway anchored at ONE date/time.
 * Writes raw + daily JSON, optionally fires Chat+email notifications.
 *
 * @param array        $rw           Entry from grafana-runways.json (name/slug/tokenEnv/…)
 * @param DateTime     $anchorDt     Anchor moment — usually {date} 09:00 Asia/Bangkok
 * @param DateTimeZone $tz           Timezone the anchor was created in
 * @param array        $svcMap       loadServiceSeverityMap() result
 * @param bool         $force        Overwrite existing raw file if true
 * @param bool         $sendNotify   Fire Chat + email if true
 * @param string       $userLabel    Recorded as triggeredBy in activity log
 * @param string       $sourceTag    Written into raw JSON 'source' field
 *                                   ('browser' for HTTP, 'cli-backfill' for CLI)
 *
 * @return array Result row: {runway, status, totalPods?, totalRestarts?, chatSent?, emailSent?, reason?, file?}
 */
function rmFetchOneRunwayDate(
    array $rw,
    DateTime $anchorDt,
    DateTimeZone $tz,
    array $svcMap,
    bool $force = false,
    bool $sendNotify = true,
    string $userLabel = '',
    string $sourceTag = 'browser'
): array {
    $name       = $rw['name'];
    $slug       = $rw['slug'];
    $grafanaUrl = rtrim($rw['grafanaUrl'], '/');
    $token      = getenv($rw['tokenEnv'] ?? '') ?: '';
    $orgId      = (string)($rw['orgId'] ?? '');
    $dsUid      = $rw['dsUid'] ?? '';
    $cluster    = $rw['cluster'] ?? '';
    $nsRegex    = $rw['namespaceRegex']   ?? '.+';
    $nsExclude  = $rw['namespaceExclude'] ?? '';
    $podExclude = $rw['podExclude']       ?? '';

    $dateStr  = $anchorDt->format('Y-m-d');
    $anchorTs = $anchorDt->getTimestamp();

    if (!$token) {
        return ['runway' => $name, 'status' => 'skip', 'reason' => "{$rw['tokenEnv']} not set"];
    }

    // Iteration-start breadcrumb so silent drop-outs mid-loop are debuggable from activity.json.
    logActivity('restart_monitor_iteration_start', ['runway' => $name, 'date' => $dateStr, 'source' => $sourceTag]);

    $rawDir = teamDataPath('grafana-monitoring/raw/' . $slug . '/');
    if (!is_dir($rawDir)) @mkdir($rawDir, 0775, true);
    $outFile = $rawDir . $dateStr . '.json';

    // ── Concurrency lock per runway+date ────────────────────────────────────
    // Prevents duplicate-write races between simultaneous callers (2 browser
    // tabs, browser + CLI backfill overlapping, etc). Non-blocking: 2nd caller
    // exits with status=locked so the outer scheduler can retry later.
    $lockDir = teamDataPath('grafana-monitoring/locks/');
    if (!is_dir($lockDir)) @mkdir($lockDir, 0775, true);
    $lockFile   = $lockDir . $slug . '_' . $dateStr . '.lock';
    $lockHandle = @fopen($lockFile, 'c');
    if (!$lockHandle || !@flock($lockHandle, LOCK_EX | LOCK_NB)) {
        if ($lockHandle) fclose($lockHandle);
        logActivity('restart_monitor_raw_fetch_locked', ['runway' => $name, 'date' => $dateStr]);
        return ['runway' => $name, 'status' => 'locked', 'reason' => 'another process is processing this runway+date'];
    }
    @ftruncate($lockHandle, 0);
    @fwrite($lockHandle, getmypid() . "\n" . date('c'));

    // Re-check dedup INSIDE the lock (the first caller may have just finished)
    if (!$force && file_exists($outFile)) {
        flock($lockHandle, LOCK_UN); fclose($lockHandle); @unlink($lockFile);
        return ['runway' => $name, 'status' => 'already_done', 'file' => 'raw/' . $slug . '/' . $dateStr . '.json'];
    }

    // Selectors — cluster optional (single-cluster Prometheus, e.g. OCP)
    $parts = [];
    if ($cluster !== '') $parts[] = "cluster=\"{$cluster}\"";
    $parts[] = "namespace=~\"{$nsRegex}\"";
    if ($nsExclude)  $parts[] = "namespace!~\"{$nsExclude}\"";
    if ($podExclude) $parts[] = "pod!~\"{$podExclude}\"";
    $base   = implode(',', $parts);
    $baseKs = $base . ',job="kubernetes-state"';

    $pq = fn($q) => _rmFetchPromQ($grafanaUrl, $token, $orgId, $dsUid, $q, $anchorTs);

    // last_over_time recovers data for pods that have since been deleted —
    // kube-state-metrics drops their series, but values within the 24h window
    // are still accessible via the range aggregator.
    //
    // Retry loop: on today's anchor Thanos ingestion for 09:00 can lag; on a
    // historical anchor the data is already there so retries usually never fire.
    $maxAttempts = 4;
    $attempt     = 0;
    $qRestarts = $qTimes = $qReasons = $qMemUsed = $qMemLimit = $qCpuUsed = $qCpuLimit = [];
    while ($attempt < $maxAttempts) {
        $attempt++;
        $qRestarts = $pq("increase(kube_pod_container_status_restarts_total{{$baseKs}}[24h]) > 0");
        $qTimes    = $pq("last_over_time(kube_pod_container_status_last_terminated_timestamp{{$base}}[24h])");
        $qReasons  = $pq("last_over_time(kube_pod_container_status_last_terminated_reason{{$base}}[24h]) > 0");
        $qMemUsed  = $pq("last_over_time(container_memory_working_set_bytes{{$base},container!=\"\",container!=\"POD\"}[24h])");
        $qMemLimit = $pq("last_over_time(kube_pod_container_resource_limits{{$base},resource=\"memory\",container!=\"\"}[24h])");
        $qCpuUsed  = $pq("last_over_time(rate(container_cpu_usage_seconds_total{{$base},container!=\"\",container!=\"POD\"}[5m])[24h:30m])");
        $qCpuLimit = $pq("last_over_time(kube_pod_container_resource_limits{{$base},resource=\"cpu\",container!=\"\"}[24h])");

        // "Are metrics available?" — mem/cpu queries should ALWAYS return data
        // for a live cluster. Restart queries CAN legitimately be empty on a
        // healthy 0-restart day, so they can't be part of this signal.
        $metricsAvailable = count($qMemUsed) + count($qMemLimit) + count($qCpuUsed) + count($qCpuLimit);
        if ($metricsAvailable > 0) break;

        if ($attempt < $maxAttempts) {
            logActivity('restart_monitor_raw_fetch_retry', [
                'date' => $dateStr, 'runway' => $name, 'attempt' => $attempt,
                'reason' => 'metrics queries empty — retrying in 15s (Thanos ingestion lag?)',
            ]);
            sleep(15);
        }
    }

    $metricsAvailable = count($qMemUsed) + count($qMemLimit) + count($qCpuUsed) + count($qCpuLimit);
    if ($metricsAvailable === 0) {
        flock($lockHandle, LOCK_UN); fclose($lockHandle); @unlink($lockFile);
        logActivity('restart_monitor_raw_fetch_empty', [
            'date' => $dateStr, 'runway' => $name, 'attempts' => $maxAttempts,
            'reason' => 'metrics queries empty after retries — likely Grafana/Thanos/network issue',
        ]);
        return ['runway' => $name, 'status' => 'error', 'reason' => 'metrics queries empty after retries — file preserved for later run'];
    }

    $mapRestarts = $mapTimes = $mapReasons = $mapMemUsed = $mapMemLimit = $mapCpuUsed = $mapCpuLimit = [];
    foreach ($qRestarts as $r) { $k = _rmMk($r['metric']); $mapRestarts[$k] = max($mapRestarts[$k] ?? 0, (float)($r['value'][1] ?? 0)); }
    foreach ($qTimes    as $r) { $k = _rmMk($r['metric']); if (!isset($mapTimes[$k]))    $mapTimes[$k]    = (float)($r['value'][1] ?? 0); }
    foreach ($qReasons  as $r) { $k = _rmMk($r['metric']); if (!isset($mapReasons[$k]))  $mapReasons[$k]  = $r['metric']['reason'] ?? null; }
    foreach ($qMemUsed  as $r) { $k = _rmMk($r['metric']); if (!isset($mapMemUsed[$k]))  $mapMemUsed[$k]  = (float)($r['value'][1] ?? 0); }
    foreach ($qMemLimit as $r) { $k = _rmMk($r['metric']); if (!isset($mapMemLimit[$k])) $mapMemLimit[$k] = (float)($r['value'][1] ?? 0); }
    foreach ($qCpuUsed  as $r) { $k = _rmMk($r['metric']); if (!isset($mapCpuUsed[$k]))  $mapCpuUsed[$k]  = (float)($r['value'][1] ?? 0); }
    foreach ($qCpuLimit as $r) { $k = _rmMk($r['metric']); if (!isset($mapCpuLimit[$k])) $mapCpuLimit[$k] = (float)($r['value'][1] ?? 0); }

    // Additional context — pod age + HPA scale history. These do not need the
    // retry loop above because they use non-window metrics (creation time is
    // absolute; changes()[24h] tolerates ingestion lag) and empty is legitimate
    // (services without HPA, brand-new pods).
    $qPodCreated = $pq("kube_pod_created{{$base}}");
    $baseHpa     = ($cluster !== '' ? "cluster=\"{$cluster}\"," : '') . "namespace=~\"{$nsRegex}\"";
    $qHpaCurrent = $pq("kube_horizontalpodautoscaler_status_current_replicas{{$baseHpa}}");
    $qHpaChanges = $pq("changes(kube_horizontalpodautoscaler_status_current_replicas{{$baseHpa}}[24h])");

    $mapPodCreated = [];
    foreach ($qPodCreated as $r) {
        $k = ($r['metric']['pod'] ?? '') . '|' . ($r['metric']['namespace'] ?? '');
        if (!isset($mapPodCreated[$k])) $mapPodCreated[$k] = (float)($r['value'][1] ?? 0);
    }
    $hpaEvents = [];
    // NOTE: use $hpaName here — do NOT reuse $name, which holds the runway
    // name from the caller. Overwriting it corrupted 'runway' => $name in the
    // output which then broke _resolveRunwayWebhook() in _notify.php.
    foreach ($qHpaCurrent as $r) {
        $hpaName = $r['metric']['horizontalpodautoscaler'] ?? '';
        if ($hpaName === '') continue;
        $hpaEvents[$hpaName] = ['currentReplicas' => (int)($r['value'][1] ?? 0), 'scaleEvents24h' => 0];
    }
    foreach ($qHpaChanges as $r) {
        $hpaName = $r['metric']['horizontalpodautoscaler'] ?? '';
        if ($hpaName === '') continue;
        $c = (int)round((float)($r['value'][1] ?? 0));
        if (!isset($hpaEvents[$hpaName])) $hpaEvents[$hpaName] = ['currentReplicas' => null];
        $hpaEvents[$hpaName]['scaleEvents24h'] = $c;
    }

    // ── HPA scale timeline (only for HPAs with activity) ──────────────────
    // Second pass: for HPAs where scaleEvents24h > 0, range-query the current-
    // replicas metric at 30s step over 24h, walk the series, record transitions.
    // Runs against only the active subset (~3-10 of ~60 HPAs typical) so it
    // stays cheap on Thanos.
    // NOTE: do NOT use preg_quote() on HPA names for the Prom regex — RE2 syntax
    // differs from PCRE (biting us before in service-performance/_lib.php). HPA
    // names are k8s-valid (lowercase alnum + '-') so raw concatenation is safe.
    $activeHpas = [];
    foreach ($hpaEvents as $hpaName => $ev) {
        if ((int)($ev['scaleEvents24h'] ?? 0) > 0) $activeHpas[] = $hpaName;
    }
    if ($activeHpas) {
        $hpaRegex   = implode('|', $activeHpas);
        $rangeStart = $anchorTs - 86400;
        $rangeQuery = "kube_horizontalpodautoscaler_status_current_replicas{{$baseHpa},horizontalpodautoscaler=~\"{$hpaRegex}\"}";
        $rangeRes   = _rmFetchPromRange($grafanaUrl, $token, $orgId, $dsUid, $rangeQuery, $rangeStart, $anchorTs, '30s');

        foreach ($rangeRes as $series) {
            $hpaName = $series['metric']['horizontalpodautoscaler'] ?? '';
            if ($hpaName === '' || !isset($hpaEvents[$hpaName])) continue;
            $timeline = [];
            $prev = null;
            foreach ($series['values'] ?? [] as $pt) {
                $ts = (int)$pt[0];
                $v  = (int)round((float)$pt[1]);
                if ($prev === null) { $prev = $v; continue; }
                if ($v !== $prev) {
                    $timeline[] = [
                        'ts'   => $ts,
                        'time' => (new DateTime('@' . $ts))->setTimezone($tz)->format('H:i'),
                        'from' => $prev,
                        'to'   => $v,
                    ];
                    $prev = $v;
                }
            }
            $hpaEvents[$hpaName]['scaleTimeline'] = $timeline;
        }
    }

    $pods = [];
    foreach ($mapRestarts as $key => $rawCount) {
        $count = (int)round($rawCount);
        if ($count < 1) continue;

        [$pod, $container, $namespace] = array_pad(explode('|', $key, 3), 3, '');
        $timeUnix    = (isset($mapTimes[$key]) && $mapTimes[$key] > 0) ? (int)$mapTimes[$key] : null;
        $restartedAt = $timeUnix ? (new DateTime('@' . $timeUnix))->setTimezone($tz)->format(DateTime::ATOM) : null;

        $memUsedBytes  = isset($mapMemUsed[$key])  ? (int)$mapMemUsed[$key]  : null;
        $memLimitBytes = isset($mapMemLimit[$key]) ? (int)$mapMemLimit[$key] : null;
        $memRatio      = ($memUsedBytes !== null && $memLimitBytes > 0) ? round($memUsedBytes / $memLimitBytes, 4) : null;

        $cpuCores      = isset($mapCpuUsed[$key])  ? round($mapCpuUsed[$key],  6) : null;
        $cpuLimitCores = isset($mapCpuLimit[$key]) ? round($mapCpuLimit[$key], 4) : null;
        $cpuRatio      = ($cpuCores !== null && $cpuLimitCores > 0) ? round($cpuCores / $cpuLimitCores, 4) : null;

        $svc = lookupServicePriority($pod, $svcMap);

        $podKey         = "{$pod}|{$namespace}";
        $podCreatedUnix = isset($mapPodCreated[$podKey]) && $mapPodCreated[$podKey] > 0 ? (int)$mapPodCreated[$podKey] : null;
        $podAgeSeconds  = $podCreatedUnix !== null ? max(0, $anchorTs - $podCreatedUnix) : null;
        $podAgeDays     = $podAgeSeconds !== null ? round($podAgeSeconds / 86400, 3) : null;

        $pods[] = [
            'pod'              => $pod,
            'container'        => $container,
            'namespace'        => $namespace,
            'restartCount'     => $count,
            'terminationReason'=> $mapReasons[$key] ?? null,
            'restartedAt'      => $restartedAt,
            'restartedAtUnix'  => $timeUnix,
            'podCreatedUnix'   => $podCreatedUnix,
            'podAgeSeconds'    => $podAgeSeconds,
            'podAgeDays'       => $podAgeDays,
            'memoryUsedBytes'  => $memUsedBytes,
            'memoryLimitBytes' => $memLimitBytes,
            'memoryUsageRatio' => $memRatio,
            'cpuUsedCores'     => $cpuCores,
            'cpuLimitCores'    => $cpuLimitCores,
            'cpuUsageRatio'    => $cpuRatio,
            'priority'         => $svc['priority'],
            'severity'         => $svc['severity'],
        ];
    }

    usort($pods, fn($a, $b) => $b['restartCount'] !== $a['restartCount']
        ? $b['restartCount'] - $a['restartCount'] : strcmp($a['pod'], $b['pod']));

    $reasonSummary   = [];
    $severitySummary = ['critical' => 0, 'warning' => 0, 'info' => 0];
    foreach ($pods as $p) {
        $r = $p['terminationReason'] ?? 'Unknown';
        $reasonSummary[$r] = ($reasonSummary[$r] ?? 0) + 1;
        $s = $p['severity'] ?? 'info';
        $severitySummary[$s] = ($severitySummary[$s] ?? 0) + 1;
    }
    arsort($reasonSummary);

    $output = [
        'date'            => $dateStr,
        'generatedAt'     => $anchorDt->format(DateTime::ATOM),
        'source'          => $sourceTag,
        'runway'          => $name,
        'cluster'         => $cluster,
        'scanWindowHours' => 24,
        'totalPods'       => count($pods),
        'totalRestarts'   => array_sum(array_column($pods, 'restartCount')),
        'severitySummary' => $severitySummary,
        'reasonSummary'   => $reasonSummary,
        'hpaEvents'       => $hpaEvents,
        'pods'            => $pods,
    ];

    $json = json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp  = $outFile . '.tmp.' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $json) === false || !rename($tmp, $outFile)) {
        @unlink($tmp);
        flock($lockHandle, LOCK_UN); fclose($lockHandle); @unlink($lockFile);
        return ['runway' => $name, 'status' => 'error', 'reason' => 'failed to write raw'];
    }
    logActivity('restart_monitor_raw_fetch', [
        'date' => $dateStr, 'runway' => $name,
        'totalPods' => $output['totalPods'], 'totalRestarts' => $output['totalRestarts'],
        'triggeredBy' => $userLabel ?: 'unknown',
        'source'      => $sourceTag,
    ]);

    // ── Also write daily/{slug}/{date}.json (Analyzed tab) ──────────────────
    // Same severity-enriched content + scanRange metadata so Analyzed tab is
    // also populated without needing the Claude Code routine + upload.php.
    $start = (clone $anchorDt)->modify('-24 hours');
    $dailyOutput = $output;
    $dailyOutput['source']          = $sourceTag === 'browser' ? 'browser-auto' : $sourceTag;
    $dailyOutput['scanRangeStart']  = $start->format(DateTime::ATOM);
    $dailyOutput['scanRangeEnd']    = $anchorDt->format(DateTime::ATOM);
    $dailyOutput['grafanaUrl']      = $grafanaUrl;
    $dailyOutput['datasourceUid']   = $dsUid;
    $dailyOutput['datasourceOrgId'] = (int)$orgId;

    $dailyDir = teamDataPath('grafana-monitoring/daily/' . $slug . '/');
    if (!is_dir($dailyDir)) @mkdir($dailyDir, 0775, true);
    $dailyFile = $dailyDir . $dateStr . '.json';
    $dailyJson = json_encode($dailyOutput, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp2 = $dailyFile . '.tmp.' . bin2hex(random_bytes(4));
    @file_put_contents($tmp2, $dailyJson) && @rename($tmp2, $dailyFile);

    // ── Send notification (Chat + Email) — idempotent per runway+date ───────
    $notiResult = null;
    if ($sendNotify) {
        require_once __DIR__ . '/_notify.php';
        try { $notiResult = sendRestartMonitorNotifications($dailyOutput); }
        catch (Throwable $e) { $notiResult = ['error' => $e->getMessage()]; }
    }

    // Release lock — others can now safely see the completed file
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    @unlink($lockFile);

    return [
        'runway'        => $name,
        'status'        => 'done',
        'totalPods'     => $output['totalPods'],
        'totalRestarts' => $output['totalRestarts'],
        'chatSent'      => $notiResult['chat']['sent']  ?? false,
        'emailSent'     => $notiResult['email']['sent'] ?? false,
    ];
}
