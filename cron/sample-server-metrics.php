#!/usr/bin/env php
<?php
/**
 * Server Resource Metrics Sampler
 *
 * Collects one CPU/RAM/disk snapshot and appends it to
 * data/server_metrics.json. Designed to run on a scheduler so that
 * history accumulates even when no user has the dev-system page open.
 *
 * ── Linux / macOS (cron) ────────────────────────────────────────────────
 *   Run every minute:
 *     * * * * * /usr/bin/php /path/to/centralize-som/cron/sample-server-metrics.php >/dev/null 2>&1
 *
 * ── Windows (Task Scheduler) ────────────────────────────────────────────
 *   Use the bundled sample-server-metrics.bat (edit PHP path inside it):
 *     schtasks /create /tn "Centralize-SOM Metrics" ^
 *              /tr "C:\MAMP\htdocs\centralize-som\cron\sample-server-metrics.bat" ^
 *              /sc minute /mo 1 /ru SYSTEM
 *
 *   Or run directly:
 *     C:\MAMP\bin\php\php8.x.x\php.exe C:\MAMP\htdocs\centralize-som\cron\sample-server-metrics.php
 *
 * The sampler is throttle-safe: if it fires faster than the 60-second
 * throttle, extra calls are no-ops. Multiple writers (cron + live polling
 * from the page) coexist safely via the writeJson() flock.
 */

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/dev/metrics.php';

$start = microtime(true);

try {
    $m = collectServerMetrics();
    $appended = appendServerMetricsSample($m);

    $ms  = round((microtime(true) - $start) * 1000);
    $cpu = $m['cpu']['percent']    ?? 'N/A';
    $mem = $m['memory']['percent'] ?? 'N/A';
    $dsk = $m['disk']['percent']   ?? 'N/A';

    $tag = $appended ? 'sampled' : 'throttled';
    echo "[" . date('Y-m-d H:i:s') . "] $tag · cpu={$cpu}% mem={$mem}% disk={$dsk}% · {$ms}ms\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, "[" . date('Y-m-d H:i:s') . "] Error: " . $e->getMessage() . "\n");
    exit(1);
}
