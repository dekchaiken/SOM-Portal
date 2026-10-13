<?php
// ══════════════════════════════════════════════════════════════════
//  MA Status Aggregator
//  Pulls live maintenance flags from 3 upstream sources and joins
//  them against the team's ma-services.json for the dashboard UI.
//
//  Sources:
//    1) NANO products.json on CloudFront (public HTTPS, no auth)
//    2) TMN-OPS Jenkins jobs (Basic auth via jenkins_servers.json)
//    3) ACM backoffice OAuth API (Keycloak password grant → JWT)
//
//  Response shape:
//    {
//      sources: {
//        nano:      { ok, fetched_at, items:[{name,label,type,status,updated_at,link}] },
//        tmn_jenkins:{ ok, fetched_at, items:[...] },
//        tmn_backoffice:{ ok, fetched_at, items:[...] },
//      },
//      services: [                       // joined view keyed by ma-services.json
//        { id, service_name, service_type, tool_type,
//          matched: true|false, status: 'open'|'closed'|'unknown',
//          source, upstream_ref, updated_at, url }
//      ],
//      unmapped_backoffice: [...]        // items backoffice knows but ma-services doesn't
//    }
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_backoffice.php';

$payload = requireAuth(); // any logged-in user can view MA status

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') respondError('Method not allowed', 405);

$sourceFilter = trim($_GET['source'] ?? 'all'); // all | nano | tmn_jenkins | tmn_backoffice
$force        = !empty($_GET['refresh']);       // ?refresh=1 → bypass 15s server cache

// ── Server-side cache (per-team, 15s TTL) ─────────────────────────
$CACHE_TTL = 15;
$cacheFile = 'ma-status-cache.json';
if (!$force) {
    $cache = readJson($cacheFile);
    if (!empty($cache['ts']) && (time() - $cache['ts']) < $CACHE_TTL) {
        if ($sourceFilter === 'all' || $sourceFilter === ($cache['filter'] ?? 'all')) {
            $out = $cache['payload'] ?? [];
            $out['cached']    = true;
            $out['cache_age'] = time() - $cache['ts'];
            respondOk($out);
        }
    }
}

