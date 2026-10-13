<?php
// ─── Alert Monitor — month-to-month comparison ────────────────────────────────
// GET ?a=YYYY-MM&b=YYYY-MM → returns detailed diff between two months:
//   - total / by_category deltas with % change
//   - alerts that INCREASED the most (new spikes)
//   - alerts that DROPPED the most  (fixed / resolved)
//   - alerts that appeared only in B (new problems)
//   - alerts that disappeared in B (resolved problems)
require_once __DIR__ . '/../helpers.php';
requireAuth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respondError('Method not allowed', 405);
}

$a = $_GET['a'] ?? '';
$b = $_GET['b'] ?? '';
if (!preg_match('/^\d{4}-\d{2}$/', $a) || !preg_match('/^\d{4}-\d{2}$/', $b)) {
    respondError('Missing a= / b= (YYYY-MM)', 400);
}

$cfg   = readJson('alert-monitor-config.json') ?: [];
$rules = $cfg['classification_rules'] ?? [];
usort($rules, fn($x, $y) => ($x['priority'] ?? 0) <=> ($y['priority'] ?? 0));
$categoryIds = array_map(fn($c) => $c['id'] ?? '', $cfg['categories'] ?? [
    ['id'=>'monitoring'],['id'=>'batch'],['id'=>'other']
]);

// Same classifier + normaliser as stats.php ---------------------------------
function _amCompareClassify(array $alert, array $rules): string {
    foreach ($rules as $r) {
        if (empty($r['enabled'])) continue;
        $field = $r['match_field'] ?? 'message';
        $type  = $r['match_type']  ?? 'contains';
        $kw    = (string)($r['keyword'] ?? '');
        if ($kw === '') continue;
        $h = '';
        if ($field === 'message')      $h = (string)($alert['message'] ?? '');
        elseif ($field === 'source')   $h = (string)($alert['source']  ?? '');
        elseif ($field === 'alias')    $h = (string)($alert['alias']   ?? '');
        elseif ($field === 'tags')     $h = implode(' ', (array)($alert['tags'] ?? []));
        $ok = false;
        switch ($type) {
            case 'starts_with': $ok = str_starts_with($h, $kw); break;
            case 'equals':      $ok = $h === $kw;                break;
            case 'regex':       $ok = @preg_match("/$kw/i", $h) === 1; break;
            case 'contains':
            default:            $ok = stripos($h, $kw) !== false;
        }
        if ($ok) return (string)($r['category'] ?? 'other');
    }
    return 'other';
}
function _amCompareNormalise(string $msg): string {
    $t = trim($msg);
    for ($i = 0; $i < 3; $i++) {
        $s = preg_replace('/^\s*\[[^\]]{1,60}\]\s*:?\s*/', '', $t, 1, $c);
        if (!$c) break; $t = $s;
    }
    $t = preg_replace('/\(?(\d{2}[-\/]?\d{2}[-\/]?\d{4})\)?/', '', $t);
    $t = preg_replace('/\(?(\d{4}[-\/]?\d{2}[-\/]?\d{2})\)?/', '', $t);
    $t = preg_replace('/\(?(\d{8})\)?/', '', $t);
    $t = preg_replace('/\bTag\d+\b/i', '', $t);
    $t = preg_replace('/\s{2,}/', ' ', $t);
    return trim($t);
}

function _amBucket(string $month, array $rules, array $categoryIds): array {
    $file = readJson("alerts/$month.json");
    $alerts = $file['alerts'] ?? [];
    $bucket = [
        'month'       => $month,
        'total'       => 0,
        'by_category' => array_fill_keys($categoryIds, 0),
        'by_status'   => [],
        'by_priority' => [],
        'titles'      => [],   // normalisedTitle => count
        'title_meta'  => [],   // normalisedTitle => { sample, category }
    ];
    foreach ($alerts as $a) {
        $cat = _amCompareClassify($a, $rules);
        $bucket['total']++;
        $bucket['by_category'][$cat] = ($bucket['by_category'][$cat] ?? 0) + 1;
        $st = $a['status']   ?? 'unknown';  $bucket['by_status'][$st]   = ($bucket['by_status'][$st]   ?? 0) + 1;
        $pr = $a['priority'] ?? '-';        $bucket['by_priority'][$pr] = ($bucket['by_priority'][$pr] ?? 0) + 1;

        $key = _amCompareNormalise((string)($a['message'] ?? ''));
        if ($key === '') continue;
        $bucket['titles'][$key] = ($bucket['titles'][$key] ?? 0) + 1;
        if (!isset($bucket['title_meta'][$key])) {
            $bucket['title_meta'][$key] = [
                'sample'   => (string)($a['message'] ?? ''),
                'category' => $cat,
            ];
        }
    }
    return $bucket;
}

