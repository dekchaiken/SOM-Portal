<?php
/**
 * List all Gmail IMAP folders/labels with unread + total counts.
 * GET /api/inbox/folders.php
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    if (($payload['role'] ?? '') === 'super_viewer') respondError('super_viewer role does not have access to the team inbox', 403);

    $specialMap = [
        'INBOX'             => 'inbox',
        '[Gmail]/Sent Mail' => 'sent',
        '[Gmail]/Drafts'    => 'drafts',
        '[Gmail]/Spam'      => 'spam',
        '[Gmail]/Trash'     => 'trash',
        '[Gmail]/Starred'   => 'starred',
        '[Gmail]/All Mail'  => 'all',
        '[Gmail]/Important' => 'important',
    ];

    $imap = inbox_connect();
    $folders = [];

    try {
        $names = $imap->listFolders();
        foreach ($names as $name) {
            if ($name === '[Gmail]') continue;
            $display = preg_replace('#^\[Gmail\]/?#', '', $name) ?: $name;
            try {
                $st = $imap->status($name);
            } catch (\Throwable $e) {
                $st = ['total' => 0, 'unread' => 0];
            }
            $folders[] = [
                'name'    => $name,
                'display' => $display,
                'unread'  => $st['unread'],
                'total'   => $st['total'],
                'special' => $specialMap[$name] ?? null,
            ];
        }
    } finally {
        $imap->close();
    }

    $order = ['inbox','starred','sent','drafts','spam','trash','all','important'];
    usort($folders, function ($a, $b) use ($order) {
        $ai = $a['special'] !== null ? (array_search($a['special'], $order) ?: 99) : 999;
        $bi = $b['special'] !== null ? (array_search($b['special'], $order) ?: 99) : 999;
        return $ai !== $bi ? $ai - $bi : strcasecmp($a['display'], $b['display']);
    });

    respondOk($folders);

} catch (\Throwable $e) {
    respondError('Folders error: ' . $e->getMessage(), 500);
}
