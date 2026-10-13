<?php
/**
 * _lib.php — Shared logic for Begin Grafana.
 *
 * Piggybacks on the Service Performance datasource config
 * (service-performance-sources.json) so we can reuse existing Grafana
 * connections. Each source's `jvmDsUid` is the Micrometer datasource that
 * hosts `http_server_requests_seconds_*`, which is what powers the whole
 * endpoint discovery + verdict engine here.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

if (!defined('BG_CACHE_TTL')) {
    define('BG_CACHE_TTL', 30);
}

if (!function_exists('bgLoadSources')) {

    /** Return only sources with a Micrometer (JVM) datasource configured. */
    function bgLoadSources(): array {
        $cfg = spLoadConfig();
        $out = [];
        foreach (($cfg['sources'] ?? []) as $s) {
            if (!empty($s['jvmDsUid'])) $out[] = $s;
        }
        return $out;
    }

    /** The label a JVM source uses to identify the app. `app_name` on k8s
     *  Micrometer sources, `appScope` on ACM's appScope scheme. */
    function bgAppLabel(array $src): string {
        return (($src['labelScheme'] ?? 'k8s') === 'appScope') ? 'appScope' : 'app_name';
    }

    /** Probe each JVM source until one returns a matching http_server_requests
     *  series. Tries both `app_name` (Micrometer default) and `appScope` (ACM)
     *  so we don't silently miss services on the appScope-labelled scrape.
     *  Returns [source, cluster, appLabel, probeInfo[]]. */
    function bgDetectSource(string $service): array {
        $probeInfo = [];
        $chosen = null; $chosenCluster = ''; $chosenLabel = 'app_name';

        // All plausible Micrometer app labels observed across our runways.
        // `application` = older Spring convention; `job` = Prom scrape-config target.
        $LABEL_VARIANTS = ['app_name', 'appScope', 'application', 'job'];

        foreach (bgLoadSources() as $src) {
            $slug = (string)($src['slug'] ?? '');
            $info = ['slug' => $slug, 'name' => $src['name'] ?? '', 'triedLabels' => [], 'seriesReturned' => 0, 'labelsFound' => [], 'error' => null];

            $jvmSrc = $src;
            $jvmSrc['dsUid'] = (string)$src['jvmDsUid'];

            $preferred = bgAppLabel($src);
            // Put preferred first, then the rest of the variants.
            $labels = array_values(array_unique(array_merge([$preferred], $LABEL_VARIANTS)));

            foreach ($labels as $lbl) {
                $q = "count by (cluster) (http_server_requests_seconds_count{{$lbl}=\"{$service}\"})";
                $info['triedLabels'][] = $lbl;
                try {
                    $res = spQueryPromQL($jvmSrc, ['probe' => $q]);
                    $vec = $res['probe'] ?? [];
                    if (!empty($vec)) {
                        $info['seriesReturned'] = count($vec);
                        usort($vec, fn($a, $b) => (float)($b['value'][1] ?? 0) <=> (float)($a['value'][1] ?? 0));
                        $chosen = $src;
                        $chosenLabel = $lbl;
                        $chosenCluster = (string)($vec[0]['metric']['cluster'] ?? '');
                        $probeInfo[] = $info;
                        break 2;
                    }
                } catch (Throwable $e) {
                    $info['error'] = $e->getMessage();
                    break; // Datasource is unreachable — no point trying more labels
                }
            }

            // Diagnostic fallback: no exact-match label found. Ask Prometheus
            // which labels are actually on this metric so we can see whether
            // our label list is incomplete OR the service name doesn't match
            // any label value (e.g. Micrometer records "acm-bay-pp-out" not
            // the "-gateway" suffix). Cheap: one query returning label meta.
            if ($info['seriesReturned'] === 0 && $info['error'] === null) {
                try {
                    // Sample: find ANY series whose *any* label value contains
                    // a piece of the service name. Using label_replace to expose
                    // matching labels would be nice but is expensive; instead we
                    // just count by common labels to see which ones exist.
                    $svcRe = _spPromEscape($service);
                    $diag = spQueryPromQL($jvmSrc, [
                        'app_name'    => "count by (app_name)    (http_server_requests_seconds_count{app_name=~\".*" . $svcRe . ".*\"})",
                        'appScope'    => "count by (appScope)    (http_server_requests_seconds_count{appScope=~\".*" . $svcRe . ".*\"})",
                        'application' => "count by (application) (http_server_requests_seconds_count{application=~\".*" . $svcRe . ".*\"})",
                        'job'         => "count by (job)         (http_server_requests_seconds_count{job=~\".*" . $svcRe . ".*\"})",
                    ]);
                    foreach ($diag as $lbl => $vec) {
                        foreach ($vec as $r) {
                            $v = $r['metric'][$lbl] ?? '';
                            if ($v !== '' && !in_array($lbl . '=' . $v, $info['labelsFound'], true)) {
                                $info['labelsFound'][] = $lbl . '=' . $v;
                                if (count($info['labelsFound']) >= 8) break 2;
                            }
                        }
                    }
                } catch (Throwable $e) { /* keep going */ }
            }

            $probeInfo[] = $info;
        }

        return [$chosen, $chosenCluster, $chosenLabel, $probeInfo];
    }

    /** Return `<label>="X"[,cluster="Y"]` matcher. */
    function bgSelector(string $service, string $cluster = '', string $appLabel = 'app_name'): string {
        $sel = $appLabel . '="' . $service . '"';
        if ($cluster !== '') $sel .= ',cluster="' . $cluster . '"';
        return $sel;
    }

    /** Escape a URI/method literal for inclusion inside a PromQL string
     *  matcher (surrounded by double quotes). Also OK for `=` (exact) match
     *  since PromQL treats these as literals — but sensible to escape
     *  backslash + quote defensively. */
    function bgEscapeLiteral(string $s): string {
        return str_replace(['\\', '"'], ['\\\\', '\\"'], $s);
    }

    /** Verdict rules (see plan). Returns [verdict, reason]. */
    function bgVerdict(float $rps, float $rate4xx, float $rate5xx, ?float $p95Ms, ?float $baselineP95Ms): array {
        if ($rps <= 0.0001) return ['idle', 'no traffic in window'];
        $errRatio = $rps > 0 ? ($rate5xx / $rps) : 0;
        $err4Ratio = $rps > 0 ? ($rate4xx / $rps) : 0;
        $reasons = [];

        // Failing
        if ($errRatio >= 0.02) $reasons[] = sprintf('5xx=%.1f%% ≥ 2%%', $errRatio * 100);
        if ($p95Ms !== null && $baselineP95Ms !== null && $baselineP95Ms > 0 && $p95Ms > $baselineP95Ms * 3) {
            $reasons[] = sprintf('p95=%.0fms > 3× baseline', $p95Ms);
        }
        if ($err4Ratio >= 0.10) $reasons[] = sprintf('4xx=%.1f%% ≥ 10%%', $err4Ratio * 100);
        if (!empty($reasons)) return ['failing', implode(' · ', $reasons)];

        // Degraded
        if ($errRatio >= 0.005) $reasons[] = sprintf('5xx=%.2f%% ≥ 0.5%%', $errRatio * 100);
        if ($p95Ms !== null && $baselineP95Ms !== null && $baselineP95Ms > 0 && $p95Ms > $baselineP95Ms * 1.5) {
            $reasons[] = sprintf('p95=%.0fms > 1.5× baseline', $p95Ms);
        }
        if (!empty($reasons)) return ['degraded', implode(' · ', $reasons)];

        return ['healthy', sprintf('5xx=%.2f%% · %.2f req/s', $errRatio * 100, $rps)];
    }

    /** Build PromQL snippets for one endpoint. Returns [key => query]. */
    function bgPromqlSnippets(string $service, string $cluster, string $method, string $uri, string $appLabel = 'app_name'): array {
        $sel = bgSelector($service, $cluster, $appLabel);
        $ep  = ',method="' . bgEscapeLiteral($method) . '",uri="' . bgEscapeLiteral($uri) . '"';
        $full = $sel . $ep;
        return [
            'rps'             => "sum(rate(http_server_requests_seconds_count{{$full}}[5m]))",
            'rps_by_status'   => "sum by (status) (rate(http_server_requests_seconds_count{{$full}}[5m]))",
            'p50'             => "histogram_quantile(0.50, sum by (le) (rate(http_server_requests_seconds_bucket{{$full}}[5m])))",
            'p95'             => "histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{{$full}}[5m])))",
            'p99'             => "histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket{{$full}}[5m])))",
            'avg_latency_ms'  => "1000 * sum(rate(http_server_requests_seconds_sum{{$full}}[5m])) / sum(rate(http_server_requests_seconds_count{{$full}}[5m]))",
            'max_latency_ms'  => "1000 * max(http_server_requests_seconds_max{{$full}})",
            'error_ratio'     => "sum(rate(http_server_requests_seconds_count{{$full},status=~\"5..\"}[5m])) / sum(rate(http_server_requests_seconds_count{{$full}}[5m]))",
            'success_ratio'   => "sum(rate(http_server_requests_seconds_count{{$full},status=~\"2..\"}[5m])) / sum(rate(http_server_requests_seconds_count{{$full}}[5m]))",
            '4xx_ratio'       => "sum(rate(http_server_requests_seconds_count{{$full},status=~\"4..\"}[5m])) / sum(rate(http_server_requests_seconds_count{{$full}}[5m]))",
        ];
    }

    /** Convert `acm-bay-pp-out-gateway` → `acm_bay_pp_out_gateway`.
     *  Prometheus metric names replace dashes with underscores. */
    function bgMetricPrefix(string $service): string {
        return preg_replace('/[^a-zA-Z0-9_]/', '_', strtolower($service));
    }

    /** Return meaningful tokens of a service name for name-based metric
     *  discovery. Drops generic suffixes so `promptpay-service` → ["promptpay"]
     *  and `acm-bay-pp-out-gateway` → ["acm","bay","pp","out"]. Excludes
     *  tokens shorter than 3 chars to avoid regex explosions. */
    function bgServiceTokens(string $service): array {
        $tokens = preg_split('/[-_.]/', strtolower($service)) ?: [];
        $stop = ['service','gateway','processor','api','server','worker','job','app','manager','handler','client','core','svc'];
        $tokens = array_values(array_filter($tokens, fn($t) => strlen($t) >= 3 && !in_array($t, $stop, true)));
        return $tokens;
    }

    /** Regex fragment (metric-name families to EXCLUDE from custom discovery).
     *  These are Micrometer / JVM / infra families every Java service emits. */
    function bgStandardMetricExcludeRegex(): string {
        return '/^('
            . 'http_server_requests|http_client_requests|http_requests|'
            . 'jvm_|process_|system_|tomcat_|hikaricp_|logback_|log4j_|log4j2_|logging_|'
            . 'jetty_|netty_|undertow_|'
            . 'executor_|jdbc_|spring_|reactor_|resilience4j_|redis_|mongodb_|'
            . 'kafka_|rabbitmq_|cache_|scrape_|up_?$|jib_|cpu_|memory_|disk_|'
            . 'application_ready_time|application_started_time|'
            . 'container_|node_|kubernetes_|kube_|promhttp_|go_|python_|nodejs_'
            . ')/i';
    }

    /** Multi-strategy discovery. Runs each strategy in parallel, unions the
     *  metric names, excludes standard families, then samples labels. Any
     *  strategy that fails silently drops out — we always emit something.
     *
     *  Strategies:
     *   A. Name-tokens: metrics whose name contains any token of the service
     *      AND ends in `_total`. Catches `promptpay_service_transaction_total`,
     *      `acm_bay_pp_out_gateway_bank_code_transaction_total`, etc.
     *   B. Snake-case prefix: `<snake>_*_total`. Catches strict-prefix apps.
     *   C. app_name label: metrics tagged with app_name=<service>. Catches
     *      services that use Spring Boot common-tags (`management.metrics.tags.app_name`).
     *   D. Business status_code sniff: metrics whose name contains a token
     *      AND has status_code label. Catches counters that use `count` suffix
     *      instead of `total` (rare but seen). */
    function bgDiscoverCustomMetrics(array $src, string $service, string $appLabel = 'app_name', string $cluster = ''): array {
        $exclude = bgStandardMetricExcludeRegex();
        $tokens  = bgServiceTokens($service);
        $snake   = bgMetricPrefix($service);
        $appSel  = $appLabel . '="' . $service . '"' . ($cluster !== '' ? ',cluster="' . $cluster . '"' : '');
        $names   = [];

        // Strategy A: name-token regex (union of tokens)
        if (!empty($tokens)) {
            $union = implode('|', array_map(fn($t) => preg_quote($t, '/'), $tokens));
            try {
                $r = spQueryPromQL($src, [
                    'n' => 'count by (__name__) ({__name__=~".*(' . $union . ').*_total"})',
                ]);
                foreach (($r['n'] ?? []) as $x) {
                    $n = (string)($x['metric']['__name__'] ?? '');
                    if ($n !== '') $names[$n] = true;
                }
            } catch (Throwable $e) {}
        }
        // Strategy B: snake_case prefix
        try {
            $r = spQueryPromQL($src, [
                'n' => 'count by (__name__) ({__name__=~"' . $snake . '_.*_total"})',
            ]);
            foreach (($r['n'] ?? []) as $x) {
                $n = (string)($x['metric']['__name__'] ?? '');
                if ($n !== '') $names[$n] = true;
            }
        } catch (Throwable $e) {}
        // Strategy C: app_name label
        try {
            $r = spQueryPromQL($src, [
                'n' => 'count by (__name__) ({' . $appSel . ',__name__=~".*_total"})',
            ]);
            foreach (($r['n'] ?? []) as $x) {
                $n = (string)($x['metric']['__name__'] ?? '');
                if ($n !== '') $names[$n] = true;
            }
        } catch (Throwable $e) {}
        // Strategy D: pod-label — most reliable. Every business counter
        // scraped from this workload's pods is tagged with `pod=<name>-<hash>`.
        // We match the pod prefix so all replicas + rollout revisions are
        // covered, then Prom aggregates by metric name for us.
        try {
            $svcRe = _spPromEscape($service);
            $r = spQueryPromQL($src, [
                'n' => 'count by (__name__) ({pod=~"' . $svcRe . '(-[a-z0-9]+)*",__name__=~".*_total"})',
            ]);
            foreach (($r['n'] ?? []) as $x) {
                $n = (string)($x['metric']['__name__'] ?? '');
                if ($n !== '') $names[$n] = true;
            }
        } catch (Throwable $e) {}
        // Strategy E: kubernetes_pod_name label (some Prom operators use this
        // instead of the standard `pod` label, particularly older kube-prom
        // stacks federated from a differently-configured source).
        try {
            $svcRe = _spPromEscape($service);
            $r = spQueryPromQL($src, [
                'n' => 'count by (__name__) ({kubernetes_pod_name=~"' . $svcRe . '(-[a-z0-9]+)*",__name__=~".*_total"})',
            ]);
            foreach (($r['n'] ?? []) as $x) {
                $n = (string)($x['metric']['__name__'] ?? '');
                if ($n !== '') $names[$n] = true;
            }
        } catch (Throwable $e) {}

        // Filter + sort
        $filtered = [];
        foreach (array_keys($names) as $n) {
            if (preg_match($exclude, $n)) continue;
            $filtered[] = $n;
        }
        sort($filtered);
        // Cap to avoid huge responses on very chatty apps
        $filtered = array_slice($filtered, 0, 30);

        // Pod-scoped selector — safer than app_name because most business
        // counters carry `pod` (added by Prom scrape config) but not app_name.
        $svcRe = _spPromEscape($service);
        $podSel = 'pod=~"' . $svcRe . '(-[a-z0-9]+)*"';
        if ($cluster !== '') $podSel .= ',cluster="' . $cluster . '"';

        // Sample labels per metric to learn its dimensions.
        $out = [];
        foreach ($filtered as $n) {
            $sampleLabels = [];
            $hasService = false; $hasStatusCode = false;
            // Determine narrowing selector — prefer app_name if the metric
            // carries it (cheap + specific); else pod-scoped; else nothing.
            $narrow = '';
            try {
                $rr = spQueryPromQL($src, [
                    'app'  => 'count(' . $n . '{' . $appSel . '}) or vector(0)',
                    'pod'  => 'count(' . $n . '{' . $podSel . '}) or vector(0)',
                    's'    => 'count by (service, status_code) (' . $n . ')',
                ]);
                $appCnt = 0.0; $podCnt = 0.0;
                foreach (($rr['app'] ?? []) as $x) $appCnt = max($appCnt, (float)($x['value'][1] ?? 0));
                foreach (($rr['pod'] ?? []) as $x) $podCnt = max($podCnt, (float)($x['value'][1] ?? 0));
                $narrow = $appCnt > 0 ? $appSel : ($podCnt > 0 ? $podSel : '');
                foreach (($rr['s'] ?? []) as $r) {
                    $svc  = (string)($r['metric']['service']     ?? '');
                    $stat = (string)($r['metric']['status_code'] ?? '');
                    if ($svc  !== '') $hasService = true;
                    if ($stat !== '') $hasStatusCode = true;
                    $sampleLabels[] = ['service' => $svc, 'status_code' => $stat];
                    if (count($sampleLabels) >= 30) break;
                }
            } catch (Throwable $e) {}
            $out[] = [
                'name'          => $n,
                'hasService'    => $hasService,
                'hasStatusCode' => $hasStatusCode,
                'narrowSel'     => $narrow,   // per-metric selector (empty when unscoped)
                'sampleLabels'  => $sampleLabels,
            ];
        }
        return $out;
    }

    /** Build the two "success / fail" PromQL queries in the panel style
     *  the user pointed at:
     *    sum(increase(<metric>{status_code=~"200.*"}[1m])) by (service, status_code)
     *    sum(increase(<metric>{status_code!~"200.*"}[1m])) by (service, status_code)
     *  Also emit a total rate query and a "top-N services by errors" helper. */
    function bgCustomQueries(string $metric, bool $hasService, bool $hasStatusCode, string $baseSel = ''): array {
        $groupBy = [];
        if ($hasService)    $groupBy[] = 'service';
        if ($hasStatusCode) $groupBy[] = 'status_code';
        $groupClause = !empty($groupBy) ? (' by (' . implode(', ', $groupBy) . ')') : '';
        // Compose label matchers. `$baseSel` narrows to this specific app so
        // multi-tenant Thanos setups don't mix metrics from other services
        // that happen to share the same generic metric name.
        $withStatus = function(string $extra) use ($metric, $baseSel): string {
            $sel = $baseSel;
            if ($extra !== '') $sel = $sel === '' ? $extra : $sel . ',' . $extra;
            return $sel === '' ? $metric : ($metric . '{' . $sel . '}');
        };
        $out = [];
        if ($hasStatusCode) {
            $out['success']       = 'sum(increase(' . $withStatus('status_code=~"200.*"') . '[1m]))' . $groupClause;
            $out['fail']          = 'sum(increase(' . $withStatus('status_code!~"200.*"') . '[1m]))' . $groupClause;
            $out['fail_rate_1m']  = 'sum(rate('     . $withStatus('status_code!~"200.*"') . '[1m]))' . $groupClause;
        }
        $out['total_1m']  = 'sum(increase(' . $withStatus('') . '[1m]))' . $groupClause;
        $out['rate_5m']   = 'sum(rate('    . $withStatus('') . '[5m]))' . $groupClause;
        return $out;
    }

    /** Cache path for begin-grafana. */
    function bgCachePath(string $key): string {
        $safe = preg_replace('/[^a-z0-9._-]+/i', '_', $key);
        return teamDataPath('begin-grafana/cache/' . $safe . '.json');
    }
    function bgReadCache(string $key, int $ttl): ?array {
        $p = bgCachePath($key);
        if (!file_exists($p)) return null;
        $age = time() - (int)filemtime($p);
        if ($age > $ttl) return null;
        $d = json_decode((string)file_get_contents($p), true);
        if (!is_array($d)) return null;
        $d['_cacheAgeSeconds'] = $age;
        $d['fromCache'] = true;
        return $d;
    }
    function bgWriteCache(string $key, array $payload): void {
        $p = bgCachePath($key);
        $d = dirname($p);
        if (!is_dir($d)) @mkdir($d, 0775, true);
        $tmp = $p . '.tmp.' . bin2hex(random_bytes(4));
        if (@file_put_contents($tmp, json_encode($payload)) !== false) @rename($tmp, $p);
    }
}
