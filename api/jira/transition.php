<?php
/**
 * Execute a status transition on a Jira issue.
 * POST /api/jira/transition.php
 * Body: { key: "SMC-123", transitionId: "31" }
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $body         = getBody();
    $key          = trim($body['key'] ?? '');
    $transitionId = trim($body['transitionId'] ?? '');

    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
    if (!$transitionId)                               respondError('transitionId required', 400);

    $jiraBody = ['transition' => ['id' => $transitionId]];
    if (!empty($body['fields']) && is_array($body['fields'])) {
        $fields = $body['fields'];

        // Jira's transition API does NOT accept `comment` inside `fields` —
        // it has to go under `update.comment` as an "add" op with ADF body.
        // Pull it out, convert to ADF, and move it to the right place.
        if (array_key_exists('comment', $fields)) {
            $raw = $fields['comment'];
            unset($fields['comment']);
            $text = is_string($raw) ? $raw : (is_array($raw) ? ($raw['body'] ?? '') : '');
            $text = trim((string)$text);
            if ($text !== '') {
                $jiraBody['update'] = [
                    'comment' => [[
                        'add' => [
                            'body' => [
                                'type'    => 'doc',
                                'version' => 1,
                                'content' => [[
                                    'type'    => 'paragraph',
                                    'content' => [['type' => 'text', 'text' => $text]],
                                ]],
                            ],
                        ],
                    ]],
                ];
            }
        }

        if ($fields) $jiraBody['fields'] = $fields;
    }
    $jiraPayload = json_encode($jiraBody);

    $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/transitions');
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

    if ($err) respondError('Cannot reach Jira: ' . $err, 502);
    // Jira returns 204 No Content on success
    if ($code !== 204) {
        $data = json_decode($resp, true);
        $msg  = $data['errorMessages'][0] ?? "HTTP {$code}";

        // Detect "Fields required for this transition: X, Y, Z" — Jira validator
        // enforces required fields that aren't on the Transition Screen, so the
        // /transitions?expand=transitions.fields endpoint returns [] for them.
        // Parse the field names out and return a structured response so the
        // frontend can prompt the user and retry.
        //
        // Jira uses a few phrasings depending on version / validator:
        //   "Fields required for this transition: X, Y"
        //   "Fields required: X, Y"
        //   "Field 'X' is required"
        $missing = [];
        foreach (($data['errorMessages'] ?? []) as $em) {
            if (preg_match('/Fields? required(?:\s+for this transition)?\s*:\s*(.+)$/i', $em, $m)) {
                foreach (preg_split('/\s*,\s*/', trim($m[1])) as $name) {
                    if ($name !== '') $missing[] = $name;
                }
            } elseif (preg_match_all("/Field\s+['\"]([^'\"]+)['\"]\s+is required/i", $em, $m)) {
                foreach ($m[1] as $name) $missing[] = $name;
            }
        }
        // Jira also reports per-field errors under `errors` keyed by field id,
        // e.g. { "customfield_12345": "Field 'Fault End' is required" }.
        // Prefer the readable name from the message when present; otherwise
        // fall back to the field id (the frontend can resolve either).
        foreach (($data['errors'] ?? []) as $fieldId => $errMsg) {
            if (stripos($errMsg, 'is required') === false) continue;
            if (preg_match("/['\"]([^'\"]+)['\"]/", $errMsg, $m)) {
                $missing[] = $m[1];
            } else {
                $missing[] = $fieldId;
            }
        }

        if ($missing) {
            respond([
                'success'        => false,
                'message'        => "Jira: {$msg}",
                'missingFields'  => array_values(array_unique($missing)),
                'code'           => 'MISSING_FIELDS',
            ], 422);
        }

        respondError("Jira: {$msg}", 502);
    }

    logActivity('jira_transition', ['key' => $key, 'transitionId' => $transitionId], $payload['sub'], $payload['name'] ?? '');
    respondOk(['transitioned' => true]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage(), 500);
}
