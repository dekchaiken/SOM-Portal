<?php
/**
 * MA Services yearly Jira stats.
 *   GET /api/ma-services/jira-stats.php[?year=YYYY][&refresh=1][&debug=…]
 *
 * What we count:
 *   • Total closed MA (Planned) tickets in SMC for the year
 *   • Business Domain breakdown (TMN / Nano / …) — read from the LINKED
 *     TJCR ticket, since MA tickets themselves don't carry the field.
 *   • Monthly trend (one bar per month)
 *
 * Internal / External classification is intentionally omitted — that data is
 * maintained by the SM team outside Jira (a Google Sheet), so we can't derive
 * it from ticket fields.
 *
 * Caching: fresh cache <2 min is served instantly; otherwise fetches from
 * Jira, updates cache. Refresh button forces a fresh fetch. Jira down + valid
 * cache → returns cache with stale=true.
 *
 * Debug:
 *   ?debug=1       → dump raw + populated customfields of 20 MA tickets
 *   ?debug=linked  → for each of 5 MA tickets, fetch the linked TJCR ticket
 *                    and dump its populated customfields
 */
require_once __DIR__ . '/../weekly-report/_jira-config.php';

const MA_STATS_CACHE_TTL = 120;

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') respondError('GET only', 405);
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!function_exists('curl_init')) respondError('PHP curl extension not enabled', 500);
    if (!jiraCredsReady())    respondError('Jira credentials not configured (.env)', 500);

    $year = (int)($_GET['year'] ?? date('Y'));
    if ($year < 2020 || $year > 2100) $year = (int)date('Y');
    $isCurrentYear = ($year === (int)date('Y'));

    $forceRefresh = !empty($_GET['refresh']);
    $debug        = isset($_GET['debug']) ? (string)$_GET['debug'] : '';

    $cacheFile = 'ma-services-jira-stats-' . $year . '.json';

    // Serve fresh cache immediately unless refresh/debug
    if ($debug === '' && !$forceRefresh) {
        $cached = readJson($cacheFile);
        if (!empty($cached['updatedAt'])) {
            $ageSec = time() - strtotime($cached['updatedAt']);
            if ($ageSec >= 0 && $ageSec < MA_STATS_CACHE_TTL) {
                $cached['fromCache'] = true;
                $cached['cacheAge']  = $ageSec;
                respondOk($cached);
            }
        }
    }

    // ── Build window + JQL ──────────────────────────────────────────────────
    $startStr    = "$year-01-01";
    $endPlus1Str = $isCurrentYear
        ? (new DateTime('tomorrow'))->format('Y-m-d')
        : ($year + 1) . '-01-01';
    $endStr = (new DateTime($endPlus1Str))->modify('-1 day')->format('Y-m-d');

    $cfg = wr_load_jira_config()['ma_stats'] ?? [];
    if (empty($cfg['jql_template'])) respondError('ma_stats config missing', 500);

    $linkedProject = $cfg['linked_project'] ?? 'TJCR';
    $domainField   = $cfg['domain_field']   ?? 'customfield_16681';
    $domainLabels  = $cfg['domain_labels']  ?? [];
    $fields        = $cfg['fields'] ?? 'summary,resolutiondate,issuelinks';
    if (strpos($fields, 'issuelinks') === false) $fields .= ',issuelinks';

    $jql = strtr($cfg['jql_template'], [
        '{start}'     => $startStr,
        '{end}'       => $endStr,
        '{end_plus1}' => $endPlus1Str,
        '{year}'      => (string)$year,
    ]);

    // ── Fetch MAs ────────────────────────────────────────────────────────────
    // Any failure at this stage — cURL, HTTP 5xx, timeout, invalid JSON —
    // triggers the cache fallback. Only when there is no cache do we surface
    // the error to the client (so the UI can show a proper empty state).
    try {
        $issues = wr_jira_search_all($jql, $fields, 100, 5000);
    } catch (Throwable $e) {
        $cached = readJson($cacheFile);
        if (!empty($cached['total'])) {
            $cached['stale']       = true;
            $cached['fallbackErr'] = $e->getMessage();
            respondOk($cached);
        }
        respondError('Jira unreachable: ' . $e->getMessage(), 503);
    }

    // ── ?debug=1 or ?debug=linked — see previous behaviour ──────────────────
    if ($debug === '1' || $debug === 'linked') {
        return _mastats_run_debug($issues, $debug);
    }

    // ── Collect linked TJCR keys per MA (first link that matches the target project) ──
    $maToLinked = [];  // ma_key → tjcr_key
    $tjcrKeys   = [];
    foreach ($issues as $iss) {
        $maKey = $iss['key'] ?? '';
        if (!$maKey) continue;
        $links = $iss['fields']['issuelinks'] ?? [];
        foreach ($links as $ln) {
            $lk = $ln['inwardIssue']['key'] ?? $ln['outwardIssue']['key'] ?? null;
            if (!$lk) continue;
            if (strpos($lk, $linkedProject . '-') !== 0) continue;
            $maToLinked[$maKey] = $lk;
            $tjcrKeys[$lk] = true;
            break; // first matching link wins
        }
    }
    $tjcrKeys = array_keys($tjcrKeys);

    // ── Batch fetch linked TJCR domain values ───────────────────────────────
    // Uses JQL `key in (a,b,c…)` in chunks of ~50 keys per request.
    $linkedDomain = []; // tjcr_key → domain string (raw Jira value)
    if (!empty($tjcrKeys)) {
        foreach (array_chunk($tjcrKeys, 50) as $chunk) {
            $chunkJql = 'key in (' . implode(',', $chunk) . ')';
            try {
                $chunkIssues = wr_jira_search_all($chunkJql, "summary,{$domainField}", 100, 100);
            } catch (Exception $e) { continue; }
            foreach ($chunkIssues as $li) {
                $k = $li['key'] ?? '';
                if (!$k) continue;
                $v = _mastats_flatten_field_value($li['fields'][$domainField] ?? null);
                $linkedDomain[$k] = $v;
            }
        }
    }

    // ── Aggregate ────────────────────────────────────────────────────────────
    $byMonth  = [];
    $byDomain = [];
    $total    = 0;
    // Domain totals for header cards (already-labelled buckets keyed by label)
    $primaryDomains = ['TrueMoney', 'Nano'];
    $domainTotals   = ['TrueMoney' => 0, 'Nano' => 0, 'Other' => 0];

    // Seed 12 months
    for ($m = 1; $m <= 12; $m++) {
        $key = sprintf('%04d-%02d', $year, $m);
        $byMonth[$key] = ['month' => $key, 'count' => 0];
    }

    // Active pipeline buckets (not-Done tickets — always current, no year filter)
    // These are the "upcoming/backlog/in-progress" MAs that show on the board.
    $pipeline = [
        'total'      => 0,
        'todo'       => 0,   // statusCategory = new
        'inProgress' => 0,   // statusCategory = indeterminate
        'items'      => [],  // compact records for optional drill-down
    ];

    foreach ($issues as $iss) {
        $maKey    = $iss['key'] ?? '';
        $f        = $iss['fields'] ?? [];
        $statusCat = strtolower((string)($f['status']['statusCategory']['key'] ?? ''));
        $statusNm  = (string)($f['status']['name'] ?? '');
        $resDate   = substr((string)($f['resolutiondate'] ?? ''), 0, 10);

        // Bucket: not-Done tickets go to the pipeline count regardless of date.
        // Done tickets flow through the existing yearly aggregation below.
        if ($statusCat !== 'done') {
            $pipeline['total']++;
            if ($statusCat === 'indeterminate') $pipeline['inProgress']++;
            else                                $pipeline['todo']++;
            $sum = (string)($f['summary'] ?? '');
            if (mb_strlen($sum) > 140) $sum = mb_substr($sum, 0, 137) . '…';
            // Jira description → plain text with faithful line/paragraph breaks.
            // Newer Jira returns ADF (nested JSON); older returns a plain string.
            // Cap at 6KB per ticket to keep the response reasonable while still
            // showing the full text of even long MA plans on the Kanban card.
            $descRaw = $f['description'] ?? null;
            if (is_array($descRaw)) {
                // Recursive flatten. Each node returns the text it contributes,
                // with trailing whitespace baked in so structure survives when
                // parent concatenates children with an empty string.
                //   • text        → the literal string
                //   • hardBreak   → "\n"  (inline break within a paragraph)
                //   • paragraph   → children + "\n\n" (blank line between paragraphs)
                //   • heading     → children + "\n\n"
                //   • listItem    → "• " + children + "\n"
                //   • bulletList/orderedList → children (items already carry \n)
                //   • doc/blockquote/panel/codeBlock → children + "\n"
                $flatten = function ($node) use (&$flatten) {
                    if (!is_array($node)) return '';
                    $type = $node['type'] ?? '';
                    if ($type === 'text')      return (string)($node['text'] ?? '');
                    if ($type === 'hardBreak') return "\n";
                    $inner = '';
                    foreach (($node['content'] ?? []) as $c) $inner .= $flatten($c);
                    switch ($type) {
                        case 'paragraph':
                        case 'heading':                       return $inner . "\n\n";
                        case 'listItem':                      return '• ' . ltrim(rtrim($inner)) . "\n";
                        case 'bulletList':
                        case 'orderedList':                   return $inner;
                        case 'codeBlock':
                        case 'blockquote':
                        case 'panel':                         return $inner . "\n";
                        default:                              return $inner;
                    }
                };
                $descRaw = $flatten($descRaw);
            }
            $descRaw = (string)$descRaw;
            // Normalise: CRLF → LF, collapse ≥3 blank lines to 2, trim, cap length
            $descFull = preg_replace("/\r\n?/", "\n", $descRaw);
            $descFull = preg_replace("/\n{3,}/", "\n\n", trim($descFull));
            if (mb_strlen($descFull) > 6000) $descFull = mb_substr($descFull, 0, 5997) . '…';

            // Custom field extraction — normalise datetime, option, array-of-users
            $fmtDt = function ($v) {
                if (!$v || !is_string($v)) return null;
                // "2026-08-19T00:00:00.000+0700" → "19/08/2026 00:00"
                $ts = strtotime($v);
                return $ts ? date('d/m/Y H:i', $ts) : substr($v, 0, 16);
            };
            $optName = function ($v) {
                if (is_array($v)) {
                    $out = $v['value'] ?? ($v['name'] ?? null);
                    if (!empty($v['child']['value'])) $out .= ' — ' . $v['child']['value'];
                    return $out;
                }
                return $v ?: null;
            };
            $userList = function ($v) {
                if (!is_array($v)) return [];
                $out = [];
                foreach ($v as $u) {
                    if (is_array($u) && !empty($u['displayName'])) $out[] = $u['displayName'];
                }
                return $out;
            };

            $pipeline['items'][] = [
                'key'         => $maKey,
                'summary'     => $sum,
                'description' => $descFull,
                'status'      => $statusNm,
                'statusCat'   => $statusCat,       // 'new' | 'indeterminate'
                'priority'    => $f['priority']['name'] ?? null,
                'due'         => substr((string)($f['duedate'] ?? ''), 0, 10) ?: null,
                'created'     => substr((string)($f['created']  ?? ''), 0, 10) ?: null,
                'updated'     => substr((string)($f['updated']  ?? ''), 0, 10) ?: null,
                'owner'       => $f['assignee']['displayName']
                              ?? $f['reporter']['displayName']
                              ?? '(unassigned)',
                'assignee'    => $f['assignee']['displayName'] ?? null,
                'reporter'    => $f['reporter']['displayName'] ?? null,
                // Custom fields — see field-id map comment in _jira-config.php
                'reference'   => $f['customfield_16213'] ?? null,
                'startAt'     => $fmtDt($f['customfield_16214'] ?? null),
                'endAt'       => $fmtDt($f['customfield_16215'] ?? null),
                'maMsgTh'     => $f['customfield_16216'] ?? null,
                'maMsgEn'     => $f['customfield_16217'] ?? null,
                'reviewers'   => $userList($f['customfield_16023'] ?? null),
                'toggle1'     => $optName($f['customfield_16677'] ?? null),
                'toggle2'     => $optName($f['customfield_16745'] ?? null),
                'mopLink'     => $f['customfield_15866'] ?? null,
                'mainType'    => $optName($f['customfield_18903'] ?? null),
            ];
            continue;
        }

        // ── Done path (existing behavior) ─────────────────────────────
        if ($resDate === '') continue;
        $ym = substr($resDate, 0, 7);
        if (!isset($byMonth[$ym])) continue;

        $byMonth[$ym]['count']++;
        $total++;

        // Domain via linked TJCR
        $tjcrKey  = $maToLinked[$maKey] ?? null;
        $rawValue = $tjcrKey ? ($linkedDomain[$tjcrKey] ?? '') : '';
        $label    = $rawValue !== '' ? ($domainLabels[$rawValue] ?? $rawValue) : 'Other';
        $bucket   = isset($domainTotals[$label]) ? $label : 'Other';
        $domainTotals[$bucket]++;

        $rowKey = $rawValue !== '' ? $rawValue : '(none)';
        if (!isset($byDomain[$rowKey])) {
            $byDomain[$rowKey] = [
                'key'     => $rowKey,
                'label'   => $label,
                'count'   => 0,
                'percent' => 0,
                'tickets' => [],
            ];
        }
        $byDomain[$rowKey]['count']++;

        // Attach a compact ticket record for drill-down. Summary is truncated
        // so the response stays small (a typical year fits well under 30KB).
        $summary = (string)($f['summary'] ?? '');
        if (mb_strlen($summary) > 140) $summary = mb_substr($summary, 0, 137) . '…';
        $byDomain[$rowKey]['tickets'][] = [
            'key'      => $maKey,
            'summary'  => $summary,
            'resolved' => $resDate,
            'tjcr'     => $tjcrKey,
            'owner'    => $f['assignee']['displayName']
                       ?? $f['reporter']['displayName']
                       ?? '(unassigned)',
        ];
    }

    // Compute per-domain percent + sort tickets (newest first) + row order
    foreach ($byDomain as &$row) {
        $row['percent'] = $total ? round($row['count'] / $total * 100, 1) : 0;
        usort($row['tickets'], fn($a, $b) => strcmp($b['resolved'], $a['resolved']));
    }
    unset($row);
    uasort($byDomain, function ($a, $b) {
        if ($a['label'] === 'Other') return 1;
        if ($b['label'] === 'Other') return -1;
        return $b['count'] - $a['count'];
    });

    $result = [
        'year'  => $year,
        'total' => $total,
        'tmn'   => [
            'count'   => $domainTotals['TrueMoney'],
            'percent' => $total ? round($domainTotals['TrueMoney'] / $total * 100, 1) : 0.0,
        ],
        'nano'  => [
            'count'   => $domainTotals['Nano'],
            'percent' => $total ? round($domainTotals['Nano'] / $total * 100, 1) : 0.0,
        ],
        'other' => [
            'count'   => $domainTotals['Other'],
            'percent' => $total ? round($domainTotals['Other'] / $total * 100, 1) : 0.0,
        ],
        'byMonth'  => array_values($byMonth),
        'byDomain' => array_values($byDomain),
        // Active pipeline — currently-open MAs (not filtered by year). Sorted
        // by duedate ascending (soonest first), falling back to created date.
        'pipeline' => (function () use ($pipeline) {
            usort($pipeline['items'], function ($a, $b) {
                $ad = $a['due'] ?? '9999-99-99';
                $bd = $b['due'] ?? '9999-99-99';
                if ($ad !== $bd) return strcmp($ad, $bd);
                return strcmp($b['created'] ?? '', $a['created'] ?? '');
            });
            return $pipeline;
        })(),
        'range'    => ['start' => $startStr, 'end' => $endStr],
        'lookup'   => [
            'linked_project'   => $linkedProject,
            'linked_lookups'   => count($tjcrKeys),
            'linked_resolved'  => count($linkedDomain),
            'mas_without_link' => $total - count($maToLinked),
        ],
        'updatedAt' => date('c'),
        'fromCache' => false,
    ];

    @writeJson($cacheFile, $result);
    respondOk($result);
} catch (Throwable $e) {
    // Last-line-of-defence: even for unexpected server errors, if we have any
    // cache for this year, serve it as stale rather than blowing up the UI.
    $cacheFile = 'ma-services-jira-stats-' . (isset($year) ? $year : date('Y')) . '.json';
    $cached = readJson($cacheFile);
    if (!empty($cached['total'])) {
        $cached['stale']       = true;
        $cached['fallbackErr'] = $e->getMessage();
        respondOk($cached);
    }
    respondError('Server error: ' . $e->getMessage(), 500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Turn any Jira field value into a plain string. Empty ⇒ "". */
function _mastats_flatten_field_value($v): string {
    if ($v === null || $v === '' || $v === false)         return '';
    if (is_scalar($v))                                    return trim((string)$v);
    if (is_array($v)) {
        if (isset($v['value']))                           return trim((string)$v['value']);
        if (isset($v['name']))                            return trim((string)$v['name']);
        if (isset($v['displayName']))                     return trim((string)$v['displayName']);
        if (isset($v[0]) && is_array($v[0])) {
            $parts = [];
            foreach (array_slice($v, 0, 5) as $x) {
                $parts[] = $x['value'] ?? $x['name'] ?? '';
            }
            return trim(implode(', ', array_filter($parts)));
        }
    }
    return '';
}

/** Load Jira field metadata (id => name) once per request. */
function _mastats_fetch_field_meta(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $url = JIRA_BASE_URL . '/rest/api/2/field';
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Accept: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status !== 200 || !$resp) { $cache = []; return $cache; }
    $arr = json_decode($resp, true) ?: [];
    $out = [];
    foreach ($arr as $f) {
        if (!empty($f['id']) && !empty($f['name'])) $out[$f['id']] = $f['name'];
    }
    $cache = $out;
    return $out;
}

/** Fetch a single Jira issue with all fields. */
function _mastats_fetch_one(string $key): ?array {
    $url = JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '?fields=*all';
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Accept: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status !== 200 || !$resp) return null;
    return json_decode($resp, true) ?: null;
}

