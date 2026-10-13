<?php
/**
 * Test script: send CASE A card formats to Google Chat
 * Usage:
 *   php test-bmn-cards.php                   → preview structure only (no send)
 *   php test-bmn-cards.php <webhook_url>      → send all 4 cards to webhook
 */

// ── Stubs so helpers.php doesn't need a real .env ────────────────────
define('DATA_DIR',    __DIR__ . '/data/');
define('UPLOADS_DIR', __DIR__ . '/uploads/');

// ── Load real postToChatThread from _notify.php ───────────────────────
// (needs curl, which is available)
require_once __DIR__ . '/api/restart-monitor/_notify.php';

// ── Pull in the bmn_ helpers by parsing tick.php manually ────────────
// We run a regex to extract the "Helpers" block at the bottom and eval it.
$src = file_get_contents(__DIR__ . '/api/batch-monitor-noti/tick.php');
// Find everything from the first `function bmn_` to EOF
preg_match('/(function bmn_jenkinsRequest.+)$/s', $src, $m);
if (!$m) { die("Could not extract helpers from tick.php\n"); }
eval($m[1]);

// ── Mock data ─────────────────────────────────────────────────────────
$baselineMs = 2760000; // ~46 min median
$mockJob = [
    'name'              => 'BATCH_RECONCILE_DAILY',
    'url'               => 'http://jenkins.example.com/job/BATCH_RECONCILE_DAILY/',
    '_path'             => '/job/FINANCE/job/BATCH_RECONCILE_DAILY',
    'color'             => 'red_anime',
    'estimatedDuration' => 2880000,
    'builds'            => [
        ['number'=>42,'duration'=>2700000,'result'=>'SUCCESS'],
        ['number'=>41,'duration'=>2820000,'result'=>'SUCCESS'],
        ['number'=>40,'duration'=>2760000,'result'=>'SUCCESS'],
        ['number'=>39,'duration'=>2900000,'result'=>'SUCCESS'],
        ['number'=>38,'duration'=>2650000,'result'=>'SUCCESS'],
    ],
    'lastBuild' => [
        'number'    => 43,
        'result'    => null,
        'timestamp' => (time() - 9000) * 1000,
        'duration'  => 0,
        'url'       => 'http://jenkins.example.com/job/BATCH_RECONCILE_DAILY/43/',
        'actions'   => [
            ['causes' => [['shortDescription' => 'Started by timer']]],
            ['parameters' => [
                ['name'=>'PROCESS_TYPE','value'=>'DAILY_RECON'],
                ['name'=>'AS_OF_DATE',  'value'=>'2026-09-11'],
                ['name'=>'ENV',         'value'=>'PRODUCTION'],
            ]],
        ],
    ],
];
$mockMeta = [
    'category'  => 'Finance',
    'dev_owner' => 'dev-batch-team',
    'sm_rerun'  => 'SM Rerun',
    'manual_url'=> 'http://wiki.example.com/batch/reconcile',
    'note'      => '',
    'parameter' => '',
];
$completedJob = array_merge($mockJob, ['color' => 'red']);

// ── Card definitions ──────────────────────────────────────────────────
$cases = [
    [
        'key'        => 'long_running_l1',
        'label'      => '🐢  long_running_l1 — นาน 2.5 hr (3.3x baseline)',
        'job'        => $mockJob,
        'transition' => 'long_running_l1',
        'extra'      => ['runningForMs'=>9000000,'estimatedMs'=>$baselineMs,'baselineSource'=>'median-5','sampleCount'=>5,'level'=>1],
    ],
    [
        'key'        => 'long_running_l2',
        'label'      => '🚨  long_running_l2 — นาน 14 hr (18x baseline)',
        'job'        => array_merge($mockJob, ['lastBuild' => array_merge($mockJob['lastBuild'],['timestamp'=>(time()-50400)*1000])]),
        'transition' => 'long_running_l2',
        'extra'      => ['runningForMs'=>50400000,'estimatedMs'=>$baselineMs,'baselineSource'=>'median-5','sampleCount'=>5,'level'=>2],
    ],
    [
        'key'        => 'slow_resolved_success',
        'label'      => '✅  slow_resolved_success — เสร็จ SUCCESS หลัง 5 hr',
        'job'        => array_merge($completedJob, ['lastBuild' => array_merge($mockJob['lastBuild'],['result'=>'SUCCESS','duration'=>18000000])]),
        'transition' => 'slow_resolved_success',
        'extra'      => ['runningForMs'=>18000000,'estimatedMs'=>$baselineMs,'baselineSource'=>'median-5','sampleCount'=>5],
    ],
    [
        'key'        => 'slow_resolved_failure',
        'label'      => '❌  slow_resolved_failure — เสร็จ FAILURE หลัง 8 hr',
        'job'        => array_merge($completedJob, ['lastBuild' => array_merge($mockJob['lastBuild'],['result'=>'FAILURE','duration'=>28800000])]),
        'transition' => 'slow_resolved_failure',
        'extra'      => ['runningForMs'=>28800000,'estimatedMs'=>$baselineMs,'baselineSource'=>'median-5','sampleCount'=>5],
    ],
];

// ── Run ───────────────────────────────────────────────────────────────
$webhookUrl = $argv[1] ?? null;

foreach ($cases as $c) {
    echo "\n" . str_repeat('─', 62) . "\n";
    echo $c['label'] . "\n";
    echo str_repeat('─', 62) . "\n";

    $card = bmn_buildCard('Jenkins-PROD','http://jenkins.example.com',
                          $c['job'], $c['transition'], $mockMeta, $c['extra']);

    $h        = $card['cardsV2'][0]['card']['header'];
    $sections = $card['cardsV2'][0]['card']['sections'];
    echo "  title:    " . $h['title']    . "\n";
    echo "  subtitle: " . $h['subtitle'] . "\n";
    echo "  sections: " . count($sections) . "\n";
    foreach ($sections as $i => $sec) {
        $hdr = $sec['header'] ?? '(no header)';
        $cnt = count($sec['widgets'] ?? []);
        echo "    [{$i}] {$hdr}  ({$cnt} widget" . ($cnt!==1?'s':'') . ")\n";
    }

    if ($webhookUrl) {
        $res = postToChatThread($webhookUrl, $card, 'bmn-test-' . $c['key']);
        $ok  = ($res['sent'] ?? false) ? "SENT ✓  HTTP " . ($res['httpCode']??'?') : "FAIL: " . ($res['reason']??'?');
        echo "  send: {$ok}\n";
    }
}

echo "\n";
if (!$webhookUrl) {
    echo "Pass a Google Chat webhook URL as argv[1] to actually send the cards.\n";
}
