<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// ── GET ─────────────────────────────────────────────────
if ($method === 'GET') {
    $action = $_GET['action'] ?? '';
    if ($action === 'config') {
        if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
        $data = readJson('incident-launcher-config.json');
        respond(['config' => $data ?: (object)[]]);
    }
    if ($action === 'impact_summary') {
        // Delegate to comprehensive multi-layer analyzer
        require __DIR__ . '/impact.php';
        exit;
    }

    if ($action === 'jira_transitions') {
        if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
        $key = trim($_GET['key'] ?? '');
        if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
        if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);
        $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/transitions');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 12,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
                'Accept: application/json',
            ],
        ]);
        $resp = curl_exec($ch);
        $err  = curl_error($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($err)          respondError('Jira error: ' . $err, 502);
        if ($code !== 200) respondError('Jira HTTP ' . $code, 502);
        $data = json_decode($resp, true);
        // Also include fields for each transition (for Investigating form)
        $trans = array_map(function($t) {
            $fields = [];
            foreach (($t['fields'] ?? []) as $key => $f) {
                $fields[$key] = [
                    'name'          => $f['name']          ?? $key,
                    'required'      => $f['required']       ?? false,
                    'schema'        => $f['schema']         ?? [],
                    'allowedValues' => $f['allowedValues']  ?? [],
                ];
            }
            return ['id' => $t['id'], 'name' => $t['name'], 'fields' => $fields];
        }, $data['transitions'] ?? []);
        respond(['transitions' => $trans]);
    }

    if ($action === 'jira_create_meta') {
        if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
        if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);
        $project   = trim($_GET['project']   ?? 'SMC');
        $issueType = trim($_GET['issuetype'] ?? 'Incident');
        $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/createmeta'
            . '?projectKeys=' . urlencode($project)
            . '&issuetypeNames=' . urlencode($issueType)
            . '&expand=projects.issuetypes.fields');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
                'Accept: application/json',
            ],
        ]);
        $resp = curl_exec($ch);
        $err  = curl_error($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($err) respondError('Jira error: ' . $err, 502);
        if ($code !== 200) respondError('Jira HTTP ' . $code, 502);
        $data = json_decode($resp, true);
        $rawFields = $data['projects'][0]['issuetypes'][0]['fields'] ?? [];
        // Normalize and return only useful fields
        $skip = ['summary','issuetype','project','reporter','assignee','attachment','labels','description'];
        $fields = [];
        foreach ($rawFields as $key => $f) {
            if (in_array($key, $skip)) continue;
            $entry = [
                'field_id'      => $key,
                'label'         => $f['name']     ?? $key,
                'required'      => $f['required']  ?? false,
                'schema_type'   => $f['schema']['type']   ?? 'string',
                'schema_system' => $f['schema']['system'] ?? '',
                'allowedValues' => [],
            ];
            foreach (($f['allowedValues'] ?? []) as $av) {
                $entry['allowedValues'][] = [
                    'id'    => $av['id']    ?? $av['value'] ?? '',
                    'name'  => $av['value'] ?? $av['name']  ?? '',
                ];
            }
            $fields[$key] = $entry;
        }
        respond(['fields' => $fields]);
    }

    if ($action === 'jira_issue') {
        if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
        $key = trim($_GET['key'] ?? '');
        if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
        if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);
        $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '?fields=summary,status,priority,assignee');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
                'Accept: application/json',
            ],
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code !== 200) respondError('Jira HTTP ' . $code, 502);
        $d = json_decode($resp, true);
        respond(['issue' => [
            'key'      => $d['key']                         ?? $key,
            'summary'  => $d['fields']['summary']           ?? '',
            'status'   => $d['fields']['status']['name']    ?? '',
            'priority' => $d['fields']['priority']['name']  ?? '',
            'assignee' => $d['fields']['assignee']['displayName'] ?? '',
        ]]);
    }

    if ($action === 'bo_config_peek') {
        if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
        require_once __DIR__ . '/../ma-status/_backoffice.php';
        $app = trim($_GET['application'] ?? '');
        $key = trim($_GET['key']         ?? '');
        if (!$app || !$key) respondError('application and key required', 400);
        $r = backofficeCall('GET', '/acm-backoffice-api-gateway/ops-service-maintenance-server/application/list');
        if (!$r['ok']) respondError('Backoffice error: ' . ($r['error'] ?? 'unknown'), 502);
        $found = null;
        foreach (($r['data']['data']['contents'] ?? []) as $a) {
            if (strcasecmp((string)($a['application_name'] ?? ''), $app) !== 0) continue;
            foreach (($a['properties'] ?? []) as $p) {
                if (strcasecmp((string)($p['property_key'] ?? ''), $key) !== 0) continue;
                $found = [
                    'application'    => (string)($a['application_name'] ?? ''),
                    'key'            => (string)($p['property_key']     ?? ''),
                    'value'          => (string)($p['property_value']   ?? ''),
                    'property_group' => (string)($p['property_group']   ?? ''),
                    'property_id'    => (int)($p['property_id']         ?? 0),
                ];
                break 2;
            }
        }
        if (!$found) respondError("Not found: application=\"$app\" key=\"$key\"", 404);
        respond(['property' => $found]);
    }

    respondError('Unknown action', 400);
}

