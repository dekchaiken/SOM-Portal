<?php
/**
 * pw-schedule/template.php
 *
 * Build a "แจ้งเพื่อทราบ" chat template for a single PW item, filling in the
 * PW title, date/time (Thai locale), and — if the PW has an attached Jira
 * ticket — the MA list pulled from the ticket's description.
 *
 *   GET /template.php?item_id=<pw item id>
 *     → { message, pw: {id, name, start, end, ticket}, ticket: {key, url}?, ma_lines: [...] }
 *
 * The message is best-effort — the frontend puts it in an editable textarea
 * so the user can tweak before hitting Send. If the ticket lookup fails or
 * the MA list can't be extracted we still return a template with a
 * "[กรุณาระบุรายการ MA]" placeholder so the flow keeps working.
 */

require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('GET required', 405);

$payload = requireAuth();

$itemId = trim($_GET['item_id'] ?? '');
if ($itemId === '') respondError('item_id required', 400);

// ── Find the PW item across all rounds ───────────────────────
$rounds = readJson('pw_schedule.json');
$pw = null;
foreach ($rounds as $r) {
    foreach (($r['items'] ?? []) as $it) {
        if (($it['id'] ?? '') === $itemId) { $pw = $it; break 2; }
    }
}
if (!$pw) respondError('PW item not found', 404);

// ── Extract ticket reference (from `ticket` field or embedded in pw_name) ─
$ticketKey = trim((string)($pw['ticket'] ?? ''));
if ($ticketKey === '' && preg_match('/\b([A-Z]{2,8}-\d{3,7})\b/', (string)($pw['pw_name'] ?? ''), $m)) {
    $ticketKey = $m[1];
}
$ticketKey = strtoupper($ticketKey);
if ($ticketKey !== '' && !preg_match('/^[A-Z]+-\d+$/', $ticketKey)) $ticketKey = '';

// ── Strip ref token from name to get the "clean" title ───────
$cleanTitle = (string)($pw['pw_name'] ?? '');
if ($ticketKey !== '') {
    $cleanTitle = trim(preg_replace('/\b' . preg_quote($ticketKey, '/') . '\b[\s:_-]*/', '', $cleanTitle));
}
if ($cleanTitle === '') $cleanTitle = (string)($pw['pw_name'] ?? '');

// ── Thai date/time formatting ────────────────────────────────
$THAI_DAYS   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
$THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

$fmtThaiDateTime = function(string $startIso, string $endIso) use ($THAI_DAYS, $THAI_MONTHS) {
    $s = strtotime($startIso);
    $e = strtotime($endIso);
    if (!$s || !$e) return $startIso . ' - ' . $endIso;
    $dow   = $THAI_DAYS[(int)date('w', $s)] ?? '';
    $day   = (int)date('j', $s);
    $mon   = $THAI_MONTHS[(int)date('n', $s) - 1] ?? '';
    $yearB = (int)date('Y', $s) + 543;   // ปี พ.ศ.
    $tS    = date('H:i', $s);
    $tE    = date('H:i', $e);
    return "วัน{$dow}ที่ {$day} {$mon} {$yearB} | {$tS} - {$tE} น.";
};

$thaiDate = $fmtThaiDateTime($pw['start'] ?? '', $pw['end'] ?? '');

// ── Fetch Jira description and try to extract the MA list ────
$maLines   = [];
$ticketUrl = '';
$jiraNote  = null;   // set to 'no-creds' / 'fetch-failed' / 'no-ma-section' etc.

if ($ticketKey !== '' && jiraCredsReady()) {
    $ticketUrl = JIRA_BASE_URL . '/browse/' . $ticketKey;

    $ch = curl_init(
        JIRA_BASE_URL . '/rest/api/3/issue/' . rawurlencode($ticketKey)
        . '?fields=summary,description&expand=renderedFields'
    );
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => [jiraAuthHeader(), 'Accept: application/json'],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err || $code !== 200) {
        $jiraNote = 'fetch-failed';
    } else {
        $issue      = json_decode($body, true) ?: [];
        $descHtml   = $issue['renderedFields']['description'] ?? '';
        $descPlain  = $descHtml !== '' ? _pwHtmlToText($descHtml) : '';

        // Also fall back to ADF plain text if renderedFields is empty
        if ($descPlain === '') {
            $adf = $issue['fields']['description'] ?? null;
            if (is_array($adf)) $descPlain = _pwAdfToText($adf);
        }

        $maLines = _pwExtractMaLines($descPlain);
        if (empty($maLines)) $jiraNote = 'no-ma-section';
    }
} elseif ($ticketKey === '') {
    $jiraNote = 'no-ticket';
} else {
    $jiraNote = 'no-creds';
}

