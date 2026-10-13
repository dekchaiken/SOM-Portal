<?php
set_time_limit(300); // Ollama needs up to 5 min on first load

// Capture PHP fatal errors and return as JSON instead of empty 500
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (!headers_sent()) http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'PHP error: ' . $e['message']]);
    }
});

require_once '../helpers.php';

// LLM query is POST-shaped but semantically a read — allow super_viewer.
requireAuth(false, true);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
    exit;
}

$input   = json_decode(file_get_contents('php://input'), true);
$message = trim($input['message'] ?? '');
$model   = defined('OLLAMA_MODEL') ? OLLAMA_MODEL : 'qwen2.5:7b';
$host    = defined('OLLAMA_HOST')  ? OLLAMA_HOST  : 'http://localhost:11434';

if (!$message || mb_strlen($message) > 2000) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid message']);
    exit;
}

$systemPrompt  = "คุณคือตุ้มเม้ง AI ประจำทีม Service Monitoring ระบบ Centralize SOM ของ Ascend/TrueMoney\n";
$systemPrompt .= "คุณเป็นผู้ชาย พูดสุภาพ กระชับ ตรงประเด็น ใช้คำลงท้าย \"ครับ\"\n\n";
$systemPrompt .= "กฎ:\n";
$systemPrompt .= "1. ตอบได้เฉพาะจาก \"ข้อมูลในระบบ\" ด้านล่างเท่านั้น\n";
$systemPrompt .= "2. ห้ามใช้ความรู้ภายนอก ห้ามเดา ห้ามตอบเรื่องที่ไม่เกี่ยวกับระบบ SOM\n";
$systemPrompt .= "3. ถ้าไม่มีข้อมูลให้บอกตรงๆ ว่า \"ไม่มีข้อมูลนี้ในระบบครับ\"\n";
$systemPrompt .= "4. ตอบเป็นภาษาไทยเสมอ\n";
$systemPrompt .= "5. ถามเรื่องจำนวน/สถิติ ให้ดูจาก Stats section ก่อนเสมอ ห้ามนับเอง\n\n";
$systemPrompt .= "--- ข้อมูลในระบบ ---\n";
$systemPrompt .= _aiContext($message);

$payload = json_encode([
    'model'    => $model,
    'messages' => [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user',   'content' => $message],
    ],
    'stream'  => false,
    'options' => ['temperature' => 0.3, 'num_ctx' => 8192],
], JSON_UNESCAPED_UNICODE);

$raw = _callOllama($host . '/api/chat', $payload);

if ($raw === false) {
    http_response_code(503);
    echo json_encode(['ok' => false, 'message' => 'เชื่อมต่อ Ollama ไม่ได้ครับ กรุณาตรวจสอบว่า Ollama รันอยู่']);
    exit;
}

$result = json_decode($raw, true);
if (!$result || !isset($result['message']['content'])) {
    http_response_code(502);
    echo json_encode(['ok' => false, 'message' => 'Ollama ตอบกลับมาผิดรูปแบบครับ', 'raw' => mb_substr($raw, 0, 300)]);
    exit;
}

echo json_encode(['ok' => true, 'data' => ['answer' => $result['message']['content']]]);


// ── HTTP call — curl preferred, file_get_contents fallback ───────────────────
function _callOllama(string $url, string $body): string|false {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 120,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $res = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        return ($err || $res === false) ? false : $res;
    }

    // Fallback: file_get_contents (no curl extension needed)
    $ctx = stream_context_create([
        'http' => [
            'method'  => 'POST',
            'header'  => "Content-Type: application/json\r\n",
            'content' => $body,
            'timeout' => 120,
            'ignore_errors' => true,
        ],
    ]);
    $res = @file_get_contents($url, false, $ctx);
    return $res;
}


