<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$action = $_GET['action'] ?? 'list';

// ── Resolve enabled runways from grafana-runways.json ────────────────────────
function _allRunways(): array {
    $d = readJson('grafana-runways.json');
    return $d['runways'] ?? [];
}
function _slugForRunway(string $name): string {
    foreach (_allRunways() as $rw) {
        if (($rw['name'] ?? '') === $name) return $rw['slug'] ?? '';
    }
    return '';
}

$wantRunway = trim((string)($_GET['runway'] ?? ''));
$runwaySlug = $wantRunway ? _slugForRunway($wantRunway) : '';
if ($wantRunway && !$runwaySlug) {
    respondError("Unknown runway '{$wantRunway}'", 400);
}

// Helper: enumerate runway directories to scan
function _runwayDirs(string $base, string $singleSlug = ''): array {
    if ($singleSlug !== '') return [$singleSlug => $base . $singleSlug . '/'];
    // All runways
    $out = [];
    foreach (_allRunways() as $rw) {
        $slug = $rw['slug'] ?? '';
        if (!$slug) continue;
        $out[$slug] = $base . $slug . '/';
    }
    return $out;
}

// Helper: pick file across runway dirs by date (used by detail/raw-detail when caller omits runway)
function _findFileByDate(string $base, string $date): array {
    foreach (_runwayDirs($base) as $slug => $dir) {
        $f = $dir . $date . '.json';
        if (file_exists($f)) return [$slug, $f];
    }
    return ['', ''];
}

// ── action=runways ────────────────────────────────────────────────────────
// Lightweight list of runway names for RestartFetchScheduler in noti-scheduler.js.
// The scheduler needs to know every runway up-front so it can fire N parallel
// per-runway POSTs to fetch.php — using the full list response would drag in
// filesystem scans and is overkill for a 3-item list.
if ($action === 'runways') {
    $out = [];
    foreach (_allRunways() as $rw) {
        $out[] = ['name' => $rw['name'] ?? '', 'slug' => $rw['slug'] ?? ''];
    }
    respondOk(['runways' => $out]);
}

// ── action=raw-list[&runway=...] ──────────────────────────────────────────────
if ($action === 'raw-list') {
    $base = teamDataPath('grafana-monitoring/raw/');
    $today = new DateTime('today', new DateTimeZone('Asia/Bangkok'));

    $byRunway = [];
    foreach (_runwayDirs($base, $runwaySlug) as $slug => $dir) {
        if (!is_dir($dir)) { $byRunway[$slug] = ['reports' => [], 'totals' => ['totalDays'=>0,'totalPods7d'=>0,'totalRestarts7d'=>0,'totalOOMKilled30d'=>0]]; continue; }
        $reports = [];
        foreach (glob($dir . '*.json') ?: [] as $file) {
            $filename = basename($file, '.json');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $filename)) continue;
            $d = json_decode(file_get_contents($file), true);
            if (!$d) continue;
            $reports[] = [
                'date'          => $filename,
                'runway'        => $d['runway']        ?? '',
                'generatedAt'   => $d['generatedAt']   ?? null,
                'totalPods'     => $d['totalPods']     ?? 0,
                'totalRestarts' => $d['totalRestarts'] ?? 0,
                'reasonSummary' => $d['reasonSummary'] ?? [],
                'severitySummary' => $d['severitySummary'] ?? ['critical'=>0,'warning'=>0,'info'=>0],
            ];
        }
        usort($reports, fn($a, $b) => strcmp($b['date'], $a['date']));

        $totals = ['totalDays' => count($reports), 'totalPods7d' => 0, 'totalRestarts7d' => 0, 'totalCritical7d' => 0, 'totalOOMKilled30d' => 0];
        foreach ($reports as $r) {
            try {
                $daysAgo = (int)$today->diff(new DateTime($r['date'], new DateTimeZone('Asia/Bangkok')))->format('%a');
                if ($daysAgo <= 7) {
                    $totals['totalPods7d']     += $r['totalPods'];
                    $totals['totalRestarts7d'] += $r['totalRestarts'];
                    $totals['totalCritical7d'] += ($r['severitySummary']['critical'] ?? 0);
                }
                if ($daysAgo <= 30) { $totals['totalOOMKilled30d'] += ($r['reasonSummary']['OOMKilled'] ?? 0); }
            } catch (Exception $e) { continue; }
        }
        $byRunway[$slug] = ['reports' => $reports, 'totals' => $totals];
    }

    // Backward-compat single-runway response when ?runway=... given
    if ($runwaySlug) {
        respondOk($byRunway[$runwaySlug]);
    }
    respondOk(['byRunway' => $byRunway]);
}

