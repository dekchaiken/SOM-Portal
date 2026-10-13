<?php
/**
 * _lib.php — Shared logic for Downstream Health Explorer.
 *
 * Companion to Begin Grafana (which surfaces INBOUND http_server_requests).
 * This one focuses on OUTBOUND calls: http_client_requests_seconds_count
 * broken down by (path/uri, status, intx_status) so ops can answer
 * "which downstream endpoint is failing for service X right now?".
 *
 * Reuses service-performance-sources.json for datasources + auth, and
 * bgDetectSource() so the same probe logic that finds a service's inbound
 * metrics also finds where its outbound metrics live (same scrape).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';
require_once __DIR__ . '/../begin-grafana/_lib.php';

if (!defined('DH_CACHE_TTL')) {
    define('DH_CACHE_TTL', 30);        // seconds, per (service, range) breakdown
    define('DH_SERVICES_TTL', 300);    // seconds, autocomplete list (heavier query)
}

if (!function_exists('dhParseRange')) {

    /** Accept "15m" | "1h" | "3h" | "6h" | "24h" | integer minutes.
     *  Returns [seconds, promRangeStr] — e.g. (3600, "1h"). Bounded [5m..24h]. */
    function dhParseRange(string $s): array {
        $s = strtolower(trim($s));
        if ($s === '' || $s === '0') return [3600, '1h'];
        // integer minutes fallback
        if (ctype_digit($s)) {
            $mins = max(5, min(1440, (int)$s));
            return [$mins * 60, $mins . 'm'];
        }
        if (!preg_match('/^(\d+)(m|h|d)$/', $s, $m)) return [3600, '1h'];
        $n = (int)$m[1]; $unit = $m[2];
        $sec = $unit === 'd' ? $n * 86400 : ($unit === 'h' ? $n * 3600 : $n * 60);
        $sec = max(300, min(86400, $sec));
        // Re-emit canonical string
        if ($sec % 3600 === 0)      return [$sec, ($sec/3600) . 'h'];
        if ($sec % 60   === 0)      return [$sec, ($sec/60)   . 'm'];
        return [$sec, $sec . 's'];
    }

    /** Cache path scoped to the current team's data dir. */
    function dhCachePath(string $key): string {
        $safe = preg_replace('/[^a-z0-9._-]+/i', '_', $key);
        return teamDataPath('downstream-health/cache/' . $safe . '.json');
    }
    function dhReadCache(string $key, int $ttl): ?array {
        $p = dhCachePath($key);
        if (!file_exists($p)) return null;
        $age = time() - (int)filemtime($p);
        if ($age > $ttl) return null;
        $d = json_decode((string)file_get_contents($p), true);
        if (!is_array($d)) return null;
        $d['_cacheAgeSeconds'] = $age;
        $d['fromCache'] = true;
        return $d;
    }
    function dhWriteCache(string $key, array $payload): void {
        $p = dhCachePath($key);
        $d = dirname($p);
        if (!is_dir($d)) @mkdir($d, 0775, true);
        $tmp = $p . '.tmp.' . bin2hex(random_bytes(4));
        if (@file_put_contents($tmp, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) !== false) {
            @rename($tmp, $p);
        }
    }

    /** All sources with a JVM (Micrometer) datasource configured.
     *  Mirrors bgLoadSources() but re-implemented here so that removing
     *  begin-grafana wouldn't break us. Currently both use the same list. */
    function dhLoadSources(): array {
        return bgLoadSources();
    }

    /** Enumerate every `app_name` label value that emits http_client_requests
     *  across every source, unioned + deduped. Returned as [service, source, count].
     *  Expensive — cached under DH_SERVICES_TTL. */
    function dhListServices(): array {
        $cacheKey = 'services_all';
        if ($c = dhReadCache($cacheKey, DH_SERVICES_TTL)) return $c;

        $rows = [];       // service name (lowercased) → row
        foreach (dhLoadSources() as $src) {
            $slug   = (string)($src['slug'] ?? '');
            $name   = (string)($src['name'] ?? '');
            $jvmSrc = $src;
            $jvmSrc['dsUid'] = (string)$src['jvmDsUid'];

            // Probe each app-label variant so services registered on legacy
            // labels (`application`) or scrape jobs (`job`) still surface.
            // First-hit wins per source — no need to double-count.
            $labels = ['app_name', 'appScope', 'application', 'job'];
            foreach ($labels as $lbl) {
                try {
                    $r = spQueryPromQL($jvmSrc, [
                        'v' => "count by ({$lbl}) (http_client_requests_seconds_count)",
                    ]);
                } catch (Throwable $e) { break; }
                $vec = $r['v'] ?? [];
                if (empty($vec)) continue;
                foreach ($vec as $x) {
                    $svc = trim((string)($x['metric'][$lbl] ?? ''));
                    if ($svc === '') continue;
                    $key = strtolower($svc);
                    if (!isset($rows[$key])) {
                        $rows[$key] = [
                            'service'   => $svc,
                            'label'     => $lbl,
                            'sourceSlug'=> $slug,
                            'sourceName'=> $name,
                            'seriesCount' => (int)round((float)($x['value'][1] ?? 0)),
                        ];
                    }
                }
                break; // stop probing more labels once this source produced data
            }
        }
        ksort($rows);
        $out = ['services' => array_values($rows), 'fetchedAt' => date('c'), 'fromCache' => false];
        dhWriteCache($cacheKey, $out);
        return $out;
    }

    /** For a given service, run the error-breakdown queries and return a
     *  merged row set: [endpoint, status, count]. `endpoint` is whichever
     *  label the metric uses (`path` on Truemoney's true-gateway, `uri` on
     *  vanilla Micrometer). `status` is `intx_status` when present, else `status`.
     *
     *  Also returns a "success" total per endpoint (2xx/3xx) so the UI can
     *  render an error-rate percentage next to the raw count.
     */
    function dhBreakdown(array $src, string $service, string $appLabel, string $cluster, string $promRange, int $evalTime = 0): array {
        $sel = bgSelector($service, $cluster, $appLabel);

        // Both label-variants are grouped by in one query — series only carry
        // whichever labels they were scraped with, so PromQL fills the missing
        // one with empty string. PHP merges the empties out later.
        $errQ  = "sum by (path, uri, status, intx_status, exception) ("
               . "increase(http_client_requests_seconds_count{{$sel}}[{$promRange}])"
               . ")";
        // Success bucket — 2xx/3xx (or intx 200-000/204-000). We compute error
        // rate against this in the UI. Grouped by endpoint only (status doesn't
        // matter for the ratio).
        $sucQ  = "sum by (path, uri) ("
               . "increase(http_client_requests_seconds_count{{$sel},status=~\"2..|3..\"}[{$promRange}])"
               . ")";
        // Total per endpoint — used when a service uses intx_status instead of
        // HTTP status (then the status=~"2.." filter matches nothing usable).
        $totQ  = "sum by (path, uri) ("
               . "increase(http_client_requests_seconds_count{{$sel}}[{$promRange}])"
               . ")";

        try {
            $r = spQueryPromQL($src, ['err' => $errQ, 'suc' => $sucQ, 'tot' => $totQ], $evalTime);
        } catch (Throwable $e) {
            return ['found' => false, 'error' => $e->getMessage(), 'rows' => []];
        }

        // Merge success + total per endpoint key
        $totals = [];   // endpoint → ['total'=>N, 'success'=>N]
        foreach (($r['tot'] ?? []) as $x) {
            $m = $x['metric'] ?? [];
            $ep = _dhEndpointKey($m);
            if ($ep === '') continue;
            $totals[$ep]['total']   = ($totals[$ep]['total']   ?? 0) + (float)($x['value'][1] ?? 0);
            $totals[$ep]['success'] = $totals[$ep]['success'] ?? 0;
        }
        foreach (($r['suc'] ?? []) as $x) {
            $m = $x['metric'] ?? [];
            $ep = _dhEndpointKey($m);
            if ($ep === '') continue;
            $totals[$ep]['success'] = ($totals[$ep]['success'] ?? 0) + (float)($x['value'][1] ?? 0);
            $totals[$ep]['total']   = $totals[$ep]['total']   ?? 0;
        }

        // Error rows — one per (endpoint, status). Skip 2xx/3xx (those are
        // "success" and shouldn't show in the error breakdown). We deliberately
        // include statuses like "500-004" (Micrometer intx_status) and 4xx/5xx.
        $rows = [];
        foreach (($r['err'] ?? []) as $x) {
            $m = $x['metric'] ?? [];
            $ep = _dhEndpointKey($m);
            if ($ep === '') continue;
            $count = (float)($x['value'][1] ?? 0);
            if ($count <= 0) continue;
            $statusRaw = trim((string)($m['status']      ?? ''));
            $intxRaw   = trim((string)($m['intx_status'] ?? ''));
            // Prefer intx_status when set (it's the richer sub-code); otherwise
            // fall back to HTTP status. Rows without either are transport-level
            // failures — bucket them as "CONNECT_ERR" so they don't get lost.
            $status = $intxRaw !== '' ? $intxRaw : $statusRaw;
            if ($status === '' || strtolower($status) === 'none') {
                $status = 'CONNECT_ERR';
            }
            // Success rows in the raw response get merged into `success` above;
            // skip 2xx/3xx here so this list is truly "errors only".
            if (preg_match('/^[23]\d{2}(-.*)?$/', $status)) continue;
            if ($status === '200-000' || $status === '204-000') continue;

            $rows[] = [
                'endpoint'  => $ep,
                'status'    => $status,
                'exception' => trim((string)($m['exception'] ?? '')),
                'count'     => (int)round($count),
            ];
        }

        // Sort descending by count
        usort($rows, fn($a, $b) => $b['count'] <=> $a['count']);

        // Compute per-endpoint aggregate (sum of error counts + errorRate)
        $epAgg = [];
        foreach ($rows as $r0) {
            $ep = $r0['endpoint'];
            if (!isset($epAgg[$ep])) {
                $epAgg[$ep] = [
                    'endpoint'   => $ep,
                    'errorCount' => 0,
                    'total'      => (int)round($totals[$ep]['total']   ?? 0),
                    'success'    => (int)round($totals[$ep]['success'] ?? 0),
                    'statuses'   => [],
                ];
            }
            $epAgg[$ep]['errorCount'] += $r0['count'];
            $epAgg[$ep]['statuses'][] = ['status' => $r0['status'], 'count' => $r0['count'], 'exception' => $r0['exception']];
        }
        // Endpoints with total traffic but zero errors — surface them too so
        // "everything is fine" is a visible answer, not a blank screen.
        foreach ($totals as $ep => $t) {
            if (!isset($epAgg[$ep])) {
                $epAgg[$ep] = [
                    'endpoint'   => $ep,
                    'errorCount' => 0,
                    'total'      => (int)round($t['total']   ?? 0),
                    'success'    => (int)round($t['success'] ?? 0),
                    'statuses'   => [],
                ];
            }
        }
        // Rate calc + final sort by errorCount desc
        foreach ($epAgg as &$e) {
            $e['errorRate'] = $e['total'] > 0 ? round(($e['errorCount'] / $e['total']) * 100, 2) : null;
        }
        unset($e);
        $endpoints = array_values($epAgg);
        usort($endpoints, fn($a, $b) => $b['errorCount'] <=> $a['errorCount']);

        return [
            'found'     => true,
            'endpoints' => $endpoints,
            'rows'      => $rows,
        ];
    }

    /** Compose an endpoint display key from a metric's labels. Prefers `path`
     *  (Truemoney true-gateway convention) over `uri` (Micrometer default).
     *  Returns '' when neither is present (metric probably not http-client). */
    function _dhEndpointKey(array $labels): string {
        $p = trim((string)($labels['path'] ?? ''));
        if ($p !== '') return $p;
        $u = trim((string)($labels['uri']  ?? ''));
        return $u;
    }

    /** Range time-series per status for one endpoint. Returns Prometheus
     *  matrix shape trimmed to [{status, points:[[ts,val],...]}].
     *  `points` uses `increase(...[1m])` so it's directly comparable to
     *  the total counts returned by dhBreakdown() (both are counts, not rates).
     */
    function dhTimeseries(array $src, string $service, string $appLabel, string $cluster, string $endpoint, int $rangeSec, int $startTime = 0, int $endTime = 0): array {
        $sel = bgSelector($service, $cluster, $appLabel);
        // Use exact-match (`path="..."`) instead of regex — endpoints like
        // `/open-invoices/{banNo}` contain `{}` which RE2 interprets as the
        // `{n,m}` repetition operator and rejects, returning 0 series. Exact
        // match sidesteps escape gymnastics entirely.
        $epQ = bgEscapeLiteral($endpoint);
        $errFilter = 'status!~"2..|3..",intx_status!~"200-000|204-000"';
        $q = "sum by (status, intx_status) (increase("
           . "http_client_requests_seconds_count{{$sel},path=\"{$epQ}\",{$errFilter}}[1m]"
           . ")) or "
           . "sum by (status, intx_status) (increase("
           . "http_client_requests_seconds_count{{$sel},uri=\"{$epQ}\",{$errFilter}}[1m]"
           . "))";
        // Absolute range wins when supplied (from SP2's Custom picker) —
        // else default to a relative window ending at now.
        if ($startTime > 0 && $endTime > $startTime) {
            $start = $startTime; $end = $endTime;
            $span = $end - $start;
        } else {
            $end = time();
            $start = $end - $rangeSec;
            $span = $rangeSec;
        }
        // ~60 points regardless of span → step = span/60, min 60s.
        $step = max(60, (int)floor($span / 60));

        try {
            $res = spQueryPromRange($src, ['ts' => $q], $start, $end, $step);
        } catch (Throwable $e) {
            return ['series' => [], 'error' => $e->getMessage()];
        }
        $out = [];
        foreach (($res['ts'] ?? []) as $r) {
            $m = $r['metric'] ?? [];
            $status = trim((string)($m['intx_status'] ?? '')) !== ''
                    ? (string)$m['intx_status']
                    : (string)($m['status'] ?? '');
            if ($status === '') $status = 'CONNECT_ERR';
            $points = [];
            foreach (($r['values'] ?? []) as $pt) {
                $points[] = [(int)$pt[0], (float)$pt[1]];
            }
            $out[] = ['status' => $status, 'points' => $points];
        }
        return ['series' => $out, 'start' => $start, 'end' => $end, 'step' => $step];
    }
}
