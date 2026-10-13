<?php
/**
 * Shared monthly email HTML builder.
 * Included by both send-monthly.php and preview-monthly.php.
 *
 * Severity classification (per pod, per daily file):
 *   critical = OOMKilled termination OR memory ratio >= 85%
 *   warning  = memory ratio >= 70%
 *   info     = other restart reason (Error exit, Completed) with no memory pressure
 *
 * severitySummary counts pod-day occurrences, not unique pods.
 */

function rmThaiMonthLabel(int $ts): string
{
    static $months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    return $months[(int)date('n', $ts) - 1] . ' ' . date('Y', $ts);
}

function rmThaiShortDate(int $ts): string
{
    static $abbr = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return date('j', $ts) . ' ' . $abbr[(int)date('n', $ts) - 1] . ' ' . date('Y', $ts);
}

function rmBuildMonthlyEmailHtml(array $s, string $webUrl, bool $compact = false): string
{
    $month      = htmlspecialchars($s['month']);
    $monthLabel = htmlspecialchars(rmThaiMonthLabel(strtotime($s['month'] . '-01')));
    $total      = (int)$s['totalRestarts'];
    $sev        = $s['severitySummary'];
    $delta      = $s['deltaVsPrev']['restartsPct'];
    $prevLabel  = htmlspecialchars($s['previousMonth']['month'] ?? '');
    $prevTotal  = (int)($s['previousMonth']['totalRestarts'] ?? 0);

    // ── Delta text & color ────────────────────────────────────────────────────
    if ($delta === null) {
        $deltaLine  = 'ไม่มีข้อมูลเดือนก่อนหน้าให้เปรียบเทียบ';
        $deltaColor = '#94a3b8';
        $trendWord  = '';
    } elseif ($delta > 0) {
        $deltaLine  = "+{$delta}% เทียบกับ {$prevLabel} ({$prevTotal} restart)";
        $deltaColor = '#dc2626';
        $trendWord  = 'เพิ่มขึ้น';
    } elseif ($delta < 0) {
        $abs        = abs($delta);
        $deltaLine  = "−{$abs}% เทียบกับ {$prevLabel} ({$prevTotal} restart)";
        $deltaColor = '#16a34a';
        $trendWord  = 'ลดลง';
    } else {
        $deltaLine  = "ไม่เปลี่ยนแปลงจาก {$prevLabel} ({$prevTotal} restart)";
        $deltaColor = '#94a3b8';
        $trendWord  = 'คงที่';
    }

    $worst    = $s['worstDay'];
    $worstDate = $worst ? rmThaiShortDate(strtotime($worst['date'])) : '—';
    $worstSub  = $worst ? "{$worst['restarts']} restart · {$worst['critical']} pod ระดับ critical" : '—';

    // ── Executive summary ─────────────────────────────────────────────────────
    $oomCount  = (int)($s['reasonSummary']['OOMKilled'] ?? 0);
    $oomPct    = $total > 0 ? round($oomCount / $total * 100, 1) : 0;
    $critPod   = $sev['critical'];

    if ($total === 0) {
        $execSummary = "ไม่มี pod restart เกิดขึ้นในเดือน {$monthLabel} · cluster มีเสถียรภาพตลอดทั้งเดือน";
    } else {
        $trendSentence = $trendWord ? "ตัวเลขนี้{$trendWord}เมื่อเทียบกับเดือนก่อนหน้า ({$prevLabel})" : '';
        $oomSentence   = $oomCount > 0
            ? "OOMKilled (หน่วยความจำเต็ม) คิดเป็น {$oomPct}% ของ restart ทั้งหมด · พบ memory pressure ใน {$oomCount} เหตุการณ์"
            : "ไม่มีเหตุการณ์ OOMKilled ในเดือนนี้";
        $critSentence  = $critPod > 0
            ? "พบ {$critPod} pod-day ที่ถูกจัดเป็นระดับ critical (OOMKilled หรือ memory ratio ≥ 85%)"
            : "ไม่พบ pod ระดับ critical";
        $execSummary   = "Cluster บันทึก <strong>{$total} เหตุการณ์ pod restart</strong> ครอบคลุม {$s['uniquePods']} pod "
                       . "ใน {$s['uniqueNamespaces']} namespaces ในเดือน {$monthLabel} (ข้อมูล {$s['daysWithData']} วัน) · "
                       . $trendSentence . " · "
                       . $oomSentence . " · "
                       . $critSentence;
    }

    // ── KPI strip ─────────────────────────────────────────────────────────────
    $kpi = "
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0'
           style='border-collapse:collapse;margin-bottom:28px'>
      <tr>
        <td style='padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px 0 0 6px'>
          <div style='font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px'>Restart ทั้งหมด</div>
          <div style='font-size:28px;font-weight:800;color:#0f172a;line-height:1;margin-bottom:6px'>{$total}</div>
          <div style='font-size:11px;color:{$deltaColor};font-weight:500'>{$deltaLine}</div>
        </td>
        <td style='width:8px;background:#e2e8f0'></td>
        <td style='padding:16px 18px;background:" . ($sev['critical'] > 0 ? '#fff5f5' : '#f8fafc') . ";border:1px solid " . ($sev['critical'] > 0 ? '#fecaca' : '#e2e8f0') . ";border-left:0'>
          <div style='font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px'>ระดับ Critical</div>
          <div style='font-size:28px;font-weight:800;color:" . ($sev['critical'] > 0 ? '#dc2626' : '#0f172a') . ";line-height:1;margin-bottom:6px'>{$sev['critical']}</div>
          <div style='font-size:11px;color:#94a3b8'>เหตุการณ์ pod-day</div>
        </td>
        <td style='width:8px;background:#e2e8f0'></td>
        <td style='padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-left:0'>
          <div style='font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px'>Pod ที่ได้รับผลกระทบ</div>
          <div style='font-size:28px;font-weight:800;color:#0f172a;line-height:1;margin-bottom:6px'>{$s['uniquePods']}</div>
          <div style='font-size:11px;color:#94a3b8'>กระจายอยู่ใน {$s['uniqueNamespaces']} namespaces</div>
        </td>
        <td style='width:8px;background:#e2e8f0'></td>
        <td style='padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-left:0;border-radius:0 6px 6px 0'>
          <div style='font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px'>วันที่แย่ที่สุด</div>
          <div style='font-size:16px;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:6px'>{$worstDate}</div>
          <div style='font-size:11px;color:#94a3b8'>{$worstSub}</div>
        </td>
      </tr>
    </table>";

    // ── Daily trend bar chart ─────────────────────────────────────────────────
    $trend    = $s['dailyTrend'];
    $maxDaily = max(1, max(array_map(fn($d) => (int)($d['total'] ?? 0), $trend)));
    $barMaxPx = 64;

    $trendBars = '';
    foreach ($trend as $d) {
        $dayNum = (int)date('j', strtotime($d['date']));
        $crit   = (int)($d['critical'] ?? 0);
        $warn   = (int)($d['warning']  ?? 0);
        $info   = (int)($d['info']     ?? 0);
        $tot    = $crit + $warn + $info;

        $hCrit = $crit > 0 ? max(3, (int)round($crit / $maxDaily * $barMaxPx)) : 0;
        $hWarn = $warn > 0 ? max(3, (int)round($warn / $maxDaily * $barMaxPx)) : 0;
        $hInfo = $info > 0 ? max(3, (int)round($info / $maxDaily * $barMaxPx)) : 0;

        $dayColor  = $crit > 0 ? '#dc2626' : ($warn > 0 ? '#f59e0b' : ($tot > 0 ? '#64748b' : '#cbd5e1'));
        $dayWeight = $crit > 0 ? '700' : '400';

        $bars = '';
        if ($hCrit) $bars .= "<div style='background:#dc2626;height:{$hCrit}px;width:100%'></div>";
        if ($hWarn) $bars .= "<div style='background:#f59e0b;height:{$hWarn}px;width:100%'></div>";
        if ($hInfo) $bars .= "<div style='background:#cbd5e1;height:{$hInfo}px;width:100%'></div>";
        if (!$bars)  $bars  = "<div style='background:#f1f5f9;height:3px;width:100%'></div>";

        $trendBars .= "<td style='vertical-align:bottom;text-align:center;padding:0 1px;min-width:6px'>
          {$bars}
          <div style='font-size:9px;color:{$dayColor};font-weight:{$dayWeight};margin-top:3px'>{$dayNum}</div>
        </td>";
    }

    $trendSection = "
    <div style='margin-bottom:28px'>
      <div style='font-size:11px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px'>แนวโน้ม Restart รายวัน</div>
      <div style='font-size:11px;color:#94a3b8;margin-bottom:10px'>จำนวนเหตุการณ์ pod-day แยกตามความรุนแรงในแต่ละวัน · วันที่มีเหตุการณ์ระดับ critical จะถูกเน้นเป็นสีแดง</div>
      <div style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 14px 10px'>
        <table role='presentation' width='100%' cellpadding='0' cellspacing='0'
               style='border-collapse:collapse'>
          <tr style='vertical-align:bottom;height:{$barMaxPx}px'>{$trendBars}</tr>
        </table>
        <table role='presentation' cellpadding='0' cellspacing='0' style='margin-top:10px;border-collapse:collapse'>
          <tr>
            <td style='padding-right:16px'>
              <span style='display:inline-block;width:10px;height:10px;background:#dc2626;border-radius:2px;vertical-align:middle;margin-right:5px'></span>
              <span style='font-size:11px;color:#64748b'>Critical &nbsp;<strong style='color:#0f172a'>{$sev['critical']}</strong></span>
            </td>
            <td style='padding-right:16px'>
              <span style='display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:2px;vertical-align:middle;margin-right:5px'></span>
              <span style='font-size:11px;color:#64748b'>Warning &nbsp;<strong style='color:#0f172a'>{$sev['warning']}</strong></span>
            </td>
            <td>
              <span style='display:inline-block;width:10px;height:10px;background:#cbd5e1;border-radius:2px;vertical-align:middle;margin-right:5px'></span>
              <span style='font-size:11px;color:#64748b'>Info &nbsp;<strong style='color:#0f172a'>{$sev['info']}</strong></span>
            </td>
          </tr>
        </table>
      </div>
      <div style='font-size:10px;color:#94a3b8;margin-top:6px'>
        Critical = OOMKilled หรือ memory ratio &ge;85%&nbsp;&nbsp;·&nbsp;&nbsp;
        Warning = memory ratio &ge;70%&nbsp;&nbsp;·&nbsp;&nbsp;
        Info = สาเหตุอื่น (Error exit, Completed)
      </div>
    </div>";

    // ── Reason breakdown ──────────────────────────────────────────────────────
    $reasonMeta = [
        'OOMKilled' => ['dot' => '#9333ea', 'desc' => 'Container ใช้หน่วยความจำเกินขีดจำกัด — kernel บังคับ terminate'],
        'Error'     => ['dot' => '#f43f5e', 'desc' => 'Container ออกด้วย exit code ไม่เป็น 0 (crash / exception / signal)'],
        'Completed' => ['dot' => '#22c55e', 'desc' => 'Container ออกตามปกติ (exit 0) — เป็นปกติของ batch job'],
        'Unknown'   => ['dot' => '#94a3b8', 'desc' => 'ไม่สามารถระบุสาเหตุการ terminate ได้'],
    ];

    $reasonRows = '';
    foreach ($s['reasonSummary'] as $r => $c) {
        $pct  = $total > 0 ? round($c / $total * 100, 1) : 0;
        $bar  = $pct;
        $meta = $reasonMeta[$r] ?? $reasonMeta['Unknown'];
        $reasonRows .= "
        <tr>
          <td style='padding:9px 0;border-bottom:1px solid #f1f5f9;width:90px'>
            <span style='display:inline-block;width:8px;height:8px;border-radius:50%;background:{$meta['dot']};margin-right:7px;vertical-align:middle'></span>
            <span style='font-size:12px;font-weight:600;color:#334155'>" . htmlspecialchars($r) . "</span>
          </td>
          <td style='padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b'>" . htmlspecialchars($meta['desc']) . "</td>
          <td style='padding:9px 0 9px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap'>
            <span style='font-size:14px;font-weight:700;color:#0f172a'>{$c}</span>
            <span style='font-size:11px;color:#94a3b8;margin-left:4px'>{$pct}%</span>
          </td>
        </tr>
        <tr>
          <td colspan='3' style='padding:0 0 2px'>
            <div style='background:#f1f5f9;border-radius:2px;height:4px'>
              <div style='background:{$meta['dot']};border-radius:2px;height:4px;width:{$bar}%'></div>
            </div>
          </td>
        </tr>";
    }
    if (!$reasonRows) $reasonRows = "<tr><td colspan='3' style='padding:12px;color:#94a3b8;font-size:12px;text-align:center'>ไม่มีข้อมูล restart ในเดือนนี้</td></tr>";

    // ── Top namespaces ────────────────────────────────────────────────────────
    $maxNs  = $s['topNamespaces'][0]['restarts'] ?? 1;
    $nsRows = '';
    $nsRank = 1;
    foreach ($s['topNamespaces'] as $ns) {
        $bar     = $maxNs > 0 ? round($ns['restarts'] / $maxNs * 100) : 0;
        $nsClean = preg_replace('/^truemoney-/', '', $ns['namespace']);
        $nsRows .= "
        <tr>
          <td style='padding:9px 0;border-bottom:1px solid #f1f5f9;vertical-align:top'>
            <div style='display:inline-block;width:18px;height:18px;border-radius:50%;background:#e2e8f0;text-align:center;line-height:18px;font-size:9px;font-weight:700;color:#64748b;margin-right:8px;vertical-align:middle'>{$nsRank}</div>
            <span style='font-size:12px;color:#334155'>" . htmlspecialchars($nsClean) . "</span>
          </td>
          <td style='padding:9px 0 9px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;vertical-align:middle'>
            <span style='font-size:14px;font-weight:700;color:#0f172a'>{$ns['restarts']}</span>
          </td>
        </tr>
        <tr>
          <td colspan='2' style='padding:0 0 2px'>
            <div style='background:#f1f5f9;border-radius:2px;height:4px'>
              <div style='background:#3b82f6;border-radius:2px;height:4px;width:{$bar}%'></div>
            </div>
          </td>
        </tr>";
        $nsRank++;
    }
    if (!$nsRows) $nsRows = "<tr><td colspan='2' style='padding:12px;color:#94a3b8;font-size:12px;text-align:center'>ไม่มีข้อมูล</td></tr>";

    // ── Two-column section ────────────────────────────────────────────────────
    $twoCol = "
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0'
           style='border-collapse:collapse;margin-bottom:28px'>
      <tr>
        <td style='vertical-align:top;width:50%;padding-right:20px'>
          <div style='font-size:11px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px'>แยกตามสาเหตุการ Restart</div>
          <div style='font-size:11px;color:#94a3b8;margin-bottom:10px'>การจำแนกสาเหตุของ restart ทั้ง {$total} เหตุการณ์ในเดือนนี้</div>
          <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse'>
            {$reasonRows}
          </table>
        </td>
        <td style='vertical-align:top;width:50%;padding-left:20px;border-left:1px solid #e2e8f0'>
          <div style='font-size:11px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px'>Namespace ที่ Restart มากที่สุด</div>
          <div style='font-size:11px;color:#94a3b8;margin-bottom:10px'>จำนวน restart รวมต่อ namespace (5 อันดับแรก)</div>
          <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse'>
            {$nsRows}
          </table>
        </td>
      </tr>
    </table>";

    // ── Top offenders table ───────────────────────────────────────────────────
    $badgeMap = [
        'OOMKilled' => ['bg' => '#f3e8ff', 'fg' => '#7e22ce'],
        'Error'     => ['bg' => '#ffe4e6', 'fg' => '#be123c'],
        'Completed' => ['bg' => '#dcfce7', 'fg' => '#15803d'],
        'Unknown'   => ['bg' => '#f1f5f9', 'fg' => '#475569'],
    ];

    $podRows = '';
    foreach ($s['topPods'] as $rank => $p) {
        $badge   = $badgeMap[$p['dominant']] ?? $badgeMap['Unknown'];
        $nsClean = htmlspecialchars(preg_replace('/^truemoney-/', '', $p['namespace']));
        $critDays = (int)($p['critical'] ?? 0);
        $critCell = $critDays > 0
            ? "<span style='color:#dc2626;font-weight:600'>{$critDays}</span>"
            : "<span style='color:#cbd5e1'>0</span>";
        $podRows .= "
        <tr style='background:" . ($rank % 2 === 0 ? '#ffffff' : '#fafafa') . "'>
          <td style='padding:9px 10px;font-size:10px;font-weight:700;color:#94a3b8;text-align:center;border-bottom:1px solid #f1f5f9;width:28px'>" . ($rank + 1) . "</td>
          <td style='padding:9px 10px;font-family:monospace;font-size:11px;color:#1e293b;border-bottom:1px solid #f1f5f9;word-break:break-all'>"
              . htmlspecialchars($p['pod']) . "</td>
          <td style='padding:9px 10px;font-size:11px;color:#64748b;border-bottom:1px solid #f1f5f9;white-space:nowrap'>{$nsClean}</td>
          <td style='padding:9px 10px;font-size:14px;font-weight:700;color:#0f172a;text-align:right;border-bottom:1px solid #f1f5f9;white-space:nowrap'>{$p['restarts']}</td>
          <td style='padding:9px 10px;text-align:center;border-bottom:1px solid #f1f5f9'>{$critCell}</td>
          <td style='padding:9px 10px;text-align:center;border-bottom:1px solid #f1f5f9'>
            <span style='display:inline-block;padding:2px 8px;border-radius:4px;background:{$badge['bg']};color:{$badge['fg']};font-size:10px;font-weight:600;white-space:nowrap'>"
                . htmlspecialchars($p['dominant']) . "</span>
          </td>
        </tr>";
    }
    if (!$podRows) $podRows = "<tr><td colspan='6' style='padding:16px;color:#94a3b8;font-size:12px;text-align:center'>ไม่มีข้อมูล pod restart ในเดือนนี้</td></tr>";

    $podTable = "
    <div style='margin-bottom:28px'>
      <div style='font-size:11px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px'>Service ที่ Restart มากที่สุด 10 อันดับ</div>
      <div style='font-size:11px;color:#94a3b8;margin-bottom:10px'>Service ที่มี restart มากที่สุด · &ldquo;วัน Critical&rdquo; = จำนวนวันที่ถูกจัดเป็นระดับ critical</div>
      <table role='presentation' width='100%' cellpadding='0' cellspacing='0'
             style='border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden'>
        <thead>
          <tr style='background:#f8fafc'>
            <th style='padding:9px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;border-bottom:1px solid #e2e8f0;text-align:center'>#</th>
            <th style='padding:9px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;border-bottom:1px solid #e2e8f0;text-align:left'>Service (Pod)</th>
            <th style='padding:9px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;border-bottom:1px solid #e2e8f0;text-align:left'>Namespace</th>
            <th style='padding:9px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;border-bottom:1px solid #e2e8f0;text-align:right'>Restart</th>
            <th style='padding:9px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;border-bottom:1px solid #e2e8f0;text-align:center'>วัน Critical</th>
            <th style='padding:9px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;border-bottom:1px solid #e2e8f0;text-align:center'>สาเหตุหลัก</th>
          </tr>
        </thead>
        <tbody>{$podRows}</tbody>
      </table>
    </div>";

    // ── OOMKilled alert box ───────────────────────────────────────────────────
    $oomBox = '';
    if ($oomCount > 0) {
        $oomPods = array_filter($s['topPods'], fn($p) => $p['dominant'] === 'OOMKilled');
        $oomList = '';
        foreach (array_slice($oomPods, 0, 5) as $p) {
            $nsClean  = htmlspecialchars(preg_replace('/^truemoney-/', '', $p['namespace']));
            $oomList .= "<li style='margin-bottom:4px;font-size:12px;color:#1e293b'>"
                      . "<span style='font-family:monospace'>" . htmlspecialchars($p['pod']) . "</span>"
                      . " <span style='color:#94a3b8'>({$nsClean})</span>"
                      . " — <strong>{$p['restarts']}</strong> restart</li>";
        }
        $moreNote = count($oomPods) > 5
            ? "<li style='font-size:11px;color:#94a3b8;list-style:none'>… และอีก " . (count($oomPods) - 5) . " รายการ</li>"
            : '';
        $oomBox = "
        <div style='margin-bottom:28px;background:#fdf4ff;border:1px solid #e9d5ff;border-left:4px solid #9333ea;border-radius:0 6px 6px 0;padding:14px 16px'>
          <div style='font-size:11px;font-weight:700;color:#7e22ce;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px'>แจ้งเตือน Memory Pressure — Service ที่ OOMKilled</div>
          <div style='font-size:12px;color:#6b21a8;margin-bottom:10px'>
            พบ {$oomCount} เหตุการณ์ restart ในเดือนนี้ที่เกิดจาก OOMKilled · Service เหล่านี้ใช้ memory ใกล้หรือเกินขีดจำกัดที่กำหนดไว้ ควรได้รับการตรวจสอบ
          </div>
          <ul style='margin:0;padding-left:16px'>{$oomList}{$moreNote}</ul>
        </div>";
    }

    // ── Methodology note ──────────────────────────────────────────────────────
    $methodNote = "
    <div style='margin-bottom:24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px'>
      <div style='font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px'>เกี่ยวกับรายงานนี้</div>
      <table role='presentation' cellpadding='0' cellspacing='0' style='border-collapse:collapse;width:100%'>
        <tr>
          <td style='padding-bottom:4px;vertical-align:top;width:50%'>
            <span style='font-size:11px;font-weight:600;color:#334155'>แหล่งข้อมูล:</span>
            <span style='font-size:11px;color:#64748b'> JSON snapshot รายวัน · cluster acm-tmn-eks-prod</span>
          </td>
          <td style='padding-bottom:4px;vertical-align:top;width:50%'>
            <span style='font-size:11px;font-weight:600;color:#334155'>ช่วง Scan:</span>
            <span style='font-size:11px;color:#64748b'> 24 ชั่วโมง · ดึงข้อมูลทุกวันเวลา 09:00 ICT</span>
          </td>
        </tr>
        <tr>
          <td style='padding-bottom:4px;vertical-align:top'>
            <span style='font-size:11px;font-weight:600;color:#334155'>ระดับ Critical:</span>
            <span style='font-size:11px;color:#64748b'> OOMKilled หรือ memory ratio &ge;85%</span>
          </td>
          <td style='padding-bottom:4px;vertical-align:top'>
            <span style='font-size:11px;font-weight:600;color:#334155'>ระดับ Warning:</span>
            <span style='font-size:11px;color:#64748b'> Memory ratio &ge;70% (ต่ำกว่าเกณฑ์ OOM)</span>
          </td>
        </tr>
        <tr>
          <td style='vertical-align:top'>
            <span style='font-size:11px;font-weight:600;color:#334155'>ระดับ Info:</span>
            <span style='font-size:11px;color:#64748b'> Error exit หรือ Completed · ไม่พบ memory pressure</span>
          </td>
          <td style='vertical-align:top'>
            <span style='font-size:11px;font-weight:600;color:#334155'>การนับ Severity:</span>
            <span style='font-size:11px;color:#64748b'> นับเป็น pod-day ไม่ใช่จำนวน pod ที่ไม่ซ้ำ</span>
          </td>
        </tr>
      </table>
    </div>";

    // ── CTA + footer ──────────────────────────────────────────────────────────
    // CTA points to the public read-only report page so recipients without an
    // SOM account can view it. Runway is included so the link lands on this
    // specific runway's view.
    $runwayQ     = urlencode($s['runway'] ?? '');
    $ctaUrl      = htmlspecialchars($webUrl) . '?month=' . $month . ($runwayQ !== '' ? "&runway={$runwayQ}" : '');
    $generatedAt = rmThaiShortDate(time()) . ', ' . date('H:i') . ' ICT';

    $runwayName = htmlspecialchars($s['runway']  ?? 'EKS TMN');
    $cluster    = htmlspecialchars($s['cluster'] ?? 'acm-tmn-eks-prod');

    // ── Pieces that are skipped in compact mode (used inside combined emails) ──
    // Combined mode already has glossary + single overview/footer/CTA at the top.
    // We strip the per-runway preheader + <h2> + cluster line + separator entirely
    // because Gmail interprets that pattern as 'a new email starting' and collapses
    // the section as quoted text. The wrapping div in $sections shows the runway
    // identity instead (รายละเอียด · NAME · Cluster X).
    $headerBlock = $compact ? '' : "
      <p style='margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.09em'>Service Monitoring Center &middot; รายงานรายเดือน</p>
      <h2 style='margin:0 0 4px;font-size:22px;font-weight:800;color:#0f172a'>Pod Restarts ของ {$runwayName} &mdash; {$monthLabel}</h2>
      <p style='margin:0 0 4px;font-size:12px;color:#64748b'>
        Cluster <code style='font-family:monospace;background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:11px'>{$cluster}</code>
        &nbsp;&middot;&nbsp; ข้อมูล {$s['daysWithData']} วัน
      </p>

      <div style='height:1px;background:#e2e8f0;margin:16px 0 20px'></div>";
    $execBlock   = $compact ? '' : "
      <p style='margin:0 0 24px;font-size:13px;color:#334155;line-height:1.7;background:#f0f9ff;border-left:3px solid #0ea5e9;padding:12px 14px;border-radius:0 6px 6px 0'>
        {$execSummary}
      </p>";
    $methodBlock = $compact ? '' : $methodNote;
    $ctaFooter   = $compact ? '' : "
      <table role='presentation' cellpadding='0' cellspacing='0' style='margin-bottom:24px;border-collapse:collapse'>
        <tr>
          <td style='border-radius:6px;background:#1d4ed8;padding:0'>
            <a href='{$ctaUrl}'
               style='display:inline-block;padding:12px 24px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;border-radius:6px;letter-spacing:.02em'>
              เปิด Dashboard
            </a>
          </td>
        </tr>
      </table>

      <div style='height:1px;background:#e2e8f0;margin-bottom:16px'></div>
      <p style='margin:0;font-size:10px;color:#cbd5e1;line-height:1.8'>
        สร้างเมื่อ {$generatedAt} &nbsp;&middot;&nbsp; Centralize-SOM &nbsp;&middot;&nbsp; {$runwayName} Restart Monitor<br>
        รายงานนี้สร้างขึ้นอัตโนมัติ · กรุณาอย่าตอบกลับอีเมลฉบับนี้
      </p>";

    // Compact mode trims pieces that are most likely to push the combined email
    // past Gmail's 102KB clip threshold or trigger its content-collapse heuristics.
    // We keep KPI + Daily trend chart + Top 10 pods per runway (the most useful
    // bits) and drop the OOMKilled detail box + reason/namespace breakdown
    // (those are still available in the dashboard via the CTA at the bottom).
    $oomBoxBlock   = $compact ? '' : $oomBox;
    $trendBlock    = $trendSection;
    $twoColBlock   = $compact ? '' : $twoCol;

    return "
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.65;color:#1e293b'>
    <tr><td>

      {$headerBlock}
      {$execBlock}

      {$kpi}
      {$oomBoxBlock}
      {$trendBlock}
      {$twoColBlock}
      {$podTable}
      {$methodBlock}
      {$ctaFooter}

    </td></tr>
    </table>";
}

