<?php
/**
 * List emails from a folder.
 * GET /api/inbox/list.php?folder=INBOX&limit=20&offset=0&filter=all
 *
 * filter: all | unread | starred
 *
 * Performance: one IMAP connection, one UID SEARCH, one batch FETCH for all headers.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_helpers.php';

// IMAP round-trips on a big mailbox can exceed PHP's default 30s.
@set_time_limit(60);

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    if (($payload['role'] ?? '') === 'super_viewer') respondError('super_viewer role does not have access to the team inbox', 403);

    $folder = trim($_GET['folder'] ?? 'INBOX') ?: 'INBOX';
    $limit  = min(max(1, (int)($_GET['limit']  ?? 20)), 100);
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    $filter = $_GET['filter'] ?? 'all';

    $imap = inbox_connect();

    try {
        // ── 1. Select folder ───────────────────────────────────────────────────
        $imap->select($folder);

        // ── 2. Search UIDs ─────────────────────────────────────────────────────
        $criteria = match ($filter) {
            'unread'  => 'UNSEEN',
            'starred' => 'FLAGGED',
            default   => 'ALL',
        };
        $allUids = $imap->search($criteria);
        $count   = count($allUids);

        // Unread count (always INBOX for badge)
        $unread = ($criteria === 'UNSEEN')
            ? $count
            : count($imap->search('UNSEEN'));

        // ── 3. Paginate ────────────────────────────────────────────────────────
        $pageUids = array_slice($allUids, $offset, $limit);

        if (!$pageUids) {
            $imap->close();
            respondOk(['folder' => $folder, 'total' => $count, 'unread' => $unread, 'count' => $count, 'items' => []]);
            return;
        }

        // ── 4. ONE batch FETCH: From + Subject + Date + Flags + Size ──────────
        $overview = $imap->fetchOverview($pageUids);

        // ── 5. Build response ──────────────────────────────────────────────────
        $items = [];
        foreach ($pageUids as $uid) {
            $ov = $overview[$uid] ?? null;
            if (!$ov) continue;

            $h = parse_rfc822_headers($ov['headersRaw'] ?? '');

            $items[] = [
                'uid'     => $uid,
                'from'    => inbox_parse_addr(inbox_decode_header($h['from'] ?? '')),
                'subject' => inbox_decode_header($h['subject'] ?? '(no subject)'),
                'date'    => inbox_date_iso($h['date'] ?? ''),
                'snippet' => '',
                'size'    => $ov['size'],
                'flags'   => inbox_parse_flags($ov['flagsRaw']),
            ];
        }

    } finally {
        $imap->close();
    }

    respondOk([
        'folder' => $folder,
        'total'  => $count,
        'unread' => $unread,
        'count'  => $count,
        'items'  => $items,
    ]);

} catch (\Throwable $e) {
    respondError('Inbox list error: ' . $e->getMessage(), 500);
}
