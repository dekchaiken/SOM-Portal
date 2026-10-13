<?php
// ─────────────────────────────────────────────────────────────────────────────
//  Batch File Index — Job Crawler (Sprint 0)
//
//  Enumerates every job on a Jenkins server (folders recursively flattened) and
//  writes the result to sm/jenkins_jobs_catalog.json (SM-shared file). The
//  batch-file indexer reads this catalog to know which jobs' console logs to
//  fetch and grep for output file mentions.
//
//  Does NOT fetch any console logs — that's Sprint 1. This step only builds the
//  job inventory, so it's safe to run repeatedly at zero risk.
//
//  Endpoints:
//    POST /api/batch-file-index/crawl.php?server=<id>   — crawl one server
//    GET  /api/batch-file-index/crawl.php               — return catalog
// ─────────────────────────────────────────────────────────────────────────────
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// ── GET — return current catalog (any authenticated user can view) ───────────
if ($method === 'GET') {
    $catalog = readJson('jenkins_jobs_catalog.json');
    if (!is_array($catalog))            $catalog = [];
    if (!isset($catalog['servers']))    $catalog['servers'] = new stdClass();
    respondOk($catalog);
}

// ── POST — trigger crawl (SM admin only) ─────────────────────────────────────
if ($method !== 'POST') respondError('Method not allowed', 405);
requireRole($payload, ADMIN_ROLES);
requireSmForShared();  // Writes to sm/jenkins_jobs_catalog.json — SM-only
requireCsrf();

$serverId = trim($_GET['server'] ?? ($_POST['server'] ?? ''));
if (!$serverId) {
    $body     = getBody();
    $serverId = trim($body['server'] ?? '');
}
if (!$serverId) respondError('server required');

$servers = require __DIR__ . '/../jenkins_config.php';
if (!isset($servers[$serverId])) respondError('Unknown server', 404);
$server = $servers[$serverId];

// ── cURL helper — mirrors jenkins-proxy's jenkinsRequest() ───────────────────
function jxRequest(array $server, string $url): array {
    $auth = $server['auth'];
    $ch   = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 BatchFileIndex-Crawler',
    ]);
    $headers = ['Accept: application/json'];
    if ($auth['mode'] === 'token' && !empty($auth['token'])) {
        $headers[] = 'Authorization: Basic ' . base64_encode($auth['user'] . ':' . $auth['token']);
    } elseif ($auth['mode'] === 'cookie' && !empty($auth['cookie'])) {
        curl_setopt($ch, CURLOPT_COOKIE, $auth['cookie']);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$body, $code, $err];
}

// ── Flatten Jenkins job tree ─────────────────────────────────────────────────
// Jenkins folders show up with a nested `jobs` array. Nodes with an empty or
// missing `jobs` array are leaf jobs (Pipeline, FreeStyle, Matrix, etc.).
// Multibranch containers have children per branch — we treat those children as
// separate jobs (matches how users identify them in URLs).
function flattenJobs(array $nodes, array &$out, array &$deferredFolders, int $currentDepth, int $maxDepth): void {
    foreach ($nodes as $node) {
        if (!is_array($node)) continue;
        $name = $node['name'] ?? '';
        $url  = $node['url']  ?? '';
        if (!$name || !$url) continue;
        $hasChildren = isset($node['jobs']) && is_array($node['jobs']);
        if ($hasChildren && !empty($node['jobs'])) {
            // Folder / multibranch → recurse.
            flattenJobs($node['jobs'], $out, $deferredFolders, $currentDepth + 1, $maxDepth);
            continue;
        }
        if ($hasChildren && empty($node['jobs']) && $currentDepth >= $maxDepth) {
            // We might have hit the tree-depth cap; defer for a supplementary
            // fetch so we don't silently miss deep folders.
            $deferredFolders[] = $url;
            continue;
        }
        // Leaf job — record it. Path is derived from URL for use in later
        // consoleText fetches (must start with /job/).
        $path = parse_url($url, PHP_URL_PATH) ?: '';
        $out[] = [
            'name'  => $name,
            'url'   => $url,
            'path'  => $path,
            'class' => $node['_class'] ?? '',
        ];
    }
}

