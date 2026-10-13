<?php
// ─── Alert Monitor — JSM connection tester (admin only) ───────────────────────
// GET → probes JSM directly, returns raw HTTP response, so we can debug query
// syntax / permissions without touching the sync pipeline.
//
// Query params:
//   ?query=<override>   custom Opsgenie search query (URL-encode it)
//   ?raw=1              omit query entirely (list all alerts visible to the token)
//   ?limit=<n>          override page size (default 5)
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_jsm_client.php';

$user = requireAuth();
requireRole($user, LEAD_ROLES);

$cfg     = alertMonitorConfig();
$cloudId = $cfg['jsm']['cloud_id'];
$baseUrl = rtrim($cfg['jsm']['base_url'] ?? 'https://api.atlassian.com/jsm/ops/api', '/');
$limit   = max(1, min(100, (int)($_GET['limit'] ?? 5)));

$raw   = isset($_GET['raw']) && $_GET['raw'] === '1';
$query = $raw ? null : ($_GET['query'] ?? $cfg['jsm']['responder_filter'] ?? '');

$params = [
    'offset' => max(0, (int)($_GET['offset'] ?? 0)),
    'limit'  => $limit,
    'sort'   => 'createdAt',
    'order'  => 'desc',
];
if ($query !== null && $query !== '') $params['query'] = $query;

$url = "$baseUrl/$cloudId/v1/alerts?" . http_build_query($params);

try {
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: ' . alertMonitorAuthHeader(),
            'Accept: application/json',
        ],
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HEADER         => true,
    ];
    alertMonitorApplyTls($opts, $cfg);  // shares SSL config with sync
    curl_setopt_array($ch, $opts);
    $out  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hSz  = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $err  = curl_error($ch);
    curl_close($ch);

    $headers = substr($out ?: '', 0, $hSz);
    $body    = substr($out ?: '', $hSz);
    $decoded = json_decode($body, true);

    // JSM Ops returns "values"; keep "data" as a fallback for the newer variant
    $items  = $decoded['values'] ?? $decoded['data'] ?? [];
    $sample = [];
    if (is_array($items)) {
        foreach (array_slice($items, 0, 3) as $r) $sample[] = alertMonitorNormalize($r);
    }

    respondOk([
        'request' => [
            'url'        => $url,
            'auth_email' => envFallback('JSM_EMAIL') ?: jiraEmail(),
            'query'      => $query,
            'raw_mode'   => $raw,
        ],
        'response' => [
            'http_status'      => $code,
            'curl_error'       => $err,
            'response_headers' => $headers,
            'body_size'        => strlen($body),
            'body_decoded_ok'  => is_array($decoded),
            'data_count'       => is_array($items) ? count($items) : null,
            'paging'           => $decoded['paging']  ?? null,
            'took'             => $decoded['took']    ?? null,
            'request_id'       => $decoded['requestId'] ?? null,
        ],
        'sample_normalized' => $sample,
        'raw_first'         => $decoded['data'][0] ?? null,
        'raw_body_preview'  => mb_substr($body, 0, 2000),
    ]);
} catch (Throwable $e) {
    respondError('JSM test failed: ' . $e->getMessage(), 502);
}
