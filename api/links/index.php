<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';
$section = $_GET['section'] ?? '';

// Sections whose links are SM-managed and shared to every team read-only.
// Reads for these sections always come from data/sm/links.json; writes are
// gated to the SM team (super_admin viewing-as-SM counts). Keep in sync with
// the SM-shared-files pattern documented in helpers.php.
const LINKS_SHARED_SECTIONS = ['monitoring'];
const LINKS_VALID_SECTIONS  = ['monitoring', 'test-service', 'batch-monitor', 'report'];

function linksIsShared(string $section): bool {
    return in_array($section, LINKS_SHARED_SECTIONS, true);
}

function linksLoadShared(): array {
    $path = teamDataPath('links.json', 'sm');
    if (!file_exists($path)) return [];
    $raw = file_get_contents($path);
    if ($raw === '' || $raw === false) return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function linksSaveShared(array $data): bool {
    $path = teamDataPath('links.json', 'sm');
    $dir  = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fp = fopen($path, 'c+');
    if (!$fp) return false;
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return true;
}

// GET — dึง links ทั้งหมด หรือกรองตาม section
// Merges: SM's shared-section links + current team's non-shared-section links.
if ($method === 'GET') {
    $team_links = readJson('links.json');
    $sm_links   = linksLoadShared();

    $team_own = array_values(array_filter($team_links,
        fn($l) => !linksIsShared($l['section'] ?? '')));
    $sm_share = array_values(array_filter($sm_links,
        fn($l) => linksIsShared($l['section'] ?? '')));

    $links = array_merge($team_own, $sm_share);

    if ($section) {
        $links = array_values(array_filter($links, fn($l) => ($l['section'] ?? '') === $section));
    }
    usort($links, fn($a, $b) => ($a['order'] ?? 99) - ($b['order'] ?? 99));
    respondOk(array_values($links));
}

// POST — สร้าง link ใหม่ (lead / admin เท่านั้น)
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    $body = getBody();

    $name    = trim($body['name'] ?? '');
    $url     = trim($body['url'] ?? '');
    $section = trim($body['section'] ?? '');

    if (!$name)    respondError('Name is required');
    if (!$url)     respondError('URL is required');
    if (!$section) respondError('Section is required');

    if (!in_array($section, LINKS_VALID_SECTIONS)) {
        respondError('Invalid section');
    }

    $shared = linksIsShared($section);
    if ($shared) requireSmForShared();

    $store = $shared ? linksLoadShared() : readJson('links.json');

    // หา order สูงสุดของ section นั้น
    $maxOrder = 0;
    foreach ($store as $l) {
        if (($l['section'] ?? '') === $section && ($l['order'] ?? 0) > $maxOrder) {
            $maxOrder = $l['order'];
        }
    }

    $rawMode = trim($body['open_mode'] ?? 'newtab');
    $link = [
        'id'          => genId('lnk'),
        'section'     => $section,
        'subsection'  => trim($body['subsection'] ?? ''),
        'name'        => $name,
        'url'         => $url,
        'icon'        => trim($body['icon'] ?? '🔗'),
        'description' => trim($body['description'] ?? ''),
        'badge_text'  => trim($body['badge_text'] ?? ''),
        'badge_type'  => trim($body['badge_type'] ?? 'gray'),
        'open_mode'   => in_array($rawMode, ['newtab', 'iframe']) ? $rawMode : 'newtab',
        'order'       => $maxOrder + 1,
        'created_at'  => date('c'),
        'created_by'  => $payload['sub']
    ];

    $store[] = $link;
    if ($shared) {
        linksSaveShared($store);
    } else {
        writeJson('links.json', $store);
    }
    logActivity('link_create', ['id' => $link['id'], 'name' => $name, 'section' => $section, 'shared' => $shared], $payload['sub'], $payload['name']);
    respondOk($link, 'Link created');
}

// PUT — แก้ไข link
if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('Link ID required');

    $body       = getBody();
    $team_links = readJson('links.json');
    $sm_links   = linksLoadShared();

    $inTeam = null; $inSm = null;
    foreach ($team_links as $i => $l) if (($l['id'] ?? '') === $id) { $inTeam = $i; break; }
    foreach ($sm_links   as $i => $l) if (($l['id'] ?? '') === $id) { $inSm   = $i; break; }

    if ($inTeam === null && $inSm === null) respondError('Link not found', 404);

    // Editing SM's shared store requires SM team
    if ($inSm !== null) requireSmForShared();

    // Reject cross-store moves — would require deleting from one file and
    // creating in the other; not worth the complexity for a rare admin action.
    if (isset($body['section']) && in_array($body['section'], LINKS_VALID_SECTIONS)) {
        $newSection = $body['section'];
        if ($inSm !== null && !linksIsShared($newSection)) {
            respondError('Cannot move a shared monitoring link to another section');
        }
        if ($inTeam !== null && linksIsShared($newSection)) {
            respondError('Cannot move a per-team link into the shared monitoring section');
        }
    }

    $apply = function(array &$l) use ($body) {
        if (isset($body['name']))        $l['name']        = trim($body['name']);
        if (isset($body['url']))         $l['url']         = trim($body['url']);
        if (isset($body['icon']))        $l['icon']        = trim($body['icon']);
        if (isset($body['description'])) $l['description'] = trim($body['description']);
        if (isset($body['badge_text']))  $l['badge_text']  = trim($body['badge_text']);
        if (isset($body['badge_type']))  $l['badge_type']  = trim($body['badge_type']);
        if (isset($body['subsection']))  $l['subsection']  = trim($body['subsection']);
        if (isset($body['order']))       $l['order']       = (int)$body['order'];
        if (isset($body['section']) && in_array($body['section'], LINKS_VALID_SECTIONS)) {
            $l['section'] = $body['section'];
        }
        if (isset($body['open_mode']) && in_array($body['open_mode'], ['newtab', 'iframe'])) {
            $l['open_mode'] = $body['open_mode'];
        }
    };

    if ($inSm !== null) {
        $apply($sm_links[$inSm]);
        linksSaveShared($sm_links);
    } else {
        $apply($team_links[$inTeam]);
        writeJson('links.json', $team_links);
    }
    logActivity('link_update', ['id' => $id, 'shared' => $inSm !== null], $payload['sub'], $payload['name']);
    respondOk(null, 'Link updated');
}

// DELETE — ลบ link
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('Link ID required');

    $team_links = readJson('links.json');
    $sm_links   = linksLoadShared();

    $inTeam = null; $inSm = null;
    foreach ($team_links as $i => $l) if (($l['id'] ?? '') === $id) { $inTeam = $i; break; }
    foreach ($sm_links   as $i => $l) if (($l['id'] ?? '') === $id) { $inSm   = $i; break; }

    if ($inTeam === null && $inSm === null) respondError('Link not found', 404);

    if ($inSm !== null) {
        requireSmForShared();
        array_splice($sm_links, $inSm, 1);
        linksSaveShared($sm_links);
    } else {
        array_splice($team_links, $inTeam, 1);
        writeJson('links.json', $team_links);
    }
    logActivity('link_delete', ['id' => $id, 'shared' => $inSm !== null], $payload['sub'], $payload['name']);
    respondOk(null, 'Link deleted');
}

respondError('Method not allowed', 405);
