<?php
/**
 * _fetch.php — shared fetch logic for the Grafana paused-alerts monitor.
 *
 * Used by both api/grafana-alerts/paused.php (interactive) and
 * api/scheduled-noti/send-grafana-paused.php (daily digest) so the count/shape
 * stays identical between the page and the notification.
 *
 * Per-source auth (data/sm/grafana-alert-sources.json → managed in
 * admin/grafana-sources.html):
 *   • authMode 'token' → Authorization: Bearer <token>  (per-org service-account token)
 *   • authMode 'basic' (default) → GRAFANA_BASIC_USER / GRAFANA_BASIC_PASS from .env
 *     (a master credential that can reach every org — service-account tokens are
 *     org-scoped, so basic auth is the cross-org fallback).
 *   • enabled === false → source is skipped entirely.
 *
 * NOTE: relies on $GLOBALS['_current_team'] being 'sm' so readJson() resolves
 * data/sm/grafana-alert-sources.json. Interactive callers get this from the
 * JWT (SM users); the notify endpoint runs under the SM user's context too.
 */

if (!function_exists('gaLoadSources')) {

    /** Load the configured Grafana alert sources (data/sm/grafana-alert-sources.json). */
    function gaLoadSources(): array {
        $cfg = readJson('grafana-alert-sources.json');
        return $cfg['sources'] ?? [];
    }

    /** Build the Authorization header for a source, or '' when creds are missing. */
    function gaAuthHeaderForSource(array $src): string {
        if (($src['authMode'] ?? 'basic') === 'token') {
            $token = trim((string)($src['token'] ?? ''));
            return $token !== '' ? 'Authorization: Bearer ' . $token : '';
        }
        $u = envFallback('GRAFANA_BASIC_USER');
        $p = envFallback('GRAFANA_BASIC_PASS');
        if ($u === '' || $p === '') return '';
        return 'Authorization: Basic ' . base64_encode($u . ':' . $p);
    }

    /**
     * Fetch state=paused legacy alerts for every enabled source in parallel.
     *
     * @return array{sources: array, total: int, fetched_at: string}
     *   each source: { name, slug, orgId, color, grafanaUrl, count, alerts[], error }
     * @throws RuntimeException when config is missing (message is caller-safe)
     */
    function gaFetchPausedAlerts(): array {
        $allSources = gaLoadSources();
        if (empty($allSources)) {
            throw new RuntimeException('grafana-alert-sources.json missing or empty');
        }
        // Only fetch enabled sources (missing flag = enabled).
        $sources = array_values(array_filter($allSources, fn($s) => ($s['enabled'] ?? true) !== false));

        // ── Parallel fetch: /api/alerts?state=paused per source ───────────────
        $mh = curl_multi_init();
        $handles = [];
        $authErr = [];
        foreach ($sources as $idx => $src) {
            $auth = gaAuthHeaderForSource($src);
            if ($auth === '') { $authErr[$idx] = true; continue; }
            $url = rtrim($src['grafanaUrl'], '/') . '/api/alerts?state=paused&limit=1000';
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER     => [
                    $auth,
                    'X-Grafana-Org-Id: ' . (int)($src['orgId'] ?? 0),
                    'Accept: application/json',
                ],
                CURLOPT_TIMEOUT        => 20,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            $handles[$idx] = $ch;
            curl_multi_add_handle($mh, $ch);
        }

        $running = null;
        do {
            curl_multi_exec($mh, $running);
            if ($running > 0) curl_multi_select($mh, 1.0);
        } while ($running > 0);

        // ── Build response ────────────────────────────────────────────────────
        $results = [];
        $total   = 0;
        foreach ($sources as $idx => $src) {
            $entry = [
                'name'       => $src['name']  ?? '',
                'slug'       => $src['slug']  ?? '',
                'orgId'      => (int)($src['orgId'] ?? 0),
                'color'      => $src['color'] ?? '#71717a',
                'grafanaUrl' => rtrim($src['grafanaUrl'] ?? '', '/'),
                'authMode'   => $src['authMode'] ?? 'basic',
                'count'      => 0,
                'alerts'     => [],
                'error'      => null,
            ];

            if (!empty($authErr[$idx])) {
                $entry['error'] = ($src['authMode'] ?? 'basic') === 'token'
                    ? 'No token set for this source'
                    : 'GRAFANA_BASIC_USER / GRAFANA_BASIC_PASS not set in .env';
                $results[] = $entry;
                continue;
            }

            $ch    = $handles[$idx];
            $body  = curl_multi_getcontent($ch);
            $code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err   = curl_error($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);

            if ($err !== '' || $code !== 200) {
                $entry['error'] = $err !== '' ? $err : "HTTP {$code}";
                if (function_exists('logIntegrationError')) {
                    logIntegrationError('grafana-alerts-paused',
                        $entry['grafanaUrl'] . '/api/alerts', $entry['error'],
                        ['org' => $entry['orgId'], 'http_code' => $code]);
                }
                $results[] = $entry;
                continue;
            }

            $decoded = json_decode((string)$body, true);
            if (!is_array($decoded)) {
                $entry['error'] = 'Invalid JSON response';
                $results[] = $entry;
                continue;
            }

            $alerts = [];
            foreach ($decoded as $a) {
                if (!is_array($a)) continue;
                $alerts[] = [
                    'id'           => (int)($a['id'] ?? 0),
                    'name'         => (string)($a['name'] ?? ''),
                    'state'        => (string)($a['state'] ?? ''),
                    'newStateDate' => (string)($a['newStateDate'] ?? ''),
                    'url'          => (string)($a['url'] ?? ''),
                    'dashboardUid' => (string)($a['dashboardUid'] ?? ''),
                    'dashboardId'  => (int)($a['dashboardId'] ?? 0),
                    'panelId'      => (int)($a['panelId'] ?? 0),
                ];
            }
            usort($alerts, fn($x, $y) => strcasecmp($x['name'], $y['name']));

            $entry['count']  = count($alerts);
            $entry['alerts'] = $alerts;
            $total += $entry['count'];
            $results[] = $entry;
        }
        curl_multi_close($mh);

        return [
            'sources'    => $results,
            'total'      => $total,
            'fetched_at' => date('c'),
        ];
    }

    /**
     * Test a single source config (used by the admin page before saving).
     * Returns ['ok'=>bool, 'count'=>int, 'error'=>?string, 'http'=>int].
     */
    function gaTestSource(array $src): array {
        $auth = gaAuthHeaderForSource($src);
        if ($auth === '') {
            return ['ok' => false, 'count' => 0, 'http' => 0,
                'error' => ($src['authMode'] ?? 'basic') === 'token'
                    ? 'No token provided' : 'Basic creds missing in .env'];
        }
        $url = rtrim($src['grafanaUrl'] ?? '', '/') . '/api/alerts?state=paused&limit=1000';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                $auth,
                'X-Grafana-Org-Id: ' . (int)($src['orgId'] ?? 0),
                'Accept: application/json',
            ],
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($err !== '' || $code !== 200) {
            return ['ok' => false, 'count' => 0, 'http' => (int)$code,
                'error' => $err !== '' ? $err : "HTTP {$code}"];
        }
        $decoded = json_decode((string)$body, true);
        if (!is_array($decoded)) {
            return ['ok' => false, 'count' => 0, 'http' => (int)$code, 'error' => 'Invalid JSON'];
        }
        $paused = array_filter($decoded, fn($a) => is_array($a) && ($a['state'] ?? '') === 'paused');
        return ['ok' => true, 'count' => count($paused), 'http' => (int)$code, 'error' => null];
    }
}
