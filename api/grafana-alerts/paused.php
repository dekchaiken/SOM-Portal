<?php
/**
 * GET /api/grafana-alerts/paused.php
 *
 * Aggregates Grafana legacy alerts in state=paused across all orgs listed in
 * data/sm/grafana-alert-sources.json. Requires GRAFANA_BASIC_USER +
 * GRAFANA_BASIC_PASS in .env — service-account tokens are org-scoped and
 * cannot switch orgs via X-Grafana-Org-Id, so basic auth is used instead.
 *
 * Fetch/shape logic lives in _fetch.php (shared with cron/grafana-alerts-notify.php).
 *
 * Response:
 * {
 *   "sources": [
 *     { "name": "EKS TMN", "slug": "eks-tmn", "orgId": 3, "color": "#3b82f6",
 *       "count": 29, "error": null,
 *       "alerts": [ { "id": 42, "name": "...", "state": "paused",
 *                     "newStateDate": "2026-05-...", "url": "https://...",
 *                     "dashboardUid": "abc", "panelId": 5 }, ... ] },
 *     ...
 *   ],
 *   "total": 41,
 *   "fetched_at": "2026-07-22T..."
 * }
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_fetch.php';

$user = requireAuth();
requireRole($user, ALL_STAFF_ROLES);
// Feature-gated: caller's team must have `grafana-alerts` granted. Matches
// the sidebar visibility rule set in layout.js so backend enforcement can't be
// bypassed by hitting the endpoint directly.
requireTeamFeature($user, 'grafana-alerts');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

set_time_limit(60);

try {
    $data = gaFetchPausedAlerts();
} catch (RuntimeException $e) {
    respondError($e->getMessage(), 500);
}

respondOk($data);
