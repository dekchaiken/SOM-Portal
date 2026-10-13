<?php
/**
 * _notify.php — Send notifications (Google Chat + SMTP email)
 *  after a successful restart-monitor JSON upload.
 *
 * Called from upload.php. Both channels are best-effort:
 *  - failures are logged but never block the upload response
 *  - if either is not configured (.env / mail_config.json), the channel
 *    is silently skipped with a reason
 *
 * Per-runway webhook URLs: each runway in data/grafana-runways.json declares
 * `chatWebhookEnv` (e.g., RESTART_MONITOR_CHAT_WEBHOOK_EKS_TMN) so TMN/NANO/OCP
 * post to different chat spaces. Falls back to RESTART_MONITOR_CHAT_WEBHOOK.
 *
 * .env keys used:
 *   RESTART_MONITOR_CHAT_WEBHOOK_EKS_TMN   Per-runway Google Chat webhook URL
 *   RESTART_MONITOR_CHAT_WEBHOOK_EKS_NANO  Per-runway Google Chat webhook URL
 *   RESTART_MONITOR_CHAT_WEBHOOK           (legacy fallback)
 *   RESTART_MONITOR_EMAIL_TO               Comma-separated recipient list
 *   RESTART_MONITOR_WEB_URL                Dashboard link shown in card / email
 */

// Check whether admin has disabled notifications for this runway.
// Managed via admin/scheduled-noti.html → writes into
// data/restart-monitor-webhooks.json under "enabled": { slug: bool }.
// The map is keyed by the runway's OFFICIAL slug from grafana-runways.json
// (e.g. "EKS-TMN"), not the lowercase idempotency slug used elsewhere here.
// Missing entry defaults to true so runways added later still fire.
function _isRunwayNotifyEnabled(string $runwayName): bool {
    if ($runwayName === '') return true;
    $runways = readJson('grafana-runways.json');
    $officialSlug = '';
    foreach ($runways['runways'] ?? [] as $rw) {
        if (($rw['name'] ?? '') === $runwayName) { $officialSlug = $rw['slug'] ?? ''; break; }
    }
    if ($officialSlug === '') return true;
    $store = readJson('restart-monitor-webhooks.json');
    $map = $store['enabled'] ?? [];
    if (!is_array($map) || !array_key_exists($officialSlug, $map)) return true;
    return (bool)$map[$officialSlug];
}

// Resolve runway-specific webhook URL.
// Lookup order (first non-empty wins):
//   1. data/restart-monitor-webhooks.json[slug]   ← admin UI override
//   2. .env[chatWebhookEnv from grafana-runways.json]
//   3. .env[RESTART_MONITOR_CHAT_WEBHOOK]         ← legacy fallback
function _resolveRunwayWebhook(string $runwayName): string {
    $runways = readJson('grafana-runways.json');

    $matched = null;
    foreach ($runways['runways'] ?? [] as $rw) {
        if (($rw['name'] ?? '') === $runwayName) { $matched = $rw; break; }
    }

    // 1. JSON override (keyed by slug)
    if ($matched && !empty($matched['slug'])) {
        $store = readJson('restart-monitor-webhooks.json');
        $url = trim($store['webhooks'][$matched['slug']] ?? '');
        if ($url !== '') return $url;
    }

    // 2. Per-runway env var
    if ($matched && !empty($matched['chatWebhookEnv'])) {
        $url = getenv($matched['chatWebhookEnv']);
        if ($url) return $url;
    }

    // 3. Legacy fallback
    return getenv('RESTART_MONITOR_CHAT_WEBHOOK') ?: '';
}

function sendRestartMonitorNotifications(array $report): array {
    $result = [
        'chat'  => ['sent' => false, 'reason' => 'init'],
        'email' => ['sent' => false, 'reason' => 'init'],
    ];

    $date        = $report['date']    ?? date('Y-m-d');
    $runwayName  = $report['runway']  ?? 'EKS TMN';
    // Idempotency includes runway so TMN+NANO of the same day don't collide
    $contentHash = substr(hash('sha256', json_encode($report)), 0, 12);
    $runwaySlug  = preg_replace('/\W+/', '-', strtolower($runwayName));
    $historyKey  = $date . '_' . $runwaySlug . '_' . $contentHash;

    $historyFile = teamDataPath('grafana-monitoring/notify-history.json');
    $history     = file_exists($historyFile)
        ? (json_decode(file_get_contents($historyFile), true) ?? [])
        : [];

    if (in_array($historyKey, $history, true)) {
        $skipMsg = "already notified for {$date} {$runwayName} (same content hash)";
        return [
            'chat'  => ['sent' => false, 'reason' => $skipMsg, 'idempotencyKey' => $historyKey],
            'email' => ['sent' => false, 'reason' => $skipMsg, 'idempotencyKey' => $historyKey],
        ];
    }

    // Admin kill-switch — silence a whole runway from admin/scheduled-noti.html.
    // Do NOT record into notify-history so re-enabling later still fires.
    if (!_isRunwayNotifyEnabled($runwayName)) {
        $reason = "disabled by admin for runway '{$runwayName}' (admin/scheduled-noti.html)";
        return [
            'chat'  => ['sent' => false, 'reason' => $reason],
            'email' => ['sent' => false, 'reason' => $reason],
        ];
    }

    // 1. Google Chat ────────────────────────────────────────────────────
    $webhookUrl = _resolveRunwayWebhook($runwayName);
    if ($webhookUrl) {
        $result['chat'] = sendChatCard($webhookUrl, $report);
    } else {
        $result['chat'] = ['sent' => false, 'reason' => "no Chat webhook for runway '{$runwayName}' (set RESTART_MONITOR_CHAT_WEBHOOK_<RUNWAY> in .env)"];
    }

    // 2. SMTP Email ──────────────────────────────────────────────────────
    $cfg = readJson('mail_config.json');
    if (!empty($cfg['smtp_host']) && !empty($cfg['from_email'])) {
        $recipients = getenv('RESTART_MONITOR_EMAIL_TO') ?: 'warapon.lea@ascendcorp.com';
        $result['email'] = sendEmailNotification($cfg, $recipients, $report);
    } else {
        $result['email'] = ['sent' => false, 'reason' => 'SMTP not configured (mail_config.json)'];
    }

    // Record in history if at least one channel succeeded
    $anySent = ($result['chat']['sent'] ?? false) || ($result['email']['sent'] ?? false);
    if ($anySent) {
        $history[] = $historyKey;
        // Keep last 200 entries (sliding window)
        if (count($history) > 200) {
            $history = array_slice($history, -200);
        }
        @file_put_contents($historyFile, json_encode($history, JSON_PRETTY_PRINT));
    }

    logActivity('restart_monitor_notify', [
        'date'      => $date,
        'runway'    => $runwayName,
        'chatSent'  => $result['chat']['sent']  ?? false,
        'emailSent' => $result['email']['sent'] ?? false,
    ]);

    return $result;
}

