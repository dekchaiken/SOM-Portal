<?php
/**
 * mail/test-connection.php
 * POST {} → ทดสอบ SMTP connection + TLS + auth โดยไม่ส่ง email จริง
 *
 * Steps: TCP connect → EHLO → STARTTLS (if tls) → AUTH LOGIN → QUIT
 * Returns: { ok, steps: [{label, ok, detail}] }
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$cfg = readJson('mail_config.json');

if (empty($cfg['smtp_host'])) respondError('SMTP host ยังไม่ได้ตั้งค่า', 400);

$host = $cfg['smtp_host'];
$port = (int)($cfg['smtp_port'] ?? 587);
$enc  = $cfg['smtp_encryption'] ?? 'tls';
$user = $cfg['smtp_user']     ?? '';
$pass = $cfg['smtp_password'] ?? '';

$steps   = [];
$timeout = 10;

// ── Helper: read SMTP multi-line response ──────────────────
function smtpRead($sock): string {
    $buf = '';
    while ($line = fgets($sock, 512)) {
        $buf .= $line;
        if (strlen($line) >= 4 && $line[3] === ' ') break; // last line
    }
    return $buf;
}

// ── Step 1: TCP connect ────────────────────────────────────
$proto = ($enc === 'ssl') ? 'ssl://' : '';
$errno = 0; $errstr = '';
$sock  = @stream_socket_client("{$proto}{$host}:{$port}", $errno, $errstr, $timeout,
    STREAM_CLIENT_CONNECT, stream_context_create([
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]
    ])
);

if (!$sock) {
    $steps[] = ['label' => "เชื่อมต่อ {$host}:{$port}", 'ok' => false,
                'detail' => $errstr ? "{$errstr} (error {$errno})" : "Connection refused"];
    respondOk(['ok' => false, 'steps' => $steps]);
}
stream_set_timeout($sock, $timeout);

// Read greeting
$greeting = smtpRead($sock);
$greetOk  = str_starts_with($greeting, '220');
$steps[]  = [
    'label'  => ($enc === 'ssl') ? "เชื่อมต่อ SMTPS {$host}:{$port}" : "เชื่อมต่อ {$host}:{$port}",
    'ok'     => $greetOk,
    'detail' => $greetOk ? trim(substr($greeting, 4)) : "ไม่ได้รับ 220 greeting: " . trim($greeting),
];
if (!$greetOk) { fclose($sock); respondOk(['ok' => false, 'steps' => $steps]); }

// ── Step 2: EHLO ───────────────────────────────────────────
fwrite($sock, "EHLO centralize-sm\r\n");
$ehloResp = smtpRead($sock);
$ehloOk   = str_starts_with($ehloResp, '250');
$steps[]  = [
    'label'  => 'EHLO handshake',
    'ok'     => $ehloOk,
    'detail' => $ehloOk ? 'Server capabilities received' : "EHLO failed: " . trim(substr($ehloResp, 0, 120)),
];
if (!$ehloOk) { fclose($sock); respondOk(['ok' => false, 'steps' => $steps]); }

// ── Step 3: STARTTLS (only for tls encryption) ─────────────
if ($enc === 'tls') {
    fwrite($sock, "STARTTLS\r\n");
    $tlsResp = smtpRead($sock);
    $tlsReady = str_starts_with($tlsResp, '220');
    if (!$tlsReady) {
        $steps[] = ['label' => 'STARTTLS', 'ok' => false,
                    'detail' => "Server ไม่รองรับ STARTTLS: " . trim($tlsResp)];
        fclose($sock); respondOk(['ok' => false, 'steps' => $steps]);
    }

    $upgraded = @stream_socket_enable_crypto($sock, true,
        STREAM_CRYPTO_METHOD_TLS_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT
    );
    $steps[] = [
        'label'  => 'STARTTLS / TLS upgrade',
        'ok'     => (bool)$upgraded,
        'detail' => $upgraded ? 'TLS สำเร็จ — การสื่อสารเข้ารหัสแล้ว' : 'TLS handshake ล้มเหลว (ลอง encryption = SSL หรือ None)',
    ];
    if (!$upgraded) { fclose($sock); respondOk(['ok' => false, 'steps' => $steps]); }

    // Re-EHLO after TLS
    fwrite($sock, "EHLO centralize-sm\r\n");
    smtpRead($sock); // discard
}

// ── Step 4: AUTH (only if username is set) ─────────────────
if ($user) {
    fwrite($sock, "AUTH LOGIN\r\n");
    $resp = smtpRead($sock);
    if (!str_starts_with($resp, '334')) {
        $steps[] = ['label' => 'AUTH LOGIN', 'ok' => false,
                    'detail' => "Server ไม่รองรับ AUTH LOGIN: " . trim($resp)];
        fclose($sock); respondOk(['ok' => false, 'steps' => $steps]);
    }

    fwrite($sock, base64_encode($user) . "\r\n");
    $resp = smtpRead($sock);
    if (!str_starts_with($resp, '334')) {
        $steps[] = ['label' => 'ส่ง Username', 'ok' => false,
                    'detail' => "Username rejected: " . trim($resp)];
        fclose($sock); respondOk(['ok' => false, 'steps' => $steps]);
    }

    fwrite($sock, base64_encode($pass) . "\r\n");
    $authResp = smtpRead($sock);
    $authOk   = str_starts_with($authResp, '235');
    $steps[]  = [
        'label'  => "ยืนยันตัวตน ({$user})",
        'ok'     => $authOk,
        'detail' => $authOk ? 'Authentication succeeded ✓' : "รหัสผ่านไม่ถูกต้อง: " . trim($authResp),
    ];
    if (!$authOk) { fclose($sock); respondOk(['ok' => false, 'steps' => $steps]); }
} else {
    $steps[] = ['label' => 'Authentication', 'ok' => true, 'detail' => 'ข้ามขั้นตอน — ไม่ได้ตั้งค่า username'];
}

// ── Done ───────────────────────────────────────────────────
fwrite($sock, "QUIT\r\n");
fclose($sock);

respondOk(['ok' => true, 'steps' => $steps]);
