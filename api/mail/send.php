<?php
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_branding.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
$payload = requireAuth();
$body    = getBody();

// ── Load config ────────────────────────────────────────────
$cfg = readJson('mail_config.json');

if (empty($cfg['smtp_host']))  respondError('SMTP host ยังไม่ได้ตั้งค่า — ไปที่ Admin → Mail Config', 400);
if (empty($cfg['from_email'])) respondError('From Email ยังไม่ได้ตั้งค่า — ไปที่ Admin → Mail Config', 400);

// ── Validate recipients ────────────────────────────────────
$toRaw = array_values(array_filter(
    array_map('trim', (array)($body['to'] ?? [])),
    fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
));
$ccRaw = array_values(array_filter(
    array_map('trim', (array)($body['cc'] ?? [])),
    fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
));
$bccRaw = array_values(array_filter(
    array_map('trim', (array)($body['bcc'] ?? [])),
    fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
));

if (!$toRaw) respondError('ระบุอีเมลผู้รับ (To) อย่างน้อย 1 ที่อยู่', 400);

$subject = trim($body['subject'] ?? '');
$text    = trim($body['body']    ?? '');
$isHtml  = (bool)($body['isHtml'] ?? false);

if (!$subject) respondError('กรุณาระบุ Subject', 400);
if (!$text)    respondError('กรุณาระบุเนื้อหา Email', 400);

// ── Build MIME message ─────────────────────────────────────
$fromName  = $cfg['from_name'] ?? 'SOM-Portal';
$fromEmail = $cfg['from_email'];
$date      = date('r');   // RFC 2822

// Encode UTF-8 header values (RFC 2047 Q-encoding)
function encodeHeader(string $str): string {
    if (!preg_match('/[^\x20-\x7E]/', $str)) return $str;   // ASCII-safe: no encoding needed
    return '=?UTF-8?B?' . base64_encode($str) . '?=';
}

$encFromName = encodeHeader($fromName);
$encSubject  = encodeHeader($subject);
$toHeader    = implode(', ', $toRaw);
$ccHeader    = implode(', ', $ccRaw);
$bccHeader   = implode(', ', $bccRaw);
$msgId       = '<' . uniqid() . '@' . $_SERVER['HTTP_HOST'] . '>';
$boundary    = 'boundary_' . md5(uniqid(mt_rand(), true));