// ─────────────────────────────────────────────────────────────────
//  Source 1: NANO products.json via CloudFront (public)
// ─────────────────────────────────────────────────────────────────
function ma_fetch_nano(): array {
    // Load NANO-internal Jenkins auth for the author-lookup call
    $servers = readJson('jenkins_servers.json');
    $nanoSrv = null;
    foreach ($servers as $s) {
        if (($s['display'] ?? '') === 'NANO-internal') { $nanoSrv = $s; break; }
    }

    // Run CDN fetch + Jenkins build-history fetch in parallel
    $chCdn = curl_init('https://cdn-loan-product.ascendnano.com/products.json');
    curl_setopt_array($chCdn, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 4,   CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 ma-status',
    ]);

    $chJenkins = null;
    if ($nanoSrv) {
        $base  = rtrim($nanoSrv['base_url'], '/');
        $jUser = $nanoSrv['auth_user']  ?? '';
        $jTok  = $nanoSrv['auth_token'] ?? '';
        $jCook = $nanoSrv['auth_cookie'] ?? '';
        // Last 200 builds covers all 7×6=42 PRODUCT+FLOW combos with room to spare
        $jUrl  = $base . '/job/MA_PAGE/api/json?tree=builds%5Bnumber,timestamp,actions%5Bparameters%5Bname,value%5D,causes%5BshortDescription,userId,userName%5D%5D%5D%7B0,200%7D';
        $chJenkins = curl_init($jUrl);
        $jHeaders = ['Accept: application/json'];
        if ($jTok) $jHeaders[] = 'Authorization: Basic ' . base64_encode("$jUser:$jTok");
        curl_setopt_array($chJenkins, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 4,   CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false, CURLOPT_HTTPHEADER => $jHeaders,
        ]);
        if ($jCook) curl_setopt($chJenkins, CURLOPT_COOKIE, $jCook);
    }

    $mh = curl_multi_init();
    curl_multi_add_handle($mh, $chCdn);
    if ($chJenkins) curl_multi_add_handle($mh, $chJenkins);
    do { curl_multi_exec($mh, $still); curl_multi_select($mh); } while ($still > 0);

    $cdnBody  = curl_multi_getcontent($chCdn);
    $cdnCode  = curl_getinfo($chCdn, CURLINFO_HTTP_CODE);
    $jBody    = $chJenkins ? curl_multi_getcontent($chJenkins) : null;
    $jCode    = $chJenkins ? curl_getinfo($chJenkins, CURLINFO_HTTP_CODE) : 0;

    curl_multi_remove_handle($mh, $chCdn);
    if ($chJenkins) curl_multi_remove_handle($mh, $chJenkins);
    curl_multi_close($mh);
    curl_close($chCdn);
    if ($chJenkins) curl_close($chJenkins);

    if ($cdnCode !== 200 || !$cdnBody) {
        return ['ok' => false, 'error' => "CDN HTTP $cdnCode", 'items' => []];
    }

    // Build PRODUCT:FLOW → author map from Jenkins build history
    // builds[] is newest-first, so first hit per key = most recent toggle
    $authors = [];
    if ($jCode === 200 && $jBody) {
        $jData = json_decode($jBody, true) ?? [];
        foreach (($jData['builds'] ?? []) as $bld) {
            $product = null; $flow = null; $trigger = null;
            foreach (($bld['actions'] ?? []) as $a) {
                foreach (($a['parameters'] ?? []) as $p) {
                    if (($p['name'] ?? '') === 'PRODUCT') $product = $p['value'] ?? null;
                    if (($p['name'] ?? '') === 'FLOW')    $flow    = $p['value'] ?? null;
                }
                if (!$trigger) {
                    foreach (($a['causes'] ?? []) as $c) {
                        $trigger = $c['userName'] ?? $c['userId'] ?? null;
                        if (!$trigger && preg_match('/Started by user (.+)$/i', $c['shortDescription'] ?? '', $cm))
                            $trigger = trim($cm[1]);
                        if ($trigger) break;
                    }
                }
            }
            $key = "$product:$flow";
            if ($product && $flow && !isset($authors[$key])) {
                $ts = !empty($bld['timestamp']) ? (int)($bld['timestamp'] / 1000) : null;
                $authors[$key] = ['user' => $trigger, 'ts' => $ts];
            }
        }
    }

    $data = json_decode($cdnBody, true);
    $items = [];
    foreach (($data['products'] ?? []) as $p) {
        $prodName  = $p['name'] ?? '';
        $prodLabel = $p['display_name'] ?? $prodName;
        foreach (($p['ma_list'] ?? []) as $ma) {
            $subType = $ma['type'] ?? '';
            $status  = !empty($ma['status']) ? 'closed' : 'open';
            $entry   = $authors["$prodName:$subType"] ?? null;
            $items[] = [
                'name'         => $prodName . ':' . $subType,
                'label'        => $prodLabel . ' — ' . $subType,
                'product'      => $prodName,
                'sub_service'  => $subType,
                'type'         => 'nano_product',
                'status'       => $status,
                'triggered_by' => $entry['user'] ?? null,
                'triggered_at' => $entry['ts']   ?? null,
                'link'         => $base . '/job/MA_PAGE/',
            ];
        }
    }
    return ['ok' => true, 'fetched_at' => time(), 'items' => $items];
}

