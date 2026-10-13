<?php
require_once __DIR__ . '/../helpers.php';

// Pattern extraction: prefer URL last path segment (Jenkins job name),
// else strip leading "Pipeline " label from raw name.
function extractBatchPattern(string $rawName, string $rawUrl): string {
    $url = trim($rawUrl);
    if ($url !== '') {
        $path = parse_url($url, PHP_URL_PATH) ?: $url;
        $parts = array_values(array_filter(explode('/', $path), fn($p) => $p !== ''));
        if (!empty($parts)) {
            $seg = urldecode(end($parts));
            if ($seg !== '') return $seg;
        }
    }
    $name = trim($rawName);
    $name = preg_replace('/^pipeline\s+/i', '', $name);
    return trim($name);
}

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action'] ?? '';
$id      = $_GET['id']     ?? '';

// ── GET — list all configs + entries ─────────────────────────────────────────
if ($method === 'GET') {
    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = [];
    // Always normalize to { configs:[], entries:[] } — a freshly-provisioned
    // team file is `[]`, and returning that raw makes the JS side read
    // `entries` as Array.prototype.entries (a function), which then blows
    // up on `.filter(...)`. Explicit keys prevent that.
    if (!isset($data['configs'])      || !is_array($data['configs']))      $data['configs']      = [];
    if (!isset($data['entries'])      || !is_array($data['entries']))      $data['entries']      = [];
    // Chain dependencies (V2) — user-declared upstream/downstream. Written
    // via /api/batch-deps but returned here too so v2 gets everything in one call.
    if (!isset($data['dependencies']) || !is_array($data['dependencies'])) $data['dependencies'] = [];
    respondOk($data);
}

// ── POST ?action=fetch-sheet — proxy fetch CSV from Google Sheets ─────────────
if ($method === 'POST' && $action === 'fetch-sheet') {
    $body    = getBody();
    $sheetId = trim($body['sheet_id'] ?? '');
    $gid     = trim($body['gid']      ?? '');
    $maxRows = (int)($body['max_rows'] ?? 5);

    if (!$sheetId) respondError('sheet_id required');

    $ctx = stream_context_create([
        'http' => ['timeout' => 12, 'header' => "User-Agent: Mozilla/5.0\r\n"],
        'ssl'  => ['verify_peer' => false, 'verify_peer_name' => false],
    ]);

    // Try gviz endpoint first (works for shared sheets)
    $url = "https://docs.google.com/spreadsheets/d/{$sheetId}/gviz/tq?tqx=out:csv&headers=0"
         . ($gid ? "&gid={$gid}" : '');
    $csv = @file_get_contents($url, false, $ctx);

    // Fallback to export endpoint
    if ($csv === false) {
        $url2 = "https://docs.google.com/spreadsheets/d/{$sheetId}/export?format=csv"
              . ($gid ? "&gid={$gid}" : '');
        $csv = @file_get_contents($url2, false, $ctx);
    }

    if ($csv === false)
        respondError('ไม่สามารถเข้าถึง Sheet ได้ — ตรวจสอบว่า Share เป็น "Anyone with the link can view"');

    $lines = array_filter(explode("\n", str_replace("\r", "", $csv)));
    $rows  = [];
    $count = 0;
    foreach ($lines as $line) {
        if ($count >= $maxRows + 1) break;
        $rows[] = str_getcsv($line);
        $count++;
    }
    respondOk(['rows' => $rows, 'total_lines' => count($lines)]);
}

// ── POST ?action=sync-entries&id=xxx — accept pre-parsed entries from browser ─
if ($method === 'POST' && $action === 'sync-entries' && $id) {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $body    = getBody();
    $entries = $body['entries'] ?? [];
    if (!is_array($entries)) respondError('entries must be array');

    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = ['configs' => [], 'entries' => []];

    // Find config
    $cfgFound = false;
    foreach ($data['configs'] as &$cfg) {
        if ($cfg['id'] !== $id) continue;
        $cfg['last_synced'] = date('c');
        $cfg['entry_count'] = count($entries);
        $cfgFound = true; break;
    }
    unset($cfg);
    if (!$cfgFound) respondError('Config not found', 404);

    // Replace entries for this config
    $data['entries'] = array_values(array_filter(
        $data['entries'] ?? [],
        fn($e) => ($e['config_id'] ?? '') !== $id
    ));
    foreach ($entries as $e) {
        $data['entries'][] = [
            'pattern'    => trim($e['pattern']    ?? ''),
            'match'      => 'contains',
            'config_id'  => $id,
            'dev_owner'  => trim($e['dev_owner']  ?? ''),
            'manual_url' => trim($e['manual_url'] ?? ''),
            'sm_rerun'   => trim($e['sm_rerun']   ?? ''),
            'etc'        => trim($e['etc']        ?? ''),
            'category'   => trim($e['category']   ?? ''),
            'parameter'  => trim($e['parameter']  ?? ''),
            'note'       => trim($e['note']       ?? ''),
        ];
    }

    writeJson('batch_meta.json', $data);
    logActivity('batch_meta_sync', ['config_id' => $id, 'entries' => count($entries)], $payload['sub'], $payload['name']);
    respondOk(['synced' => count($entries)], 'Synced ' . count($entries) . ' entries');
}

