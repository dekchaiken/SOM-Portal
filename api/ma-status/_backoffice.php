<?php
// ══════════════════════════════════════════════════════════════════
//  ACM Backoffice (Admin Portal) shared client
//  Used by both ma-status (read) and ma-services (write). Auth is a
//  Keycloak password grant with the shared SM service account
//  configured in .env (BACKOFFICE_USERNAME/PASSWORD). Access token is
//  cached at data/{team}/backoffice-token.json until 60s before exp.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';

const BACKOFFICE_TOKEN_FILE   = 'backoffice-token.json';
const BACKOFFICE_DEFAULT_GW   = 'https://backoffice-gateway.truemoney.com';
const BACKOFFICE_DEFAULT_TOK  = 'https://api-backoffice-aaa.truemoney.com/auth/realms/backoffice/protocol/openid-connect/token';

function backofficeGatewayUrl(): string {
    return envFallback('BACKOFFICE_GATEWAY_URL') ?: BACKOFFICE_DEFAULT_GW;
}

/**
 * Obtain a Bearer token for the shared SM service account. Uses a per-team
 * cache to avoid re-hitting Keycloak on every request. Returns null when
 * credentials are missing or Keycloak rejects the login.
 */
function backofficeToken(): ?string {
    $now   = time();
    $cache = readJson(BACKOFFICE_TOKEN_FILE);
    if (!empty($cache['access_token']) && !empty($cache['exp']) && ($cache['exp'] - $now) > 60) {
        return $cache['access_token'];
    }
    $user   = envFallback('BACKOFFICE_USERNAME');
    $pass   = envFallback('BACKOFFICE_PASSWORD');
    $client = envFallback('BACKOFFICE_CLIENT_ID') ?: 'backofficeui';
    $tokUrl = envFallback('BACKOFFICE_TOKEN_URL') ?: BACKOFFICE_DEFAULT_TOK;
    if (!$user || !$pass) return null;

    $host = hostFromUrl($tokUrl);
    if ($host && hostCooldownActive($host)) return null;

    $ch = curl_init($tokUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_POSTFIELDS     => http_build_query([
            'grant_type' => 'password',
            'client_id'  => $client,
            'username'   => $user,
            'password'   => $pass,
        ]),
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($err || $code >= 500) {
        if ($host) hostCooldownMark($host, $err ?: "HTTP $code");
        return null;
    }
    if ($code !== 200 || !$body) return null;
    $d = json_decode($body, true) ?? [];
    if (empty($d['access_token'])) return null;

    writeJson(BACKOFFICE_TOKEN_FILE, [
        'access_token' => $d['access_token'],
        'exp'          => $now + (int)($d['expires_in'] ?? 900),
        'saved_at'     => $now,
    ]);
    return $d['access_token'];
}

/**
 * Generic authenticated call to the backoffice gateway.
 *   backofficeCall('GET',  '/…/config/use-cases/search?pageSize=500');
 *   backofficeCall('PUT',  "/…/config/use-cases/$id", ['ma_enable' => true]);
 *
 * Returns:
 *   ['ok'=>bool, 'code'=>int, 'data'=>mixed, 'error'=>?string, 'body'=>string]
 * Honors the host-cooldown circuit breaker so a dead upstream does not
 * pile up 15-second timeouts across every PHP-FPM worker.
 */
function backofficeCall(string $method, string $path, ?array $body = null, int $timeout = 15): array {
    $token = backofficeToken();
    if (!$token) {
        return ['ok' => false, 'code' => 0, 'data' => null, 'body' => '',
                'error' => 'No token (missing BACKOFFICE_USERNAME/PASSWORD in .env?)'];
    }
    $url  = backofficeGatewayUrl() . $path;
    $host = hostFromUrl($url);
    if ($host && ($cd = hostCooldownActive($host))) {
        return ['ok' => false, 'code' => 0, 'data' => null, 'body' => '',
                'error' => 'cooldown: ' . $cd['reason']];
    }

    $headers = [
        "Authorization: Bearer $token",
        'Accept: application/json',
    ];
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE);
        $headers[] = 'Content-Type: application/json';
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);

    $raw  = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($err || $code >= 500) {
        if ($host) hostCooldownMark($host, $err ?: "HTTP $code");
        return ['ok' => false, 'code' => (int)$code, 'data' => null, 'body' => (string)$raw,
                'error' => $err ?: "Backoffice HTTP $code"];
    }
    $decoded = $raw ? json_decode($raw, true) : null;
    if ($code >= 400) {
        // Surface as much detail as possible so the caller can diagnose 400s
        // (unknown field, wrong method, bad payload shape, etc.) without
        // needing to tail server logs.
        $msg = "HTTP $code";
        if (is_array($decoded)) {
            $msg = $decoded['message']
                ?? $decoded['error']
                ?? $decoded['errorMessage']
                ?? ($decoded['errors'][0]['message'] ?? null)
                ?? "HTTP $code";
        }
        // Append truncated raw body — helps diagnose non-JSON errors and
        // JSON errors that use unexpected field names (e.g. "detail").
        $bodyPreview = mb_substr(trim((string)$raw), 0, 400);
        if ($bodyPreview !== '' && strpos((string)$msg, $bodyPreview) === false) {
            $msg .= ' | body: ' . $bodyPreview;
        }
        return ['ok' => false, 'code' => (int)$code, 'data' => $decoded, 'body' => (string)$raw,
                'error' => (string)$msg];
    }
    return ['ok' => true, 'code' => (int)$code, 'data' => $decoded, 'body' => (string)$raw, 'error' => null];
}
