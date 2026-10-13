<?php
// GenZ Case Notes — shared runbook among GenZ Team (SM only).
// Storage: data/sm/genz_case_notes.json
// GET     → list all (sm + is_genz)
// GET ?id → single note
// POST    → create
// PUT ?id → update
// DELETE ?id → delete (author or sm_admin/dev_sm)
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// ── Guard: SM team + is_genz flag ───────────────────────────
if (($payload['team'] ?? null) !== 'sm') {
    respondError('GenZ Case Notes available only for SM team', 403);
}
// is_genz is read from users.json (not in JWT to avoid needing re-login)
$allUsers = readJson('users.json');
$me = null;
foreach ($allUsers as $u) {
    if (($u['id'] ?? '') === ($payload['sub'] ?? '')) { $me = $u; break; }
}
$isGenz = (bool)($me['is_genz'] ?? false);
$isSmAdmin = in_array($payload['role'] ?? '', ['sm_admin', 'dev_sm'], true);
if (!$isGenz && !$isSmAdmin) {
    respondError('GenZ Team members only', 403);
}

// ── Sanitisers ──────────────────────────────────────────────
function _cleanStr($v, int $max = 500): string {
    $v = trim((string)$v);
    return mb_substr($v, 0, $max);
}
function _cleanTags($v): array {
    if (!is_array($v)) return [];
    return array_values(array_unique(array_filter(array_map(fn($t) => _cleanStr($t, 40), $v))));
}
function _cleanSteps($v): array {
    if (!is_array($v)) return [];
    $out = [];
    foreach ($v as $s) {
        $text = _cleanStr($s['text'] ?? '', 400);
        if ($text === '') continue;
        $out[] = ['text' => $text, 'done' => (bool)($s['done'] ?? false)];
    }
    return $out;
}
function _cleanLinks($v): array {
    if (!is_array($v)) return [];
    $out = [];
    foreach ($v as $l) {
        $label = _cleanStr($l['label'] ?? '', 120);
        $url   = _cleanStr($l['url']   ?? '', 500);
        if ($url === '') continue;
        if (!preg_match('#^https?://#i', $url)) continue;
        $out[] = ['label' => $label ?: $url, 'url' => $url];
    }
    return $out;
}
function _cleanTeamsCustom($v): array {
    // Accept any team name (custom + default) — max 40 chars each, max 20 teams
    if (!is_array($v)) return [];
    return array_values(array_unique(array_filter(
        array_map(fn($t) => _cleanStr($t, 40), array_slice($v, 0, 20))
    )));
}
function _cleanMaServices($v): array {
    if (!is_array($v)) return [];
    $out = [];
    foreach ($v as $s) {
        $id   = (int)($s['id'] ?? 0);
        $name = _cleanStr($s['name'] ?? '', 200);
        if ($id <= 0) continue;
        $out[] = ['id' => $id, 'name' => $name];
    }
    return $out;
}
function _cleanRelated($v): array {
    if (!is_array($v)) return [];
    $out = [];
    foreach ($v as $r) {
        $id    = _cleanStr($r['id']    ?? '', 60);
        $title = _cleanStr($r['title'] ?? '', 200);
        if ($id === '') continue;
        $out[] = ['id' => $id, 'title' => $title];
    }
    return array_values(array_unique($out, SORT_REGULAR));
}
function _noteShape(array $b, ?array $existing = null, string $actorId = '', string $actorName = ''): array {
    $now = date('c');
    $rec = $existing ?? [
        'id'         => genId('gzn'),
        'created_at' => $now,
        'created_by' => $actorId,
        'created_by_name' => $actorName,
    ];
    $rec['title']             = _cleanStr($b['title'] ?? '', 200);
    $rec['category']          = _cleanStr($b['category'] ?? 'general', 60); // free-form now
    $rec['tags']              = _cleanTags($b['tags'] ?? []);
    $rec['severity']          = in_array($b['severity'] ?? '', ['low','med','high','critical'], true) ? $b['severity'] : 'med';
    $rec['symptoms']          = _cleanStr($b['symptoms'] ?? '', 4000);
    $rec['when_encountered']  = _cleanStr($b['when_encountered'] ?? '', 2000);
    $rec['root_cause']        = _cleanStr($b['root_cause'] ?? '', 4000);
    $rec['resolution_steps']  = _cleanSteps($b['resolution_steps'] ?? []);
    $rec['links']             = _cleanLinks($b['links'] ?? []);
    $rec['related_services']  = array_values(array_unique(array_filter(array_map(fn($s) => _cleanStr($s, 80), (array)($b['related_services'] ?? [])))));
    $rec['notes']             = _cleanStr($b['notes'] ?? '', 4000);
    // ── New fields (2026-09-16) ──────────────────────────────
    $rec['teams_to_notify']  = _cleanTeamsCustom($b['teams_to_notify'] ?? []);
    $rec['ma_required']      = (bool)($b['ma_required'] ?? false);
    $rec['ma_service_ids']   = _cleanMaServices($b['ma_service_ids'] ?? []);
    $rec['service_impact']   = in_array($b['service_impact'] ?? 'none', ['none','partial','full'], true)
                                 ? $b['service_impact'] : 'none';
    $rec['escalation_path']  = _cleanStr($b['escalation_path'] ?? '', 2000);
    $rec['related_runbooks'] = _cleanRelated($b['related_runbooks'] ?? []);
    $rec['updated_at']        = $now;
    $rec['updated_by']        = $actorId;
    $rec['updated_by_name']   = $actorName;
    return $rec;
}

