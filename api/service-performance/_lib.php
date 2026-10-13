<?php
/**
 * _lib.php — Shared logic for the Service Performance dashboard.
 *
 * Query strategy (per-runway):
 *   labelScheme = 'k8s'      → kube-state-metrics + cadvisor (TMN / NANO Thanos)
 *                              groups by (namespace, deployment); pods derived from
 *                              kube_pod_owner ownership chain, but for simplicity
 *                              we group by the deployment label emitted by cadvisor
 *                              via workload_type=Deployment. When workload label is
 *                              missing we fall back to grouping pods by name prefix.
 *   labelScheme = 'appScope' → application exporters that expose up{env_name,appScope}
 *                              (ACM org=3). Pods derived from count(up{}), and CPU/MEM
 *                              queried with the same scope filter.
 *
 * Auth: mirrors api/grafana-alerts/_fetch.php — 'basic' uses GRAFANA_BASIC_USER/PASS
 * from .env (cross-org master credential), 'token' uses per-source bearer.
 *
 * Cache: 60s TTL per runway under data/sm/service-performance/cache/{slug}.json.
 * Cache file is SM-shared (see smSharedFiles()), so refreshing from one team
 * benefits every team's dashboard.
 */

if (!defined('SP_CONFIG_FILE')) {
    define('SP_CONFIG_FILE', 'service-performance-sources.json');
    define('SP_DEFAULT_TTL', 60);
    define('SP_QUERY_TIMEOUT', 25);
}