/** Re-fetch the first N issues with ALL fields for debug mode. */
function _mastats_refetch_full(array $issues, int $n = 20): array {
    $out = [];
    foreach (array_slice($issues, 0, $n) as $iss) {
        if (empty($iss['key'])) continue;
        $li = _mastats_fetch_one($iss['key']);
        if ($li) $out[] = $li;
    }
    return $out;
}

/** Debug helpers — kept small so the main flow stays readable. */
function _mastats_run_debug(array $issues, string $mode): void {
    if ($mode === 'linked') {
        $meta = _mastats_fetch_field_meta();
        $out = [];
        foreach (_mastats_refetch_full($issues, 5) as $ma) {
            $links  = $ma['fields']['issuelinks'] ?? [];
            $linked = [];
            foreach ($links as $ln) {
                $k = $ln['inwardIssue']['key'] ?? $ln['outwardIssue']['key'] ?? null;
                if ($k) $linked[] = $k;
            }
            $details = [];
            foreach (array_slice($linked, 0, 3) as $lk) {
                $li = _mastats_fetch_one($lk);
                if (!$li) continue;
                $flat = [];
                foreach (($li['fields'] ?? []) as $fid => $fv) {
                    if (strpos($fid, 'customfield_') !== 0) continue;
                    $v = _mastats_flatten_field_value($fv);
                    if ($v === '') continue;
                    $flat[$fid] = ($meta[$fid] ?? '(unknown)') . ' → ' . $v;
                }
                $details[] = [
                    'linked_key'     => $lk,
                    'linked_summary' => $li['fields']['summary'] ?? '',
                    'linked_project' => $li['fields']['project']['key'] ?? '',
                    'populated_customfields' => $flat,
                ];
            }
            $out[] = [
                'ma_key'              => $ma['key'] ?? '',
                'ma_summary'          => $ma['fields']['summary'] ?? '',
                'linked_issue_keys'   => $linked,
                'linked_issue_detail' => $details,
            ];
        }
        respondOk(['mode' => 'linked', 'items' => $out]);
    }

    // ?debug=1 — dump all populated customfields on the MA ticket itself
    $meta = _mastats_fetch_field_meta();
    $sample = [];
    foreach (_mastats_refetch_full($issues, 20) as $iss) {
        $flat = [];
        foreach (($iss['fields'] ?? []) as $fid => $fv) {
            if (strpos($fid, 'customfield_') !== 0) continue;
            $v = _mastats_flatten_field_value($fv);
            if ($v === '') continue;
            $flat[$fid] = ($meta[$fid] ?? '(unknown)') . ' → ' . $v;
        }
        $sample[] = [
            'key' => $iss['key'] ?? '',
            'summary' => $iss['fields']['summary'] ?? '',
            'populated_customfields' => $flat,
        ];
    }
    respondOk(['mode' => '1', 'total_issues' => count($issues), 'sample' => $sample]);
}
