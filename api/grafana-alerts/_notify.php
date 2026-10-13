<?php
/**
 * _notify.php — Google Chat card builder for the Grafana paused-alerts digest.
 *
 * The digest is delivered through the scheduled-noti system: a `grafana_paused`
 * schedule (admin/scheduled-noti.html) is fired by noti-scheduler.js at its time,
 * which calls api/scheduled-noti/send-grafana-paused.php → gaSendChatCard() here.
 *
 * gaSendChatCard() posts a summary card + a per-source breakdown thread reply to
 * a single Google Chat webhook. Callers loop it over multiple webhook rooms.
 */

/**
 * Build + post the digest to one webhook: a summary card, then (when anything is
 * paused) a per-source breakdown as a thread reply.
 *
 * @param string $webhookUrl Google Chat incoming webhook
 * @param array  $data       result of gaFetchPausedAlerts()
 * @param string $date       YYYY-MM-DD label / thread key (defaults to today ICT)
 * @return array{sent: bool, reason?: string, httpCode?: int, threadKey?: string}
 */
function gaSendChatCard(string $webhookUrl, array $data, string $date = ''): array {
    if ($date === '') {
        $date = (new DateTime('now', new DateTimeZone('Asia/Bangkok')))->format('Y-m-d');
    }
    $sources = $data['sources'] ?? [];
    $total   = (int)($data['total'] ?? 0);

    $anyError = false;
    foreach ($sources as $s) { if (!empty($s['error'])) { $anyError = true; break; } }

    // Status: clean when nothing paused, else neutral-info (paused is expected but
    // worth a daily eyeball). Errors bump it to warning.
    $statusText  = $anyError ? 'CHECK SOURCES'
                 : ($total === 0 ? 'ALL ACTIVE' : 'PAUSED ALERTS');
    $statusColor = $anyError ? '#d97706'
                 : ($total === 0 ? '#16a34a' : '#2563eb');
    $statusIcon  = $anyError ? 'warning'
                 : ($total === 0 ? 'check_circle' : 'pause_circle');

    $srcCount = count($sources);
    $totalLabel = $total === 0
        ? 'No alert rules paused'
        : ($total === 1 ? '1 alert rule paused' : "{$total} alert rules paused");

    // ── Main summary card ────────────────────────────────────────────────────
    $summaryWidgets = [[
        'decoratedText' => [
            'startIcon'   => ['materialIcon' => ['name' => $statusIcon]],
            'topLabel'    => 'Status',
            'text'        => "<font color=\"{$statusColor}\"><b>{$statusText}</b></font>",
            'bottomLabel' => "{$totalLabel} · {$srcCount} sources",
        ],
    ]];

    // One decoratedText per source: coloured count when paused, muted "0" when clean.
    foreach ($sources as $s) {
        $name  = (string)($s['name'] ?? '');
        $count = (int)($s['count'] ?? 0);
        $err   = $s['error'] ?? null;

        if ($err) {
            $valText = "<font color=\"#d97706\"><b>error</b></font>";
            $hint    = 'could not fetch — ' . mb_substr((string)$err, 0, 60);
        } else {
            $valText = $count > 0
                ? "<font color=\"#2563eb\"><b>{$count} paused</b></font>"
                : "<b>0</b>";
            $hint = $count > 0 ? 'tap the dashboard to review' : 'all rules active';
        }

        $summaryWidgets[] = ['decoratedText' => [
            'startIcon'   => ['materialIcon' => ['name' => 'dns']],
            'topLabel'    => $name,
            'text'        => $valText,
            'bottomLabel' => $hint,
        ]];
    }

    $webUrl = getenv('RESTART_MONITOR_WEB_URL')
        ? preg_replace('~/[^/]*$~', '/grafana-alerts.html', getenv('RESTART_MONITOR_WEB_URL'))
        : 'http://10.164.16.47/SOM-Portal/grafana-alerts.html';

    $mainCard = [
        'cardsV2' => [[
            'cardId' => "grafana-paused-{$date}",
            'card'   => [
                'header' => [
                    'title'    => 'Grafana Paused Alerts',
                    'subtitle' => $date,
                ],
                'sections' => [
                    ['header' => 'Summary', 'widgets' => $summaryWidgets],
                    ['widgets' => [[
                        'buttonList' => ['buttons' => [[
                            'text' => 'Open dashboard',
                            'onClick' => ['openLink' => ['url' => $webUrl]],
                        ]]],
                    ]]],
                ],
            ],
        ]],
    ];

    $threadKey = 'grafana-paused-' . $date;
    $main = gaPostToChat($webhookUrl, $mainCard, $threadKey);
    if (!($main['sent'] ?? false)) {
        return $main;
    }

    // ── Thread reply: per-source alert names (collapsible) ───────────────────
    $replySections = [];
    foreach ($sources as $s) {
        $alerts = $s['alerts'] ?? [];
        if (empty($alerts)) continue;
        $name  = (string)($s['name'] ?? '');
        $count = count($alerts);

        $widgets = [[
            'decoratedText' => [
                'startIcon'   => ['materialIcon' => ['name' => 'folder']],
                'text'        => '<b>' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '</b>',
                'bottomLabel' => "{$count} paused",
            ],
        ]];
        foreach ($alerts as $a) {
            $an = htmlspecialchars((string)($a['name'] ?? ''), ENT_QUOTES, 'UTF-8');
            $widgets[] = ['decoratedText' => [
                'startIcon' => ['materialIcon' => ['name' => 'pause_circle']],
                'text'      => $an,
            ]];
        }
        $section = ['widgets' => $widgets];
        if ($count > 1) {
            $section['collapsible']               = true;
            $section['uncollapsibleWidgetsCount'] = 1;
        }
        $replySections[] = $section;
    }

    if (!empty($replySections)) {
        $detailCard = [
            'cardsV2' => [[
                'cardId' => "grafana-paused-detail-{$date}",
                'card'   => [
                    'header' => [
                        'title'    => 'Paused alerts · breakdown',
                        'subtitle' => "{$total} rules across {$srcCount} sources",
                    ],
                    'sections' => $replySections,
                ],
            ]],
        ];
        gaPostToChat($webhookUrl, $detailCard, $threadKey);
    }

    return ['sent' => true, 'httpCode' => $main['httpCode'] ?? 200, 'threadKey' => $threadKey];
}

/** Post a cardsV2 payload to a Google Chat incoming webhook, scoped to a thread. */
function gaPostToChat(string $webhookUrl, array $payload, string $threadKey): array {
    $sep = (strpos($webhookUrl, '?') === false) ? '?' : '&';
    $threadedUrl = $webhookUrl
        . $sep . 'threadKey=' . urlencode($threadKey)
        . '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';

    $ch = curl_init($threadedUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json; charset=UTF-8'],
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err) {
        if (function_exists('logIntegrationError')) {
            logIntegrationError('grafana-alerts-webhook', $threadedUrl, $err, ['http_code' => $code]);
        }
        return ['sent' => false, 'reason' => "curl error: {$err}"];
    }
    if ($code < 200 || $code >= 300) {
        if (function_exists('logIntegrationError')) {
            logIntegrationError('grafana-alerts-webhook', $threadedUrl, "HTTP {$code}", [
                'http_code' => $code,
                'body'      => substr((string)$body, 0, 200),
            ]);
        }
        return ['sent' => false, 'reason' => "HTTP {$code}", 'body' => substr((string)$body, 0, 200)];
    }
    return ['sent' => true, 'httpCode' => $code];
}