// Build MIME content based on email type
if ($isHtml) {
    $htmlBody = $text;

    // Extract all base64 images and replace with CID references
    $images = [];
    $imageCounter = 0;
    $htmlBody = preg_replace_callback(
        '/src="data:image\/([^"]+);base64,([^"]+)"/i',
        function($matches) use (&$images, &$imageCounter, $boundary) {
            $imageCounter++;
            $cid = "image{$imageCounter}@mail";
            $images[$cid] = [
                'type' => $matches[1],
                'data' => $matches[2]
            ];
            return "src=\"cid:{$cid}\"";
        },
        $htmlBody
    );

    // ── Apply branded template ──────────────────────────────────
    // Uses the admin-configurable gradient template (admin/mail-config.html →
    // Branded Email Template). Bauhaus-D is reserved for transactional
    // emails routed through _templates.php (email-noti, welcome, reset, etc.).
    $useBrand = !empty($body['useBranding']) || !array_key_exists('useBranding', $body);
    $htmlBody = buildGradientEmail($htmlBody, $subject, $cfg, $useBrand);

    // Auto-attach the SM animated logo when Typewriter footer is selected AND
    // no public base URL is configured. When a public URL is set, the footer
    // references the GIF via <img src="https://…"> and no attachment is needed
    // (avoids Gmail's inline-attachment chip in the message header).
    $hasPublicUrl = trim((string)($cfg['email_public_base_url'] ?? '')) !== '';
    if ($useBrand && !$hasPublicUrl && trim((string)($cfg['email_footer_style'] ?? '')) === 'typewriter') {
        $logoPath = realpath(__DIR__ . '/../../uploads/sm-logo-typewriter.gif');
        if ($logoPath && is_readable($logoPath)) {
            $bin = @file_get_contents($logoPath);
            if ($bin !== false) {
                $images['sm-logo-typewriter'] = [
                    'type' => 'gif',
                    'data' => base64_encode($bin),
                ];
            }
        }
    }

    // Build multipart MIME with embedded images
    if (!empty($images)) {
        // multipart/related for images
        $htmlB64 = chunk_split(base64_encode($htmlBody));
        
        $mime  = "Date: {$date}\r\n";
        $mime .= "Message-ID: {$msgId}\r\n";
        $mime .= "X-Entity-Ref-ID: " . uniqid('smc_', true) . "\r\n";
        $mime .= "Thread-Index: " . base64_encode(random_bytes(22)) . "\r\n";
        $mime .= "From: {$encFromName} <{$fromEmail}>\r\n";
        $mime .= "To: {$toHeader}\r\n";
        if ($ccHeader) $mime .= "Cc: {$ccHeader}\r\n";
        $mime .= "Subject: {$encSubject}\r\n";
        $mime .= "MIME-Version: 1.0\r\n";
        $mime .= "Content-Type: multipart/related; boundary=\"{$boundary}\"\r\n";
        $mime .= "\r\n";
        
        // HTML part
        $mime .= "--{$boundary}\r\n";
        $mime .= "Content-Type: text/html; charset=UTF-8\r\n";
        $mime .= "Content-Transfer-Encoding: base64\r\n";
        $mime .= "\r\n";
        $mime .= $htmlB64;
        
        // Image attachments — name/filename prevents Gmail showing "noname" chips
        foreach ($images as $cid => $imgData) {
            $imgB64 = chunk_split($imgData['data']);
            $fname  = ($cid === 'sm-logo-typewriter')
                ? 'sm-logo.gif'
                : preg_replace('/[^a-zA-Z0-9._-]/', '_', "img-{$cid}.{$imgData['type']}");
            $mime .= "\r\n--{$boundary}\r\n";
            $mime .= "Content-Type: image/{$imgData['type']}; name=\"{$fname}\"\r\n";
            $mime .= "Content-Transfer-Encoding: base64\r\n";
            $mime .= "Content-ID: <{$cid}>\r\n";
            $mime .= "Content-Disposition: inline; filename=\"{$fname}\"\r\n";
            $mime .= "\r\n";
            $mime .= $imgB64;
        }
        
        $mime .= "\r\n--{$boundary}--\r\n";
    } else {
        // No images - simple HTML
        $bodyB64 = chunk_split(base64_encode($htmlBody));
        $mime  = "Date: {$date}\r\n";
        $mime .= "Message-ID: {$msgId}\r\n";
        $mime .= "X-Entity-Ref-ID: " . uniqid('smc_', true) . "\r\n";
        $mime .= "Thread-Index: " . base64_encode(random_bytes(22)) . "\r\n";
        $mime .= "From: {$encFromName} <{$fromEmail}>\r\n";
        $mime .= "To: {$toHeader}\r\n";
        if ($ccHeader) $mime .= "Cc: {$ccHeader}\r\n";
        $mime .= "Subject: {$encSubject}\r\n";
        $mime .= "MIME-Version: 1.0\r\n";
        $mime .= "Content-Type: text/html; charset=UTF-8\r\n";
        $mime .= "Content-Transfer-Encoding: base64\r\n";
        $mime .= "Content-Disposition: inline\r\n";
        $mime .= "\r\n";
        $mime .= $bodyB64;
    }
} else {
    $bodyB64 = chunk_split(base64_encode($text));
    $mime  = "Date: {$date}\r\n";
    $mime .= "Message-ID: {$msgId}\r\n";
    $mime .= "X-Entity-Ref-ID: " . uniqid('smc_', true) . "\r\n";
    $mime .= "Thread-Index: " . base64_encode(random_bytes(22)) . "\r\n";
    $mime .= "From: {$encFromName} <{$fromEmail}>\r\n";
    $mime .= "To: {$toHeader}\r\n";
    if ($ccHeader) $mime .= "Cc: {$ccHeader}\r\n";
    $mime .= "Subject: {$encSubject}\r\n";
    $mime .= "MIME-Version: 1.0\r\n";
    $mime .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $mime .= "Content-Transfer-Encoding: base64\r\n";
    $mime .= "\r\n";
    $mime .= $bodyB64;
}