// ── Detect which sections are relevant to the question ───────────────────────
function _detectSections(string $q): array {
    $q = mb_strtolower($q);
    $all = ['board', 'users', 'jenkins', 'templates', 'announcements', 'links', 'categories'];

    $map = [
        'board'         => ['โพส','board','incident','บอร์ด','open','in_progress','resolved','สถานะ','โพสต์','post','ปิด','เปิด','แก้ไข','หัวข้อ','ล่าสุด','เก่า','โพสของ','ใครโพส','ประเภท'],
        'users'         => ['user','คน','ชื่อ','admin','lead','ทีม','สมาชิก','role','sm_','external','dev_sm','อีเมล','email','ใคร','กี่คน','account','บัญชี'],
        'jenkins'       => ['jenkins','pipeline','server','ci','build','deploy','รัน','job'],
        'templates'     => ['template','jira','issue','งาน','แบบฟอร์ม','ticket','บัตร'],
        'announcements' => ['ประกาศ','announcement','แจ้ง','ข่าว','notice'],
        'links'         => ['ลิงก์','link','url','เว็บ','shortcut','ช็อตคัต'],
        'categories'    => ['หมวด','categor','ประเภทบอร์ด','tab'],
    ];

    $matched = [];
    foreach ($map as $section => $keywords) {
        foreach ($keywords as $kw) {
            if (str_contains($q, $kw)) { $matched[] = $section; break; }
        }
    }
    return $matched ?: $all; // fallback: load all if no keyword matched
}

