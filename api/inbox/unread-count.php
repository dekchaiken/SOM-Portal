<?php
/**
 * Lightweight INBOX unread counter for sidebar badge (polled every 60s).
 * GET /api/inbox/unread-count.php
 * Always returns 200 { unread: N } — never 5xx, so badge stays quiet on errors.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    if (($payload['role'] ?? '') === 'super_viewer') respondError('super_viewer role does not have access to the team inbox', 403);

    $cfg  = readJson('mail_config.json');
    $user = trim($cfg['smtp_user'] ?? '');
    $pass = trim($cfg['smtp_password'] ?? '');
    if (!$user || !$pass) { respondOk(['unread' => 0]); return; }

    $imap = inbox_connect();
    try {
        $imap->select('INBOX');
        $uids = $imap->search('UNSEEN');
    } finally {
        $imap->close();
    }

    respondOk(['unread' => count($uids)]);

} catch (\Throwable $e) {
    respondOk(['unread' => 0]); // silent fail — badge just shows 0
}
