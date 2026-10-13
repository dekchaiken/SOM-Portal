<?php
/**
 * /api/grafana-sources/index.php — Admin CRUD for the Grafana alert sources that
 * the paused-alerts monitor scans (admin/grafana-sources.html).
 *
 * Storage: data/sm/grafana-alert-sources.json
 *   { "_comment": "...", "sources": [ { name, slug, grafanaUrl, orgId,
 *       authMode: "basic"|"token", token, color, enabled }, ... ] }
 *
 * Tokens are never returned raw — GET masks them (hasToken + maskedToken). On
 * update, an empty token keeps the stored value (so admins can edit other fields
 * without re-pasting the secret).
 *
 * Auth: admin only; writes require CSRF and SM-team context (the file is
 * SM-managed / shared read-only to other teams).
 *
 * Routes:
 *   GET    /                → list sources (tokens masked)
 *   POST   /                → create source                 (admin, CSRF)
 *   PUT    /?slug=eks-tmn   → update source                 (admin, CSRF)
 *   DELETE /?slug=eks-tmn   → delete source                 (admin, CSRF)
 *   POST   /?action=test    → test a source config (live)   (admin, CSRF)
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../grafana-alerts/_fetch.php';

const GS_FILE = 'grafana-alert-sources.json';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$method = $_SERVER['REQUEST_METHOD'];

// ── Helpers ──────────────────────────────────────────────────────────────────
function gsLoad(): array {
    $data = readJson(GS_FILE);
    if (!isset($data['sources']) || !is_array($data['sources'])) $data['sources'] = [];
    return $data;
}
function gsSave(array $data): bool {
    return writeJson(GS_FILE, $data);
}
function gsSlugify(string $name): string {
    $s = strtolower(trim($name));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    return trim($s, '-') ?: 'src';
}
function gsUniqueSlug(string $base, array $sources, string $ignoreSlug = ''): string {
    $existing = array_column($sources, 'slug');
    $existing = array_values(array_filter($existing, fn($s) => $s !== $ignoreSlug));
    $slug = $base; $i = 2;
    while (in_array($slug, $existing, true)) { $slug = $base . '-' . $i; $i++; }
    return $slug;
}
function gsMaskToken(string $t): string {
    if ($t === '') return '';
    if (strlen($t) <= 8) return '••••';
    return substr($t, 0, 4) . '…' . substr($t, -4);
}
// Public view of a source — never leaks the raw token.
function gsPublic(array $s): array {
    $token = (string)($s['token'] ?? '');
    return [
        'name'       => $s['name']       ?? '',
        'slug'       => $s['slug']       ?? '',
        'grafanaUrl' => $s['grafanaUrl'] ?? '',
        'orgId'      => (int)($s['orgId'] ?? 0),
        'authMode'   => $s['authMode']   ?? 'basic',
        'color'      => $s['color']      ?? '#71717a',
        'enabled'    => ($s['enabled']   ?? true) !== false,
        'hasToken'   => $token !== '',
        'maskedToken'=> gsMaskToken($token),
    ];
}

// ── GET: list ────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $data = gsLoad();
    $rows = array_map('gsPublic', $data['sources']);
    respondOk([
        'sources'   => $rows,
        'basicUser' => envFallback('GRAFANA_BASIC_USER') !== '' ? 'set' : 'missing',
    ]);
}

// ── POST ?action=test: test a source config (before or after saving) ─────────
if ($method === 'POST' && ($_GET['action'] ?? '') === 'test') {
    requireCsrf();
    $body = getBody();

    $test = [
        'grafanaUrl' => trim($body['grafanaUrl'] ?? ''),
        'orgId'      => (int)($body['orgId'] ?? 0),
        'authMode'   => in_array($body['authMode'] ?? '', ['basic','token']) ? $body['authMode'] : 'basic',
        'token'      => trim($body['token'] ?? ''),
    ];
    if ($test['grafanaUrl'] === '') respondError('grafanaUrl required', 400);

    // Token-mode test with an empty token field falls back to the stored token
    // for the given slug (so admins can re-test without re-pasting the secret).
    if ($test['authMode'] === 'token' && $test['token'] === '') {
        $slug = trim($body['slug'] ?? '');
        if ($slug !== '') {
            foreach (gsLoad()['sources'] as $s) {
                if (($s['slug'] ?? '') === $slug) { $test['token'] = (string)($s['token'] ?? ''); break; }
            }
        }
    }

    set_time_limit(30);
    $res = gaTestSource($test);
    logActivity('grafana_source_test', ['url' => $test['grafanaUrl'], 'org' => $test['orgId'], 'ok' => $res['ok']]);
    if (!$res['ok']) respondError('Test failed: ' . ($res['error'] ?? 'unknown'), 502);
    respondOk(['count' => $res['count'], 'http' => $res['http']], "Connected · {$res['count']} paused");
}

// ── POST: create ─────────────────────────────────────────────────────────────
if ($method === 'POST') {
    requireSmForShared();
    requireCsrf();
    $body = getBody();

    $name = trim($body['name'] ?? '');
    $url  = trim($body['grafanaUrl'] ?? '');
    if ($name === '') respondError('name required', 400);
    if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) respondError('valid grafanaUrl required', 400);

    $authMode = in_array($body['authMode'] ?? '', ['basic','token']) ? $body['authMode'] : 'basic';
    $data     = gsLoad();
    $slug     = gsUniqueSlug(gsSlugify($body['slug'] ?? $name), $data['sources']);

    $new = [
        'name'       => $name,
        'slug'       => $slug,
        'grafanaUrl' => rtrim($url, '/'),
        'orgId'      => (int)($body['orgId'] ?? 0),
        'authMode'   => $authMode,
        'token'      => $authMode === 'token' ? trim($body['token'] ?? '') : '',
        'color'      => trim($body['color'] ?? '') ?: '#71717a',
        'enabled'    => ($body['enabled'] ?? true) !== false,
    ];

    $data['sources'][] = $new;
    if (!gsSave($data)) respondError('Failed to write config', 500);
    logActivity('grafana_source_create', ['slug' => $slug, 'name' => $name]);
    respondOk(gsPublic($new), 'Source added');
}

// ── PUT ?slug=: update ───────────────────────────────────────────────────────
if ($method === 'PUT') {
    requireSmForShared();
    requireCsrf();
    $slug = trim($_GET['slug'] ?? '');
    if ($slug === '') respondError('slug required', 400);
    $body = getBody();

    $data  = gsLoad();
    $found = false;
    foreach ($data['sources'] as &$s) {
        if (($s['slug'] ?? '') !== $slug) continue;
        if (isset($body['name']))       $s['name']       = trim($body['name']);
        if (isset($body['grafanaUrl'])) {
            $u = trim($body['grafanaUrl']);
            if ($u !== '' && !filter_var($u, FILTER_VALIDATE_URL)) respondError('valid grafanaUrl required', 400);
            $s['grafanaUrl'] = rtrim($u, '/');
        }
        if (isset($body['orgId']))    $s['orgId']    = (int)$body['orgId'];
        if (isset($body['authMode']) && in_array($body['authMode'], ['basic','token'])) {
            $s['authMode'] = $body['authMode'];
            if ($body['authMode'] === 'basic') $s['token'] = ''; // clear token when switching to basic
        }
        // Empty token = keep existing; non-empty = replace.
        if (array_key_exists('token', $body) && trim((string)$body['token']) !== '') {
            $s['token'] = trim((string)$body['token']);
        }
        if (isset($body['color']))    $s['color']    = trim($body['color']) ?: ($s['color'] ?? '#71717a');
        if (isset($body['enabled']))  $s['enabled']  = (bool)$body['enabled'];
        $found = true;
        break;
    }
    unset($s);

    if (!$found) respondError('Source not found', 404);
    if (!gsSave($data)) respondError('Failed to write config', 500);
    logActivity('grafana_source_update', ['slug' => $slug]);
    respondOk(null, 'Updated');
}

// ── DELETE ?slug=: remove ────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireSmForShared();
    requireCsrf();
    $slug = trim($_GET['slug'] ?? '');
    if ($slug === '') respondError('slug required', 400);

    $data     = gsLoad();
    $before   = count($data['sources']);
    $data['sources'] = array_values(array_filter($data['sources'], fn($s) => ($s['slug'] ?? '') !== $slug));
    if (count($data['sources']) === $before) respondError('Source not found', 404);

    if (!gsSave($data)) respondError('Failed to write config', 500);
    logActivity('grafana_source_delete', ['slug' => $slug]);
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
