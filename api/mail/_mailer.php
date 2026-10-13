<?php
/**
 * Internal SMTP send helper — for use by other PHP endpoints (NOT by
 * the public /api/mail/send.php endpoint, which has its own request/response
 * code path). Logs to data/mail_logs.json.
 *
 *   sendMailInternal($to, $subject, $htmlBody, $opts = []): array
 *     $to        string|array of recipient email(s)
 *     $subject   email subject
 *     $htmlBody  full HTML body (already wrapped by buildBrandedEmail() or _templates.php)
 *     $opts      [
 *                  'cc'            => string|array,
 *                  'sent_by'       => user_id of triggering admin (or 'system')
 *                  'sent_by_name'  => display name
 *                  'log_type'      => mail_logs.json type tag (default 'transactional')
 *                  'log_meta'      => array of extra fields to store on the log entry
 *                  'inline_images' => [cid_key => absolute_file_path]  // referenced as <img src="cid:key">
 *                ]
 *   returns ['ok' => bool, 'error' => string|null]
 *
 * When the current team's mail_config has email_footer_style === 'typewriter',
 * the SM animated logo (uploads/sm-logo-typewriter.gif) is auto-added to
 * inline_images under the CID "sm-logo-typewriter" so the Typewriter footer's
 * <img src="cid:sm-logo-typewriter"> resolves. Callers don't need to know.
 */

/** Best-effort MIME type from file extension for inline email attachments. */
function _mimeTypeFor(string $path): string
{
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    static $map = [
        'gif' => 'image/gif',  'png' => 'image/png',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'webp' => 'image/webp', 'svg' => 'image/svg+xml',
    ];
    return $map[$ext] ?? 'application/octet-stream';
}

