<?php
/**
 * Add a comment to a Jira issue.
 * POST /api/jira/add-comment.php
 * Body: { key: "SMC-123", body: "plain text or with line breaks" }
 *
 * Converts plain text to Jira API v3 ADF (Atlassian Document Format).
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $body = getBody();
    $key  = trim($body['key']  ?? '');
    $text = trim($body['body'] ?? '');

    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
    if ($text === '')                                 respondError('Comment body required', 400);

    // Convert plain text → ADF: each line becomes a paragraph
    $adf = [
        'type'    => 'doc',
        'version' => 1,
        'content' => array_map(fn($line) => [
            'type'    => 'paragraph',
            'content' => $line === '' ? [] : [['type' => 'text', 'text' => $line]],
        ], explode("\n", $text)),
    ];

    $jiraPayload = json_encode(['body' => $adf]);

    $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/comment');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $jiraPayload,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Accept: application/json',
            'Content-Type: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err)             respondError('Cannot reach Jira: ' . $err, 502);
    if ($code !== 201) {
        $data = json_decode($resp, true);
        $msg  = $data['errorMessages'][0] ?? "HTTP {$code}";
        respondError("Jira: {$msg}", 502);
    }

    $created = json_decode($resp, true);
    logActivity('jira_add_comment', ['key' => $key, 'comment_id' => $created['id'] ?? ''], $payload['sub'], $payload['name'] ?? '');
    respondOk(['comment_id' => $created['id'] ?? '', 'created' => $created['created'] ?? '']);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage(), 500);
}
