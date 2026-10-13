<?php
/**
 * Read full email body + attachment metadata.
 * GET /api/inbox/message.php?folder=INBOX&uid=12345
 * Side-effect: marks the message \Seen.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    if (($payload['role'] ?? '') === 'super_viewer') respondError('super_viewer role does not have access to the team inbox', 403);

    $folder = trim($_GET['folder'] ?? 'INBOX') ?: 'INBOX';
    $uid    = (int)($_GET['uid'] ?? 0);
    if ($uid <= 0) respondError('uid required', 400);

    $imap = inbox_connect();

    try {
        $imap->select($folder);

        // Fetch full message (one command)
        $raw = $imap->fetchFull($uid);
        if ($raw === '') respondError('Message not found', 404);

        // Fetch flags (one command)
        $ov       = $imap->fetchOverview([$uid]);
        $flagsRaw = $ov[$uid]['flagsRaw'] ?? '';
        $flags    = inbox_parse_flags($flagsRaw);

        // Mark as seen
        if (!$flags['seen']) {
            try { $imap->store($uid, '+FLAGS', '\Seen'); $flags['seen'] = true; } catch (\Throwable $e) {}
        }

    } finally {
        $imap->close();
    }

    // Parse headers
    [$hdrRaw] = _mime_split($raw);
    $h = parse_rfc822_headers($hdrRaw);

    // Parse body + attachments
    $bodyData = inbox_extract_body_from_raw($raw);
    $snippet  = inbox_get_snippet($raw, 200);

    respondOk([
        'uid'         => $uid,
        'folder'      => $folder,
        'subject'     => inbox_decode_header($h['subject']    ?? '(no subject)'),
        'date'        => inbox_date_iso($h['date']            ?? ''),
        'message_id'  => trim($h['message-id']               ?? ''),
        'from'        => inbox_parse_addr(inbox_decode_header($h['from'] ?? '')),
        'to'          => inbox_parse_addr_list(inbox_decode_header($h['to'] ?? '')),
        'cc'          => inbox_parse_addr_list(inbox_decode_header($h['cc'] ?? '')),
        'bcc'         => inbox_parse_addr_list(inbox_decode_header($h['bcc'] ?? '')),
        'reply_to'    => inbox_parse_addr_list(inbox_decode_header($h['reply-to'] ?? '')),
        'flags'       => $flags,
        'body'        => $bodyData['body'],
        'is_html'     => $bodyData['is_html'],
        'plain'       => $bodyData['plain'],
        'snippet'     => $snippet,
        'attachments' => $bodyData['attachments'],
        'cid_map'     => $bodyData['cid_map'] ?? [],
    ]);

} catch (\Throwable $e) {
    respondError('Message read error: ' . $e->getMessage(), 500);
}
