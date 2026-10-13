<?php
// ══════════════════════════════════════════════════════════════════════
// api/service-performance/deploys.php  |  Auto-detect deploy events
// ══════════════════════════════════════════════════════════════════════
// GET /api/service-performance/deploys.php?service=X&window=720
//
// Returns array of DEPLOY events (not just pod restarts) inferred from
// two independent signals:
//   1. `kube_pod_created` clustering — ≥ N% of pods recreated inside a
//      short rolling bucket = deploy/rollout (not a single crash)
//   2. Micrometer `app_name` / `version` label transitions — a new
//      version tag appearing in http_server_requests_seconds_count is
//      a deploy signature (only available if the app exposes it)
//
// Signal 1 works for any workload with kube-state-metrics; signal 2 is
// bonus data for Spring Boot apps and gives us the actual version #.
// We merge them: same-timestamp events are deduped, version label wins
// as the "authoritative" event (has more metadata).
//
// Response:
//   {
//     service, window: { startUnix, endUnix, minutes },
//     deploys: [{
//        ts:           <unix>,
//        confidence:   'high' | 'medium' | 'low',
//        source:       'pod-recreate' | 'version-label' | 'both',
//        podsRecreated: N,          // for pod-recreate
//        version:       '1.5.2-77', // for version-label (if known)
//        note:          'human-readable summary'
//     }, ...],
//     fromCache: bool,
//     fetchedAt: ISO8601
//   }
//
// Cache: 5 min per (service, window, cluster) — deploys aren't
// happening every second, and the detection queries are heavy enough
// to justify aggressive caching.
// ══════════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';
requireAuth();

$service    = trim((string)($_GET['service'] ?? ''));
$windowMin  = max(5, min(43200, (int)($_GET['window'] ?? 720)));  // 12h default
$wantCluster = trim((string)($_GET['cluster'] ?? ''));
if ($service === '') respondError('service param required', 400);

// ── Cache ────────────────────────────────────────────────────────────
$cacheKey = preg_replace('/[^a-z0-9._-]+/i', '_', $service . '_' . $wantCluster . '_w' . $windowMin);
$cachePath = teamDataPath('service-performance/cache/deploys/' . $cacheKey . '.json');
$cacheTtl  = 300;   // 5 minutes
if (file_exists($cachePath) && (time() - (int)filemtime($cachePath)) <= $cacheTtl) {
    $cached = json_decode((string)file_get_contents($cachePath), true);
    if (is_array($cached)) {
        $cached['fromCache'] = true;
        respondOk($cached);
        return;
    }
}

// ── Resolve service source ───────────────────────────────────────────
// When a specific cluster is requested (URL param), fold it into the
// pod query filter directly so multi-cluster sources return ONLY pods
// from the wanted cluster. Previous version let any pod match win → we
// grabbed wrong-cluster pods from a source whose regex covers both.
$cfg     = spLoadConfig();
$sources = $cfg['sources'] ?? [];
$foundSrc = null; $foundNamespace = ''; $foundCluster = '';
$svcRe = _spPromEscape($service);
// Prefer sources whose cluster regex matches the wanted cluster first —
// avoids probing every source when we already know which one owns it.
if ($wantCluster !== '') {
    usort($sources, function($a, $b) use ($wantCluster) {
        $am = !empty($a['cluster']) && @preg_match('/' . str_replace('/', '\/', $a['cluster']) . '/', $wantCluster);
        $bm = !empty($b['cluster']) && @preg_match('/' . str_replace('/', '\/', $b['cluster']) . '/', $wantCluster);
        return ($bm ? 1 : 0) - ($am ? 1 : 0);
    });
}
foreach ($sources as $src) {
    try {
        $parts = ["pod=~\"{$svcRe}.*\""];
        if (!empty($src['namespaceRegex'])) $parts[] = "namespace=~\"{$src['namespaceRegex']}\"";
        // Cluster filter: if user asked for a specific one, use EXACT match
        // so we don't grab pods from a sibling cluster. Fall back to the
        // source's own regex when the user didn't pin a cluster.
        if ($wantCluster !== '')            $parts[] = "cluster=\"{$wantCluster}\"";
        elseif (!empty($src['cluster']))    $parts[] = "cluster=~\"{$src['cluster']}\"";
        $sel = implode(',', $parts);
        $res = spQueryPromQL($src, ['p' => "kube_pod_info{{$sel}}"]);
        if (empty($res['p'])) continue;
        $row = $res['p'][0]['metric'] ?? [];
        $foundSrc = $src;
        $foundNamespace = (string)($row['namespace'] ?? '');
        $foundCluster   = (string)($row['cluster']   ?? '');
        // If we got here we've either (a) matched the wanted cluster or
        // (b) auto-picked the first source with matching pods. Either way,
        // we're done — don't fall through to a worse match.
        break;
    } catch (Throwable $e) { continue; }
}
if (!$foundSrc) respondError('service not found in any source (wanted cluster: ' . $wantCluster . ')', 404);

