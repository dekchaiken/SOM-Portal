<?php
/**
 * Shared config + client for the weekly-report Jira sync endpoints.
 *
 * - Credentials come from .env (JIRA_EMAIL / JIRA_TOKEN) via helpers.php.
 * - JQL templates are per-team: data/{team}/weekly-report-jira.json.
 *   Placeholders {start}, {end}, {end_plus1} are substituted at request time.
 * - When a team has no config file, we fall back to the historical hardcoded
 *   SM values so the SM UI keeps working exactly as before.
 *
 * Used by:
 *   sync-jira-ma.php, sync-jira-dev.php, sync-jira-incidents.php
 */
require_once __DIR__ . '/../helpers.php';

// Defaults = the JQL templates that were hardcoded in the original endpoints.
// Kept here so SM (and any team without a custom config) sees no behaviour change.
function wr_default_jira_config(): array {
    return [
        // MA: closed Planned tickets in SMC by resolutiondate
        'ma' => [
            'jql_template' =>
                'project = SMC AND issuetype = Planned AND statusCategory = Done'
                . ' AND resolutiondate >= "{start}"'
                . ' AND resolutiondate <= "{end_plus1}"'
                . ' ORDER BY resolutiondate DESC',
            'fields' => 'summary,status,assignee,reporter,resolutiondate',
            'status_label' => 'Done',
        ],
        // Dev: closed Grafana / Heartbeats / Configuration tickets in SMC.
        //   • status = "Close" (excludes Canceled, matches the historical rule)
        'dev' => [
            'jql_template' =>
                'project = SMC AND issuetype IN (Grafana, Heartbeats, Configuration)'
                . ' AND status = "Close"'
                . ' AND resolutiondate >= "{start}"'
                . ' AND resolutiondate <= "{end_plus1}"'
                . ' ORDER BY resolutiondate DESC',
            'fields' => 'summary,status,assignee,reporter,resolutiondate,issuetype',
            'status_label' => 'Done',
            'max_results'  => 200,
        ],
        // MA Services yearly stats — full-year window + Business Domain
        // breakdown (TMN / NANO / …).
        //
        // Interesting discovery from ?debug=linked: MA tickets in SMC project
        // do NOT carry the Business Domain field themselves. It lives on the
        // LINKED TJCR ticket (customfield_16681) — each MA links to a TJCR
        // change/incident where the domain is set.
        //
        // Internal / External classification (RCA) is maintained manually by
        // the SM team in a Google Sheet, not in Jira, so we skip it here.
        'ma_stats' => [
            // Fetches BOTH: all Done tickets in the year (existing behavior)
            // PLUS all currently-active tickets (To Do / In Progress) regardless
            // of date — those are the "upcoming pipeline" shown in the board.
            'jql_template' =>
                'project = SMC AND issuetype = Planned AND ('
                . '  (statusCategory = Done'
                . '     AND resolutiondate >= "{start}"'
                . '     AND resolutiondate <= "{end_plus1}")'
                . '  OR statusCategory != Done'
                . ') ORDER BY updated DESC',
            // status + duedate needed for pipeline aggregation; created kept for
            // future "planned in year" filtering. description + priority feed the
            // Kanban card view on ma-planwork.html.
            // Custom fields fetched for the Planwork card (matches what SM sees in Jira):
            //   16213 Reference · 16214 Start Date/Time · 16215 End Date/Time
            //   16216 MA Message (TH) · 16217 MA Message (EN)
            //   16023 Manager Review (array of users)
            //   16677 Toggle ON/OFF Features · 16745 Toggle ON/OFF Features.
            //   15866 MOP link · 18903 Main Type
            'fields' => 'summary,description,priority,status,resolutiondate,created,duedate,updated,'
                     . 'assignee,reporter,issuelinks,'
                     . 'customfield_16213,customfield_16214,customfield_16215,'
                     . 'customfield_16216,customfield_16217,'
                     . 'customfield_16023,customfield_16677,customfield_16745,'
                     . 'customfield_15866,customfield_18903',

            // ── Business Domain via linked ticket ───────────────────────────
            // Each MA has an issuelink to a ticket in this project. We batch-
            // fetch those linked tickets and read `domain_field`.
            'linked_project' => 'TJCR',
            'domain_field'   => 'customfield_16681',

            // Display labels for domain values (raw Jira value → shown label).
            // Values not listed here fall back to "Other".
            'domain_labels' => [
                'TMN'  => 'TrueMoney',
                'NNO'  => 'Nano',
                'NANO' => 'Nano',
            ],
        ],
        // Incidents: created in TJCR under the "Incidents" ticket category
        'incidents' => [
            'jql_template' =>
                '"Ticket category" = Incidents AND project = TJCR'
                . ' AND created >= "{start}"'
                . ' AND created <= "{end_plus1}"'
                . ' ORDER BY created DESC',
            'fields' => 'summary,status,assignee,reporter,created,priority',
            'status_label' => null, // pass-through
        ],
    ];
}

/**
 * Load the current team's Jira config, merged over defaults. Callers must
 * have already established $GLOBALS['_current_team'] via requireAuth().
 */
function wr_load_jira_config(): array {
    $defaults = wr_default_jira_config();
    $stored   = readJson('weekly-report-jira.json');
    if (!is_array($stored)) return $defaults;
    $out = $defaults;
    foreach (['ma', 'dev', 'incidents'] as $k) {
        if (isset($stored[$k]) && is_array($stored[$k])) {
            $out[$k] = array_merge($defaults[$k], $stored[$k]);
        }
    }
    return $out;
}

/**
 * Turn a `week-YYYY-MM-DD` string into a 7-day window and return the
 * substituted JQL string.
 */