// ─── Google Chat Card v2 ─────────────────────────────────────────────────

function sendChatCard(string $webhookUrl, array $report): array {
    $sev        = $report['severitySummary'] ?? [];
    $reason     = $report['reasonSummary']   ?? [];
    $pods       = $report['pods']            ?? [];
    $date       = $report['date']            ?? date('Y-m-d');
    $runwayName = $report['runway']          ?? 'EKS TMN';
    $cluster    = $report['cluster']         ?? '';
    $total      = $report['totalRestarts']   ?? count($pods);
    $crit       = (int)($sev['critical']  ?? 0);
    $warn       = (int)($sev['warning']   ?? 0);
    $info       = (int)($sev['info']      ?? 0);
    $oom        = (int)($reason['OOMKilled'] ?? 0);
    $err        = (int)($reason['Error']     ?? 0);
    $done       = (int)($reason['Completed'] ?? 0);

    // Per-runway thread + card id so TMN/NANO don't collapse into one thread
    $runwaySlug = preg_replace('/\W+/', '-', strtolower($runwayName));
    $threadKey  = 'restart-' . $runwaySlug . '-' . $date;

    // Status mapping
    $statusText  = $crit > 0 ? 'CRITICAL'
                 : ($warn > 0 ? 'WARNING' : 'HEALTHY');
    $statusColor = $crit > 0 ? '#dc2626'
                 : ($warn > 0 ? '#d97706' : '#16a34a');
    $statusIcon  = $crit > 0 ? 'dangerous'
                 : ($warn > 0 ? 'warning' : 'check_circle');

    $podCount    = count($pods);
    $totalLabel  = $total === 0
        ? 'No restarts in window'
        : ($total === 1 ? '1 restart' : "{$total} restarts");
    $podLabel    = $podCount === 0 ? '0 pods affected' : "{$podCount} pod(s) affected";

    // Helper: decoratedText row (icon + topLabel + bold value + optional hint)
    $row = function (string $icon, string $label, string $value, string $color = '', string $hint = '') {
        $text = $color ? "<font color=\"{$color}\"><b>{$value}</b></font>" : "<b>{$value}</b>";
        $widget = [
            'startIcon' => ['materialIcon' => ['name' => $icon]],
            'topLabel'  => $label,
            'text'      => $text,
        ];
        if ($hint !== '') $widget['bottomLabel'] = $hint;
        return ['decoratedText' => $widget];
    };

    // Helper: inline bold counter — color it when non-zero
    $mark = function (int $n, string $color = '') {
        return ($color !== '' && $n > 0)
            ? "<font color=\"{$color}\"><b>{$n}</b></font>"
            : "<b>{$n}</b>";
    };

    // Status section widgets — drop Severity + Reasons rows when nothing happened
    $statusWidgets = [
        $row($statusIcon, 'Health', $statusText, $statusColor, "{$totalLabel} · {$podLabel}"),
    ];
    if ($total > 0) {
        $sevText = $mark($crit, '#dc2626') . ' critical · '
                 . $mark($warn, '#d97706') . ' warning · '
                 . $mark($info)            . ' info';
        $reasonsText = $mark($oom, '#9333ea') . ' OOMKilled · '
                     . $mark($err, '#dc2626') . ' Error · '
                     . $mark($done)           . ' Completed';
        $statusWidgets[] = ['decoratedText' => [
            'startIcon' => ['materialIcon' => ['name' => 'category']],
            'topLabel'  => 'Severity',
            'text'      => $sevText,
        ]];
        $statusWidgets[] = ['decoratedText' => [
            'startIcon' => ['materialIcon' => ['name' => 'troubleshoot']],
            'topLabel'  => 'Reasons',
            'text'      => $reasonsText,
        ]];
    }

    $mainCard = [
        'cardsV2' => [[
            'cardId' => "restart-{$runwaySlug}-{$date}",
            'card'   => [
                'header' => [
                    'title'    => "{$runwayName} Restart Monitor",
                    'subtitle' => $date,
                ],
                'sections' => [
                    [
                        'header'  => 'Information',
                        'widgets' => [
                            $row('dns',      'Cluster',    $cluster),
                            $row('schedule', 'Scan range', formatScanWindow($report)),
                        ],
                    ],
                    [
                        'header'  => 'Status',
                        'widgets' => $statusWidgets,
                    ],
                ],
            ],
        ]],
    ];

    // ── Send main card (creates new thread) ──────────────────────────────
    $main = postToChatThread($webhookUrl, $mainCard, $threadKey);
    if (!$main['sent']) {
        return $main;
    }

    // ── Send service-grouped breakdown as thread reply (Card v2) ─────────
    // Same structure as the main card: one section per service, decoratedText
    // widgets per pod showing the actual restart timestamp instead of "X ago".
    $threadReplies = [];
    if (!empty($pods)) {
        $services      = groupPodsByService($pods, $report['hpaEvents'] ?? []);
        $detailPayload = buildDetailCard($report, $services);
        $reply         = postToChatThread($webhookUrl, $detailPayload, $threadKey);
        $threadReplies[] = $reply;
    }

    return [
        'sent'          => true,
        'httpCode'      => $main['httpCode'] ?? 200,
        'threadKey'     => $threadKey,
        'mainCardSent'  => true,
        'threadReplies' => count($threadReplies),
        'replyResults'  => $threadReplies,
    ];
}