// ─────────────────────────────────────────────────────────────────
//  Source 2: TMN-OPS Jenkins jobs (Basic auth)
//  Hardcoded seed of 4 verified jobs; extendable per team via
//  data/{team}/ma-status-jenkins.json (same array shape).
// ─────────────────────────────────────────────────────────────────
function ma_fetch_jenkins(): array {
    $jobs = ma_effective_jenkins_jobs();

    // Load Jenkins servers from the team's config. Ignore the "enabled" flag
    // here: this endpoint targets specific servers by display-name, and the
    // enabled toggle is meant for the general jenkins-proxy list, not MA lookup.
    $servers = readJson('jenkins_servers.json');
    $byName  = [];
    foreach ($servers as $s) {
        if (!empty($s['display'])) $byName[$s['display']] = $s;
    }

    $items = [];
    foreach ($jobs as $job) {
        $srv = $byName[$job['server']] ?? null;
        if (!$srv) {
            $items[] = [
                'name' => $job['path'], 'label' => $job['label'],
                'type' => 'tmn_jenkins', 'status' => 'unknown',
                'error' => "server not configured: {$job['server']}",
            ];
            continue;
        }
        $url = rtrim($srv['base_url'], '/') . $job['path']
             . '/lastBuild/api/json?tree=number,timestamp,result,url,actions%5Bparameters%5Bname,value%5D,causes%5BshortDescription,userId,userName%5D%5D';
        $ch  = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 ma-status',
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json',
                'Authorization: Basic ' . base64_encode(($srv['auth_user'] ?? '') . ':' . ($srv['auth_token'] ?? '')),
            ],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || !$body) {
            $items[] = [
                'name' => $job['path'], 'label' => $job['label'],
                'type' => 'tmn_jenkins', 'status' => 'unknown',
                'error' => "Jenkins HTTP $code",
                'link'  => rtrim($srv['base_url'], '/') . $job['path'] . '/',
            ];
            continue;
        }
        $d = json_decode($body, true) ?? [];
        // Extract state param from lastBuild.actions[].parameters[]
        // Pipeline (WorkflowRun) embeds causes inside actions[] as CauseAction,
        // not at root level — iterate once over actions to get both parameters + causes.
        $stateVal = null; $extraVal = null; $triggeredBy = null;
        foreach (($d['actions'] ?? []) as $a) {
            foreach (($a['parameters'] ?? []) as $p) {
                if (($p['name'] ?? '') === $job['state_param']) {
                    $stateVal = $p['value'] ?? null;
                }
                if (!empty($job['extra_param']) && ($p['name'] ?? '') === $job['extra_param']) {
                    $extraVal = $p['value'] ?? null;
                }
            }
            if ($triggeredBy === null) {
                foreach (($a['causes'] ?? []) as $c) {
                    if (!empty($c['userName']))       { $triggeredBy = $c['userName']; break; }
                    if (!empty($c['userId']))         { $triggeredBy = $c['userId'];   break; }
                    if (!empty($c['shortDescription'])) {
                        if (preg_match('/^Started by user (.+)$/i', $c['shortDescription'], $cm)) {
                            $triggeredBy = trim($cm[1]);
                        } elseif (stripos($c['shortDescription'], 'timer') !== false) {
                            $triggeredBy = 'Timer';
                        } elseif (stripos($c['shortDescription'], 'upstream') !== false) {
                            $triggeredBy = 'Upstream';
                        }
                        break;
                    }
                }
            }
        }

        $isOn = in_array($stateVal, $job['on_values'] ?? [], true);
        $status = $stateVal === null ? 'unknown' : ($isOn ? 'closed' : 'open');
        $items[] = [
            'name'         => $job['path'],
            'label'        => $job['label']
                           . ($extraVal !== null ? " ({$extraVal})" : ''),
            'type'         => 'tmn_jenkins',
            'status'       => $status,
            'state_value'  => $stateVal,
            'extra_value'  => $extraVal,
            'build_number' => $d['number'] ?? null,
            'build_result' => $d['result'] ?? null,
            'updated_at'   => !empty($d['timestamp']) ? (int)($d['timestamp'] / 1000) : null,
            'triggered_by' => $triggeredBy,
            'link'         => rtrim($srv['base_url'], '/') . $job['path'] . '/',
            'critical'     => !empty($job['critical']),
            'note'         => $job['note'] ?? null,
        ];
    }
    return ['ok' => true, 'fetched_at' => time(), 'items' => $items];
}

