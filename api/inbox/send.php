<?php
/**
 * Send/Reply/Forward email from Team Inbox.
 * POST {
 *   to:          string  (comma-separated)
 *   cc:          string  (optional)
 *   subject:     string
 *   body:        string  (HTML or plain)
 *   is_html:     bool    (default true)
 *   useBranding: bool    (default true — wraps with branded template)
 *   in_reply_to: string  (optional, Message-ID of original for threading)
 *   references:  string  (optional, chain of Message-IDs)
 * }
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../mail/_branding.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    if (($payload['role'] ?? '') === 'super_viewer') respondError('super_viewer role does not have access to the team inbox', 403);

    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $to         = trim($body['to']          ?? '');
    $cc         = trim($body['cc']          ?? '');
    $subject    = trim($body['subject']     ?? '');
    $msgBody    = $body['body']             ?? '';
    $isHtml     = (bool)($body['is_html']   ?? true);
    $inReplyTo  = trim($body['in_reply_to'] ?? '');
    $references = trim($body['references']  ?? '');
    $useBrand   = !isset($body['useBranding']) || (bool)$body['useBranding'];

    if (!$to)      respondError('to is required', 400);
    if (!$subject) respondError('subject is required', 400);
    if (!$msgBody) respondError('body is required', 400);

    $cfg = readJson('mail_config.json');
    if (empty($cfg['smtp_host'])) respondError('SMTP not configured — go to Admin → Mail Config', 400);

    $fromEmail = $cfg['smtp_user'] ?? $cfg['smtp_from'] ?? '';
    $fromName  = $cfg['from_name'] ?? ($payload['name'] ?? 'Team Inbox');

    // Parse recipient lists
    $parseEmails = fn($s) => array_filter(array_map('trim', preg_split('/[,;]+/', $s)));
    $toRaw = $parseEmails($to);
    $ccRaw = $parseEmails($cc);
    if (!$toRaw) respondError('No valid To address', 400);

    // ── Build MIME ─────────────────────────────────────────────────────────────
    $boundary = 'IBX_' . bin2hex(random_bytes(12));
    $msgId    = '<ibx.' . uniqid('', true) . '@' . (parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? 'centralize-sm'), PHP_URL_HOST) ?: 'centralize-sm') . '>';
    $dateStr  = date('r');

    // Encode subject
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $encFrom    = '=?UTF-8?B?' . base64_encode($fromName) . '?= <' . $fromEmail . '>';

    // Build header block
    $headers  = "Date: $dateStr\r\n";
    $headers .= "From: $encFrom\r\n";
    $headers .= "To: " . implode(', ', array_map(fn($e) => "<$e>", $toRaw)) . "\r\n";
    if ($ccRaw) $headers .= "Cc: " . implode(', ', array_map(fn($e) => "<$e>", $ccRaw)) . "\r\n";
    $headers .= "Subject: $encSubject\r\n";
    $headers .= "Message-ID: $msgId\r\n";
    if ($inReplyTo)  $headers .= "In-Reply-To: $inReplyTo\r\n";
    if ($references) $headers .= "References: $references\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n";
    $headers .= "\r\n";

    // Wrap HTML body with the admin-configurable gradient template
    // (admin/mail-config.html → Branded Email Template).
    if ($isHtml) {
        $msgBody = buildGradientEmail($msgBody, $subject, $cfg, $useBrand);
    }

    // Extract inline base64 images → replace with CID references.
    // NOTE: possessive quantifiers (`*+`) are required — a plain `[^"]+` blows
    // `pcre.backtrack_limit` (default 1M) on any image larger than ~700KB and
    // returns NULL, which silently produced empty-body emails.
    if ($isHtml) {
        $inlineImages = [];
        $imageCounter = 0;
        $replaced = preg_replace_callback(
            '/src="data:image\/([^";]*+);base64,([^"]*+)"/i',
            function ($matches) use (&$inlineImages, &$imageCounter) {
                $imageCounter++;
                $cid = "ibx_img{$imageCounter}@mail";
                $inlineImages[$cid] = ['type' => $matches[1], 'data' => $matches[2]];
                return 'src="cid:' . $cid . '"';
            },
            $msgBody
        );
        if ($replaced === null) {
            respondError('Attached image too large to process (PCRE error: ' . preg_last_error_msg() . ')', 413);
        }
        $msgBody = $replaced;
    } else {
        $inlineImages = [];
    }

    // Auto-attach the SM animated logo when the Typewriter footer is selected
    // AND no public base URL is configured. When a public URL is set, the
    // footer references the GIF via <img src="https://…"> and no attachment
    // is needed (avoids Gmail's inline-attachment chip in the message header).
    $hasPublicUrl = trim((string)($cfg['email_public_base_url'] ?? '')) !== '';
    if ($isHtml && $useBrand && !$hasPublicUrl && trim((string)($cfg['email_footer_style'] ?? '')) === 'typewriter') {
        $logoPath = realpath(__DIR__ . '/../../uploads/sm-logo-typewriter.gif');
        if ($logoPath && is_readable($logoPath)) {
            $bin = @file_get_contents($logoPath);
            if ($bin !== false) {
                $inlineImages['sm-logo-typewriter'] = [
                    'type' => 'gif',
                    'data' => base64_encode($bin),
                ];
            }
        }
    }

    // Plain-text fallback — strip <style>/<script> content first so CSS doesn't leak into preview
    $plainText = $isHtml ? strip_tags(preg_replace(
        ['/<style[^>]*>[\s\S]*?<\/style>/i', '/<script[^>]*>[\s\S]*?<\/script>/i', '/<br\s*\/?>/i'],
        ['', '', "\n"],
        $msgBody
    )) : $msgBody;

    // ── Build MIME body ────────────────────────────────────────────────────────
    if ($isHtml && !empty($inlineImages)) {
        // multipart/alternative → multipart/related (html + images)
        $relBound = 'IBXR_' . bin2hex(random_bytes(10));

        // Rewrite outer Content-Type to multipart/alternative
        $headers = str_replace(
            "Content-Type: multipart/alternative; boundary=\"$boundary\"",
            "Content-Type: multipart/alternative; boundary=\"$boundary\"",
            $headers
        );

        $mime  = $headers;
        // Plain-text part
        $mime .= "--$boundary\r\n";
        $mime .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $mime .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
        $mime .= quoted_printable_encode($plainText) . "\r\n";

        // HTML+images part as multipart/related
        $mime .= "--$boundary\r\n";
        $mime .= "Content-Type: multipart/related; boundary=\"$relBound\"\r\n\r\n";

        $mime .= "--$relBound\r\n";
        $mime .= "Content-Type: text/html; charset=UTF-8\r\n";
        $mime .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
        $mime .= quoted_printable_encode($msgBody) . "\r\n";

        foreach ($inlineImages as $cid => $img) {
            $fname = ($cid === 'sm-logo-typewriter')
                ? 'sm-logo.gif'
                : preg_replace('/[^a-zA-Z0-9._-]/', '_', "img-{$cid}.{$img['type']}");
            $mime .= "--$relBound\r\n";
            $mime .= "Content-Type: image/{$img['type']}; name=\"$fname\"\r\n";
            $mime .= "Content-Transfer-Encoding: base64\r\n";
            $mime .= "Content-ID: <$cid>\r\n";
            $mime .= "Content-Disposition: inline; filename=\"$fname\"\r\n\r\n";
            $mime .= chunk_split($img['data']) . "\r\n";
        }
        $mime .= "--$relBound--\r\n";
        $mime .= "--$boundary--\r\n";
    } else {
        $mime  = $headers;
        $mime .= "--$boundary\r\n";
        $mime .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $mime .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
        $mime .= quoted_printable_encode($plainText) . "\r\n";

        if ($isHtml) {
            $mime .= "--$boundary\r\n";
            $mime .= "Content-Type: text/html; charset=UTF-8\r\n";
            $mime .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
            $mime .= quoted_printable_encode($msgBody) . "\r\n";
        }
        $mime .= "--$boundary--\r\n";
    }

    // ── SMTP via cURL ──────────────────────────────────────────────────────────
    $enc  = $cfg['smtp_encryption'] ?? 'tls';
    $host = $cfg['smtp_host'];
    $port = (int)($cfg['smtp_port'] ?? 587);
    $url  = ($enc === 'ssl') ? "smtps://$host:$port" : "smtp://$host:$port";

    $allRcpt = array_map(fn($e) => "<$e>", array_merge($toRaw, $ccRaw));

    $fp = fopen('php://temp', 'r+');
    fwrite($fp, $mime);
    rewind($fp);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_MAIL_FROM      => "<$fromEmail>",
        CURLOPT_MAIL_RCPT      => $allRcpt,
        CURLOPT_READDATA       => $fp,
        CURLOPT_UPLOAD         => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_CONNECTTIMEOUT => 15,
    ]);
    if (!empty($cfg['smtp_user'])) {
        curl_setopt($ch, CURLOPT_USERNAME, $cfg['smtp_user']);
        curl_setopt($ch, CURLOPT_PASSWORD, $cfg['smtp_password'] ?? '');
    }
    if ($enc === 'tls') curl_setopt($ch, CURLOPT_USE_SSL, CURLUSESSL_ALL);

    curl_exec($ch);
    $curlErr = curl_error($ch);
    curl_close($ch);
    fclose($fp);

    if ($curlErr) respondError('Send failed: ' . $curlErr, 502);

    logActivity('inbox_sent', [
        'to'      => $to,
        'subject' => mb_substr($subject, 0, 100),
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk(['sent' => true, 'message_id' => $msgId]);

} catch (\Throwable $e) {
    respondError('Send error: ' . $e->getMessage(), 500);
}
