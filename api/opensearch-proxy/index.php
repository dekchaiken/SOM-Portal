<?php
// OpenSearch proxy — SM-only. Composes a bounded, server-side DSL query and
// forwards it to the endpoint the caller picks. Never accepts raw DSL from
// the browser to keep the attack surface small (index prefix, module name,
// time range, log level, free text, correlation id — all typed/validated).
//
// Actions (all POST):
//   ?action=list-endpoints    → list configured endpoints (creds redacted)
//   ?action=search            → main search: histogram + hits + summary
//   ?action=trace             → look up ALL log lines sharing a correlation id
//                                across every module in the index pattern
//   ?action=deeplink          → build an OpenSearch Dashboards Discover URL
require_once __DIR__ . '/../helpers.php';

const OS_CONFIG_FILE = 'opensearch_config.json';

$payload = requireAuth();
requireSmTeamOnly('OpenSearch log viewer');

// Rate-limit: log viewer is chatty when users toggle filters — keep the
// generic 120/60s from the shared api group so a stuck spinner can't hammer
// the cluster.
apiRateLimit($payload['sub'], 'opensearch');

function _osConfig(): array {
    $cfg = readJson(OS_CONFIG_FILE);
    if (!isset($cfg['endpoints']) || !is_array($cfg['endpoints'])) $cfg['endpoints'] = [];
    if (!isset($cfg['defaults']) || !is_array($cfg['defaults'])) {
        $cfg['defaults'] = ['size' => 200, 'max_size' => 1000, 'default_time_range_min' => 15];
    }
    return $cfg;
}

function _osEndpoint(string $id): array {
    $cfg = _osConfig();
    foreach ($cfg['endpoints'] as $e) {
        if (($e['id'] ?? '') === $id) {
            if (($e['enabled'] ?? true) === false) respondError('Endpoint is disabled', 422);
            return $e;
        }
    }
    respondError('Unknown endpoint id', 404);
}

// Validate an index pattern before we splice it into a URL path. Allow the
// same character set OpenSearch itself allows for index names, plus `*`, `-`,
// and `,` (comma = multi-index). Reject anything else outright.
function _osValidateIndex(string $ip): string {
    $ip = trim($ip);
    if ($ip === '') return '';
    if (!preg_match('/^[a-z0-9_\-.*,]+$/i', $ip)) {
        respondError('Invalid index pattern: only [a-z0-9_.\-*,] allowed');
    }
    return $ip;
}

