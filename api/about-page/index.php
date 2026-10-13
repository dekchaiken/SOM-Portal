<?php
/**
 * GET /api/about-page/   → public about-page data (all roles)
 * PUT /api/about-page/   → update config (sm_admin / dev_sm / super_admin)
 */
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// Always read from SM's directory — about-page is SM-owned, globally visible
$GLOBALS['_current_team'] = 'sm';

// ── Safe public user fields ───────────────────────────────────────────────
function _safeUser(array $u): array {
    return [
        'id'          => $u['id'],
        'name'        => $u['name'],
        'name_th'     => $u['name_th']     ?? '',
        'nickname'    => $u['nickname']    ?? '',
        'role'        => $u['role'],
        'team'        => $u['team']        ?? null,
        'avatar_url'  => $u['avatar_url']  ?? null,
        'emp_id'      => $u['emp_id']      ?? '',
        'position'    => $u['position']    ?? '',
        'phone'       => $u['phone']       ?? '',
        'email'       => $u['email']       ?? '',
    ];
}

if ($method === 'GET') {
    $cfg   = readJson('about-page.json');
    $users = readJson('users.json'); // global

    // All super_viewers (for admin editor)
    $allManagers = array_values(array_filter($users, fn($u) => ($u['role'] ?? '') === 'super_viewer'));
    usort($allManagers, fn($a,$b) => strcmp($a['name'], $b['name']));
    $allManagers = array_map('_safeUser', $allManagers);

    // Head of Tech Ops — separate from SOM managers
    $headManagerIds = $cfg['head_manager_ids'] ?? [];
    $heads = [];
    if (!empty($headManagerIds) && is_array($headManagerIds)) {
        $heads = array_values(array_filter($allManagers, fn($u) => in_array($u['id'], $headManagerIds, true)));
    }

    // SOM Managers shown on org chart — filtered by manager_ids if configured
    $managerIds = $cfg['manager_ids'] ?? [];
    if (!empty($managerIds) && is_array($managerIds)) {
        $managers = array_values(array_filter($allManagers, fn($u) => in_array($u['id'], $managerIds, true)));
    } else {
        // Fallback: all super_viewers not in head list
        $managers = array_values(array_filter($allManagers, fn($u) => !in_array($u['id'], $headManagerIds, true)));
    }

    // Team leaders config: { slug => [user_id, ...] }
    $teamLeaders = $cfg['team_leaders'] ?? [];

    // Teams + members
    $orgSlugs = $cfg['org_teams'] ?? ['sm','ss','ts','fas','im','cmt','smart'];
    $allTeams = readJson('teams.json');

    $orgTeams = [];
    foreach ($orgSlugs as $slug) {
        $teamDef = null;
        foreach ($allTeams as $t) {
            if (($t['slug'] ?? '') === $slug) { $teamDef = $t; break; }
        }
        $members = array_values(array_filter($users, function($u) use ($slug) {
            return ($u['team'] ?? '') === $slug
                && !in_array($u['role'], ['super_viewer', 'external'], true);
        }));
        usort($members, fn($a,$b) => strcmp($a['name'], $b['name']));
        $safeMembers = array_map('_safeUser', $members);

        // Find leaders for this team (supports multiple)
        $rawLeaders = $teamLeaders[$slug] ?? [];
        // Normalise: legacy string → single-element array
        if (is_string($rawLeaders)) $rawLeaders = $rawLeaders !== '' ? [$rawLeaders] : [];
        $leaderIds = array_values(array_filter((array)$rawLeaders, 'is_string'));
        $leaders = array_values(array_filter($safeMembers, fn($m) => in_array($m['id'], $leaderIds, true)));

        $teamDescs = $cfg['team_descs'] ?? [];
        $orgTeams[] = [
            'slug'    => $slug,
            'name'    => $teamDef['name']  ?? strtoupper($slug) . ' Team',
            'color'   => $teamDef['color'] ?? '#6366F1',
            'desc'    => $teamDescs[$slug] ?? '',
            'members' => $safeMembers,
            'count'   => count($safeMembers),
            'leaders' => $leaders,
        ];
    }

    // All teams (for admin editor — includes teams not in org chart)
    // Exclude utility/non-org teams so admin sees a clean list
    $excludedSlugs = ['dev', 'wealth', 'jenkins', 'sojenkins'];
    $allOrgOptions = array_values(array_filter($allTeams, function($t) use ($excludedSlugs) {
        return !empty($t['active']) && !in_array($t['slug'] ?? '', $excludedSlugs, true);
    }));
    $allOrgOptions = array_map(fn($t) => [
        'slug'  => $t['slug']  ?? '',
        'name'  => $t['name']  ?? '',
        'color' => $t['color'] ?? '#6366F1',
    ], $allOrgOptions);

    respondOk([
        'mission'      => $cfg['mission']      ?? '',
        'vision'       => $cfg['vision']       ?? '',
        'services'     => $cfg['services']     ?? [],
        'contacts'     => $cfg['contacts']     ?? [],
        'team_descs'   => $cfg['team_descs']   ?? new stdClass(),
        'team_info'         => $cfg['team_info']         ?? new stdClass(),
        'team_leaders'      => $teamLeaders,
        'head_manager_ids'  => $headManagerIds,
        'head_of_ops'       => $cfg['head_of_ops'] ?? new stdClass(),
        'manager_ids'       => $managerIds,
        'heads'             => $heads,
        'managers'          => $managers,
        'all_managers'      => $allManagers,         // for admin editor only
        'org_teams'    => $orgTeams,
        'all_teams'    => $allOrgOptions,       // for admin editor only
        'updated_at'   => $cfg['updated_at']   ?? 0,
    ]);
}

