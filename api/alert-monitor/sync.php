<?php
// ─── Alert Monitor Sync (chunked / resumable) ─────────────────────────────────
// POST → fetch a bounded chunk of alerts from JSM Ops for the SM team, upsert
// into per-month JSON caches under data/alerts/YYYY-MM.json, then return stats.
//
// The full backfill can span thousands of alerts and JSM Ops paginates at
// 20/request, so a single HTTP call can't cover everything within a normal
// browser/proxy timeout. Instead we:
//   1) Do at most `max_pages_per_sync` (default 25 → ~500 alerts, ~30s)
//   2) Persist the current cursor to state (backfill_offset, backfill_since_ms)
//   3) Return `has_more: true` when we hit the cap so the caller can loop
//      by POSTing again — subsequent calls resume from that cursor.
//
// Query-params:
//   force=1   → ignore the min_interval debounce (LEAD_ROLES)
//   full=1    → start a fresh full backfill: reset cursor, ignore last_sync_at
//               (LEAD_ROLES)
//   continue=1→ resume an in-progress backfill (any role) — used by the UI
//               loop after receiving has_more=true
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_jsm_client.php';

// Extend the wall-clock budget past PHP's default 30s. Per-JSM-request timeout
// is still enforced inside curl in _jsm_client.php.
@set_time_limit(120);
ignore_user_abort(true);

$user = requireAuth();
apiRateLimit($user['user_id'] ?? 'anon', 'alert_monitor_sync');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respondError('Method not allowed', 405);
}

$force    = isset($_GET['force'])    && $_GET['force']    === '1';
$full     = isset($_GET['full'])     && $_GET['full']     === '1';
$continue = isset($_GET['continue']) && $_GET['continue'] === '1';
if (($force || $full) && !in_array($user['role'] ?? '', LEAD_ROLES, true)) {
    respondError('force/full sync requires lead role', 403);
}

$cfg   = alertMonitorConfig();
$state = readJson('alert-monitor-state.json') ?: [];

$minInterval = (int)($cfg['sync']['min_interval_seconds'] ?? 30);
$now         = time();
$lastSync    = (int)($state['last_sync_finished_at'] ?? 0);

// A pending backfill (has_more from previous call) always bypasses the debounce
// — otherwise progressive syncs get stuck 30s apart.
$pendingBackfill = !empty($state['backfill_in_progress']);

if (!$force && !$full && !$continue && !$pendingBackfill
    && $lastSync > 0 && ($now - $lastSync) < $minInterval) {
    respondOk([
        'skipped'      => true,
        'reason'       => 'debounced',
        'seconds_until_next' => $minInterval - ($now - $lastSync),
        'state'        => $state,
    ], 'skipped (recent sync)');
}

// Concurrency guard — another sync started less than 3 min ago is still running
if (!empty($state['in_progress']) && ($now - (int)($state['in_progress_started_at'] ?? 0)) < 180) {
    respondOk([
        'skipped' => true,
        'reason'  => 'in_progress',
        'state'   => $state,
    ], 'skipped (sync in progress)');
}

$state['in_progress'] = true;
$state['in_progress_started_at'] = $now;
writeJson('alert-monitor-state.json', $state);

$startedMs = (int)(microtime(true) * 1000);
$newCount = 0;
$updatedCount = 0;
$fetchedCount = 0;
$monthTouch = []; // month => bool
$errorMsg = null;
$hasMore  = false;
$pagesDone= 0;