/**
 * Format a unix timestamp as "26 มิ.ย. 05:59 น." in Asia/Bangkok.
 * Returns "—" when the timestamp is missing/zero.
 */
function formatRestartTime($unix): string {
    if (empty($unix) || !is_numeric($unix)) return '—';
    $tz = new DateTimeZone('Asia/Bangkok');
    $dt = (new DateTime('@' . (int)$unix))->setTimezone($tz);
    $thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    $day   = (int)$dt->format('j');
    $month = $thMonths[(int)$dt->format('n') - 1];
    $time  = $dt->format('H:i');
    return "{$day} {$month} {$time} น.";
}

/**
 * Compact age string. Under 30 minutes = signal for "young pod" (startup-failure candidate).
 */
function formatAge($seconds): string {
    if (!is_numeric($seconds) || $seconds < 0) return '?';
    $s = (int)$seconds;
    if ($s < 60)    return $s . 's';
    if ($s < 3600)  return floor($s / 60) . 'm';
    if ($s < 86400) return round($s / 3600, 1) . 'h';
    return round($s / 86400, 1) . 'd';
}

/**
 * Format the scan window as a Thai-style range: "25 มิ.ย. 09:00 — 26 มิ.ย. 09:00 น."
 * Falls back to a generic label if scanRangeStart/End are missing.
 */
function formatScanWindow(array $report): string {
    $startIso = $report['scanRangeStart'] ?? '';
    $endIso   = $report['scanRangeEnd']   ?? '';
    if (!$startIso || !$endIso) {
        return 'รอบ 24 ชั่วโมงล่าสุด';
    }
    try {
        $tz    = new DateTimeZone('Asia/Bangkok');
        $start = (new DateTime($startIso))->setTimezone($tz);
        $end   = (new DateTime($endIso))->setTimezone($tz);
    } catch (Throwable $e) {
        return 'รอบ 24 ชั่วโมงล่าสุด';
    }

    $thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    $fmt = function (DateTime $dt) use ($thMonths) {
        $day = (int)$dt->format('j');
        $mon = $thMonths[(int)$dt->format('n') - 1];
        return "{$day} {$mon} " . $dt->format('H:i');
    };
    return $fmt($start) . ' — ' . $fmt($end) . ' น.';
}

/**
 * Build the cardsV2 payload for the thread reply (per-service breakdown).
 * Matches the visual style of the main card so the thread looks cohesive.
 */
function buildDetailCard(array $report, array $services): array {
    $runwayName = $report['runway'] ?? 'EKS TMN';
    $date       = $report['date']   ?? date('Y-m-d');
    $total      = (int)($report['totalRestarts'] ?? 0);
    $podCount   = (int)array_sum(array_map(fn($s) => $s['podCount'] ?? 0, $services));
    $svcCount   = count($services);
    $runwaySlug = preg_replace('/\W+/', '-', strtolower($runwayName));

    $sections = [];
    foreach ($services as $svc) {
        $sections[] = buildServiceSection($svc);
    }

    return [
        'cardsV2' => [[
            'cardId' => "restart-detail-{$runwaySlug}-{$date}",
            'card'   => [
                'header' => [
                    'title'    => "{$runwayName} · Service breakdown",
                    'subtitle' => "{$podCount} pods · {$svcCount} services · {$total} restarts",
                ],
                'sections' => $sections,
            ],
        ]],
    ];
}

/**
 * Build a single section: service summary + one decoratedText per pod.
 * Sections with > 5 pods auto-collapse to keep the card tidy.
 */
