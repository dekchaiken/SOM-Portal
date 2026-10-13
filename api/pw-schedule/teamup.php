<?php
/**
 * pw-schedule/teamup.php
 *
 * Read-only proxy that fetches events from a Teamup calendar (configured in
 * pw_schedule_config.json) and returns a normalized shape. Cached for 5min
 * per team + window to protect against page reloads hammering Teamup.
 *
 *   GET ?start=YYYY-MM-DD&end=YYYY-MM-DD[&force=1]
 *     → {
 *         events: [
 *           { id, title, start, end, all_day, location, notes,
 *             subcalendar_id, color, source }
 *         ],
 *         from_cache: bool,
 *         cached_at:  iso,
 *         mode:       'ics' | 'api',
 *         window:     { start, end }
 *       }
 *
 * Three modes (chosen by admin in pw_schedule_config.json):
 *   - 'share' (default) → fetch https://teamup.com/{key}/events?startDate&endDate&tz
 *                         with browser-like headers. No token needed. This is
 *                         the same undocumented endpoint the public share page
 *                         uses to render its own calendar.
 *   - 'ics'             → fetch https://ics.teamup.com/feed/{key}/0.ics, parse VEVENT
 *   - 'api'             → fetch https://api.teamup.com/{key}/events?startDate&endDate
 *                         with `Teamup-Token: {token}` header
 *
 * The calendar key comes from config only (never from the request) to prevent
 * this endpoint being turned into a generic SSRF gadget.
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('GET required', 405);

$payload = requireAuth();

const PW_TEAMUP_CACHE_FILE = 'pw_teamup_cache.json';
const PW_TEAMUP_CACHE_TTL  = 300; // 5 min

// ── Params ────────────────────────────────────────────────────────────
$start = trim($_GET['start'] ?? '');
$end   = trim($_GET['end']   ?? '');
$force = !empty($_GET['force']);

if ($start === '' || $end === '') {
    // Default = current month
    date_default_timezone_set('Asia/Bangkok');
    $start = date('Y-m-01');
    $end   = date('Y-m-t');
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start)) respondError('start must be YYYY-MM-DD', 400);
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $end))   respondError('end must be YYYY-MM-DD', 400);
if (strtotime($end) < strtotime($start))          respondError('end must be >= start', 400);

// ── Config ────────────────────────────────────────────────────────────
$cfg   = readJson('pw_schedule_config.json');
$key   = trim($cfg['teamup_calendar_key'] ?? '');
$mode  = strtolower(trim($cfg['teamup_mode'] ?? 'ics'));
$token = trim($cfg['teamup_api_token'] ?? '');

if ($key === '') respondError('Teamup calendar key not configured — set it in Admin › PW Schedule.', 400);
if (!preg_match('/^[A-Za-z0-9]{8,}$/', $key)) respondError('Invalid Teamup calendar key on file', 500);
if (!in_array($mode, ['share', 'ics', 'api'], true)) $mode = 'share';
if ($mode === 'api' && $token === '') {
    respondError('Teamup mode is "api" but no API token is configured.', 400);
}

// ── Cache lookup ──────────────────────────────────────────────────────
$cacheKey = $mode . ':' . $start . ':' . $end;
$cacheAll = readJson(PW_TEAMUP_CACHE_FILE);
if (!isset($cacheAll['entries']) || !is_array($cacheAll['entries'])) {
    $cacheAll = ['entries' => []];
}

if (!$force && !empty($cacheAll['entries'][$cacheKey])) {
    $hit = $cacheAll['entries'][$cacheKey];
    $age = time() - (int)strtotime($hit['cached_at'] ?? '');
    if ($age >= 0 && $age < PW_TEAMUP_CACHE_TTL) {
        respondOk([
            'events'       => $hit['events'] ?? [],
            'subcalendars' => $hit['subcalendars'] ?? [],
            'from_cache'   => true,
            'cached_at'    => $hit['cached_at'],
            'mode'         => $mode,
            'window'       => ['start' => $start, 'end' => $end],
        ]);
    }
}

// ── Fetch ─────────────────────────────────────────────────────────────
$events       = [];
$subcalendars = [];   // [{id, name, color_id}]
$fetchErr     = null;

if ($mode === 'api' || $mode === 'share') {
    if ($mode === 'api') {
        $url = 'https://api.teamup.com/' . rawurlencode($key)
             . '/events?startDate=' . rawurlencode($start)
             . '&endDate='   . rawurlencode($end);
        $headers = ['Teamup-Token: ' . $token, 'Accept: application/json'];
    } else {
        // 'share' — same endpoint the public share page's XHR uses. No token.
        $url = 'https://teamup.com/' . rawurlencode($key)
             . '/events?startDate=' . rawurlencode($start)
             . '&endDate='   . rawurlencode($end)
             . '&tz='        . rawurlencode('Asia/Bangkok');
        $headers = [
            'Accept: application/json',
            'X-Requested-With: XMLHttpRequest',
            'Referer: https://teamup.com/' . rawurlencode($key),
            // Some public-share endpoints reject the default cURL UA.
            'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36',
        ];
    }

    [$body, $httpCode, $curlErr] = pwTeamupFetch($url, $headers);
    if ($curlErr !== null) {
        $fetchErr = 'cURL: ' . $curlErr;
    } elseif ($httpCode !== 200) {
        $preview = trim(preg_replace('/\s+/', ' ', substr((string)$body, 0, 300)));
        $fetchErr = "Teamup HTTP {$httpCode} — {$preview}";
    } else {
        $decoded = json_decode((string)$body, true);
        if (!is_array($decoded) || !isset($decoded['events']) || !is_array($decoded['events'])) {
            $fetchErr = 'Teamup returned unexpected JSON shape';
        } else {
            foreach ($decoded['events'] as $ev) {
                $events[] = pwTeamupNormalizeApi($ev, $mode);
            }
        }
    }

    // Fetch subcalendars (names + Teamup color IDs) — non-fatal if it fails.
    if ($fetchErr === null) {
        $subUrl = ($mode === 'api')
            ? 'https://api.teamup.com/' . rawurlencode($key) . '/subcalendars'
            : 'https://teamup.com/'     . rawurlencode($key) . '/subcalendars';
        [$sBody, $sCode, $sErr] = pwTeamupFetch($subUrl, $headers);
        if ($sErr === null && $sCode === 200) {
            $sDec = json_decode((string)$sBody, true);
            if (is_array($sDec) && isset($sDec['subcalendars']) && is_array($sDec['subcalendars'])) {
                foreach ($sDec['subcalendars'] as $sc) {
                    if (empty($sc['active'])) continue;
                    $subcalendars[] = [
                        'id'       => (string)($sc['id']    ?? ''),
                        'name'     => (string)($sc['name']  ?? ''),
                        'color_id' => (int)   ($sc['color'] ?? 0),
                    ];
                }
            }
        }
    }
} else {
    // ICS
    $url = 'https://ics.teamup.com/feed/' . rawurlencode($key) . '/0.ics';
    [$body, $httpCode, $curlErr] = pwTeamupFetch($url, ['Accept: text/calendar']);
    if ($curlErr !== null) {
        $fetchErr = 'cURL: ' . $curlErr;
    } elseif ($httpCode !== 200) {
        $preview = trim(preg_replace('/\s+/', ' ', substr((string)$body, 0, 300)));
        $fetchErr = "Teamup HTTP {$httpCode} — {$preview}";
    } else {
        $events = pwTeamupParseIcs((string)$body, $start, $end);
    }
}

if ($fetchErr !== null) {
    logIntegrationError('teamup-pw', $url ?? '(unknown)', $fetchErr, [
        'mode'  => $mode,
        'range' => "$start → $end",
    ]);
    // Fall back to stale cache if available so a transient Teamup blip doesn't
    // wipe the calendar for the user.
    if (!empty($cacheAll['entries'][$cacheKey])) {
        $hit = $cacheAll['entries'][$cacheKey];
        respondOk([
            'events'       => $hit['events'] ?? [],
            'subcalendars' => $hit['subcalendars'] ?? [],
            'from_cache'   => true,
            'stale'        => true,
            'cached_at'    => $hit['cached_at'],
            'mode'         => $mode,
            'window'       => ['start' => $start, 'end' => $end],
            'error'        => $fetchErr,
        ]);
    }
    respondError('Teamup fetch failed: ' . $fetchErr, 502);
}

// Sort chronologically
usort($events, fn($a, $b) => strcmp($a['start'] ?? '', $b['start'] ?? ''));

// ── Persist cache ─────────────────────────────────────────────────────
$now = date('c');
$cacheAll['entries'][$cacheKey] = [
    'cached_at'    => $now,
    'events'       => $events,
    'subcalendars' => $subcalendars,
];
// GC: drop entries older than 24h to keep the file small
foreach ($cacheAll['entries'] as $k => $v) {
    if (time() - (int)strtotime($v['cached_at'] ?? '') > 86400) {
        unset($cacheAll['entries'][$k]);
    }
}
writeJson(PW_TEAMUP_CACHE_FILE, $cacheAll);

respondOk([
    'events'       => $events,
    'subcalendars' => $subcalendars,
    'from_cache'   => false,
    'cached_at'    => $now,
    'mode'         => $mode,
    'window'       => ['start' => $start, 'end' => $end],
]);


// ── Helpers ───────────────────────────────────────────────────────────

/** Fetch a URL, return [body, httpCode, curlError|null]. */
function pwTeamupFetch(string $url, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => array_merge([
            'User-Agent: SOM-Portal/PW-Teamup',
        ], $headers),
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        // Match sync.php: many internal deployments ship without a CA bundle
        // configured for cURL. Teamup is a fixed domain (not user-supplied)
        // and payload isn't sensitive, so verification is disabled.
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$body, $code, $err !== '' ? $err : null];
}