// ── Build context from internal JSON data ────────────────────────────────────
function _aiContext(string $question): string {
    $parts    = [];
    $sections = _detectSections($question);

    // ── 1. Board ─────────────────────────────────────────────────────────────
    if (in_array('board', $sections)) {
        $board    = readJson('board.json');
        $allPosts = array_values(array_filter($board, fn($p) => ($p['status'] ?? '') !== 'deleted'));
        $byStat = []; $byType = []; $byUser = [];
        foreach ($allPosts as $p) {
            $byStat[$p['status']     ?? 'unknown'] = ($byStat[$p['status']     ?? 'unknown'] ?? 0) + 1;
            $byType[$p['board_type'] ?? 'unknown'] = ($byType[$p['board_type'] ?? 'unknown'] ?? 0) + 1;
            $byUser[$p['created_by'] ?? 'unknown'] = ($byUser[$p['created_by'] ?? 'unknown'] ?? 0) + 1;
        }
        arsort($byUser);
        $parts[] = "=== [STATS] Board (PHP-computed — ใช้ตัวเลขนี้เท่านั้น ห้ามนับเอง) ===\n" . json_encode([
            'total_active'    => count($allPosts),
            'by_status'       => $byStat,
            'by_type'         => $byType,
            'top_posters'     => array_slice($byUser, 0, 5, true),
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        usort($allPosts, fn($a, $b) => strtotime($b['created_at'] ?? '0') <=> strtotime($a['created_at'] ?? '0'));
        $parts[] = "=== [DATA] Board Posts (ล่าสุด 20) ===\n" . json_encode(
            array_map(fn($p) => [
                'id'      => $p['id']          ?? '',
                'title'   => $p['title']       ?? '',
                'status'  => $p['status']      ?? '',
                'type'    => $p['board_type']  ?? '',
                'by'      => $p['created_by']  ?? '',
                'at'      => $p['created_at']  ?? '',
                'preview' => mb_substr(strip_tags($p['content'] ?? ''), 0, 200),
            ], array_slice($allPosts, 0, 20)),
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );
    }

    // ── 2. Users ─────────────────────────────────────────────────────────────
    if (in_array('users', $sections)) {
        $users     = readJson('users.json');
        $activeU   = array_values(array_filter($users, fn($u) => ($u['status'] ?? 'active') === 'active'));
        $inactiveU = array_values(array_filter($users, fn($u) => ($u['status'] ?? 'active') !== 'active'));
        $byRole    = [];
        foreach ($activeU as $u) $byRole[$u['role'] ?? 'unknown'] = ($byRole[$u['role'] ?? 'unknown'] ?? 0) + 1;
        $parts[] = "=== [STATS] Users (PHP-computed) ===\n" . json_encode([
            'total_active'   => count($activeU),
            'total_inactive' => count($inactiveU),
            'by_role'        => $byRole,
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        $parts[] = "=== [DATA] Users (active) ===\n" . json_encode(
            array_map(fn($u) => [
                'username'     => $u['username']     ?? '',
                'display_name' => $u['display_name'] ?? '',
                'role'         => $u['role']         ?? '',
                'email'        => $u['email']        ?? '',
            ], $activeU),
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );
    }

    // ── 3. Jenkins ───────────────────────────────────────────────────────────
    if (in_array('jenkins', $sections)) {
        $jk        = readJson('jenkins_servers.json');
        $jkOn      = array_values(array_filter($jk, fn($s) =>  ($s['enabled'] ?? true)));
        $jkOff     = array_values(array_filter($jk, fn($s) => !($s['enabled'] ?? true)));
        $parts[] = "=== [STATS] Jenkins (PHP-computed) ===\n" . json_encode([
            'total' => count($jk), 'enabled' => count($jkOn), 'disabled' => count($jkOff),
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        $parts[] = "=== [DATA] Jenkins Servers ===\n" . json_encode(
            array_map(fn($s) => ['name' => $s['name'] ?? '', 'url' => $s['url'] ?? '', 'enabled' => $s['enabled'] ?? true], $jk),
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );
    }

    // ── 4. Jira Templates ────────────────────────────────────────────────────
    if (in_array('templates', $sections)) {
        $tpls      = readJson('templates.json');
        $tplByType = [];
        foreach ($tpls as $t) { $it = $t['issue_type'] ?? 'unknown'; $tplByType[$it] = ($tplByType[$it] ?? 0) + 1; }
        $parts[] = "=== [STATS] Jira Templates (PHP-computed) ===\n" . json_encode([
            'total' => count($tpls), 'by_issue_type' => $tplByType,
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        $parts[] = "=== [DATA] Jira Templates ===\n" . json_encode(
            array_map(fn($t) => ['name' => $t['name'] ?? '', 'desc' => $t['description'] ?? '', 'issue_type' => $t['issue_type'] ?? ''], $tpls),
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );
    }

    // ── 5. Announcements ────────────────────────────────────────────────────
    if (in_array('announcements', $sections)) {
        $ann       = readJson('announcements.json');
        $now       = time();
        $annActive = array_values(array_filter($ann, function($a) use ($now) {
            $s = isset($a['start_date']) ? strtotime($a['start_date']) : 0;
            $e = isset($a['end_date'])   ? strtotime($a['end_date'])   : PHP_INT_MAX;
            return ($a['active'] ?? true) && $now >= $s && $now <= $e;
        }));
        $parts[] = "=== [STATS] Announcements (PHP-computed) ===\n" . json_encode([
            'total' => count($ann), 'active_now' => count($annActive),
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($annActive) {
            $parts[] = "=== [DATA] Active Announcements ===\n" . json_encode(
                array_map(fn($a) => ['title' => $a['title'] ?? '', 'message' => mb_substr($a['message'] ?? '', 0, 200), 'type' => $a['type'] ?? ''], $annActive),
                JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
            );
        }
    }

    // ── 6. Links ────────────────────────────────────────────────────────────
    if (in_array('links', $sections)) {
        $links = readJson('links.json');
        $parts[] = "=== [STATS] Quick Links ===\n" . json_encode(['total' => count($links)], JSON_UNESCAPED_UNICODE);
        $parts[] = "=== [DATA] Quick Links ===\n" . json_encode(
            array_map(fn($l) => ['label' => $l['label'] ?? $l['title'] ?? '', 'url' => $l['url'] ?? '', 'section' => $l['section'] ?? ''], array_slice($links, 0, 30)),
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );
    }

    // ── 7. Board categories ──────────────────────────────────────────────────
    if (in_array('categories', $sections)) {
        $cats    = readJson('board_categories.json');
        $parts[] = "=== [DATA] Board Categories ===\n" . json_encode($cats, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    }

    return implode("\n\n", $parts);
}