// ── action=raw-detail&date=YYYY-MM-DD[&runway=...] ───────────────────────────
if ($action === 'raw-detail') {
    $date = $_GET['date'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('Invalid date format. Use YYYY-MM-DD', 400);
    $base = teamDataPath('grafana-monitoring/raw/');
    if ($runwaySlug) {
        $f = $base . $runwaySlug . '/' . $date . '.json';
    } else {
        [, $f] = _findFileByDate($base, $date);
    }
    if (!$f || !file_exists($f)) respondError('Raw report not found for ' . $date, 404);
    $data = json_decode(file_get_contents($f), true);
    if (!$data) respondError('Failed to parse report', 500);
    respondOk($data);
}

// ── action=detail&date=YYYY-MM-DD[&runway=...] ───────────────────────────────
if ($action === 'detail') {
    $date = $_GET['date'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('Invalid date format. Use YYYY-MM-DD', 400);
    $base = teamDataPath('grafana-monitoring/daily/');
    if ($runwaySlug) {
        $f = $base . $runwaySlug . '/' . $date . '.json';
    } else {
        [, $f] = _findFileByDate($base, $date);
    }
    if (!$f || !file_exists($f)) respondError('Report not found for ' . $date, 404);
    $data = json_decode(file_get_contents($f), true);
    if (!$data) respondError('Failed to parse report', 500);
    respondOk($data);
}

// ── action=list[&runway=...] (default) ───────────────────────────────────────
$base = teamDataPath('grafana-monitoring/daily/');
$today = new DateTime('today', new DateTimeZone('Asia/Bangkok'));
$byRunway = [];

foreach (_runwayDirs($base, $runwaySlug) as $slug => $dir) {
    $reports = [];
    if (is_dir($dir)) {
        foreach (glob($dir . '*.json') ?: [] as $file) {
            $filename = basename($file, '.json');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $filename)) continue;
            $d = json_decode(file_get_contents($file), true);
            if (!$d) continue;
            $reports[] = [
                'date'           => $filename,
                'runway'         => $d['runway']         ?? '',
                'generatedAt'    => $d['generatedAt']    ?? null,
                'totalRestarts'  => $d['totalRestarts']  ?? 0,
                'severitySummary'=> $d['severitySummary'] ?? ['critical' => 0, 'warning' => 0, 'info' => 0],
                'reasonSummary'  => $d['reasonSummary']  ?? [],
                'cluster'        => $d['cluster']        ?? '',
            ];
        }
    }
    usort($reports, fn($a, $b) => strcmp($b['date'], $a['date']));

    $totals = ['totalDays' => count($reports), 'totalRestarts7d' => 0, 'totalRestarts30d' => 0, 'totalOOMKilled30d' => 0, 'totalCritical7d' => 0];
    foreach ($reports as $r) {
        try {
            $d = new DateTime($r['date'], new DateTimeZone('Asia/Bangkok'));
            $daysAgo = (int)$today->diff($d)->format('%a');
            if ($daysAgo <= 7) {
                $totals['totalRestarts7d'] += $r['totalRestarts'];
                $totals['totalCritical7d'] += ($r['severitySummary']['critical'] ?? 0);
            }
            if ($daysAgo <= 30) {
                $totals['totalRestarts30d'] += $r['totalRestarts'];
                $totals['totalOOMKilled30d'] += ($r['reasonSummary']['OOMKilled'] ?? 0);
            }
        } catch (Exception $e) { continue; }
    }
    $byRunway[$slug] = ['reports' => $reports, 'totals' => $totals];
}

if ($runwaySlug) {
    respondOk($byRunway[$runwaySlug]);
}

// All-runways response — also include a flat runway directory for UI tabs
$runwayInfo = [];
foreach (_allRunways() as $rw) {
    $runwayInfo[] = ['name' => $rw['name'] ?? '', 'slug' => $rw['slug'] ?? '', 'cluster' => $rw['cluster'] ?? ''];
}
respondOk(['byRunway' => $byRunway, 'runways' => $runwayInfo]);