if ($method === 'PUT' || $method === 'PATCH') {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();
    $body = getBody();

    $current = readJson('about-page.json');
    if (isset($body['mission']))   $current['mission']   = trim($body['mission']);
    if (isset($body['vision']))    $current['vision']    = trim($body['vision']);
    if (isset($body['services']) && is_array($body['services'])) $current['services'] = $body['services'];
    if (isset($body['contacts']) && is_array($body['contacts'])) $current['contacts'] = $body['contacts'];
    if (isset($body['org_teams']) && is_array($body['org_teams'])) $current['org_teams'] = array_values($body['org_teams']);
    if (isset($body['team_descs']) && is_array($body['team_descs'])) {
        $clean = [];
        foreach ($body['team_descs'] as $k => $v) {
            if (is_string($k) && preg_match('/^[a-z0-9_-]+$/', $k)) $clean[$k] = trim((string)$v);
        }
        $current['team_descs'] = $clean;
    }
    if (isset($body['team_leaders']) && (is_array($body['team_leaders']) || $body['team_leaders'] instanceof stdClass)) {
        $cleanLeaders = [];
        $src = (array)$body['team_leaders'];
        foreach ($src as $k => $v) {
            if (!is_string($k) || !preg_match('/^[a-z0-9_-]+$/', $k)) continue;
            // Accept array of IDs or empty array
            $ids = is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
            $cleanLeaders[$k] = $ids;
        }
        $current['team_leaders'] = $cleanLeaders;
    }
    if (isset($body['manager_ids']) && is_array($body['manager_ids'])) {
        $current['manager_ids'] = array_values(array_filter($body['manager_ids'], 'is_string'));
    }
    if (isset($body['head_manager_ids']) && is_array($body['head_manager_ids'])) {
        $current['head_manager_ids'] = array_values(array_filter($body['head_manager_ids'], 'is_string'));
    }
    if (isset($body['head_of_ops']) && is_array($body['head_of_ops'])) {
        $hop = $body['head_of_ops'];
        $current['head_of_ops'] = [
            'name'       => trim((string)($hop['name']       ?? '')),
            'nickname'   => trim((string)($hop['nickname']   ?? '')),
            'position'   => trim((string)($hop['position']   ?? '')),
            'email'      => trim((string)($hop['email']      ?? '')),
            'avatar_url' => trim((string)($hop['avatar_url'] ?? '')),
        ];
    }
    if (isset($body['team_info']) && (is_array($body['team_info']) || $body['team_info'] instanceof stdClass)) {
        $cleanInfo = [];
        $allowedStr  = ['abbr','full_name','icon','hours','contact_email','contact_tel','sla'];
        $allowedArr  = ['kpis','responsibilities','tools'];
        foreach ((array)$body['team_info'] as $slug => $info) {
            if (!is_string($slug) || !preg_match('/^[a-z0-9_-]+$/', $slug)) continue;
            $entry = [];
            foreach ($allowedStr as $f) {
                if (isset($info[$f])) $entry[$f] = trim((string)$info[$f]);
            }
            foreach ($allowedArr as $f) {
                if (isset($info[$f]) && is_array($info[$f])) {
                    $entry[$f] = array_values(array_filter(array_map('trim', $info[$f]), 'strlen'));
                }
            }
            $cleanInfo[$slug] = $entry;
        }
        $current['team_info'] = $cleanInfo;
    }
    $current['updated_at'] = time();

    writeJson('about-page.json', $current);
    logActivity('about_page_update', [], $payload['sub'], $payload['name'] ?? '');
    respondOk($current, 'About page updated');
}

respondError('Method not allowed', 405);
