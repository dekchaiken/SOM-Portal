<?php
/**
 * Set / clear a message flag.
 * POST { uid:int, folder:string, flag:string, set:bool }
 * flag: '\Seen' | '\Flagged' | '\Answered'
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    if (($payload['role'] ?? '') === 'super_viewer') respondError('super_viewer role does not have access to the team inbox', 403);

    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $uid    = (int)($body['uid']    ?? 0);
    $folder = trim($body['folder'] ?? 'INBOX') ?: 'INBOX';
    $flag   = trim($body['flag']   ?? '');
    $set    = (bool)($body['set']  ?? true);

    $allowed = ['\Seen', '\Flagged', '\Answered', '\Draft'];
    if (!$uid || !in_array($flag, $allowed, true)) respondError('Invalid uid or flag', 400);

    $imap = inbox_connect();
    try {
        $imap->select($folder);
        $imap->store($uid, $set ? '+FLAGS' : '-FLAGS', $flag);
    } finally {
        $imap->close();
    }

    respondOk(['uid' => $uid, 'flag' => $flag, 'set' => $set]);

} catch (\Throwable $e) {
    respondError('Flag error: ' . $e->getMessage(), 500);
}
