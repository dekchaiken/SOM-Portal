<?php
/**
 * POST /api/grafana-alerts/resume.php  { slug, id }
 *
 * Resumes (un-pauses) a single Grafana legacy alert via
 *   POST {grafanaUrl}/api/alerts/{id}/pause  { "paused": false }
 * using the per-source auth from data/sm/grafana-alert-sources.json.
 *
 * This WRITES to production Grafana — resuming an alert whose condition is
 * currently breaching will fire its notifications immediately. Every call is
 * logged (grafana_alert_resume) with the acting user for audit.
 *
 * Auth: any SM staff (same audience as the page); CSRF required.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_fetch.php';

$user = requireAuth();
requireRole($user, ALL_STAFF_ROLES);
// Feature-gated: caller's team must have `grafana-alerts` granted. Resume
// mutates a paused alert in Grafana — meaningful side effect, so match the
// menu-level gate exactly.
requireTeamFeature($user, 'grafana-alerts');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);
requireCsrf();

$body = getBody();
$slug = trim($body['slug'] ?? '');
$id   = (int)($body['id'] ?? 0);
if ($slug === '' || $id <= 0) respondError('slug and id are required', 400);

// Resolve the source (for auth + base URL + org).
$src = null;
foreach (gaLoadSources() as $s) {
    if (($s['slug'] ?? '') === $slug) { $src = $s; break; }
}
if (!$src) respondError('Unknown source', 404);
if (($src['enabled'] ?? true) === false) respondError('Source is disabled', 400);

$auth = gaAuthHeaderForSource($src);
if ($auth === '') {
    respondError(($src['authMode'] ?? 'basic') === 'token'
        ? 'No token set for this source'
        : 'GRAFANA_BASIC_USER / GRAFANA_BASIC_PASS not set in .env', 500);
}

$url = rtrim($src['grafanaUrl'], '/') . '/api/alerts/' . $id . '/pause';
$ch  = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode(['paused' => false]),
    CURLOPT_HTTPHEADER     => [
        $auth,
        'X-Grafana-Org-Id: ' . (int)($src['orgId'] ?? 0),
        'Content-Type: application/json',
        'Accept: application/json',
    ],
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_SSL_VERIFYPEER => false,
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($err !== '' || $code < 200 || $code >= 300) {
    $msg = $err !== '' ? $err : "HTTP {$code}";
    logIntegrationError('grafana-alert-resume', $url, $msg,
        ['org' => (int)($src['orgId'] ?? 0), 'alertId' => $id, 'http_code' => $code]);
    respondError('Resume failed: ' . $msg, 502);
}

$decoded = json_decode((string)$resp, true);
$state   = is_array($decoded) ? ($decoded['state'] ?? 'unknown') : 'unknown';

logActivity('grafana_alert_resume', [
    'source'   => $src['name'] ?? $slug,
    'slug'     => $slug,
    'orgId'    => (int)($src['orgId'] ?? 0),
    'alertId'  => $id,
    'newState' => $state,
], $user['sub'] ?? '', $user['name'] ?? '');

respondOk(['alertId' => $id, 'state' => $state], 'Resumed');
