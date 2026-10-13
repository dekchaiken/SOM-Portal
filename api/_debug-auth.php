<?php
/**
 * _debug-auth.php — quick diagnostic for the "why is every endpoint 401?"
 * problem on Apache deploys.
 *
 * Open in browser (must be logged in — browser will attach the Bearer token):
 *   http://<host>/SOM-Portal/api/_debug-auth.php
 *
 * Reports:
 *   1) Whether the Authorization header actually reached PHP (and by which route)
 *   2) Whether helpers.php has the getRequestHeader() fix uploaded
 *   3) Whether the .htaccess env rules are active
 *   4) Whether JWT_SECRET decodes the token successfully
 *
 * DELETE THIS FILE after you're done debugging.
 */

header('Content-Type: application/json; charset=utf-8');

$helpersPath = __DIR__ . '/helpers.php';
$helpersHas  = file_exists($helpersPath)
    ? (str_contains(file_get_contents($helpersPath), 'function getRequestHeader') ? 'yes' : 'no')
    : 'missing';

$htaccessPath = __DIR__ . '/.htaccess';
$htaccessHas = file_exists($htaccessPath)
    ? (str_contains(file_get_contents($htaccessPath), 'HTTP_AUTHORIZATION') ? 'yes' : 'no')
    : 'missing';

// Where can we see the Authorization header?
$sources = [
    'getallheaders()[Authorization]'      => null,
    'getallheaders()[authorization]'      => null,
    '$_SERVER[HTTP_AUTHORIZATION]'        => $_SERVER['HTTP_AUTHORIZATION']          ?? null,
    '$_SERVER[REDIRECT_HTTP_AUTHORIZATION]'=> $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
    'apache_request_headers()[Authorization]' => null,
];
if (function_exists('getallheaders')) {
    $h = getallheaders() ?: [];
    $sources['getallheaders()[Authorization]'] = $h['Authorization'] ?? null;
    $sources['getallheaders()[authorization]'] = $h['authorization'] ?? null;
}
if (function_exists('apache_request_headers')) {
    $ah = apache_request_headers() ?: [];
    $sources['apache_request_headers()[Authorization]'] = $ah['Authorization'] ?? $ah['authorization'] ?? null;
}
// Mask token values so we don't paste secrets into chat
foreach ($sources as $k => $v) {
    if (is_string($v) && strlen($v) > 24) {
        $sources[$k] = substr($v, 0, 20) . '…(' . strlen($v) . ' chars)';
    }
}

// Try to verify the token (only if helpers.php is up to date)
$verify = ['attempted' => false];
if ($helpersHas === 'yes') {
    require_once $helpersPath;
    $auth = getRequestHeader('Authorization');
    $verify['attempted']              = true;
    $verify['header_seen_by_helper']  = $auth !== '' ? substr($auth, 0, 20) . '…' : '(empty)';
    if (str_starts_with($auth, 'Bearer ')) {
        $token   = substr($auth, 7);
        $payload = @jwt_verify($token);
        $verify['token_verified'] = $payload ? 'yes' : 'no';
        if (!$payload) $verify['reason'] = 'jwt_verify returned null — token invalid, expired, or JWT_SECRET mismatch';
        else {
            $verify['user_role'] = $payload['role'] ?? '(missing)';
            $verify['user_team'] = $payload['team'] ?? '(missing)';
        }
    } else {
        $verify['token_verified'] = 'skipped';
        $verify['reason']         = 'no Bearer prefix in Authorization';
    }
}

$diagnosis = [];
if ($helpersHas !== 'yes')  $diagnosis[] = 'helpers.php on server does NOT have getRequestHeader() — re-upload api/helpers.php';
if ($htaccessHas !== 'yes') $diagnosis[] = 'api/.htaccess on server does NOT have HTTP_AUTHORIZATION forward rule — re-upload it';
$allHeaderSourcesEmpty = true;
foreach ($sources as $v) if ($v !== null) { $allHeaderSourcesEmpty = false; break; }
if ($allHeaderSourcesEmpty) {
    $diagnosis[] = 'NO source returned the Authorization header. Apache is stripping it. Fix by:';
    $diagnosis[] = '  a) Ensure /etc/apache2/apache2.conf has "AllowOverride All" for the site directory';
    $diagnosis[] = '  b) Enable modules: sudo a2enmod rewrite headers setenvif && sudo systemctl restart apache2';
    $diagnosis[] = '  c) Verify api/.htaccess was actually uploaded (not just edited locally)';
}
if (empty($diagnosis) && $verify['token_verified'] === 'no') {
    $diagnosis[] = 'Token is being received but does not verify. Likely JWT_SECRET on server changed after login → LOGOUT AND LOGIN AGAIN';
}

echo json_encode([
    'checks' => [
        'helpers.php has getRequestHeader' => $helpersHas,
        '.htaccess has HTTP_AUTHORIZATION' => $htaccessHas,
    ],
    'header_sources'   => $sources,
    'verify_attempt'   => $verify,
    'diagnosis'        => $diagnosis,
    'action_required'  => empty($diagnosis) ? 'None — but you should still be logged in. Try again?' : 'See diagnosis[]',
    '_reminder'        => 'DELETE api/_debug-auth.php after you fix the issue',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
