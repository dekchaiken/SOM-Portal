<?php
// ─────────────────────────────────────────────────────────────────────────────
//  Batch File Index — Log Indexer (Sprint 1)
//
//  For every job in the catalog for a given server:
//    1. GET lastSuccessfulBuild number via /api/json
//    2. Skip if the meta store already indexed this build number
//    3. Stream {job}/{build}/consoleText into memory (size-capped)
//    4. Regex-extract file-name-shaped tokens + keyword-prefixed mentions
//    5. Normalize each (digit runs of 6+ → <N>) so tomorrow's log matches today's key
//    6. Merge into data/sm/batch_file_index.json (SM-shared)
//    7. Update data/sm/batch_file_index_meta.json (per-job status)
//
//  Endpoints:
//    POST /api/batch-file-index/index_logs.php?server=<id>
//         &job_path=<optional-single-job-for-debug>
//         &dry_run=1 (do not persist index — just return extracted samples)
//    GET  /api/batch-file-index/index_logs.php?server=<id>
//         → return meta status (per-job indexed_at / build / error)
// ─────────────────────────────────────────────────────────────────────────────
require_once __DIR__ . '/../helpers.php';

// Give ourselves headroom — indexing 200+ jobs serially with usleep can take
// a couple of minutes. Frontend polls a progress file, so we ignore client
// disconnect and keep going even if Apache/proxy times out the response.
@set_time_limit(0);
@ini_set('memory_limit', '512M');
ignore_user_abort(true);

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

$serverId = trim($_GET['server'] ?? '');
if (!$serverId) respondError('server required');

// ── GET — return meta status OR live progress for the requested server ───────
// ?progress=1 → return the live progress state (updated during a run), used by
// the admin UI to render a progress bar. Otherwise return the meta summary.
if ($method === 'GET') {
    if (!empty($_GET['progress'])) {
        $prog  = readJson('batch_file_index_progress.json');
        $entry = $prog['servers'][$serverId] ?? null;
        respondOk($entry ?: ['status' => 'idle']);
    }
    $meta = readJson('batch_file_index_meta.json');
    $entry = $meta['servers'][$serverId] ?? null;
    respondOk($entry ?: ['jobs' => new stdClass(), 'summary' => null]);
}

// ── POST — run indexer (SM admin only) ───────────────────────────────────────
if ($method !== 'POST') respondError('Method not allowed', 405);
requireRole($payload, ADMIN_ROLES);
requireSmForShared();  // Writes to sm/batch_file_index.json — SM-only
requireCsrf();

$body         = getBody();
$jobPathOne   = trim($_GET['job_path']       ?? ($body['job_path']       ?? ''));
$jobNameQuery = trim($_GET['job_name_query'] ?? ($body['job_name_query'] ?? ''));
$dryRun       = !empty($_GET['dry_run']) || !empty($body['dry_run']);
$force        = !empty($_GET['force'])   || !empty($body['force']);  // re-index even if build unchanged
$dryRunMaxAttempts = 15;  // dry-run will try up to N jobs, stopping at first success

$servers = require __DIR__ . '/../jenkins_config.php';
if (!isset($servers[$serverId])) respondError('Unknown server', 404);
$server = $servers[$serverId];

$catalog = readJson('jenkins_jobs_catalog.json');
$srvCat  = $catalog['servers'][$serverId] ?? null;
if (!$srvCat || empty($srvCat['jobs'])) {
    respondError('Server not crawled yet — run Crawl first', 400);
}
$jobs = $srvCat['jobs'];
if ($jobPathOne) {
    $jobs = array_values(array_filter($jobs, fn($j) => ($j['path'] ?? '') === $jobPathOne));
    if (!$jobs) respondError('job_path not found in catalog', 404);
}
// Optional dry-run filter by job-name substring — user can search a specific
// job (e.g. "settlement") instead of dry-running catalog order. If no job
// matches we return success with a `no_match` flag rather than 4xx to keep
// the browser console quiet (this is expected UX, not an error).
if ($dryRun && !$jobPathOne && $jobNameQuery !== '') {
    $needle = strtolower($jobNameQuery);
    $filtered = array_values(array_filter($jobs, fn($j) => strpos(strtolower($j['name'] ?? ''), $needle) !== false));
    if (!$filtered) {
        respondOk([
            'server_id'       => $serverId,
            'server_display'  => $server['display'] ?? $serverId,
            'dry_run'         => true,
            'no_match'        => true,
            'job_name_query'  => $jobNameQuery,
            'catalog_size'    => count($jobs),
        ], "No job in catalog matches: $jobNameQuery");
    }
    $jobs = $filtered;
}

