<?php
/**
 * /api/batch-monitor-noti/tick.php
 *
 * Poll-driven watcher for Jenkins batch jobs. Any authenticated browser can
 * call this every 30s (via BatchMonitorWatcher in assets/js/noti-scheduler.js).
 * Server-side dedup ensures no duplicate cards when multiple users are online.
 *
 * Three-layer dedup:
 *   1. Global throttle       (data/batch-monitor-noti-tick.lock)
 *   2. Per-build sent log    (data/batch-monitor-noti-log.json)
 *   3. State-file diff       (data/batch-monitor-noti-state.json)
 *
 * Reuses:
 *   - postToChatThread()     from api/restart-monitor/_notify.php
 *   - jenkins_config.php     for server list + creds
 *
 * Sends state-transition cards only:
 *   FAILURE (new)          → 🔴 New Failure
 *   FAILURE (still)        → 🟠 Re-run Still Failing
 *   ABORTED                → ⚫ Aborted
 *   SUCCESS after fail     → 🟢 Recovered
 *   SUCCESS after success  → (no card)
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../restart-monitor/_notify.php';

const BMN_CONFIG_FILE  = 'batch-monitor-noti-config.json';
const BMN_STATE_FILE   = 'batch-monitor-noti-state.json';
const BMN_LOG_FILE     = 'batch-monitor-noti-log.json';
const BMN_TICK_LOCK    = 'batch-monitor-noti-tick.lock';
const BMN_THROTTLE_SEC = 25;
const BMN_LOG_MAX      = 500;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
$payload = requireAuth();

// Hard-cap our own runtime slightly under PHP's default 60s so we finish the
// state/log writes gracefully instead of a fatal mid-curl. The BMN_TIME_BUDGET
// guard inside the server loop bails at 40s so the tail still has ~5s to write
// state.json + log.json before the timeout hits.
@set_time_limit(50);
const BMN_TIME_BUDGET_SEC = 40;
$tickStartedAt = microtime(true);

// ── Multi-team guard ───────────────────────────────────────────────
// Reject ticks without a team context. The root-level `data/batch-monitor-noti-*.json`
// files are legacy from before the multi-team migration; their webhooks now duplicate
// the per-team ones. A stale JWT issued before that migration (still valid via 30-day
// remember-me) lands here as `_current_team=null` and would re-post every card that
// the SM tick already sent. Log-and-skip so those old tabs stop spamming Chat without
// throwing a 4xx that would surface as a red toast in the user's browser.
if (empty($GLOBALS['_current_team'])) {
    respondOk([
        'throttled' => false,
        'checked'   => 0,
        'sent'      => 0,
        'skipped'   => 'no team context in JWT (pre-migration token?)',
    ]);
}

// ── 1. Global mutex + throttle ─────────────────────────────────────
// Hold an exclusive flock for the entire tick so 2 concurrent browsers
// (or a manual DevTools call racing the auto-poll) can't both do the work
// and both send the same card. The 25s timestamp check runs UNDER the lock.
$lockPath = DATA_DIR . BMN_TICK_LOCK;
$lockFp   = @fopen($lockPath, 'c+');
if (!$lockFp) respondError('Cannot open tick lock', 500);

// Non-blocking exclusive lock. If another tick is running RIGHT NOW,
// return throttled immediately instead of stacking up requests.
if (!flock($lockFp, LOCK_EX | LOCK_NB)) {
    fclose($lockFp);
    respondOk([
        'throttled' => true,
        'reason'    => 'another tick in progress',
    ]);
}

// Under the lock: timestamp-based throttle
rewind($lockFp);
$lastRun = stream_get_contents($lockFp);
if ($lastRun !== false && $lastRun !== '' && (time() - (int)$lastRun) < BMN_THROTTLE_SEC) {
    $skipBy = (int)$lastRun;
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    respondOk([
        'throttled' => true,
        'reason'    => 'last tick <' . BMN_THROTTLE_SEC . 's ago',
        'skipBy'    => $skipBy,
    ]);
}

// Write new timestamp; keep the lock held for the rest of the request
ftruncate($lockFp, 0);
rewind($lockFp);
fwrite($lockFp, (string)time());
// Note: flock is released automatically when $lockFp is closed or the
// script terminates. No explicit unlock needed at the bottom.

// ── 2. Load config + Jenkins creds ─────────────────────────────────
$config        = readJson(BMN_CONFIG_FILE);
$serversConfig = $config['servers'] ?? [];
if (!$serversConfig) {
    respondOk(['throttled' => false, 'checked' => 0, 'sent' => 0, 'note' => 'no servers configured']);
}
$jenkinsServers = require __DIR__ . '/../jenkins_config.php';

// ── 3. Load state + log + batch-meta (for enriched cards) ─────────
$state       = readJson(BMN_STATE_FILE);
$log         = readJson(BMN_LOG_FILE);
$metaFile    = readJson('batch_meta.json');
$metaEntries = $metaFile['entries'] ?? [];

$checked = 0; $sent = 0; $skipped = 0; $pruned = 0;
$errors  = [];

// ── 4. Iterate configured servers ──────────────────────────────────
$deferred = [];
foreach ($serversConfig as $serverId => $srvCfg) {
    // Time budget: if we've already spent most of the request window (e.g. a
    // previous server sat on a slow Jenkins response), bail and let the next
    // 30s tick pick these up. Better than a fatal at line 580 mid-curl.
    if ((microtime(true) - $tickStartedAt) > BMN_TIME_BUDGET_SEC) {
        $deferred[] = $serverId;
        continue;
    }

    if (empty($srvCfg['enabled']))     continue;
    if (empty($srvCfg['webhook_url'])) continue;
    if (!isset($jenkinsServers[$serverId])) {
        $errors[] = "{$serverId}: not in jenkins_config (disabled or removed)";
        continue;
    }

    $srv         = $jenkinsServers[$serverId];
    $serverDisp  = $srv['display'] ?? $serverId;
    $webhookUrl  = $srvCfg['webhook_url'];
    $jobRules    = $srv['job_rules'] ?? [];

    // Circuit breaker: if this Jenkins host just failed within the last
    // HOST_COOLDOWN_TTL, skip the fetch entirely. Prevents the fan-out of
    // browser tabs from each burning 3s DNS timeout every 30s.
    $srvHost = hostFromUrl($srv['base_url'] ?? '');
    if ($cd = hostCooldownActive($srvHost)) {
        $errors[] = "{$serverId}: in cooldown ({$cd['reason']})";
        continue;
    }

    // Tree: pull actions[causes,parameters] since Jenkins puts them inside the
    // CauseAction / ParametersAction wrappers, not directly on the build node.
    // `builds[duration,result]{0,10}` gives us the last 10 build durations per job
    // in the same call — the runaway detector computes its own SUCCESS-only median
    // from these so a recent 16-hr hang or a batch of failures can't skew the baseline
    // the way Jenkins' built-in `estimatedDuration` would. `estimatedDuration` is kept
    // as a fallback for jobs without enough SUCCESS history yet.
    $tree = 'jobs[name,color,url,estimatedDuration,'
          . 'builds[number,duration,result]{0,10},'
          . 'lastBuild[number,result,timestamp,duration,url,'
          . 'actions[causes[shortDescription,userId,userName],parameters[name,value]]],'
          . 'jobs[name,color,url,estimatedDuration,'
          . 'builds[number,duration,result]{0,10},'
          . 'lastBuild[number,result,timestamp,duration,url,'
          . 'actions[causes[shortDescription,userId,userName],parameters[name,value]]]]]';

    $url = rtrim($srv['base_url'], '/') . '/api/json?tree=' . urlencode($tree);
    [$body, $httpCode, $curlErr] = bmn_jenkinsRequest($srv, $url);
    if ($curlErr || $httpCode !== 200) {
        $errors[] = "{$serverId}: HTTP {$httpCode} " . ($curlErr ?: '');
        continue;
    }
    $data = json_decode($body, true);
    if (!is_array($data)) { $errors[] = "{$serverId}: invalid JSON"; continue; }

    // Flatten top + one folder deep (mirror FLAT_TREE in batch-monitor.html)
    $allJobs = bmn_flattenJobs($data['jobs'] ?? [], '');

    // Track which stateKeys we observed on this successful scan.
    // After the loop we prune any state entries for this server we did NOT see
    // (job renamed / deleted in Jenkins), so state.json can't grow forever.
    $observedKeys = [];

    foreach ($allJobs as $job) {
        $checked++;

        $jobName = $job['name'] ?? '?';
        $jobPath = $job['_path'] ?? '/job/' . $jobName;
        $color   = $job['color'] ?? '';

        // Filter by job_rules[type=ignore]
        if (bmn_jobIgnored($jobName, $jobRules)) continue;

        $lastBuild = $job['lastBuild'] ?? null;
        if (!$lastBuild) continue;

        $result    = $lastBuild['result']  ?? null;
        $buildNum  = (int)($lastBuild['number'] ?? 0);
        $isRunning = str_ends_with($color, '_anime') || $result === null;

        if (!$buildNum) continue; // job never built

        $stateKey   = $serverId . '__' . $jobPath;
        $observedKeys[$stateKey] = true;             // seen in this scan → don't prune
        $prev       = $state[$stateKey] ?? null;
        $prevResult = $prev['result']      ?? null;   // last COMPLETED result
        $prevBuild  = $prev['buildNumber'] ?? null;   // last COMPLETED build#

        // Lookup batch-meta once so we can pass it to the card
        $meta = bmn_findJobMeta($jobName, $metaEntries);

        // ═══ CASE A: build is currently running ═══
        if ($isRunning) {
            $tsMs         = (int)($lastBuild['timestamp'] ?? 0);
            $runningForMs = $tsMs > 0 ? (int)(microtime(true) * 1000) - $tsMs : 0;

            // Baseline: median of last 5 SUCCESS builds (own compute) so a recent
            // hang or a run of failures doesn't inflate the threshold. Falls back
            // to Jenkins' estimatedDuration if the job doesn't have 3+ SUCCESS
            // builds yet. Returns [ms, source, sampleCount] for the card.
            [$baselineMs, $baselineSource, $sampleCount] =
                bmn_computeBaseline($job['builds'] ?? [], (int)($job['estimatedDuration'] ?? 0));

            $isFirstSeen  = ((int)($prev['runningBuild'] ?? 0) !== $buildNum);

            // ── First tick that sees this running build ──────────────────
            if ($isFirstSeen) {
                // Track the new running build; reset slow-level counters.
                // slowBuildNumber is also cleared here — if the previous
                // running build never entered CASE B (orphaned by a rename,
                // delete, or history rewrite) we don't want its stale flag
                // to trigger a follow-up against the NEW build.
                $state[$stateKey] = array_merge($prev ?? [], [
                    'runningBuild'       => $buildNum,
                    'runningAnnouncedAt' => date('c'),
                    'runningSlowLevel'   => 0,
                    'runningLastSlowAt'  => null,
                    'slowBuildNumber'    => null,
                    'updatedAt'          => date('c'),
                ]);

                // Send re-run card if the previous completed build was a failure.
                $isFailPrev = in_array($prevResult, ['FAILURE', 'UNSTABLE'], true);
                if ($prev && $isFailPrev) {
                    $transition = 'rerun_started';
                    $dedupKey = $serverId . '__'
                              . preg_replace('/[^A-Za-z0-9]/', '_', $jobPath) . '__'
                              . $buildNum . '__RUNNING';
                    $existing = $log[$dedupKey]['status'] ?? '';
                    if ($existing !== 'sent' && $existing !== 'pending') {
                        $log[$dedupKey] = [
                            'sent_at'    => date('c'),
                            'status'     => 'pending',
                            'server'     => $serverId,
                            'job'        => $jobName,
                            'buildNumber'=> $buildNum,
                            'transition' => $transition,
                        ];
                        writeJson(BMN_LOG_FILE, $log);

                        $card      = bmn_buildCard($serverDisp, $srv['base_url'], $job, $transition, $meta);
                        $threadKey = bmn_threadKey($serverId, $jobName, $prev['incidentId'] ?? $buildNum);
                        $res = postToChatThread($webhookUrl, $card, $threadKey);

                        if ($res['sent'] ?? false) {
                            $log[$dedupKey]['status']   = 'sent';
                            $log[$dedupKey]['httpCode'] = $res['httpCode'] ?? 200;
                            $sent++;
                            logActivity('batch_monitor_noti_sent', [
                                'server'      => $serverId,
                                'job'         => $jobName,
                                'transition'  => $transition,
                                'buildNumber' => $buildNum,
                                'result'      => 'RUNNING',
                            ], $payload['sub'], $payload['name'] ?? '');
                        } else {
                            $log[$dedupKey]['status'] = 'failed';
                            $log[$dedupKey]['reason'] = $res['reason'] ?? 'unknown';
                            $errors[] = "{$serverId}:{$jobName}: " . ($res['reason'] ?? 'send failed');
                        }
                    } else {
                        $skipped++;
                    }
                } else {
                    $skipped++;
                }
            }

            // ── Runaway detection (runs on EVERY tick while build is running) ──
            // Compares elapsed time vs Jenkins' own moving-average estimate. When
            // the build stays well past its historical baseline we fire an escalation
            // card so ops sees it long before the eventual FAIL — that's the fix for
            // the "16 hr silent hang" scenario. Cast to fresh $state[$stateKey] here
            // since the first-seen block above may have just seeded it.
            $stConfig      = $config['runaway'] ?? [];
            $slowMultL1    = (int)($stConfig['multiplier_l1'] ?? 3);
            $slowMultL2    = (int)($stConfig['multiplier_l2'] ?? 10);
            $slowFloorMs   = (int)($stConfig['floor_sec']     ?? 300) * 1000;   // 5 min default
            $slowRepeatHrs = (int)($stConfig['repeat_hours']  ?? 2);            // resend L2 every 2 hr

            $thresholdL1 = max($baselineMs * $slowMultL1, $slowFloorMs);
            $thresholdL2 = max($baselineMs * $slowMultL2, $slowFloorMs * 2);
            $currentLevel = $runningForMs >= $thresholdL2 ? 2
                          : ($runningForMs >= $thresholdL1 ? 1 : 0);

            if ($currentLevel > 0 && $tsMs > 0) {
                $stEntry    = $state[$stateKey] ?? [];
                $prevLevel  = (int)($stEntry['runningSlowLevel']  ?? 0);
                $prevSlowAt = $stEntry['runningLastSlowAt']       ?? null;

                // Escalate whenever we cross into a higher level, and re-nag every
                // $slowRepeatHrs while stuck at L2 (so a 16-hr hang gets 8 pings, not 1).
                $shouldSend = ($currentLevel > $prevLevel);
                if (!$shouldSend && $currentLevel >= 2 && $prevSlowAt) {
                    $sinceSlowSec = time() - strtotime($prevSlowAt);
                    if ($sinceSlowSec >= $slowRepeatHrs * 3600) $shouldSend = true;
                }

                if ($shouldSend) {
                    $transition = 'long_running_l' . $currentLevel;
                    // Bucket keeps L2 re-nag dedup keys unique per repeat window.
                    $repeatBucket = $currentLevel >= 2 ? (int)floor(time() / ($slowRepeatHrs * 3600)) : 0;
                    $dedupKey = $serverId . '__'
                              . preg_replace('/[^A-Za-z0-9]/', '_', $jobPath) . '__'
                              . $buildNum . '__SLOW_L' . $currentLevel . '_' . $repeatBucket;
                    $existing = $log[$dedupKey]['status'] ?? '';
                    if ($existing !== 'sent' && $existing !== 'pending') {
                        $log[$dedupKey] = [
                            'sent_at'    => date('c'),
                            'status'     => 'pending',
                            'server'     => $serverId,
                            'job'        => $jobName,
                            'buildNumber'=> $buildNum,
                            'transition' => $transition,
                            'level'      => $currentLevel,
                        ];
                        writeJson(BMN_LOG_FILE, $log);

                        $extra = [
                            'runningForMs'   => $runningForMs,
                            'estimatedMs'    => $baselineMs,
                            'baselineSource' => $baselineSource,   // 'median-5' | 'jenkins-avg' | 'none'
                            'sampleCount'    => $sampleCount,
                            'level'          => $currentLevel,
                            'multiplierL1'   => $slowMultL1,
                            'multiplierL2'   => $slowMultL2,
                        ];
                        $card = bmn_buildCard($serverDisp, $srv['base_url'], $job, $transition, $meta, $extra);
                        // Thread on the build number so subsequent L2 re-nags AND the
                        // eventual FAIL card land in the same Google Chat thread.
                        $threadKey = bmn_threadKey($serverId, $jobName, $buildNum);
                        $res = postToChatThread($webhookUrl, $card, $threadKey);

                        if ($res['sent'] ?? false) {
                            $log[$dedupKey]['status']   = 'sent';
                            $log[$dedupKey]['httpCode'] = $res['httpCode'] ?? 200;
                            $state[$stateKey]['runningSlowLevel']  = $currentLevel;
                            $state[$stateKey]['runningLastSlowAt'] = date('c');
                            // Remember this build was flagged as slow so CASE B can
                            // post a "resolved" follow-up in the same Chat thread.
                            $state[$stateKey]['slowBuildNumber']   = $buildNum;
                            $sent++;
                            logActivity('batch_monitor_noti_sent', [
                                'server'         => $serverId,
                                'job'            => $jobName,
                                'transition'     => $transition,
                                'buildNumber'    => $buildNum,
                                'result'         => 'RUNNING',
                                'slow_level'     => $currentLevel,
                                'running_for'    => $runningForMs,
                                'baseline_ms'    => $baselineMs,
                                'baseline_from'  => $baselineSource,
                                'baseline_n'     => $sampleCount,
                            ], $payload['sub'], $payload['name'] ?? '');
                        } else {
                            $log[$dedupKey]['status'] = 'failed';
                            $log[$dedupKey]['reason'] = $res['reason'] ?? 'unknown';
                            $errors[] = "{$serverId}:{$jobName}: " . ($res['reason'] ?? 'send failed');
                        }
                    } else {
                        $skipped++;
                    }
                }
            }

            continue;
        }

        // ═══ CASE B: build is completed (result != null) ═══
        // No change since last completion → nothing to do
        if ($prevBuild === $buildNum && $prevResult === $result) continue;

        // Did we previously post a 🐢/🚨 slow alert for THIS build? If so, we'll
        // also post a "resolved" follow-up into the slow-alert thread after the
        // normal transition card is handled — captured here because the state
        // rewrites below drop the flag.
        $flaggedSlow = ((int)($prev['slowBuildNumber'] ?? 0)) === $buildNum;

        // Classify transition (returns null when nothing worth notifying)
        $transition = bmn_classifyTransition($prevResult, $result);

        // No card → record completion and close any open incident.
        // We DON'T `continue` here when the build was slow-flagged: the
        // follow-up block below still needs to fire (e.g. SUCCESS→SUCCESS
        // is otherwise silent, but the slow thread still deserves closure).
        if (!$transition) {
            $state[$stateKey] = [
                'result'      => $result,
                'buildNumber' => $buildNum,
                'incidentId'  => null,
                'updatedAt'   => date('c'),
            ];
            $skipped++;
        } else {
            // ── Incident scope for Chat threading ────────────────────────────
            // A "new_fail" opens a fresh incident (id = the build that broke).
            // Re-runs / aborts of the same episode keep that opener's id, so
            // their cards reply under the original failure. A "recovered" card
            // uses the open incident id, then CLOSES it (incidentId=null) — so the
            // NEXT failure starts a brand-new Chat thread instead of piling onto
            // the old, already-resolved one. (This is the fix for stale threads.)
            $prevIncident = $prev['incidentId'] ?? null;
            $incidentId   = ($transition === 'new_fail')
                ? $buildNum
                : ($prevIncident ?: $buildNum);   // rerun_fail / aborted / recovered

            // Update state: record completion, clear runningBuild, track incident.
            $state[$stateKey] = [
                'result'      => $result,
                'buildNumber' => $buildNum,
                'incidentId'  => ($transition === 'recovered') ? null : $incidentId,
                'updatedAt'   => date('c'),
            ];

            // Per-build dedup
            $dedupKey = $serverId . '__'
                      . preg_replace('/[^A-Za-z0-9]/', '_', $jobPath) . '__'
                      . $buildNum . '__' . $result;
            // Skip if we've already reserved the slot ('pending') or sent it
            $existing = $log[$dedupKey]['status'] ?? '';
            if ($existing === 'sent' || $existing === 'pending') {
                $skipped++;
                // Even if the normal card is a duplicate we should still try
                // the slow follow-up (its dedup key is separate).
            } else {
                // Reserve slot (status=pending) — prevents parallel duplicate sends
                $log[$dedupKey] = [
                    'sent_at'    => date('c'),
                    'status'     => 'pending',
                    'server'     => $serverId,
                    'job'        => $jobName,
                    'buildNumber'=> $buildNum,
                    'transition' => $transition,
                ];
                writeJson(BMN_LOG_FILE, $log);

                // Build + send card (scoped to this failure's incident thread)
                $card      = bmn_buildCard($serverDisp, $srv['base_url'], $job, $transition, $meta);
                $threadKey = bmn_threadKey($serverId, $jobName, $incidentId);
                $res = postToChatThread($webhookUrl, $card, $threadKey);

                if ($res['sent'] ?? false) {
                    $log[$dedupKey]['status']   = 'sent';
                    $log[$dedupKey]['httpCode'] = $res['httpCode'] ?? 200;
                    $sent++;
                    logActivity('batch_monitor_noti_sent', [
                        'server'      => $serverId,
                        'job'         => $jobName,
                        'transition'  => $transition,
                        'buildNumber' => $buildNum,
                        'result'      => $result,
                    ], $payload['sub'], $payload['name'] ?? '');
                } else {
                    $log[$dedupKey]['status'] = 'failed';
                    $log[$dedupKey]['reason'] = $res['reason'] ?? 'unknown';
                    $errors[] = "{$serverId}:{$jobName}: " . ($res['reason'] ?? 'send failed');
                }
            }
        }

        // ── Slow-alert follow-up ────────────────────────────────────────
        // Posts a compact "resolved" card into the slow-alert thread (same
        // threadKey CASE A used: bmn_threadKey($serverId, $jobName, $buildNum)),
        // giving the 🐢/🚨 thread closure. Only fires for builds we actually
        // flagged as slow — regular fast builds are untouched.
        if ($flaggedSlow) {
            $followTransition = match ($result) {
                'SUCCESS' => 'slow_resolved_success',
                'ABORTED' => 'slow_resolved_aborted',
                default   => 'slow_resolved_failure',   // FAILURE + UNSTABLE
            };
            $followDedup = $serverId . '__'
                         . preg_replace('/[^A-Za-z0-9]/', '_', $jobPath) . '__'
                         . $buildNum . '__SLOW_RESOLVED_' . $result;
            $existingF = $log[$followDedup]['status'] ?? '';
            if ($existingF === 'sent' || $existingF === 'pending') {
                $skipped++;
            } else {
                $log[$followDedup] = [
                    'sent_at'    => date('c'),
                    'status'     => 'pending',
                    'server'     => $serverId,
                    'job'        => $jobName,
                    'buildNumber'=> $buildNum,
                    'transition' => $followTransition,
                ];
                writeJson(BMN_LOG_FILE, $log);

                // Build the compact card. We reuse `runningForMs`+baseline
                // fields so the shared card renderer can show elapsed vs
                // baseline without a bespoke code path.
                $lbF   = $job['lastBuild'] ?? [];
                $durMs = (int)($lbF['duration'] ?? 0);
                [$baselineMsF, $baselineSourceF, $sampleCountF] =
                    bmn_computeBaseline($job['builds'] ?? [], (int)($job['estimatedDuration'] ?? 0));
                $followExtra = [
                    'runningForMs'   => $durMs,
                    'estimatedMs'    => $baselineMsF,
                    'baselineSource' => $baselineSourceF,
                    'sampleCount'    => $sampleCountF,
                ];
                $followCard   = bmn_buildCard($serverDisp, $srv['base_url'], $job, $followTransition, $meta, $followExtra);
                $followThread = bmn_threadKey($serverId, $jobName, $buildNum);
                $followRes    = postToChatThread($webhookUrl, $followCard, $followThread);

                if ($followRes['sent'] ?? false) {
                    $log[$followDedup]['status']   = 'sent';
                    $log[$followDedup]['httpCode'] = $followRes['httpCode'] ?? 200;
                    $sent++;
                    logActivity('batch_monitor_noti_sent', [
                        'server'      => $serverId,
                        'job'         => $jobName,
                        'transition'  => $followTransition,
                        'buildNumber' => $buildNum,
                        'result'      => $result,
                    ], $payload['sub'], $payload['name'] ?? '');
                } else {
                    $log[$followDedup]['status'] = 'failed';
                    $log[$followDedup]['reason'] = $followRes['reason'] ?? 'unknown';
                    $errors[] = "{$serverId}:{$jobName} (slow follow-up): " . ($followRes['reason'] ?? 'send failed');
                }
            }
        }
    }

    // ── Auto-prune: drop state entries for jobs no longer in this server's Jenkins ──
    // Only runs if we made it here → Jenkins fetch succeeded and job list was parsed.
    // A temporary Jenkins outage `continue`s above, so state stays intact.
    $prefix = $serverId . '__';
    foreach ($state as $key => $_) {
        if (!str_starts_with($key, $prefix)) continue;
        if (isset($observedKeys[$key])) continue;
        unset($state[$key]);
        $pruned++;
    }
}

// Prune log to last N entries (oldest first order preserved)
if (count($log) > BMN_LOG_MAX) {
    $log = array_slice($log, -BMN_LOG_MAX, null, true);
}

writeJson(BMN_STATE_FILE, $state);
writeJson(BMN_LOG_FILE,   $log);

respondOk([
    'throttled' => false,
    'checked'   => $checked,
    'sent'      => $sent,
    'skipped'   => $skipped,
    'pruned'    => $pruned,
    'deferred'  => $deferred, // servers punted to next tick when time budget ran out
    'elapsedMs' => (int)((microtime(true) - $tickStartedAt) * 1000),
    'sizes'     => [
        'stateEntries' => count($state),
        'logEntries'   => count($log),
        'stateBytes'   => @filesize(DATA_DIR . BMN_STATE_FILE) ?: 0,
        'logBytes'     => @filesize(DATA_DIR . BMN_LOG_FILE)   ?: 0,
    ],
    'errors'    => $errors,
]);

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

// Port of jenkinsRequest() from api/jenkins-proxy/index.php:9
function bmn_jenkinsRequest(array $server, string $url): array {
    $auth = $server['auth'] ?? [];
    $ch   = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 BatchMonitorNoti',
    ]);
    $headers = ['Accept: application/json'];
    if (($auth['mode'] ?? '') === 'token' && !empty($auth['token'])) {
        $headers[] = 'Authorization: Basic '
                   . base64_encode(($auth['user'] ?? '') . ':' . $auth['token']);
    } elseif (($auth['mode'] ?? '') === 'cookie' && !empty($auth['cookie'])) {
        curl_setopt($ch, CURLOPT_COOKIE, $auth['cookie']);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    applyDnsOverrides($ch, $url);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($err || $code < 200 || $code >= 300) {
        // Mark the host cooldown so subsequent ticks (and any browser calls
        // through jenkins-proxy in the same 30s window) short-circuit fast.
        if ($err !== '' || $code === 0 || $code >= 500) {
            hostCooldownMark(hostFromUrl($url), $err !== '' ? $err : "HTTP {$code}");
        }
        logIntegrationError('jenkins', $url, $err ?: "HTTP {$code}", [
            'http_code'  => $code,
            'server_id'  => $server['id'] ?? '?',
            'source'     => 'batch-monitor-noti-cron',
        ]);
    }
    return [$body, $code, $err];
}

// Flatten top-level + one folder level (matches batch-monitor.html FLAT_TREE behavior)
function bmn_flattenJobs(array $jobs, string $parentPath): array {
    $out = [];
    foreach ($jobs as $j) {
        $name = $j['name'] ?? '';
        if ($name === '') continue;
        $path = $parentPath . '/job/' . rawurlencode($name);
        // Folder job has nested `jobs[]` — recurse
        if (isset($j['jobs']) && is_array($j['jobs'])) {
            $out = array_merge($out, bmn_flattenJobs($j['jobs'], $path));
            continue;
        }
        $j['_path'] = $path;
        $out[] = $j;
    }
    return $out;
}

// Google Chat threadKey scoped to a single failure *incident*.
// Same job, different incident → different thread. `$incidentId` is the build
// number that opened the current failure episode (see CASE B in the main loop).
function bmn_threadKey(string $serverId, string $jobName, $incidentId): string {
    return 'batch-monitor-' . $serverId . '-'
         . preg_replace('/\W+/', '-', strtolower($jobName))
         . '-i' . $incidentId;
}

// Check job_rules for an ignore rule that matches this job name
function bmn_jobIgnored(string $name, array $rules): bool {
    $n = strtolower($name);
    foreach ($rules as $r) {
        if (($r['type'] ?? '') !== 'ignore') continue;
        $p = trim($r['pattern'] ?? '');
        if ($p === '') continue;
        $p = strtolower($p);
        $match = $r['match'] ?? 'exact';
        if ($match === 'contains' && str_contains($n, $p)) return true;
        if ($match === 'exact'    && $n === $p)            return true;
    }
    return false;
}

/**
 * Classify state transition. Returns:
 *   'new_fail'   — was passing → now FAILURE/UNSTABLE
 *   'rerun_fail' — was failing → new build still FAILURE/UNSTABLE
 *   'aborted'    — was known → new build ABORTED
 *   'recovered'  — was FAILURE/UNSTABLE/ABORTED → now SUCCESS
 *   null         — no card (normal SUCCESS after SUCCESS, or first-ever seed)
 *
 * First-time seed (prev === null) never notifies. This avoids a burst of
 * "existing failures" the moment an admin turns notifications on.
 */