/**
 * Build a COMBINED monthly email HTML covering multiple runways in one message.
 *
 * @param array  $summaries  [ 'EKS TMN' => $tmnSummary, 'EKS NANO' => $nanoSummary, ... ]
 *                          Each summary must already include previousMonth + deltaVsPrev + runway + cluster.
 * @param string $month      'YYYY-MM' (used for the report title)
 * @param string $webUrl     Dashboard link for CTA at the very end
 */
function rmBuildCombinedMonthlyEmailHtml(array $summaries, string $month, string $webUrl): string
{
    $monthLabel = htmlspecialchars(rmThaiMonthLabel(strtotime($month . '-01')));

    // ── Grand totals + overview comparison table ──────────────────────────────
    $grandTotal      = 0;
    $grandCritical   = 0;
    $grandWarning    = 0;
    $grandDays       = 0;
    $worstRunway     = null;
    $worstRunwayVal  = -1;

    $rows = '';
    foreach ($summaries as $name => $s) {
        $rTotal = (int)($s['totalRestarts'] ?? 0);
        $rCrit  = (int)($s['severitySummary']['critical'] ?? 0);
        $rWarn  = (int)($s['severitySummary']['warning']  ?? 0);
        $rDays  = (int)($s['daysWithData'] ?? 0);
        $delta  = $s['deltaVsPrev']['restartsPct'] ?? null;

        $grandTotal    += $rTotal;
        $grandCritical += $rCrit;
        $grandWarning  += $rWarn;
        $grandDays     += $rDays;

        if ($rTotal > $worstRunwayVal) { $worstRunwayVal = $rTotal; $worstRunway = $name; }

        // Delta cell
        if ($delta === null) {
            $deltaCell = "<span style='color:#94a3b8'>&mdash;</span>";
        } elseif ($delta > 0) {
            $deltaCell = "<span style='color:#dc2626;font-weight:600'>&uarr; +{$delta}%</span>";
        } elseif ($delta < 0) {
            $abs = abs($delta);
            $deltaCell = "<span style='color:#16a34a;font-weight:600'>&darr; &minus;{$abs}%</span>";
        } else {
            $deltaCell = "<span style='color:#94a3b8'>0%</span>";
        }

        $critCell = $rCrit > 0 ? "<span style='color:#dc2626;font-weight:700'>{$rCrit}</span>" : "<span style='color:#94a3b8'>0</span>";
        $warnCell = $rWarn > 0 ? "<span style='color:#d97706;font-weight:700'>{$rWarn}</span>" : "<span style='color:#94a3b8'>0</span>";

        $rows .= "<tr>
            <td style='padding:11px 14px;font-weight:600;color:#0f172a'>" . htmlspecialchars($name) . "</td>
            <td style='padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums'><b>{$rTotal}</b></td>
            <td style='padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums'>{$critCell}</td>
            <td style='padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums'>{$warnCell}</td>
            <td style='padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums'>{$rDays}</td>
            <td style='padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums'>{$deltaCell}</td>
        </tr>";
    }

    $generatedAt = rmThaiShortDate(time()) . ', ' . date('H:i') . ' ICT';
    // Combined CTA → public read-only page, all-runways view
    $ctaUrl      = htmlspecialchars($webUrl) . '?month=' . htmlspecialchars($month) . '&runway=all';

    // Top overview HTML
    $overview = "
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.65;color:#1e293b'>
    <tr><td>

      <p style='margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.09em'>Service Monitoring Center &middot; รายงานรายเดือน</p>
      <h2 style='margin:0 0 4px;font-size:22px;font-weight:800;color:#0f172a'>ทุก Runway &mdash; {$monthLabel}</h2>
      <p style='margin:0 0 18px;font-size:12px;color:#64748b'>
        รวมข้อมูลจาก " . count($summaries) . " runway &nbsp;&middot;&nbsp; {$grandTotal} restart ทั้งหมด &nbsp;&middot;&nbsp; {$grandCritical} critical
      </p>

      <!-- ── Glossary: what severity + termination reasons mean ── -->
      <p style='margin:18px 0 6px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em'>วิธีอ่านรายงานนี้</p>
      <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:12px;margin-bottom:20px'>
        <tr>
          <td style='padding:10px 14px;border-right:1px solid #e2e8f0;vertical-align:top;width:50%'>
            <p style='margin:0 0 6px;font-size:11px;font-weight:700;color:#475569;letter-spacing:.04em;text-transform:uppercase'>ระดับความรุนแรง (จาก service-severity.json)</p>
            <p style='margin:4px 0;font-size:11.5px;line-height:1.55;color:#475569'>
              <span style='display:inline-block;width:7px;height:7px;border-radius:50%;background:#dc2626;margin-right:6px;vertical-align:middle'></span>
              <b style='color:#0f172a'>Critical</b> — Service ที่ priority P1
            </p>
            <p style='margin:4px 0;font-size:11.5px;line-height:1.55;color:#475569'>
              <span style='display:inline-block;width:7px;height:7px;border-radius:50%;background:#d97706;margin-right:6px;vertical-align:middle'></span>
              <b style='color:#0f172a'>Warning</b> — Service ที่ priority P2
            </p>
            <p style='margin:4px 0;font-size:11.5px;line-height:1.55;color:#475569'>
              <span style='display:inline-block;width:7px;height:7px;border-radius:50%;background:#94a3b8;margin-right:6px;vertical-align:middle'></span>
              <b style='color:#0f172a'>Info</b> — Service ที่ priority P3 หรือไม่อยู่ใน registry
            </p>
          </td>
          <td style='padding:10px 14px;vertical-align:top;width:50%'>
            <p style='margin:0 0 6px;font-size:11px;font-weight:700;color:#475569;letter-spacing:.04em;text-transform:uppercase'>สาเหตุการ Terminate (จาก Kubernetes)</p>
            <p style='margin:4px 0;font-size:11.5px;line-height:1.55;color:#475569'>
              <b style='color:#9333ea'>OOMKilled</b> — Container ใช้ memory เกินขีดจำกัด · kernel kill
            </p>
            <p style='margin:4px 0;font-size:11.5px;line-height:1.55;color:#475569'>
              <b style='color:#dc2626'>Error</b> — Container ออกด้วย exit code ไม่เป็น 0 (crash / exception)
            </p>
            <p style='margin:4px 0;font-size:11.5px;line-height:1.55;color:#475569'>
              <b style='color:#16a34a'>Completed</b> — Container ออกตามปกติ (exit 0) · เป็นปกติของ batch / CronJob
            </p>
            <p style='margin:4px 0;font-size:11.5px;line-height:1.55;color:#475569'>
              <b style='color:#64748b'>Unknown</b> — ไม่สามารถระบุสาเหตุการ terminate ได้
            </p>
          </td>
        </tr>
      </table>

      <!-- ── Overview comparison table ── -->
      <p style='margin:18px 0 6px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em'>ภาพรวม</p>
      <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;margin-bottom:24px'>
        <thead>
          <tr style='background:#f8fafc'>
            <th style='padding:9px 14px;text-align:left;font-weight:600;color:#64748b;font-size:11px;letter-spacing:.04em;text-transform:uppercase'>Runway</th>
            <th style='padding:9px 14px;text-align:right;font-weight:600;color:#64748b;font-size:11px;letter-spacing:.04em;text-transform:uppercase'>Restart</th>
            <th style='padding:9px 14px;text-align:right;font-weight:600;color:#64748b;font-size:11px;letter-spacing:.04em;text-transform:uppercase'>Critical</th>
            <th style='padding:9px 14px;text-align:right;font-weight:600;color:#64748b;font-size:11px;letter-spacing:.04em;text-transform:uppercase'>Warning</th>
            <th style='padding:9px 14px;text-align:right;font-weight:600;color:#64748b;font-size:11px;letter-spacing:.04em;text-transform:uppercase'>วัน</th>
            <th style='padding:9px 14px;text-align:right;font-weight:600;color:#64748b;font-size:11px;letter-spacing:.04em;text-transform:uppercase'>เทียบเดือนก่อน</th>
          </tr>
        </thead>
        <tbody>{$rows}</tbody>
        <tfoot>
          <tr style='background:#f8fafc;font-weight:700;border-top:2px solid #e2e8f0'>
            <td style='padding:11px 14px;color:#0f172a'>รวม</td>
            <td style='padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums'>{$grandTotal}</td>
            <td style='padding:11px 14px;text-align:right;color:" . ($grandCritical > 0 ? '#dc2626' : '#94a3b8') . "'>{$grandCritical}</td>
            <td style='padding:11px 14px;text-align:right;color:" . ($grandWarning > 0 ? '#d97706' : '#94a3b8') . "'>{$grandWarning}</td>
            <td style='padding:11px 14px;text-align:right;font-variant-numeric:tabular-nums'>{$grandDays}</td>
            <td style='padding:11px 14px;text-align:right;color:#94a3b8'>&mdash;</td>
          </tr>
        </tfoot>
      </table>
    </td></tr>
    </table>";

    // ── Per-runway sections ────────────────────────────────────────────────────
    // Use compact=true: skip preheader/title/cluster/exec/methodology/CTA/footer.
    // Combined email already has glossary + overview + single footer/CTA.
    // Runway identity is shown via the wrapping div's section header below.
    $sections = '';
    foreach ($summaries as $name => $s) {
        $rwCluster = htmlspecialchars($s['cluster'] ?? '');
        $clusterChip = $rwCluster !== ''
            ? " <span style='color:#cbd5e1;font-weight:400;letter-spacing:.04em;text-transform:none'>&middot; Cluster <code style='font-family:monospace;background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:10px;color:#475569'>{$rwCluster}</code></span>"
            : '';
        $sections .= "
        <div style='margin-top:32px;padding-top:8px;border-top:3px solid #e2e8f0'>
          <p style='margin:0 0 14px;font-size:11px;font-weight:700;color:#0f172a;letter-spacing:.12em;text-transform:uppercase'>รายละเอียด &middot; " . htmlspecialchars($name) . "{$clusterChip}</p>
          " . rmBuildMonthlyEmailHtml($s, $webUrl, true) . "
        </div>";
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    $footer = "
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Helvetica,Arial,sans-serif;margin-top:32px'>
    <tr><td style='padding:18px 0;text-align:center;border-top:1px solid #e2e8f0'>
      <a href='{$ctaUrl}' style='display:inline-block;padding:11px 24px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:7px;font-size:13px;font-weight:600;letter-spacing:-.005em'>
        เปิด Dashboard &rarr;
      </a>
      <p style='margin:14px 0 0;font-size:10px;color:#94a3b8;line-height:1.8'>
        สร้างเมื่อ {$generatedAt} &nbsp;&middot;&nbsp; Centralize-SOM &nbsp;&middot;&nbsp; รายงานรายเดือน (รวมทุก runway)
      </p>
    </td></tr>
    </table>";

    return $overview . $sections . $footer;
}

function hexAlpha(string $hex, float $a): string
{
    $n = hexdec(substr($hex, 1));
    $r = ($n >> 16) & 255;
    $g = ($n >> 8) & 255;
    $b = $n & 255;
    return "rgba({$r},{$g},{$b},{$a})";
}
