#!/usr/bin/env php
<?php
/**
 * cron/grafana-alerts-notify.php
 *
 * Daily Google Chat digest of Grafana alert rules currently in state=Paused,
 * aggregated across every org in data/sm/grafana-alert-sources.json.
 *
 * Suggested crontab entry (fires 09:00 Asia/Bangkok — keep in sync with
 * notifyHour in data/sm/grafana-alerts-config.json):
 *   0 9 * * * /usr/bin/php /path/to/centralize-som/cron/grafana-alerts-notify.php >> /path/to/centralize-som/data/logs/cron-grafana-alerts.log 2>&1
 *
 * Flags:
 *   --force    ignore the once-per-day history guard (re-send today)
 *   --no-noti  fetch + print counts only, do not send (dry run)
 */

define('GA_SCRIPT_START', microtime(true));

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/grafana-alerts/_fetch.php';
require_once __DIR__ . '/../api/grafana-alerts/_notify.php';

// The alert-source config + notify config live under data/sm/. This CLI has no
// JWT, so set the team context explicitly (matches the SM-team web endpoints).
$GLOBALS['_current_team'] = 'sm';

$force   = in_array('--force', $argv, true);
$noNoti  = in_array('--no-noti', $argv, true);

$now = (new DateTime('now', new DateTimeZone('Asia/Bangkok')))->format('Y-m-d H:i:s');
echo "═══ grafana-alerts-notify ═══\n";
echo "Time: {$now} (Asia/Bangkok)\n";

try {
    $data = gaFetchPausedAlerts();
} catch (RuntimeException $e) {
    fwrite(STDERR, "[ERROR] {$e->getMessage()}\n");
    exit(1);
}

echo "Total paused: {$data['total']}\n";
foreach ($data['sources'] as $s) {
    $err = $s['error'] ? " ERROR: {$s['error']}" : '';
    echo '  ' . str_pad($s['name'], 26) . ' → ' . $s['count'] . ' paused' . $err . "\n";
}

if ($noNoti) {
    echo "Notify: skipped (--no-noti)\n";
    exit(0);
}

$result = sendGrafanaAlertsNotification($data, $force);
$elapsed = round(microtime(true) - GA_SCRIPT_START, 2);

if ($result['sent'] ?? false) {
    echo "Notify: SENT (HTTP {$result['httpCode']}, threadKey={$result['threadKey']})\n";
} else {
    echo "Notify: not sent — " . ($result['reason'] ?? 'unknown') . "\n";
}
echo "Elapsed: {$elapsed}s\n";
exit(0);