/** Normalize a Teamup JSON event (from 'share' or 'api' mode) → our shape. */
function pwTeamupNormalizeApi(array $ev, string $mode = 'api'): array {
    return [
        'id'             => (string)($ev['id'] ?? ''),
        'title'          => (string)($ev['title'] ?? '(untitled)'),
        'start'          => (string)($ev['start_dt'] ?? ''),
        'end'            => (string)($ev['end_dt']   ?? ''),
        'all_day'        => !empty($ev['all_day']),
        'location'       => (string)($ev['location'] ?? ''),
        'notes'          => pwTeamupHtmlToText((string)($ev['notes'] ?? '')),
        'who'            => (string)($ev['who']      ?? ''),
        'subcalendar_id' => isset($ev['subcalendar_id']) ? (string)$ev['subcalendar_id'] : '',
        'color'          => '', // derived client-side from subcalendar_id
        'custom'         => is_array($ev['custom'] ?? null) ? $ev['custom'] : new stdClass(),
        'source'         => 'teamup-' . $mode,
    ];
}

/** Teamup 'notes' is HTML — flatten to plain text so the popover reads clean. */
function pwTeamupHtmlToText(string $html): string {
    if ($html === '') return '';
    // Turn block/line breaks into newlines before stripping
    $s = preg_replace('#<br\s*/?>#i', "\n", $html);
    $s = preg_replace('#</(p|div|li|h[1-6])>#i', "\n", $s);
    $s = strip_tags($s);
    $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    // Collapse 3+ blank lines and trim
    $s = preg_replace("/\n{3,}/", "\n\n", $s);
    return trim($s);
}