function buildServiceSection(array $svc): array {
    $ns         = str_replace(['truemoney-', '-production'], '', $svc['namespace'] ?? '');
    $reasonsStr = implode(', ', $svc['reasons'] ?? []);
    $sev        = $svc['maxSev'] ?? 'info';
    $svcName    = $svc['service'] ?? '';
    $restartSum = (int)($svc['restartSum'] ?? 0);
    $hpa        = $svc['hpa'] ?? null;
    $hpaActive  = !empty($hpa) && (int)($hpa['scaleEvents24h'] ?? 0) > 0;

    $sevColor = $sev === 'critical' ? '#dc2626'
              : ($sev === 'warning' ? '#d97706' : '');
    $sevLabel = strtoupper($sev);

    $widgets = [];
    $hpaWidgetCount = 0;   // tracks how many HPA widgets we added (for uncollapsibleWidgetsCount)

    // ── HPA badge (first widget so it stays visible when section collapses) ──
    if ($hpaActive) {
        $widgets[] = ['decoratedText' => [
            'startIcon'   => ['materialIcon' => ['name' => 'trending_up']],
            'text'        => '<font color="#0891b2"><b>🔄 HPA scaled ' . (int)$hpa['scaleEvents24h'] . '× today</b></font>',
            'bottomLabel' => 'current replicas: ' . (int)($hpa['currentReplicas'] ?? 0),
        ]];
        $hpaWidgetCount++;

        // Timeline: "HH:MM ↑ (X→Y) · HH:MM ↓ (Y→X) · +N more"
        // Only rendered when fetch.php captured per-transition detail via the
        // range-query pass (older reports don't have this field yet).
        $timeline = $hpa['scaleTimeline'] ?? [];
        if (is_array($timeline) && $timeline) {
            $shown = array_slice($timeline, 0, 6);
            $parts = [];
            foreach ($shown as $ev) {
                $arrow = ($ev['to'] ?? 0) > ($ev['from'] ?? 0) ? '↑' : '↓';
                $parts[] = ($ev['time'] ?? '') . ' ' . $arrow . ' (' . (int)($ev['from'] ?? 0) . '→' . (int)($ev['to'] ?? 0) . ')';
            }
            $text = implode(' · ', $parts);
            if (count($timeline) > 6) $text .= ' · +' . (count($timeline) - 6) . ' more';
            $widgets[] = ['decoratedText' => [
                'startIcon' => ['materialIcon' => ['name' => 'schedule']],
                'text'      => '<font color="#0e7490">' . $text . '</font>',
            ]];
            $hpaWidgetCount++;
        }
    }

    // ── Service header (name + severity badge + meta) ─────────────────────
    $titleHtml = '<b>' . htmlspecialchars($svcName, ENT_QUOTES, 'UTF-8') . '</b>';
    if ($sev !== 'info' && $sevColor) {
        $titleHtml .= " · <font color=\"{$sevColor}\"><b>{$sevLabel}</b></font>";
    }
    $widgets[] = ['decoratedText' => [
        'startIcon'   => ['materialIcon' => ['name' => 'hub']],
        'text'        => $titleHtml,
        'bottomLabel' => "{$ns} · {$reasonsStr} · {$restartSum} restarts",
    ]];

    // ── Per-pod line — includes age badge (young pods highlighted) ────────
    $sortedPods = $svc['pods'] ?? [];
    usort($sortedPods, fn($a, $b) => ($b['restartedAtUnix'] ?? 0) - ($a['restartedAtUnix'] ?? 0));

    foreach ($sortedPods as $p) {
        $suffix = '?';
        if (preg_match('/-([a-z0-9]{5})$/', $p['pod'] ?? '', $m)) $suffix = $m[1];

        $rc     = (int)($p['restartCount'] ?? 0);
        $memPct = isset($p['memoryUsageRatio']) ? round($p['memoryUsageRatio'] * 100) . '%' : '—';
        $cpuPct = isset($p['cpuUsageRatio'])    ? round($p['cpuUsageRatio']    * 100) . '%' : '—';
        $when   = formatRestartTime($p['restartedAtUnix'] ?? null);

        $ageStr = '';
        if (isset($p['podAgeSeconds']) && is_numeric($p['podAgeSeconds'])) {
            $age = formatAge($p['podAgeSeconds']);
            $ageStr = ($p['podAgeSeconds'] < 1800)
                ? " · <font color=\"#0891b2\">🆕 age {$age}</font>"
                : " · age {$age}";
        }

        $line = "<b>{$suffix}</b>{$ageStr} · {$when} · mem {$memPct} · cpu {$cpuPct}";
        if ($rc > 1) $line .= " · <b>{$rc}× restarts</b>";

        $widgets[] = ['decoratedText' => [
            'startIcon' => ['materialIcon' => ['name' => 'schedule']],
            'text'      => $line,
        ]];
    }

    // ── Pattern label + optional hint (structured, always shown when known) ──
    if (!empty($svc['pattern'])) {
        $p = $svc['pattern'];
        $icon = $p['icon'] ?? '';
        $widgets[] = ['decoratedText' => [
            'startIcon' => ['materialIcon' => ['name' => 'psychology']],
            'text'      => '<i>' . htmlspecialchars(trim($icon . ' Pattern: ' . ($p['label'] ?? '')), ENT_QUOTES, 'UTF-8') . '</i>',
        ]];
        if (!empty($p['hint'])) {
            $widgets[] = ['decoratedText' => [
                'startIcon' => ['materialIcon' => ['name' => 'lightbulb']],
                'text'      => '<i>→ ' . htmlspecialchars($p['hint'], ENT_QUOTES, 'UTF-8') . '</i>',
            ]];
        }
    }

    $section = ['widgets' => $widgets];

    // Collapse pods — keep HPA badge (+ optional timeline) + service header always visible.
    // 1 (service header) + $hpaWidgetCount (badge + optional timeline) stays uncollapsed.
    if (count($sortedPods) >= 1) {
        $section['collapsible']               = true;
        $section['uncollapsibleWidgetsCount'] = 1 + $hpaWidgetCount;
    }

    return $section;
}

/**
 * Group pods by deployment/service name (stripping ReplicaSet hash + pod suffix).
 * Computes severity, restart sum, reasons, and a "pattern" hint (deploy / scattered / cronjob / frequent).
 *
 * Pod naming pattern: <service>-<8-12 hex chars>-<5 alphanum>
 * e.g. pp-tag30-data-service-c486c67bb-6zdsl → service = pp-tag30-data-service
 */