// ─────────────────────────────────────────────────────────────────
//  Source 3: ACM backoffice OAuth API
//  Token + curl live in _backoffice.php so ma-services write endpoint
//  can reuse them without duplicating Keycloak logic.
// ─────────────────────────────────────────────────────────────────
function ma_fetch_backoffice(): array {
    $res = backofficeCall('GET', '/acm-backoffice-api-gateway/ops-service-maintenance-server/config/use-cases/search?pageSize=500');
    if (!$res['ok']) {
        return ['ok' => false, 'error' => $res['error'] ?? 'backoffice fetch failed', 'items' => []];
    }
    $d = is_array($res['data']) ? $res['data'] : [];
    $items = [];
    foreach (($d['content'] ?? []) as $r) {
        $items[] = [
            'name'        => 'bo:' . ($r['use_case_id'] ?? ''),
            'label'       => $r['use_case_name'] ?? '',
            'use_case_id' => $r['use_case_id'] ?? null,
            'type'        => 'tmn_backoffice',
            'status'      => !empty($r['ma_enable']) ? 'closed' : 'open',
            'updated_at'  => $r['updated_at'] ?? null,     // string dd/mm/yyyy hh:mm:ss
            'updated_by'  => $r['updated_by'] ?? null,
            'category'    => $r['use_case_type'] ?? null,  // 'client' | 'use_case'
        ];
    }
    return [
        'ok'             => true,
        'fetched_at'     => time(),
        'items'          => $items,
        'total_upstream' => $d['totalElements'] ?? count($items),
    ];
}

