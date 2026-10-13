<?php
/**
 * Get full Jira issue detail + available transitions for the SMC Ticket page.
 * GET /api/jira/issue-detail.php?key=SMC-123
 *
 * Returns:
 *   {
 *     issue:       { ...full Jira fields... },
 *     transitions: [ { id, name, to: { name, statusCategory } }, ... ]
 *   }
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) {
        respondError('Jira credentials not configured', 500);
    }

    $key = trim($_GET['key'] ?? '');
    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) {
        respondError('Invalid issue key', 400);
    }

    $authHeader = 'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken());

    $jiraGet = function(string $url) use ($authHeader) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => [$authHeader, 'Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        return [$body, $code, $err];
    };

    // ── 1. Issue detail ─────────────────────────────────────────
    [$body, $code, $err] = $jiraGet(
        JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key)
        . '?fields=*all&expand=renderedFields,names'
    );
    if ($err)             respondError('Cannot reach Jira: ' . $err, 502);
    if ($code === 404)    respondError("Issue {$key} not found", 404);
    if ($code !== 200) {
        $data = json_decode($body, true);
        $msg = $data['errorMessages'][0] ?? "HTTP {$code}";
        respondError("Jira: {$msg}", 502);
    }
    $issue = json_decode($body, true);

    // ── 2. Available transitions ────────────────────────────────
    [$tBody, $tCode] = $jiraGet(
        JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/transitions'
    );
    $transitions = [];
    if ($tCode === 200) {
        $td = json_decode($tBody, true);
        foreach (($td['transitions'] ?? []) as $t) {
            $transitions[] = [
                'id'         => $t['id'],
                'name'       => $t['name'],
                'to_name'    => $t['to']['name']                          ?? '',
                'to_cat_key' => $t['to']['statusCategory']['key']         ?? 'new',
                'to_cat_col' => $t['to']['statusCategory']['colorName']   ?? '',
            ];
        }
    }

    // ── 3. Comments ─────────────────────────────────────────────
    [$cBody, $cCode] = $jiraGet(
        JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key)
        . '/comment?expand=renderedBody&orderBy=created'
    );
    $comments = [];
    if ($cCode === 200) {
        $cd = json_decode($cBody, true);
        foreach (($cd['comments'] ?? []) as $c) {
            $comments[] = [
                'id'         => $c['id'],
                'author'     => $c['author']['displayName']  ?? 'Unknown',
                'avatar'     => $c['author']['avatarUrls']['24x24'] ?? '',
                'created'    => $c['created']                ?? '',
                'updated'    => $c['updated']                ?? '',
                'body_html'  => $c['renderedBody']           ?? '',
            ];
        }
    }

    // ── 4. Attachments (top-level only — comment-attached come back as URLs in body) ──
    $attachments = [];
    foreach (($issue['fields']['attachment'] ?? []) as $att) {
        $attachments[] = [
            'id'       => $att['id'],
            'filename' => $att['filename'],
            'mime'     => $att['mimeType'] ?? '',
            'size'     => $att['size']     ?? 0,
            'created'  => $att['created']  ?? '',
            'author'   => $att['author']['displayName'] ?? '',
            'url'      => $att['content']  ?? '',
            'thumb'    => $att['thumbnail'] ?? '',
        ];
    }

    respondOk([
        'key'         => $issue['key'],
        'url'         => JIRA_BASE_URL . '/browse/' . $issue['key'],
        'fields'      => $issue['fields']      ?? [],
        'rendered'    => $issue['renderedFields'] ?? [],
        'names'       => $issue['names']       ?? [],
        'transitions' => $transitions,
        'comments'    => $comments,
        'attachments' => $attachments,
    ]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine(), 500);
}