/** Minimal iCalendar parser — extracts VEVENT blocks, filters by window. */
function pwTeamupParseIcs(string $ics, string $windowStart, string $windowEnd): array {
    // Unfold RFC5545 continuation lines (CRLF + space/tab)
    $unfolded = preg_replace("/\r?\n[ \t]/", '', $ics);
    $lines    = preg_split("/\r?\n/", $unfolded);

    $events   = [];
    $winFromTs = strtotime($windowStart . ' 00:00:00');
    $winToTs   = strtotime($windowEnd   . ' 23:59:59');

    $inEvent = false;
    $cur     = [];
    foreach ($lines as $raw) {
        $line = trim($raw);
        if ($line === '') continue;
        if ($line === 'BEGIN:VEVENT') { $inEvent = true; $cur = []; continue; }
        if ($line === 'END:VEVENT') {
            if ($inEvent) {
                $ev = pwTeamupIcsFinalize($cur);
                if ($ev && pwTeamupIcsInWindow($ev, $winFromTs, $winToTs)) {
                    $events[] = $ev;
                }
            }
            $inEvent = false;
            $cur     = [];
            continue;
        }
        if (!$inEvent) continue;

        // Split "NAME;PARAM=X:VALUE" — NAME/params are before first ':',
        // value is after. Params may contain ':' if quoted, but we ignore that.
        $colonPos = strpos($line, ':');
        if ($colonPos === false) continue;
        $left  = substr($line, 0, $colonPos);
        $value = substr($line, $colonPos + 1);
        $parts = explode(';', $left);
        $name  = strtoupper(array_shift($parts));

        $params = [];
        foreach ($parts as $p) {
            $eq = strpos($p, '=');
            if ($eq === false) continue;
            $params[strtoupper(substr($p, 0, $eq))] = substr($p, $eq + 1);
        }

        // Unescape common iCal escapes on TEXT values
        $unesc = fn($s) => str_replace(['\\N', '\\n', '\\,', '\\;', '\\\\'], ["\n", "\n", ',', ';', '\\'], $s);

        switch ($name) {
            case 'UID':         $cur['uid']         = $value; break;
            case 'SUMMARY':     $cur['summary']     = $unesc($value); break;
            case 'DESCRIPTION': $cur['description'] = $unesc($value); break;
            case 'LOCATION':    $cur['location']    = $unesc($value); break;
            case 'CATEGORIES':  $cur['categories']  = $unesc($value); break;
            case 'DTSTART':
                $cur['start'] = pwTeamupIcsParseDt($value, $params);
                break;
            case 'DTEND':
                $cur['end'] = pwTeamupIcsParseDt($value, $params);
                break;
        }
    }
    return $events;
}