function sendMailInternal($to, string $subject, string $htmlBody, array $opts = []): array
{
    $cfg = readJson('mail_config.json');
    if (empty($cfg['smtp_host']) || empty($cfg['from_email'])) {
        return ['ok' => false, 'error' => 'SMTP host or from_email not configured'];
    }

    // Normalize recipients
    $toList = is_array($to) ? $to : [$to];
    $toList = array_values(array_filter(array_map('trim', $toList),
        fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
    if (!$toList) return ['ok' => false, 'error' => 'No valid recipient'];

    $ccList = (array)($opts['cc'] ?? []);
    $ccList = array_values(array_filter(array_map('trim', $ccList),
        fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));

    $bccList = (array)($opts['bcc'] ?? []);
    $bccList = array_values(array_filter(array_map('trim', $bccList),
        fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));

    if (!$subject || !$htmlBody) {
        return ['ok' => false, 'error' => 'Subject and body are required'];
    }

    // RFC 2047 Q-encode non-ASCII headers
    $enc = function (string $s): string {
        if (!preg_match('/[^\x20-\x7E]/', $s)) return $s;
        return '=?UTF-8?B?' . base64_encode($s) . '?=';
    };

    $fromName  = $cfg['from_name'] ?? 'SOM-Portal';
    $fromEmail = $cfg['from_email'];
    $host      = $_SERVER['HTTP_HOST'] ?? 'som-portal.local';
    $msgId     = '<' . uniqid('tx_') . '@' . $host . '>';

    // Auto-inject SM Typewriter logo when the footer style calls for it, unless
    // the caller explicitly opted out via 'inline_images' => false.
    $inlineImages = (isset($opts['inline_images']) && is_array($opts['inline_images']))
        ? $opts['inline_images'] : [];
    if (!array_key_exists('inline_images', $opts) || $opts['inline_images'] !== false) {
        $footerStyle = trim((string)($cfg['email_footer_style'] ?? 'classic'));
        $hasPublicUrl = trim((string)($cfg['email_public_base_url'] ?? '')) !== '';
        // Only attach as CID when there's no public URL — otherwise the footer
        // HTML references the GIF via an external <img src> and no attachment
        // is needed (avoids Gmail's inline-attachment chip).
        if ($footerStyle === 'typewriter' && !$hasPublicUrl) {
            $logoPath = realpath(__DIR__ . '/../../uploads/sm-logo-typewriter.gif');
            if ($logoPath && is_readable($logoPath) && !isset($inlineImages['sm-logo-typewriter'])) {
                $inlineImages['sm-logo-typewriter'] = $logoPath;
            }
        }
    }

    // Build the MIME body. If we have inline images we wrap in multipart/related,
    // otherwise we keep the original single-part text/html to preserve behavior.
    $headers  = "Date: " . date('r') . "\r\n";
    $headers .= "Message-ID: {$msgId}\r\n";
    $headers .= "X-Entity-Ref-ID: " . uniqid('smc_', true) . "\r\n";
    $headers .= "From: " . $enc($fromName) . " <{$fromEmail}>\r\n";
    $headers .= "To: " . implode(', ', $toList) . "\r\n";
    if ($ccList)  $headers .= "Cc: "  . implode(', ', $ccList)  . "\r\n";
    if ($bccList) $headers .= "Bcc: " . implode(', ', $bccList) . "\r\n";
    $headers .= "Subject: " . $enc($subject) . "\r\n";
    $headers .= "MIME-Version: 1.0\r\n";

    if (empty($inlineImages)) {
        $mime  = $headers;
        $mime .= "Content-Type: text/html; charset=UTF-8\r\n";
        $mime .= "Content-Transfer-Encoding: base64\r\n";
        $mime .= "Content-Disposition: inline\r\n";
        $mime .= "\r\n";
        $mime .= chunk_split(base64_encode($htmlBody));
    } else {
        $boundary = '=_smc_' . bin2hex(random_bytes(10)) . '=';
        $mime  = $headers;
        $mime .= "Content-Type: multipart/related; boundary=\"{$boundary}\"; type=\"text/html\"\r\n";
        $mime .= "\r\n";
        // ── HTML part ─────────────────────────────────────────────
        $mime .= "--{$boundary}\r\n";
        $mime .= "Content-Type: text/html; charset=UTF-8\r\n";
        $mime .= "Content-Transfer-Encoding: base64\r\n";
        $mime .= "Content-Disposition: inline\r\n";
        $mime .= "\r\n";
        $mime .= chunk_split(base64_encode($htmlBody));
        $mime .= "\r\n";
        // ── Inline image parts ────────────────────────────────────
        foreach ($inlineImages as $cid => $path) {
            if (!is_string($path) || !is_readable($path)) continue;
            $bin  = @file_get_contents($path);
            if ($bin === false) continue;
            $mtype = _mimeTypeFor($path);
            $fname = basename($path);
            $cidSafe = preg_replace('/[^a-zA-Z0-9._-]/', '', $cid);
            $mime .= "--{$boundary}\r\n";
            $mime .= "Content-Type: {$mtype}; name=\"{$fname}\"\r\n";
            $mime .= "Content-Transfer-Encoding: base64\r\n";
            $mime .= "Content-ID: <{$cidSafe}>\r\n";
            $mime .= "Content-Disposition: inline; filename=\"{$fname}\"\r\n";
            $mime .= "\r\n";
            $mime .= chunk_split(base64_encode($bin));
            $mime .= "\r\n";
        }
        $mime .= "--{$boundary}--\r\n";
    }

    // Stream for curl SMTP
    $fp = fopen('php://temp', 'r+');
    fwrite($fp, $mime);
    rewind($fp);

    $smtpEnc = $cfg['smtp_encryption'] ?? 'tls';
    $smtpUrl = ($smtpEnc === 'ssl' ? 'smtps://' : 'smtp://') . $cfg['smtp_host'] . ':' . (int)($cfg['smtp_port'] ?? 587);

    $allRcpts = array_map(fn($e) => "<{$e}>", array_merge($toList, $ccList));

    $ch = curl_init($smtpUrl);
    curl_setopt_array($ch, [
        CURLOPT_MAIL_FROM      => "<{$fromEmail}>",
        CURLOPT_MAIL_RCPT      => $allRcpts,
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
    if ($smtpEnc === 'tls') curl_setopt($ch, CURLOPT_USE_SSL, CURLUSESSL_ALL);

    curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fp);

    if ($err) {
        logIntegrationError('smtp', $smtpUrl, $err, [
            'to_count' => count($toList),
            'cc_count' => count($ccList),
            'subject'  => mb_substr($subject, 0, 100),
        ]);
    }

    // ── Append to mail_logs.json (capped at 2000 entries) ────────────
    $logs = readJson('mail_logs.json');
    $entry = [
        'id'           => 'ml_' . substr(md5(uniqid(mt_rand(), true)), 0, 10),
        'sent_at'      => date('Y-m-d\TH:i:sP'),
        'to'           => $toList,
        'cc'           => $ccList,
        'subject'      => mb_substr($subject, 0, 200),
        'type'         => $opts['log_type'] ?? 'transactional',
        'status'       => $err ? 'failed' : 'sent',
        'error'        => $err ?: '',
        'sent_by'      => $opts['sent_by']      ?? 'system',
        'sent_by_name' => $opts['sent_by_name'] ?? 'system',
    ];
    if (is_array($opts['log_meta'] ?? null)) $entry['meta'] = $opts['log_meta'];
    $logs[] = $entry;
    if (count($logs) > 2000) $logs = array_slice($logs, -2000);
    writeJson('mail_logs.json', $logs);

    return ['ok' => !$err, 'error' => $err ?: null];
}