// ── Routes ──────────────────────────────────────────────────
$file = 'genz_case_notes.json';

if ($method === 'GET') {
    $notes = readJson($file) ?: [];
    $id    = $_GET['id'] ?? '';
    if ($id) {
        foreach ($notes as $n) if (($n['id'] ?? '') === $id) respondOk($n);
        respondError('Note not found', 404);
    }
    // Optional query filter (?q=xxx & ?category=xxx & ?tag=xxx)
    $q   = mb_strtolower(trim($_GET['q'] ?? ''));
    $cat = trim($_GET['category'] ?? '');
    $tag = trim($_GET['tag'] ?? '');
    $out = array_values(array_filter($notes, function($n) use ($q, $cat, $tag) {
        if ($cat && ($n['category'] ?? '') !== $cat) return false;
        if ($tag && !in_array($tag, $n['tags'] ?? [], true)) return false;
        if ($q) {
            $hay = mb_strtolower(implode(' ', [
                $n['title'] ?? '', $n['symptoms'] ?? '', $n['root_cause'] ?? '',
                implode(' ', $n['tags'] ?? []), implode(' ', $n['related_services'] ?? [])
            ]));
            if (mb_strpos($hay, $q) === false) return false;
        }
        return true;
    }));
    // Newest first
    usort($out, fn($a, $b) => strcmp($b['updated_at'] ?? '', $a['updated_at'] ?? ''));
    respondOk($out);
}

if ($method === 'POST') {
    requireCsrf();
    $body = getBody();
    $title = _cleanStr($body['title'] ?? '', 200);
    if ($title === '') respondError('Title is required');
    $notes = readJson($file) ?: [];
    $rec = _noteShape($body, null, $payload['sub'], $payload['name'] ?? '');
    $notes[] = $rec;
    writeJson($file, $notes);
    logActivity('genz_note_create', ['id' => $rec['id'], 'title' => $rec['title']], $payload['sub'], $payload['name'] ?? '');
    respondOk($rec, 'Case note created');
}

if ($method === 'PUT') {
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required');
    $body = getBody();
    $title = _cleanStr($body['title'] ?? '', 200);
    if ($title === '') respondError('Title is required');
    $notes = readJson($file) ?: [];
    $found = false;
    foreach ($notes as &$n) {
        if (($n['id'] ?? '') === $id) {
            $n = _noteShape($body, $n, $payload['sub'], $payload['name'] ?? '');
            $found = true;
            break;
        }
    }
    unset($n);
    if (!$found) respondError('Note not found', 404);
    writeJson($file, $notes);
    logActivity('genz_note_update', ['id' => $id], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, 'Case note updated');
}

if ($method === 'DELETE') {
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required');
    $notes = readJson($file) ?: [];
    $target = null;
    foreach ($notes as $n) if (($n['id'] ?? '') === $id) { $target = $n; break; }
    if (!$target) respondError('Note not found', 404);
    // Author or sm_admin/dev_sm may delete
    if (($target['created_by'] ?? '') !== $payload['sub'] && !$isSmAdmin) {
        respondError('Only the author or an admin can delete this note', 403);
    }
    $notes = array_values(array_filter($notes, fn($n) => ($n['id'] ?? '') !== $id));
    writeJson($file, $notes);
    logActivity('genz_note_delete', ['id' => $id, 'title' => $target['title'] ?? ''], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, 'Case note deleted');
}

respondError('Method not allowed', 405);