try {
    $teamId          = $cfg['jsm']['team_id'] ?? '';
    $responderFilter = $cfg['jsm']['responder_filter'] ?? ($teamId ? 'responders: "'.$teamId.'"' : '');
    $pageSize        = (int)($cfg['sync']['page_size']         ?? 100);
    $maxPages        = (int)($cfg['sync']['max_pages_per_sync']?? 10);
    $historyMonths   = (int)($cfg['sync']['history_months']    ?? 12);
    // Admin override — bump the per-chunk page cap on demand (LEAD_ROLES only,
    // already checked above when force/full are set). Useful when running the
    // backfill from a local CLI where server timeouts don't apply.
    if (!empty($_GET['pages']) && ($force || $full || $continue)
        && in_array($user['role'] ?? '', LEAD_ROLES, true)) {
        $maxPages = max(1, min(200, (int)$_GET['pages']));
    }

    // ── Decide starting point ────────────────────────────────────────────────
    // full=1              → reset everything (LEAD_ROLES already checked above)
    // continue=1 + pending → resume from stored cursor
    // else (incremental)  → since last_sync_at, offset=0
    if ($full) {
        $state['backfill_since_ms']    = 0;   // 0 = respect history_months window
        $state['backfill_offset']      = 0;
        $state['backfill_in_progress'] = true;
        $state['backfill_started_at']  = time();
        $state['backfill_pages_done']  = 0;
    }

    if (!empty($state['backfill_in_progress'])) {
        // Chunked backfill mode
        $sinceMs = (int)($state['backfill_since_ms'] ?? 0);
        if ($sinceMs === 0) {
            $sinceMs = (int)((new DateTimeImmutable("-{$historyMonths} months"))->getTimestamp() * 1000);
            $state['backfill_since_ms'] = $sinceMs;
        }
        $offset = (int)($state['backfill_offset'] ?? 0);
        $mode   = 'backfill';
    } else {
        // Incremental delta sync
        $sinceMs = (int)($state['last_sync_at'] ?? 0);
        if ($sinceMs === 0) {
            $sinceMs = (int)((new DateTimeImmutable("-{$historyMonths} months"))->getTimestamp() * 1000);
        }
        $offset = 0;
        $mode   = 'delta';
    }

    $query = trim($responderFilter . ' AND updatedAt > ' . $sinceMs, ' ');
    $clientFilterTeamId = $teamId;

    // ── Buffer per-month upserts so we writeJson once per month per chunk ────
    $monthBuffers = [];

    for ($p = 0; $p < $maxPages; $p++) {
        $resp = alertMonitorFetchPage($query, $offset, $pageSize);
        $items = $resp['values'] ?? $resp['data'] ?? [];
        if (!is_array($items) || count($items) === 0) break;
        $offset += count($items);
        $pagesDone++;

        foreach ($items as $raw) {
            $alert = alertMonitorNormalize($raw);
            if ($alert['id'] === '' || $alert['created_at'] === 0) continue;
            if ($clientFilterTeamId !== '' && !in_array($clientFilterTeamId, $alert['responders'], true)) {
                continue;
            }

            $month = date('Y-m', (int)($alert['created_at'] / 1000));

            if (!isset($monthBuffers[$month])) {
                $existing = readJson("alerts/$month.json");
                $indexed  = [];
                foreach (($existing['alerts'] ?? []) as $a) {
                    if (!empty($a['id'])) $indexed[$a['id']] = $a;
                }
                $monthBuffers[$month] = $indexed;
            }

            $wasNew = !isset($monthBuffers[$month][$alert['id']]);
            $monthBuffers[$month][$alert['id']] = $alert;
            $monthTouch[$month] = true;
            if ($wasNew) $newCount++;
            else         $updatedCount++;
            $fetchedCount++;
        }

        // If a full page came back, assume there are more (JSM Ops has no total)
        // and let the outer loop continue. When it comes back shorter than
        // requested we still keep going one more page — JSM sometimes trickles.
    }

    // If we exited via the maxPages cap AND the last page was non-empty,
    // there might be more — flag has_more so the caller loops.
    if ($mode === 'backfill') {
        // If we hit the page cap and last fetch was full-sized (20 typical),
        // more work remains
        if ($pagesDone >= $maxPages) $hasMore = true;
        else                          $hasMore = false;
    }

    // ── Flush month buffers back to disk ─────────────────────────────────────
    foreach ($monthBuffers as $month => $indexed) {
        $alertsList = array_values($indexed);
        usort($alertsList, fn($a, $b) => ($b['created_at'] ?? 0) <=> ($a['created_at'] ?? 0));
        writeJson("alerts/$month.json", [
            'month'      => $month,
            'updated_at' => time(),
            'count'      => count($alertsList),
            'alerts'     => $alertsList,
        ]);
    }
} catch (Throwable $e) {
    $errorMsg = $e->getMessage();
    logSecurity('alert_monitor_sync_error', ['error' => $errorMsg], $user['sub'] ?? null, $user['name'] ?? null);
}

$finishedMs = (int)(microtime(true) * 1000);
$duration   = $finishedMs - $startedMs;

// ── Update state ─────────────────────────────────────────────────────────────
$state = readJson('alert-monitor-state.json') ?: [];
$state['in_progress'] = false;
$state['in_progress_started_at'] = 0;
$state['last_sync_finished_at'] = time();
$state['last_sync_duration_ms'] = $duration;
$state['last_error'] = $errorMsg;

if ($errorMsg === null) {
    if (isset($mode) && $mode === 'backfill') {
        $state['backfill_offset']     = $offset;
        $state['backfill_pages_done'] = (int)($state['backfill_pages_done'] ?? 0) + $pagesDone;

        if ($hasMore) {
            $state['backfill_in_progress'] = true;
        } else {
            // Backfill finished — flip cursor to delta mode
            $state['backfill_in_progress'] = false;
            $state['backfill_completed_at']= time();
            $state['last_sync_at']         = (int)(microtime(true) * 1000);
        }
    } else {
        // Delta — advance the incremental cursor
        $state['last_sync_at'] = (int)(microtime(true) * 1000);
    }

    $state['last_sync_count']   = $fetchedCount;
    $state['last_sync_new']     = $newCount;
    $state['last_sync_updated'] = $updatedCount;

    $history = $state['history'] ?? [];
    array_unshift($history, [
        'at'         => time(),
        'duration'   => $duration,
        'new'        => $newCount,
        'updated'    => $updatedCount,
        'months'     => array_keys($monthTouch),
        'pages_done' => $pagesDone,
        'has_more'   => $hasMore,
        'mode'       => $mode ?? 'delta',
        'trigger'    => $full ? 'full' : ($continue ? 'continue' : ($force ? 'force' : 'auto')),
        'user'       => $user['username'] ?? '',
    ]);
    $state['history'] = array_slice($history, 0, 30);
}

writeJson('alert-monitor-state.json', $state);

if ($errorMsg !== null) {
    respondError('Sync failed: ' . $errorMsg, 502);
}

logActivity('alert_monitor_sync', [
    'new'     => $newCount,
    'updated' => $updatedCount,
    'months'  => array_keys($monthTouch),
    'pages'   => $pagesDone,
    'has_more'=> $hasMore,
], $user['sub'] ?? null, $user['name'] ?? null);

respondOk([
    'new'          => $newCount,
    'updated'      => $updatedCount,
    'total_pulled' => $fetchedCount,
    'months'       => array_keys($monthTouch),
    'duration_ms'  => $duration,
    'pages_done'   => $pagesDone,
    'has_more'     => $hasMore,
    'mode'         => $mode ?? 'delta',
    'state'        => $state,
], $hasMore ? 'Chunk complete — more data pending' : 'Sync complete');
