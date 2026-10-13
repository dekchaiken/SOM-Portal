<?php
// ─── Alert Monitor Stats API ──────────────────────────────────────────────────
// GET → aggregate cached alerts and return everything the dashboard renders:
//   - per-month counts (total, by category, by status, by priority)
//   - %-change vs previous month
//   - top 10 alert titles (normalised) with per-month trend
//   - auto-generated analysis text
//
// Query-params:
//   from=YYYY-MM   inclusive start month (default: 11 months back)
//   to=YYYY-MM     inclusive end month   (default: current month)
//   top=N          top-N alerts (default 10, max 50)
require_once __DIR__ . '/../helpers.php';
requireAuth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respondError('Method not allowed', 405);
}

$cfg = readJson('alert-monitor-config.json') ?: [];
$rules = $cfg['classification_rules'] ?? [];
usort($rules, fn($a, $b) => ($a['priority'] ?? 0) <=> ($b['priority'] ?? 0));
$categoryIds = array_map(fn($c) => $c['id'] ?? '', $cfg['categories'] ?? [
    ['id'=>'monitoring'], ['id'=>'batch'], ['id'=>'other']
]);

// ── Resolve date range ───────────────────────────────────────────────────────
$to   = $_GET['to']   ?? date('Y-m');
$from = $_GET['from'] ?? date('Y-m', strtotime('-11 months'));
$topN = min(50, max(1, (int)($_GET['top'] ?? 10)));

if (!preg_match('/^\d{4}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}$/', $to)) {
    respondError('Invalid from/to format — expected YYYY-MM', 400);
}
if (strcmp($from, $to) > 0) [$from, $to] = [$to, $from];

// Build list of months in range (inclusive)
$months = [];
$cur = DateTimeImmutable::createFromFormat('!Y-m', $from);
$end = DateTimeImmutable::createFromFormat('!Y-m', $to);
if (!$cur || !$end) respondError('Invalid month values', 400);
while ($cur <= $end) {
    $months[] = $cur->format('Y-m');
    $cur = $cur->modify('+1 month');
}

// ── Classifier ───────────────────────────────────────────────────────────────
function classifyAlert(array $alert, array $rules): string {
    foreach ($rules as $r) {
        if (empty($r['enabled'])) continue;
        $field = $r['match_field'] ?? 'message';
        $type  = $r['match_type']  ?? 'contains';
        $kw    = (string)($r['keyword'] ?? '');
        if ($kw === '') continue;

        $haystack = '';
        if ($field === 'message')      $haystack = (string)($alert['message'] ?? '');
        elseif ($field === 'source')   $haystack = (string)($alert['source']  ?? '');
        elseif ($field === 'alias')    $haystack = (string)($alert['alias']   ?? '');
        elseif ($field === 'tags')     $haystack = implode(' ', (array)($alert['tags'] ?? []));

        $ok = false;
        switch ($type) {
            case 'starts_with': $ok = str_starts_with($haystack, $kw); break;
            case 'equals':      $ok = $haystack === $kw;                break;
            case 'regex':       $ok = @preg_match("/$kw/i", $haystack) === 1; break;
            case 'contains':
            default:            $ok = stripos($haystack, $kw) !== false;
        }
        if ($ok) return (string)($r['category'] ?? 'other');
    }
    return 'other';
}

// ── Title normaliser — strip noisy prefixes so grouping works ────────────────
// e.g. "[Grafana EKS]: [SMC] Job Batch Jenkins Failed" → "Job Batch Jenkins Failed"
//      "TCRB PAYNEXTEXTRA - Repayment Report (06072026) - FAILED"
//                                   → "TCRB PAYNEXTEXTRA - Repayment Report - FAILED"
function normaliseTitle(string $msg): string {
    $t = trim($msg);
    // Strip leading [Bracket] prefixes (up to 3)
    for ($i = 0; $i < 3; $i++) {
        $stripped = preg_replace('/^\s*\[[^\]]{1,60}\]\s*:?\s*/', '', $t, 1, $c);
        if (!$c) break;
        $t = $stripped;
    }
    // Strip inline timestamps like (06072026), 2026-07-06, YYYYMMDD
    $t = preg_replace('/\(?(\d{2}[-\/]?\d{2}[-\/]?\d{4})\)?/', '', $t);
    $t = preg_replace('/\(?(\d{4}[-\/]?\d{2}[-\/]?\d{2})\)?/', '', $t);
    $t = preg_replace('/\(?(\d{8})\)?/', '', $t);
    // Strip counters like "Tag29", "Tag30"
    $t = preg_replace('/\bTag\d+\b/i', '', $t);
    $t = preg_replace('/\s{2,}/', ' ', $t);
    return trim($t);
}