function groupPodsByService(array $pods, array $hpaEvents = []): array {
    $groups = [];
    foreach ($pods as $p) {
        $podName = $p['pod'] ?? '?';
        $svc = $podName;
        if (preg_match('/^(.+?)-[a-f0-9]{8,12}-[a-z0-9]{5}$/', $podName, $m)) {
            $svc = $m[1];
        }
        if (!isset($groups[$svc])) {
            $groups[$svc] = [
                'service'   => $svc,
                'namespace' => $p['namespace'] ?? '',
                'pods'      => [],
            ];
        }
        $groups[$svc]['pods'][] = $p;
    }

    // Compute aggregates
    $sevRank = ['critical' => 0, 'warning' => 1, 'info' => 2];
    $arr = [];
    foreach ($groups as $g) {
        $restartSum = 0;
        $reasons    = [];
        $maxSev     = 'info';
        $maxSevRank = 9;
        $times      = [];
        $maxRestart = 0;
        $minAge     = PHP_INT_MAX;
        foreach ($g['pods'] as $p) {
            $restartSum += (int)($p['restartCount'] ?? 0);
            $maxRestart  = max($maxRestart, (int)($p['restartCount'] ?? 0));
            $why         = $p['terminationReason'] ?? null;
            if ($why && !in_array($why, $reasons, true)) $reasons[] = $why;
            $sev = $p['severity'] ?? 'info';
            $r   = $sevRank[$sev] ?? 9;
            if ($r < $maxSevRank) { $maxSevRank = $r; $maxSev = $sev; }
            if (isset($p['restartedAtUnix']) && is_numeric($p['restartedAtUnix'])) {
                $times[] = (int)$p['restartedAtUnix'];
            }
            if (isset($p['podAgeSeconds']) && is_numeric($p['podAgeSeconds'])) {
                $minAge = min($minAge, (int)$p['podAgeSeconds']);
            }
        }

        // Pattern classifier — uses podAge + restart count + reason.
        // Priority: startup-failure (young + repeated exit) → mid-life loop (old
        // + repeated exit) → cronjob (old + few exits) → catch-all. For non-Completed
        // reasons, fall back to spread-based inference. This replaces the old
        // "Completed only → CronJob" heuristic which mis-labeled every young pod
        // that struggled to boot due to a downstream dependency issue.
        $ageIsKnown    = ($minAge !== PHP_INT_MAX);
        $completedOnly = (count($reasons) === 1 && $reasons[0] === 'Completed');
        $spread        = (count($times) >= 2) ? (max($times) - min($times)) : 0;

        $pattern = null;
        if ($completedOnly) {
            if ($ageIsKnown && $minAge < 1800 && $maxRestart >= 3) {
                $pattern = [
                    'kind'  => 'startup-failure',
                    'icon'  => '🆕',
                    'label' => 'Startup failure — pod ใหม่ boot ไม่ผ่าน (age < 30m, restart ≥3×)',
                    'hint'  => 'เช็ค startup dependency (downstream API, DB, CircuitBreaker) และ readiness probe',
                ];
            } elseif ($ageIsKnown && $minAge >= 1800 && $maxRestart >= 3) {
                $pattern = [
                    'kind'  => 'midlife-loop',
                    'icon'  => '⚠️',
                    'label' => 'Mid-life exit loop — pod เก่า restart ถี่ผิดปกติ (age ≥30m, restart ≥3×)',
                    'hint'  => 'pod ที่รันอยู่แล้วเริ่ม exit ถี่ — เช็ค downstream dependency / liveness probe / config change ล่าสุด',
                ];
            } elseif ($ageIsKnown && $minAge >= 21600 && $maxRestart <= 2) {
                $pattern = ['kind' => 'cronjob', 'icon' => '⏰', 'label' => 'CronJob ทำงานปกติ — ไม่ใช่ปัญหา', 'hint' => ''];
            } else {
                $pattern = ['kind' => 'completed-generic', 'icon' => '❓', 'label' => 'Completed pattern — เช็ค application log', 'hint' => ''];
            }
        } else {
            // Non-Completed (Error / OOMKilled / signal). Prefer spread-based
            // classification when we have multiple pods; otherwise attach a
            // reason-specific hint so the card is still actionable.
            $reasonHint = '';
            if (in_array('OOMKilled', $reasons, true))    $reasonHint = 'มี OOMKilled → เพิ่ม memory limit หรือหา memory leak';
            elseif (in_array('Error', $reasons, true))    $reasonHint = 'มี Error → เช็ค application log + recent deploys';

            if ($spread > 0 && $spread <= 60) {
                $pattern = ['kind' => 'deploy', 'icon' => '🚀', 'label' => "น่าจะเป็น rolling deploy (restart พร้อมกันใน {$spread}s)", 'hint' => $reasonHint];
            } elseif ($spread > 60 && $spread <= 300) {
                $pattern = ['kind' => 'deploy', 'icon' => '🚀', 'label' => 'น่าจะเป็น rolling deploy (ภายใน ' . round($spread / 60) . ' นาที)', 'hint' => $reasonHint];
            } elseif ($spread >= 3600) {
                $pattern = ['kind' => 'scattered', 'icon' => '⏳', 'label' => 'scattered (ห่างกัน ' . round($spread / 3600, 1) . 'h — น่าจะ memory leak หรือ app bug)', 'hint' => $reasonHint];
            } elseif ($reasonHint) {
                $icon = in_array('OOMKilled', $reasons, true) ? '💥' : '⛔';
                $label = in_array('OOMKilled', $reasons, true) ? 'OOMKilled pattern' : 'Error pattern';
                $pattern = ['kind' => 'reason-hint', 'icon' => $icon, 'label' => $label, 'hint' => $reasonHint];
            }
        }

        $arr[] = array_merge($g, [
            'restartSum' => $restartSum,
            'reasons'    => $reasons,
            'maxSev'     => $maxSev,
            'pattern'    => $pattern,
            'podCount'   => count($g['pods']),
            'minPodAge'  => ($minAge === PHP_INT_MAX ? null : $minAge),
            'hpa'        => $hpaEvents[$g['service']] ?? null,
        ]);
    }

    // Sort: critical first → highest restart sum
    usort($arr, function ($a, $b) use ($sevRank) {
        $sa = $sevRank[$a['maxSev']] ?? 9;
        $sb = $sevRank[$b['maxSev']] ?? 9;
        if ($sa !== $sb) return $sa - $sb;
        return $b['restartSum'] - $a['restartSum'];
    });

    return $arr;
}

