<?php
/**
 * requests/index.php
 * Feature Request & Bug Report System
 * ─────────────────────────────────────────────────
 * Global platform-wide inbox — every team's submissions land in a single
 * data/requests.json file (see helpers.php _isGlobalFile). Only super_admin
 * can view all / update status / delete; users see only their own.
 *
 * GET     → list requests (user sees own, super_admin sees all)
 * POST    → create new request (any authenticated user)
 * PUT     → update request status (super_admin only)
 * DELETE  → delete request (super_admin only)
 */
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

const REQ_FILE = 'requests.json';

// ── GET: List requests ────────────────────────────────────
if ($method === 'GET') {
    $requests = readJson(REQ_FILE);

    // Compute next ticket from ALL requests before filtering (so any user sees the global next number)
    $maxNum = 0;
    foreach ($requests as $r) {
        if (!empty($r['ticket_number']) && preg_match('/^SMHUB-(\d+)$/', $r['ticket_number'], $m)) {
            $maxNum = max($maxNum, (int)$m[1]);
        }
    }
    $nextTicket = 'SMHUB-' . ($maxNum + 1);

    // super_admin + SM-team admins (sm_admin, dev_sm) see all;
    // everyone else sees only their own submissions
    $isSMAdmin = in_array($payload['role'], ['sm_admin', 'dev_sm'], true)
              && ($payload['team'] ?? '') === 'sm';
    if ($payload['role'] !== SUPER_ADMIN_ROLE && !$isSMAdmin) {
        $requests = array_filter($requests, fn($r) => $r['user_id'] === $payload['sub']);
    }

    // Sort by created_at desc
    usort($requests, fn($a, $b) => strtotime($b['created_at']) - strtotime($a['created_at']));

    // Include next_ticket at top level so the UI can show it pre-submission
    respond(['success' => true, 'message' => 'OK', 'data' => array_values($requests), 'next_ticket' => $nextTicket]);
}

// ── POST: Create request ──────────────────────────────────
if ($method === 'POST') {
    $body = getBody();

    if (empty($body['title'])) respondError('title required', 400);
    if (empty($body['type'])) respondError('type required', 400);
    if (empty($body['description'])) respondError('description required', 400);

    $requests = readJson(REQ_FILE);

    // Compute next ticket number (max existing + 1, global across all requests)
    $nextTicket = 1;
    foreach ($requests as $existing) {
        if (!empty($existing['ticket_number']) && preg_match('/^SMHUB-(\d+)$/', $existing['ticket_number'], $m)) {
            $nextTicket = max($nextTicket, (int)$m[1] + 1);
        }
    }

    $request = [
        'id'            => uniqid('req_', true),
        'user_id'       => $payload['sub'],
        'user_name'     => $payload['name'] ?? $payload['sub'],
        'team'          => $payload['team'] ?? null,
        'type'          => $body['type'], // 'feature' or 'bug'
        'title'         => trim($body['title']),
        'description'   => trim($body['description']),
        'priority'      => $body['priority'] ?? 'medium', // low, medium, high
        'status'        => 'pending', // pending, in_progress, completed, rejected
        'ticket_number' => 'SMHUB-' . $nextTicket,
        'created_at'    => date('c'),
        'updated_at'    => date('c'),
        'updated_by'    => null,
        'admin_note'    => null,
    ];

    $requests[] = $request;
    writeJson(REQ_FILE, $requests);

    // Log activity
    logActivity('request_created', [
        'request_id' => $request['id'],
        'type'       => $request['type'],
        'title'      => $request['title'],
    ], $payload['sub'], $payload['name'] ?? '');

    // Notify super_admin(s). notifications.json is per-team, so we must write
    // into each super_admin's OWN team file (not the requester's) — otherwise
    // an ss/ts request would land in data/ss/notifications.json where super_admin
    // never reads.
    notifySuperAdmins(
        'request_submitted',
        'คำขอใหม่: ' . $request['title'],
        ($request['type'] === 'feature' ? 'Feature Request' : 'Bug Report')
            . ' จาก ' . $request['user_name']
            . ($request['team'] ? ' (ทีม ' . $request['team'] . ')' : ''),
        ['request_id' => $request['id']]
    );

    respondOk($request, 'ส่งคำขอสำเร็จ');
}