if ($method !== 'POST') respondError('Method not allowed', 405);
$body   = getBody();
$action = $body['action'] ?? '';

// ── POST: BO Config update (edit value via Admin Portal) ─
if ($action === 'bo_config_update') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
    require_once __DIR__ . '/../ma-status/_backoffice.php';

    $app   = trim($body['application']  ?? '');
    $key   = trim($body['key']          ?? '');
    $val   = (string)($body['value']    ?? '');
    $env   = trim($body['environment']  ?? 'production');
    $prof  = trim($body['profile']      ?? 'main');
    if (!$app || !$key) respondError('application and key required', 400);
    if ($env === '')    $env  = 'production';
    if ($prof === '')   $prof = 'main';
    if (mb_strlen($val) > 5000) respondError('value too long', 400);

    // Fetch current property metadata (group, description, type)
    $listRes = backofficeCall('GET', '/acm-backoffice-api-gateway/ops-service-maintenance-server/application/list');
    $group = 'default'; $desc = ''; $type = 'string';
    if ($listRes['ok']) {
        foreach (($listRes['data']['data']['contents'] ?? []) as $a) {
            if (strcasecmp((string)($a['application_name'] ?? ''), $app) !== 0) continue;
            foreach (($a['properties'] ?? []) as $p) {
                if (strcasecmp((string)($p['property_key'] ?? ''), $key) !== 0) continue;
                $group = (string)($p['property_group']       ?? 'default');
                $desc  = (string)($p['property_description'] ?? '');
                $type  = (string)($p['property_type']        ?? 'string');
                break 2;
            }
        }
    }

    $updatedBy = (string)($payload['email'] ?? $payload['username'] ?? $payload['name'] ?? 'som-portal');
    $putBody = [
        'updated_by' => $updatedBy,
        'source' => [
            $key => [
                'value'       => $val,
                'description' => $desc,
                'type'        => $type ?: 'string',
                'group'       => $group ?: 'default',
            ],
        ],
    ];

    $path = '/acm-backoffice-api-gateway/ops-service-maintenance-server/config/' . rawurlencode($app) . '/' . rawurlencode($env) . '/' . rawurlencode($prof);
    $res  = backofficeCall('PUT', $path, $putBody, 15);

    $uid = (string)($payload['sub'] ?? '');
    logActivity('bo_config_update', [
        'application' => $app, 'environment' => $env, 'profile' => $prof,
        'key' => $key, 'value_length' => mb_strlen($val),
        'result' => $res['ok'] ? 'ok' : 'error',
        'upstream_error' => $res['error'] ?? null,
    ], $uid, $payload['name'] ?? '');

    if (!$res['ok']) respondError('Admin Portal error: ' . ($res['error'] ?? 'unknown'), 502);
    respond(['updated' => true, 'application' => $app, 'key' => $key, 'new_value' => $val]);
}

// ── POST: Jira transition (Investigating) ───────────────
if ($action === 'jira_do_transition') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
    $key   = trim($body['key']           ?? '');
    $tid   = trim($body['transition_id'] ?? '');
    $extra = $body['fields']             ?? [];
    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
    if (!$tid)  respondError('transition_id required', 400);
    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $reqBody = ['transition' => ['id' => $tid]];
    if (!empty($extra) && is_array($extra)) {
        $reqBody['fields'] = $extra;
    }
    $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/transitions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($reqBody),
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Content-Type: application/json',
            'Accept: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($err)             respondError('Jira error: ' . $err, 502);
    if ($code >= 400)     respondError('Jira HTTP ' . $code . ': ' . substr($resp,0,200), 502);
    logActivity('incident_launcher_jira_transition', ['key'=>$key,'transition'=>$tid], $payload['sub'], $payload['name']??'');
    respond(['ok' => true, 'key' => $key]);
}

