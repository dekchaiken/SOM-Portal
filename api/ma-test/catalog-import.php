<?php
/**
 * MA Test - Import catalog from CSV (SM admin only)
 * POST multipart/form-data { csv=<file> } OR JSON { path: "<server-side path>" }
 * OR   GET  ?bootstrap=1  → imports the seed CSV at data/sm/Result test MA pages monthly-*.csv
 *
 * CSV column order (from source sheet):
 *   0 NAME
 *   1 Service
 *   2 Piority
 *   3 Graph
 *   4-13 (test result columns — ignored for catalog)
 *   14 Tool
 *   15 เปลื่ยนข้อความ ได้ หรือ ไม่
 *   16 Link-Manual
 *   17 Remark
 *
 * Dedup: rows are merged into the catalog by (name + service + remark) unless
 * ?replace=1 (wipes catalog first). Existing items keep their id + created_at.
 */

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireSmTeamOnly('MA Test');
if (!in_array($payload['role'] ?? '', ['super_admin', 'sm_admin', 'dev_sm'], true)) {
    respondError('Admin only', 403);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(200); exit; }

// ── Resolve CSV source ───────────────────────────────────────
$csvPath = null;
$bootstrap = ($_GET['bootstrap'] ?? '') === '1';

if ($method === 'POST' && !$bootstrap) {
    requireCsrf();
    if (isset($_FILES['csv']) && $_FILES['csv']['error'] === UPLOAD_ERR_OK) {
        $csvPath = $_FILES['csv']['tmp_name'];
    } else {
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        if (!empty($body['path'])) {
            // Only allow paths under data/sm/
            $candidate = realpath($body['path']);
            $smDir     = realpath(DATA_DIR . 'sm');
            if ($candidate && $smDir && str_starts_with($candidate, $smDir)) {
                $csvPath = $candidate;
            }
        }
    }
}

if ($bootstrap) {
    // Find seed CSV in data/sm/
    $found = glob(DATA_DIR . 'sm/Result test MA pages monthly-*.csv');
    if ($found) $csvPath = $found[0];
}

if (!$csvPath || !is_file($csvPath)) {
    respondError('No CSV provided. Upload csv= file, POST JSON {path}, or use ?bootstrap=1 with seed CSV in data/sm/');
}

// ── Parse CSV ────────────────────────────────────────────────
$rows = [];
$fh = fopen($csvPath, 'r');
if (!$fh) respondError('Cannot open CSV', 500);
$header = fgetcsv($fh);          // discard header
$lineNo = 1;
while (($r = fgetcsv($fh)) !== false) {
    $lineNo++;
    if (!$r) continue;
    // Pad to 18 columns
    $r = array_pad($r, 18, '');
    $name    = trim($r[0] ?? '');
    $service = strtoupper(trim($r[1] ?? ''));
    // Skip blank rows & footnote rows ("หมายเหตุ:" or empty)
    if ($name === '' || $service === '') continue;
    if (strpos($name, 'หมายเหตุ') !== false) continue;

    $rows[] = [
        'name'               => $name,
        'service'            => $service,
        'priority'           => trim($r[2] ?? ''),
        'graph_url'          => trim($r[3] ?? ''),
        'tool'               => trim($r[14] ?? ''),
        'can_change_message' => strtoupper(trim($r[15] ?? 'NO')),
        'link_manual'        => trim($r[16] ?? ''),
        'remark'             => trim($r[17] ?? ''),
    ];
}
fclose($fh);

// ── Merge into catalog ───────────────────────────────────────
$replace = ($_GET['replace'] ?? '') === '1';
$d = readJson('ma-test-catalog.json');
if (!isset($d['catalog']) || !is_array($d['catalog']) || $replace) {
    $d = ['catalog' => [], 'next_id' => 1];
}
if (!isset($d['next_id'])) $d['next_id'] = count($d['catalog']) + 1;

// Existing key map for dedup
$key = fn($n, $s, $r) => strtolower(trim($n)) . '||' . strtolower(trim($s)) . '||' . strtolower(trim($r));
$existing = [];
foreach ($d['catalog'] as $i => $it) {
    $existing[$key($it['name'] ?? '', $it['service'] ?? '', $it['remark'] ?? '')] = $i;
}

$now = date('Y-m-d H:i:s');
$actor = $payload['name'] ?? $payload['sub'];
$created = 0; $updated = 0; $skipped = 0;

foreach ($rows as $row) {
    $k = $key($row['name'], $row['service'], $row['remark']);
    if (isset($existing[$k])) {
        // Update existing (fill only non-empty fields)
        $idx = $existing[$k];
        $orig = $d['catalog'][$idx];
        foreach (['priority','graph_url','tool','can_change_message','link_manual'] as $f) {
            if (($row[$f] ?? '') !== '') $orig[$f] = $row[$f];
        }
        $orig['updated_at'] = $now;
        $orig['updated_by'] = $actor;
        $d['catalog'][$idx] = $orig;
        $updated++;
    } else {
        $d['catalog'][] = [
            'id'                 => 'mtc_' . $d['next_id']++,
            'name'               => $row['name'],
            'service'            => $row['service'],
            'priority'           => $row['priority'],
            'graph_url'          => $row['graph_url'],
            'tool'               => $row['tool'],
            'can_change_message' => $row['can_change_message'],
            'link_manual'        => $row['link_manual'],
            'remark'             => $row['remark'],
            'active'             => true,
            'created_at'         => $now,
            'created_by'         => $actor,
            'updated_at'         => $now,
        ];
        $created++;
    }
}

writeJson('ma-test-catalog.json', $d);
logActivity('ma_test_catalog_import', [
    'file'    => basename($csvPath),
    'created' => $created,
    'updated' => $updated,
    'replace' => $replace,
], $payload['sub'], $payload['name'] ?? '');

respondOk([
    'created' => $created,
    'updated' => $updated,
    'skipped' => $skipped,
    'total'   => count($d['catalog']),
], "Imported: {$created} new, {$updated} updated");
