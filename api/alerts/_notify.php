<?php
// ══════════════════════════════════════════════════════════════════════
// api/alerts/_notify.php  |  Shared Google Chat card builder + POST
// ══════════════════════════════════════════════════════════════════════
// Used by:
//   • tick.php  → sends real fire/resolve cards
//   • test.php  → sends "TEST" cards on manual verify
// Style mirrors api/batch-monitor-noti/tick.php — material icons, colored
// HTML text, section headers, decorated key-value widgets — so the SM
// team's Chat notifications feel consistent across all portal features.
// ══════════════════════════════════════════════════════════════════════

require_once __DIR__ . '/_lib.php';

/**
 * POST the assembled card to the rule's channel webhook. Returns
 * ['ok' => bool, 'error' => ?string, 'httpCode' => int, 'responseBody' => string]
 * so callers can render diagnostics without hitting the server log.
 */
function alertsSendCard(array $rule, array $card): array {
    $notify   = alertsLoadNotifyConfig();
    $channels = $notify['channels'] ?? [];
    $chKey    = $rule['channel'] ?? 'default';
    $webhook  = $channels[$chKey]['webhook_url'] ?? '';
    if ($webhook === '' && $chKey !== 'default') {
        $webhook = $channels['default']['webhook_url'] ?? '';
    }
    if ($webhook === '') {
        $err = "no webhook for channel '{$chKey}'";
        error_log("[alerts] {$err} rule={$rule['id']}");
        return ['ok' => false, 'error' => $err, 'httpCode' => 0, 'responseBody' => ''];
    }
    if (!preg_match('#^https://chat\.googleapis\.com/#', $webhook)) {
        return ['ok' => false, 'error' => 'webhook URL not a Google Chat URL', 'httpCode' => 0, 'responseBody' => ''];
    }

    $ch = curl_init($webhook);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($card),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body   = curl_exec($ch);
    $code   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $errNo  = curl_errno($ch);
    $errStr = curl_error($ch);
    curl_close($ch);

    if ($errNo !== 0) {
        error_log("[alerts] webhook curl error rule={$rule['id']}: {$errStr}");
        return ['ok' => false, 'error' => "curl: {$errStr}", 'httpCode' => 0, 'responseBody' => ''];
    }
    if ($code < 200 || $code >= 300) {
        $preview = substr((string)$body, 0, 500);
        error_log("[alerts] webhook POST failed rule={$rule['id']} code={$code} body={$preview}");
        return ['ok' => false, 'error' => "HTTP {$code}", 'httpCode' => $code, 'responseBody' => $preview];
    }
    return ['ok' => true, 'error' => null, 'httpCode' => $code, 'responseBody' => (string)$body];
}

/**
 * Build a rich Google Chat cardV2 for an alert transition. Style follows
 * batch-monitor-noti/tick.php — material icons, colored HTML text, and
 * section headers so the message reads at a glance. Includes an actionable
 * "ช่วยตรวจสอบ" section with metric-specific investigation steps + up to 3
 * jump buttons (chart / Grafana dashboard).
 *
 * $transition = 'fire' | 'resolve' | 'test'
 */
/**
 * @param array $violatingPods  For byPod metrics: [['pod'=>'name','value'=>85.3], …].
 *                              Empty array for scalar metrics.
 */
