<?php
/**
 * Search Jira users assignable to the SMC project.
 * GET /api/jira/users-search.php?q=name        ← search by display name / email
 *
 * Returns: [ { accountId, displayName, email, avatar } ]
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $q = trim($_GET['q'] ?? '');

    // Use assignable-user search scoped to the SMC project
    $url = JIRA_BASE_URL . '/rest/api/3/user/assignable/search?'
         . http_build_query([
             'project'    => JIRA_PROJECT_KEY,
             'query'      => $q,
             'maxResults' => 30,
         ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Accept: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err)            respondError('Cannot reach Jira: ' . $err, 502);
    if ($code !== 200) {
        $data = json_decode($resp, true);
        $msg = $data['errorMessages'][0] ?? "HTTP {$code}";
        respondError("Jira: {$msg}", 502);
    }

    $users = json_decode($resp, true) ?: [];
    $out = [];
    foreach ($users as $u) {
        $out[] = [
            'accountId'   => $u['accountId']    ?? '',
            'displayName' => $u['displayName']  ?? '',
            'email'       => $u['emailAddress'] ?? '',
            'avatar'      => $u['avatarUrls']['24x24'] ?? '',
            'active'      => $u['active'] ?? false,
        ];
    }

    respondOk($out);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage(), 500);
}