function bmn_classifyTransition(?string $prev, string $curr): ?string {
    if ($prev === null) return null;

    $isFail = fn($r) => in_array($r, ['FAILURE', 'UNSTABLE'], true);
    if ($curr === 'ABORTED') return 'aborted';
    if ($curr === 'SUCCESS') {
        if ($isFail($prev) || $prev === 'ABORTED') return 'recovered';
        return null;                                                 // SUCCESS → SUCCESS
    }
    if ($isFail($curr)) {
        if ($isFail($prev) || $prev === 'ABORTED') return 'rerun_fail';
        return 'new_fail';
    }
    return null;
}

// ─── Card builder ────────────────────────────────────────────────────
function bmn_buildCard(
    string $serverDisp,
    string $baseUrl,
    array  $job,
    string $transition,
    ?array $meta  = null,
    ?array $extra = null                       // long_running metrics, etc.
): array {
    $jobName   = $job['name'] ?? '?';
    $jobUrl    = $job['url']  ?? '';
    $jobPath   = $job['_path'] ?? '';
    $lb        = $job['lastBuild'] ?? [];
    $result    = $lb['result']   ?? null;
    $buildNum  = (int)($lb['number'] ?? 0);
    $buildUrl  = $lb['url']      ?? '';
    $tsMs      = (int)($lb['timestamp'] ?? 0);
    $durMs     = (int)($lb['duration']  ?? 0);
    $isLongRun       = str_starts_with($transition, 'long_running');
    $isSlowResolved  = str_starts_with($transition, 'slow_resolved_');
    $isRunning       = ($transition === 'rerun_started') || $isLongRun || $result === null;

    // Folder: /job/<folder>/job/<name> → "<folder>"
    $folder = '';
    if (preg_match('#^/job/([^/]+)/job/#', $jobPath, $m)) {
        $folder = urldecode($m[1]);
    }

    // Parse causes + parameters from actions[]
    // Jenkins nests them inside CauseAction / ParametersAction wrappers
    $startedBy = '';
    $params    = [];
    foreach ($lb['actions'] ?? [] as $a) {
        foreach ($a['causes'] ?? [] as $c) {
            if ($startedBy === '' && !empty($c['shortDescription'])) {
                $startedBy = $c['shortDescription'];
            }
        }
        foreach ($a['parameters'] ?? [] as $p) {
            if (isset($p['name'])) $params[$p['name']] = (string)($p['value'] ?? '');
        }
    }

    // Decorate common "Timer" trigger with a clock emoji so it stands out
    $startedByFmt = $startedBy;
    if ($startedByFmt !== '' && stripos($startedByFmt, 'timer') !== false) {
        $startedByFmt = '⏰ ' . $startedByFmt;
    } elseif ($startedByFmt !== '' && stripos($startedByFmt, 'user') !== false) {
        $startedByFmt = '👤 ' . $startedByFmt;
    } elseif ($startedByFmt !== '') {
        $startedByFmt = '↪ ' . $startedByFmt;
    }

    // Well-known params commonly used in Ascend batch jobs
    $processType = $params['PROCESS_TYPE'] ?? $params['PROCESS'] ?? '';
    $asOfDate    = $params['AS_OF_DATE']   ?? $params['AS_OF']   ?? $params['DATE'] ?? '';
    $environment = $params['ENV']          ?? $params['ENVIRONMENT'] ?? '';

    $startTime  = $tsMs ? date('Y-m-d H:i:s O', (int)($tsMs / 1000)) : '';
    $finishTime = ($tsMs && $durMs && !$isRunning) ? date('Y-m-d H:i:s O', (int)(($tsMs + $durMs) / 1000)) : '';
    $elapsed    = bmn_fmtElapsed($durMs);

    $header = bmn_transitionHeader($transition);

    // ── Information section ─────────────────────────────────
    $infoWidgets = [];
    if ($processType !== '') $infoWidgets[] = bmn_kvWidget('content_copy', 'Process Type', htmlspecialchars($processType, ENT_QUOTES));
    if ($asOfDate    !== '') $infoWidgets[] = bmn_kvWidget('schedule',     'As Of Date',   htmlspecialchars($asOfDate, ENT_QUOTES));
    if ($environment !== '') $infoWidgets[] = bmn_kvWidget('factory',      'Environment',
                                              '<b><font color="#2563eb">' . htmlspecialchars($environment, ENT_QUOTES) . '</font></b>');
    if ($startedByFmt !== '') $infoWidgets[] = bmn_kvWidget('person',      'Started By',   htmlspecialchars($startedByFmt, ENT_QUOTES));
    if ($startTime   !== '') $infoWidgets[] = bmn_kvWidget('play_arrow',   'Start Time',   $startTime);
    if (!$infoWidgets) {
        $infoWidgets[] = bmn_kvWidget('info', 'Build', "#{$buildNum}");
    }

    // ── Job Info section (from batch_meta.json + Jenkins folder) ──
    $metaWidgets = [];
    $category   = $meta['category']   ?? '';
    $devOwner   = $meta['dev_owner']  ?? '';
    $smRerun    = $meta['sm_rerun']   ?? '';
    $manualUrl  = $meta['manual_url'] ?? '';
    if ($category !== '')  $metaWidgets[] = bmn_kvWidget('sell',    'Category',  htmlspecialchars($category, ENT_QUOTES));
    if ($devOwner !== '')  $metaWidgets[] = bmn_kvWidget('face',    'Dev Owner', htmlspecialchars($devOwner, ENT_QUOTES));
    if ($smRerun  !== '')  $metaWidgets[] = bmn_kvWidget('sync',    'SM Rerun',  bmn_smRerunHtml($smRerun));
    if ($folder   !== '')  $metaWidgets[] = bmn_kvWidget('folder',  'Folder',    htmlspecialchars($folder, ENT_QUOTES));

    // ── Result section ─────────────────────────────────
    $resultWidgets = [
        bmn_kvWidget('content_copy', 'Process Name', htmlspecialchars($jobName, ENT_QUOTES)),
    ];
    if ($isLongRun) {
        // Runaway build: swap the plain "RUNNING…" line for baseline comparison so
        // the reader immediately sees how far past normal we are.
        $runningForMs   = (int)($extra['runningForMs']   ?? 0);
        $baselineMs     = (int)($extra['estimatedMs']    ?? 0);
        $baselineSource = (string)($extra['baselineSource'] ?? '');
        $sampleCount    = (int)($extra['sampleCount']    ?? 0);
        $level          = (int)($extra['level']          ?? 1);

        $resultWidgets[] = bmn_kvWidget('timer', 'Running For',
            '<b>' . bmn_fmtElapsed($runningForMs) . '</b>');
        if ($baselineMs > 0) {
            $multiple = round($runningForMs / max($baselineMs, 1), 1);
            // Show how the baseline was derived so the reader trusts the number:
            //   median-5 → "จาก 5 SUCCESS builds ล่าสุด" (self-computed, robust)
            //   jenkins-avg → "Jenkins avg" (fallback for jobs with < 3 SUCCESS)
            $srcLabel = str_starts_with($baselineSource, 'median-')
                ? "จาก {$sampleCount} SUCCESS builds ล่าสุด (median)"
                : 'Jenkins avg (baseline ยังไม่พอ)';
            $resultWidgets[] = bmn_kvWidget('speed', 'ปกติใช้เวลา',
                bmn_fmtElapsed($baselineMs) . ' <font color="#6b7280">(' . $srcLabel . ')</font>');
            $resultWidgets[] = bmn_kvWidget('warning', 'เกินปกติ',
                '<b><font color="#dc2626">' . $multiple . 'x baseline</font></b>');
        } else {
            $resultWidgets[] = bmn_kvWidget('warning', 'Baseline',
                '<font color="#6b7280">ยังไม่มีข้อมูล baseline (build แรกๆ)</font>');
        }
        $statusColor = $level >= 2 ? '#dc2626' : '#d97706';
        $statusText  = $level >= 2 ? '🚨 STUCK — ควรเช็ค agent/pod'
                                   : '🐢 นานผิดปกติ — ควรตรวจสอบ';
        $resultWidgets[] = bmn_kvWidget('play_circle', 'Status',
            '<b><font color="' . $statusColor . '">' . $statusText . '</font></b>');
    } elseif ($isRunning) {
        $resultWidgets[] = bmn_kvWidget('play_circle', 'Status',
            '<b><font color="#d97706">RUNNING…</font></b>');
    } else {
        $statusColor = $result === 'SUCCESS'  ? '#16a34a'
                    : ($result === 'FAILURE'  ? '#dc2626'
                    : ($result === 'UNSTABLE' ? '#d97706'
                    : ($result === 'ABORTED'  ? '#6b7280' : '#111827')));
        if ($finishTime !== '') $resultWidgets[] = bmn_kvWidget('schedule', 'Finish Time',  $finishTime);
        if ($elapsed    !== '') $resultWidgets[] = bmn_kvWidget('timer',    'Elapsed Time', $elapsed);
        $resultWidgets[] = bmn_kvWidget('diamond', 'Status',
            '<b><font color="' . $statusColor . '">' . htmlspecialchars($result, ENT_QUOTES) . '</font></b>');

        // For a slow-alert follow-up, append the baseline comparison so the
        // reader can see how far past normal this build ran end-to-end.
        if ($isSlowResolved) {
            $baselineMs     = (int)($extra['estimatedMs']    ?? 0);
            $baselineSource = (string)($extra['baselineSource'] ?? '');
            $sampleCount    = (int)($extra['sampleCount']    ?? 0);
            if ($baselineMs > 0 && $durMs > 0) {
                $multiple = round($durMs / max($baselineMs, 1), 1);
                $srcLabel = str_starts_with($baselineSource, 'median-')
                    ? "จาก {$sampleCount} SUCCESS builds ล่าสุด (median)"
                    : 'Jenkins avg (baseline ยังไม่พอ)';
                $resultWidgets[] = bmn_kvWidget('speed', 'ปกติใช้เวลา',
                    bmn_fmtElapsed($baselineMs) . ' <font color="#6b7280">(' . $srcLabel . ')</font>');
                $resultWidgets[] = bmn_kvWidget('warning', 'ใช้จริง',
                    '<b><font color="#dc2626">' . $multiple . 'x baseline</font></b>');
            }
        }
    }

    // ── Parameter block (from batch_meta) — for repair guidance ──
    $paramNote = trim($meta['parameter'] ?? '');
    $paramWidgets = [];
    if ($paramNote !== '') {
        $paramWidgets[] = ['textParagraph' => [
            'text' => nl2br(htmlspecialchars($paramNote, ENT_QUOTES, 'UTF-8')),
        ]];
    }

    // ── Note block (from batch_meta) ──
    $noteText = trim($meta['note'] ?? '');
    $noteWidgets = [];
    if ($noteText !== '') {
        $noteWidgets[] = ['textParagraph' => [
            'text' => nl2br(htmlspecialchars($noteText, ENT_QUOTES, 'UTF-8')),
        ]];
    }

    // ── Buttons ─────────────────────────────────
    $buttons = [];
    if ($buildUrl) {
        $buttons[] = ['text' => 'Build Logs',
                      'onClick' => ['openLink' => ['url' => rtrim($buildUrl, '/') . '/consoleFull']]];
        $buttons[] = ['text' => 'Build Details',
                      'onClick' => ['openLink' => ['url' => $buildUrl]]];
    }
    if ($jobUrl) {
        $buttons[] = ['text' => 'Job Dashboard',
                      'onClick' => ['openLink' => ['url' => $jobUrl]]];
    }
    if ($manualUrl !== '' && $manualUrl !== '-') {
        $buttons[] = ['text' => '📖 Manual',
                      'onClick' => ['openLink' => ['url' => $manualUrl]]];
    }

    // ── Compact layout: long_running + slow_resolved ────────────────────
    // These cards swap job name into the card title (all normal cards use server
    // name there — they look identical in a busy Chat thread). Sections are cut
    // to 3-4 max; slow_resolved drops the detail section entirely since the
    // earlier 🐢/🚨 card already showed it.
    if ($isLongRun || $isSlowResolved) {
        $lvl      = (int)($extra['level']            ?? 1);
        $runForMs = (int)($extra['runningForMs']     ?? 0);
        $baseMs   = (int)($extra['estimatedMs']      ?? 0);
        $baseSrc  = (string)($extra['baselineSource'] ?? '');
        $baseN    = (int)($extra['sampleCount']      ?? 0);

        // Section: timing / outcome (no section header → compact)
        $tWidgets = [];
        if ($isLongRun) {
            $col = $lvl >= 2 ? '#dc2626' : '#d97706';
            $tWidgets[] = bmn_kvWidget('hourglass_top', 'Running For',
                '<b><font color="' . $col . '">' . bmn_fmtElapsed($runForMs) . '</font></b>');
            if ($baseMs > 0) {
                $mult = round($runForMs / max($baseMs, 1), 1);
                $src  = str_starts_with($baseSrc, 'median-')
                      ? "จาก {$baseN} SUCCESS ล่าสุด" : 'Jenkins avg';
                $tWidgets[] = bmn_kvWidget('speed', 'เกินปกติ',
                    '<b><font color="' . $col . '">' . $mult . 'x baseline</font></b>'
                    . ' <font color="#6b7280">· ปกติ ' . bmn_fmtElapsed($baseMs) . ' (' . $src . ')</font>');
            } else {
                $tWidgets[] = bmn_kvWidget('speed', 'Baseline',
                    '<font color="#6b7280">ยังไม่มีข้อมูล baseline (build แรกๆ)</font>');
            }
            $stText = $lvl >= 2 ? 'STUCK — ควรเช็ค agent/pod' : 'นานผิดปกติ — ควรตรวจสอบ';
            $tWidgets[] = bmn_kvWidget($lvl >= 2 ? 'warning' : 'hourglass_full', 'สถานะ',
                '<b><font color="' . $col . '">' . $stText . '</font></b>');
        } else {
            // slow_resolved: outcome + total elapsed vs baseline
            $rCol = $result === 'SUCCESS' ? '#16a34a'
                  : ($result === 'ABORTED' ? '#6b7280' : '#dc2626');
            $tWidgets[] = bmn_kvWidget('diamond', 'ผลลัพธ์',
                '<b><font color="' . $rCol . '">' . htmlspecialchars($result ?? '?', ENT_QUOTES) . '</font></b>');
            if ($durMs > 0) {
                $tWidgets[] = bmn_kvWidget('timer', 'ใช้เวลาจริง', '<b>' . bmn_fmtElapsed($durMs) . '</b>');
            }
            if ($baseMs > 0 && $durMs > 0) {
                $mult = round($durMs / max($baseMs, 1), 1);
                $src  = str_starts_with($baseSrc, 'median-')
                      ? "จาก {$baseN} SUCCESS ล่าสุด" : 'Jenkins avg';
                $tWidgets[] = bmn_kvWidget('speed', 'เทียบ Baseline',
                    '<b><font color="#dc2626">' . $mult . 'x</font></b>'
                    . ' <font color="#6b7280">· ปกติ ' . bmn_fmtElapsed($baseMs) . ' (' . $src . ')</font>');
            }
            if ($finishTime !== '') {
                $tWidgets[] = bmn_kvWidget('schedule', 'Finish Time', $finishTime);
            }
        }

        // Section: details — long_running only; slow_resolved drops this
        // (reader already saw full details in the preceding 🐢/🚨 card)
        $dWidgets = [];
        if ($isLongRun) {
            if ($startTime    !== '') $dWidgets[] = bmn_kvWidget('play_arrow',    'Start Time',   $startTime);
            if ($startedByFmt !== '') $dWidgets[] = bmn_kvWidget('person',        'Started By',   htmlspecialchars($startedByFmt, ENT_QUOTES));
            if ($processType  !== '') $dWidgets[] = bmn_kvWidget('content_copy',  'Process Type', htmlspecialchars($processType, ENT_QUOTES));
            if ($environment  !== '') $dWidgets[] = bmn_kvWidget('factory',       'Environment',
                '<b><font color="#2563eb">' . htmlspecialchars($environment, ENT_QUOTES) . '</font></b>');
            if ($smRerun      !== '') $dWidgets[] = bmn_kvWidget('sync',          'SM Rerun',     bmn_smRerunHtml($smRerun));
            if ($devOwner     !== '') $dWidgets[] = bmn_kvWidget('face',          'Dev Owner',    htmlspecialchars($devOwner, ENT_QUOTES));
        }

        $cId  = 'batch-monitor-' . preg_replace('/\W+/', '-', strtolower($jobName)) . '-' . $buildNum . '-' . $transition;
        $cSec = [
            ['widgets' => [['decoratedText' => [
                'startIcon'   => ['materialIcon' => ['name' => $header['icon']]],
                'topLabel'    => $header['label'],
                'text'        => '<b>Pipeline ' . htmlspecialchars($jobName, ENT_QUOTES) . '</b>',
                'bottomLabel' => htmlspecialchars($serverDisp, ENT_QUOTES),
                'wrapText'    => true,
            ]]]],
            ['widgets' => $tWidgets],
        ];
        if ($dWidgets)     $cSec[] = ['header' => 'Details',                    'widgets' => $dWidgets];
        if ($paramWidgets) $cSec[] = ['header' => 'Parameter (สำหรับซ่อม)',    'widgets' => $paramWidgets];
        if ($noteWidgets)  $cSec[] = ['header' => 'Note',                       'widgets' => $noteWidgets];
        if ($buttons)      $cSec[] = ['widgets' => [['buttonList' => ['buttons' => $buttons]]]];

        return [
            'cardsV2' => [[
                'cardId' => $cId,
                'card'   => [
                    'header' => [
                        'title'    => $header['emoji'] . ' ' . htmlspecialchars($jobName, ENT_QUOTES),
                        'subtitle' => $header['label'] . ' · ' . htmlspecialchars($serverDisp, ENT_QUOTES),
                    ],
                    'sections' => $cSec,
                ],
            ]],
        ];
    }

    // ── Assemble sections (normal cards: new_fail / rerun_fail / aborted / recovered / rerun_started) ──
    $sections = [
        // Banner: transition + pipeline name
        ['widgets' => [
            ['decoratedText' => [
                'startIcon'   => ['materialIcon' => ['name' => $header['icon']]],
                'topLabel'    => $header['label'],
                'text'        => '<b>Pipeline ' . htmlspecialchars($jobName, ENT_QUOTES) . '</b>',
                'bottomLabel' => htmlspecialchars($serverDisp, ENT_QUOTES),
                'wrapText'    => true,
            ]],
        ]],
        ['header' => 'Information', 'widgets' => $infoWidgets],
    ];
    if ($metaWidgets)  $sections[] = ['header' => 'Job Info',  'widgets' => $metaWidgets];
    $sections[] = ['header' => 'Result', 'widgets' => $resultWidgets];
    if ($paramWidgets) $sections[] = ['header' => 'Parameter (สำหรับซ่อม)', 'widgets' => $paramWidgets];
    if ($noteWidgets)  $sections[] = ['header' => 'Note', 'widgets' => $noteWidgets];
    if ($buttons)      $sections[] = ['widgets' => [['buttonList' => ['buttons' => $buttons]]]];

    return [
        'cardsV2' => [[
            'cardId' => 'batch-monitor-' . preg_replace('/\W+/', '-', strtolower($jobName)) . '-' . $buildNum . '-' . $transition,
            'card'   => [
                'header' => [
                    'title'    => $serverDisp,
                    'subtitle' => $header['emoji'] . ' ' . $header['label'],
                ],
                'sections' => $sections,
            ],
        ]],
    ];
}

