<?php
/**
 * GET /api/restart-monitor/public-monthly.php?month=YYYY-MM&runway=all|EKS%20TMN|...
 *
 * Public, read-only HTML view of the monthly restart report.
 * Used as the "เปิด Dashboard" CTA link target in monthly emails so recipients
 * (who may not have an SOM account) can still view the full report.
 *
 * No auth, no mutations — pure GET, renders aggregated read-only summary.
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_aggregate.php';
require_once __DIR__ . '/_email.php';
require_once __DIR__ . '/../mail/_branding.php';

// Only GET allowed (no auth → no need for full requireAuth, but block mutations)
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Method not allowed';
    exit;
}

// ── Team context (public endpoint: ?team=xxx, default sm) ───────────────────
$_teamParam = trim((string)($_GET['team'] ?? 'sm'));
if (!preg_match('/^[a-z0-9_-]+$/', $_teamParam)) $_teamParam = 'sm';
$GLOBALS['_current_team'] = $_teamParam;

// ── Parse params ────────────────────────────────────────────────────────────
$month = trim((string)($_GET['month'] ?? date('Y-m')));
if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Invalid month parameter (expected YYYY-MM)';
    exit;
}

$runwayParam = trim((string)($_GET['runway'] ?? 'all'));

// ── Load runway config (team-scoped) ────────────────────────────────────────
$cfgRw = readJson('grafana-runways.json');
$rwAll = $cfgRw['runways'] ?? [];

$cfg = readJson('mail_config.json');

// Self URL — used for runway navigation links (relative URI keeps it host-safe)
$selfPath = strtok($_SERVER['REQUEST_URI'] ?? '', '?');

// ── Per-runway summary builder (mirrors preview/send-monthly.php) ───────────
$buildSummaryForRunway = function (array $rw, string $month) {
    $slug    = $rw['slug'] ?? '';
    $name    = $rw['name'] ?? '';
    $cluster = $rw['cluster'] ?? '';
    $dailyDir = teamDataPath('grafana-monitoring/raw/' . $slug . '/');
    $sum = rmAggregateMonth($dailyDir, $month);
    $prev = rmPrevMonth($month);
    $prevLite = rmAggregateMonth($dailyDir, $prev, true);
    $prevTot  = $prevLite['totalRestarts'];
    $sum['previousMonth'] = ['month' => $prev, 'totalRestarts' => $prevTot, 'critical' => $prevLite['severitySummary']['critical'] ?? 0];
    $sum['deltaVsPrev']   = [
        'restarts'    => $sum['totalRestarts'] - $prevTot,
        'restartsPct' => $prevTot > 0 ? round((($sum['totalRestarts'] - $prevTot) / $prevTot) * 100, 1) : null,
    ];
    $sum['runway']  = $name;
    $sum['cluster'] = $cluster;
    return $sum;
};

// CTA inside email content links back to this same public page
$selfUrl = $selfPath ?: '';

// ── Build the report content ────────────────────────────────────────────────
$inner   = '';
$title   = '';
$noData  = false;

if ($runwayParam === 'all') {
    $summaries = [];
    foreach ($rwAll as $rw) {
        $sum = $buildSummaryForRunway($rw, $month);
        if (($sum['daysWithData'] ?? 0) > 0) {
            $summaries[$rw['name']] = $sum;
        }
    }
    if (!$summaries) {
        $noData = true;
    } else {
        $inner = rmBuildCombinedMonthlyEmailHtml($summaries, $month, $selfUrl);
    }
    $title = "รายงานรายเดือน Restart ทุก Runway — {$month}";
} else {
    $rw = null;
    foreach ($rwAll as $r) if (($r['name'] ?? '') === $runwayParam) { $rw = $r; break; }
    if (!$rw) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=UTF-8');
        echo "ไม่พบ runway: {$runwayParam}";
        exit;
    }
    $summary = $buildSummaryForRunway($rw, $month);
    if (($summary['daysWithData'] ?? 0) === 0) {
        $noData = true;
    } else {
        // Single-runway view uses the full (non-compact) report
        $inner = rmBuildMonthlyEmailHtml($summary, $selfUrl, false);
    }
    $title = "รายงานรายเดือน Restart {$runwayParam} — {$month}";
}

// ── Build navigation bar (runway switcher + view-only badge) ────────────────
$navItems = '';
$mkNavBtn = function (string $label, string $rwName, bool $active) use ($selfPath, $month): string {
    $href = htmlspecialchars($selfPath . '?month=' . urlencode($month) . '&runway=' . urlencode($rwName), ENT_QUOTES);
    $base = 'display:inline-block;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;margin:0 4px 4px 0;border:1px solid';
    $style = $active
        ? "{$base} #1d4ed8;background:#1d4ed8;color:#fff"
        : "{$base} #e2e8f0;background:#ffffff;color:#334155";
    return "<a href='{$href}' style='{$style}'>" . htmlspecialchars($label) . "</a>";
};

$navItems .= $mkNavBtn('ทุก Runway', 'all', $runwayParam === 'all');
foreach ($rwAll as $rw) {
    $rname = $rw['name'] ?? '';
    if ($rname === '') continue;
    $navItems .= $mkNavBtn($rname, $rname, $runwayParam === $rname);
}

$readOnlyBadge = "
<div style='background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 18px;margin-bottom:18px'>
  <div style='display:flex;align-items:center;flex-wrap:wrap;gap:10px;justify-content:space-between'>
    <div>
      <div style='font-size:11px;font-weight:700;color:#0369a1;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px'>โหมดดูอย่างเดียว · Read Only</div>
      <div style='font-size:12px;color:#0c4a6e;line-height:1.6'>หน้านี้แสดงรายงานรายเดือนแบบสรุปเท่านั้น · ไม่สามารถส่งเมล์ แก้ไข หรือทำรายการอื่นได้</div>
    </div>
    <div style='font-size:11px;color:#075985;font-family:monospace;background:#e0f2fe;padding:4px 10px;border-radius:4px'>{$month}</div>
  </div>
  <div style='margin-top:12px'>{$navItems}</div>
</div>";

if ($noData) {
    $emptyMsg = "
    <div style='padding:48px 24px;text-align:center;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px'>
      <div style='font-size:14px;font-weight:600;color:#475569;margin-bottom:6px'>ยังไม่มีข้อมูลของเดือนนี้</div>
      <div style='font-size:12px;color:#94a3b8'>ลองเลือก runway อื่นหรือเดือนอื่น</div>
    </div>";
    $inner = $emptyMsg;
}

$inner = $readOnlyBadge . $inner;

// ── Wrap with branded gradient template (same one admin/mail-config sets) ───
$html = buildGradientEmail($inner, $title, $cfg, true);

// ── Cache headers: short cache to ease load from many email recipients ──────
header('Content-Type: text/html; charset=UTF-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: public, max-age=300');  // 5-min CDN/browser cache

echo $html;
exit;