function alertsBuildCard(array $rule, array $metricMeta, ?float $value, string $transition, array $violatingPods = []): array {
    $isFire = $transition === 'fire';
    $isTest = $transition === 'test';
    $isByPod = !empty($metricMeta['byPod']);
    $fmt    = _alertsMakeFmt($metricMeta['unit'] ?? '');
    $displayThreshold = ($metricMeta['compareAs'] ?? '') === 'pct'
        ? sprintf('%.0f%%', $rule['threshold'])
        : $fmt((float)$rule['threshold']);
    $displayValue = $value === null ? '(test — no live value)' : $fmt($value);

    // Colour + emoji + human label per transition. Firing = red, resolved
    // = green, test = blue so recipients spot the difference at a glance.
    if ($isTest) {
        $header = ['emoji' => '🧪', 'label' => 'Test notification (manual)', 'color' => '#2563eb', 'icon' => 'science'];
    } elseif ($isFire) {
        $header = ['emoji' => '🚨', 'label' => 'พบปัญหาที่ต้องตรวจสอบ',   'color' => '#dc2626', 'icon' => 'error'];
    } else {
        $header = ['emoji' => '✅', 'label' => 'กลับสู่ปกติแล้ว',           'color' => '#16a34a', 'icon' => 'check_circle'];
    }

    $svc     = htmlspecialchars($rule['service'], ENT_QUOTES);
    $metric  = htmlspecialchars($metricMeta['label'], ENT_QUOTES);
    $cluster = htmlspecialchars($rule['cluster'] ?? '', ENT_QUOTES);
    $chKey   = htmlspecialchars($rule['channel'] ?? 'default', ENT_QUOTES);

    // Portal deep-link — URL sync in service-performance.html reproduces
    // exact service + range + cluster on recipient's browser.
    $portalUrl = alertsPortalBaseUrl();
    $chartUrl  = $portalUrl . '/service-performance.html?service=' . urlencode($rule['service']);
    if (!empty($rule['cluster'])) $chartUrl .= '&cluster=' . urlencode($rule['cluster']);
    $chartUrl .= '&window=60';

    // ── Banner section ────────────────────────────────────────────
    $bannerBottom = $isTest
        ? sprintf('Rule: %s %s %s (hold %ds) · manual verify — no real breach',
                   $metric,
                   htmlspecialchars($rule['op'], ENT_QUOTES),
                   htmlspecialchars($displayThreshold, ENT_QUOTES),
                   (int)$rule['durationSec'])
        : ($isFire
            ? sprintf('รายละเอียด: %s %s %s (กด %ds ต่อเนื่อง)',
                       $metric,
                       htmlspecialchars($rule['op'], ENT_QUOTES),
                       htmlspecialchars($displayThreshold, ENT_QUOTES),
                       (int)$rule['durationSec'])
            : sprintf('ค่ากลับต่ำกว่า threshold แล้ว (%s %s)',
                       htmlspecialchars($rule['op'], ENT_QUOTES),
                       htmlspecialchars($displayThreshold, ENT_QUOTES)));
    $bannerWidget = ['decoratedText' => [
        'startIcon'   => ['materialIcon' => ['name' => $header['icon']]],
        'topLabel'    => $header['label'],
        'text'        => sprintf('<b><font color="%s">%s · %s</font></b>',
                                  $header['color'], $svc, $metric),
        'bottomLabel' => $bannerBottom,
        'wrapText'    => true,
    ]];

    // ── Current values section ────────────────────────────────────
    $valueWidgets = [
        _alertsKv('speed',    'ค่าปัจจุบัน',   sprintf('<b><font color="%s">%s</font></b>', $header['color'], htmlspecialchars($displayValue, ENT_QUOTES))),
        _alertsKv('flag',     'Threshold',    sprintf('%s %s', htmlspecialchars($rule['op'], ENT_QUOTES), htmlspecialchars($displayThreshold, ENT_QUOTES))),
        _alertsKv('timer',    'Duration',     sprintf('%ds ต่อเนื่อง', (int)$rule['durationSec'])),
        _alertsKv('schedule', 'เวลาที่แจ้ง',  date('Y-m-d H:i:s')),
    ];
    if ($cluster !== '') $valueWidgets[] = _alertsKv('cloud', 'Cluster', $cluster);

    // ── Investigation guidance — the "ช่วยตรวจสอบ" section ─────────
    $suggestions = alertsSuggestions($rule['metric'], $isFire);
    $suggestionWidgets = [];
    if ($suggestions && $isFire) {
        $bullets = array_map(fn($s) => '• ' . htmlspecialchars($s, ENT_QUOTES), $suggestions);
        $suggestionWidgets[] = ['textParagraph' => [
            'text' => '<b>ช่วยตรวจสอบ:</b><br>' . implode('<br>', $bullets),
        ]];
    }

    // ── Per-pod breakdown (byPod metrics only) ───────────────────
    $podWidgets = [];
    if ($isByPod && $isFire && !empty($violatingPods)) {
        usort($violatingPods, fn($a, $b) => $b['value'] <=> $a['value']);
        $lines = array_map(function($p) use ($fmt) {
            $bar  = str_repeat('█', (int)min(10, round($p['value'] / 10)));
            $rest = str_repeat('░', 10 - strlen($bar));
            return sprintf('<b>%s</b>  %s%s  <font color="#dc2626">%.1f%%</font>',
                htmlspecialchars($p['pod'], ENT_QUOTES), $bar, $rest, $p['value']);
        }, $violatingPods);
        $podWidgets[] = ['textParagraph' => [
            'text' => sprintf('<b>Pod ที่เกิน threshold (%d ตัว):</b><br>', count($violatingPods))
                    . implode('<br>', $lines),
        ]];
    }

    // ── Note (user-supplied per rule) ─────────────────────────────
    $noteText = trim((string)($rule['note'] ?? ''));
    $noteWidgets = [];
    if ($noteText !== '') {
        $noteWidgets[] = ['textParagraph' => [
            'text' => '<b>Note:</b> ' . nl2br(htmlspecialchars($noteText, ENT_QUOTES)),
        ]];
    }

    // ── Alert URL (plain link, no buttons) ────────────────────────
    // Users asked for the raw URL instead of buttons — copy-paste friendly
    // and Google Chat auto-linkifies text URLs so it's clickable too.
    // Uses <a> tag for explicit anchor styling (blue underline) rather
    // than relying on Chat's auto-detection.
    $linkWidget = ['textParagraph' => [
        'text' => '<b>🔗 ลิงก์ dashboard:</b><br>'
                . sprintf('<a href="%s">%s</a>',
                          htmlspecialchars($chartUrl, ENT_QUOTES),
                          htmlspecialchars($chartUrl, ENT_QUOTES)),
    ]];

    // ── Assemble ──────────────────────────────────────────────────
    $sections = [
        ['widgets' => [$bannerWidget]],
        ['header' => 'ข้อมูลปัจจุบัน', 'widgets' => $valueWidgets],
    ];
    if ($podWidgets)        $sections[] = ['header' => 'รายละเอียดต่อ Pod', 'widgets' => $podWidgets];
    if ($suggestionWidgets) $sections[] = ['header' => 'สิ่งที่ควรทำต่อ', 'widgets' => $suggestionWidgets];
    if ($noteWidgets)       $sections[] = ['header' => 'Note จาก rule', 'widgets' => $noteWidgets];
    $sections[] = ['widgets' => [$linkWidget]];

    return [
        'cardsV2' => [[
            'cardId' => $rule['id'] . '_' . $transition . '_' . time(),
            'card'   => [
                'header' => [
                    'title'    => $header['emoji'] . ' ' . $header['label'],
                    'subtitle' => sprintf('%s · channel: %s', $svc, $chKey),
                ],
                'sections' => $sections,
            ],
        ]],
    ];
}

