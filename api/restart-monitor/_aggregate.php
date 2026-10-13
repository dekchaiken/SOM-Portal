<?php
/**
 * Shared monthly aggregation helpers.
 * Used by monthly.php (endpoint) and send-monthly.php (email).
 */

function rmEmptyMonthlySummary(string $month): array {
    return [
        'month'           => $month,
        'totalRestarts'   => 0,
        'daysWithData'    => 0,
        'uniquePods'      => 0,
        'uniqueNamespaces'=> 0,
        'worstDay'        => null,
        'severitySummary' => ['critical' => 0, 'warning' => 0, 'info' => 0],
        'reasonSummary'   => [],
        'dailyTrend'      => [],
        'topNamespaces'   => [],
        'topPods'         => [],
    ];
}

function rmAggregateMonth(string $dailyDir, string $month, bool $lite = false): array {
    $files = glob($dailyDir . $month . '-*.json') ?: [];
    if (!$files) return rmEmptyMonthlySummary($month);

    $totalRestarts = 0;
    $sevSummary    = ['critical' => 0, 'warning' => 0, 'info' => 0];
    $reasonSummary = [];
    $dailyTrend    = [];
    $nsAgg         = [];
    $podAgg        = [];
    $worstDay      = null;
    $worstRestarts = -1;

    foreach ($files as $file) {
        $base = basename($file, '.json');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $base)) continue;
        $data = json_decode(file_get_contents($file), true);
        if (!is_array($data)) continue;

        $tr  = (int)($data['totalRestarts'] ?? 0);
        $sev = $data['severitySummary'] ?? [];
        $rea = $data['reasonSummary']   ?? [];

        $totalRestarts += $tr;
        foreach (['critical','warning','info'] as $k) {
            $sevSummary[$k] += (int)($sev[$k] ?? 0);
        }
        foreach ($rea as $k => $v) {
            $reasonSummary[$k] = ($reasonSummary[$k] ?? 0) + (int)$v;
        }

        $dailyTrend[] = [
            'date'     => $base,
            'critical' => (int)($sev['critical'] ?? 0),
            'warning'  => (int)($sev['warning']  ?? 0),
            'info'     => (int)($sev['info']     ?? 0),
            'total'    => $tr,
        ];

        if ($tr > $worstRestarts) {
            $worstRestarts = $tr;
            $worstDay      = ['date' => $base, 'restarts' => $tr, 'critical' => (int)($sev['critical'] ?? 0)];
        }

        if ($lite) continue;

        foreach (($data['pods'] ?? []) as $p) {
            $ns      = $p['namespace'] ?? 'unknown';
            $podName = $p['pod']       ?? '?';
            $reason  = $p['terminationReason'] ?? 'Unknown';
            $rc      = (int)($p['restartCount'] ?? 0);
            $sevP    = $p['severity']  ?? 'info';

            $nsAgg[$ns] = ($nsAgg[$ns] ?? 0) + $rc;

            $key = $podName . '|' . $ns;
            if (!isset($podAgg[$key])) {
                $podAgg[$key] = [
                    'pod'        => $podName,
                    'namespace'  => $ns,
                    'restarts'   => 0,
                    'days'       => 0,
                    'critical'   => 0,
                    'reasonHist' => [],
                ];
            }
            $podAgg[$key]['restarts'] += $rc;
            $podAgg[$key]['days']     += 1;
            if ($sevP === 'critical') $podAgg[$key]['critical'] += 1;
            $podAgg[$key]['reasonHist'][$reason] = ($podAgg[$key]['reasonHist'][$reason] ?? 0) + 1;
        }
    }

    usort($dailyTrend, fn($a, $b) => strcmp($a['date'], $b['date']));
    arsort($reasonSummary);

    arsort($nsAgg);
    $topNamespaces = [];
    foreach (array_slice($nsAgg, 0, 5, true) as $ns => $cnt) {
        $topNamespaces[] = ['namespace' => $ns, 'restarts' => $cnt];
    }

    // Collapse replica-set hash suffix (e.g. -c486c67bb-6zdsl → "")
    $podGrouped = [];
    foreach ($podAgg as $p) {
        $shortName = preg_replace('/-[a-f0-9]{6,10}(-[a-z0-9]{5})?$/', '', $p['pod']) ?: $p['pod'];
        $gk = $shortName . '|' . $p['namespace'];
        if (!isset($podGrouped[$gk])) {
            $podGrouped[$gk] = [
                'pod'        => $shortName,
                'namespace'  => $p['namespace'],
                'restarts'   => 0,
                'days'       => 0,
                'critical'   => 0,
                'reasonHist' => [],
            ];
        }
        $podGrouped[$gk]['restarts'] += $p['restarts'];
        $podGrouped[$gk]['days']     += $p['days'];
        $podGrouped[$gk]['critical'] += $p['critical'];
        foreach ($p['reasonHist'] as $r => $c) {
            $podGrouped[$gk]['reasonHist'][$r] = ($podGrouped[$gk]['reasonHist'][$r] ?? 0) + $c;
        }
    }
    usort($podGrouped, fn($a, $b) => $b['restarts'] - $a['restarts']);
    $topPods = [];
    foreach (array_slice($podGrouped, 0, 10) as $p) {
        arsort($p['reasonHist']);
        $dominant = array_key_first($p['reasonHist']) ?: 'Unknown';
        $topPods[] = [
            'pod'        => $p['pod'],
            'namespace'  => $p['namespace'],
            'restarts'   => $p['restarts'],
            'critical'   => $p['critical'],
            'dominant'   => $dominant,
        ];
    }

    return [
        'month'           => $month,
        'totalRestarts'   => $totalRestarts,
        'daysWithData'    => count($dailyTrend),
        'uniquePods'      => count($podAgg),
        'uniqueNamespaces'=> count($nsAgg),
        'worstDay'        => $worstDay,
        'severitySummary' => $sevSummary,
        'reasonSummary'   => $reasonSummary,
        'dailyTrend'      => $dailyTrend,
        'topNamespaces'   => $topNamespaces,
        'topPods'         => $topPods,
    ];
}

function rmPrevMonth(string $month): string {
    [$y, $m] = array_map('intval', explode('-', $month));
    if ($m === 1) { $y--; $m = 12; } else { $m--; }
    return sprintf('%04d-%02d', $y, $m);
}
