<?php
/**
 * fundout-proxy.php
 * ─────────────────────────────────────────────────────
 * ?action=save-config  POST { username, password }  → save creds
 * ?action=has-config   GET                          → { configured: bool }
 * ?action=check        GET                          → fund-out data
 *
 * All Keycloak auth is handled server-side (ROPC).
 * The frontend never sees the Bearer token.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── Constants ─────────────────────────────────────────────────────
const KC_TOKEN_URL = 'https://acm-backoffice-aaa.backoffice-a-cloud1p.ascendmoney.io/realms/finops/protocol/openid-connect/token';
const KC_CLIENT    = 'financial-portal-ui';
const PORTAL_API   = 'https://acm-financial-portal.backoffice-a-cloud1p.ascendmoney.io/acm-financial-portal/api/fund-out/report';
const PORTAL_HOME  = 'https://acm-financial-portal.backoffice-a-cloud1p.ascendmoney.io/acm-financial-portal/';
const BANK_CODES   = '001,005,006,008,010,011,017,018,020,022,024,025,026,027,028,030,031,032,033,034,039,045,065,066,067,069,070,071,073';
const CONFIG_FILE  = __DIR__ . '/../data/reconcile-config.json';

// ── Helpers ───────────────────────────────────────────────────────
function fail(int $code, string $msg): never {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function loadConfig(): array {
    if (!file_exists(CONFIG_FILE)) return [];
    $data = json_decode(file_get_contents(CONFIG_FILE), true);
    return is_array($data) ? $data : [];
}

function saveConfig(array $data): void {
    $dir = dirname(CONFIG_FILE);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $result = file_put_contents(CONFIG_FILE, json_encode($data, JSON_PRETTY_PRINT));
    if ($result === false) {
        fail(500, 'Cannot write to ' . CONFIG_FILE . ' — check permissions');
    }
}

function curlPost(string $url, string $body, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $resp   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    return compact('resp', 'status', 'err');
}

function curlGet(string $url, array $headers = [], ?string $jar = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_COOKIEJAR      => $jar,
        CURLOPT_COOKIEFILE     => $jar,
    ]);
    $resp   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    return compact('resp', 'status', 'err');
}

// ── Get Keycloak token via ROPC ───────────────────────────────────
function getToken(string $username, string $password): string {
    $body = http_build_query([
        'grant_type' => 'password',
        'client_id'  => KC_CLIENT,
        'username'   => $username,
        'password'   => $password,
        'scope'      => 'openid profile api_scope email',
    ]);

    $r = curlPost(KC_TOKEN_URL, $body, ['Content-Type: application/x-www-form-urlencoded']);

    if ($r['err']) fail(502, 'Keycloak connection error: ' . $r['err']);

    $json = json_decode($r['resp'], true);

    if ($r['status'] !== 200 || empty($json['access_token'])) {
        $errMsg = $json['error_description'] ?? ($json['error'] ?? 'Login failed');
        $errorCode = $json['error'] ?? 'unknown';
        $details = json_encode($json);
        
        error_log("KEYCLOAK ROPC FAILED: HTTP " . $r['status'] . " | error=" . $errMsg . " | details=" . $details);
        error_log("KEYCLOAK ROPC REQUEST: username=" . $username . " | client=" . KC_CLIENT);
        
        // Show more details for debugging
        $hint = '';
        $solution = '';
        
        if ($errorCode === 'invalid_grant') {
            $hint = ' (รหัสผ่านไม่ถูกต้อง หรือ account ถูกล็อค)';
            $solution = 'ตรวจสอบ username/password ให้ถูกต้อง';
        } elseif ($errorCode === 'invalid_client') {
            $hint = ' (client ไม่ถูกต้อง หรือ ROPC ไม่ได้เปิดใช้งาน)';
            $solution = 'ติดต่อ Keycloak admin เพื่อตรวจสอบ client configuration';
        } elseif ($errorCode === 'unauthorized_client') {
            $hint = ' (client ไม่ได้รับอนุญาตให้ใช้ password grant)';
            $solution = 'ต้องเปิด "Direct Access Grants Enabled" ใน Keycloak Admin Console → Clients → ' . KC_CLIENT . ' → Settings';
        }
        
        $fullMsg = 'Keycloak: ' . $errMsg . $hint;
        if ($solution) {
            $fullMsg .= ' | วิธีแก้: ' . $solution;
        }
        $fullMsg .= ' | Error code: ' . $errorCode . ' | HTTP ' . $r['status'];
        
        fail(401, $fullMsg);
    }

    return $json['access_token'];
}

// ═══════════════════════════════════════════════════════════════════
$action = $_GET['action'] ?? '';

// ── save-config ────────────────────────────────────────────────────
if ($action === 'save-config') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST required');

    $input = json_decode(file_get_contents('php://input'), true);
    if (empty($input['username']) || empty($input['password'])) {
        fail(400, 'username and password required');
    }

    saveConfig([
        'username' => trim($input['username']),
        'password' => $input['password'],
    ]);

    echo json_encode(['ok' => true]);
    exit;
}

// ── has-config ─────────────────────────────────────────────────────
if ($action === 'has-config') {
    $cfg = loadConfig();
    echo json_encode(['configured' => !empty($cfg['username']) && !empty($cfg['password'])]);
    exit;
}

// ── check ──────────────────────────────────────────────────────────
if ($action === 'check') {
    // 1. Get token from Authorization header (sent from frontend)
    $token = null;
    
    // Try multiple ways to get Authorization header
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    } else {
        $authHeader = '';
    }
    
    if (preg_match('/Bearer\s+(.+)/i', $authHeader, $matches)) {
        $token = $matches[1];
    }
    
    if (!$token) {
        error_log('fundout-proxy: No Authorization header found');
        error_log('fundout-proxy: HTTP_AUTHORIZATION = ' . ($_SERVER['HTTP_AUTHORIZATION'] ?? 'not set'));
        error_log('fundout-proxy: REDIRECT_HTTP_AUTHORIZATION = ' . ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? 'not set'));
        fail(401, 'ไม่พบ access token - กรุณา login ที่ ACM Financial Portal ก่อน แล้วลองอีกครั้ง');
    }
    
    error_log('fundout-proxy: Token received, length = ' . strlen($token));

    // 2. Date range — support auto (unix ms) OR manual (formatted string)
    if (!empty($_GET['from_str'])) {
        // Manual dates sent directly as formatted strings (e.g. "17-Apr-2026 00:00:00")
        $requestDateFrom = trim($_GET['from_str']);
        $requestDateTo   = trim($_GET['to_str'] ?? '');
        if (!$requestDateFrom || !$requestDateTo) fail(400, 'Missing from_str/to_str');
    } else {
        $from = $_GET['from'] ?? '';
        $to   = $_GET['to']   ?? '';
        if (!$from || !$to) fail(400, 'Missing from/to (or from_str/to_str for manual dates)');
        $requestDateFrom = $from;
        $requestDateTo   = $to;
    }

    // 3. Overridable filter params (frontend form values, with sensible defaults)
    $reconcileStatus  = $_GET['reconcile_status']  ?? 'New';
    $transferStatus   = $_GET['transfer_status']   ?? 'Success';
    $bankCode         = $_GET['bank_code']         ?? BANK_CODES;
    $requestChannel   = $_GET['request_channel']   ?? '';
    $requestStatus    = $_GET['request_status']    ?? '';
    $tppId            = $_GET['tpp_id']            ?? '';
    $utibaId          = $_GET['utiba_id']          ?? '';
    $ewAccount        = $_GET['ew_account']        ?? '';
    $requestAmount    = $_GET['request_amount']    ?? '';
    $bankAccountNo    = $_GET['bank_account_no']   ?? '';
    $bankAccountName  = $_GET['bank_account_name'] ?? '';
    $limit            = $_GET['length']            ?? '10000';

    // 4. Get XSRF cookie
    $jar = tempnam(sys_get_temp_dir(), 'fo_');
    curlGet(PORTAL_HOME, ["Authorization: Bearer $token"], $jar);

    $xsrf = '';
    if (file_exists($jar)) {
        foreach (file($jar) as $line) {
            if (str_contains($line, 'XSRF-TOKEN')) {
                $parts = preg_split('/\s+/', trim($line));
                $xsrf  = urldecode(end($parts));
                break;
            }
        }
    }

    // 5. Build & call API
    $params = http_build_query([
        'request_date_from'      => $requestDateFrom,
        'request_date_to'        => $requestDateTo,
        'request_channel'        => $requestChannel,
        'request_status'         => $requestStatus,
        'tpp_id'                 => $tppId,
        'utiba_id'               => $utibaId,
        'ew_account'             => $ewAccount,
        'request_amount'         => $requestAmount,
        'transfer_date_from'     => '',
        'transfer_date_to'       => '',
        'transfer_status'        => $transferStatus,
        'bank_code'              => $bankCode,
        'reversal_date_from'     => '',
        'reversal_date_to'       => '',
        'reversal_amount_status' => '',
        'reversal_fee_status'    => '',
        'reconcile_date_from'    => '',
        'reconcile_date_to'      => '',
        'reconcile_status'       => $reconcileStatus,
        'bank_account_no'        => $bankAccountNo,
        'bank_account_name'      => $bankAccountName,
        'start'                  => '0',
        'length'                 => $limit,
    ]);

    $headers = [
        "Authorization: Bearer $token",
        'Accept: application/json, text/plain, */*',
        'Cache-Control: no-cache',
    ];
    if ($xsrf) $headers[] = "x-xsrf-token: $xsrf";

    $r = curlGet(PORTAL_API . '?' . $params, $headers, $jar);
    @unlink($jar);

    if ($r['err']) fail(502, 'API error: ' . $r['err']);

    http_response_code($r['status']);
    echo $r['resp'];
    exit;
}

fail(400, 'Invalid action');