// ── Signal 1: kube_pod_created clustering ────────────────────────────
// Query pod creation timestamps for every pod matching the service in
// the window. `kube_pod_created` is a gauge whose VALUE is the Unix
// timestamp when the pod was created. Filter to pods created within
// [start, end], then cluster by 10-minute buckets — a bucket with
// ≥50% of the workload's total pod count is a deploy.
$end   = time();
$start = $end - ($windowMin * 60);

$sel = [];
if ($foundCluster !== '')   $sel[] = "cluster=\"{$foundCluster}\"";
if ($foundNamespace !== '') $sel[] = "namespace=\"{$foundNamespace}\"";
$sel[] = "pod=~\"{$svcRe}.*\"";
$selStr = implode(',', $sel);

$deploys      = [];
$totalPods    = 0;
$debug        = ['signals' => []];    // populated inline for the ?debug=1 response
try {
    // Two variants: modern kube-state-metrics uses `kube_pod_created`;
    // older / OCP versions use `kube_pod_start_time`. Query both — either
    // returns the Unix timestamp of pod birth per series.
    $createdInst = spQueryPromQL($foundSrc, [
        'created' => "kube_pod_created{{$selStr}}",
        'started' => "kube_pod_start_time{{$selStr}}",
        'info'    => "count(kube_pod_info{{$selStr}})",
    ]);
    $totalPods = (int)(($createdInst['info'][0]['value'][1] ?? 0));
    $debug['signals']['kube_pod_created_series']    = count($createdInst['created'] ?? []);
    $debug['signals']['kube_pod_start_time_series'] = count($createdInst['started'] ?? []);
    $debug['signals']['kube_pod_info_count']        = $totalPods;
    // Prefer kube_pod_created; fall back to kube_pod_start_time (same shape).
    $createdSeries = !empty($createdInst['created']) ? $createdInst['created'] : ($createdInst['started'] ?? []);
    // Every pod → (creation timestamp, pod name). Filter to window.
    $podCreations = [];
    $rawCount = 0;
    foreach ($createdSeries as $row) {
        $pod = (string)($row['metric']['pod'] ?? '');
        $ts  = (int)(float)($row['value'][1] ?? 0);
        if ($pod === '') continue;
        $rawCount++;
        if ($ts < $start || $ts > $end) continue;
        $podCreations[] = ['pod' => $pod, 'ts' => $ts];
    }
    usort($podCreations, fn($a, $b) => $a['ts'] <=> $b['ts']);
    $debug['signals']['pods_in_window']      = count($podCreations);
    $debug['signals']['pods_total_returned'] = $rawCount;
    $debug['signals']['window_start']        = $start;
    $debug['signals']['window_end']          = $end;
    if ($rawCount > 0 && empty($podCreations)) {
        $debug['signals']['note'] = "$rawCount pods returned but none in window — all creation timestamps outside [start, end]";
    }

    // Bucket by 10-min windows starting at each creation event — sliding
    // window would be more accurate but 10-min fixed bucket is fast + fine
    // for deploys that finish in a few minutes.
    $BUCKET_SEC = 600;
    $MIN_RATIO  = 0.5;      // ≥50% of pods → deploy
    $MIN_ABSOLUTE = 2;       // OR ≥2 pods (for small workloads with 3 pods)

    $i = 0;
    while ($i < count($podCreations)) {
        $bucketStart = $podCreations[$i]['ts'];
        $bucketEnd   = $bucketStart + $BUCKET_SEC;
        $inBucket    = [];
        $j = $i;
        while ($j < count($podCreations) && $podCreations[$j]['ts'] <= $bucketEnd) {
            $inBucket[] = $podCreations[$j];
            $j++;
        }
        $count = count($inBucket);
        $ratio = $totalPods > 0 ? ($count / $totalPods) : 0;
        // Fire deploy if either strong ratio OR strong absolute count.
        if ($count >= $MIN_ABSOLUTE && ($ratio >= $MIN_RATIO || $count >= 3)) {
            $confidence = $ratio >= 0.8 ? 'high' : ($ratio >= 0.5 ? 'medium' : 'low');
            $deploys[] = [
                'ts'            => $bucketStart,
                'endTs'         => (int)$inBucket[count($inBucket)-1]['ts'],
                'confidence'    => $confidence,
                'source'        => 'pod-recreate',
                'podsRecreated' => $count,
                'totalPods'     => $totalPods,
                'ratio'         => round($ratio, 2),
                'version'       => null,
                'note'          => sprintf('%d/%d pods recreated (%d%% rolled)', $count, $totalPods, (int)round($ratio*100)),
            ];
        }
        $i = $j;
    }
} catch (Throwable $e) {
    $debug['signals']['signal1_error'] = $e->getMessage();
}