/** Parse an iCal DTSTART/DTEND value into ['iso' => ..., 'all_day' => bool]. */
function pwTeamupIcsParseDt(string $value, array $params): array {
    $isDate = strtoupper($params['VALUE'] ?? '') === 'DATE'
           || preg_match('/^\d{8}$/', $value);

    if ($isDate) {
        // YYYYMMDD
        if (!preg_match('/^(\d{4})(\d{2})(\d{2})$/', $value, $m)) {
            return ['iso' => '', 'all_day' => true];
        }
        return [
            'iso'     => "{$m[1]}-{$m[2]}-{$m[3]}T00:00:00+07:00",
            'all_day' => true,
        ];
    }

    // Timed value: YYYYMMDDTHHMMSS[Z] with optional TZID param
    if (!preg_match('/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/', $value, $m)) {
        return ['iso' => '', 'all_day' => false];
    }
    $isUtc = $m[7] === 'Z';
    $tzId  = $params['TZID'] ?? null;
    $naive = "{$m[1]}-{$m[2]}-{$m[3]}T{$m[4]}:{$m[5]}:{$m[6]}";

    try {
        if ($isUtc) {
            $dt = new DateTime($naive, new DateTimeZone('UTC'));
        } elseif ($tzId) {
            $dt = new DateTime($naive, new DateTimeZone($tzId));
        } else {
            // Floating time — assume Asia/Bangkok, the SOM-Portal default.
            $dt = new DateTime($naive, new DateTimeZone('Asia/Bangkok'));
        }
        // Emit in Asia/Bangkok for client display consistency.
        $dt->setTimezone(new DateTimeZone('Asia/Bangkok'));
        return ['iso' => $dt->format('c'), 'all_day' => false];
    } catch (Exception $e) {
        return ['iso' => "{$m[1]}-{$m[2]}-{$m[3]}T{$m[4]}:{$m[5]}:{$m[6]}+07:00", 'all_day' => false];
    }
}

/** Fold accumulated iCal fields into a normalized event; null if missing DTSTART/SUMMARY. */
function pwTeamupIcsFinalize(array $cur): ?array {
    if (empty($cur['start']['iso']) || empty($cur['summary'])) return null;
    $startIso = $cur['start']['iso'];
    $endIso   = $cur['end']['iso']    ?? $startIso;
    $allDay   = !empty($cur['start']['all_day']);
    // Teamup writes CATEGORIES as the sub-calendar name — surface it as subcalendar_id
    // for coloring on the client.
    $sub = trim($cur['categories'] ?? '');
    return [
        'id'             => $cur['uid'] ?? md5($startIso . '|' . $cur['summary']),
        'title'          => $cur['summary'],
        'start'          => $startIso,
        'end'            => $endIso,
        'all_day'        => $allDay,
        'location'       => $cur['location']    ?? '',
        'notes'          => $cur['description'] ?? '',
        'subcalendar_id' => $sub,
        'color'          => '',
        'source'         => 'teamup-ics',
    ];
}

/** Return true if event overlaps [fromTs, toTs]. */
function pwTeamupIcsInWindow(array $ev, int $fromTs, int $toTs): bool {
    $s = strtotime($ev['start'] ?? '');
    $e = strtotime($ev['end']   ?? $ev['start'] ?? '');
    if (!$s) return false;
    if (!$e) $e = $s;
    return $e >= $fromTs && $s <= $toTs;
}