function _amPct(int $prev, int $cur): ?float {
    if ($prev === 0) return $cur > 0 ? 100.0 : 0.0;
    return round((($cur - $prev) / $prev) * 100, 1);
}

$A = _amBucket($a, $rules, $categoryIds);
$B = _amBucket($b, $rules, $categoryIds);

// Title diff
$allTitles = array_unique(array_merge(array_keys($A['titles']), array_keys($B['titles'])));
$diff = [];
foreach ($allTitles as $t) {
    $ca = $A['titles'][$t] ?? 0;
    $cb = $B['titles'][$t] ?? 0;
    $meta = $B['title_meta'][$t] ?? $A['title_meta'][$t] ?? ['sample' => $t, 'category' => 'other'];
    $diff[] = [
        'title'      => $t,
        'count_a'    => $ca,
        'count_b'    => $cb,
        'delta'      => $cb - $ca,
        'pct'        => _amPct($ca, $cb),
        'category'   => $meta['category'],
        'sample'     => $meta['sample'],
    ];
}

// Sort helpers
$byDeltaDesc = $diff;
usort($byDeltaDesc, fn($x, $y) => $y['delta'] <=> $x['delta']);

$byDeltaAsc  = $diff;
usort($byDeltaAsc, fn($x, $y) => $x['delta'] <=> $y['delta']);

$newInB = array_values(array_filter($diff, fn($d) => $d['count_a'] === 0 && $d['count_b'] > 0));
usort($newInB, fn($x, $y) => $y['count_b'] <=> $x['count_b']);

$goneInB = array_values(array_filter($diff, fn($d) => $d['count_a'] > 0 && $d['count_b'] === 0));
usort($goneInB, fn($x, $y) => $y['count_a'] <=> $x['count_a']);

// Category deltas
$catDelta = [];
foreach ($categoryIds as $c) {
    $ca = $A['by_category'][$c] ?? 0;
    $cb = $B['by_category'][$c] ?? 0;
    $catDelta[$c] = ['a' => $ca, 'b' => $cb, 'delta' => $cb - $ca, 'pct' => _amPct($ca, $cb)];
}

// Auto-analysis text
$analysis = [];
$analysis[] = sprintf('เทียบ %s (%d) กับ %s (%d)', $a, $A['total'], $b, $B['total']);
$totDelta = $B['total'] - $A['total'];
$analysis[] = sprintf('รวมทั้งเดือน %s %d ตัว (%s%.1f%%)',
    $totDelta >= 0 ? 'เพิ่ม' : 'ลด', abs($totDelta),
    $totDelta >= 0 ? '+' : '', _amPct($A['total'], $B['total']) ?? 0);
foreach (['monitoring','batch','other'] as $c) {
    $d = $catDelta[$c]['delta'];
    if ($d === 0) continue;
    $analysis[] = sprintf('  • %s %s %d ตัว (%s%.1f%%)',
        ucfirst($c), $d > 0 ? 'เพิ่ม' : 'ลด', abs($d),
        $d >= 0 ? '+' : '', $catDelta[$c]['pct'] ?? 0);
}
if (!empty($byDeltaDesc) && $byDeltaDesc[0]['delta'] > 0) {
    $analysis[] = sprintf('พุ่งเยอะสุด: "%s" (+%d)', $byDeltaDesc[0]['title'], $byDeltaDesc[0]['delta']);
}
if (!empty($byDeltaAsc) && $byDeltaAsc[0]['delta'] < 0) {
    $analysis[] = sprintf('ลดลงเยอะสุด: "%s" (%d)', $byDeltaAsc[0]['title'], $byDeltaAsc[0]['delta']);
}

respondOk([
    'a'             => ['month' => $a, 'total' => $A['total'], 'by_category' => $A['by_category'],
                        'by_status' => $A['by_status'], 'by_priority' => $A['by_priority']],
    'b'             => ['month' => $b, 'total' => $B['total'], 'by_category' => $B['by_category'],
                        'by_status' => $B['by_status'], 'by_priority' => $B['by_priority']],
    'delta_total'   => $B['total'] - $A['total'],
    'pct_total'     => _amPct($A['total'], $B['total']),
    'category_delta'=> $catDelta,
    'top_increases' => array_slice($byDeltaDesc, 0, 10),
    'top_decreases' => array_slice($byDeltaAsc,  0, 10),
    'new_in_b'      => array_slice($newInB,  0, 10),
    'gone_in_b'     => array_slice($goneInB, 0, 10),
    'analysis'      => $analysis,
]);