// ── Aggregate ────────────────────────────────────────────────────────────────
$monthData     = [];    // month => { total, by_category, by_status, by_priority, by_source, by_hour }
$titleAgg      = [];    // normalisedTitle => { count, by_month, by_category, sample }
$perMonthTitle = [];    // month => normalisedTitle => count (for top-N per month)
$totalAll      = 0;

foreach ($months as $m) {
    $file = readJson("alerts/$m.json");
    $alerts = $file['alerts'] ?? [];
    $bucket = [
        'month'        => $m,
        'total'        => 0,
        'by_category'  => array_fill_keys($categoryIds, 0),
        'by_status'    => [],
        'by_priority'  => [],
        'by_source'    => [],
        'by_hour'      => array_fill(0, 24, 0),  // 24-slot histogram for heatmap
        'file_updated' => (int)($file['updated_at'] ?? 0),
    ];
    if (!isset($perMonthTitle[$m])) $perMonthTitle[$m] = [];

    foreach ($alerts as $a) {
        $cat = classifyAlert($a, $rules);
        $bucket['total']++;
        $bucket['by_category'][$cat] = ($bucket['by_category'][$cat] ?? 0) + 1;
        $st = $a['status']   ?? 'unknown';  $bucket['by_status'][$st]   = ($bucket['by_status'][$st]   ?? 0) + 1;
        $pr = $a['priority'] ?? '-';        $bucket['by_priority'][$pr] = ($bucket['by_priority'][$pr] ?? 0) + 1;
        $sr = $a['source']   ?? '-';        $bucket['by_source'][$sr]   = ($bucket['by_source'][$sr]   ?? 0) + 1;

        // Hour-of-day bucket for heatmap. created_at is epoch ms; use local
        // time (server tz = Asia/Bangkok per helpers.php).
        $ts = (int)($a['created_at'] ?? 0);
        if ($ts > 0) {
            $hr = (int)date('G', (int)($ts / 1000));
            if ($hr >= 0 && $hr < 24) $bucket['by_hour'][$hr]++;
        }
        $totalAll++;

        $key = normaliseTitle((string)($a['message'] ?? ''));
        if ($key === '') continue;
        if (!isset($titleAgg[$key])) {
            $titleAgg[$key] = [
                'title'       => $key,
                'sample'      => (string)($a['message'] ?? ''),
                'category'    => $cat,
                'count'       => 0,
                'by_month'    => [],
                'by_status'   => [],
                'latest_at'   => 0,
                'first_at'    => PHP_INT_MAX,
            ];
        }
        $titleAgg[$key]['count']++;
        $titleAgg[$key]['by_month'][$m] = ($titleAgg[$key]['by_month'][$m] ?? 0) + 1;
        $titleAgg[$key]['by_status'][$st] = ($titleAgg[$key]['by_status'][$st] ?? 0) + 1;
        $titleAgg[$key]['latest_at'] = max($titleAgg[$key]['latest_at'], (int)($a['created_at'] ?? 0));
        $titleAgg[$key]['first_at']  = min($titleAgg[$key]['first_at'],  (int)($a['created_at'] ?? 0));

        $perMonthTitle[$m][$key] = ($perMonthTitle[$m][$key] ?? 0) + 1;
    }
    $monthData[$m] = $bucket;
}

// ── %-change vs previous month, per category ─────────────────────────────────
$prev = null;
foreach ($months as $m) {
    $b =& $monthData[$m];
    $b['change_pct']          = null;
    $b['change_pct_by_cat']   = [];
    if ($prev !== null) {
        $prevTotal = $monthData[$prev]['total'];
        $b['change_pct'] = $prevTotal > 0
            ? round((($b['total'] - $prevTotal) / $prevTotal) * 100, 1)
            : ($b['total'] > 0 ? 100.0 : 0.0);
        foreach ($categoryIds as $c) {
            $prevC = $monthData[$prev]['by_category'][$c] ?? 0;
            $curC  = $b['by_category'][$c] ?? 0;
            $b['change_pct_by_cat'][$c] = $prevC > 0
                ? round((($curC - $prevC) / $prevC) * 100, 1)
                : ($curC > 0 ? 100.0 : 0.0);
        }
    }
    $prev = $m;
    unset($b);
}