/**
 * Metric-specific investigation checklist (Thai). Empty array for
 * 'resolve' transition — no need to send a checklist when things are OK.
 */
function alertsSuggestions(string $metric, bool $isFire): array {
    if (!$isFire) return [];
    return match ($metric) {
        'latency', 'latency_max' => [
            'เปิด service-performance → ดู Avg latency chart หา spike ตรงเวลาที่แจ้ง',
            'Right-click ที่จุด spike → เปิด Log Explorer หา request ที่ค้าง (correlation_id / trace ID)',
            'เช็ค GC pause chart ใน Runtime section — pause ยาวทำ request ค้าง',
            'เช็ค Dependencies → downstream service ตัวไหนช้า? (คลิกดู per-URI drill)',
        ],
        'cpu' => [
            'ดู CPU per-pod chart — pod ตัวเดียว hot หรือทั้ง fleet?',
            'ถ้าเป็น pod เดียว → restart pod นั้น (อาจติด infinite loop)',
            'ถ้าทั้ง fleet → scale out (เพิ่ม replicas) หรือ profile code',
        ],
        'cpu_pod_max' => [
            'notification บอกชื่อ pod ที่ hot — เช็ค pod นั้นก่อน',
            'pod เดียว CPU สูงผิดปกติ = อาจติด infinite loop หรือ goroutine/thread leak',
            'ดู CPU throttled % ด้วย — CPU spike อาจซ่อนอยู่ใน throttle metric แทน',
            'พิจารณา restart pod นั้นก่อน → ถ้าปัญหาหาย = runtime issue ไม่ใช่ traffic',
            'ถ้าหลาย pod พร้อมกัน = traffic spike หรือ downstream ช้าทำ thread ค้าง',
        ],
        'mem' => [
            'ดู MEM per-pod chart หา pod ที่ใช้เกินคนอื่น (memory leak signal)',
            'เช็ค JVM heap chart — full GC บ่อย + heap ไม่ลง = leak แน่นอน',
            'ทำ heap dump ก่อน restart เพื่อหา root cause',
        ],
        'mem_pod_max' => [
            'notification บอกชื่อ pod ที่เกิน threshold — เช็ค pod นั้นก่อนเลย',
            'เปิด Restart Analyzer → ใส่ pod name ดู memory growth trend ก่อน OOMKill',
            'ถ้า pod เดียวสูงผิดปกติ = มี hotspot / memory leak ใน pod นั้น (ไม่ใช่ทั้ง fleet)',
            'ทำ heap dump ก่อน restart — ข้อมูลหายหลัง container ตาย',
            'พิจารณาเพิ่ม memory limit ถ้า traffic เพิ่มขึ้นจริง',
        ],
        'oom_killed' => [
            'OOMKill เกิดขึ้นแล้ว — pod ถูก restart โดย kubelet อัตโนมัติ',
            'เช็คว่า pod กลับมา Running ปกติหรือยัง (kubectl get pods)',
            'เปิด Restart Analyzer เพื่อดู memory usage ก่อน crash',
            'ตรวจสอบว่า memory limit เหมาะสมกับ traffic ปัจจุบันหรือไม่',
            'ถ้า OOM ซ้ำหลายครั้ง = memory leak หรือ limit ตั้งต่ำเกินไป',
        ],
        'gc_pause' => [
            'เช็ค heap % chart — heap เต็มทำ Full GC ยาว',
            'ดู allocation rate — bulk operation ใหญ่? tune heap size',
            'ตรวจ GC algorithm (G1/ZGC) — พิจารณาเปลี่ยนถ้า pause > 1s บ่อย',
        ],
        'heap_pct' => [
            'ทำ heap dump ตอนนี้เพื่อ analyze (jmap / async-profiler)',
            'ถ้า > 90% ต่อเนื่อง → เพิ่ม -Xmx หรือ scale out',
            'เช็ค memory leak: object count เพิ่มโดยไม่ลด?',
        ],
        'dbpool_active' => [
            'DB pool เต็ม → เพิ่ม maximum-pool-size (spring.datasource.hikari.*)',
            'ตรวจ slow query — pod ถือ connection นานเพราะ query ช้า',
            'เช็ค DB server: CPU/IO capacity, active connections รวม',
        ],
        'error_rate' => [
            'เปิด API endpoints section → หา URI ที่ 5xx สูง',
            'Right-click ที่ spike → Log Explorer หา stacktrace',
            'ตรวจ downstream: dependency ตัวไหน error/timeout?',
        ],
        'txn_rate' => [
            'TXN spike ผิดปกติ → เช็ค upstream: caller ตัวไหนยิงเยอะ?',
            'ถ้าเป็น attack pattern → เช็ค rate limit + IP filter',
            'ถ้าเป็น legitimate traffic → scale out พร้อม',
        ],
        'restarts' => [
            'เข้า Restart Analyzer (link ใน SM Hub) → auto-diagnose OOM/crash/deploy',
            'ดู pod events (kubectl describe pod) หา reason',
            'เช็ค memory limit vs actual usage — OOM signal?',
        ],
        default => [
            'เปิด service-performance page ของ service นี้',
            'ตรวจ chart ตรงเวลาที่แจ้ง + hover เพื่อดู correlation ทุก metric',
        ],
    };
}

