<?php
/**
 * Server resource metrics — collection + persistence.
 *
 * Used by:
 *   - api/dev/index.php (live snapshot endpoint, called by dev-system page)
 *   - cron/sample-server-metrics.php (background sampler via cron/Task Scheduler)
 *
 * Storage: data/server_metrics.json — rolling buffer, ~10,080 points
 *          (= 7 days at 60-second sample interval).
 *
 * Helpers (readJson/writeJson/DATA_DIR) come from api/helpers.php which must
 * already be loaded by the caller.
 */

const SRV_METRICS_FILE        = 'server_metrics.json';
const SRV_METRICS_THROTTLE    = 60;      // min seconds between appended samples
const SRV_METRICS_MAX_POINTS  = 10080;   // 60s × 60 × 24 × 7 = 7 days

/**
 * Collect a single point-in-time snapshot of CPU/RAM/disk/load/uptime.
 * Supports Linux (/proc/*) and Windows (wmic). Returns nulls on unsupported
 * platforms gracefully.
 */
function collectServerMetrics(): array {
    $isLinux   = stripos(PHP_OS, 'Linux') === 0;
    $isWindows = stripos(PHP_OS, 'WIN')   === 0;
    $canShell  = function_exists('shell_exec');

    $cpuPct   = null;
    $cpuCores = null;
    $mem      = ['total' => null, 'available' => null, 'used' => null, 'free' => null, 'percent' => null];
    $swap     = ['total' => null, 'used' => null, 'free' => null, 'percent' => null];
    $uptime   = null;

    // ── Linux: /proc ──
    if ($isLinux && is_readable('/proc/stat')) {
        $sample = function () {
            $line = strtok(file_get_contents('/proc/stat'), "\n");
            if (!$line) return null;
            $parts = preg_split('/\s+/', trim($line));
            array_shift($parts);
            $nums  = array_map('intval', $parts);
            $idle  = ($nums[3] ?? 0) + ($nums[4] ?? 0);
            $total = array_sum($nums);
            return [$idle, $total];
        };
        $a = $sample(); usleep(200000); $b = $sample();
        if ($a && $b && ($b[1] - $a[1]) > 0) {
            $cpuPct = round((1 - ($b[0] - $a[0]) / ($b[1] - $a[1])) * 100, 1);
        }
    }
    if ($isLinux && is_readable('/proc/cpuinfo')) {
        $cpuCores = substr_count(file_get_contents('/proc/cpuinfo'), "\nprocessor\t") + 1;
    }
    if ($isLinux && is_readable('/proc/meminfo')) {
        $info = [];
        foreach (explode("\n", file_get_contents('/proc/meminfo')) as $line) {
            if (preg_match('/^(\w+):\s+(\d+)/', $line, $m)) $info[$m[1]] = (int)$m[2] * 1024;
        }
        $mem['total']     = $info['MemTotal']     ?? null;
        $mem['free']      = $info['MemFree']      ?? null;
        $mem['available'] = $info['MemAvailable'] ?? null;
        if ($mem['total'] && $mem['available'] !== null) {
            $mem['used']    = $mem['total'] - $mem['available'];
            $mem['percent'] = round($mem['used'] / $mem['total'] * 100, 1);
        }
        $swap['total'] = $info['SwapTotal'] ?? null;
        $swap['free']  = $info['SwapFree']  ?? null;
        if ($swap['total'] !== null && $swap['free'] !== null) {
            $swap['used']    = $swap['total'] - $swap['free'];
            $swap['percent'] = $swap['total'] > 0 ? round($swap['used'] / $swap['total'] * 100, 1) : 0;
        }
    }
    if ($isLinux && is_readable('/proc/uptime')) {
        $uptime = (float) strtok(file_get_contents('/proc/uptime'), ' ');
    }

    // ── Windows: wmic ──
    if ($isWindows && $canShell) {
        $wmic = function ($args) {
            $out = @shell_exec("wmic $args /value 2>NUL");
            if (!$out) return [];
            $kv = [];
            foreach (explode("\n", $out) as $line) {
                $line = trim($line);
                if (strpos($line, '=') === false) continue;
                [$k, $v] = explode('=', $line, 2);
                $kv[trim($k)] = trim($v);
            }
            return $kv;
        };

        $cpu = $wmic('cpu get LoadPercentage,NumberOfLogicalProcessors');
        if (isset($cpu['LoadPercentage']) && $cpu['LoadPercentage'] !== '') {
            $cpuPct = (float) $cpu['LoadPercentage'];
        }
        if (isset($cpu['NumberOfLogicalProcessors']) && $cpu['NumberOfLogicalProcessors'] !== '') {
            $cpuCores = (int) $cpu['NumberOfLogicalProcessors'];
        }

        $os = $wmic('OS get FreePhysicalMemory,TotalVisibleMemorySize,FreeVirtualMemory,TotalVirtualMemorySize,LastBootUpTime');
        if (!empty($os['TotalVisibleMemorySize']) && isset($os['FreePhysicalMemory'])) {
            $mem['total']     = (int) $os['TotalVisibleMemorySize'] * 1024;
            $mem['free']      = (int) $os['FreePhysicalMemory']     * 1024;
            $mem['available'] = $mem['free'];
            $mem['used']      = $mem['total'] - $mem['free'];
            $mem['percent']   = round($mem['used'] / $mem['total'] * 100, 1);
        }
        if (!empty($os['TotalVirtualMemorySize']) && isset($os['FreeVirtualMemory'])) {
            $vt = (int) $os['TotalVirtualMemorySize'] * 1024;
            $vf = (int) $os['FreeVirtualMemory']      * 1024;
            if ($mem['total'] && $vt > $mem['total']) {
                $swap['total']   = $vt - $mem['total'];
                $swap['free']    = max(0, $vf - $mem['free']);
                $swap['used']    = $swap['total'] - $swap['free'];
                $swap['percent'] = $swap['total'] > 0 ? round($swap['used'] / $swap['total'] * 100, 1) : 0;
            }
        }
        if (!empty($os['LastBootUpTime']) && strlen($os['LastBootUpTime']) >= 14) {
            $s = $os['LastBootUpTime'];
            $bootTs = mktime(
                (int)substr($s, 8, 2), (int)substr($s, 10, 2), (int)substr($s, 12, 2),
                (int)substr($s, 4, 2), (int)substr($s, 6, 2), (int)substr($s, 0, 4)
            );
            if ($bootTs) $uptime = time() - $bootTs;
        }
    }

    // ── Disk ──
    $diskPath  = realpath(DATA_DIR) ?: __DIR__;
    $diskTotal = @disk_total_space($diskPath) ?: null;
    $diskFree  = @disk_free_space($diskPath)  ?: null;
    $disk = [
        'path'    => $diskPath,
        'total'   => $diskTotal,
        'free'    => $diskFree,
        'used'    => ($diskTotal && $diskFree !== null) ? $diskTotal - $diskFree : null,
        'percent' => ($diskTotal && $diskFree !== null) ? round(($diskTotal - $diskFree) / $diskTotal * 100, 1) : null,
    ];

    // ── Load avg (Linux/macOS) ──
    $load = function_exists('sys_getloadavg') ? @sys_getloadavg() : null;
    if (!is_array($load) || count($load) < 3) $load = null;

    return [
        'server_time' => time(),
        'hostname'    => gethostname() ?: null,
        'os'          => PHP_OS,
        'cpu'         => ['percent' => $cpuPct, 'cores' => $cpuCores],
        'memory'      => $mem,
        'swap'        => $swap,
        'disk'        => $disk,
        'load_avg'    => $load ? ['1' => round($load[0], 2), '5' => round($load[1], 2), '15' => round($load[2], 2)] : null,
        'uptime'      => $uptime,
    ];
}