// ─────────────────────────────────────────────────────────────────────────────
// cURL helpers — mirror crawl.php's jxRequest but with a byte-cap variant for
// consoleText (some Jenkins jobs emit 100 MB+ logs and would OOM the process).
// ─────────────────────────────────────────────────────────────────────────────
function jxJson(array $server, string $url): array {
    $auth = $server['auth'];
    $ch   = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 BatchFileIndex-Indexer',
    ]);
    $headers = ['Accept: application/json'];
    if ($auth['mode'] === 'token' && !empty($auth['token'])) {
        $headers[] = 'Authorization: Basic ' . base64_encode($auth['user'] . ':' . $auth['token']);
    } elseif ($auth['mode'] === 'cookie' && !empty($auth['cookie'])) {
        curl_setopt($ch, CURLOPT_COOKIE, $auth['cookie']);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$body, $code, $err];
}

// Fetches consoleText but aborts once $maxBytes has been received.
// $captured is populated incrementally via a WRITEFUNCTION.
function jxConsoleTextCapped(array $server, string $url, int $maxBytes): array {
    $auth      = $server['auth'];
    $captured  = '';
    $aborted   = false;
    $ch        = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 BatchFileIndex-Indexer',
    ]);
    $headers = ['Accept: text/plain'];
    if ($auth['mode'] === 'token' && !empty($auth['token'])) {
        $headers[] = 'Authorization: Basic ' . base64_encode($auth['user'] . ':' . $auth['token']);
    } elseif ($auth['mode'] === 'cookie' && !empty($auth['cookie'])) {
        curl_setopt($ch, CURLOPT_COOKIE, $auth['cookie']);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) use (&$captured, &$aborted, $maxBytes) {
        $captured .= $chunk;
        if (strlen($captured) >= $maxBytes) {
            $aborted = true;
            // Truncate to exact cap so the tail regex doesn't parse partial UTF-8 sequences.
            $captured = substr($captured, 0, $maxBytes);
            return 0; // returning less than $chunk length aborts curl
        }
        return strlen($chunk);
    });
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    // If we aborted by returning 0, cURL reports an error we should treat as OK.
    if ($aborted && $err && strpos($err, 'callback') !== false) $err = '';
    return [$captured, $code, $err, $aborted];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern extraction