// ── Small helpers ──────────────────────────────────────────────────

function _alertsMakeFmt(string $unit): \Closure {
    return function($v) use ($unit) {
        if ($v === null) return '—';
        if ($unit === 'ms')    return $v >= 1000 ? sprintf('%.2f s', $v / 1000) : sprintf('%.0f ms', $v);
        if ($unit === 'pct')   return sprintf('%.1f%%', $v);
        if ($unit === 'bytes') return alertsFmtBytes($v);
        if ($unit === 'cores') return $v >= 1 ? sprintf('%.2f cores', $v) : sprintf('%d m', (int)round($v * 1000));
        return sprintf('%.2f', $v);
    };
}
function _alertsKv(string $icon, string $label, string $text): array {
    return ['decoratedText' => [
        'startIcon' => ['materialIcon' => ['name' => $icon]],
        'topLabel'  => $label,
        'text'      => $text,
        'wrapText'  => true,
    ]];
}
function alertsFmtBytes(float $b): string {
    if ($b >= 1024**3) return sprintf('%.2f GB', $b / (1024**3));
    if ($b >= 1024**2) return sprintf('%.0f MB', $b / (1024**2));
    if ($b >= 1024)    return sprintf('%.0f KB', $b / 1024);
    return sprintf('%d B', (int)$b);
}
function alertsPortalBaseUrl(): string {
    $scheme = (($_SERVER['HTTPS'] ?? '') === 'on') ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
    // Works from any /api/alerts/*.php entry point — strips the whole
    // /api/... suffix regardless of which endpoint the request hit.
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $base   = preg_replace('#/api/alerts/[^/]+$#', '', $script);
    return $scheme . '://' . $host . $base;
}
function alertsGrafanaUrlFor(string $svc): string {
    $svcSlug = preg_replace('/[^a-z0-9._-]+/i', '_', $svc);
    $cacheDir = teamDataPath('service-performance/cache/detail');
    if (!is_dir($cacheDir)) return '';
    $matches = glob($cacheDir . '/' . $svcSlug . '_*.json') ?: [];
    usort($matches, fn($a, $b) => filemtime($b) - filemtime($a));
    foreach ($matches as $f) {
        $data = json_decode((string)file_get_contents($f), true);
        $rw = $data['runway'] ?? [];
        if (!empty($rw['grafanaUrl']) && !empty($rw['dashboardUid'])) {
            $var = $rw['dashboardVarName'] ?? 'App';
            return rtrim($rw['grafanaUrl'], '/') . '/d/' . $rw['dashboardUid']
                . '?orgId=' . (int)($rw['orgId'] ?? 2)
                . '&var-' . urlencode($var) . '=' . urlencode($svc);
        }
    }
    return '';
}