// ── File attachments ──────────────────────────────────────────────
$attachments = is_array($body['attachments'] ?? null) ? $body['attachments'] : [];
if (!empty($attachments)) {
    $outerBound = 'outer_' . md5(uniqid(mt_rand(), true));

    // Parse existing mime to extract headers and body
    $headerEnd = strpos($mime, "\r\n\r\n");
    $existingHeaders = substr($mime, 0, $headerEnd);
    $existingBody    = substr($mime, $headerEnd + 4);

    // Extract Content-Type and Content-Transfer-Encoding from inner headers
    preg_match('/Content-Type:\s*(.+?)(?:\r\n(?!\s)|$)/si', $existingHeaders, $ctMatch);
    $innerContentType = trim($ctMatch[1] ?? 'text/plain; charset=UTF-8');

    preg_match('/Content-Transfer-Encoding:\s*(.+?)(?:\r\n|$)/i', $existingHeaders, $cteMatch);
    $innerCTE = trim($cteMatch[1] ?? '');

    preg_match('/Content-Disposition:\s*(.+?)(?:\r\n|$)/i', $existingHeaders, $cdMatch);
    $innerCD = trim($cdMatch[1] ?? '');

    // Build new outer MIME
    $newMime  = "Date: {$date}\r\n";
    $newMime .= "Message-ID: {$msgId}\r\n";
    $newMime .= "X-Entity-Ref-ID: " . uniqid('smc_', true) . "\r\n";
    $newMime .= "Thread-Index: " . base64_encode(random_bytes(22)) . "\r\n";
    $newMime .= "From: {$encFromName} <{$fromEmail}>\r\n";
    $newMime .= "To: {$toHeader}\r\n";
    if ($ccHeader) $newMime .= "Cc: {$ccHeader}\r\n";
    $newMime .= "Subject: {$encSubject}\r\n";
    $newMime .= "MIME-Version: 1.0\r\n";
    $newMime .= "Content-Type: multipart/mixed; boundary=\"{$outerBound}\"\r\n";
    $newMime .= "\r\n";

    // Body part — preserve all original encoding headers
    $newMime .= "--{$outerBound}\r\n";
    $newMime .= "Content-Type: {$innerContentType}\r\n";
    if ($innerCTE) $newMime .= "Content-Transfer-Encoding: {$innerCTE}\r\n";
    if ($innerCD)  $newMime .= "Content-Disposition: {$innerCD}\r\n";
    $newMime .= "\r\n";
    $newMime .= $existingBody;

    // Attachment parts
    foreach ($attachments as $att) {
        $attFilename = basename($att['filename'] ?? 'attachment.bin');
        $attMime     = $att['mime']     ?? 'application/octet-stream';
        $attData     = $att['data']     ?? '';
        if (!$attData) continue;

        $attB64 = chunk_split($attData); // already base64 from frontend
        $newMime .= "\r\n--{$outerBound}\r\n";
        $newMime .= "Content-Type: {$attMime}; name=\"{$attFilename}\"\r\n";
        $newMime .= "Content-Transfer-Encoding: base64\r\n";
        $newMime .= "Content-Disposition: attachment; filename=\"{$attFilename}\"\r\n";
        $newMime .= "\r\n";
        $newMime .= $attB64;
    }

    $newMime .= "\r\n--{$outerBound}--\r\n";
    $mime = $newMime;
}

// ── Stream for curl ────────────────────────────────────────
$fp = fopen('php://temp', 'r+');
fwrite($fp, $mime);
rewind($fp);

// ── Build SMTP URL ─────────────────────────────────────────
$enc  = $cfg['smtp_encryption'] ?? 'tls';
$host = $cfg['smtp_host'];
$port = (int)($cfg['smtp_port'] ?? 587);
$url  = ($enc === 'ssl') ? "smtps://{$host}:{$port}" : "smtp://{$host}:{$port}";

// All recipients (curl needs a flat list — To + CC + BCC)
$allRecipients = array_map(fn($e) => "<{$e}>", array_merge($toRaw, $ccRaw, $bccRaw));

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_MAIL_FROM      => "<{$fromEmail}>",
    CURLOPT_MAIL_RCPT      => $allRecipients,
    CURLOPT_READDATA       => $fp,
    CURLOPT_UPLOAD         => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_TIMEOUT        => 20,
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
$curlCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);   // usually 0 for SMTP
curl_close($ch);
fclose($fp);

// ── Write mail log ────────────────────────────────────────
function writeMailLog(array $payload, array $to, array $cc, string $subject, string $type, string $status, string $error = ''): void {
    $logs   = readJson('mail_logs.json');
    $logs[] = [
        'id'           => 'ml_' . substr(md5(uniqid(mt_rand(), true)), 0, 10),
        'sent_at'      => date('Y-m-d\TH:i:sP'),
        'to'           => $to,
        'cc'           => $cc,
        'subject'      => mb_substr($subject, 0, 200),
        'type'         => $type,
        'status'       => $status,
        'error'        => $error,
        'sent_by'      => $payload['sub']  ?? '',
        'sent_by_name' => $payload['name'] ?? '',
    ];
    if (count($logs) > 2000) $logs = array_slice($logs, -2000);
    writeJson('mail_logs.json', $logs);
}

if ($curlErr) {
    writeMailLog($payload, $toRaw, $ccRaw, $subject, $isHtml ? 'html' : 'plain', 'failed', $curlErr);
    respondError('ส่ง Email ไม่สำเร็จ: ' . $curlErr, 502);
}

writeMailLog($payload, $toRaw, $ccRaw, $subject, $isHtml ? 'html' : 'plain', 'sent');
logActivity('email_sent', [
    'to'      => implode(',', $toRaw),
    'cc'      => implode(',', $ccRaw),
    'subject' => mb_substr($subject, 0, 100),
    'type'    => $isHtml ? 'html' : 'plain',
], $payload['sub'], $payload['name'] ?? '');

respondOk(['sent' => true, 'to_count' => count($toRaw), 'cc_count' => count($ccRaw)]);