// ── Top-N titles by count ────────────────────────────────────────────────────
// uasort() (not usort) — preserves title → agg key mapping so per-month top
// lookups later can still find category/sample by title.
uasort($titleAgg, fn($a, $b) => $b['count'] <=> $a['count']);
$top = array_slice(array_values($titleAgg), 0, $topN);
// Add trend (delta between latest two months in range)
foreach ($top as &$t) {
    $counts = [];
    foreach ($months as $m) $counts[] = $t['by_month'][$m] ?? 0;
    $t['trend_series'] = $counts;
    $n = count($counts);
    $t['trend_delta'] = $n >= 2 ? ($counts[$n-1] - $counts[$n-2]) : 0;
    if ($t['first_at'] === PHP_INT_MAX) $t['first_at'] = 0;
}
unset($t);

// ── Auto-analysis text ───────────────────────────────────────────────────────
$analysis = [];
$lastMonth = end($months);
$prevMonth = count($months) >= 2 ? $months[count($months) - 2] : null;
if ($lastMonth && isset($monthData[$lastMonth])) {
    $cur = $monthData[$lastMonth];
    $analysis[] = sprintf('เดือน %s มี alerts รวม %d ตัว (Monitoring %d / Batch %d / Other %d)',
        $lastMonth, $cur['total'],
        $cur['by_category']['monitoring'] ?? 0,
        $cur['by_category']['batch']      ?? 0,
        $cur['by_category']['other']      ?? 0);
    if ($prevMonth && isset($monthData[$prevMonth])) {
        $pv = $monthData[$prevMonth];
        $dTot = $cur['total'] - $pv['total'];
        $sign = $dTot > 0 ? 'เพิ่มขึ้น' : ($dTot < 0 ? 'ลดลง' : 'เท่าเดิม');
        $analysis[] = sprintf('เทียบกับ %s %s %d ตัว (%s%.1f%%)',
            $prevMonth, $sign, abs($dTot),
            $dTot >= 0 ? '+' : '', $cur['change_pct'] ?? 0);

        foreach (['monitoring','batch'] as $c) {
            $pC = $pv['by_category'][$c]  ?? 0;
            $cC = $cur['by_category'][$c] ?? 0;
            $d  = $cC - $pC;
            if ($d === 0) continue;
            $analysis[] = sprintf('  • %s %s %d ตัว (%s%.1f%%)',
                ucfirst($c),
                $d > 0 ? 'เพิ่ม' : 'ลด', abs($d),
                $d >= 0 ? '+' : '', $cur['change_pct_by_cat'][$c] ?? 0);
        }
    }
    if (!empty($top)) {
        $analysis[] = sprintf('Alert ที่มาเยอะที่สุดในช่วงนี้: "%s" (%d ครั้ง, category: %s)',
            $top[0]['title'], $top[0]['count'], $top[0]['category']);
    }
}

// ── Per-month top-N (for drill-down cards) ───────────────────────────────────
$topByMonth = [];
foreach ($months as $m) {
    $mt = $perMonthTitle[$m] ?? [];
    arsort($mt);
    $picked = [];
    $rank = 0;
    foreach ($mt as $title => $count) {
        if ($rank >= $topN) break;
        $picked[] = [
            'title'    => $title,
            'count'    => $count,
            'category' => $titleAgg[$title]['category'] ?? 'other',
            'sample'   => $titleAgg[$title]['sample']   ?? $title,
        ];
        $rank++;
    }
    $topByMonth[$m] = $picked;
}

// ── Hour × Month matrix (for heatmap) ────────────────────────────────────────
$hourMatrix = [
    'hours'  => range(0, 23),
    'months' => $months,
    'rows'   => [],           // hour => [count_by_month, ...]
    'col_totals' => [],       // month => total (also in monthData but easier here)
    'row_totals' => [],       // hour  => total across all months in range
    'grand_total' => $totalAll,
    'max_cell'   => 0,        // for color-scale normalisation
];
for ($h = 0; $h < 24; $h++) {
    $row = ['hour' => $h, 'counts' => []];
    foreach ($months as $m) {
        $c = $monthData[$m]['by_hour'][$h] ?? 0;
        $row['counts'][] = $c;
        $hourMatrix['col_totals'][$m] = ($hourMatrix['col_totals'][$m] ?? 0) + $c;
        $hourMatrix['row_totals'][$h] = ($hourMatrix['row_totals'][$h] ?? 0) + $c;
        if ($c > $hourMatrix['max_cell']) $hourMatrix['max_cell'] = $c;
    }
    $hourMatrix['rows'][] = $row;
}

respondOk([
    'range'         => ['from' => $from, 'to' => $to, 'months' => $months],
    'categories'    => $cfg['categories'] ?? [],
    'total'         => $totalAll,
    'monthly'       => array_values($monthData),
    'top'           => $top,
    'top_by_month'  => $topByMonth,
    'hour_matrix'   => $hourMatrix,
    'analysis'      => $analysis,
    'generated_at'  => time(),
]);