// ─────────────────────────────────────────────────────────────────
//  Source 4: TMN Mobile Gateway feature toggles
//  Parsed from the acm-tmn-mobile-gateway-feature-toggle Jenkins job's
//  console log — that log echoes the full feature-toggle.yml every time
//  the job runs (which is every time an ops user toggles a feature),
//  so it's a reliable-enough source of truth without needing to figure
//  out the Config Server file endpoint.
// ─────────────────────────────────────────────────────────────────
function ma_fetch_features(): array {
    $servers = readJson('jenkins_servers.json');
    $srv = null;
    foreach ($servers as $s) {
        if (($s['display'] ?? '') === 'TMN-OPS') { $srv = $s; break; }
    }
    if (!$srv) return ['ok' => false, 'error' => 'TMN-OPS Jenkins server not configured', 'items' => []];

    $jobPath = '/view/Config%20Service/job/acm-tmn-mobile-gateway-feature-toggle';
    $authHeader = 'Authorization: Basic ' . base64_encode(($srv['auth_user'] ?? '') . ':' . ($srv['auth_token'] ?? ''));
    $base = rtrim($srv['base_url'], '/');

    // Fetch build history (last 150 builds) in parallel with consoleText.
    // Each build toggles one feature (feature_name param), so scanning history
    // gives us per-feature author attribution rather than blaming lastBuild's user.
    $histUrl = $base . $jobPath
        . '/api/json?tree=builds%5Bnumber,timestamp,actions%5Bparameters%5Bname,value%5D,causes%5BshortDescription,userId,userName%5D%5D%5D%7B0,150%7D';
    $chHist = curl_init($histUrl);
    curl_setopt_array($chHist, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => ['Accept: application/json', $authHeader],
    ]);

    $url = $base . $jobPath . '/lastBuild/consoleText';
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER     => ['Accept: text/plain', $authHeader],
    ]);

    // Execute both requests in parallel
    $mh = curl_multi_init();
    curl_multi_add_handle($mh, $chHist);
    curl_multi_add_handle($mh, $ch);
    do { curl_multi_exec($mh, $still); curl_multi_select($mh); } while ($still > 0);
    $histBody = curl_multi_getcontent($chHist);
    $histCode = curl_getinfo($chHist, CURLINFO_HTTP_CODE);
    $body     = curl_multi_getcontent($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_multi_remove_handle($mh, $chHist);
    curl_multi_remove_handle($mh, $ch);
    curl_multi_close($mh);
    curl_close($chHist); curl_close($ch);

    // Build per-feature author map from build history.
    // builds[] is newest-first, so first occurrence of each feature_name = most recent change.
    $featureAuthors = [];  // feature_name → { user, ts }
    $lastBuildNumber = null;
    $lastBuildUser   = null;
    if ($histCode === 200 && $histBody) {
        $hist = json_decode($histBody, true) ?? [];
        foreach (($hist['builds'] ?? []) as $bld) {
            $featName = null;
            $bldUser  = null;
            foreach (($bld['actions'] ?? []) as $a) {
                foreach (($a['parameters'] ?? []) as $p) {
                    if (($p['name'] ?? '') === 'feature_name') {
                        $featName = $p['value'] ?? null;
                    }
                }
                if ($bldUser === null) {
                    foreach (($a['causes'] ?? []) as $c) {
                        if (!empty($c['userName']))  { $bldUser = $c['userName']; break; }
                        if (!empty($c['userId']))    { $bldUser = $c['userId'];   break; }
                        if (!empty($c['shortDescription'])) {
                            if (preg_match('/^Started by user (.+)$/i', $c['shortDescription'], $cm))
                                $bldUser = trim($cm[1]);
                            break;
                        }
                    }
                }
            }
            // Track the very first build = most recent overall
            if ($lastBuildNumber === null) {
                $lastBuildNumber = $bld['number'] ?? null;
                $lastBuildUser   = $bldUser;
            }
            // Map feature → author (first hit = most recent = the one we want)
            if ($featName !== null && !isset($featureAuthors[$featName])) {
                $bldTs = !empty($bld['timestamp']) ? (int)($bld['timestamp'] / 1000) : null;
                $featureAuthors[$featName] = ['user' => $bldUser, 'ts' => $bldTs];
            }
        }
    }

    if ($code !== 200 || !$body) {
        return ['ok' => false, 'error' => "Jenkins HTTP $code", 'items' => []];
    }
    // Strip Jenkins timestamp prefix like "01:04:36 " from each line
    $body = preg_replace('/^\d{2}:\d{2}:\d{2}\s?/m', '', $body);

    // Locate the "features:" block; parse until the next non-indented block
    if (!preg_match('/features:\s*\n(.*?)(?:\n\S|\z)/s', $body, $m)) {
        return ['ok' => false, 'error' => 'features block not found in console log', 'items' => []];
    }
    $block = $m[1];

    // Parse each "- name: xxx" entry and its indented siblings
    $items = [];
    $current = null;
    foreach (explode("\n", $block) as $line) {
        if (preg_match('/^\s*- name:\s*(\S.*)$/', $line, $mm)) {
            if ($current) $items[] = $current;
            $current = ['name' => trim($mm[1])];
        } elseif ($current && preg_match('/^\s+(\S[^:]*?):\s*(.*)$/', $line, $mm)) {
            $current[trim($mm[1])] = trim($mm[2]);
        }
    }
    if ($current) $items[] = $current;

    // Convert to the standard item shape.
    // enabled: true  → feature is ON = OPERATIONAL (open)
    // enabled: false → feature is OFF = IN MAINTENANCE (closed)
    // ("enable_feature=false" in Jenkins params means "put MA up" per the job's own docstring)
    $out = [];
    foreach ($items as $it) {
        $enabled = strtolower((string)($it['enabled'] ?? ''));
        $status  = ($enabled === 'true' || $enabled === '1') ? 'open'
                 : (($enabled === 'false' || $enabled === '0') ? 'closed' : 'unknown');
        $out[] = [
            'name'         => 'feature:' . $it['name'],
            'label'        => $it['name'],
            'type'         => 'tmn_feature',
            'status'       => $status,
            'method'       => strtoupper((string)($it['http-method'] ?? '')),
            'url_pattern'  => (string)($it['url'] ?? ''),
            'error_code'   => $it['error-code'] ?? null,
            'link'         => $base . $jobPath . '/',
            // Per-feature: who last toggled THIS feature specifically
            'triggered_by' => ($featureAuthors[$it['name']] ?? null)['user'] ?? $lastBuildUser,
            'triggered_at' => ($featureAuthors[$it['name']] ?? null)['ts']   ?? null,
            'build_number' => $lastBuildNumber,
        ];
    }
    return ['ok' => true, 'fetched_at' => time(), 'items' => $out];
}