/**
 * Append a sample to the rolling history file if enough time has passed since
 * the last entry. Returns true if appended, false if throttled.
 */
function appendServerMetricsSample(array $m, bool $force = false): bool {
    $now   = time();
    $hist  = readJson(SRV_METRICS_FILE);
    $lastT = is_array($hist) && $hist ? (int)(end($hist)['t'] ?? 0) : 0;
    if (!$force && $now - $lastT < SRV_METRICS_THROTTLE) return false;

    $hist[] = [
        't' => $now,
        'c' => $m['cpu']['percent']    ?? null,
        'm' => $m['memory']['percent'] ?? null,
        'd' => $m['disk']['percent']   ?? null,
        'l' => $m['load_avg']['1']     ?? null,
    ];
    if (count($hist) > SRV_METRICS_MAX_POINTS) {
        $hist = array_slice($hist, -SRV_METRICS_MAX_POINTS);
    }
    writeJson(SRV_METRICS_FILE, $hist);
    return true;
}

/**
 * Cheap throttle probe + sample. Returns true if a new sample was written,
 * false if it was too soon (no expensive collection performed).
 *
 * Used by the per-page heartbeat so that *any* logged-in browser tab on
 * *any* page contributes a sample, while 99 % of those hits are no-ops.
 */
function tryAppendMetricsSample(): bool {
    $path  = DATA_DIR . SRV_METRICS_FILE;
    $lastT = file_exists($path) ? (int) filemtime($path) : 0;
    if (time() - $lastT < SRV_METRICS_THROTTLE) return false; // O(1) skip
    return appendServerMetricsSample(collectServerMetrics());
}

/**
 * Read history, optionally filtered to the last $sinceSec seconds, and
 * downsampled (stride) to at most $maxPoints entries.
 */
function readServerMetricsHistory(int $sinceSec = 0, int $maxPoints = 500): array {
    $hist = readJson(SRV_METRICS_FILE);
    if (!$hist) return [];

    if ($sinceSec > 0) {
        $cutoff = time() - $sinceSec;
        $hist   = array_values(array_filter($hist, fn($e) => (int)($e['t'] ?? 0) >= $cutoff));
    }

    $n = count($hist);
    if ($maxPoints > 0 && $n > $maxPoints) {
        $stride = (int) ceil($n / $maxPoints);
        $out = [];
        for ($i = 0; $i < $n; $i += $stride) $out[] = $hist[$i];
        // Always include the last point so the chart ends at "now"
        if (end($out) !== end($hist)) $out[] = $hist[$n - 1];
        return $out;
    }
    return $hist;
}