//
// Two regexes on the fetched log:
//   (a) tokens with a known file extension:   Foo.Bar_2026_v3.csv
//   (b) tokens with 3+ underscore-separated segments (batch-team convention):
//       Dailypayment_DISABLESETTLE_010..._settlement_...
// Plus keyword-prefixed mentions ("Uploading: xxx") captured as bonus context.
//
// For each unique raw match we also keep a small log-line context snippet as
// evidence the user can click through to verify.
// ─────────────────────────────────────────────────────────────────────────────
function extractFilePatterns(string $log): array {
    $out       = [];
    $seenRaw   = [];

    // Split into lines up-front so we can attach a snippet to each match.
    $lines = preg_split('/\R/', $log);

    // Common batch-file extensions (case-insensitive). Add more as needed.
    $extRe = '/\b([A-Za-z0-9][A-Za-z0-9._\-]{5,240}\.(?:txt|csv|tsv|dat|xlsx|xls|zip|xml|json|jsonl|pdf|log|gz|tar|out|parquet|avro|orc|properties|yaml|yml|sql|html|htm|md|conf|ini|cfg|report|bak))\b/i';

    // Snake_case-with-digits-runs: 3+ underscore segments, ≥1 numeric segment.
    // Catches Dailypayment_DISABLESETTLE_...  and 251125_tmn_d4.24p.txt-like fragments.
    $tokRe = '/\b([A-Za-z][A-Za-z0-9]{2,}(?:_[A-Za-z0-9]{2,}){2,})\b/';

    foreach ($lines as $lineIdx => $line) {
        if ($line === '') continue;
        // Cap per-line scan cost — cut extra-long lines (some tools dump JSON on one line).
        $probe = strlen($line) > 4000 ? substr($line, 0, 4000) : $line;

        // Pattern (a) — with extension
        if (preg_match_all($extRe, $probe, $m1)) {
            foreach ($m1[1] as $tok) {
                if (isset($seenRaw[$tok])) continue;
                $seenRaw[$tok] = true;
                $out[] = [
                    'raw'     => $tok,
                    'kind'    => 'ext',
                    'snippet' => trim(mb_substr($line, 0, 240)),
                ];
                if (count($out) >= 500) return $out;  // hard cap per job
            }
        }

        // Pattern (b) — snake_case with digits (only apply on lines with digits AND '_'
        // to avoid regex cost on noise like "Started by user")
        if (strpos($probe, '_') !== false && preg_match('/\d/', $probe)) {
            if (preg_match_all($tokRe, $probe, $m2)) {
                foreach ($m2[1] as $tok) {
                    // Only keep tokens with at least one digit-heavy segment to prune noise
                    if (!preg_match('/\d{4,}/', $tok)) continue;
                    if (isset($seenRaw[$tok])) continue;
                    $seenRaw[$tok] = true;
                    $out[] = [
                        'raw'     => $tok,
                        'kind'    => 'snake',
                        'snippet' => trim(mb_substr($line, 0, 240)),
                    ];
                    if (count($out) >= 500) return $out;
                }
            }
        }
    }

    return $out;
}

