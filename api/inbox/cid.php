<?php
/**
 * Inline-image proxy for CID (Content-ID) referenced images in email bodies.
 *
 * GET /api/inbox/cid.php?uid=12345&folder=INBOX&cid=ii_mp02of060&token=<JWT>
 *
 * Why: Browsers block "cid:" scheme in img.src / iframe srcdoc due to CSP.
 *      This endpoint fetches the raw message from IMAP, finds the matching MIME
 *      part, and streams binary image data as a normal "self" URL (passes CSP).
 *
 * Auth: JWT is passed via ?token= query param because <img> tags cannot send
 *       Authorization headers.
 */
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_helpers.php';

// ── Manual JWT auth from query-string token ────────────────────────────────
$token = trim($_GET['token'] ?? '');
if ($token === '') {
    http_response_code(401);
    exit('Unauthorized');
}

$payload = jwt_verify($token);
if (!$payload) {
    http_response_code(401);
    exit('Token invalid or expired');
}

// Only staff roles may access inbox; super_viewer is denied even though it's
// in ALL_STAFF_ROLES — the team inbox is out-of-scope for oversight.
$allowed = defined('ALL_STAFF_ROLES') ? ALL_STAFF_ROLES : ['sm_admin', 'sm_lead', 'sm_user', 'dev_sm'];
if (!in_array($payload['role'] ?? '', $allowed) || ($payload['role'] ?? '') === 'super_viewer') {
    http_response_code(403);
    exit('Forbidden');
}

// ── Input validation ───────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    exit('Method not allowed');
}

$uid    = (int)($_GET['uid']    ?? 0);
$folder = trim($_GET['folder'] ?? 'INBOX') ?: 'INBOX';
$cid    = trim($_GET['cid']    ?? '');

if ($uid <= 0 || $cid === '') {
    http_response_code(400);
    exit('uid and cid are required');
}

// ── Fetch message from IMAP and find matching MIME part ───────────────────
try {
    $imap = inbox_connect();
    try {
        $imap->select($folder);
        $raw = $imap->fetchFull($uid);
    } finally {
        $imap->close();
    }

    if ($raw === '') {
        http_response_code(404);
        exit('Message not found');
    }

    // Walk MIME to find the image part whose Content-ID matches $cid
    $imageData = null;
    $imageMime = 'application/octet-stream';
    _cid_walk($raw, $cid, $imageData, $imageMime);

    if ($imageData === null) {
        http_response_code(404);
        exit('Image not found');
    }

    // Stream the image
    header('Content-Type: ' . $imageMime);
    header('Content-Length: ' . strlen($imageData));
    header('Cache-Control: private, max-age=3600');
    header('X-Content-Type-Options: nosniff');
    echo $imageData;
    exit;

} catch (\Throwable $e) {
    http_response_code(500);
    exit('Error: ' . $e->getMessage());
}

// ══════════════════════════════════════════════════════════════════════════════
//  Internal: MIME walker that finds one image part by CID
// ══════════════════════════════════════════════════════════════════════════════

function _cid_walk(string $raw, string $targetCid, ?string &$imageData, string &$imageMime): void {
    [$hdrRaw, $body] = _mime_split($raw);
    _cid_walk_part(parse_rfc822_headers($hdrRaw), $body, $targetCid, $imageData, $imageMime);
}

function _cid_walk_part(array $headers, string $body, string $targetCid, ?string &$imageData, string &$imageMime): void {
    if ($imageData !== null) return; // already found

    $ct  = $headers['content-type']              ?? 'text/plain';
    $enc = $headers['content-transfer-encoding'] ?? '';
    $cd  = strtolower($headers['content-disposition'] ?? '');
    $cid = trim($headers['content-id'] ?? '', '<> ');

    // Multipart → recurse
    if (stripos($ct, 'multipart/') === 0) {
        $boundary = _mime_boundary($ct);
        if ($boundary) {
            $delim = '--' . $boundary;
            $parts = explode($delim, $body);
            array_shift($parts); array_pop($parts);
            foreach ($parts as $part) {
                if ($imageData !== null) return;
                $part = ltrim($part, "\r\n");
                [$pH, $pBody] = _mime_split($part);
                _cid_walk_part(parse_rfc822_headers($pH), $pBody, $targetCid, $imageData, $imageMime);
            }
        }
        return;
    }

    // message/rfc822 (forwarded) → recurse
    if (stripos($ct, 'message/rfc822') === 0) {
        [$pH, $pBody] = _mime_split($body);
        _cid_walk_part(parse_rfc822_headers($pH), $pBody, $targetCid, $imageData, $imageMime);
        return;
    }

    // Image part — check if it matches the requested CID
    if (stripos($ct, 'image/') === 0 && $cid !== '') {
        // Match: exact, or strip domain suffix (Gmail appends @mail.gmail.com etc.)
        $cidBare    = preg_replace('/@.*$/', '', $cid);
        $targetBare = preg_replace('/@.*$/', '', $targetCid);

        if ($cid === $targetCid || $cidBare === $targetBare || $cidBare === $targetCid || $cid === $targetBare) {
            $imageData = _mime_decode(trim($body), $enc);
            $imageMime = strtolower(trim(strtok($ct, ';')));
        }
    }
}