// ── Build the message ────────────────────────────────────────
$maBlock = !empty($maLines)
    ? implode("\n", array_map(fn($l) => $l, $maLines))
    : '[กรุณาระบุรายการ MA]';

$message  = "📢 แจ้งเพื่อทราบครับ ทีมจะทำการขึ้น MA Pages เพื่อ Support Planwork : {$cleanTitle}\n\n";
$message .= "🗓️ {$thaiDate}\n\n";
$message .= "🚨 รายการ MA:\n{$maBlock}\n\n";
$message .= "ขออภัยในความไม่สะดวกด้วยครับ";

respondOk([
    'message'   => $message,
    'pw'        => [
        'id'      => $pw['id'] ?? '',
        'name'    => $pw['pw_name'] ?? '',
        'start'   => $pw['start'] ?? '',
        'end'     => $pw['end'] ?? '',
        'ticket'  => $ticketKey,
    ],
    'ticket'    => $ticketKey ? ['key' => $ticketKey, 'url' => $ticketUrl] : null,
    'ma_lines'  => $maLines,
    'jira_note' => $jiraNote,
]);


// ══════════════════════════════════════════════════════════════
// Helpers (kept inline — only used by this endpoint)
// ══════════════════════════════════════════════════════════════

/** Strip HTML → plain text with newlines preserved around block tags. */
function _pwHtmlToText(string $html): string {
    // Convert <br> and closing block tags to newlines first
    $html = preg_replace('#<br\s*/?>#i', "\n", $html);
    $html = preg_replace('#</(p|div|li|tr|h[1-6])\s*>#i', "\n", $html);
    $html = preg_replace('#<li[^>]*>#i', "- ", $html);
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    // Collapse 3+ blank lines and trim each line
    $lines = array_map(fn($l) => rtrim($l), explode("\n", $text));
    return trim(implode("\n", $lines));
}

/** Walk an ADF (Atlassian Document Format) tree and concatenate all text
 *  nodes, inserting a newline after each paragraph-ish block. */
function _pwAdfToText($node): string {
    if (!is_array($node)) return '';
    $out = '';
    $type = $node['type'] ?? '';
    if ($type === 'text' && isset($node['text'])) {
        return (string)$node['text'];
    }
    foreach (($node['content'] ?? []) as $child) {
        $out .= _pwAdfToText($child);
        $ct = is_array($child) ? ($child['type'] ?? '') : '';
        if (in_array($ct, ['paragraph','listItem','heading','codeBlock','blockquote'], true)) {
            $out .= "\n";
        } elseif ($ct === 'bulletList' || $ct === 'orderedList') {
            $out .= "\n";
        }
    }
    return $out;
}

/** Best-effort MA-list extraction from a plain-text ticket description.
 *  Strategy:
 *    1. Look for a header line containing "MA" (e.g. "รายการ MA", "MA:",
 *       "MA Pages:", "MA Impacted:") and grab non-empty lines below it
 *       until a blank line or the next section header.
 *    2. Fall back to bullet lines "- xxx" anywhere in the description. */
function _pwExtractMaLines(string $desc): array {
    if ($desc === '') return [];
    $lines = preg_split('/\r?\n/', $desc);

    // Regex to detect a "MA section" header
    $headerRe = '/(?:^|\s)(รายการ\s*MA|MA\s*(?:Pages|list|Impacted|Services?)?)\s*[:：]?\s*$/iu';
    $sectionEnd = '/^(?:🚨|📢|🗓|##|===|---|\s*(?:Impact|Impacted|Note|Remark|Contact|Owner|MOP|Meet|Task|Ticket)\s*[:：])/iu';

    for ($i = 0; $i < count($lines); $i++) {
        $line = trim($lines[$i]);
        if ($line === '') continue;
        if (!preg_match($headerRe, $line)) continue;

        $collected = [];
        for ($j = $i + 1; $j < count($lines); $j++) {
            $next = trim($lines[$j]);
            if ($next === '' && !empty($collected)) break;      // blank line ends section (after we have something)
            if ($next === '') continue;                          // skip leading blanks
            if (preg_match($sectionEnd, $next)) break;
            // Normalize bullets — Google Chat shows plain lines fine, so drop leading "- ", "•", "*"
            $next = preg_replace('/^\s*(?:[-•*]|[0-9]+[.)])\s+/u', '', $next);
            $collected[] = $next;
            if (count($collected) >= 15) break;                  // safety cap
        }
        if (!empty($collected)) return $collected;
    }

    // Fallback: harvest any bullet lines from the description
    $bullets = [];
    foreach ($lines as $l) {
        $l = trim($l);
        if (preg_match('/^\s*(?:[-•*]|[0-9]+[.)])\s+(.+)$/u', $l, $m)) {
            $bullets[] = $m[1];
        }
        if (count($bullets) >= 15) break;
    }
    return $bullets;
}