// ─────────────────────────────────────────────────────────────────
//  Fetch requested sources
// ─────────────────────────────────────────────────────────────────
$sources = [];
if ($sourceFilter === 'all' || $sourceFilter === 'nano') {
    $sources['nano'] = ma_fetch_nano();
}
if ($sourceFilter === 'all' || $sourceFilter === 'tmn_jenkins') {
    $sources['tmn_jenkins'] = ma_fetch_jenkins();
}
if ($sourceFilter === 'all' || $sourceFilter === 'tmn_features') {
    $sources['tmn_features'] = ma_fetch_features();
}
if ($sourceFilter === 'all' || $sourceFilter === 'tmn_backoffice') {
    $sources['tmn_backoffice'] = ma_fetch_backoffice();
}

// ─────────────────────────────────────────────────────────────────
//  Filter out items in the per-team "hidden" list (managed in admin UI)
// ─────────────────────────────────────────────────────────────────
$hidden = readJson('ma-status-hidden.json');
if (is_array($hidden)) {
    $hiddenSets = [
        'nano'           => array_flip(array_map('strval', $hidden['nano']           ?? [])),
        'tmn_jenkins'    => array_flip(array_map('strval', $hidden['tmn_jenkins']    ?? [])),
        'tmn_features'   => array_flip(array_map('strval', $hidden['tmn_features']   ?? [])),
        'tmn_backoffice' => array_flip(array_map('intval', $hidden['tmn_backoffice'] ?? [])),
    ];
    foreach ($sources as $srcKey => $src) {
        if (empty($src['items'])) continue;
        $set = $hiddenSets[$srcKey] ?? [];
        if (!$set) continue;
        $kept = [];
        foreach ($src['items'] as $it) {
            $key = null;
            if ($srcKey === 'tmn_backoffice') $key = (int)($it['use_case_id'] ?? 0);
            elseif ($srcKey === 'tmn_features') $key = (string)($it['label'] ?? '');
            else                                $key = (string)($it['name'] ?? '');
            if (isset($set[$key])) continue;
            $kept[] = $it;
        }
        $sources[$srcKey]['items']   = $kept;
        $sources[$srcKey]['hidden_count'] = count($src['items']) - count($kept);
    }
}

// ─────────────────────────────────────────────────────────────────
//  Join with ma-services.json for the master list view
// ─────────────────────────────────────────────────────────────────
$maServicesFile = readJson('ma-services.json'); // {services:[...], next_id}
$svcRows        = $maServicesFile['services'] ?? (is_array($maServicesFile) ? $maServicesFile : []);

// Build lookup indexes from source items
$boByName = []; $boById = [];
foreach ($sources['tmn_backoffice']['items'] ?? [] as $it) {
    $key = ma_norm_name($it['label']);
    if ($key) $boByName[$key] = $it;
    if (!empty($it['use_case_id'])) $boById[(int)$it['use_case_id']] = $it;
}
$jenkinsByLabel = [];
foreach ($sources['tmn_jenkins']['items'] ?? [] as $it) {
    $jenkinsByLabel[ma_norm_name($it['label'])] = $it;
}
$nanoByLabel = [];
foreach ($sources['nano']['items'] ?? [] as $it) {
    $nanoByLabel[ma_norm_name($it['label'])] = $it;
    $nanoByLabel[ma_norm_name($it['product'])] = $it;
}