// Normalize a raw pattern to a stable index key.
// Rule: replace any run of 6+ digits with the literal token <N>. Preserves
// short digits (like _0_, d4) that likely represent partition/variant.
// Also collapse whitespace inside — should not exist, but safety.
function normalizeFilePattern(string $raw): string {
    $s = preg_replace('/\d{6,}/', '<N>', $raw);
    return $s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────────────────────
$LOG_MAX_BYTES     = 8 * 1024 * 1024;    // 8 MB per log — abort beyond (was 20MB)
$FLUSH_EVERY_N     = 40;                 // persist meta+progress every N jobs
$PAUSE_MS          = 80;                 // small delay to be gentle on Jenkins
$ERROR_BACKOFF_HRS = 6;                  // skip re-trying log_fetch_error / no_build for N hrs
$TOO_LARGE_BACKOFF_DAYS = 30;            // once flagged log_too_large, skip for N days

// ── Progress state helpers ──────────────────────────────────────────────────
// Small JSON file (< 2KB) updated during the loop. Frontend polls it for a
// live progress bar. Kept separate from the giant meta file to keep writes fast.
$runId         = 'run_' . bin2hex(random_bytes(6));
$runStartedAt  = date('c');
$totalJobs     = count($jobs);

function batchFileIndexWriteProgress(string $serverId, array $data): void {
    $prog = readJson('batch_file_index_progress.json');
    if (!isset($prog['servers']) || !is_array($prog['servers'])) $prog['servers'] = [];
    $prog['servers'][$serverId] = $data;
    writeJson('batch_file_index_progress.json', $prog);
}

// ── Fatal-error safety net ──────────────────────────────────────────────────
// register_shutdown_function fires even on PHP fatal errors (memory exhaust,
// uncaught exception). Without this, the frontend would see a bare 500 and
// nothing lands in security.json. We update progress state → 'error' so the
// UI can surface the cause instead of spinning forever.
$__shutdownCtx = [
    'server_id'  => $serverId,
    'run_id'     => $runId,
    'started_at' => $runStartedAt,
    'dry_run'    => $dryRun,
];
register_shutdown_function(function () use ($__shutdownCtx) {
    $err = error_get_last();
    $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if (!$err || !in_array($err['type'], $fatalTypes, true)) return;
    $msg = sprintf('Fatal: %s in %s:%d', $err['message'] ?? 'unknown', basename($err['file'] ?? ''), $err['line'] ?? 0);
    try {
        batchFileIndexWriteProgress($__shutdownCtx['server_id'], [
            'run_id'      => $__shutdownCtx['run_id'],
            'started_at'  => $__shutdownCtx['started_at'],
            'updated_at'  => date('c'),
            'finished_at' => date('c'),
            'status'      => 'error',
            'message'     => $msg,
            'dry_run'     => $__shutdownCtx['dry_run'],
        ]);
    } catch (\Throwable $_) {}
    if (function_exists('logSecurity')) {
        try {
            logSecurity('server_error', [
                'code'    => 500,
                'message' => 'batch-file-index ' . $msg,
                'path'    => strtok($_SERVER['REQUEST_URI'] ?? '', '?'),
                'method'  => $_SERVER['REQUEST_METHOD'] ?? '',
            ]);
        } catch (\Throwable $_) {}
    }
});

// Reset progress state to "running" BEFORE the 16MB index load. The frontend
// starts polling as soon as it fires POST — without this, it would briefly see
// the previous run's 'done' state and stop polling before the new run kicks in.
if (!$dryRun) {
    batchFileIndexWriteProgress($serverId, [
        'run_id'      => $runId,
        'started_at'  => $runStartedAt,
        'updated_at'  => $runStartedAt,
        'finished_at' => null,
        'status'      => 'running',
        'message'     => null,
        'total'       => $totalJobs,
        'processed'   => 0,
        'current_job' => 'Loading index…',
        'stats'       => [
            'jobs_seen'               => 0,
            'jobs_indexed'            => 0,
            'jobs_skipped_no_build'   => 0,
            'jobs_skipped_same_build' => 0,
            'jobs_skipped_backoff'    => 0,
            'jobs_skipped_too_large'  => 0,
            'jobs_error'              => 0,
            'patterns_added'          => 0,
            'patterns_updated'        => 0,
            'log_bytes_read'          => 0,
        ],
        'dry_run'     => false,
    ]);
}

// Load index + meta (SM-shared files, read via helpers)
$index = readJson('batch_file_index.json');
if (!isset($index['patterns']) || !is_array($index['patterns'])) $index['patterns'] = [];

$meta = readJson('batch_file_index_meta.json');
if (!isset($meta['servers']) || !is_array($meta['servers'])) $meta['servers'] = [];
if (!isset($meta['servers'][$serverId]))                    $meta['servers'][$serverId] = ['jobs' => [], 'summary' => null];
if (!isset($meta['servers'][$serverId]['jobs']))            $meta['servers'][$serverId]['jobs'] = [];

$stats = [
    'jobs_seen'               => 0,
    'jobs_indexed'            => 0,
    'jobs_skipped_no_build'   => 0,
    'jobs_skipped_same_build' => 0,
    'jobs_skipped_backoff'    => 0,
    'jobs_skipped_too_large'  => 0,
    'jobs_error'              => 0,
    'patterns_added'          => 0,
    'patterns_updated'        => 0,
    'log_bytes_read'          => 0,
    'started_at'              => $runStartedAt,
    'error_samples'           => [],
];

// Dry-run aggregation — track every attempted job so the UI can show why we
// might have found zero patterns (e.g. "tried 10 jobs, all CICD deploy jobs").
$dryRunAttempts    = [];
$dryRunWinner      = null;   // first attempted job that produced ≥1 pattern
$dryRunLastAttempt = null;   // for showing a log preview if no winner

$base = rtrim($server['base_url'], '/');

foreach ($jobs as $j) {
    $stats['jobs_seen']++;
    $jobName = $j['name'] ?? '';
    $jobUrl  = rtrim($j['url']  ?? '', '/');
    $jobPath = $j['path'] ?? '';
    if (!$jobUrl || !$jobPath) { $stats['jobs_error']++; continue; }

    // ── Backoff: skip jobs that recently errored / had no build / had oversized
    // logs. This is what turns a 20-min re-run into a 30-sec one — the previous
    // implementation retried every failing job on every run, each burning ≥20s
    // on the consoleText timeout. Backoff decays so real fixes get picked up.
    $prev = $meta['servers'][$serverId]['jobs'][$jobPath] ?? null;
    if (!$force && $prev) {
        $prevStatus = $prev['status'] ?? '';
        $prevAtTs   = strtotime($prev['last_indexed_at'] ?? '') ?: 0;

        if ($prevAtTs && in_array($prevStatus, ['log_fetch_error', 'no_successful_build'], true)) {
            if ((time() - $prevAtTs) / 3600 < $ERROR_BACKOFF_HRS) {
                $stats['jobs_skipped_backoff']++;
                continue;
            }
        }
        // Log-too-large — user asked to skip these entirely. Long backoff so we
        // do eventually re-check (build may have been trimmed by the pipeline).
        if ($prevAtTs && $prevStatus === 'log_too_large') {
            if ((time() - $prevAtTs) / 86400 < $TOO_LARGE_BACKOFF_DAYS) {
                $stats['jobs_skipped_too_large']++;
                continue;
            }
        }
    }

    // Progress: update every N jobs so the UI can render a moving bar.
    // Cheap — the progress file is < 2KB.
    if (!$dryRun && ($stats['jobs_seen'] % 5 === 0)) {
        batchFileIndexWriteProgress($serverId, [
            'run_id'      => $runId,
            'started_at'  => $runStartedAt,
            'updated_at'  => date('c'),
            'finished_at' => null,
            'status'      => 'running',
            'message'     => null,
            'total'       => $totalJobs,
            'processed'   => $stats['jobs_seen'],
            'current_job' => $jobName,
            'stats'       => $stats,
            'dry_run'     => false,
        ]);
    }

    // 1) Resolve last successful build number
    $metaUrl = $jobUrl . '/api/json?tree=' . rawurlencode('lastSuccessfulBuild[number,timestamp,url]');
    [$jb, $jc, $je] = jxJson($server, $metaUrl);
    if ($je || $jc !== 200) {
        $stats['jobs_error']++;
        if (count($stats['error_samples']) < 8) $stats['error_samples'][] = "$jobName: HTTP $jc " . ($je ?: '');
        $meta['servers'][$serverId]['jobs'][$jobPath] = [
            'last_indexed_build' => null,
            'last_indexed_at'    => date('c'),
            'status'             => 'error',
            'error'              => $je ?: "HTTP $jc",
        ];
        if ($dryRun) {
            $dryRunAttempts[] = ['job_name' => $jobName, 'job_path' => $jobPath, 'status' => 'error', 'reason' => "HTTP $jc " . ($je ?: '')];
            if (count($dryRunAttempts) >= $dryRunMaxAttempts) break;
        }
        continue;
    }
    $mj  = json_decode($jb, true);
    $lsb = $mj['lastSuccessfulBuild'] ?? null;
    if (!$lsb || !isset($lsb['number'])) {
        $stats['jobs_skipped_no_build']++;
        $meta['servers'][$serverId]['jobs'][$jobPath] = [
            'last_indexed_build' => null,
            'last_indexed_at'    => date('c'),
            'status'             => 'no_successful_build',
            'error'              => null,
        ];
        if ($dryRun) {
            $dryRunAttempts[] = ['job_name' => $jobName, 'job_path' => $jobPath, 'status' => 'no_build', 'reason' => 'no successful build ever'];
            if (count($dryRunAttempts) >= $dryRunMaxAttempts) break;
        }
        continue;
    }
    $buildNumber = (int)$lsb['number'];

    // 2) Skip if this build was already indexed (unless forced) — $prev loaded above.
    if (!$force && $prev && (int)($prev['last_indexed_build'] ?? -1) === $buildNumber && ($prev['status'] ?? '') === 'ok') {
        $stats['jobs_skipped_same_build']++;
        continue;
    }

    // 3) Fetch consoleText (size-capped)
    $consoleUrl = $jobUrl . '/' . $buildNumber . '/consoleText';
    [$log, $lc, $le, $abortedByCap] = jxConsoleTextCapped($server, $consoleUrl, $LOG_MAX_BYTES);
    if ($le || ($lc !== 200 && !$abortedByCap)) {
        $stats['jobs_error']++;
        if (count($stats['error_samples']) < 8) $stats['error_samples'][] = "$jobName #$buildNumber: HTTP $lc " . ($le ?: '');
        $meta['servers'][$serverId]['jobs'][$jobPath] = [
            'last_indexed_build' => $buildNumber,
            'last_indexed_at'    => date('c'),
            'status'             => 'log_fetch_error',
            'error'              => $le ?: "HTTP $lc",
        ];
        if ($dryRun) {
            $dryRunAttempts[] = ['job_name' => $jobName, 'job_path' => $jobPath, 'build_number' => $buildNumber, 'status' => 'log_fetch_error', 'reason' => $le ?: "HTTP $lc"];
            if (count($dryRunAttempts) >= $dryRunMaxAttempts) break;
        }
        continue;
    }
    $logSize = strlen($log);
    $stats['log_bytes_read'] += $logSize;

    // 4) Extract patterns
    $extracted = extractFilePatterns($log);

    if ($dryRun) {
        $attempt = [
            'job_name'       => $jobName,
            'job_path'       => $jobPath,
            'build_number'   => $buildNumber,
            'log_bytes'      => $logSize,
            'log_truncated'  => $abortedByCap ? true : false,
            'patterns_count' => count($extracted),
            'status'         => count($extracted) > 0 ? 'has_patterns' : 'no_patterns',
        ];
        $dryRunAttempts[] = $attempt;
        $dryRunLastAttempt = $attempt + ['log_preview' => mb_substr($log, 0, 2500)];
        if (count($extracted) > 0 && $dryRunWinner === null) {
            $dryRunWinner = [
                'job_name'     => $jobName,
                'job_path'     => $jobPath,
                'job_url'      => $jobUrl,
                'build_number' => $buildNumber,
                'log_bytes'    => $logSize,
                'log_preview'  => mb_substr($log, 0, 2500),
                'extracted'    => $extracted,
            ];
            break;  // dry-run: stop at first winner
        }
        if (count($dryRunAttempts) >= $dryRunMaxAttempts) break;
    }

    // 5) Merge into index (unless dry-run)
    $addedForJob   = 0;
    $updatedForJob = 0;
    if (!$dryRun) {
        foreach ($extracted as $ex) {
            $norm = normalizeFilePattern($ex['raw']);
            if (!isset($index['patterns'][$norm])) $index['patterns'][$norm] = [];

            $matched = false;
            foreach ($index['patterns'][$norm] as &$entry) {
                if (($entry['server_id'] ?? '') === $serverId && ($entry['job_path'] ?? '') === $jobPath) {
                    $entry['last_seen_build'] = $buildNumber;
                    $entry['last_seen_at']    = date('c');
                    $entry['raw_sample']      = $ex['raw'];
                    $entry['log_snippet']     = $ex['snippet'];
                    $matched = true;
                    $updatedForJob++;
                    break;
                }
            }
            unset($entry);

            if (!$matched) {
                $index['patterns'][$norm][] = [
                    'server_id'       => $serverId,
                    'server_display'  => $server['display'] ?? $serverId,
                    'job_name'        => $jobName,
                    'job_path'        => $jobPath,
                    'job_url'         => $jobUrl,
                    'first_seen_at'   => date('c'),
                    'last_seen_at'    => date('c'),
                    'last_seen_build' => $buildNumber,
                    'raw_sample'      => $ex['raw'],
                    'log_snippet'     => $ex['snippet'],
                    'match_kind'      => $ex['kind'],
                ];
                $addedForJob++;
            }
        }
    }

    $stats['jobs_indexed']++;
    $stats['patterns_added']   += $addedForJob;
    $stats['patterns_updated'] += $updatedForJob;

    // 6) Update meta for this job.
    // If we hit the size cap, mark the job so subsequent runs skip re-fetching
    // (a huge log is unlikely to shrink; the user asked for these to be skipped).
    // We still keep whatever patterns we extracted from the first LOG_MAX_BYTES.
    $meta['servers'][$serverId]['jobs'][$jobPath] = [
        'last_indexed_build' => $buildNumber,
        'last_indexed_at'    => date('c'),
        'status'             => $abortedByCap ? 'log_too_large' : 'ok',
        'error'              => null,
        'patterns_extracted' => count($extracted),
        'log_bytes'          => $logSize,
        'log_truncated'      => $abortedByCap ? true : false,
    ];

    // 7) Rate-limit + periodic flush. Only meta (~500KB) + progress (~1KB) get
    // flushed mid-run — the 16MB index file is written once at the end. Cuts
    // ~40× disk churn on large runs.
    if ($PAUSE_MS > 0) usleep($PAUSE_MS * 1000);
    if (!$dryRun && ($stats['jobs_indexed'] % $FLUSH_EVERY_N === 0)) {
        writeJson('batch_file_index_meta.json', $meta);
    }
}

$stats['finished_at'] = date('c');

// Final persist
if (!$dryRun) {
    $index['generated_at'] = date('c');
    writeJson('batch_file_index.json', $index);
    $meta['servers'][$serverId]['summary'] = $stats;
    writeJson('batch_file_index_meta.json', $meta);

    // Mark progress as done so the UI stops polling
    batchFileIndexWriteProgress($serverId, [
        'run_id'      => $runId,
        'started_at'  => $runStartedAt,
        'updated_at'  => date('c'),
        'finished_at' => date('c'),
        'status'      => 'done',
        'message'     => null,
        'total'       => $totalJobs,
        'processed'   => $stats['jobs_seen'],
        'current_job' => '',
        'stats'       => $stats,
        'dry_run'     => false,
    ]);
}

logActivity('batch_file_index_run', [
    'server_id'      => $serverId,
    'jobs_seen'      => $stats['jobs_seen'],
    'jobs_indexed'   => $stats['jobs_indexed'],
    'patterns_added' => $stats['patterns_added'],
    'dry_run'        => $dryRun ? 1 : 0,
    'single_job'     => $jobPathOne ?: null,
], $payload['sub'], $payload['name']);

$response = [
    'server_id'        => $serverId,
    'server_display'   => $server['display'] ?? $serverId,
    'dry_run'          => $dryRun,
    'stats'            => $stats,
];

if ($dryRun) {
    $response['dry_run_attempts'] = $dryRunAttempts;
    if ($dryRunWinner) {
        $response['dry_run_winner'] = [
            'job_name'     => $dryRunWinner['job_name'],
            'job_path'     => $dryRunWinner['job_path'],
            'job_url'      => $dryRunWinner['job_url'],
            'build_number' => $dryRunWinner['build_number'],
            'log_bytes'    => $dryRunWinner['log_bytes'],
            'log_preview'  => $dryRunWinner['log_preview'],
        ];
        $sample = [];
        foreach (array_slice($dryRunWinner['extracted'], 0, 30) as $ex) {
            $sample[] = [
                'raw'        => $ex['raw'],
                'normalized' => normalizeFilePattern($ex['raw']),
                'snippet'    => $ex['snippet'],
            ];
        }
        $response['sample_extractions'] = $sample;
    } elseif ($dryRunLastAttempt) {
        // No winner across all attempts — send the last attempt's log preview
        // so the user can eyeball what the logs actually contain.
        $response['dry_run_last_attempt'] = $dryRunLastAttempt;
    }
}

respondOk($response, sprintf(
    'Indexed %d jobs (added %d patterns, updated %d, %d errors)',
    $stats['jobs_indexed'], $stats['patterns_added'], $stats['patterns_updated'], $stats['jobs_error']
));