// ─── batch_meta lookup — mirror the JS getJobMeta() in batch-monitor.html ────
function bmn_findJobMeta(string $jobName, array $entries): ?array {
    $n = strtolower($jobName);
    $matches = [];
    foreach ($entries as $e) {
        $p = strtolower(trim($e['pattern'] ?? ''));
        if ($p === '') continue;
        $match = $e['match'] ?? 'contains';
        if ($match === 'exact') {
            if ($n === $p) $matches[] = $e;
        } else {
            if (str_contains($n, $p) || (strlen($p) >= 6 && str_contains($p, $n))) {
                $matches[] = $e;
            }
        }
    }
    if (!$matches)          return null;
    if (count($matches) === 1) return $matches[0];

    // Merge multiple matches — prefer sm_rerun action values from later entries
    $isAction = fn($v) => $v && (
        stripos($v, 'sm rerun') !== false ||
        stripos($v, 'inform')   !== false ||
        strtolower(trim($v))    === 'yes'
    );
    $merged = $matches[0];
    foreach (array_slice($matches, 1) as $m) {
        if (empty($merged['dev_owner']) && !empty($m['dev_owner'])) $merged['dev_owner'] = $m['dev_owner'];
        if ((empty($merged['manual_url']) || $merged['manual_url'] === '-')
            && !empty($m['manual_url']) && $m['manual_url'] !== '-') {
            $merged['manual_url'] = $m['manual_url'];
        }
        if (!$isAction($merged['sm_rerun'] ?? '') && $isAction($m['sm_rerun'] ?? '')) {
            $merged['sm_rerun'] = $m['sm_rerun'];
        }
        foreach (['etc', 'category', 'parameter', 'note'] as $k) {
            if (empty($merged[$k]) && !empty($m[$k])) $merged[$k] = $m[$k];
        }
    }
    return $merged;
}

