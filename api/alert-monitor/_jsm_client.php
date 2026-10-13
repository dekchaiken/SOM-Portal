<?php
// ─── JSM Ops (Opsgenie-compat) API client ─────────────────────────────────────
// Reused by sync.php. Not a routable endpoint — no auth handling in this file.
require_once __DIR__ . '/../helpers.php';

/**
 * Build Basic Auth header for JSM API.
 *
 * Atlassian API tokens are account-level, so JIRA_EMAIL + JIRA_TOKEN from .env
 * work across every Cloud tenant the account has access to (acm-opscenter
 * included). If we ever need a dedicated token, add JSM_EMAIL / JSM_TOKEN to
 * .env and check them first.
 */
function alertMonitorAuthHeader(): string {
    $email = envFallback('JSM_EMAIL') ?: jiraEmail();
    $token = envFallback('JSM_TOKEN') ?: jiraToken();
    if ($email === '' || $token === '') {
        throw new RuntimeException('JSM credentials missing: set JIRA_EMAIL + JIRA_TOKEN in .env');
    }
    return 'Basic ' . base64_encode($email . ':' . $token);
}

function alertMonitorConfig(): array {
    $cfg = readJson('alert-monitor-config.json');
    if (!$cfg || empty($cfg['jsm']['cloud_id'])) {
        throw new RuntimeException('alert-monitor-config.json missing or invalid');
    }
    return $cfg;
}

/**
 * Apply TLS-verification config to a cURL options array.
 *
 * Some hosts (esp. minimal Linux containers) ship without a CA bundle
 * configured for cURL. Try known locations first — falls back to
 * CURLOPT_SSL_VERIFYPEER=false only if the admin explicitly opts out via
 * `jsm.ssl_verify=false`.
 *
 * Shared by the sync pipeline and the test-jsm debug endpoint so both
 * behave identically under TLS toggles.
 */
function alertMonitorApplyTls(array &$opts, array $cfg): void {
    $sslVerify = $cfg['jsm']['ssl_verify'] ?? true;
    if ($sslVerify) {
        $caCandidates = [
            $cfg['jsm']['ssl_ca_bundle'] ?? '',
            __DIR__ . '/cacert.pem',
            '/etc/ssl/certs/ca-certificates.crt',   // Debian/Ubuntu
            '/etc/pki/tls/certs/ca-bundle.crt',     // RHEL/CentOS
            '/etc/ssl/cert.pem',                    // Alpine / macOS
            '/usr/local/etc/openssl/cert.pem',      // Homebrew
        ];
        foreach ($caCandidates as $ca) {
            if ($ca && is_readable($ca)) {
                $opts[CURLOPT_CAINFO] = $ca;
                break;
            }
        }
    } else {
        $opts[CURLOPT_SSL_VERIFYPEER] = false;
        $opts[CURLOPT_SSL_VERIFYHOST] = 0;
    }
}

/**
 * Query JSM Ops alerts list.
 * https://developer.atlassian.com/cloud/jira-service-management/rest/api-group-operations/#api-alerts-get
 *
 * @param string $query   Opsgenie-style search string (e.g. 'responders:"..." AND updatedAt > 12345')
 * @param int    $offset  Pagination offset
 * @param int    $limit   Page size (max 100)
 * @return array          Decoded JSON body — { data: [...], paging: {...}, took, requestId }
 */
