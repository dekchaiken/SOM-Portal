<?php
/**
 * Jira Requests Inbox — private to warapon.lea
 *
 * GET  ?action=list                            → JQL search, returns ticket list
 * GET  ?action=detail&key=TJCR-xxx            → full issue + transitions
 * POST action=assign   body:{key}              → assign to self (uses JIRA_EMAIL account)
 * POST action=transition body:{key,transitionId} → change status
 */
require_once __DIR__ . '/../helpers.php';

const INBOX_JQL    = 'project = SMC AND issuetype = "Requests SOM Portal" ORDER BY created DESC';
const INBOX_OWNER  = 'warapon.lea';
const INBOX_MAX    = 50;

// SM roles allowed to view inbox (read-only)
const INBOX_SM_ROLES = ['sm_admin', 'sm_lead', 'sm_user', 'dev_sm', 'super_admin', 'super_viewer'];

try {
    $payload = requireAuth();

    // All SM team members may view (list/detail); actions gated to owner below
    $username = $payload['username'] ?? $payload['sub'] ?? '';
    $team     = $payload['team']     ?? '';
    $role     = $payload['role']     ?? '';
    $isSM     = $team === 'sm' || in_array($role, INBOX_SM_ROLES, true);
    if (!$isSM) respondError('Forbidden', 403);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $action = strtolower(trim($_GET['action'] ?? $_POST['action'] ?? ''));
    if (!$action && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $body   = getBody();
        $action = strtolower(trim($body['action'] ?? ''));
    }

    $authHdr = jiraAuthHeader();

    // ── Shared curl helper ──────────────────────────────────────
    $jiraReq = function(string $method, string $url, ?array $postData = null) use ($authHdr) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => [$authHdr, 'Accept: application/json', 'Content-Type: application/json'],
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        ];
        if ($postData !== null) {
            $opts[CURLOPT_POSTFIELDS] = json_encode($postData);
        }
        curl_setopt_array($ch, $opts);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        return [$body, $code, $err];
    };

    // ── action=list ─────────────────────────────────────────────
    if ($action === 'list' || $action === '') {
        $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query([
            'jql'        => INBOX_JQL,
            'fields'     => 'summary,status,priority,created,updated,reporter,assignee,issuetype',
            'maxResults' => INBOX_MAX,
        ]);

        [$body, $code, $err] = $jiraReq('GET', $url);
        if ($err) respondError('Cannot reach Jira: ' . $err, 502);
        if ($code !== 200) {
            $d   = json_decode($body, true);
            $msg = $d['errorMessages'][0] ?? ($d['message'] ?? "HTTP {$code}");
            // Surface raw body for easier debugging
            respondError("Jira [{$code}]: {$msg}", 502);
        }
        $data   = json_decode($body, true);
        $issues = [];
        foreach (($data['issues'] ?? []) as $i) {
            $f        = $i['fields'];
            $reporter = $f['reporter'] ?? [];
            $assignee = $f['assignee'] ?? null;
            $issues[] = [
                'key'           => $i['key'],
                'summary'       => $f['summary']                      ?? '',
                'status'        => $f['status']['name']               ?? '',
                'status_cat'    => $f['status']['statusCategory']['key'] ?? 'new',
                'priority'      => $f['priority']['name']             ?? '',
                'created'       => $f['created']                      ?? '',
                'updated'       => $f['updated']                      ?? '',
                'reporter_name' => $reporter['displayName']           ?? '',
                'reporter_email'=> $reporter['emailAddress']          ?? '',
                'reporter_avatar'=> $reporter['avatarUrls']['24x24'] ?? '',
                'assignee_name' => $assignee ? ($assignee['displayName'] ?? '') : '',
                'is_assigned'   => $assignee !== null,
                'url'           => JIRA_BASE_URL . '/browse/' . $i['key'],
            ];
        }
        // Sort: open/in-progress first, done/closed last
        $catOrder = ['new' => 0, 'indeterminate' => 1, 'done' => 2];
        usort($issues, function($a, $b) use ($catOrder) {
            $oa = $catOrder[$a['status_cat']] ?? 1;
            $ob = $catOrder[$b['status_cat']] ?? 1;
            if ($oa !== $ob) return $oa - $ob;
            return strtotime($b['created']) - strtotime($a['created']);
        });

        $openCount = count(array_filter($issues, fn($i) => ($i['status_cat'] ?? '') !== 'done'));
        respondOk(['issues' => $issues, 'total' => $data['total'] ?? count($issues), 'open_count' => $openCount]);
    }

    // ── action=detail ───────────────────────────────────────────
    if ($action === 'detail') {
        $key = trim($_GET['key'] ?? '');
        if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);

        // Full issue with rendered description
        [$body, $code, $err] = $jiraReq(
            'GET',
            JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key)
            . '?fields=*all&expand=renderedFields,names'
        );
        if ($err)      respondError('Cannot reach Jira: ' . $err, 502);
        if ($code === 404) respondError("Issue {$key} not found", 404);
        if ($code !== 200) {
            $d   = json_decode($body, true);
            respondError('Jira: ' . ($d['errorMessages'][0] ?? "HTTP {$code}"), 502);
        }
        $issue = json_decode($body, true);
        $f     = $issue['fields'] ?? [];
        $rf    = $issue['renderedFields'] ?? [];

        // Transitions
        [$tb, $tc] = $jiraReq('GET', JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/transitions');
        $transitions = [];
        if ($tc === 200) {
            $td = json_decode($tb, true);
            foreach (($td['transitions'] ?? []) as $t) {
                $transitions[] = [
                    'id'      => $t['id'],
                    'name'    => $t['name'],
                    'to_name' => $t['to']['name'] ?? '',
                    'cat_key' => $t['to']['statusCategory']['key'] ?? 'new',
                ];
            }
        }

        $reporter = $f['reporter'] ?? [];
        $assignee = $f['assignee'] ?? null;

        respondOk([
            'key'            => $issue['key'],
            'url'            => JIRA_BASE_URL . '/browse/' . $issue['key'],
            'summary'        => $f['summary']                         ?? '',
            'status'         => $f['status']['name']                  ?? '',
            'status_cat'     => $f['status']['statusCategory']['key'] ?? 'new',
            'priority'       => $f['priority']['name']                ?? '',
            'created'        => $f['created']                         ?? '',
            'updated'        => $f['updated']                         ?? '',
            'reporter_name'  => $reporter['displayName']              ?? '',
            'reporter_email' => $reporter['emailAddress']             ?? '',
            'reporter_avatar'=> $reporter['avatarUrls']['48x48']      ?? '',
            'assignee_name'  => $assignee ? ($assignee['displayName'] ?? '') : '',
            'assignee_id'    => $assignee ? ($assignee['accountId']   ?? '') : '',
            'description_html'=> $rf['description']                   ?? '',
            'transitions'    => $transitions,
        ]);
    }

    // ── action=assign (assign to self = JIRA_EMAIL account) ─────
    if ($action === 'assign') {
        if ($username !== INBOX_OWNER) respondError('Forbidden: action requires owner account', 403);
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
        $body = getBody();
        $key  = trim($body['key'] ?? $_GET['key'] ?? '');
        if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);

        // Resolve our own accountId from Jira /myself
        [$mb, $mc, $me] = $jiraReq('GET', JIRA_BASE_URL . '/rest/api/3/myself');
        if ($me || $mc !== 200) respondError('Cannot resolve Jira account', 502);
        $me_data   = json_decode($mb, true);
        $accountId = $me_data['accountId'] ?? null;
        if (!$accountId) respondError('Could not determine Jira accountId', 502);

        [$rb, $rc, $re] = $jiraReq('PUT',
            JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/assignee',
            ['accountId' => $accountId]
        );
        if ($re)       respondError('Cannot reach Jira: ' . $re, 502);
        if ($rc !== 204) {
            $d = json_decode($rb, true);
            respondError('Jira: ' . ($d['errorMessages'][0] ?? "HTTP {$rc}"), 502);
        }

        logActivity('jira_inbox_assign', ['key' => $key], $payload['sub'], $payload['name'] ?? '');
        respondOk(['assigned' => true, 'accountId' => $accountId]);
    }

    // ── action=transition ───────────────────────────────────────
    if ($action === 'transition') {
        if ($username !== INBOX_OWNER) respondError('Forbidden: action requires owner account', 403);
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
        $body         = getBody();
        $key          = trim($body['key'] ?? '');
        $transitionId = trim($body['transitionId'] ?? '');
        if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
        if (!$transitionId) respondError('transitionId required', 400);

        [$rb, $rc, $re] = $jiraReq('POST',
            JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/transitions',
            ['transition' => ['id' => $transitionId]]
        );
        if ($re)       respondError('Cannot reach Jira: ' . $re, 502);
        if ($rc !== 204) {
            $d = json_decode($rb, true);
            respondError('Jira: ' . ($d['errorMessages'][0] ?? "HTTP {$rc}"), 502);
        }

        logActivity('jira_inbox_transition', ['key' => $key, 'transitionId' => $transitionId], $payload['sub'], $payload['name'] ?? '');
        respondOk(['transitioned' => true]);
    }

    // ── action=comment ──────────────────────────────────────────
    if ($action === 'comment') {
        if ($username !== INBOX_OWNER) respondError('Forbidden: action requires owner account', 403);
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
        $body = getBody();
        $key  = trim($body['key']  ?? '');
        $text = trim($body['text'] ?? '');
        if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
        if ($text === '') respondError('Comment text required', 400);

        // Convert plain text → ADF (each line = paragraph)
        $adf = [
            'type'    => 'doc',
            'version' => 1,
            'content' => array_map(fn($line) => [
                'type'    => 'paragraph',
                'content' => $line === '' ? [] : [['type' => 'text', 'text' => $line]],
            ], explode("\n", $text)),
        ];

        [$rb, $rc, $re] = $jiraReq('POST',
            JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/comment',
            ['body' => $adf]
        );
        if ($re)       respondError('Cannot reach Jira: ' . $re, 502);
        if ($rc !== 201) {
            $d = json_decode($rb, true);
            respondError('Jira: ' . ($d['errorMessages'][0] ?? "HTTP {$rc}"), 502);
        }
        $created = json_decode($rb, true);
        logActivity('jira_inbox_comment', ['key' => $key], $payload['sub'], $payload['name'] ?? '');
        respondOk(['comment_id' => $created['id'] ?? '']);
    }

    respondError('Unknown action', 400);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine(), 500);
}