// ── POST ?action=sync&id=xxx — sync entries from Google Sheet ─────────────────
if ($method === 'POST' && $action === 'sync' && $id) {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = ['configs' => [], 'entries' => []];

    $cfg = null;
    foreach ($data['configs'] as &$c) {
        if ($c['id'] === $id) { $cfg = &$c; break; }
    }
    unset($c);
    if (!$cfg) respondError('Config not found', 404);

    $ctx = stream_context_create([
        'http' => ['timeout' => 15, 'header' => "User-Agent: Mozilla/5.0\r\n"],
        'ssl'  => ['verify_peer' => false, 'verify_peer_name' => false],
    ]);
    $url = "https://docs.google.com/spreadsheets/d/{$cfg['sheet_id']}/gviz/tq?tqx=out:csv&headers=0"
         . (!empty($cfg['gid']) ? "&gid={$cfg['gid']}" : '');
    $csv = @file_get_contents($url, false, $ctx);
    if ($csv === false) respondError('ไม่สามารถเข้าถึง Sheet ได้');

    $lines      = array_filter(explode("\n", str_replace("\r", "", $csv)));
    $headerRow  = (int)($cfg['header_row']   ?? 0);
    $colBatch    = (int)($cfg['col_batch_name']  ?? -1);
    $colBatchUrl = (int)($cfg['col_batch_url']   ?? -1);
    $colOwner    = (int)($cfg['col_dev_owner']   ?? -1);
    $colManual   = (int)($cfg['col_manual_url']  ?? -1);
    $colSmRerun  = (int)($cfg['col_sm_rerun']    ?? -1);
    $colEtc      = (int)($cfg['col_etc']         ?? -1);
    $colCategory = (int)($cfg['col_category']    ?? -1);
    $colParam    = (int)($cfg['col_parameter']   ?? -1);
    $colNote     = (int)($cfg['col_note']        ?? -1);

    $newEntries = [];
    $rowIdx = 0;
    foreach ($lines as $line) {
        $row = str_getcsv($line);
        $rowIdx++;
        if ($rowIdx <= $headerRow + 1) continue;
        $rawName = $colBatch    >= 0 ? trim($row[$colBatch]    ?? '') : '';
        $rawUrl  = $colBatchUrl >= 0 ? trim($row[$colBatchUrl] ?? '') : '';
        $batchName = extractBatchPattern($rawName, $rawUrl);
        if (!$batchName || $batchName === '-') continue;
        $newEntries[] = [
            'pattern'    => $batchName,
            'match'      => 'contains',
            'config_id'  => $id,
            'dev_owner'  => $colOwner    >= 0 ? trim($row[$colOwner]    ?? '') : '',
            'manual_url' => $colManual   >= 0 ? trim($row[$colManual]   ?? '') : '',
            'sm_rerun'   => $colSmRerun  >= 0 ? trim($row[$colSmRerun]  ?? '') : '',
            'etc'        => $colEtc      >= 0 ? trim($row[$colEtc]      ?? '') : '',
            'category'   => $colCategory >= 0 ? trim($row[$colCategory] ?? '') : '',
            'parameter'  => $colParam    >= 0 ? trim($row[$colParam]    ?? '') : '',
            'note'       => $colNote     >= 0 ? trim($row[$colNote]     ?? '') : '',
        ];
    }

    // Replace entries for this config
    $data['entries'] = array_values(array_filter(
        $data['entries'] ?? [],
        fn($e) => ($e['config_id'] ?? '') !== $id
    ));
    foreach ($newEntries as $e) $data['entries'][] = $e;

    $cfg['last_synced'] = date('c');
    $cfg['entry_count'] = count($newEntries);
    writeJson('batch_meta.json', $data);
    logActivity('batch_meta_sync', ['config_id' => $id, 'entries' => count($newEntries)], $payload['sub'], $payload['name']);
    respondOk(['synced' => count($newEntries)], 'Synced ' . count($newEntries) . ' entries');
}

// ── POST — create config ──────────────────────────────────────────────────────
if ($method === 'POST' && !$action) {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();
    $body = getBody();

    $name    = trim($body['name']     ?? '');
    $sheetId = trim($body['sheet_id'] ?? '');
    if (!$name || !$sheetId) respondError('name and sheet_id required');

    $cfg = [
        'id'             => genId('bmc'),
        'name'           => $name,
        'sheet_id'       => $sheetId,
        'gid'            => trim($body['gid']      ?? ''),
        'tab_name'       => trim($body['tab_name'] ?? ''),
        'header_row'     => (int)($body['header_row']     ?? 0),
        'col_batch_name' => (int)($body['col_batch_name'] ?? 1),
        'col_batch_url'  => isset($body['col_batch_url'])  ? (int)$body['col_batch_url']  : -1,
        'col_dev_owner'  => isset($body['col_dev_owner'])  ? (int)$body['col_dev_owner']  : -1,
        'col_manual_url' => isset($body['col_manual_url']) ? (int)$body['col_manual_url'] : -1,
        'col_sm_rerun'   => isset($body['col_sm_rerun'])   ? (int)$body['col_sm_rerun']   : -1,
        'col_etc'        => isset($body['col_etc'])        ? (int)$body['col_etc']        : -1,
        'col_category'   => isset($body['col_category'])   ? (int)$body['col_category']   : -1,
        'col_parameter'  => isset($body['col_parameter'])  ? (int)$body['col_parameter']  : -1,
        'col_note'       => isset($body['col_note'])       ? (int)$body['col_note']       : -1,
        'last_synced'    => null,
        'entry_count'    => 0,
    ];

    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = ['configs' => [], 'entries' => []];
    $data['configs'][] = $cfg;
    writeJson('batch_meta.json', $data);
    logActivity('batch_meta_config_create', ['id' => $cfg['id'], 'name' => $name], $payload['sub'], $payload['name']);
    respondOk($cfg, 'Config created');
}

