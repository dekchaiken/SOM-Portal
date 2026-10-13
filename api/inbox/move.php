<?php
/**
 * Move a message to another folder (COPY → flag \Deleted → EXPUNGE).
 * POST { uid:int, from:string, to:string }
 * Common usage:
 *   Archive → to: "[Gmail]/All Mail"
 *   Trash   → to: "[Gmail]/Trash"
 *   Spam    → to: "[Gmail]/Spam"
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    if (($payload['role'] ?? '') === 'super_viewer') respondError('super_viewer role does not have access to the team inbox', 403);

    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $uid  = (int)($body['uid']  ?? 0);
    $from = trim($body['from']  ?? 'INBOX');
    $to   = trim($body['to']   ?? '');
    if (!$uid || !$to) respondError('uid and to are required', 400);

    $imap = inbox_connect();
    try {
        $imap->select($from);
        $imap->copy($uid, $to);
        $imap->store($uid, '+FLAGS', '\Deleted');
        $imap->expunge();
    } finally {
        $imap->close();
    }

    respondOk(['uid' => $uid, 'from' => $from, 'to' => $to]);

} catch (\Throwable $e) {
    respondError('Move error: ' . $e->getMessage(), 500);
}
