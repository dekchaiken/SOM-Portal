<?php
// POST /api/alerts/tick.php
// Called every 30s by AlertsWatcher (assets/js/noti-scheduler.js) from any
// open browser tab. Server-side dedup + mutex mean N concurrent tabs
// evaluate at most once per throttle window.
//
// For each enabled rule:
//   1. Resolve service source (read detail.php cache, fall back to re-detect)
//   2. Fire PromQL for the rule's metric
//   3. Compare against threshold; update state machine (ok/pending/firing)
//   4. On transition ok→firing OR firing→ok, POST Google Chat card
//
// Returns { checked, sent, throttled }.
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_notify.php';
require_once __DIR__ . '/../service-performance/_lib.php';
requireAuth();

const ALERTS_THROTTLE_SEC = 25;  // don't re-evaluate more often than this

// ── Global mutex + throttle (batch-monitor-noti pattern) ────────────
// A single file lock serialises evaluation across every concurrent tab.
// If we can't grab the lock immediately we return { throttled: true }
// so the caller sees "someone else is evaluating right now" instead of
// stacking up. Under the lock we also honour a timestamp-based throttle
// so a burst of tabs opening at once doesn't run 10 evaluations back-to-
// back — only the first completes real work, the rest short-circuit.
$lockPath = teamDataPath(ALERTS_TICK_LOCK);
$lockDir  = dirname($lockPath);
if (!is_dir($lockDir)) @mkdir($lockDir, 0755, true);
$lockFp = fopen($lockPath, 'c');
if (!$lockFp) { respondOk(['throttled' => true, 'reason' => 'lock open failed']); return; }
if (!flock($lockFp, LOCK_EX | LOCK_NB)) {
    fclose($lockFp);
    respondOk(['throttled' => true, 'reason' => 'another tab is evaluating']);
    return;
}
try {
    $markerPath = teamDataPath(ALERTS_TICK_MARKER);
    $lastTick   = file_exists($markerPath) ? (int)trim((string)file_get_contents($markerPath)) : 0;
    if (time() - $lastTick < ALERTS_THROTTLE_SEC) {
        respondOk(['throttled' => true, 'reason' => 'within throttle window', 'nextInSec' => ALERTS_THROTTLE_SEC - (time() - $lastTick)]);
        return;
    }
    @file_put_contents($markerPath, (string)time());

    $rules   = alertsLoadRules();
    $state   = alertsLoadState();
    $notify  = alertsLoadNotifyConfig();
    $catalog = alertMetricsCatalog();
    $enabled = array_values(array_filter($rules, fn($r) => !empty($r['enabled'])));

    // Load service-performance sources once (used to resolve which
    // Prometheus/Thanos endpoint to hit for each rule's service).
    $spCfg   = spLoadConfig();
    $sources = $spCfg['sources'] ?? [];

    // Batch by service — if 5 rules watch the same service, we only need
    // to resolve its source + fetch its live/limit query pairs once.
    $bySvc = [];
    foreach ($enabled as $r) {
        $key = $r['service'] . '|' . ($r['cluster'] ?? '');
        $bySvc[$key] = $bySvc[$key] ?? ['service' => $r['service'], 'cluster' => $r['cluster'] ?? '', 'rules' => []];
        $bySvc[$key]['rules'][] = $r;
    }

    $sent    = 0;
    $checked = 0;
    $now     = time();

    foreach ($bySvc as $grp) {
        $svc     = $grp['service'];
        $cluster = $grp['cluster'];
        // Resolve the workload's source (Grafana ds + namespace + jvmDsUid).
        // Try cache first — SP.loadDetail() writes it whenever anyone views
        // the service, so any actively-monitored service has a fresh cache.
        $resolved = _alertsResolveSource($svc, $cluster, $sources);
        if (!$resolved) {
            // Mark all rules for this service as "no source" but don't
            // notify — usually means service is scaled to zero or the
            // detail page has never been opened for it.
            foreach ($grp['rules'] as $r) {
                $state[$r['id']] = ($state[$r['id']] ?? []) + ['state' => 'unknown', 'lastCheck' => $now, 'lastValue' => null, 'note' => 'source not resolved'];
                $checked++;
            }
            continue;
        }
        $src        = $resolved['src'];
        $namespace  = $resolved['namespace'];
        $selectedCl = $resolved['cluster'];

        // Build label selectors (matches detail.php conventions).
        $svcRe      = _spPromEscape($svc);
        $parts      = [];
        if ($selectedCl !== '') $parts[] = "cluster=\"{$selectedCl}\"";
        if ($namespace  !== '') $parts[] = "namespace=\"{$namespace}\"";
        else                    $parts[] = "namespace=~\"" . (string)($src['namespaceRegex'] ?? '.+') . "\"";
        $parts[] = "pod=~\"{$svcRe}.*\"";
        $sel     = implode(',', $parts);
        $contSel = "container=\"{$svc}\"";
        $jvmSel  = ($selectedCl !== '') ? "app_name=\"{$svc}\",cluster=\"{$selectedCl}\"" : "app_name=\"{$svc}\"";

        // Split rules by source so we can batch queries per datasource.
        $kubeSrc = $src;
        $jvmSrc  = $src; $jvmSrc['dsUid'] = (string)($src['jvmDsUid'] ?? '');

        $queries = [];   // key → PromQL
        foreach ($grp['rules'] as $r) {
            $m = $catalog[$r['metric']] ?? null;
            if (!$m) continue;
            // Per-endpoint scope: if the rule has uriPattern AND the metric
            // supports it, splice `,uri=~"<pat>"` into jvmSel so the query
            // filters to a specific route (e.g. only /api/withdraw).
            $ruleJvmSel = $jvmSel;
            $uriPat = (string)($r['uriPattern'] ?? '');
            if ($uriPat !== '' && !empty($m['supportsUri'])) {
                $ruleJvmSel .= ',uri=~"' . str_replace('"', '\\"', $uriPat) . '"';
            }
            $tpl = strtr($m['liveQuery'], [
                '{{sel}}'     => $sel,
                '{{contSel}}' => $contSel,
                '{{jvmSel}}'  => $ruleJvmSel,
                '{{svc}}'     => $svc,
            ]);
            $queries['live_' . $r['id']] = $tpl;
            if (!empty($m['limitQuery'])) {
                $tplLim = strtr($m['limitQuery'], [
                    '{{sel}}'     => $sel,
                    '{{contSel}}' => $contSel,
                    '{{jvmSel}}'  => $ruleJvmSel,
                    '{{svc}}'     => $svc,
                ]);
                $queries['limit_' . $r['id']] = $tplLim;
            }
        }
        if (!$queries) continue;

        // Fire kube queries + jvm queries separately (different datasources).
        // Split by whether each rule's metric is 'kube' or 'jvm'.
        $kubeQ = []; $jvmQ = [];
        foreach ($grp['rules'] as $r) {
            $m = $catalog[$r['metric']] ?? null; if (!$m) continue;
            $bucket = $m['source'] === 'jvm' ? 'jvmQ' : 'kubeQ';
            $$bucket['live_' . $r['id']] = $queries['live_' . $r['id']] ?? null;
            if (isset($queries['limit_' . $r['id']])) $$bucket['limit_' . $r['id']] = $queries['limit_' . $r['id']];
        }

        $results = [];
        if ($kubeQ) {
            try { $results += spQueryPromQL($kubeSrc, array_filter($kubeQ)); }
            catch (Throwable $e) { /* silent — rules see null value */ }
        }
        if ($jvmQ && !empty($src['jvmDsUid'])) {
            try { $results += spQueryPromQL($jvmSrc, array_filter($jvmQ)); }
            catch (Throwable $e) { /* silent */ }
        }

        $scalar = function($matrix) {
            if (empty($matrix)) return null;
            $v = $matrix[0]['value'][1] ?? null;
            return $v === null ? null : (float)$v;
        };

        // Test whether a single value breaches the rule's op+threshold.
        $testBreach = function(float $cmpValue, array $r): bool {
            return match ($r['op']) {
                '>'  => $cmpValue >  (float)$r['threshold'],
                '>=' => $cmpValue >= (float)$r['threshold'],
                '<'  => $cmpValue <  (float)$r['threshold'],
                '<=' => $cmpValue <= (float)$r['threshold'],
                default => false,
            };
        };

        foreach ($grp['rules'] as $r) {
            $checked++;
            $m   = $catalog[$r['metric']]; if (!$m) continue;

            // ── Per-pod evaluation (byPod metrics) ───────────────────────
            // liveQuery returns a vector (one series per pod). We check each
            // pod independently so the alert fires when ANY pod breaches the
            // threshold. The notification lists exactly which pods violated.
            if (!empty($m['byPod'])) {
                $podSeries = $results['live_' . $r['id']] ?? [];
                if (empty($podSeries)) {
                    $state[$r['id']] = ($state[$r['id']] ?? []) + ['state' => 'unknown', 'lastCheck' => $now, 'lastValue' => null];
                    continue;
                }
                // Resolve limit — scalar query (all pods in a Deployment share
                // the same limit from the pod spec).
                $limV = null;
                if (!empty($m['limitQuery'])) {
                    $limV = $scalar($results['limit_' . $r['id']] ?? []);
                    if (!$limV || $limV <= 0) {
                        $state[$r['id']] = ($state[$r['id']] ?? []) + ['state' => 'unknown', 'lastCheck' => $now, 'lastValue' => null, 'note' => 'no limit'];
                        continue;
                    }
                }

                $violatingPods = [];
                $maxValue      = 0.0;
                foreach ($podSeries as $series) {
                    $raw     = (float)($series['value'][1] ?? 0);
                    $podVal  = ($m['compareAs'] === 'pct' && $limV > 0)
                        ? ($raw / $limV) * 100
                        : $raw;
                    $podName = $series['metric']['pod'] ?? ($series['metric']['pod_name'] ?? '?');
                    if ($podVal > $maxValue) $maxValue = $podVal;
                    if ($testBreach($podVal, $r)) {
                        $violatingPods[] = ['pod' => $podName, 'value' => round($podVal, 1)];
                    }
                }

                $displayValue = $maxValue;
                $breached     = !empty($violatingPods);

                // State-machine + notification (same transitions as scalar path).
                $prev       = $state[$r['id']] ?? ['state' => 'ok', 'sinceTs' => 0, 'lastFireTs' => 0];
                $prevState  = $prev['state']    ?? 'ok';
                $newState   = $prevState;
                $sinceTs    = $prev['sinceTs']  ?? 0;
                $lastFireTs = $prev['lastFireTs'] ?? 0;
                $transitioned = null;

                if ($breached) {
                    if ($prevState === 'ok' || $prevState === 'unknown') {
                        $newState = 'pending'; $sinceTs = $now;
                    } elseif ($prevState === 'pending') {
                        if ($now - $sinceTs >= (int)$r['durationSec']) {
                            $newState = 'firing'; $sinceTs = $now; $lastFireTs = $now;
                            $transitioned = 'fire';
                        }
                    } elseif ($prevState === 'firing') {
                        $repeat = (int)($r['repeatIntervalSec'] ?? 0);
                        if ($repeat > 0 && ($now - $lastFireTs) >= $repeat) {
                            $lastFireTs = $now; $transitioned = 'fire';
                        }
                    }
                } else {
                    if ($prevState === 'firing')  { $newState = 'ok'; $sinceTs = $now; $transitioned = 'resolve'; }
                    elseif ($prevState !== 'ok')  { $newState = 'ok'; $sinceTs = $now; }
                }

                $notifyOk    = $prev['notifyOk']    ?? null;
                $notifyError = $prev['notifyError']  ?? null;
                if ($transitioned) {
                    $card   = alertsBuildCard($r, $m, $displayValue, $transitioned, $violatingPods);
                    $result = alertsSendCard($r, $card);
                    $notifyOk    = $result['ok'];
                    $notifyError = $result['error'];
                    if ($result['ok']) $sent++;
                }

                $state[$r['id']] = [
                    'state'          => $newState,
                    'sinceTs'        => $sinceTs,
                    'lastCheck'      => $now,
                    'lastValue'      => round($displayValue, 1),
                    'lastFireTs'     => $lastFireTs,
                    'violatingPods'  => $violatingPods,
                    'notifyOk'       => $notifyOk,
                    'notifyError'    => $notifyError,
                ];
                continue;
            }

            // ── Scalar evaluation (all other metrics) ─────────────────────
            $liveV  = $scalar($results['live_' . $r['id']] ?? []);
            if ($liveV === null) {
                $state[$r['id']] = ($state[$r['id']] ?? []) + ['state' => 'unknown', 'lastCheck' => $now, 'lastValue' => null];
                continue;
            }
            // Compute the value we'll compare to threshold. For pct-based
            // metrics, divide live by limit and multiply by 100 so the
            // rule's `threshold` field reads as a percent (e.g. 80).
            $cmpValue = $liveV;
            $displayValue = $liveV;
            if ($m['compareAs'] === 'pct' && !empty($m['limitQuery'])) {
                $limV = $scalar($results['limit_' . $r['id']] ?? []);
                if (!$limV || $limV <= 0) {
                    $state[$r['id']] = ($state[$r['id']] ?? []) + ['state' => 'unknown', 'lastCheck' => $now, 'lastValue' => $liveV, 'note' => 'no limit'];
                    continue;
                }
                $cmpValue = ($liveV / $limV) * 100;
                $displayValue = $cmpValue;
            }

            $breached = $testBreach($cmpValue, $r);

            // State machine:
            //   ok      → pending (first breach seen)
            //   pending → firing (breach held for durationSec) → notify
            //   any     → ok (breach cleared) → notify resolved
            $prev = $state[$r['id']] ?? ['state' => 'ok', 'sinceTs' => 0, 'lastFireTs' => 0];
            $prevState = $prev['state'] ?? 'ok';
            $newState  = $prevState;
            $sinceTs   = $prev['sinceTs'] ?? 0;
            $lastFireTs = $prev['lastFireTs'] ?? 0;
            $transitioned = null;

            if ($breached) {
                if ($prevState === 'ok' || $prevState === 'unknown') {
                    $newState = 'pending';
                    $sinceTs  = $now;
                } elseif ($prevState === 'pending') {
                    if ($now - $sinceTs >= (int)$r['durationSec']) {
                        $newState = 'firing';
                        $sinceTs  = $now;
                        $lastFireTs = $now;
                        $transitioned = 'fire';
                    }
                } elseif ($prevState === 'firing') {
                    // Repeat-fire while breach persists — only when the rule
                    // opts in via repeatIntervalSec > 0. Users who want a
                    // notification once per outage leave this at 0 (default).
                    // Common values: 300 (5m), 900 (15m), 3600 (1h).
                    $repeat = (int)($r['repeatIntervalSec'] ?? 0);
                    if ($repeat > 0 && ($now - $lastFireTs) >= $repeat) {
                        $lastFireTs = $now;
                        $transitioned = 'fire';
                    }
                }
            } else {
                if ($prevState === 'firing') {
                    $newState = 'ok';
                    $sinceTs  = $now;
                    $transitioned = 'resolve';
                } elseif ($prevState === 'pending') {
                    $newState = 'ok';
                    $sinceTs  = $now;
                } elseif ($prevState !== 'ok') {
                    $newState = 'ok';
                    $sinceTs  = $now;
                }
            }

            // Preserve prior notify-result flags so the UI can show what
            // happened last time the rule fired, not just the current state.
            $notifyOk     = $prev['notifyOk']     ?? null;
            $notifyError  = $prev['notifyError']  ?? null;

            if ($transitioned) {
                $card   = alertsBuildCard($r, $m, $displayValue, $transitioned, []);
                $result = alertsSendCard($r, $card);
                $notifyOk    = $result['ok'];
                $notifyError = $result['error'];
                if ($result['ok']) $sent++;
            }

            $state[$r['id']] = [
                'state'       => $newState,
                'sinceTs'     => $sinceTs,
                'lastCheck'   => $now,
                'lastValue'   => round($displayValue, 3),
                'lastFireTs'  => $lastFireTs,
                'notifyOk'    => $notifyOk,
                'notifyError' => $notifyError,
            ];
        }
    }

    alertsSaveState($state);
    respondOk(['throttled' => false, 'checked' => $checked, 'sent' => $sent]);

} finally {
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
}


// _alertsResolveSource() moved to _lib.php (shared with preview.php)