// ── PUT ?id=xxx — update config ───────────────────────────────────────────────
if ($method === 'PUT' && $id) {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();
    $body = getBody();

    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = ['configs' => [], 'entries' => []];
    $found = false;
    $intKeys = ['header_row','col_batch_name','col_batch_url','col_dev_owner','col_manual_url','col_sm_rerun',
                'col_etc','col_category','col_parameter','col_note'];
    foreach ($data['configs'] as &$cfg) {
        if ($cfg['id'] !== $id) continue;
        foreach (['name','sheet_id','gid','tab_name','header_row','col_batch_name','col_batch_url',
                  'col_dev_owner','col_manual_url','col_sm_rerun','col_etc',
                  'col_category','col_parameter','col_note'] as $k) {
            if (isset($body[$k]))
                $cfg[$k] = in_array($k, $intKeys) ? (int)$body[$k] : trim($body[$k]);
        }
        $found = true; break;
    }
    unset($cfg);
    if (!$found) respondError('Config not found', 404);
    writeJson('batch_meta.json', $data);
    respondOk(null, 'Updated');
}

// ── DELETE ?id=xxx — delete config + its entries ──────────────────────────────
if ($method === 'DELETE' && $id) {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();
    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = ['configs' => [], 'entries' => []];
    $data['configs'] = array_values(array_filter($data['configs'], fn($c) => $c['id'] !== $id));
    $data['entries'] = array_values(array_filter($data['entries'], fn($e) => ($e['config_id'] ?? '') !== $id));
    writeJson('batch_meta.json', $data);
    logActivity('batch_meta_config_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

// ── POST ?action=upsert-entry — SM team manually add/edit a single job ────────
if ($method === 'POST' && $action === 'upsert-entry') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM Team only', 403);
    requireCsrf();

    $body    = getBody();
    $jobName = trim($body['job_name'] ?? '');
    if (!$jobName) respondError('job_name required');

    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = ['configs' => [], 'entries' => []];
    if (!isset($data['entries'])) $data['entries'] = [];

    $fields = ['dev_owner', 'manual_url', 'sm_rerun', 'etc', 'category', 'parameter', 'note'];
    $who    = $payload['name'] ?? $payload['sub'];
    $now    = date('c');
    $found  = false;
    foreach ($data['entries'] as &$e) {
        if (($e['match'] ?? '') === 'exact' && ($e['source'] ?? '') === 'manual'
            && strtolower($e['pattern']) === strtolower($jobName)) {
            $changes = [];
            foreach ($fields as $k) {
                if (!array_key_exists($k, $body)) continue;
                $newVal = trim($body[$k] ?? '');
                $oldVal = (string)($e[$k] ?? '');
                if ($newVal !== $oldVal) {
                    $changes[] = ['field' => $k, 'from' => $oldVal, 'to' => $newVal];
                    $e[$k] = $newVal;
                }
            }
            if (!empty($changes)) {
                if (!isset($e['history']) || !is_array($e['history'])) $e['history'] = [];
                $e['history'][] = ['action' => 'edit', 'by' => $who, 'at' => $now, 'changes' => $changes];
                $e['updated_at'] = $now;
                $e['updated_by'] = $who;
            }
            $found = true;
            break;
        }
    }
    unset($e);

    if (!$found) {
        $entry = [
            'pattern'    => $jobName,
            'match'      => 'exact',
            'source'     => 'manual',
            'config_id'  => 'manual',
            'created_at' => $now,
            'created_by' => $who,
            'updated_at' => $now,
            'updated_by' => $who,
        ];
        $changes = [];
        foreach ($fields as $k) {
            $val = trim($body[$k] ?? '');
            $entry[$k] = $val;
            if ($val !== '') $changes[] = ['field' => $k, 'from' => '', 'to' => $val];
        }
        $entry['history'] = [['action' => 'add', 'by' => $who, 'at' => $now, 'changes' => $changes]];
        $data['entries'][] = $entry;
    }

    writeJson('batch_meta.json', $data);
    logActivity('batch_meta_manual_edit', ['job' => $jobName], $payload['sub'], $payload['name']);
    respondOk(null, 'Saved');
}

respondError('Method not allowed', 405);