// ── PATCH: Add comment (any authenticated user on own ticket; super_admin on any) ──
if ($method === 'PATCH') {
    $body = getBody();
    if (empty($body['id']))                   respondError('id required', 400);
    if (empty(trim($body['comment'] ?? '')))  respondError('comment required', 400);

    $requests = readJson(REQ_FILE);
    $idx = null;
    foreach ($requests as $i => $r) {
        if ($r['id'] === $body['id']) { $idx = $i; break; }
    }
    if ($idx === null) respondError('Request not found', 404);

    $req = $requests[$idx];

    // Regular users can only comment on their own ticket
    if ($payload['role'] !== SUPER_ADMIN_ROLE && $req['user_id'] !== $payload['sub']) {
        respondError('Forbidden', 403);
    }

    $comment = [
        'id'          => genId('cmt'),
        'author_id'   => $payload['sub'],
        'author_name' => $payload['name'] ?? $payload['sub'],
        'author_role' => $payload['role'] ?? 'user',
        'text'        => trim($body['comment']),
        'created_at'  => date('c'),
    ];

    if (!isset($requests[$idx]['comments'])) {
        $requests[$idx]['comments'] = [];
    }
    $requests[$idx]['comments'][] = $comment;
    $requests[$idx]['updated_at'] = date('c');
    writeJson(REQ_FILE, $requests);

    logActivity('request_commented', [
        'request_id'    => $body['id'],
        'ticket_number' => $req['ticket_number'] ?? '',
        'comment_id'    => $comment['id'],
    ], $payload['sub'], $payload['name'] ?? '');

    // Notify the other party
    $prevTeam = $GLOBALS['_current_team'] ?? null;
    $isAdminComment = ($payload['role'] === SUPER_ADMIN_ROLE);
    $ticketLabel = ($req['ticket_number'] ?? $body['id']) . ' — ' . mb_substr($req['title'] ?? '', 0, 40);

    if ($isAdminComment) {
        // Admin replied → notify ticket owner in their team's notifications file
        $GLOBALS['_current_team'] = $req['team'] ?? null;
        createNotification(
            $req['user_id'],
            'request_comment',
            'Admin ตอบกลับ Ticket ของคุณ',
            $ticketLabel . "\n" . mb_substr($comment['text'], 0, 100),
            ['request_id' => $body['id'], 'ticket_number' => $req['ticket_number'] ?? '']
        );
    } else {
        // User replied → notify super_admins
        notifySuperAdmins(
            'request_comment',
            ($payload['name'] ?? 'User') . ' ตอบกลับใน Ticket',
            $ticketLabel . "\n" . mb_substr($comment['text'], 0, 100),
            ['request_id' => $body['id'], 'ticket_number' => $req['ticket_number'] ?? '']
        );
    }
    $GLOBALS['_current_team'] = $prevTeam;

    respondOk($comment, 'Comment added');
}

// ── Super-admin only below ────────────────────────────────
requireRole($payload, [SUPER_ADMIN_ROLE]);

// ── PUT: Update request status ────────────────────────────
if ($method === 'PUT') {
    $body = getBody();

    if (empty($body['id'])) respondError('id required', 400);

    $requests = readJson(REQ_FILE);
    $idx = null;
    foreach ($requests as $i => $r) {
        if ($r['id'] === $body['id']) { $idx = $i; break; }
    }
    if ($idx === null) respondError('Request not found', 404);

    $old = $requests[$idx];

    if (isset($body['status'])) {
        $requests[$idx]['status'] = $body['status'];
    }
    if (isset($body['priority'])) {
        $requests[$idx]['priority'] = $body['priority'];
    }
    if (isset($body['admin_note'])) {
        $requests[$idx]['admin_note'] = trim($body['admin_note']);
    }

    $requests[$idx]['updated_at'] = date('c');
    $requests[$idx]['updated_by'] = $payload['name'] ?? $payload['sub'];

    writeJson(REQ_FILE, $requests);

    // Log activity
    logActivity('request_updated', [
        'request_id' => $body['id'],
        'old_status' => $old['status'],
        'new_status' => $requests[$idx]['status'],
    ], $payload['sub'], $payload['name'] ?? '');

    // Notify requester if status changed. Requester's notifications live in
    // their own team's file, so temporarily switch team context for the write.
    if (isset($body['status']) && $body['status'] !== $old['status']) {
        $statusLabels = [
            'pending'     => 'รอดำเนินการ',
            'in_progress' => 'กำลังดำเนินการ',
            'completed'   => 'เสร็จสิ้น',
            'rejected'    => 'ปฏิเสธ',
        ];

        $prevTeam = $GLOBALS['_current_team'] ?? null;
        $GLOBALS['_current_team'] = $old['team'] ?? null;
        createNotification(
            $old['user_id'],
            'request_status_updated',
            'สถานะคำขอของคุณเปลี่ยนแปลง',
            $old['title'] . ' → ' . ($statusLabels[$body['status']] ?? $body['status']),
            ['request_id' => $body['id']]
        );
        $GLOBALS['_current_team'] = $prevTeam;
    }

    respondOk($requests[$idx], 'อัพเดทสำเร็จ');
}

// ── DELETE: Delete request ────────────────────────────────
if ($method === 'DELETE') {
    $id = $_GET['id'] ?? '';
    if (empty($id)) respondError('id required', 400);

    $requests = readJson(REQ_FILE);
    $newRequests = array_values(array_filter($requests, fn($r) => $r['id'] !== $id));

    if (count($newRequests) === count($requests)) {
        respondError('Request not found', 404);
    }

    writeJson(REQ_FILE, $newRequests);

    logActivity('request_deleted', ['request_id' => $id], $payload['sub'], $payload['name'] ?? '');

    respondOk(['deleted' => true]);
}

respondError('Method not allowed', 405);

// ── Local helper: notify every super_admin in their own team's notifications file ──
function notifySuperAdmins(string $type, string $title, ?string $body, array $meta): void {
    $users = readJson('users.json');
    $sas   = array_filter($users, fn($u) => ($u['role'] ?? '') === 'super_admin');
    if (empty($sas)) return;

    // Group by team since notifications.json is per-team scoped.
    $byTeam = [];
    foreach ($sas as $u) {
        $t = $u['team'] ?? null;
        $key = $t === null ? '__null__' : $t;
        $byTeam[$key][] = $u['id'];
    }

    $prevTeam = $GLOBALS['_current_team'] ?? null;
    foreach ($byTeam as $teamKey => $ids) {
        $GLOBALS['_current_team'] = ($teamKey === '__null__') ? null : $teamKey;
        createNotification($ids, $type, $title, $body, $meta);
    }
    $GLOBALS['_current_team'] = $prevTeam;
}