// ── POST: legacy single-webhook proxy ───────────────────
if ($action === 'webhook') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
    $url  = trim($body['url'] ?? '');
    $text = trim($body['text'] ?? '');
    if (!$url)  respondError('Webhook URL required', 400);
    if (!$text) respondError('Message text required', 400);
    if (!str_starts_with($url, 'https://chat.googleapis.com/'))
        respondError('URL must be a Google Chat webhook', 400);
    _curlPost($url, json_encode(['text' => $text]), ['Content-Type: application/json']);
    logActivity('incident_launcher_webhook', ['url_prefix' => substr($url, 0, 60)], $payload['sub'], $payload['name'] ?? '');
    respond(['ok' => true]);
}

// ── POST: notify a configured channel ───────────────────
if ($action === 'notify_channel') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);

    $channel_id = trim($body['channel_id'] ?? '');
    $message    = trim($body['message']    ?? '');
    if (!$channel_id) respondError('channel_id required', 400);
    if (!$message)    respondError('message required', 400);

    $cfg      = readJson('incident-launcher-config.json');
    $channel  = null;
    foreach ((array)($cfg['channels'] ?? []) as $ch) {
        if (($ch['id'] ?? '') === $channel_id) { $channel = $ch; break; }
    }
    if (!$channel) respondError('Channel not found', 404);

    $platform = $channel['platform'] ?? 'manual';
    $auth     = trim($channel['auth'] ?? '');

    if ($platform === 'manual') {
        // Manual = copy only, no HTTP call needed
        respond(['ok' => true, 'manual' => true]);
    }

    if (!$auth) respondError('No webhook / token configured for this channel', 400);

    /* optional: reply in existing thread */
    $thread_key = trim($body['thread_key'] ?? '');

    switch ($platform) {
        case 'googlechat':
            $gc_url  = $auth;
            $gc_body = ['text' => $message];
            if ($thread_key !== '') {
                // Append messageReplyOption to URL for threading
                $sep     = str_contains($gc_url, '?') ? '&' : '?';
                $gc_url .= $sep . 'messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';
                $gc_body['thread'] = ['threadKey' => $thread_key];
            }
            _curlPost($gc_url, json_encode($gc_body), ['Content-Type: application/json']);
            break;

        case 'dingtalk':
            _curlPost($auth, json_encode([
                'msgtype' => 'text',
                'text'    => ['content' => $message],
            ]), ['Content-Type: application/json']);
            break;

        case 'line':
            // LINE Notify: $auth = Bearer token, fixed URL
            _curlPost(
                'https://notify-api.line.me/api/notify',
                http_build_query(['message' => "\n" . $message]),
                [
                    'Content-Type: application/x-www-form-urlencoded',
                    'Authorization: Bearer ' . $auth,
                ]
            );
            break;

        default:
            respondError('Unknown platform: ' . htmlspecialchars($platform), 400);
    }

    logActivity('incident_launcher_channel_notify',
        ['channel' => $channel['name'] ?? '', 'platform' => $platform],
        $payload['sub'], $payload['name'] ?? '');
    respond(['ok' => true]);
}