function wr_build_jql(string $tpl, string $weekStartDate): array {
    $start = new DateTime($weekStartDate);
    $end   = (clone $start)->modify('+6 days');
    // Jira treats bare date as 00:00:00 — add 1 day to include the whole end day.
    $endPlus1 = (clone $end)->modify('+1 day');

    $jql = strtr($tpl, [
        '{start}'     => $start->format('Y-m-d'),
        '{end}'       => $end->format('Y-m-d'),
        '{end_plus1}' => $endPlus1->format('Y-m-d'),
    ]);

    return [
        'jql'   => $jql,
        'start' => $start->format('Y-m-d'),
        'end'   => $end->format('Y-m-d'),
    ];
}

/**
 * Fire the Jira /rest/api/3/search/jql request. Returns the parsed JSON or
 * throws on any transport / HTTP error. All 3 endpoints use identical curl
 * setup, so it lives here.
 */
function wr_jira_search(string $jql, string $fields, int $maxResults = 100): array {
    if (!function_exists('curl_init')) {
        throw new Exception('cURL extension is not installed');
    }
    if (!JIRA_EMAIL || !JIRA_TOKEN) {
        throw new Exception('Jira credentials not configured (.env JIRA_EMAIL / JIRA_TOKEN)');
    }

    $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query([
        'jql'        => $jql,
        'maxResults' => $maxResults,
        'fields'     => $fields,
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(JIRA_EMAIL . ':' . JIRA_TOKEN),
            'Accept: application/json',
            'Content-Type: application/json',
        ],
    ]);

    $resp   = curl_exec($ch);
    $errno  = curl_errno($ch);
    $err    = curl_error($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno !== 0) throw new Exception("cURL error ($errno): $err");
    if ($status !== 200) {
        $tail = $resp ? ' — ' . substr($resp, 0, 200) : '';
        throw new Exception("Jira API HTTP $status$tail");
    }
    $data = json_decode($resp, true);
    if (!$data || !isset($data['issues'])) throw new Exception('Invalid Jira API response');
    return $data;
}

/**
 * Retry an authenticated Jira GET with exponential backoff. Retries on:
 *   • cURL transport errors (network, DNS, TLS handshake)
 *   • HTTP 5xx (server hiccup)
 *   • HTTP 429 (rate limit)
 * Immediately fails on:
 *   • 4xx other than 429 (bad JQL / auth → retrying won't help)
 *
 * Returns [decodedJson|null, statusCode, errorString].
 */
function wr_jira_get_retry(string $url, int $tries = 3, int $timeout = 45): array {
    $attempt = 0;
    $lastErr = '';
    $lastStatus = 0;
    while ($attempt < $tries) {
        $attempt++;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Basic ' . base64_encode(JIRA_EMAIL . ':' . JIRA_TOKEN),
                'Accept: application/json',
            ],
        ]);
        $resp   = curl_exec($ch);
        $errno  = curl_errno($ch);
        $err    = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno !== 0) {
            $lastErr = "cURL error ($errno): $err";
            $lastStatus = 0;
        } elseif ($status >= 500 || $status === 429) {
            $lastErr    = "Jira HTTP $status";
            $lastStatus = $status;
        } elseif ($status !== 200) {
            // 4xx non-429: don't retry
            return [null, $status, "Jira HTTP $status" . ($resp ? ' — ' . substr($resp, 0, 200) : '')];
        } else {
            $data = json_decode($resp, true);
            if ($data === null) {
                $lastErr = 'Invalid JSON from Jira';
            } else {
                return [$data, 200, ''];
            }
        }

        // Backoff before next attempt: 400ms, 1200ms
        if ($attempt < $tries) usleep(400_000 * $attempt);
    }
    return [null, $lastStatus, $lastErr];
}

/**
 * Paginated Jira search using nextPageToken. Returns all issues up to $cap,
 * deduplicated by key. Uses wr_jira_get_retry() so transient failures don't
 * kill the whole run — only a truly persistent error raises.
 */
function wr_jira_search_all(string $jql, string $fields, int $pageSize = 100, int $cap = 5000): array {
    $issues = [];
    $seen   = [];
    $token  = null;
    $iter   = 0;
    $maxIter = ceil($cap / max($pageSize, 1)) + 2;
    do {
        $iter++;
        $params = ['jql' => $jql, 'maxResults' => $pageSize, 'fields' => $fields];
        if ($token) $params['nextPageToken'] = $token;
        $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query($params);

        [$data, $status, $err] = wr_jira_get_retry($url);
        if (!$data) throw new Exception($err ?: "Jira HTTP $status");
        if (!isset($data['issues'])) throw new Exception('Invalid Jira response');

        foreach ($data['issues'] as $iss) {
            $k = $iss['key'] ?? '';
            if ($k === '' || isset($seen[$k])) continue;
            $seen[$k] = true;
            $issues[] = $iss;
            if (count($issues) >= $cap) break 2;
        }
        $token = $data['nextPageToken'] ?? null;
    } while ($token && $iter < $maxIter);

    return $issues;
}

/**
 * Normalise a Jira issue into the shape the weekly-report frontend expects.
 * Owner falls back: assignee → reporter → "(unassigned)".
 */
function wr_normalise_issue(array $issue, ?string $statusLabelOverride = null): array {
    $key    = $issue['key']    ?? '';
    $fields = $issue['fields'] ?? [];
    $owner  = $fields['assignee']['displayName']
           ?? $fields['reporter']['displayName']
           ?? '(unassigned)';
    return [
        'summary'   => $fields['summary'] ?? '',
        'ticketId'  => $key,
        'ticketUrl' => JIRA_BASE_URL . '/browse/' . $key,
        'owner'     => $owner,
        'status'    => $statusLabelOverride ?? ($fields['status']['name'] ?? ''),
    ];
}