function alertMonitorFetchPage(string $query, int $offset = 0, int $limit = 100): array {
    $cfg     = alertMonitorConfig();
    $cloudId = $cfg['jsm']['cloud_id'];
    $baseUrl = rtrim($cfg['jsm']['base_url'] ?? 'https://api.atlassian.com/jsm/ops/api', '/');
    $timeout = (int)($cfg['sync']['request_timeout_seconds'] ?? 25);

    $params = [
        'query'  => $query,
        'offset' => $offset,
        'limit'  => min(100, max(1, $limit)),
        'sort'   => 'createdAt',
        'order'  => 'desc',
    ];
    $url = "$baseUrl/$cloudId/v1/alerts?" . http_build_query($params);

    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: ' . alertMonitorAuthHeader(),
            'Accept: application/json',
        ],
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
    ];
    alertMonitorApplyTls($opts, $cfg);
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false || $err) {
        // Surface a hint when the failure is CA-bundle-related — it's a config
        // problem, not a code bug, and the fix is documented in the admin UI.
        $hint = '';
        if (stripos($err, 'certificate') !== false || stripos($err, 'ssl') !== false) {
            $hint = ' — ตั้ง jsm.ssl_verify=false ใน admin config หรือ point ssl_ca_bundle ไปที่ cacert.pem';
        }
        logIntegrationError('jsm', $url, $err ?: 'body false', ['http_code' => $code]);
        throw new RuntimeException("JSM request failed: $err$hint");
    }
    if ($code < 200 || $code >= 300) {
        $preview = mb_substr((string)$body, 0, 400);
        logIntegrationError('jsm', $url, "HTTP {$code}", ['http_code' => $code, 'body' => $preview]);
        throw new RuntimeException("JSM API returned HTTP $code — $preview");
    }
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        logIntegrationError('jsm', $url, 'Non-JSON body', ['body' => mb_substr((string)$body, 0, 200)]);
        throw new RuntimeException('JSM API returned non-JSON body');
    }
    return $decoded;
}

/**
 * Parse a JSM/Opsgenie timestamp — the API returns ISO-8601 strings
 * ("2026-07-06T08:01:06.355Z"), sometimes epoch millis for older data.
 */
function alertMonitorParseTs($v): int {
    if ($v === null || $v === '') return 0;
    if (is_numeric($v)) return (int)$v;
    $ts = strtotime((string)$v);
    if ($ts === false) return 0;
    // Preserve millisecond precision if present ("...S.SSSZ")
    if (preg_match('/\.(\d{3})Z?$/', (string)$v, $m)) return $ts * 1000 + (int)$m[1];
    return $ts * 1000;
}

/**
 * Reduce a full JSM alert object to the fields we actually persist.
 * Keeping only relevant fields shrinks the JSON cache ~5×.
 *
 * Note: JSM Ops responders currently return only {id, type} — no names.
 * We store the raw ID list so filtering by team_id works both server- and
 * client-side without an extra name-lookup call.
 */
function alertMonitorNormalize(array $raw): array {
    $responderIds = [];
    foreach (($raw['responders'] ?? []) as $r) {
        if (!empty($r['id'])) $responderIds[] = $r['id'];
    }
    return [
        'id'              => $raw['id']            ?? '',
        'tiny_id'         => $raw['tinyId']        ?? '',
        'message'         => $raw['message']       ?? '',
        'alias'           => $raw['alias']         ?? '',
        'status'          => $raw['status']        ?? '',
        'acknowledged'    => (bool)($raw['acknowledged'] ?? false),
        // Opsgenie API sends "seen" (bool); older docs called it "isSeen"
        'is_seen'         => (bool)($raw['seen'] ?? $raw['isSeen'] ?? false),
        'snoozed'         => (bool)($raw['snoozed']      ?? false),
        'priority'        => $raw['priority']      ?? '',
        'source'          => $raw['source']        ?? '',
        'integration'     => $raw['integrationName'] ?? '',
        'tags'            => array_values(array_filter((array)($raw['tags'] ?? []), 'strval')),
        'responders'      => $responderIds,
        'count'           => (int)($raw['count'] ?? 1),
        // JSM returns ISO strings; convert to epoch millis for consistent maths.
        // Opsgenie has a historical typo "lastOccuredAt" — we handle both spellings.
        'created_at'      => alertMonitorParseTs($raw['createdAt'] ?? 0),
        'updated_at'      => alertMonitorParseTs($raw['updatedAt'] ?? 0),
        'last_occurred_at'=> alertMonitorParseTs($raw['lastOccuredAt'] ?? $raw['lastOccurredAt'] ?? 0),
        'close_time'      => alertMonitorParseTs($raw['closeTime'] ?? 0),
    ];
}