// ─── cURL helper ─────────────────────────────────────────────────────────────
function _osCall(array $endpoint, string $path, string $method = 'GET', ?array $body = null): array {
    $url  = rtrim($endpoint['base_url'], '/') . $path;
    $host = hostFromUrl($url);
    if ($cd = hostCooldownActive($host)) {
        return ['', 0, 'host in cooldown: ' . $cd['reason']];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_USERPWD        => ($endpoint['username'] ?? '') . ':' . ($endpoint['password'] ?? ''),
        CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 OpenSearch-Proxy',
        CURLOPT_HTTPHEADER     => ['Accept: application/json', 'Content-Type: application/json'],
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    $respBody = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err      = curl_error($ch);
    curl_close($ch);

    if ($err !== '' || $code === 0 || $code >= 500) {
        hostCooldownMark($host, $err !== '' ? $err : "HTTP {$code}");
    }
    return [$respBody, $code, $err];
}

// Same html-sniff as opensearch-config — used to surface "you pointed us at
// the Dashboards page, not the REST API" as an actionable message.
function _osProxyIsHtml(string $body): bool {
    $t = ltrim($body);
    return $t !== '' && ($t[0] === '<');
}

// ─── Per-user credential loader ─────────────────────────────────────────────
// Returns the decrypted {username, password} for $userId on $endpointId, or
// null if the user has not saved credentials for that endpoint yet.
function _osUserCreds(string $userId, string $endpointId): ?array {
    $all = readJson('opensearch_user_creds.json');
    if (!is_array($all)) return null;
    $entry = $all[$userId][$endpointId] ?? null;
    if (!$entry || empty($entry['username']) || empty($entry['password_enc'])) return null;
    $key = hash('sha256', JWT_SECRET, true);
    $raw = base64_decode($entry['password_enc']);
    if (strlen($raw) < 17) return null;
    $iv   = substr($raw, 0, 16);
    $ct   = substr($raw, 16);
    $pass = (string)openssl_decrypt($ct, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    return ['username' => $entry['username'], 'password' => $pass];
}

// ─── Dashboards proxy mode (session cookie + /internal/search/opensearch) ──
// Used when the OpenSearch REST API isn't publicly exposed and everything
// goes through the Dashboards front door. Session cookies are cached per
// user+endpoint in data/sm/opensearch_sessions.json with a conservative TTL
// so a burst of user queries only pays one login round-trip.
const OS_SESSION_FILE = 'opensearch_sessions.json';
const OS_SESSION_TTL_SEC = 1800; // 30 min — Dashboards default session is 1h

// $cacheKey overrides the default endpoint-id key (use endpoint_id:user_id for
// per-user creds so sessions don't collide across users on the same endpoint).
function _osSessionCookie(array $endpoint, bool $forceFresh = false, string $cacheKey = ''): array {
    $sessions = readJson(OS_SESSION_FILE);
    if (!is_array($sessions)) $sessions = [];
    $id = $cacheKey !== '' ? $cacheKey : $endpoint['id'];
    $now = time();

    if (!$forceFresh && isset($sessions[$id])
        && ($sessions[$id]['expires_at'] ?? 0) > $now
        && !empty($sessions[$id]['cookie'])) {
        return ['ok' => true, 'cookie' => $sessions[$id]['cookie']];
    }

    // Fresh login
    $osdVer = trim($endpoint['osd_version'] ?? '2.7.0');
    $baseUrl = rtrim($endpoint['base_url'], '/');
    $host = hostFromUrl($baseUrl);
    if ($cd = hostCooldownActive($host)) {
        return ['ok' => false, 'error' => 'host in cooldown: ' . $cd['reason']];
    }

    $cookies = [];
    $ch = curl_init($baseUrl . '/auth/login');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode([
            'username' => $endpoint['username'] ?? '',
            'password' => $endpoint['password'] ?? '',
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'CentralizeSOM/1.0 OpenSearch-Dashboards',
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: */*',
            'osd-xsrf: true',
            'osd-version: ' . $osdVer,
        ],
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$cookies) {
            if (preg_match('/^Set-Cookie:\s*([^;]+)/i', $line, $m)) $cookies[] = trim($m[1]);
            return strlen($line);
        },
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err !== '' || $code === 0 || $code >= 500) {
        hostCooldownMark($host, $err ?: "login HTTP {$code}");
    }
    if ($err !== '')  return ['ok' => false, 'error' => 'login unreachable: ' . $err];
    if ($code === 401) return ['ok' => false, 'error' => 'invalid Dashboards credentials'];
    if ($code < 200 || $code >= 300) return ['ok' => false, 'error' => "login HTTP {$code}"];
    if (!$cookies) return ['ok' => false, 'error' => 'login returned no cookies'];

    $cookieHeader = implode('; ', $cookies);
    $sessions[$id] = ['cookie' => $cookieHeader, 'expires_at' => $now + OS_SESSION_TTL_SEC];
    writeJson(OS_SESSION_FILE, $sessions);
    return ['ok' => true, 'cookie' => $cookieHeader];
}

// Fire a search through the Dashboards internal proxy. Wraps DSL in the
// {params:{index, body}} envelope and unwraps the response's rawResponse.
// Auto-retries once with a fresh cookie on 401 (session expired mid-request).
// $cacheKey is forwarded to _osSessionCookie so per-user sessions don't collide.
function _osDashSearch(array $endpoint, string $index, array $dsl, string $cacheKey = ''): array {
    $tryIt = function (string $cookie) use ($endpoint, $index, $dsl): array {
        $baseUrl = rtrim($endpoint['base_url'], '/');
        $osdVer  = trim($endpoint['osd_version'] ?? '2.7.0');
        $host    = hostFromUrl($baseUrl);
        if ($cd = hostCooldownActive($host)) {
            return ['', 0, 'host in cooldown: ' . $cd['reason']];
        }
        $payload = ['params' => [
            'index' => $index,
            'body'  => $dsl,
            'preference' => (int)(microtime(true) * 1000),
        ]];
        $ch = curl_init($baseUrl . '/internal/search/opensearch');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_USERAGENT => 'CentralizeSOM/1.0 OpenSearch-Dashboards',
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: */*',
                'osd-xsrf: osd-fetch',
                'osd-version: ' . $osdVer,
                'Cookie: ' . $cookie,
            ],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($err !== '' || $code === 0 || $code >= 500) hostCooldownMark($host, $err ?: "HTTP {$code}");
        return [$body, $code, $err];
    };

    $sess = _osSessionCookie($endpoint, false, $cacheKey);
    if (!$sess['ok']) return ['', 0, $sess['error']];
    [$body, $code, $err] = $tryIt($sess['cookie']);

    // Session expired mid-request → force fresh login once and retry.
    if ($code === 401) {
        $sess2 = _osSessionCookie($endpoint, true, $cacheKey);
        if (!$sess2['ok']) return ['', 401, 'session-refresh failed: ' . $sess2['error']];
        [$body, $code, $err] = $tryIt($sess2['cookie']);
    }
    return [$body, $code, $err];
}

// Common post-processing for both search and trace: HTTP check + rawResponse unwrap.
function _osDecodeSearchResponse(string $body, int $code, string $err): array {
    if ($err !== '') respondError('OpenSearch unreachable: ' . $err, 502);
    if ($code === 401) respondError('OpenSearch rejected credentials / session', 422);
    if ($code === 403) respondError('OpenSearch access denied', 422);
    if ($code === 404) respondError('Index pattern matches no indices', 404);
    if ($code !== 200) respondError("OpenSearch HTTP {$code}: " . mb_substr($body, 0, 200), 502);
    if (_osProxyIsHtml($body)) {
        respondError('OpenSearch returned an HTML page instead of JSON — check Base URL / auth mode in admin/opensearch-config.html.', 502);
    }
    $data = json_decode($body, true);
    if (!is_array($data)) respondError('OpenSearch returned non-JSON body', 502);
    // Dashboards proxy wraps the real response in rawResponse.
    return $data['rawResponse'] ?? $data;
}

// Read hits.total across OpenSearch response format variants. Older responses
// (or when track_total_hits is off) return an int; newer ones return
// {value, relation:'eq'|'gte'}. Returns [totalInt, relationStr].
function _osReadTotal(array $data): array {
    $t = $data['hits']['total'] ?? 0;
    if (is_array($t)) return [(int)($t['value'] ?? 0), (string)($t['relation'] ?? 'eq')];
    return [(int)$t, 'eq'];
}

// Extract shard failure summary if any — surfaces silently-partial responses
// (e.g. one shard timed out but the rest returned) so users can distinguish
// "small result set" from "half the shards failed."
function _osReadShards(array $data): array {
    $s = $data['_shards'] ?? [];
    return [
        'total'      => (int)($s['total']      ?? 0),
        'successful' => (int)($s['successful'] ?? 0),
        'failed'     => (int)($s['failed']     ?? 0),
        'skipped'    => (int)($s['skipped']    ?? 0),
        'timed_out'  => (bool)($data['timed_out'] ?? false),
    ];
}

// ─── Time range parser ───────────────────────────────────────────────────────
// Accepts either a preset ("last_15m", "last_1h", ...) or absolute ISO
// strings via {start, end}. Returns [$gteMs, $lteMs, $interval] where
// $interval is the histogram bucket size that fits ~30 buckets.
function _osParseTime(array $body): array {
    $now = time() * 1000;
    if (!empty($body['start']) && !empty($body['end'])) {
        $s = strtotime((string)$body['start']);
        $e = strtotime((string)$body['end']);
        if (!$s || !$e || $e <= $s) respondError('Invalid start/end');
        $gte = $s * 1000;
        $lte = $e * 1000;
    } else {
        $range = strtolower(trim((string)($body['range'] ?? 'last_15m')));
        $mins = match ($range) {
            'last_5m'   => 5,
            'last_15m'  => 15,
            'last_30m'  => 30,
            'last_1h'   => 60,
            'last_4h'   => 4 * 60,
            'last_12h'  => 12 * 60,
            'last_24h'  => 24 * 60,
            'last_3d'   => 3 * 24 * 60,
            'last_7d'   => 7 * 24 * 60,
            default     => 15,
        };
        $gte = $now - ($mins * 60 * 1000);
        $lte = $now;
    }
    $spanSec = max(60, ($lte - $gte) / 1000);
    // Aim for ~30 histogram buckets — use OpenSearch's date_histogram fixed_interval.
    if     ($spanSec <=      15 * 60)     $interval = '30s';   // ≤15m
    elseif ($spanSec <=      60 * 60)     $interval = '2m';    // ≤1h
    elseif ($spanSec <=  4 * 60 * 60)     $interval = '10m';   // ≤4h
    elseif ($spanSec <= 12 * 60 * 60)     $interval = '30m';   // ≤12h
    elseif ($spanSec <= 24 * 60 * 60)     $interval = '1h';    // ≤24h
    elseif ($spanSec <= 3 * 24 * 60 * 60) $interval = '3h';    // ≤3d
    else                                  $interval = '12h';   // ≤7d and up
    return [$gte, $lte, $interval];
}

// ─── Build query DSL from typed params (no raw DSL from the browser) ─────────
function _osBuildQuery(array $body, int $gteMs, int $lteMs): array {
    $must   = [];
    $filter = [];

    // @timestamp range — always applied
    $filter[] = ['range' => ['@timestamp' => ['gte' => $gteMs, 'lte' => $lteMs, 'format' => 'epoch_millis']]];

    // Module (service name) — the primary filter, exact match on Module.keyword
    // with fallback to plain Module if the keyword subfield doesn't exist.
    $module = trim((string)($body['module'] ?? ''));
    if ($module !== '') {
        $filter[] = ['bool' => ['should' => [
            ['term'  => ['Module.keyword' => $module]],
            ['term'  => ['Module'         => $module]],
        ], 'minimum_should_match' => 1]];
    }

    // Log level — exact match; accepts INFO/WARN/ERROR/DEBUG/TRACE
    $lvl = strtoupper(trim((string)($body['log_level'] ?? '')));
    if ($lvl !== '') {
        if (!in_array($lvl, ['TRACE','DEBUG','INFO','WARN','ERROR','FATAL'], true)) {
            respondError('log_level must be one of TRACE/DEBUG/INFO/WARN/ERROR/FATAL');
        }
        $filter[] = ['bool' => ['should' => [
            ['term' => ['Log_Level.keyword' => $lvl]],
            ['term' => ['Log_Level'         => $lvl]],
        ], 'minimum_should_match' => 1]];
    }

    // Correlation id — exact match
    $cid = trim((string)($body['correlation_id'] ?? ''));
    if ($cid !== '') {
        $filter[] = ['bool' => ['should' => [
            ['term' => ['CORRELATION_ID.keyword' => $cid]],
            ['term' => ['CORRELATION_ID'         => $cid]],
        ], 'minimum_should_match' => 1]];
    }

    // Free-text search across the REST log message (query_string handles the
    // typical Discover DQL idioms — quoted phrases, AND/OR — that ops already
    // know). Capped to 200 chars to keep queries sane.
    $q = trim((string)($body['q'] ?? ''));
    if ($q !== '') {
        if (mb_strlen($q) > 200) respondError('q must be ≤200 characters');
        $must[] = ['query_string' => [
            'query'            => $q,
            'default_field'    => 'REST',
            'analyze_wildcard' => true,
            'lenient'          => true,
        ]];
    }

    // Regexp filter on the REST field — lets callers do pattern matching like
    // "[4-5][0-9]{2}" to find all 4xx/5xx without knowing the exact log format.
    // OpenSearch will reject invalid regex; no further sanitization needed beyond
    // length cap (prevents absurdly large patterns that compile slowly).
    $rxRest = trim((string)($body['regexp_rest'] ?? ''));
    if ($rxRest !== '') {
        if (mb_strlen($rxRest) > 500) respondError('regexp_rest must be ≤500 characters');
        $must[] = ['regexp' => ['REST' => ['value' => $rxRest, 'flags' => 'ALL', 'case_insensitive' => true]]];
    }

    $bool = [];
    if ($must)   $bool['must']   = $must;
    if ($filter) $bool['filter'] = $filter;
    return ['bool' => $bool ?: ['match_all' => new stdClass()]];
}

// Normalize a single OpenSearch hit into the shape the frontend renders.
function _osNormalizeHit(array $hit): array {
    $src = $hit['_source'] ?? [];
    $rest = (string)($src['REST'] ?? $src['log_message'] ?? '');

    // Parse status_code / http_status from the REST line so the summary can
    // count success (2xx/200-XX) vs fail (4xx/5xx/500-XX) without shipping
    // the whole hit list back to the browser.
    $status = null;
    if (preg_match('/status_code\s*[:=]\s*\[?(\d{3})/i', $rest, $m)) {
        $status = (int)$m[1];
    } elseif (preg_match('/http_status\s*[:=]\s*\[?(\d{3})/i', $rest, $m)) {
        $status = (int)$m[1];
    } elseif (preg_match('/responseStatus\s*[:=]\s*(\d{3})/i', $rest, $m)) {
        $status = (int)$m[1];
    } elseif (preg_match('/\bHTTP\/?[\d.]+\s+(\d{3})\b/i', $rest, $m)) {
        $status = (int)$m[1];
    }

    // Response time — "Response time = 1376 ms" or "[1378 ms]"
    $latencyMs = null;
    if (preg_match('/Response time\s*=\s*(\d+)\s*ms/i', $rest, $m)) {
        $latencyMs = (int)$m[1];
    } elseif (preg_match('/\[(\d+)\s*ms\]/', $rest, $m)) {
        $latencyMs = (int)$m[1];
    }

    return [
        'id'              => $hit['_id'] ?? '',
        'index'           => $hit['_index'] ?? '',
        'timestamp'       => $src['@timestamp'] ?? null,
        'module'          => (string)($src['Module']         ?? ''),
        'log_level'       => (string)($src['Log_Level']      ?? ''),
        'correlation_id'  => (string)($src['CORRELATION_ID'] ?? ''),
        'rest'            => $rest,
        'status_code'     => $status,
        'latency_ms'      => $latencyMs,
        'pod'             => (string)($src['kubernetes.pod_name']       ?? $src['kubernetes']['pod_name']       ?? ''),
        'namespace'       => (string)($src['kubernetes.namespace_name'] ?? $src['kubernetes']['namespace_name'] ?? ''),
        'host'            => (string)($src['Host'] ?? $src['host']      ?? ''),
        // Keep the full source for the row-expand JSON view; the browser
        // decides when to reveal it (only for expanded rows).
        'source'          => $src,
    ];
}

$method = $_SERVER['REQUEST_METHOD'];
$action = trim($_GET['action'] ?? '');

// ── POST ?action=test-creds — verify a user's credentials against an endpoint ─
// Runs the same probe as opensearch-config test but uses the supplied user/pass
// instead of admin creds. Does NOT save anything — caller decides after result.
if ($method === 'POST' && $action === 'test-creds') {
    requireCsrf();
    $body     = getBody();
    $epId     = trim($body['endpoint_id'] ?? '');
    $username = trim($body['username']    ?? '');
    $password = (string)($body['password'] ?? '');
    if (!$epId || !$username || !$password) respondError('endpoint_id, username and password are required');

    $endpoint = _osEndpoint($epId);
    // Override credentials with the user-supplied ones
    $endpoint['username'] = $username;
    $endpoint['password'] = $password;

    $host = hostFromUrl(rtrim($endpoint['base_url'], '/'));
    if ($cd = hostCooldownActive($host)) respondError('Host in cooldown: ' . $cd['reason'], 503);

    $t0   = microtime(true);
    $mode = $endpoint['auth_mode'] ?? 'basic';

    if ($mode === 'dashboards') {
        // Login probe: attempt the Dashboards /auth/login handshake.
        $osdVer  = trim($endpoint['osd_version'] ?? '2.7.0');
        $baseUrl = rtrim($endpoint['base_url'], '/');
        $cookies = [];
        $ch = curl_init($baseUrl . '/auth/login');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['username' => $username, 'password' => $password]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 OpenSearch-Dashboards',
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json', 'Accept: */*',
                'osd-xsrf: true', 'osd-version: ' . $osdVer,
            ],
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$cookies) {
                if (preg_match('/^Set-Cookie:\s*([^;]+)/i', $line, $m)) $cookies[] = trim($m[1]);
                return strlen($line);
            },
        ]);
        $respBody = curl_exec($ch);
        $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err      = curl_error($ch);
        curl_close($ch);
        $ms = (int)round((microtime(true) - $t0) * 1000);
        if ($err !== '' || $code === 0 || $code >= 500) hostCooldownMark($host, $err ?: "login HTTP {$code}");
        if ($err !== '')   respondError('Cannot reach OpenSearch Dashboards: ' . $err, 502);
        if ($code === 401) respondError('Invalid username or password', 422);
        if ($code < 200 || $code >= 300) respondError("Login returned HTTP {$code}", 502);
        if (!$cookies)     respondError('Login succeeded but no session cookie returned', 502);
        respondOk(['latency_ms' => $ms, 'mode' => 'dashboards'], 'Credentials verified');
    }

    // Basic mode: probe /_cluster/health with supplied credentials.
    $url = rtrim($endpoint['base_url'], '/') . '/_cluster/health';
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_USERPWD        => $username . ':' . $password,
        CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 OpenSearch-Proxy',
    ]);
    $respBody = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err      = curl_error($ch);
    $ms       = (int)round((microtime(true) - $t0) * 1000);
    curl_close($ch);
    if ($err !== '' || $code === 0 || $code >= 500) hostCooldownMark($host, $err ?: "HTTP {$code}");
    if ($err !== '')   respondError('Cannot reach OpenSearch: ' . $err, 502);
    if ($code === 401) respondError('Invalid username or password', 422);
    if ($code === 403) respondError('Access denied (403) — user may lack cluster:monitor/health permission', 422);
    if ($code !== 200) respondError("OpenSearch returned HTTP {$code}", 502);
    if (_osProxyIsHtml($respBody)) respondError('Got HTML instead of JSON — check endpoint Base URL', 502);
    $health = json_decode($respBody, true);
    respondOk(['latency_ms' => $ms, 'mode' => 'basic', 'status' => $health['status'] ?? null], 'Credentials verified');
}

// ── GET / POST ?action=list-endpoints ────────────────────────────────────────
if ($action === 'list-endpoints') {
    $cfg = _osConfig();
    $out = [];
    foreach ($cfg['endpoints'] as $e) {
        if (($e['enabled'] ?? true) === false) continue;
        $out[] = [
            'id'                    => $e['id'] ?? '',
            'name'                  => $e['name'] ?? '',
            'default_index_pattern' => $e['default_index_pattern'] ?? '',
            'index_patterns'        => $e['index_patterns'] ?? [],
            'has_dashboards_url'    => !empty($e['dashboards_url']),
            'order'                 => (int)($e['order'] ?? 99),
        ];
    }
    usort($out, fn($a, $b) => $a['order'] <=> $b['order']);
    respondOk(['endpoints' => $out, 'defaults' => $cfg['defaults']]);
}

// ── POST ?action=search — main log search ────────────────────────────────────
if ($method === 'POST' && $action === 'search') {
    requireCsrf();
    $body = getBody();

    $endpointId    = trim($body['endpoint_id']    ?? '');
    if ($endpointId === '') respondError('endpoint_id is required');
    $endpoint      = _osEndpoint($endpointId);

    // Inject per-user credentials. The endpoint URL + index config comes from
    // admin (opensearch_config.json); the username/password comes from the user's
    // own saved creds. If the user hasn't saved creds for this endpoint yet,
    // return a typed error so the frontend can show the credential prompt.
    $userCreds = _osUserCreds($payload['sub'], $endpointId);
    if ($userCreds === null) {
        http_response_code(422);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'message' => 'no_user_creds', 'data' => ['endpoint_id' => $endpointId]]);
        exit;
    }
    $endpoint['username'] = $userCreds['username'];
    $endpoint['password'] = $userCreds['password'];
    $sessCacheKey = $endpointId . ':' . $payload['sub'];

    $indexPattern  = _osValidateIndex((string)($body['index_pattern'] ?? $endpoint['default_index_pattern'] ?? ''));
    if ($indexPattern === '') respondError('index_pattern is required');

    $cfg     = _osConfig();
    $maxSize = (int)($cfg['defaults']['max_size'] ?? 1000);
    $size    = min($maxSize, max(1, (int)($body['size'] ?? ($cfg['defaults']['size'] ?? 200))));
    $from    = max(0, min(9000, (int)($body['from'] ?? 0)));

    [$gte, $lte, $interval] = _osParseTime($body);
    $query = _osBuildQuery($body, $gte, $lte);

    $dsl = [
        'size'  => $size,
        'from'  => $from,
        'sort'  => [['@timestamp' => ['order' => 'desc']]],
        'query' => $query,
        'aggs'  => [
            'histogram' => [
                'date_histogram' => [
                    'field'          => '@timestamp',
                    'fixed_interval' => $interval,
                    'min_doc_count'  => 0,
                    'extended_bounds'=> ['min' => $gte, 'max' => $lte],
                ],
                'aggs' => [
                    'by_level' => [
                        'terms' => ['field' => 'Log_Level.keyword', 'size' => 6, 'missing' => 'UNKNOWN'],
                    ],
                ],
            ],
            // Pod names are low-cardinality (10s per service) so this terms agg
            // is cheap. We deliberately DO NOT do a `top_correlations` terms
            // agg on CORRELATION_ID.keyword — every request has a unique
            // correlation id, so the cardinality is roughly total-hit-count,
            // and a terms agg over that will time out the cluster on any
            // realistic time window. Users get top-correlation info by
            // clicking a specific correlation instead.
            'top_pods' => [
                'terms' => ['field' => 'kubernetes.pod_name.keyword', 'size' => 10, 'missing' => ''],
            ],
        ],
        // Track total accurately up to a bounded ceiling — the exact number
        // isn't needed once you're past ~10k, and unbounded track slows the
        // cluster on heavy indices.
        'track_total_hits' => 10000,
        // Server-side circuit breaker: OpenSearch will abort the search if it
        // hasn't finished in 30s and return partial results. Keeps a slow
        // shard from blocking the whole request.
        'timeout' => '30s',
    ];

    $mode = $endpoint['auth_mode'] ?? 'basic';
    if ($mode === 'dashboards') {
        [$resp, $code, $err] = _osDashSearch($endpoint, $indexPattern, $dsl, $sessCacheKey);
    } else {
        [$resp, $code, $err] = _osCall($endpoint, '/' . rawurlencode($indexPattern) . '/_search', 'POST', $dsl);
    }
    $data = _osDecodeSearchResponse((string)$resp, $code, $err);

    $hits = array_map('_osNormalizeHit', $data['hits']['hits'] ?? []);

    // Success / fail summary — strict HTTP class buckets.
    // "ok" = 2xx (200-299) only; 1xx/3xx go to "other" so the badge is accurate.
    $sum = ['ok' => 0, 'warn' => 0, 'error' => 0, 'other' => 0, 'unknown' => 0];
    $latSum = 0; $latN = 0; $latMax = 0;
    foreach ($hits as $h) {
        $sc = $h['status_code'];
        if      ($sc === null)                        $sum['unknown']++;
        elseif  ($sc >= 500)                          $sum['error']++;
        elseif  ($sc >= 400)                          $sum['warn']++;
        elseif  ($sc >= 200 && $sc < 300)             $sum['ok']++;
        else                                          $sum['other']++;   // 1xx, 3xx
        if ($h['latency_ms'] !== null) {
            $latSum += $h['latency_ms']; $latN++;
            if ($h['latency_ms'] > $latMax) $latMax = $h['latency_ms'];
        }
    }

    $buckets = array_map(fn($b) => [
        'time'   => (int)($b['key'] ?? 0),
        'count'  => (int)($b['doc_count'] ?? 0),
        'levels' => array_map(fn($lb) => [
            'key'   => (string)($lb['key'] ?? ''),
            'count' => (int)($lb['doc_count'] ?? 0),
        ], $b['by_level']['buckets'] ?? []),
    ], $data['aggregations']['histogram']['buckets'] ?? []);

    $topCorrs = array_values(array_filter(array_map(fn($b) => [
        'key'   => (string)($b['key'] ?? ''),
        'count' => (int)($b['doc_count'] ?? 0),
    ], $data['aggregations']['top_correlations']['buckets'] ?? []), fn($r) => $r['key'] !== ''));

    $topPods = array_values(array_filter(array_map(fn($b) => [
        'key'   => (string)($b['key'] ?? ''),
        'count' => (int)($b['doc_count'] ?? 0),
    ], $data['aggregations']['top_pods']['buckets'] ?? []), fn($r) => $r['key'] !== ''));

    [$totalN, $totalRel] = _osReadTotal($data);
    respondOk([
        'endpoint_id'   => $endpointId,
        'index_pattern' => $indexPattern,
        'time'          => ['gte' => $gte, 'lte' => $lte, 'interval' => $interval],
        'total'         => $totalN,
        'total_relation'=> $totalRel,
        'shards'        => _osReadShards($data),
        'returned'      => count($hits),
        'took_ms'       => (int)($data['took'] ?? 0),
        'summary'       => [
            'status'      => $sum,
            'latency_avg' => $latN > 0 ? (int)round($latSum / $latN) : null,
            'latency_max' => $latMax ?: null,
            'latency_n'   => $latN,
        ],
        'histogram'     => $buckets,
        'top_correlations' => $topCorrs,
        'top_pods'      => $topPods,
        'hits'          => $hits,
    ]);
}

// ── POST ?action=trace — every log line sharing a correlation id ─────────────
// Drops the Module filter so the response spans every service that touched
// the request — this is what makes "which service did it call?" visible.
if ($method === 'POST' && $action === 'trace') {
    requireCsrf();
    $body = getBody();

    $endpointId   = trim($body['endpoint_id']    ?? '');
    if ($endpointId === '') respondError('endpoint_id is required');
    $endpoint     = _osEndpoint($endpointId);

    // Per-user credential injection (same as search action).
    $userCredsTr = _osUserCreds($payload['sub'], $endpointId);
    if ($userCredsTr === null) {
        http_response_code(422);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'message' => 'no_user_creds', 'data' => ['endpoint_id' => $endpointId]]);
        exit;
    }
    $endpoint['username'] = $userCredsTr['username'];
    $endpoint['password'] = $userCredsTr['password'];
    $sessCacheKeyTr = $endpointId . ':' . $payload['sub'];

    $indexPattern = _osValidateIndex((string)($body['index_pattern'] ?? $endpoint['default_index_pattern'] ?? ''));
    if ($indexPattern === '') respondError('index_pattern is required');

    $cid = trim((string)($body['correlation_id'] ?? ''));
    if ($cid === '') respondError('correlation_id is required');

    [$gte, $lte] = _osParseTime($body);
    // Correlation traces care about "everything for this request", and log
    // shipping (Fluentd → Logstash → OpenSearch) adds seconds of latency —
    // especially on error paths where pods only log after a timeout. Extend
    // the trace end time by 90s beyond the caller's range so slow-arriving
    // failure logs aren't cut off, and to absorb server↔browser clock skew.
    // Safe because the CORRELATION_ID filter still bounds the result set to
    // just this one request.
    $lte += 90 * 1000;
    $cfg = _osConfig();
    $size = min((int)($cfg['defaults']['max_size'] ?? 1000), max(1, (int)($body['size'] ?? 500)));

    // Broad trace search — mirrors what OpenSearch Dashboards free-text does.
    // Dashboards ships the query as `query_string` with `analyze_wildcard`,
    // which searches ALL indexed fields (default_field='*') and handles nested
    // json / keyword / text fields uniformly. multi_match with fields:['*']
    // did NOT match this — some fields with keyword-only analyzers refused to
    // phrase-match a hyphen-split id like "TMG-<hex>".
    //
    // We escape backslashes AND the Lucene metachars in the id before quoting,
    // then wrap in quotes so query_string treats it as a literal phrase.
    $cidEscaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $cid);
    $dsl = [
        'size' => $size,
        'sort' => [['@timestamp' => ['order' => 'asc']]],
        'query' => ['bool' => ['filter' => [
            ['range' => ['@timestamp' => ['gte' => $gte, 'lte' => $lte, 'format' => 'epoch_millis']]],
            ['bool'  => ['should' => [
                // Fast path: exact match on the structured field.
                ['term' => ['CORRELATION_ID.keyword' => $cid]],
                // Broad path: same query Dashboards free-text uses. Catches
                // the id in log bodies, headers, nested payloads, etc.
                ['query_string' => [
                    'query'            => '"' . $cidEscaped . '"',
                    'analyze_wildcard' => true,
                    'lenient'          => true,
                    'default_operator' => 'AND',
                ]],
            ], 'minimum_should_match' => 1]],
        ]]],
        'aggs' => [
            'by_module' => [
                'terms' => ['field' => 'Module.keyword', 'size' => 20, 'missing' => 'UNKNOWN'],
            ],
        ],
        'track_total_hits' => 5000,
    ];

    $mode = $endpoint['auth_mode'] ?? 'basic';
    if ($mode === 'dashboards') {
        [$resp, $code, $err] = _osDashSearch($endpoint, $indexPattern, $dsl, $sessCacheKeyTr);
    } else {
        [$resp, $code, $err] = _osCall($endpoint, '/' . rawurlencode($indexPattern) . '/_search', 'POST', $dsl);
    }
    $data = _osDecodeSearchResponse((string)$resp, $code, $err);

    $hits = array_map('_osNormalizeHit', $data['hits']['hits'] ?? []);
    $modules = array_map(fn($b) => [
        'module' => (string)($b['key'] ?? ''),
        'count'  => (int)($b['doc_count'] ?? 0),
    ], $data['aggregations']['by_module']['buckets'] ?? []);

    [$totalN, $totalRel] = _osReadTotal($data);
    respondOk([
        'correlation_id' => $cid,
        'total'          => $totalN,
        'total_relation' => $totalRel,
        'shards'         => _osReadShards($data),
        'returned'       => count($hits),
        'took_ms'        => (int)($data['took'] ?? 0),
        'modules'        => $modules,
        'hits'           => $hits,
    ]);
}

// ── POST ?action=deeplink — build a Dashboards Discover URL ──────────────────
// Just a URL constructor: takes the same filter params, produces a link the
// user can open to jump into Dashboards with the identical view pre-loaded.
// Kept server-side so the base_url + dashboards_url mapping stays hidden.
if ($method === 'POST' && $action === 'deeplink') {
    $body = getBody();

    $endpointId   = trim($body['endpoint_id'] ?? '');
    if ($endpointId === '') respondError('endpoint_id is required');
    $endpoint     = _osEndpoint($endpointId);

    $dashUrl = $endpoint['dashboards_url'] ?? '';
    if ($dashUrl === '') $dashUrl = $endpoint['base_url']; // fallback — Dashboards often on same host

    $indexPattern = _osValidateIndex((string)($body['index_pattern'] ?? $endpoint['default_index_pattern'] ?? ''));
    [$gte, $lte]  = _osParseTime($body);
    $module       = trim((string)($body['module'] ?? ''));
    $lvl          = strtoupper(trim((string)($body['log_level'] ?? '')));
    $cid          = trim((string)($body['correlation_id'] ?? ''));
    $q            = trim((string)($body['q'] ?? ''));

    // Build _a and _g for Dashboards Discover Rison-lite (URI-encoded).
    // OpenSearch/Kibana rison is fiddly; use the "query in query_string" +
    // full ISO range approach which every Dashboards version understands.
    $qParts = [];
    if ($module !== '') $qParts[] = 'Module:"' . addcslashes($module, '"') . '"';
    if ($lvl !== '')    $qParts[] = 'Log_Level:' . $lvl;
    if ($cid !== '')    $qParts[] = 'CORRELATION_ID:"' . addcslashes($cid, '"') . '"';
    if ($q !== '')      $qParts[] = '(' . $q . ')';
    $queryStr = implode(' AND ', $qParts);

    $gIso = gmdate('Y-m-d\TH:i:s.000\Z', (int)($gte / 1000));
    $lIso = gmdate('Y-m-d\TH:i:s.000\Z', (int)($lte / 1000));

    // Minimal Rison-like structure that Discover accepts via URL params.
    $gParam = "(time:(from:'{$gIso}',to:'{$lIso}'))";
    $aParam = "(columns:!(Module,Log_Level,REST,CORRELATION_ID),index:'" . str_replace("'", "\\'", $indexPattern) . "',query:(language:kuery,query:'" . str_replace("'", "\\'", $queryStr) . "'))";

    $url = rtrim($dashUrl, '/') . '/app/data-explorer/discover'
         . '#/?_g=' . rawurlencode($gParam)
         . '&_a='   . rawurlencode($aParam);

    respondOk(['url' => $url]);
}

respondError('Unknown action', 400);
