<?php
/**
 * POST /api/restart-monitor/send-monthly.php
 *
 * Generates the monthly report email and sends via SMTP (same pattern as _notify.php).
 *
 * Body (JSON):
 *   {
 *     "month": "YYYY-MM",                  // required
 *     "to":    ["...","..."]               // optional; default = saved recipients
 *   }
 *
 * Auth modes:
 *   - JWT (user-triggered "Send now" from the UI)
 *   - Header X-Restart-Monitor-Token (Claude routine / machine call)
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_aggregate.php';
require_once __DIR__ . '/_email.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

// ── Auth: JWT or shared token ─────────────────────────────────────────────────
$providedToken = $_SERVER['HTTP_X_RESTART_MONITOR_TOKEN'] ?? '';
if ($providedToken && RESTART_MONITOR_UPLOAD_TOKEN
    && hash_equals(RESTART_MONITOR_UPLOAD_TOKEN, $providedToken)) {
    // Machine-to-machine call — no JWT, so team context comes from body.team
    // (defaults to 'sm' for backward compat with existing routines).
    $actor = 'routine';
    $mBody = json_decode(file_get_contents('php://input'), true) ?: [];
    $GLOBALS['_current_team'] = trim((string)($mBody['team'] ?? 'sm')) ?: 'sm';
} else {
    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);
    // Reads from SM-shared data (data/sm/grafana-monitoring/...) and dispatches
    // real email — non-SM teams must not trigger this. Machine token path above
    // is exempt (it explicitly sets team=sm from the routine body).
    requireSmForShared();
    $actor = $payload['userName'] ?? $payload['userId'] ?? 'user';
}

$body  = getBody();
$month = $body['month'] ?? '';
if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
    respondError('Invalid month (expected YYYY-MM)', 400);
}

// Runway param: 'all' (combined, default) or runway name (single)
$runwayParam = trim((string)($body['runway'] ?? 'all'));

// Load runway config (team-scoped)
$rwCfg  = readJson('grafana-runways.json');
$rwList = $rwCfg['runways'] ?? [];

// For single-runway sends, resolve slug for recipient lookup
$runwaySlugSingle = '';
if ($runwayParam !== 'all') {
    foreach ($rwList as $rw) {
        if (($rw['name'] ?? '') === $runwayParam) { $runwaySlugSingle = $rw['slug'] ?? ''; break; }
    }
}

// ── Recipients (To + CC) ─────────────────────────────────────────────────────
$cleanEmails = function ($raw): array {
    $out = [];
    foreach ((array)$raw as $e) {
        $e = trim((string)$e);
        if (filter_var($e, FILTER_VALIDATE_EMAIL)) $out[] = $e;
    }
    return array_values(array_unique($out));
};

$toList = [];
$ccList = [];
if (!empty($body['to']) || !empty($body['cc'])) {
    $toList = $cleanEmails($body['to'] ?? []);
    $ccList = $cleanEmails($body['cc'] ?? []);
} else {
    // For combined report, use global lists. For single runway, prefer
    // per-runway list if defined, else fall back to global.
    $stored = readJson('grafana-monitoring/monthly-recipients.json');
    $storedTo = $stored['to'] ?? $stored['recipients'] ?? [];
    $storedCc = $stored['cc'] ?? [];
    if ($runwayParam !== 'all' && $runwaySlugSingle) {
        $rwKey   = 'recipients_' . $runwaySlugSingle;
        $storedTo = $stored[$rwKey] ?? $storedTo;
    }
    $toList = $cleanEmails($storedTo);
    $ccList = $cleanEmails($storedCc);
}
// CC should not duplicate To
$ccList = array_values(array_diff($ccList, $toList));
if (!$toList) respondError('No recipients configured (To is empty)', 400);

// Envelope recipients = To + CC (server-side delivery list)
$recipients = array_merge($toList, $ccList);

// ── Aggregate + build email ──────────────────────────────────────────────────
// CTA inside emails points to the public read-only page (no SOM login required).
$webUrl = getenv('RESTART_MONITOR_PUBLIC_URL') ?: 'http://10.164.16.47/SOM-Portal/api/restart-monitor/public-monthly.php';

// Per-runway summary builder — sources from Raw/Auto snapshots
// (data/grafana-monitoring/raw/{slug}/) for consistency with the Monthly UI.
$buildSummary = function (array $rw, string $month) {
    $slug = $rw['slug'] ?? '';
    $dailyDir = teamDataPath('grafana-monitoring/raw/' . $slug . '/');
    $sum = rmAggregateMonth($dailyDir, $month);
    $prev = rmPrevMonth($month);
    $prevLite = rmAggregateMonth($dailyDir, $prev, true);
    $prevTot  = $prevLite['totalRestarts'];
    $sum['previousMonth'] = ['month' => $prev, 'totalRestarts' => $prevTot, 'critical' => $prevLite['severitySummary']['critical'] ?? 0];
    $sum['deltaVsPrev']   = [
        'restarts'    => $sum['totalRestarts'] - $prevTot,
        'restartsPct' => $prevTot > 0 ? round((($sum['totalRestarts'] - $prevTot) / $prevTot) * 100, 1) : null,
    ];
    $sum['runway']  = $rw['name'] ?? '';
    $sum['cluster'] = $rw['cluster'] ?? '';
    return $sum;
};

if ($runwayParam === 'all') {
    $summaries = [];
    foreach ($rwList as $rw) {
        $sum = $buildSummary($rw, $month);
        if (($sum['daysWithData'] ?? 0) > 0) $summaries[$rw['name']] = $sum;
    }
    if (!$summaries) respondError("No daily data found across any runway for {$month}", 404);

    $subject = "รายงานรายเดือน Restart ทุก Runway — {$month}";
    $html    = rmBuildCombinedMonthlyEmailHtml($summaries, $month, $webUrl);
    $reportLabel = 'all-runways';
} else {
    $rw = null;
    foreach ($rwList as $r) if (($r['name'] ?? '') === $runwayParam) { $rw = $r; break; }
    if (!$rw) respondError("Unknown runway '{$runwayParam}'", 400);
    $summary = $buildSummary($rw, $month);
    if ($summary['daysWithData'] === 0) {
        respondError("No daily data found for {$month} ({$runwayParam})", 404);
    }
    $subject = "รายงานรายเดือน Restart {$runwayParam} — {$month}";
    $html    = rmBuildMonthlyEmailHtml($summary, $webUrl);
    $reportLabel = $runwayParam;
}

// ── Send via SMTP (mirrors _notify.php sendEmailNotification) ────────────────
$cfg = readJson('mail_config.json');
if (empty($cfg['smtp_host']) || empty($cfg['from_email'])) {
    respondError('SMTP not configured (mail_config.json)', 500);
}

$result = rmSendMonthlyEmail($cfg, $toList, $ccList, $subject, $html);

logActivity('restart_monitor_send_monthly', [
    'month'    => $month,
    'runway'   => $reportLabel,
    'sent'     => $result['sent'] ?? false,
    'to_count' => count($toList),
    'cc_count' => count($ccList),
    'by'       => $actor,
]);

respondOk([
    'month'      => $month,
    'runway'     => $reportLabel,
    'to'         => $toList,
    'cc'         => $ccList,
    'recipients' => $recipients,
    'sent'       => $result['sent'] ?? false,
    'reason'     => $result['reason'] ?? null,
    'subject'    => $subject,
]);


// ─── helpers ─────────────────────────────────────────────────────────────────

function rmSendMonthlyEmail(array $cfg, array $toList, array $ccList, string $subject, string $html): array {
    require_once __DIR__ . '/../mail/_branding.php';
    $brandedHtml = buildGradientEmail($html, $subject, $cfg, true);

    $fromName  = $cfg['from_name']  ?? 'SOM-Portal';
    $fromEmail = $cfg['from_email'];
    $boundary  = 'b_' . md5(uniqid('', true));
    $date2822  = date('r');
    $msgId     = '<' . uniqid('rm-monthly-', true) . '@' . gethostname() . '>';

    $encFromName = '=?UTF-8?B?' . base64_encode($fromName) . '?=';
    $encSubject  = '=?UTF-8?B?' . base64_encode($subject)  . '?=';
    $toHeader    = implode(', ', $toList);
    $ccHeader    = implode(', ', $ccList);

    $headers = "Date: {$date2822}\r\n"
             . "From: {$encFromName} <{$fromEmail}>\r\n"
             . "To: {$toHeader}\r\n"
             . ($ccHeader !== '' ? "Cc: {$ccHeader}\r\n" : '')
             . "Subject: {$encSubject}\r\n"
             . "Message-ID: {$msgId}\r\n"
             . "MIME-Version: 1.0\r\n"
             . "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

    $textBody = strip_tags(str_replace(['<br>', '<br/>', '</p>', '</tr>'], "\n", $brandedHtml));

    $bodyMime  = "--{$boundary}\r\n"
               . "Content-Type: text/plain; charset=UTF-8\r\n"
               . "Content-Transfer-Encoding: base64\r\n\r\n"
               . chunk_split(base64_encode($textBody)) . "\r\n"
               . "--{$boundary}\r\n"
               . "Content-Type: text/html; charset=UTF-8\r\n"
               . "Content-Transfer-Encoding: base64\r\n\r\n"
               . chunk_split(base64_encode($brandedHtml)) . "\r\n"
               . "--{$boundary}--\r\n";

    $message = $headers . "\r\n" . $bodyMime;

    $enc  = $cfg['smtp_encryption'] ?? 'tls';
    $host = $cfg['smtp_host'];
    $port = (int)($cfg['smtp_port'] ?? 587);
    $url  = ($enc === 'ssl') ? "smtps://{$host}:{$port}" : "smtp://{$host}:{$port}";

    // SMTP envelope must include both To and CC for delivery
    $rcpt = array_map(fn($e) => "<{$e}>", array_merge($toList, $ccList));
    $fp   = fopen('php://temp', 'r+');
    fwrite($fp, $message);
    rewind($fp);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_MAIL_FROM      => "<{$fromEmail}>",
        CURLOPT_MAIL_RCPT      => $rcpt,
        CURLOPT_READDATA       => $fp,
        CURLOPT_UPLOAD         => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_TIMEOUT        => 25,
    ]);
    if (!empty($cfg['smtp_user'])) {
        curl_setopt($ch, CURLOPT_USERNAME, $cfg['smtp_user']);
        curl_setopt($ch, CURLOPT_PASSWORD, $cfg['smtp_password'] ?? '');
    }
    if ($enc === 'tls') curl_setopt($ch, CURLOPT_USE_SSL, CURLUSESSL_ALL);

    curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fp);

    if ($err) return ['sent' => false, 'reason' => "SMTP error: {$err}"];
    return ['sent' => true, 'to' => $toList];
}