$joined = [];
$mappedBoIds = [];
foreach ($svcRows as $svc) {
    $tool = $svc['tool_type'] ?? '';
    $name = $svc['service_name'] ?? '';
    $row = [
        'id'           => $svc['id'] ?? null,
        'service_name' => $name,
        'service_type' => $svc['service_type'] ?? null,
        'tool_type'    => $tool,
        'status'       => 'unknown',
        'source'       => null,
        'matched'      => false,
        'updated_at'   => null,
        'link'         => $svc['direct_link'] ?? null,
    ];
    $key = ma_norm_name($name);
    $keyStripped = preg_replace('/^disable\s+/i', '', $key);

    // Explicit mapping via optional field beats fuzzy match
    if (!empty($svc['backoffice_use_case_id']) && isset($boById[(int)$svc['backoffice_use_case_id']])) {
        $it = $boById[(int)$svc['backoffice_use_case_id']];
        $row['status']     = $it['status'];
        $row['source']     = 'tmn_backoffice';
        $row['upstream_ref']= "use_case_id={$it['use_case_id']}";
        $row['updated_at'] = $it['updated_at'];
        $row['matched']    = true;
        $mappedBoIds[(int)$svc['backoffice_use_case_id']] = true;
    } elseif ($tool === 'Admin Portal' && ($boByName[$key] ?? $boByName[$keyStripped] ?? null)) {
        $it = $boByName[$key] ?? $boByName[$keyStripped];
        $row['status']     = $it['status'];
        $row['source']     = 'tmn_backoffice';
        $row['upstream_ref']= "use_case_id={$it['use_case_id']}";
        $row['updated_at'] = $it['updated_at'];
        $row['matched']    = true;
        if (!empty($it['use_case_id'])) $mappedBoIds[(int)$it['use_case_id']] = true;
    } elseif ($tool === 'Jenkins' && ($jenkinsByLabel[$key] ?? null)) {
        $it = $jenkinsByLabel[$key];
        $row['status']     = $it['status'];
        $row['source']     = 'tmn_jenkins';
        $row['upstream_ref']= $it['name'];
        $row['updated_at'] = $it['updated_at'] ? date('c', $it['updated_at']) : null;
        $row['link']       = $it['link'];
        $row['matched']    = true;
    } elseif (($nanoByLabel[$key] ?? null)) {
        $it = $nanoByLabel[$key];
        $row['status']     = $it['status'];
        $row['source']     = 'nano_cdn';
        $row['upstream_ref']= $it['name'];
        $row['matched']    = true;
    }
    $joined[] = $row;
}

// Backoffice items not linked to any ma-services row → discovery section
$unmapped = [];
foreach ($sources['tmn_backoffice']['items'] ?? [] as $it) {
    $id = (int)($it['use_case_id'] ?? 0);
    if ($id && empty($mappedBoIds[$id])) $unmapped[] = $it;
}

// Aggregate counts for the top summary
$summary = [
    'total'    => count($joined),
    'open'     => 0, 'closed' => 0, 'unknown' => 0, 'matched' => 0,
    'per_source' => [],
];
foreach ($joined as $r) {
    $summary[$r['status']] = ($summary[$r['status']] ?? 0) + 1;
    if ($r['matched']) $summary['matched']++;
}
foreach ($sources as $k => $s) {
    $summary['per_source'][$k] = [
        'ok' => !empty($s['ok']),
        'count' => count($s['items'] ?? []),
        'fetched_at' => $s['fetched_at'] ?? null,
        'error' => $s['error'] ?? null,
    ];
}

$payload = [
    'sources'  => $sources,
    'services' => $joined,
    'unmapped_backoffice' => $unmapped,
    'summary'  => $summary,
    'cached'   => false,
    'fetched_at' => time(),
];

// Only cache when all fetched sources succeeded — never cache partial/error responses
$allOk = true;
foreach ($sources as $s) { if (empty($s['ok'])) { $allOk = false; break; } }
if ($allOk) {
    writeJson($cacheFile, ['ts' => time(), 'filter' => $sourceFilter, 'payload' => $payload]);
}

respondOk($payload);

// ─────────────────────────────────────────────────────────────────
function ma_norm_name(?string $s): string {
    if (!$s) return '';
    $s = preg_replace('/^disable\s+/i', '', trim($s));
    $s = mb_strtolower($s, 'UTF-8');
    $s = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $s);
    $s = preg_replace('/\s+/', ' ', $s);
    return trim($s);
}