// SM Rerun badge — matches the semantics from batch-monitor.html:smRerunHtml()
function bmn_smRerunHtml(string $val): string {
    $v = strtolower(trim($val));
    if ($v === '' || $v === '-') return htmlspecialchars($val, ENT_QUOTES);
    if ($v === 'sm rerun' || $v === 'yes') {
        return '<b><font color="#16a34a">🟢 SM Rerun</font></b>';
    }
    if (str_contains($v, 'inform')) {
        return '<b><font color="#dc2626">🔴 ' . htmlspecialchars($val, ENT_QUOTES) . '</font></b>';
    }
    return '<font color="#6b7280">⚪ ' . htmlspecialchars($val, ENT_QUOTES) . '</font>';
}

function bmn_kvWidget(string $icon, string $label, string $text): array {
    return ['decoratedText' => [
        'startIcon' => ['materialIcon' => ['name' => $icon]],
        'topLabel'  => $label,
        'text'      => $text,
        'wrapText'  => true,
    ]];
}

function bmn_transitionHeader(string $t): array {
    return match ($t) {
        'new_fail'         => ['emoji' => '🔴', 'label' => 'New Failure',            'icon' => 'error'],
        'rerun_fail'       => ['emoji' => '🟠', 'label' => 'Re-run Still Failing',   'icon' => 'refresh'],
        'aborted'          => ['emoji' => '⚫', 'label' => 'Aborted',                 'icon' => 'block'],
        'recovered'        => ['emoji' => '🟢', 'label' => 'Recovered',               'icon' => 'check_circle'],
        'rerun_started'    => ['emoji' => '🔁', 'label' => 'Re-run Started',          'icon' => 'refresh'],
        'long_running_l1'  => ['emoji' => '🐢', 'label' => 'Long-running Pipeline',   'icon' => 'hourglass_top'],
        'long_running_l2'  => ['emoji' => '🚨', 'label' => 'Stuck Pipeline',          'icon' => 'warning'],
        // Follow-up cards posted into the slow-alert thread when a build we
        // previously flagged as 🐢/🚨 finally completes — gives the thread
        // closure so ops doesn't have to chase the outcome manually.
        'slow_resolved_success' => ['emoji' => '✅', 'label' => 'Slow Build Completed', 'icon' => 'check_circle'],
        'slow_resolved_failure' => ['emoji' => '❌', 'label' => 'Slow Build Failed',    'icon' => 'error'],
        'slow_resolved_aborted' => ['emoji' => '⚫', 'label' => 'Slow Build Aborted',   'icon' => 'block'],
        default            => ['emoji' => '⚪', 'label' => ucfirst($t),               'icon' => 'info'],
    };
}