$base = rtrim($server['base_url'], '/');

// tree=jobs[name,url,_class,jobs[name,url,_class, ... nested 5 deep ]]
// 5 levels of nesting covers most enterprise Jenkins folder trees; anything
// deeper is deferred and re-fetched from that folder's URL.
$treeParam = 'jobs[name,url,_class,'
           . 'jobs[name,url,_class,'
           . 'jobs[name,url,_class,'
           . 'jobs[name,url,_class,'
           . 'jobs[name,url,_class]]]]]';
$rootUrl = $base . '/api/json?tree=' . rawurlencode($treeParam);

[$rootBody, $httpCode, $curlErr] = jxRequest($server, $rootUrl);
if ($curlErr)                respondError('Cannot reach Jenkins: ' . $curlErr, 502);
if ($httpCode === 401)       respondError('Jenkins rejected credentials — token may be invalid or expired', 422);
if ($httpCode === 403)       respondError('Jenkins access denied — cookie/session may have expired', 422);
if ($httpCode === 404)       respondError('Jenkins /api/json not found (404)', 404);
if ($httpCode !== 200)       respondError("Jenkins returned HTTP {$httpCode}", 502);

$rootData = json_decode($rootBody, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    respondError('Jenkins returned invalid JSON — may be a login redirect page', 502);
}

$jobs            = [];
$deferredFolders = [];
$rootJobs        = $rootData['jobs'] ?? [];
flattenJobs($rootJobs, $jobs, $deferredFolders, 1, 5);

// Supplementary crawls for folders we couldn't reach at max depth. Capped at
// 20 to keep total time bounded — anything deeper is likely a config issue.
$deferredHandled  = 0;
$deferredMaxCount = 20;
foreach (array_unique($deferredFolders) as $folderUrl) {
    if ($deferredHandled >= $deferredMaxCount) break;
    $deferredHandled++;
    $followUrl = rtrim($folderUrl, '/') . '/api/json?tree=' . rawurlencode($treeParam);
    [$fb, $fc, $fe] = jxRequest($server, $followUrl);
    if ($fe || $fc !== 200) continue;
    $fd = json_decode($fb, true);
    if (!is_array($fd) || empty($fd['jobs'])) continue;
    // Recurse from here — new deferrals are appended but only the first-pass
    // batch is followed, matching the depth-20 hard cap above.
    $subDeferred = [];
    flattenJobs($fd['jobs'], $jobs, $subDeferred, 1, 5);
}

// ── Persist catalog (merged with any existing server entries) ────────────────
$catalog = readJson('jenkins_jobs_catalog.json');
if (!is_array($catalog))            $catalog = [];
if (!isset($catalog['servers']) || !is_array($catalog['servers'])) $catalog['servers'] = [];

$catalog['servers'][$serverId] = [
    'server_display'  => $server['display']  ?? $serverId,
    'base_url'        => $server['base_url'] ?? '',
    'crawled_at'      => date('c'),
    'crawled_by'      => $payload['name'] ?? $payload['sub'] ?? 'unknown',
    'job_count'       => count($jobs),
    'deferred_folders'=> $deferredHandled,
    'jobs'            => $jobs,
];

writeJson('jenkins_jobs_catalog.json', $catalog);
logActivity('batch_file_index_crawl', [
    'server_id' => $serverId,
    'job_count' => count($jobs),
], $payload['sub'], $payload['name']);

respondOk([
    'server_id'        => $serverId,
    'server_display'   => $server['display'] ?? $serverId,
    'job_count'        => count($jobs),
    'deferred_handled' => $deferredHandled,
    'sample_jobs'      => array_slice($jobs, 0, 5),
], 'Crawled ' . count($jobs) . ' jobs from ' . ($server['display'] ?? $serverId));