/**
 * Post a message to Google Chat using the incoming webhook,
 * scoped to a thread (so multiple posts collapse into a thread).
 */
function postToChatThread(string $webhookUrl, array $payload, string $threadKey): array {
    // Add thread params to webhook URL — won't disturb existing key/token
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
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err) {
        logIntegrationError('restart-monitor-webhook', $threadedUrl, $err, ['http_code' => $code]);
        return ['sent' => false, 'reason' => "curl error: {$err}"];
    }
    if ($code < 200 || $code >= 300) {
        logIntegrationError('restart-monitor-webhook', $threadedUrl, "HTTP {$code}", [
            'http_code' => $code,
            'body'      => substr((string)$body, 0, 200),
        ]);
        return ['sent' => false, 'reason' => "HTTP {$code}", 'body' => substr((string)$body, 0, 200)];
    }
    return ['sent' => true, 'httpCode' => $code];
}

// ─── SMTP email (using centralize-som mail_config.json) ──────────────────

function sendEmailNotification(array $cfg, string $toCsv, array $report): array {
    $toList = array_values(array_filter(
        array_map('trim', explode(',', $toCsv)),
        fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
    ));
    if (!$toList) return ['sent' => false, 'reason' => 'no valid email recipient'];

    $date       = $report['date']          ?? date('Y-m-d');
    $runwayName = $report['runway']        ?? 'EKS TMN';
    $total      = $report['totalRestarts'] ?? 0;
    $sev        = $report['severitySummary'] ?? [];
    $reason     = $report['reasonSummary']   ?? [];
    $crit       = (int)($sev['critical'] ?? 0);

    $subjectIcon = $crit > 0 ? '🚨' : ($total > 0 ? '⚠️' : '✅');
    $subject = "{$subjectIcon} [{$runwayName}] {$date} — {$total} pods" . ($crit > 0 ? " ({$crit} critical)" : '');

    // Build HTML body
    $webUrl = getenv('RESTART_MONITOR_WEB_URL')
        ?: 'http://10.164.16.47/SOM-Portal/restart-monitor.html';

    $html = buildEmailHtml($report, $webUrl);

    // ── Build MIME ──
    $fromName  = $cfg['from_name']  ?? 'SOM-Portal';
    $fromEmail = $cfg['from_email'];
    $boundary  = 'b_' . md5(uniqid('', true));
    $date2822  = date('r');
    $msgId     = '<' . uniqid('rm-', true) . '@' . gethostname() . '>';

    $encFromName = '=?UTF-8?B?' . base64_encode($fromName) . '?=';
    $encSubject  = '=?UTF-8?B?' . base64_encode($subject)  . '?=';
    $toHeader    = implode(', ', $toList);

    $headers = "Date: {$date2822}\r\n"
             . "From: {$encFromName} <{$fromEmail}>\r\n"
             . "To: {$toHeader}\r\n"
             . "Subject: {$encSubject}\r\n"
             . "Message-ID: {$msgId}\r\n"
             . "MIME-Version: 1.0\r\n"
             . "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

    $textBody = strip_tags(str_replace(['<br>', '<br/>', '</p>', '</tr>'], "\n", $html));

    $bodyMime  = "--{$boundary}\r\n"
               . "Content-Type: text/plain; charset=UTF-8\r\n"
               . "Content-Transfer-Encoding: base64\r\n\r\n"
               . chunk_split(base64_encode($textBody)) . "\r\n"
               . "--{$boundary}\r\n"
               . "Content-Type: text/html; charset=UTF-8\r\n"
               . "Content-Transfer-Encoding: base64\r\n\r\n"
               . chunk_split(base64_encode($html)) . "\r\n"
               . "--{$boundary}--\r\n";

    $message = $headers . "\r\n" . $bodyMime;

    // ── Send via SMTP (curl-based, matches mail/send.php pattern) ──
    $enc  = $cfg['smtp_encryption'] ?? 'tls';
    $host = $cfg['smtp_host'];
    $port = (int)($cfg['smtp_port'] ?? 587);
    $url  = ($enc === 'ssl') ? "smtps://{$host}:{$port}" : "smtp://{$host}:{$port}";

    $rcpt = array_map(fn($e) => "<{$e}>", $toList);

    $fp = fopen('php://temp', 'r+');
    fwrite($fp, $message);
    rewind($fp);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_MAIL_FROM      => "<{$fromEmail}>",
        CURLOPT_MAIL_RCPT      => $rcpt,
        CURLOPT_READDATA       => $fp,
        CURLOPT_UPLOAD         => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_TIMEOUT        => 20,
    ]);
    if (!empty($cfg['smtp_user'])) {
        curl_setopt($ch, CURLOPT_USERNAME, $cfg['smtp_user']);
        curl_setopt($ch, CURLOPT_PASSWORD, $cfg['smtp_password'] ?? '');
    }
    if ($enc === 'tls') {
        curl_setopt($ch, CURLOPT_USE_SSL, CURLUSESSL_ALL);
    }
    curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fp);

    if ($err) {
        logIntegrationError('smtp', $url, $err, ['to_count' => count($toList), 'source' => 'restart-monitor']);
        return ['sent' => false, 'reason' => "SMTP error: {$err}"];
    }
    return ['sent' => true, 'to' => $toList];
}