// ── POST: save config ────────────────────────────────────
if ($action === 'save_config') {
    if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
    if (!in_array($payload['role'] ?? '', ['sm_admin', 'dev_sm', 'sm_lead']))
        respondError('Admin/Lead only', 403);

    $cfg = $body['config'] ?? [];

    // partner_groups
    $partner_groups = [];
    foreach ((array)($cfg['partner_groups'] ?? []) as $g) {
        if (empty($g['name'])) continue;
        $filterEmails = fn($arr) => array_values(array_filter(
            array_map('trim', (array)$arr),
            fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
        ));
        // Support new to_emails/cc_emails/bcc_emails or legacy flat emails
        $toEmails  = $filterEmails($g['to_emails']  ?? $g['emails'] ?? []);
        $ccEmails  = $filterEmails($g['cc_emails']  ?? []);
        $bccEmails = $filterEmails($g['bcc_emails'] ?? []);
        $partner_groups[] = [
            'id'        => preg_replace('/[^a-z0-9_]/', '', strtolower($g['id'] ?? 'grp_' . time())),
            'name'      => trim($g['name']),
            'color'     => preg_match('/^#[0-9a-fA-F]{3,6}$/', $g['color'] ?? '') ? $g['color'] : '#3b82f6',
            'to_emails' => $toEmails,
            'cc_emails' => $ccEmails,
            'bcc_emails'=> $bccEmails,
            'emails'    => $toEmails, // backward compat
        ];
    }

    // templates
    $templates = [];
    foreach ((array)($cfg['templates'] ?? []) as $t) {
        if (empty($t['name'])) continue;
        $templates[] = [
            'id'               => preg_replace('/[^a-z0-9_]/', '', strtolower($t['id'] ?? 'tpl_' . time())),
            'name'             => trim($t['name']),
            'icon'             => preg_replace('/[^a-z0-9\-]/', '', $t['icon'] ?? 'zap') ?: 'zap',
            'color'            => preg_match('/^#[0-9a-fA-F]{3,6}$/', $t['color'] ?? '') ? $t['color'] : '#ef4444',
            'service'          => trim($t['service'] ?? ''),
            'severity'         => in_array($t['severity'] ?? '', ['sev1','sev2','sev3']) ? $t['severity'] : 'sev1',
            'description'      => trim($t['description'] ?? ''),
            'partner_group_ids'=> array_values(array_map('strval', (array)($t['partner_group_ids'] ?? []))),
            'jira_summary'     => trim($t['jira_summary'] ?? ''),
        ];
    }

    // ma_jobs
    $ma_jobs = [];
    foreach ((array)($cfg['ma_jobs'] ?? []) as $j) {
        if (empty($j['name'])) continue;
        $type = in_array($j['type'] ?? '', ['jenkins','rundeck','manual']) ? $j['type'] : 'manual';
        // Sanitize bo_configs array
        $bo_configs = [];
        foreach ((array)($j['bo_configs'] ?? []) as $bc) {
            $app = trim($bc['application'] ?? '');
            $key = trim($bc['key'] ?? '');
            if (!$app || !$key) continue;
            $env  = trim($bc['environment'] ?? 'production') ?: 'production';
            $prof = trim($bc['profile']     ?? 'main')       ?: 'main';
            $bo_configs[] = [
                'label'       => trim($bc['label'] ?? ''),
                'application' => $app,
                'key'         => $key,
                'environment' => $env,
                'profile'     => $prof,
                'editable'    => (bool)($bc['editable'] ?? false),
            ];
        }
        $ma_jobs[] = [
            'id'         => preg_replace('/[^a-z0-9_]/', '', strtolower($j['id'] ?? 'ma_' . time())),
            'name'       => trim($j['name']),
            'type'       => $type,
            'server_id'  => trim($j['server_id'] ?? ''),
            'job_path'   => trim($j['job_path'] ?? ''),
            'url'        => filter_var(trim($j['url'] ?? ''), FILTER_SANITIZE_URL),
            'optional'   => (bool)($j['optional'] ?? false),
            'notes'      => trim($j['notes'] ?? ''),
            'bo_configs' => $bo_configs,
            'enabled'    => (bool)($j['enabled'] ?? true),
        ];
    }

    // jira_preset_fields
    $jira_preset_fields = [];
    foreach ((array)($cfg['jira_preset_fields'] ?? []) as $f) {
        if (empty($f['field_id'])) continue;
        $jira_preset_fields[] = [
            'field_id' => trim($f['field_id']),
            'label'    => trim($f['label'] ?? ''),
            'value'    => trim($f['value'] ?? ''),
        ];
    }

    // quick_links
    $quick_links = [];
    foreach ((array)($cfg['quick_links'] ?? []) as $l) {
        if (empty($l['label']) || empty($l['url'])) continue;
        $quick_links[] = [
            'id'    => preg_replace('/[^a-z0-9_]/', '', strtolower($l['id'] ?? 'lnk_' . time())),
            'label' => trim($l['label']),
            'icon'  => preg_replace('/[^a-z0-9\-]/', '', $l['icon'] ?? 'link') ?: 'link',
            'url'   => filter_var(trim($l['url']), FILTER_SANITIZE_URL),
        ];
    }

    // channels
    $channels = [];
    foreach ((array)($cfg['channels'] ?? []) as $c) {
        if (empty($c['name'])) continue;
        $platform = in_array($c['platform'] ?? '', ['googlechat','line','dingtalk','manual'])
            ? $c['platform'] : 'manual';
        $channels[] = [
            'id'               => preg_replace('/[^a-z0-9_]/', '', strtolower($c['id'] ?? 'ch_' . time())),
            'name'             => trim($c['name']),
            'platform'         => $platform,
            'auth'             => trim($c['auth'] ?? ''),
            'template_alert'   => trim($c['template_alert']    ?? ''),
            'template_resolved'=> trim($c['template_resolved'] ?? ''),
            'enabled'          => (bool)($c['enabled'] ?? true),
        ];
    }

    // sp_services — list of service names for Step 8
    $sp_services = array_values(array_filter(
        array_map('trim', (array)($cfg['sp_services'] ?? [])),
        fn($s) => $s !== ''
    ));

    // cases — incident type definitions
    $cases = [];
    foreach ((array)($cfg['cases'] ?? []) as $c) {
        if (empty($c['name'])) continue;
        $cases[] = [
            'id'               => preg_replace('/[^a-z0-9_]/', '', strtolower($c['id'] ?? 'case_' . time())),
            'name'             => trim($c['name']),
            'icon'             => preg_replace('/[^a-z0-9\-]/', '', $c['icon'] ?? 'zap') ?: 'zap',
            'color'            => preg_match('/^#[0-9a-fA-F]{3,6}$/', $c['color'] ?? '') ? $c['color'] : '#ef4444',
            'description'      => trim($c['description'] ?? ''),
            'default_title'    => trim($c['default_title']   ?? ''),
            'default_service'  => trim($c['default_service'] ?? ''),
            'default_severity' => in_array($c['default_severity'] ?? '', ['sev1','sev2','sev3']) ? $c['default_severity'] : 'sev1',
            'ma_job_ids'        => array_values(array_map('strval', (array)($c['ma_job_ids']        ?? []))),
            'channel_ids'       => array_values(array_map('strval', (array)($c['channel_ids']       ?? []))),
            'partner_group_ids' => array_values(array_map('strval', (array)($c['partner_group_ids'] ?? []))),
            'sp_services'       => array_values(array_filter(
                array_map('trim', (array)($c['sp_services'] ?? [])),
                fn($s) => $s !== ''
            )),
        ];
    }

    $save = [
        'chat_webhook_url'          => trim($cfg['chat_webhook_url'] ?? ''),
        'meet_main_url'             => trim($cfg['meet_main_url']      ?? ''),
        'meet_channel_ids'          => array_values(array_filter(array_map('trim', (array)($cfg['meet_channel_ids'] ?? [])))),
        'meet_msg_tpl'              => trim($cfg['meet_msg_tpl']      ?? ''),
        'jira_issue_type'           => trim($cfg['jira_issue_type'] ?? 'Monitoring') ?: 'Monitoring',
        'jira_default_severity'     => in_array($cfg['jira_default_severity'] ?? '', ['sev1','sev2','sev3']) ? $cfg['jira_default_severity'] : 'sev1',
        'jira_summary_tpl'          => trim($cfg['jira_summary_tpl']  ?? ''),
        'jira_detected_by'          => trim($cfg['jira_detected_by']  ?? ''),
        'jira_desc_tpl'             => trim($cfg['jira_desc_tpl']     ?? ''),
        'jira_field_defaults'       => [
            'bu'          => array_values(array_filter(array_map('trim', (array)($cfg['jira_field_defaults']['bu']          ?? [])))),
            'svc'         => array_values(array_filter(array_map('trim', (array)($cfg['jira_field_defaults']['svc']         ?? [])))),
            'chn'         => array_values(array_filter(array_map('trim', (array)($cfg['jira_field_defaults']['chn']         ?? [])))),
            'detected'    => trim($cfg['jira_field_defaults']['detected']    ?? 'Service Monitoring (SM)'),
            'third_party' => trim($cfg['jira_field_defaults']['third_party'] ?? ''),
        ],
        'jira_escalate_transition'  => trim($cfg['jira_escalate_transition'] ?? ''),
        'partner_groups'            => $partner_groups,
        'templates'                 => $templates,
        'quick_links'               => $quick_links,
        'channels'                  => $channels,
        'ma_jobs'                   => $ma_jobs,
        'cases'                     => $cases,
        'jira_preset_fields'        => $jira_preset_fields,
        'sp_services'               => $sp_services,
        'updated_at'                => time(),
        'updated_by'                => $payload['name'] ?? $payload['sub'] ?? '',
    ];

    writeJson('incident-launcher-config.json', $save);
    logActivity('incident_launcher_config_save',
        ['channels' => count($channels), 'templates' => count($templates), 'ma_jobs' => count($ma_jobs)],
        $payload['sub'], $payload['name'] ?? '');
    respond(['ok' => true]);
}

respondError('Unknown action', 400);

// ── Helper ────────────────────────────────────────────────
function _curlPost(string $url, string $body, array $headers): void {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($err)                        respondError('cURL error: ' . $err, 502);
    if ($code < 200 || $code >= 300) respondError("Webhook HTTP $code: $res", 502);
}
