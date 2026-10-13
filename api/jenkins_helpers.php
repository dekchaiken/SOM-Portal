<?php
// ══════════════════════════════════════════════════════════════════
//  Jenkins Shared Helpers
//  Used by api/jenkins-proxy/ and api/ma-services/jenkins-*.php
//  Auth / cooldown / DNS overrides handled here so callers only care
//  about URL + method + payload.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/helpers.php';

/**
 * Load enabled Jenkins servers keyed by id. Cached via require semantics
 * (jenkins_config.php is a top-level `return $array` file — cheap to
 * re-require, PHP opcache dedupes).
 */
function jenkinsServers(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $cache = require __DIR__ . '/jenkins_config.php';
    return $cache;
}

/**
 * Body-only Jenkins request (backward-compatible with the version that lived
 * in api/jenkins-proxy/index.php).
 * Returns [string $body, int $httpCode, string $curlErr].
 */
function jenkinsRequest(array $server, string $url, string $method = 'GET', $postFields = null, array $extraHeaders = []): array {
    $out = jenkinsRequestFull($server, $url, $method, $postFields, $extraHeaders);
    return [$out['body'], $out['code'], $out['err']];
}

/**
 * Extended Jenkins request that returns response headers too — needed for
 * buildWithParameters where the queue-item URL comes back in the `Location`
 * header (Jenkins doesn't put it in the body).
 * Returns ['body'=>string, 'code'=>int, 'err'=>string, 'headers'=>array<string,string>].
 */
function jenkinsRequestFull(array $server, string $url, string $method = 'GET', $postFields = null, array $extraHeaders = []): array {
    $host = hostFromUrl($url);
    if ($cd = hostCooldownActive($host)) {
        return ['body' => '', 'code' => 0, 'err' => 'host in cooldown: ' . $cd['reason'], 'headers' => []];
    }

    $auth = $server['auth'] ?? [];
    $ch   = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => false,   // must be off so we can read Location header
        CURLOPT_HEADER         => true,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 Jenkins-Client',
    ]);

    $headers = array_merge(['Accept: application/json'], $extraHeaders);
    if (($auth['mode'] ?? '') === 'token' && !empty($auth['token'])) {
        $headers[] = 'Authorization: Basic ' . base64_encode(($auth['user'] ?? '') . ':' . $auth['token']);
    } elseif (($auth['mode'] ?? '') === 'cookie' && !empty($auth['cookie'])) {
        curl_setopt($ch, CURLOPT_COOKIE, $auth['cookie']);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if (strtoupper($method) === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($postFields !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
    }
    if (function_exists('applyDnsOverrides')) applyDnsOverrides($ch, $url);

    $raw     = curl_exec($ch);
    $code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hdrSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $err     = curl_error($ch);
    curl_close($ch);

    $rawHeaders = $raw !== false ? substr($raw, 0, $hdrSize) : '';
    $body       = $raw !== false ? substr($raw, $hdrSize)    : '';
    $headers    = _parseHeaders($rawHeaders);

    if ($err !== '' || $code === 0 || $code >= 500) {
        hostCooldownMark($host, $err !== '' ? $err : "HTTP $code");
    }
    return ['body' => (string)$body, 'code' => (int)$code, 'err' => (string)$err, 'headers' => $headers];
}

function _parseHeaders(string $raw): array {
    $out = [];
    foreach (preg_split("/\r?\n/", $raw) as $line) {
        $pos = strpos($line, ':');
        if ($pos !== false) {
            $k = strtolower(trim(substr($line, 0, $pos)));
            $v = trim(substr($line, $pos + 1));
            $out[$k] = $v; // last-write-wins is fine for our use
        }
    }
    return $out;
}

/**
 * Fetch a Jenkins CSRF crumb (if the server has crumbs enabled). Returns
 * the header string ready to prepend to a POST, or '' if not needed.
 */
function jenkinsCrumbHeader(array $server): string {
    $base = rtrim($server['base_url'] ?? '', '/');
    if (!$base) return '';
    $out = jenkinsRequestFull($server, $base . '/crumbIssuer/api/json');
    if ($out['code'] !== 200) return '';
    $d = json_decode($out['body'], true);
    if (empty($d['crumbRequestField']) || empty($d['crumb'])) return '';
    return $d['crumbRequestField'] . ': ' . $d['crumb'];
}