function buildEmailHtml(array $report, string $webUrl): string {
    $date       = htmlspecialchars($report['date']    ?? '');
    $runwayName = htmlspecialchars($report['runway']  ?? 'EKS TMN');
    $cluster    = htmlspecialchars($report['cluster'] ?? '');
    $pods       = $report['pods']            ?? [];
    $total      = (int)($report['totalRestarts'] ?? 0);
    $podCount   = count($pods);
    $sev        = $report['severitySummary'] ?? [];
    $reason     = $report['reasonSummary']   ?? [];
    $crit       = (int)($sev['critical']    ?? 0);
    $warn       = (int)($sev['warning']     ?? 0);
    $info       = (int)($sev['info']        ?? 0);
    $oom        = (int)($reason['OOMKilled']?? 0);
    $err        = (int)($reason['Error']    ?? 0);
    $done       = (int)($reason['Completed']?? 0);

    // Status badge + color
    $statusText  = $crit > 0 ? 'CRITICAL' : ($warn > 0 ? 'WARNING' : 'HEALTHY');
    $statusBg    = $crit > 0 ? '#fef2f2' : ($warn > 0 ? '#fffbeb' : '#f0fdf4');
    $statusFg    = $crit > 0 ? '#991b1b' : ($warn > 0 ? '#92400e' : '#166534');

    // ── Build per-service blocks (only critical + warning services in email) ──
    $serviceHtml = '';
    if (!empty($pods)) {
        $services = groupPodsByService($pods, $report['hpaEvents'] ?? []);
        $shown = 0;
        foreach ($services as $svc) {
            // Skip pure-info services in email — keep the email focused on actionable items
            if ($svc['maxSev'] === 'info') continue;
            $shown++;

            $svcName   = htmlspecialchars($svc['service']);
            $ns        = htmlspecialchars(str_replace(['truemoney-', '-production'], '', $svc['namespace']));
            $reasonStr = htmlspecialchars(implode(', ', $svc['reasons']));
            $svcBadgeBg = $svc['maxSev'] === 'critical' ? '#fef2f2' : '#fffbeb';
            $svcBadgeFg = $svc['maxSev'] === 'critical' ? '#991b1b' : '#92400e';
            $svcLabel   = strtoupper($svc['maxSev']);

            // Pod rows
            $sortedPods = $svc['pods'];
            usort($sortedPods, fn($a, $b) => ($b['restartedAtUnix'] ?? 0) - ($a['restartedAtUnix'] ?? 0));
            $podRowsHtml = '';
            foreach ($sortedPods as $p) {
                $suffix = '?';
                if (preg_match('/-([a-z0-9]{5})$/', $p['pod'] ?? '', $m)) $suffix = $m[1];
                $rc     = (int)($p['restartCount'] ?? 0);
                $memPct = isset($p['memoryUsageRatio']) ? round($p['memoryUsageRatio'] * 100) . '%' : '—';
                $cpuPct = isset($p['cpuUsageRatio'])    ? round($p['cpuUsageRatio']    * 100) . '%' : '—';
                $whenStr = formatRestartTime($p['restartedAtUnix'] ?? null);
                $podRowsHtml .= "<tr>
                    <td style='padding:6px 12px 6px 0;font-family:ui-monospace,SF Mono,monospace;font-size:11.5px;color:#27272a'>" . htmlspecialchars($suffix) . "</td>
                    <td style='padding:6px 12px;font-size:11.5px;color:#71717a;white-space:nowrap'>" . htmlspecialchars($whenStr) . "</td>
                    <td style='padding:6px 12px;font-size:11.5px;text-align:right;color:#27272a'>{$memPct}</td>
                    <td style='padding:6px 12px;font-size:11.5px;text-align:right;color:#27272a'>{$cpuPct}</td>
                    <td style='padding:6px 0;font-size:11.5px;text-align:right;color:" . ($rc > 1 ? '#dc2626' : '#71717a') . "'>{$rc}×</td>
                </tr>";
            }

            $serviceHtml .= "<div style='margin-top:14px;padding:14px 16px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px'>
                <table style='width:100%;border-collapse:collapse'>
                    <tr>
                        <td style='font-family:ui-monospace,SF Mono,monospace;font-size:13px;font-weight:600;color:#09090b'>{$svcName}</td>
                        <td style='text-align:right;font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 8px;background:{$svcBadgeBg};color:{$svcBadgeFg};border-radius:4px;width:1%;white-space:nowrap'>{$svcLabel}</td>
                    </tr>
                </table>
                <div style='font-size:12px;color:#71717a;margin-top:4px'>{$ns} · {$reasonStr} · {$svc['restartSum']} restarts</div>
                <table style='width:100%;border-collapse:collapse;margin-top:10px;font-size:11.5px'>
                    <thead>
                        <tr style='color:#a1a1aa;font-size:10px;letter-spacing:.04em;text-transform:uppercase'>
                            <th style='text-align:left;padding:4px 12px 4px 0;font-weight:500'>Pod</th>
                            <th style='text-align:left;padding:4px 12px;font-weight:500'>Restart At</th>
                            <th style='text-align:right;padding:4px 12px;font-weight:500'>Mem</th>
                            <th style='text-align:right;padding:4px 12px;font-weight:500'>CPU</th>
                            <th style='text-align:right;padding:4px 0;font-weight:500'>Restart</th>
                        </tr>
                    </thead>
                    <tbody>{$podRowsHtml}</tbody>
                </table>
            </div>";
        }

        if ($shown === 0 && $podCount > 0) {
            $serviceHtml = "<div style='margin-top:14px;padding:18px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;color:#166534;text-align:center'>
                No critical or warning services · All {$podCount} pods restart events are info-level
            </div>";
        }
    }

    // Definition list row helper (label/value pair)
    $dlRow = function ($label, $value, $valueColor = '#09090b', $bold = true) {
        $weight = $bold ? '600' : '400';
        return "<tr>
            <td style='padding:6px 0;color:#71717a;font-size:12.5px;width:38%'>{$label}</td>
            <td style='padding:6px 0;color:{$valueColor};font-size:12.5px;font-weight:{$weight}'>{$value}</td>
        </tr>";
    };

    return "<!DOCTYPE html>
<html><head><meta charset='UTF-8'><title>{$runwayName} Restart Audit · {$date}</title></head>
<body style='margin:0;padding:32px 16px;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;color:#18181b;font-size:14px;line-height:1.5'>

<table style='max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;border-collapse:separate;width:100%' cellpadding='0' cellspacing='0'>

  <!-- ─── Header ─── -->
  <tr><td style='padding:24px 28px 18px;border-bottom:1px solid #f4f4f5'>
    <div style='font-size:10.5px;font-weight:600;letter-spacing:.08em;color:#71717a;text-transform:uppercase;margin-bottom:8px'>{$runwayName} · Restart Audit</div>
    <div style='font-size:22px;font-weight:700;letter-spacing:-.01em;color:#09090b;margin-bottom:10px'>{$date}</div>
    <span style='display:inline-block;padding:3px 10px;font-size:10.5px;font-weight:700;letter-spacing:.05em;background:{$statusBg};color:{$statusFg};border-radius:5px'>{$statusText}</span>
  </td></tr>

  <!-- ─── Information ─── -->
  <tr><td style='padding:18px 28px;border-bottom:1px solid #f4f4f5'>
    <div style='font-size:10.5px;font-weight:600;letter-spacing:.08em;color:#71717a;text-transform:uppercase;margin-bottom:8px'>Information</div>
    <table style='width:100%;border-collapse:collapse'>
      " . $dlRow('Cluster', "<span style='font-family:ui-monospace,SF Mono,monospace;font-size:12px'>{$cluster}</span>") . "
      " . $dlRow('Total restarts', "<b>{$total}</b> across {$podCount} pods", '#09090b', false) . "
      " . $dlRow('Scan range', htmlspecialchars(formatScanWindow($report)), '#09090b', false) . "
    </table>
  </td></tr>

  <!-- ─── Severity ─── -->
  <tr><td style='padding:18px 28px;border-bottom:1px solid #f4f4f5'>
    <div style='font-size:10.5px;font-weight:600;letter-spacing:.08em;color:#71717a;text-transform:uppercase;margin-bottom:8px'>Severity</div>
    <table style='width:100%;border-collapse:collapse'>
      " . $dlRow('Critical', "<b>{$crit}</b>", $crit > 0 ? '#dc2626' : '#09090b') . "
      " . $dlRow('Warning',  "<b>{$warn}</b>", $warn > 0 ? '#d97706' : '#09090b') . "
      " . $dlRow('Info',     "<b>{$info}</b>") . "
    </table>
  </td></tr>

  <!-- ─── Termination reasons (with inline glossary) ─── -->
  <tr><td style='padding:18px 28px;border-bottom:1px solid #f4f4f5'>
    <div style='font-size:10.5px;font-weight:600;letter-spacing:.08em;color:#71717a;text-transform:uppercase;margin-bottom:8px'>Termination reasons</div>
    <table style='width:100%;border-collapse:collapse'>
      <tr>
        <td style='padding:6px 12px 6px 0;color:#9333ea;font-size:12.5px;font-weight:600;width:90px;vertical-align:top'>OOMKilled</td>
        <td style='padding:6px 12px 6px 0;color:#71717a;font-size:11.5px;line-height:1.55;vertical-align:top'>Container exceeded its memory limit — the kernel forcibly terminated it</td>
        <td style='padding:6px 0;text-align:right;color:" . ($oom > 0 ? '#9333ea' : '#09090b') . ";font-size:15px;font-weight:700;vertical-align:top'>{$oom}</td>
      </tr>
      <tr>
        <td style='padding:6px 12px 6px 0;color:#dc2626;font-size:12.5px;font-weight:600;vertical-align:top'>Error</td>
        <td style='padding:6px 12px 6px 0;color:#71717a;font-size:11.5px;line-height:1.55;vertical-align:top'>Container exited with non-zero code (crash / exception / signal)</td>
        <td style='padding:6px 0;text-align:right;color:" . ($err > 0 ? '#dc2626' : '#09090b') . ";font-size:15px;font-weight:700;vertical-align:top'>{$err}</td>
      </tr>
      <tr>
        <td style='padding:6px 12px 6px 0;color:#16a34a;font-size:12.5px;font-weight:600;vertical-align:top'>Completed</td>
        <td style='padding:6px 12px 6px 0;color:#71717a;font-size:11.5px;line-height:1.55;vertical-align:top'>Container exited normally (exit 0) — expected for batch / CronJobs</td>
        <td style='padding:6px 0;text-align:right;color:" . ($done > 0 ? '#16a34a' : '#09090b') . ";font-size:15px;font-weight:700;vertical-align:top'>{$done}</td>
      </tr>
    </table>
  </td></tr>

  <!-- ─── Services (critical + warning only) ─── -->
  " . ($serviceHtml ? "<tr><td style='padding:18px 28px;border-bottom:1px solid #f4f4f5'>
    <div style='font-size:10.5px;font-weight:600;letter-spacing:.08em;color:#71717a;text-transform:uppercase;margin-bottom:4px'>Services requiring attention</div>
    {$serviceHtml}
  </td></tr>" : '') . "

  <!-- ─── Footer CTA ─── -->
  <tr><td style='padding:22px 28px 26px;text-align:center'>
    <a href='{$webUrl}' style='display:inline-block;padding:10px 22px;background:#09090b;color:#fafafa;text-decoration:none;border-radius:7px;font-size:13px;font-weight:600;letter-spacing:-.005em'>
      View full dashboard →
    </a>
  </td></tr>

</table>

<div style='max-width:560px;margin:14px auto 0;text-align:center;color:#a1a1aa;font-size:11px'>
  Centralize-SOM · automated daily routine · {$runwayName}
</div>

</body></html>";
}
