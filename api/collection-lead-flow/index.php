<?php
// Collection Lead Flow — read the seeded pipeline map + allow SM users to
// declare/override chain edges and per-job notes.
//
// Storage:  data/{team}/collection_lead_flow.json
//   {
//     categories: [...],
//     jobs:       [{ pattern, category, schedule:{time,frequency,...}, ... }],
//     file_entries:[...],
//     auto_edges: [{from,to,kind,category}],   // derived from CSV order
//     user_edges: [{from,to,note,by,at}],      // user-declared
//     notes:      { "<pattern>": { text, by, at } }
//   }
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action'] ?? '';

function _flowLoad(): array {
    $d = readJson('collection_lead_flow.json');
    if (!is_array($d)) $d = [];
    foreach (['categories','jobs','file_entries','auto_edges','user_edges'] as $k) {
        if (!isset($d[$k]) || !is_array($d[$k])) $d[$k] = [];
    }
    if (!isset($d['notes']) || !is_array($d['notes'])) $d['notes'] = [];
    return $d;
}

// ── GET — return the whole flow document ────────────────────────────────────
if ($method === 'GET') {
    $d = _flowLoad();
    // Ensure notes serializes as object even when empty
    $d['notes'] = (object)$d['notes'];
    respondOk($d);
}

// ── POST ?action=add-edge — SM adds a chain edge ────────────────────────────
if ($method === 'POST' && $action === 'add-edge') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM Team only', 403);
    requireCsrf();
    $body = getBody();
    $from = trim($body['from'] ?? '');
    $to   = trim($body['to']   ?? '');
    $note = trim($body['note'] ?? '');
    if (!$from || !$to)        respondError('from and to required');
    if ($from === $to)         respondError('cannot link a job to itself');

    $d = _flowLoad();
    foreach ($d['user_edges'] as $e) {
        if ($e['from'] === $from && $e['to'] === $to)
            respondError('edge already exists', 409);
    }
    $d['user_edges'][] = [
        'from' => $from, 'to' => $to, 'note' => $note,
        'by'   => $payload['name'] ?? $payload['sub'],
        'at'   => date('c'),
    ];
    writeJson('collection_lead_flow.json', $d);
    logActivity('cl_flow_edge_add', ['from'=>$from,'to'=>$to], $payload['sub'], $payload['name']);
    respondOk(null, 'Edge added');
}

// ── POST ?action=delete-edge ────────────────────────────────────────────────
if ($method === 'POST' && $action === 'delete-edge') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM Team only', 403);
    requireCsrf();
    $body = getBody();
    $from = trim($body['from'] ?? '');
    $to   = trim($body['to']   ?? '');
    if (!$from || !$to) respondError('from and to required');

    $d = _flowLoad();
    $before = count($d['user_edges']);
    $d['user_edges'] = array_values(array_filter(
        $d['user_edges'],
        fn($e) => !($e['from'] === $from && $e['to'] === $to)
    ));
    if (count($d['user_edges']) === $before) respondError('edge not found', 404);
    writeJson('collection_lead_flow.json', $d);
    logActivity('cl_flow_edge_delete', ['from'=>$from,'to'=>$to], $payload['sub'], $payload['name']);
    respondOk(null, 'Edge deleted');
}

// ── POST ?action=set-note — SM sets/clears a per-job note ───────────────────
if ($method === 'POST' && $action === 'set-note') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM Team only', 403);
    requireCsrf();
    $body = getBody();
    $job  = trim($body['job']  ?? '');
    $text = trim($body['text'] ?? '');
    if (!$job) respondError('job required');

    $d = _flowLoad();
    if ($text === '') {
        unset($d['notes'][$job]);
    } else {
        $d['notes'][$job] = [
            'text' => $text,
            'by'   => $payload['name'] ?? $payload['sub'],
            'at'   => date('c'),
        ];
    }
    writeJson('collection_lead_flow.json', $d);
    logActivity('cl_flow_note_set', ['job'=>$job,'clear'=>$text===''], $payload['sub'], $payload['name']);
    respondOk(null, 'Saved');
}

respondError('Method not allowed', 405);
