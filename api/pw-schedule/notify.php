<?php
/**
 * pw-schedule/notify.php
 *
 * Send one Google Chat message per PW (threaded), plus one reply per image
 * attachment inside that PW's thread.
 *
 *   POST { round: "YYYY-MM-DD", test?: bool, webhook_url?: string }
 *
 * Threading model — each PW gets its own thread keyed by `pw_<id>` via
 *   ?threadKey=<key>&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD
 * The first PW message also includes an opener (round header + summary) so
 * the chat room has context; follow-up PW messages are standalone threads.
 *
 * Webhook URL comes from data/pw_schedule_config.json unless overridden.
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);

$payload = requireAuth();
// Notify sends a Google Chat message AND stamps notified_at back into the
// SM-shared pw_schedule.json — write endpoint, SM-only.
requireSmForShared();
$body    = getBody();
$isTest  = !empty($body['test']);
$round   = trim($body['round'] ?? '');
if (!$round) respondError('round required', 400);

// ── Load round ─────────────────────────────────────────────────────────
$rounds = readJson('pw_schedule.json');
$data   = null;
foreach ($rounds as $r) {
    if (($r['round'] ?? '') === $round) { $data = $r; break; }
}
if (!$data) respondError('Round not found', 404);
$items = $data['items'] ?? [];
if (empty($items) && !$isTest) respondError('No PW items in this round', 400);

// Sort by start time
usort($items, fn($a, $b) => strcmp($a['start'] ?? '', $b['start'] ?? ''));

// ── Resolve webhook ────────────────────────────────────────────────────
$config = readJson('pw_schedule_config.json');
$webhook = $config['google_chat_webhook'] ?? '';
if ($isTest && !empty($body['webhook_url'])) {
    $webhook = trim($body['webhook_url']);
}
if (!$webhook) respondError('Google Chat webhook URL not configured', 400);

// ── Helpers ────────────────────────────────────────────────────────────
$fmtTime = function($iso) {
    $ts = strtotime($iso);
    return $ts ? date('H:i', $ts) : $iso;
};
$fmtRange = function($sIso, $eIso) use ($fmtTime) {
    $s = strtotime($sIso); $e = strtotime($eIso);
    if (!$s || !$e) return $sIso . ' - ' . $eIso;
    $sameDay = date('Y-m-d', $s) === date('Y-m-d', $e);
    return $sameDay
        ? date('d M', $s) . ' ' . $fmtTime($sIso) . ' - ' . $fmtTime($eIso)
        : date('d M H:i', $s) . ' → ' . date('d M H:i', $e);
};
$esc = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES | ENT_HTML5, 'UTF-8');

// Google Chat textParagraph supports a small subset of HTML including <a>.
// Escape, then turn http(s) URLs into clickable anchors. Newlines become <br>.
$linkify = function ($s) use ($esc) {
    $text = (string)$s;
    if ($text === '') return '';
    // Walk URLs in original text so href is the raw URL, not the escaped one.
    $urlRe = '/(https?:\/\/[^\s<>"\']+[^\s<>"\',.;:!?)\]}\'])/i';
    $out = '';
    $lastIdx = 0;
    if (preg_match_all($urlRe, $text, $matches, PREG_OFFSET_CAPTURE)) {
        foreach ($matches[0] as $m) {
            $url = $m[0];
            $offset = $m[1];
            $out .= nl2br($esc(substr($text, $lastIdx, $offset - $lastIdx)));
            // Truncate the visible label so long Confluence URLs don't dominate the card
            $label = mb_strlen($url) > 60 ? mb_substr($url, 0, 57) . '…' : $url;
            $out .= '<a href="' . $esc($url) . '">' . $esc($label) . '</a>';
            $lastIdx = $offset + strlen($url);
        }
    }
    $out .= nl2br($esc(substr($text, $lastIdx)));
    return $out;
};

$roundTs    = strtotime($round);
$nextTs     = $roundTs + 86400;
$roundTitle = date('d M Y', $roundTs) . ' → ' . date('d M Y', $nextTs);

$total    = count($items);
$internal = count(array_filter($items, fn($i) => ($i['type'] ?? '') === 'INTERNAL'));
$external = $total - $internal;

// ── HTTP helper ────────────────────────────────────────────────────────
$postCard = function(string $url, array $card) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($card, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json; charset=UTF-8'],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $resp    = curl_exec($ch);
    $code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);
    if ($curlErr || $code < 200 || $code >= 300) {
        logIntegrationError('google-chat-webhook', $url, $curlErr ?: "HTTP {$code}", [
            'http_code' => $code,
            'source'    => 'pw-schedule-notify',
        ]);
    }
    return [$resp, $code, $curlErr];
};

// threadKey must be <= 4000 chars and non-empty; pw ids are short, keep prefix
$threadUrl = function(string $base, string $threadKey) {
    $sep = (strpos($base, '?') === false) ? '?' : '&';
    return $base . $sep
        . 'threadKey=' . rawurlencode($threadKey)
        . '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';
};

// ── Build + send ───────────────────────────────────────────────────────
$sent = 0;

foreach ($items as $idx => $it) {
    $pwId     = $it['id'] ?? ('pw_' . $idx);
    $threadKey = ($isTest ? 'pwtest_' : 'pw_') . $round . '_' . $pwId;

    $name    = $it['pw_name'] ?? '';
    $type    = $it['type'] ?? 'INTERNAL';
    $range   = $fmtRange($it['start'] ?? '', $it['end'] ?? '');
    $task    = trim($it['task']   ?? '');
    $impact  = trim($it['impact'] ?? '');
    $owner   = trim($it['owner']  ?? '');
    $remark  = trim($it['remark'] ?? '');
    $ticket  = trim($it['ticket'] ?? '');
    $atts    = is_array($it['attachments'] ?? null) ? $it['attachments'] : [];

    // Header line (only for the very first message in the round — gives room context)
    $widgets = [];
    if ($idx === 0) {
        $headerText = '<b>PW Schedule · ' . $esc($roundTitle) . '</b><br>'
                    . '<font color="#6b7280">' . $total . ' tasks · Internal ' . $internal . ' · External ' . $external . '</font>';
        $widgets[] = [
            'decoratedText' => [
                'text'     => $headerText,
                'wrapText' => true,
            ]
        ];
        $widgets[] = ['divider' => (object)[]];
    }

    // Per-PW body
    $lines = [];
    $lines[] = '<b>' . $esc($name) . '</b>';
    $lines[] = '<font color="#6b6b6b">' . $esc($type) . ' · ' . $esc($range) . '</font>';
    if ($task)   $lines[] = '<font color="#374151">Task:</font> '   . $esc($task);
    if ($impact) $lines[] = '<font color="#374151">Impact:</font> ' . $esc($impact);
    if ($owner)  $lines[] = '<font color="#374151">Owner:</font> '  . $esc($owner);
    if ($ticket) $lines[] = '<font color="#374151">Ticket:</font> ' . $esc($ticket);
    if ($remark) $lines[] = '<font color="#6b7280"><i>' . $linkify($remark) . '</i></font>';

    $widgets[] = ['textParagraph' => ['text' => implode('<br>', $lines)]];

    // Links as buttons
    $buttons = [];
    $orange  = ['red' => 0.949, 'green' => 0.392, 'blue' => 0.098, 'alpha' => 1.0];
    $grey    = ['red' => 0.42,  'green' => 0.45,  'blue' => 0.50,  'alpha' => 1.0];
    if (!empty($it['mop']) && filter_var($it['mop'], FILTER_VALIDATE_URL)) {
        $buttons[] = ['text' => 'Open MOP', 'onClick' => ['openLink' => ['url' => $it['mop']]], 'color' => $orange];
    }
    if (!empty($it['meet']) && filter_var($it['meet'], FILTER_VALIDATE_URL)) {
        $buttons[] = ['text' => 'Join Meet', 'onClick' => ['openLink' => ['url' => $it['meet']]], 'color' => $grey];
    }
    if ($buttons) $widgets[] = ['buttonList' => ['buttons' => $buttons]];

    $card = [
        'cardsV2' => [[
            'cardId' => 'pw-' . $pwId . ($isTest ? '-t' : ''),
            'card'   => [
                'header' => [
                    'title'    => ($isTest ? '[TEST] ' : '') . ($type === 'INTERNAL' ? 'Internal PW' : 'External PW'),
                    'subtitle' => $range,
                ],
                'sections' => [[ 'widgets' => $widgets ]]
            ]
        ]]
    ];

    [$resp, $code, $err] = $postCard($threadUrl($webhook, $threadKey), $card);
    if ($err || $code !== 200) {
        $decoded = json_decode((string)$resp, true);
        $msg = $decoded['error']['message'] ?? $decoded['error']['status'] ?? substr((string)$resp, 0, 300);
        respondError("Google Chat returned HTTP {$code} for PW {$pwId}: {$msg}" . ($err ? " ({$err})" : ''), 502);
    }
    $sent++;

    // Replies inside this PW's thread — each attachment is its own message.
    // An attachment may be an image (url present) or a text-only note (url empty, caption only).
    foreach ($atts as $att) {
        $url = trim((string)($att['url'] ?? ''));
        $cap = trim((string)($att['caption'] ?? ''));
        if ($url === '' && $cap === '') continue;

        // Absolute URL normalization for relative links (uploads stored as /centralize-som/uploads/...)
        if ($url !== '' && strpos($url, '://') === false) {
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
            $url    = $scheme . '://' . $host . (strpos($url, '/') === 0 ? $url : '/' . $url);
        }

        $imgWidgets = [];
        if ($cap !== '') {
            // linkify already handles nl2br + escaping so any URL in the caption is clickable
            $imgWidgets[] = ['textParagraph' => ['text' => $linkify($cap)]];
        }
        if ($url !== '') {
            // Always send the image widget. Google Chat's fetcher decides whether
            // it can render the URL; if it can't, users still see the "Open image"
            // button below.
            $imgWidgets[] = ['image' => ['imageUrl' => $url, 'altText' => $cap !== '' ? $cap : 'PW attachment']];
            $imgWidgets[] = [
                'buttonList' => ['buttons' => [[
                    'text'    => 'Open image',
                    'onClick' => ['openLink' => ['url' => $url]],
                    'color'   => $grey,
                ]]]
            ];
        }

        $cardId = 'pw-att-' . $pwId . '-' . substr(md5($url . '|' . $cap), 0, 6);
        $imgCard = [
            'cardsV2' => [[
                'cardId' => $cardId,
                'card'   => [
                    'sections' => [[ 'widgets' => $imgWidgets ]]
                ]
            ]]
        ];

        [$r2, $c2, $e2] = $postCard($threadUrl($webhook, $threadKey), $imgCard);
        if ($e2 || $c2 !== 200) {
            // Non-fatal — log and keep going so one bad reply doesn't block the rest
            logActivity('pw_notify_reply_failed', [
                'round' => $round, 'pw_id' => $pwId,
                'code' => $c2, 'err' => $e2,
                'has_url' => $url !== '',
            ], $payload['sub'], $payload['name'] ?? '');
        } else {
            $sent++;
        }
    }
}

// ── Record + log ───────────────────────────────────────────────────────
if (!$isTest) {
    foreach ($rounds as &$r) {
        if (($r['round'] ?? '') === $round) {
            $r['last_notified_at'] = date('c');
            $r['last_notified_by'] = $payload['name'] ?? $payload['sub'];
            break;
        }
    }
    unset($r);
    writeJson('pw_schedule.json', $rounds);

    logActivity('pw_notify_sent', [
        'round'         => $round,
        'items'         => count($items),
        'messages_sent' => $sent,
    ], $payload['sub'], $payload['name'] ?? '');
} else {
    logActivity('pw_notify_test', [
        'round' => $round,
        'items' => count($items),
    ], $payload['sub'], $payload['name'] ?? '');
}

respondOk([
    'sent'          => true,
    'test'          => $isTest,
    'items'         => count($items),
    'messages_sent' => $sent,
]);
