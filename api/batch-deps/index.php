<?php
// Batch job dependency mapping — user-defined upstream/downstream links
// between Jenkins jobs. Stored inside batch_meta.json under the
// `dependencies` key so all batch-related data lives in one file per team.
//
// The sheet-sync routines only touch $data['entries'], so dependencies
// survive re-syncs.
//
// File shape: data/{team}/batch_meta.json → key "dependencies"
// {
//   "configs":   [...],
//   "entries":   [...],
//   "dependencies": {
//     "<job-name>": {
//       "upstream":   ["<job-name>", ...],
//       "downstream": ["<job-name>", ...],
//       "note":       "",
//       "updated_at": "2026-07-20T22:00:00+07:00",
//       "updated_by_id":   "usr_xxx",
//       "updated_by_name": "Warapon"
//     },
//     ...
//   }
// }

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action'] ?? '';

// Small helper: load batch_meta.json normalized to a well-shaped array so
// we can safely read/write the dependencies subkey without stomping on
// configs/entries maintained by /api/batch-meta.
function _readBatchMeta(): array {
    $data = readJson('batch_meta.json');
    if (!is_array($data)) $data = [];
    if (!isset($data['configs'])      || !is_array($data['configs']))      $data['configs']      = [];
    if (!isset($data['entries'])      || !is_array($data['entries']))      $data['entries']      = [];
    if (!isset($data['dependencies']) || !is_array($data['dependencies'])) $data['dependencies'] = [];
    return $data;
}

// ── GET — return the full dependency map ─────────────────────────────────────
if ($method === 'GET') {
    $data = _readBatchMeta();
    // (object) cast so an empty map serializes as `{}` not `[]` in JSON.
    respondOk(['entries' => (object)$data['dependencies']]);
}

// ── POST ?action=set — upsert deps for one job ───────────────────────────────
if ($method === 'POST' && $action === 'set') {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $body = getBody();
    $job  = trim($body['job'] ?? '');
    if (!$job) respondError('job name required');

    // Normalize + de-dup upstream/downstream arrays. Skip self-references and
    // empty strings to keep the graph clean.
    $normalize = function ($arr) use ($job) {
        if (!is_array($arr)) return [];
        $out = [];
        foreach ($arr as $x) {
            $s = trim((string)$x);
            if ($s === '' || $s === $job) continue;
            if (!in_array($s, $out, true)) $out[] = $s;
        }
        return $out;
    };
    $upstream   = $normalize($body['upstream']   ?? []);
    $downstream = $normalize($body['downstream'] ?? []);
    $note       = trim((string)($body['note'] ?? ''));

    $data = _readBatchMeta();

    // Empty upstream+downstream+note → remove the entry entirely (no dead rows)
    if (!$upstream && !$downstream && $note === '') {
        if (isset($data['dependencies'][$job])) unset($data['dependencies'][$job]);
        writeJson('batch_meta.json', $data);
        logActivity('batch_deps_clear', ['job' => $job], $payload['sub'], $payload['name']);
        respondOk(null, 'Cleared dependencies for ' . $job);
    }

    $data['dependencies'][$job] = [
        'upstream'        => $upstream,
        'downstream'      => $downstream,
        'note'            => $note,
        'updated_at'      => date('c'),
        'updated_by_id'   => $payload['sub']  ?? '',
        'updated_by_name' => $payload['name'] ?? '',
    ];

    writeJson('batch_meta.json', $data);
    logActivity('batch_deps_set', [
        'job'      => $job,
        'up_n'     => count($upstream),
        'down_n'   => count($downstream),
    ], $payload['sub'], $payload['name']);
    respondOk($data['dependencies'][$job], 'Saved dependencies for ' . $job);
}

// ── POST ?action=delete — remove entry for one job ───────────────────────────
if ($method === 'POST' && $action === 'delete') {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $body = getBody();
    $job  = trim($body['job'] ?? '');
    if (!$job) respondError('job name required');

    $data = _readBatchMeta();
    if (!isset($data['dependencies'][$job])) respondOk(null, 'No entry to delete');

    unset($data['dependencies'][$job]);
    writeJson('batch_meta.json', $data);
    logActivity('batch_deps_delete', ['job' => $job], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