/**
 * Compute a runaway-detection baseline for one job.
 *
 * Prefers the median of the last 5 SUCCESS build durations pulled from the
 * `builds[]` array Jenkins returned in this tick. Median (not mean) is used so
 * one anomalous slow-but-successful run doesn't drag the baseline up. FAILURE,
 * UNSTABLE, and ABORTED builds are ignored — a broken run that eventually got
 * failed at 16 hr shouldn't teach us that 16 hr is "normal".
 *
 * Falls back to Jenkins' own `estimatedDuration` when we have fewer than 3
 * SUCCESS samples (a brand new job, or one that's been failing recently).
 *
 * @param  array $builds       [{number,duration,result}, ...] most recent first
 * @param  int   $estimatedMs  Jenkins estimatedDuration in ms (fallback)
 * @return array{0:int,1:string,2:int}  [baselineMs, source, sampleCount]
 */
function bmn_computeBaseline(array $builds, int $estimatedMs): array {
    $successDurs = [];
    foreach ($builds as $b) {
        if (($b['result'] ?? '') !== 'SUCCESS') continue;
        $d = (int)($b['duration'] ?? 0);
        if ($d <= 0) continue;                  // skip running/incomplete
        $successDurs[] = $d;
        if (count($successDurs) >= 5) break;    // last 5 SUCCESS is enough
    }

    if (count($successDurs) >= 3) {
        sort($successDurs);
        $n      = count($successDurs);
        $median = ($n % 2)
            ? $successDurs[intdiv($n, 2)]
            : (int)(($successDurs[$n/2 - 1] + $successDurs[$n/2]) / 2);
        return [$median, 'median-' . $n, $n];
    }
    if ($estimatedMs > 0) {
        return [$estimatedMs, 'jenkins-avg', 0];
    }
    return [0, 'none', 0];
}

function bmn_fmtElapsed(int $ms): string {
    if ($ms <= 0) return '';
    $s = (int)round($ms / 1000);
    $h = intdiv($s, 3600);
    $m = intdiv($s % 3600, 60);
    $sec = $s % 60;
    return "{$h} hr {$m} min {$sec} sec";
}