// ── Signal 2: version label transitions (Micrometer) ─────────────────
// If the app exposes `http_server_requests_seconds_count` with a `version`
// label, we can detect when a new version tag first appears in the data.
// `absent_over_time()` would be cleaner but not universally supported;
// simpler: query which versions exist per 5-min bucket + diff.
$jvmDsUid = (string)($foundSrc['jvmDsUid'] ?? '');
if ($jvmDsUid !== '' && $foundCluster !== '') {
    try {
        $jvmSrc = $foundSrc; $jvmSrc['dsUid'] = $jvmDsUid;
        $jvmSel = "app_name=\"{$service}\",cluster=\"{$foundCluster}\"";
        // Range query: which versions were serving each timestep
        $step = max(300, (int)round(($end - $start) / 60));   // ~60 samples
        $versionRes = spQueryPromRange($jvmSrc, [
            'v' => "count by (version) (rate(http_server_requests_seconds_count{{$jvmSel}}[5m]))",
        ], $start, $end, $step);
        // Track first-seen timestamp per version. Any new version = deploy.
        $firstSeen = [];
        foreach ($versionRes['v'] ?? [] as $row) {
            $ver = (string)($row['metric']['version'] ?? '');
            if ($ver === '') continue;
            foreach ($row['values'] ?? [] as $pair) {
                $ts  = (int)$pair[0];
                $val = (float)$pair[1];
                if ($val <= 0) continue;
                if (!isset($firstSeen[$ver]) || $ts < $firstSeen[$ver]) {
                    $firstSeen[$ver] = $ts;
                }
            }
        }
        // Sort versions by first-seen time — first version is the pre-existing
        // one (already running when window started), so skip it. Every
        // subsequent version = a deploy.
        asort($firstSeen);
        $isFirst = true;
        foreach ($firstSeen as $ver => $ts) {
            if ($isFirst) { $isFirst = false; continue; }
            // Merge with signal 1 if there's a matching pod-recreate event
            // within ± 10 min (same deploy detected by both signals).
            $mergedIdx = null;
            foreach ($deploys as $idx => $d) {
                if (abs($d['ts'] - $ts) <= 600) { $mergedIdx = $idx; break; }
            }
            if ($mergedIdx !== null) {
                $deploys[$mergedIdx]['source']  = 'both';
                $deploys[$mergedIdx]['version'] = $ver;
                $deploys[$mergedIdx]['confidence'] = 'high';
                $deploys[$mergedIdx]['note']   .= sprintf(' · version → %s', $ver);
            } else {
                $deploys[] = [
                    'ts'            => $ts,
                    'endTs'         => $ts,
                    'confidence'    => 'medium',
                    'source'        => 'version-label',
                    'podsRecreated' => null,
                    'totalPods'     => $totalPods,
                    'ratio'         => null,
                    'version'       => $ver,
                    'note'          => sprintf('New version %s appeared in metrics', $ver),
                ];
            }
        }
    } catch (Throwable $e) { /* silent — signal 2 is a bonus */ }
}

usort($deploys, fn($a, $b) => $a['ts'] <=> $b['ts']);

$out = [
    'service'    => $service,
    'namespace'  => $foundNamespace,
    'cluster'    => $foundCluster,
    'window'     => ['startUnix' => $start, 'endUnix' => $end, 'minutes' => $windowMin],
    'totalPods'  => $totalPods,
    'deploys'    => $deploys,
    'debug'      => $debug,   // always included so console can show why detection missed
    'fromCache'  => false,
    'fetchedAt'  => date('c'),
];

// Persist to cache — but skip empty results so a bad first query
// (missing kube_pod_created metric etc.) doesn't get stuck as "no deploys"
// for 5 min. Empty responses get 1-min TTL via mtime tracking below.
$dir = dirname($cachePath);
if (!is_dir($dir)) @mkdir($dir, 0775, true);
@file_put_contents($cachePath, json_encode($out));
if (empty($deploys)) {
    // Backdate mtime so cache check considers this file 4 min old — TTL
    // drops from 5 min to 1 min effectively, giving fresh retries for
    // detection tuning without full disabling of caching.
    @touch($cachePath, time() - 240);
}

respondOk($out);