if (!function_exists('spLoadConfig')) {

    function spLoadConfig(): array {
        $cfg = readJson(SP_CONFIG_FILE);
        if (!isset($cfg['sources']) || !is_array($cfg['sources'])) $cfg['sources'] = [];
        $cfg['cacheTtlSeconds']         = (int)($cfg['cacheTtlSeconds'] ?? SP_DEFAULT_TTL);
        $cfg['sheetEmbedUrl']           = (string)($cfg['sheetEmbedUrl']  ?? '');
        $cfg['sheetOpenUrl']            = (string)($cfg['sheetOpenUrl']   ?? '');
        $cfg['serviceInventoryCsvPath'] = (string)($cfg['serviceInventoryCsvPath'] ?? '');
        return $cfg;
    }

    /**
     * Parse the Service Inventory CSV into a lookup keyed by lowercase service name.
     * Value contains the useful columns (BU, team, runway, severity) so the UI can
     * enrich each row. Returns [] when the CSV isn't configured or unreadable.
     *
     * Cached in a static across the request lifetime.
     */
    function spLoadServiceInventory(): array {
        static $cached = null;
        if ($cached !== null) return $cached;

        $cfg  = spLoadConfig();
        $path = $cfg['serviceInventoryCsvPath'] ?? '';
        if ($path === '') return $cached = [];

        // Resolve relative paths against project root (parent of /api/).
        if ($path[0] !== '/') $path = dirname(__DIR__, 2) . '/' . $path;
        if (!is_readable($path)) {
            error_log("[service-performance] serviceInventoryCsvPath not readable: {$path}");
            return $cached = [];
        }

        $fh = fopen($path, 'r');
        if (!$fh) return $cached = [];
        $header = fgetcsv($fh, 0, ',', '"', '');
        if (!$header) { fclose($fh); return $cached = []; }
        // Case-insensitive header lookup so a re-export with different casing
        // (e.g. "service name" vs "Service name") still works.
        $col = [];
        foreach ($header as $i => $h) $col[strtolower(trim($h))] = $i;
        $iName = $col['service name'] ?? null;
        if ($iName === null) { fclose($fh); return $cached = []; }

        // Every column we surface in the detail view. Keys are the canonical
        // field name in the API response; values are the (lowercased) CSV header.
        $map = [
            'bu'                    => 'bu',
            'runway'                => 'runway',
            'appLanguage'           => 'app language',
            'serviceGroup'          => 'service group',
            'team'                  => 'team owner',
            'routeZone'             => 'route zone',
            'contextPath'           => 'context path',
            'arch'                  => 'arch',
            'appPort'               => 'app port',
            'timezone'              => 'timezone',
            'cpuLimit'              => 'cpu limit',
            'cpuRequest'            => 'cpu request',
            'appStartupArgs'        => 'app startup args',
            'pipelineVersion'       => 'pipeline version',
            'sonarqube'             => 'sonarqube',
            'appWorkloadType'       => 'app workload type',
            'middlewareImage'       => 'middleware image',
            'springNativeEnable'    => 'springnative enable',
            'replicasProd'          => 'replicas (prod)',
            'cloudflareProxyEnable' => 'cloudflare proxy enable',
            'urlProduction'         => 'url production',
            'testerTool'            => 'tester tool',
            'severity'              => 'severity level',
            'datadogEnable'         => 'datadog enable',
            'gitRepoUrl'            => 'application git repo url',
        ];

        $out = [];
        while (($row = fgetcsv($fh, 0, ',', '"', '')) !== false) {
            $name = trim((string)($row[$iName] ?? ''));
            if ($name === '') continue;
            $entry = ['service' => $name];
            foreach ($map as $outKey => $csvKey) {
                $idx = $col[$csvKey] ?? null;
                $entry[$outKey] = $idx !== null ? trim((string)($row[$idx] ?? '')) : '';
            }
            $out[strtolower($name)] = $entry;
        }
        fclose($fh);
        return $cached = $out;
    }

    /** File-modification info for the current Service Inventory CSV. Powers the
     *  admin "last updated" banner and detail-view "data as of" line. */
    function spInventoryMeta(): array {
        $cfg  = spLoadConfig();
        $path = (string)($cfg['serviceInventoryCsvPath'] ?? '');
        if ($path !== '' && $path[0] !== '/') $path = dirname(__DIR__, 2) . '/' . $path;
        $exists = $path !== '' && file_exists($path);
        return [
            'path'      => $path,
            'exists'    => $exists,
            'readable'  => $exists && is_readable($path),
            'writable'  => $exists && is_writable($path),
            'sizeBytes' => $exists ? (int)filesize($path) : 0,
            'mtime'     => $exists ? date('c', (int)filemtime($path)) : null,
            'entries'   => count(spLoadServiceInventory()),
        ];
    }

    /** Auth header for a source. Empty string when creds are missing. */
    function spAuthHeader(array $src): string {
        if (($src['authMode'] ?? 'basic') === 'token') {
            $t = trim((string)($src['token'] ?? ''));
            return $t !== '' ? 'Authorization: Bearer ' . $t : '';
        }
        $u = envFallback('GRAFANA_BASIC_USER');
        $p = envFallback('GRAFANA_BASIC_PASS');
        if ($u === '' || $p === '') return '';
        return 'Authorization: Basic ' . base64_encode($u . ':' . $p);
    }

    /** Cache path for a runway slug. Uses SM-shared cache dir. */
    function spCachePath(string $slug): string {
        return teamDataPath('service-performance/cache/' . $slug . '.json');
    }

    /** Read a cached snapshot if fresh; returns null when stale/missing. */
    function spReadCache(string $slug, int $ttlSeconds): ?array {
        $path = spCachePath($slug);
        if (!file_exists($path)) return null;
        $age = time() - (int)filemtime($path);
        if ($age > $ttlSeconds) return null;
        $d = json_decode((string)file_get_contents($path), true);
        if (!is_array($d)) return null;
        $d['_cacheAgeSeconds'] = $age;
        return $d;
    }

    /** Atomic cache write. */
    function spWriteCache(string $slug, array $snapshot): bool {
        $path = spCachePath($slug);
        $dir  = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $tmp = $path . '.tmp.' . bin2hex(random_bytes(4));
        $json = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (@file_put_contents($tmp, $json) === false) return false;
        if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
        return true;
    }

    /**
     * Run several PromQL instant queries in parallel via Grafana's datasource
     * proxy. Returns [key => resultArray] preserving caller-supplied keys.
     */
    function spQueryPromQL(array $src, array $queries, int $evalTime = 0): array {
        $auth = spAuthHeader($src);
        if ($auth === '') {
            throw new RuntimeException(($src['authMode'] ?? 'basic') === 'token'
                ? 'No token set for source ' . ($src['name'] ?? '')
                : 'GRAFANA_BASIC_USER / GRAFANA_BASIC_PASS not set in .env');
        }
        $url    = rtrim((string)($src['grafanaUrl'] ?? ''), '/');
        $dsUid  = (string)($src['dsUid'] ?? '');
        $orgId  = (int)($src['orgId'] ?? 0);
        if ($url === '' || $dsUid === '') {
            throw new RuntimeException('grafanaUrl / dsUid required for source ' . ($src['name'] ?? ''));
        }
        $endpoint = $url . '/api/datasources/proxy/uid/' . rawurlencode($dsUid) . '/api/v1/query';
        // `evalTime` (unix seconds) lets callers evaluate range-vectors at a
        // point IN THE PAST — needed when investigating an incident window
        // that ended hours/days ago. 0 = now (default, back-compat).
        $ts = $evalTime > 0 ? $evalTime : time();

        $mh = curl_multi_init();
        $handles = [];
        foreach ($queries as $key => $q) {
            $ch = curl_init($endpoint);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => http_build_query(['query' => $q, 'time' => $ts]),
                CURLOPT_HTTPHEADER     => [
                    $auth,
                    'X-Grafana-Org-Id: ' . $orgId,
                    'Content-Type: application/x-www-form-urlencoded',
                    'Accept: application/json',
                ],
                CURLOPT_TIMEOUT        => SP_QUERY_TIMEOUT,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            $handles[$key] = $ch;
            curl_multi_add_handle($mh, $ch);
        }

        $running = null;
        do {
            curl_multi_exec($mh, $running);
            if ($running > 0) curl_multi_select($mh, 1.0);
        } while ($running > 0);

        $out = [];
        foreach ($handles as $key => $ch) {
            $body = curl_multi_getcontent($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err  = curl_error($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);

            if ($err !== '' || $code !== 200) {
                if (function_exists('logIntegrationError')) {
                    logIntegrationError('service-performance', $endpoint, $err ?: "HTTP {$code}", [
                        'org' => $orgId, 'query_key' => $key, 'body_start' => substr((string)$body, 0, 200),
                    ]);
                }
                $out[$key] = [];
                continue;
            }
            $decoded = json_decode((string)$body, true);
            $out[$key] = (is_array($decoded) && ($decoded['status'] ?? '') === 'success')
                ? ($decoded['data']['result'] ?? []) : [];
        }
        curl_multi_close($mh);
        return $out;
    }

    /**
     * Run PromQL `query_range` in parallel (for time-series). Same auth + URL
     * shape as spQueryPromQL() but hits /api/v1/query_range with start/end/step.
     * Returns [key => matrixResult] where matrixResult is Prometheus's raw shape:
     *   [{ metric: {...labels}, values: [[unixTs, "value"], ...] }, ...]
     */
    function spQueryPromRange(array $src, array $queries, int $start, int $end, int $step): array {
        $auth = spAuthHeader($src);
        if ($auth === '') throw new RuntimeException('Grafana auth not configured');
        $url    = rtrim((string)($src['grafanaUrl'] ?? ''), '/');
        $dsUid  = (string)($src['dsUid'] ?? '');
        $orgId  = (int)($src['orgId'] ?? 0);
        if ($url === '' || $dsUid === '') throw new RuntimeException('grafanaUrl / dsUid required');
        $endpoint = $url . '/api/datasources/proxy/uid/' . rawurlencode($dsUid) . '/api/v1/query_range';

        $mh = curl_multi_init();
        $handles = [];
        foreach ($queries as $key => $q) {
            $ch = curl_init($endpoint);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => http_build_query([
                    'query' => $q, 'start' => $start, 'end' => $end, 'step' => $step,
                ]),
                CURLOPT_HTTPHEADER     => [
                    $auth,
                    'X-Grafana-Org-Id: ' . $orgId,
                    'Content-Type: application/x-www-form-urlencoded',
                    'Accept: application/json',
                ],
                CURLOPT_TIMEOUT        => SP_QUERY_TIMEOUT,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            $handles[$key] = $ch;
            curl_multi_add_handle($mh, $ch);
        }
        $running = null;
        do { curl_multi_exec($mh, $running); if ($running > 0) curl_multi_select($mh, 1.0); } while ($running > 0);

        $out = [];
        foreach ($handles as $key => $ch) {
            $body = curl_multi_getcontent($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_multi_remove_handle($mh, $ch); curl_close($ch);
            if ($code !== 200) { $out[$key] = []; continue; }
            $d = json_decode((string)$body, true);
            $out[$key] = (is_array($d) && ($d['status'] ?? '') === 'success')
                ? ($d['data']['result'] ?? []) : [];
        }
        curl_multi_close($mh);
        return $out;
    }

    // ── PromQL builders (k8s / appScope) ─────────────────────────────────────

    /** k8s scheme queries — same shape as restart-monitor/fetch.php (which is
     *  known to work on TMN/NANO Thanos): group by (namespace, pod). Workload
     *  aggregation happens PHP-side in _spStripPodHash() since we don't rely on
     *  any recording rule being provisioned. */
    function _spQueriesK8s(array $src): array {
        $cluster = (string)($src['cluster'] ?? '');
        $ns      = (string)($src['namespaceRegex']   ?? '.+');
        $nsEx    = (string)($src['namespaceExclude'] ?? '');
        $podEx   = (string)($src['podExclude']       ?? '');

        // `cluster` is treated as a PromQL regex so a single source can cover
        // multiple clusters (e.g. OCP has a-th2p + b-th1p on the same Thanos).
        // Single-cluster values like "acm-tmn-eks-prod" still match themselves.
        $parts = [];
        if ($cluster !== '') $parts[] = "cluster=~\"{$cluster}\"";
        $parts[] = "namespace=~\"{$ns}\"";
        if ($nsEx  !== '') $parts[] = "namespace!~\"{$nsEx}\"";
        if ($podEx !== '') $parts[] = "pod!~\"{$podEx}\"";
        $sel = implode(',', $parts);

        return [
            // Alive pods (kube_pod_info emits one series per running pod).
            'pods'     => "kube_pod_info{{$sel}}",
            // CPU cores used per pod (5m rate summed across containers).
            'cpuUsed'  => "sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{{$sel},container!=\"\",container!=\"POD\"}[5m]))",
            'cpuLimit' => "sum by (namespace, pod) (kube_pod_container_resource_limits{{$sel},resource=\"cpu\",container!=\"\"})",
            'memUsed'  => "sum by (namespace, pod) (container_memory_working_set_bytes{{$sel},container!=\"\",container!=\"POD\"})",
            'memLimit' => "sum by (namespace, pod) (kube_pod_container_resource_limits{{$sel},resource=\"memory\",container!=\"\"})",
        ];
    }

    /** Strip common Kubernetes pod-name suffixes to derive the workload name.
     *  Applied iteratively so multi-layer names (Job spawned by CronJob spawned
     *  by an external scheduler) collapse to the root workload in one pass.
     *
     *  Patterns handled (checked most-specific first):
     *   • Deployment           <workload>-<rs 5-11 alnum>-<pod 5 alnum>
     *   • CronJob→Job (typical)<workload>-<epoch 8-13 digits>-<counter 1-6 digits>
     *   • CronJob→Job (single) <workload>-<epoch 8-13 digits>
     *   • DaemonSet            <workload>-<5 alnum>
     *   • StatefulSet          <workload>-<ordinal 1-5 digits>
     *
     *  Deployment RS-hash width is 5-11 chars — Kubernetes uses the FNV/base36
     *  encoded pod-template-hash which trims leading zeros, so real hashes
     *  observed range from 5 chars (rare, short hashes) up to 11 chars. Was
     *  originally `{8,10}` but that missed 7-char cases like `seven-custom-
     *  in-gateway-748c5b6-vclsq` → the pod fell through to the DaemonSet
     *  pattern and got stripped to `seven-custom-in-gateway-748c5b6` (wrong).
     */
    function _spStripPodHash(string $pod): string {
        // Multi-pass strip so `<name>-<epoch>-<counter>-<random>` fully collapses.
        // Bounded at 4 iterations — no legitimate k8s naming stacks that deep.
        for ($i = 0; $i < 4; $i++) {
            $orig = $pod;
            // Deployment RS-hash + pod-hash (both lowercase alnum).
            if (preg_match('/^(.+)-[a-z0-9]{5,11}-[a-z0-9]{5}$/', $pod, $m)) { $pod = $m[1]; continue; }
            // CronJob's Job pod: <workload>-<epoch 8-13 digits>-<hash/counter 1-6 digits>
            // e.g. ac-nfc-file-load-process-job-1784797230-1104 → ac-nfc-file-load-process-job
            if (preg_match('/^(.+)-\d{8,13}-\d{1,6}$/', $pod, $m)) { $pod = $m[1]; continue; }
            // Job without inner counter: <workload>-<epoch>
            if (preg_match('/^(.+)-\d{8,13}$/', $pod, $m)) { $pod = $m[1]; continue; }
            // DaemonSet: <workload>-<5 lowercase alnum>
            if (preg_match('/^(.+)-[a-z0-9]{5}$/', $pod, $m)) { $pod = $m[1]; continue; }
            // StatefulSet ordinal: <workload>-<0..99999>
            if (preg_match('/^(.+)-\d{1,5}$/', $pod, $m)) { $pod = $m[1]; continue; }
            if ($pod === $orig) break;   // no rule matched → stable
        }
        return $pod;
    }

    /** Escape a literal string for safe embedding in a PromQL regex selector.
     *  DELIBERATELY does not escape '-' — RE2 treats `-` as literal outside a
     *  character class, and some Prometheus/Thanos versions reject the `\-`
     *  sequence produced by PHP's preg_quote() → query silently returns []. */
    function _spPromEscape(string $s): string {
        return preg_replace('/([.\\\\+*?\[\]()|^$])/', '\\\\$1', $s);
    }

    /** Classify a downstream call by its transport based on target hostname
     *  and/or URI path. Used by the dependency graph to render one edge per
     *  protocol (redis / mongo / rabbitmq / kafka / sql / http) instead of
     *  a single generic "http" arrow.
     *
     *  Signals we look at, in priority order:
     *    • infra service names in the DNS host (`redis.`, `mongo.`, `rabbit`,
     *      `kafka.`, `mysql.`, `postgres.`, `oracle.`)
     *    • well-known port suffixes (`:6379`, `:27017`, `:5672`, `:9092`, …)
     *  Falls through to `http` since our source metric is HTTP-client-shaped. */
    function _spClassifyProtocol(string $host, string $path = ''): string {
        $h = strtolower(trim($host));
        if ($h === '') return 'http';
        // Port-based (unambiguous when present)
        if (preg_match('/:(6379|6380)(?:$|\/)/', $h)) return 'redis';
        if (strpos($h, ':27017') !== false)           return 'mongo';
        if (strpos($h, ':5672')  !== false || strpos($h, ':5671') !== false) return 'rabbitmq';
        if (strpos($h, ':9092')  !== false || strpos($h, ':9093') !== false) return 'kafka';
        if (strpos($h, ':3306')  !== false)           return 'mysql';
        if (strpos($h, ':5432')  !== false)           return 'postgres';
        if (strpos($h, ':1521')  !== false)           return 'oracle';
        // Substring-based (Micrometer sometimes drops the port)
        if (preg_match('/(^|[.\-])redis([.\-]|$)/', $h))                     return 'redis';
        if (preg_match('/(^|[.\-])(mongo|mongodb)([.\-]|$)/', $h))           return 'mongo';
        if (preg_match('/(^|[.\-])(rabbit(mq)?|amqp)([.\-]|$)/', $h))        return 'rabbitmq';
        if (preg_match('/(^|[.\-])kafka([.\-]|$)/', $h))                     return 'kafka';
        if (preg_match('/(^|[.\-])(mysql|mariadb)([.\-]|$)/', $h))           return 'mysql';
        if (preg_match('/(^|[.\-])(postgres|postgresql|pg)([.\-]|$)/', $h))  return 'postgres';
        if (preg_match('/(^|[.\-])oracle([.\-]|$)/', $h))                    return 'oracle';
        // Elasticsearch / OpenSearch — the standard HTTP APIs still ride 9200,
        // but naming is more reliable than port here.
        if (preg_match('/(^|[.\-])(elastic(search)?|opensearch|es)([.\-]|$)/', $h)) return 'search';
        return 'http';
    }

    /** Extract a friendly "service name" from a client_name FQDN. Micrometer
     *  records the hostname it resolved to; we want a human-readable label:
     *    "acm-authorization-server.private-a-cloud1p.ascendmoney.io"
     *        → "acm-authorization-server"
     *    "cache-mas.truemoney.com" → "cache-mas"
     *  Also strips any URI scheme + port so `https://svc.foo:8443/bar` cleanly
     *  becomes `svc`.
     */
    function _spHostToService(string $host): string {
        $h = trim($host);
        if ($h === '') return '';
        // Drop scheme + trailing path/query
        $h = preg_replace('#^[a-z]+://#i', '', $h);
        $h = preg_split('#[/?]#', $h, 2)[0];
        // Drop port
        if (($p = strpos($h, ':')) !== false) $h = substr($h, 0, $p);
        // Take the leftmost DNS label — usually the service name.
        $first = explode('.', $h)[0];
        return $first !== '' ? strtolower($first) : $h;
    }

    /** Build PromQL queries scoped to ONE workload (namespace + service prefix).
     *  Used by pods.php + detail.php for narrow-scope Grafana calls.
     *  The pod filter uses `<service>.*` (broad) — we then filter PHP-side by
     *  `_spStripPodHash(pod) === $service`, which correctly excludes sibling
     *  workloads that happen to share a common prefix (e.g. `promptpay-service`
     *  vs `promptpay-service-runner`).
     *
     *  `$overrideCluster` (optional) forces `cluster="<name>"` exact match,
     *  bypassing the source's regex. Used when a source covers multiple clusters
     *  (e.g. OCP TH `a-th2p|b-th1p`) and the caller wants to pin the query to
     *  ONE cluster to avoid summing pod counts across clusters. */
    function _spQueriesK8sForWorkload(array $src, string $namespace, string $service, string $overrideCluster = ''): array {
        $cluster = (string)($src['cluster'] ?? '');
        $parts = [];
        if ($overrideCluster !== '') {
            $parts[] = "cluster=\"{$overrideCluster}\"";
        } elseif ($cluster !== '') {
            // Same regex-cluster rationale as _spQueriesK8s: single source may cover many clusters.
            $parts[] = "cluster=~\"{$cluster}\"";
        }
        $parts[] = "namespace=\"{$namespace}\"";
        $svcRe = _spPromEscape($service);
        $parts[] = "pod=~\"{$svcRe}.*\"";
        $sel = implode(',', $parts);

        // Container filter — matches Grafana convention on this dashboard:
        // `container="<service>"` targets ONLY the main app container (k8s
        // naming: container name = service name). Excludes sidecars (istio-
        // proxy) AND the pod-level cgroup rollup that container="" carries.
        //
        // NOTE: Grafana's `sum by (pod)(rate(...))/2` divides by 2 because
        // *without* a container filter you sum the main-container series AND
        // the pod-aggregate series (2× the real value). With `container="X"`
        // filter we get exactly one series per pod, so no /2 needed.
        // `avg by (namespace, pod)` gives correct values whether or not the
        // Thanos happens to duplicate series (safe under HA federation too).
        $containerSel = "container=\"{$service}\"";
        return [
            'pods'       => "kube_pod_info{{$sel}}",
            // Rate window [10m] — OCP Thanos scrape has heavy jitter (~2-3min
            // between samples), so [5m] gives partial coverage: for 14 pods we
            // may only get rate data for 5 of them, which then messes up the
            // PHP-side avg calculation (sum of 5 values ÷ 14 pod count → 3×
            // underestimate). [10m] guarantees ≥2 samples for EVERY pod. Cost
            // is a bit more smoothing on spikes — acceptable for a summary.
            'cpuUsed'    => "avg by (namespace, pod) (rate(container_cpu_usage_seconds_total{{$sel},{$containerSel}}[10m]))",
            'cpuLimit'   => "avg by (namespace, pod) (kube_pod_container_resource_limits{{$sel},{$containerSel},resource=\"cpu\"})",
            'cpuRequest' => "avg by (namespace, pod) (kube_pod_container_resource_requests{{$sel},{$containerSel},resource=\"cpu\"})",
            'memUsed'    => "avg by (namespace, pod) (container_memory_working_set_bytes{{$sel},{$containerSel}})",
            'memLimit'   => "avg by (namespace, pod) (kube_pod_container_resource_limits{{$sel},{$containerSel},resource=\"memory\"})",
            'memRequest' => "avg by (namespace, pod) (kube_pod_container_resource_requests{{$sel},{$containerSel},resource=\"memory\"})",
        ];
    }

    /** Fetch per-pod detail for one k8s workload. Returns an array of pods with
     *  their individual CPU/MEM. Filtered PHP-side to only pods whose stripped
     *  name matches $service exactly. */
    function spFetchWorkloadPods(array $src, string $namespace, string $service): array {
        if (($src['labelScheme'] ?? 'k8s') !== 'k8s') {
            // appScope scheme doesn't have a pod concept — return empty.
            return ['pods' => [], 'error' => null];
        }
        try {
            $queries = _spQueriesK8sForWorkload($src, $namespace, $service);
            $res = spQueryPromQL($src, $queries);
        } catch (Throwable $e) {
            return ['pods' => [], 'error' => $e->getMessage()];
        }

        // Collect per-pod values keyed by pod name.
        $rows = [];
        $ingest = function(array $vec, string $bucket) use (&$rows, $service) {
            foreach ($vec as $r) {
                $m  = $r['metric'] ?? [];
                $pd = (string)($m['pod'] ?? '');
                if ($pd === '' || _spStripPodHash($pd) !== $service) continue;
                if (!isset($rows[$pd])) {
                    $rows[$pd] = ['pod' => $pd, 'cpuUsed'=>0, 'cpuLimit'=>0, 'memUsed'=>0, 'memLimit'=>0];
                }
                $rows[$pd][$bucket] = (float)($r['value'][1] ?? 0);
            }
        };
        // kube_pod_info: just make sure every alive pod has an entry (no numeric value to add).
        foreach ($res['pods'] ?? [] as $r) {
            $m  = $r['metric'] ?? [];
            $pd = (string)($m['pod'] ?? '');
            if ($pd === '' || _spStripPodHash($pd) !== $service) continue;
            if (!isset($rows[$pd])) {
                $rows[$pd] = ['pod' => $pd, 'cpuUsed'=>0, 'cpuLimit'=>0, 'memUsed'=>0, 'memLimit'=>0];
            }
        }
        $ingest($res['cpuUsed']  ?? [], 'cpuUsed');
        $ingest($res['cpuLimit'] ?? [], 'cpuLimit');
        $ingest($res['memUsed']  ?? [], 'memUsed');
        $ingest($res['memLimit'] ?? [], 'memLimit');

        $out = [];
        foreach ($rows as $r) {
            $cpuPct = ($r['cpuLimit'] > 0) ? round(($r['cpuUsed'] / $r['cpuLimit']) * 100, 1) : null;
            $memPct = ($r['memLimit'] > 0) ? round(($r['memUsed'] / $r['memLimit']) * 100, 1) : null;
            $out[] = [
                'pod'           => $r['pod'],
                'cpuCores'      => round($r['cpuUsed'],  4),
                'cpuLimitCores' => round($r['cpuLimit'], 4),
                'cpuPct'        => $cpuPct,
                'memBytes'      => (int)round($r['memUsed']),
                'memLimitBytes' => (int)round($r['memLimit']),
                'memPct'        => $memPct,
            ];
        }
        usort($out, fn($a, $b) => strnatcasecmp($a['pod'], $b['pod']));
        return ['pods' => $out, 'error' => null];
    }

    /** appScope scheme (ACM). up{env_name,appScope} gives service list; CPU/MEM
     *  we assume standard cadvisor-ish metrics scoped by appScope label. If the
     *  actual dashboard uses different metric names we can override per-source
     *  once we inspect the panel definitions. */
    function _spQueriesAppScope(array $src): array {
        $env   = (string)($src['envName']  ?? 'prod');
        $scope = (string)($src['appScope'] ?? '.+');
        $sel   = "env_name=\"{$env}\",appScope=~\"{$scope}\"";

        return [
            // Live instances/pods reporting `up` (== 1)
            'pods'     => "count by (appScope) (up{{$sel}} == 1)",
            'cpuUsed'  => "sum by (appScope) (rate(container_cpu_usage_seconds_total{{$sel},container!=\"\",container!=\"POD\"}[5m]))",
            'cpuLimit' => "sum by (appScope) (kube_pod_container_resource_limits{{$sel},resource=\"cpu\",container!=\"\"})",
            'memUsed'  => "sum by (appScope) (container_memory_working_set_bytes{{$sel},container!=\"\",container!=\"POD\"})",
            'memLimit' => "sum by (appScope) (kube_pod_container_resource_limits{{$sel},resource=\"memory\",container!=\"\"})",
        ];
    }

    /** Turn a Prometheus vector result into [key => firstValue] using a caller
     *  supplied key-builder that reads labels from `$m['metric']`. */
    function _spVecToMap(array $vec, callable $keyFn): array {
        $out = [];
        foreach ($vec as $r) {
            $labels = $r['metric'] ?? [];
            $key = $keyFn($labels);
            if ($key === null || $key === '') continue;
            $val = isset($r['value'][1]) ? (float)$r['value'][1] : 0.0;
            // First-wins — series should be unique per key given `sum by (...)`.
            if (!isset($out[$key])) $out[$key] = $val;
        }
        return $out;
    }

    /**
     * Fetch + aggregate a single source. Returns:
     *   { slug, name, orgId, color, labelScheme, fetchedAt, services[], totals, error? }
     * services[]: { key, service, namespace?, workloadType?, pods, cpuCores,
     *               cpuLimitCores, cpuPct, memBytes, memLimitBytes, memPct,
     *               grafanaUrl }
     */
    function spFetchSource(array $src): array {
        $slug = (string)($src['slug'] ?? '');
        $scheme = (string)($src['labelScheme'] ?? 'k8s');
        $entry = [
            'slug'        => $slug,
            'name'        => (string)($src['name'] ?? ''),
            'orgId'       => (int)($src['orgId'] ?? 0),
            'color'       => (string)($src['color'] ?? '#71717a'),
            'labelScheme' => $scheme,
            'grafanaUrl'  => rtrim((string)($src['grafanaUrl'] ?? ''), '/'),
            'dashboardUid'=> (string)($src['dashboardUid'] ?? ''),
            'fetchedAt'   => date('c'),
            'services'    => [],
            'totals'      => ['services' => 0, 'pods' => 0, 'cpuHotspots' => 0, 'memHotspots' => 0],
            'error'       => null,
        ];

        try {
            $queries = $scheme === 'appScope' ? _spQueriesAppScope($src) : _spQueriesK8s($src);
            $res     = spQueryPromQL($src, $queries);
        } catch (Throwable $e) {
            $entry['error'] = $e->getMessage();
            return $entry;
        }

        // ── Build per-service rows ──────────────────────────────────────────
        // appScope: series already come pre-grouped by appScope label.
        // k8s: series come per-pod; we aggregate pods → workload PHP-side using
        //      the pod-name → workload heuristic in _spStripPodHash().
        if ($scheme === 'appScope') {
            $keyFn = fn($m) => (string)($m['appScope'] ?? '');
            $pods     = _spVecToMap($res['pods']     ?? [], $keyFn);
            $cpuUsed  = _spVecToMap($res['cpuUsed']  ?? [], $keyFn);
            $cpuLimit = _spVecToMap($res['cpuLimit'] ?? [], $keyFn);
            $memUsed  = _spVecToMap($res['memUsed']  ?? [], $keyFn);
            $memLimit = _spVecToMap($res['memLimit'] ?? [], $keyFn);

            $allKeys = array_unique(array_merge(
                array_keys($pods), array_keys($cpuUsed), array_keys($cpuLimit),
                array_keys($memUsed), array_keys($memLimit)
            ));
            sort($allKeys, SORT_NATURAL | SORT_FLAG_CASE);

            $services = []; $totalPods = 0; $cpuHot = 0; $memHot = 0;
            foreach ($allKeys as $k) {
                $podN = (int)round($pods[$k] ?? 0);
                $cpuU = (float)($cpuUsed[$k]  ?? 0);
                $cpuL = (float)($cpuLimit[$k] ?? 0);
                $memU = (float)($memUsed[$k]  ?? 0);
                $memL = (float)($memLimit[$k] ?? 0);
                $cpuPct = ($cpuL > 0) ? round(($cpuU / $cpuL) * 100, 1) : null;
                $memPct = ($memL > 0) ? round(($memU / $memL) * 100, 1) : null;
                if ($cpuPct !== null && $cpuPct >= 80) $cpuHot++;
                if ($memPct !== null && $memPct >= 80) $memHot++;
                $totalPods += $podN;
                $services[] = [
                    'key'          => $k,
                    'service'      => $k,
                    'namespace'    => null,
                    'workloadType' => null,
                    'pods'         => $podN,
                    'cpuCores'     => round($cpuU, 4),
                    'cpuLimitCores'=> round($cpuL, 4),
                    'cpuPct'       => $cpuPct,
                    'memBytes'     => (int)round($memU),
                    'memLimitBytes'=> (int)round($memL),
                    'memPct'       => $memPct,
                ];
            }
        } else {
            // k8s scheme — sum per (namespace, workload).
            // Accumulators: [$key => value] keyed by "namespace/workload".
            $agg = [];  // key → ['pods'=>int, 'cpuU','cpuL','memU','memL' floats]
            $addPod = function(string $ns, string $pod, string $bucket, float $val) use (&$agg) {
                if ($ns === '' || $pod === '') return;
                $wl  = _spStripPodHash($pod);
                $key = $ns . '/' . $wl;
                if (!isset($agg[$key])) {
                    $agg[$key] = ['pods' => [], 'cpuU'=>0, 'cpuL'=>0, 'memU'=>0, 'memL'=>0];
                }
                $agg[$key]['pods'][$pod] = true;
                $agg[$key][$bucket] += $val;
            };

            foreach (($res['pods'] ?? []) as $r) {
                $m = $r['metric'] ?? [];
                $ns = (string)($m['namespace'] ?? '');
                $pd = (string)($m['pod'] ?? '');
                // kube_pod_info doesn't contribute a metric value we sum; we
                // just count distinct pod names.
                if ($ns !== '' && $pd !== '') {
                    $wl  = _spStripPodHash($pd);
                    $key = $ns . '/' . $wl;
                    if (!isset($agg[$key])) $agg[$key] = ['pods' => [], 'cpuU'=>0, 'cpuL'=>0, 'memU'=>0, 'memL'=>0];
                    $agg[$key]['pods'][$pd] = true;
                }
            }
            foreach (($res['cpuUsed']  ?? []) as $r) { $m = $r['metric'] ?? []; $addPod((string)($m['namespace'] ?? ''), (string)($m['pod'] ?? ''), 'cpuU', (float)($r['value'][1] ?? 0)); }
            foreach (($res['cpuLimit'] ?? []) as $r) { $m = $r['metric'] ?? []; $addPod((string)($m['namespace'] ?? ''), (string)($m['pod'] ?? ''), 'cpuL', (float)($r['value'][1] ?? 0)); }
            foreach (($res['memUsed']  ?? []) as $r) { $m = $r['metric'] ?? []; $addPod((string)($m['namespace'] ?? ''), (string)($m['pod'] ?? ''), 'memU', (float)($r['value'][1] ?? 0)); }
            foreach (($res['memLimit'] ?? []) as $r) { $m = $r['metric'] ?? []; $addPod((string)($m['namespace'] ?? ''), (string)($m['pod'] ?? ''), 'memL', (float)($r['value'][1] ?? 0)); }

            $keys = array_keys($agg);
            sort($keys, SORT_NATURAL | SORT_FLAG_CASE);

            $services = []; $totalPods = 0; $cpuHot = 0; $memHot = 0;
            foreach ($keys as $k) {
                [$ns, $svc] = array_pad(explode('/', $k, 2), 2, '');
                $a = $agg[$k];
                $podN = count($a['pods']);
                $cpuU = (float)$a['cpuU']; $cpuL = (float)$a['cpuL'];
                $memU = (float)$a['memU']; $memL = (float)$a['memL'];
                $cpuPct = ($cpuL > 0) ? round(($cpuU / $cpuL) * 100, 1) : null;
                $memPct = ($memL > 0) ? round(($memU / $memL) * 100, 1) : null;
                if ($cpuPct !== null && $cpuPct >= 80) $cpuHot++;
                if ($memPct !== null && $memPct >= 80) $memHot++;
                $totalPods += $podN;
                $services[] = [
                    'key'          => $k,
                    'service'      => $svc,
                    'namespace'    => $ns,
                    'workloadType' => null,
                    'pods'         => $podN,
                    'cpuCores'     => round($cpuU, 4),
                    'cpuLimitCores'=> round($cpuL, 4),
                    'cpuPct'       => $cpuPct,
                    'memBytes'     => (int)round($memU),
                    'memLimitBytes'=> (int)round($memL),
                    'memPct'       => $memPct,
                ];
            }
        }

        // ── Inventory enrichment ─────────────────────────────────────────────
        // Attach the CSV row (BU / Team owner / Severity) to services that match
        // the Service Inventory, and flag whether the service is in the inventory
        // so index.php can filter or show-all based on the client's toggle.
        $inv = spLoadServiceInventory();
        if ($inv) {
            foreach ($services as &$s) {
                $lookup = strtolower((string)($s['service'] ?? ''));
                if (isset($inv[$lookup])) {
                    $row = $inv[$lookup];
                    $s['inInventory'] = true;
                    $s['bu']       = $row['bu'];
                    $s['team']     = $row['team'];
                    $s['severity'] = $row['severity'];
                } else {
                    $s['inInventory'] = false;
                }
            }
            unset($s);
        }

        $entry['services']              = $services;
        $entry['totals']['services']    = count($services);
        $entry['totals']['pods']        = $totalPods;
        $entry['totals']['cpuHotspots'] = $cpuHot;
        $entry['totals']['memHotspots'] = $memHot;
        $entry['hasInventory']          = !empty($inv);

        return $entry;
    }

    /**
     * Apply the inventory allowlist to a runway snapshot at read-time. Keeps the
     * cache-file shape complete (all services) so toggling "show all" in the UI
     * doesn't force a re-fetch. Recomputes totals to reflect the displayed rows.
     */
    function spApplyInventoryFilter(array $snapshot, bool $showAll): array {
        if ($showAll || empty($snapshot['hasInventory'])) return $snapshot;
        $filtered = array_values(array_filter($snapshot['services'] ?? [], fn($s) => !empty($s['inInventory'])));
        $totalPods = 0; $cpuHot = 0; $memHot = 0;
        foreach ($filtered as $s) {
            $totalPods += (int)($s['pods'] ?? 0);
            if (isset($s['cpuPct']) && $s['cpuPct'] !== null && $s['cpuPct'] >= 80) $cpuHot++;
            if (isset($s['memPct']) && $s['memPct'] !== null && $s['memPct'] >= 80) $memHot++;
        }
        $snapshot['services'] = $filtered;
        $snapshot['totals']   = [
            'services'    => count($filtered),
            'pods'        => $totalPods,
            'cpuHotspots' => $cpuHot,
            'memHotspots' => $memHot,
        ];
        return $snapshot;
    }

    /**
     * Get a source snapshot honoring the cache.
     *   $force = true  → always re-fetch (used by refresh.php)
     */
    function spGetSource(array $src, int $ttl, bool $force = false): array {
        $slug = (string)($src['slug'] ?? '');
        if (!$force) {
            $cached = spReadCache($slug, $ttl);
            if ($cached !== null) { $cached['fromCache'] = true; return $cached; }
        }
        $snap = spFetchSource($src);
        $snap['fromCache'] = false;
        spWriteCache($slug, $snap);
        return $snap;
    }

    /** Public sanitizer — strips tokens/secrets before returning to the client.
     *  Includes dsUid + cluster so the frontend can build Grafana Explore
     *  deep-links (raw PromQL query pages). None of these are secrets — the
     *  UID identifies a datasource, not the credentials to use it. */
    function spSourcePublic(array $src): array {
        return [
            'slug'             => (string)($src['slug'] ?? ''),
            'name'             => (string)($src['name'] ?? ''),
            'orgId'            => (int)($src['orgId'] ?? 0),
            'color'            => (string)($src['color'] ?? '#71717a'),
            'labelScheme'      => (string)($src['labelScheme'] ?? 'k8s'),
            'grafanaUrl'       => rtrim((string)($src['grafanaUrl'] ?? ''), '/'),
            'dashboardUid'     => (string)($src['dashboardUid'] ?? ''),
            'dashboardVarName' => (string)($src['dashboardVarName'] ?? 'App'),
            'dsUid'            => (string)($src['dsUid'] ?? ''),
            'jvmDsUid'         => (string)($src['jvmDsUid'] ?? ''),
            'cluster'          => (string)($src['cluster'] ?? ''),
            'namespaceRegex'   => (string)($src['namespaceRegex'] ?? ''),
            'enabled'          => ($src['enabled'] ?? true) !== false,
        ];
    }
}
