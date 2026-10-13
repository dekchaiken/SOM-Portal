<?php
// Simple SMTP test endpoint — sends plain text only
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);

requireAuth();

$body = getBody();
$to = trim($body['to'] ?? '');

if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    respondError('Invalid email address', 400);
}

// Load SMTP config
$cfg = readJson('mail_config.json');

if (empty($cfg['smtp_host']))  respondError('SMTP ยังไม่ได้ตั้งค่า', 503);
if (empty($cfg['from_email'])) respondError('From Email ยังไม่ได้ตั้งค่า', 503);

$fromName  = $cfg['from_name'] ?? 'SOM-Portal';
$fromEmail = $cfg['from_email'];
$date      = date('r');

// Simple plain text test message
$subject = '[TEST] SOM-Portal Mail Config Test';
$text    = "นี่คือ email ทดสอบจาก SOM-Portal\n\n";
$text   .= "ถ้าได้รับ email นี้แสดงว่า SMTP ตั้งค่าถูกต้องแล้ว ✅\n\n";
$text   .= "---\n";
$text   .= "From: {$fromName} <{$fromEmail}>\n";
$text   .= "Time: " . date('Y-m-d H:i:s') . "\n";

// Encode UTF-8 headers
function encodeHeader(string $str): string {
    if (!preg_match('/[^\x20-\x7E]/', $str)) return $str;
    return '=?UTF-8?B?' . base64_encode($str) . '?=';
}

$encFromName = encodeHeader($fromName);
$encSubject  = encodeHeader($subject);
$bodyB64     = chunk_split(base64_encode($text));

// Build plain MIME
$mime  = "Date: {$date}\r\n";
$mime .= "From: {$encFromName} <{$fromEmail}>\r\n";
$mime .= "To: {$to}\r\n";
$mime .= "Subject: {$encSubject}\r\n";
$mime .= "MIME-Version: 1.0\r\n";
$mime .= "Content-Type: text/plain; charset=UTF-8\r\n";
$mime .= "Content-Transfer-Encoding: base64\r\n";
$mime .= "\r\n";
$mime .= $bodyB64;

// Stream for curl
$fp = fopen('php://temp', 'r+');
fwrite($fp, $mime);
rewind($fp);

// Build SMTP connection
$enc  = $cfg['smtp_encryption'] ?? 'tls';
$host = $cfg['smtp_host'];
$port = (int)($cfg['smtp_port'] ?? 587);
$url  = ($enc === 'ssl') ? "smtps://{$host}:{$port}" : "smtp://{$host}:{$port}";

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_MAIL_FROM      => "<{$fromEmail}>",
    CURLOPT_MAIL_RCPT      => ["<{$to}>"],
    CURLOPT_READDATA       => $fp,
    CURLOPT_UPLOAD         => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_VERBOSE        => false,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_TIMEOUT        => 15,
]);

if (!empty($cfg['smtp_user'])) {
    curl_setopt($ch, CURLOPT_USERNAME, $cfg['smtp_user']);
    curl_setopt($ch, CURLOPT_PASSWORD, $cfg['smtp_password'] ?? '');
}
if ($enc === 'tls') {
    curl_setopt($ch, CURLOPT_USE_SSL, CURLUSESSL_ALL);
}

curl_exec($ch);
$curlErr  = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
fclose($fp);

if ($curlErr) {
    respondError('SMTP Error: ' . $curlErr, 502);
}

logActivity('test_email_sent', [
    'to'     => $to,
    'smtp'   => "{$host}:{$port}",
], null, 'SMTP Test');

respondOk(['sent' => true, 'to' => $to, 'message' => 'Test email sent']);
