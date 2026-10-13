<?php
/**
 * Email Notification broadcast — admin-only.
 *
 *   GET  /api/email-noti/?action=recipients  → users with valid email
 *   GET  /api/email-noti/?action=courses     → published courses
 *   GET  /api/email-noti/?action=exams       → active exams
 *   POST /api/email-noti/?action=send
 *        body: {
 *          type:          'course' | 'exam' | 'course_exam' | 'custom',
 *          ref_id?:       string,    // course_id (course, course_exam) or exam_id (exam)
 *          exam_ref_id?:  string,    // exam_id (course_exam only)
 *          subject?:      string,    // required for 'custom'
 *          message?:      string,    // extra message (course/exam/course_exam) OR body (custom)
 *          recipient_ids: string[]   // user IDs to send to (admin already excluded any)
 *        }
 *        → { sent: int, failed: int, details: [{user_id, email, status, error?}] }
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../mail/_mailer.php';
require_once __DIR__ . '/../mail/_templates.php';
require_once __DIR__ . '/_chat_cards.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ─────────────────────────────────────────────────────────────────────────────
// GET handlers
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'recipients') {
    $users = readJson('users.json');
    $out = [];
    foreach ($users as $u) {
        $email = trim($u['email'] ?? '');
        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
        $out[] = [
            'id'       => $u['id'],
            'name'     => $u['name'],
            'username' => $u['username'],
            'email'    => $email,
            'role'     => $u['role'],
        ];
    }
    // Sort by name for stable UI
    usort($out, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    respondOk($out);
}

if ($method === 'GET' && $action === 'courses') {
    $out = [];

    // 1) Synthetic "Onboarding" — single mandatory flow, lives in onboarding/config.json
    $onb = readJson('onboarding/config.json');
    if (!empty($onb['intro']['title'])) {
        $out[] = [
            'id'          => '__onboarding__',
            'title'       => $onb['intro']['title'] ?? 'Team Onboarding',
            'subtitle'    => $onb['intro']['subtitle']    ?? 'คอร์สบังคับสำหรับสมาชิกใหม่ของทีม',
            'description' => $onb['intro']['description'] ?? '',
            'icon'        => '🎯',
            'cover_color' => '#f26419',
            'mandatory'   => true,
        ];
    }

    // 2) Published courses from courses/courses.json
    $courses = readJson('courses/courses.json');
    $published = [];
    foreach ($courses as $c) {
        if (empty($c['published'])) continue;
        $published[] = [
            'id'          => $c['id'],
            'title'       => $c['title'],
            'subtitle'    => $c['subtitle']    ?? '',
            'description' => $c['description'] ?? '',
            'icon'        => $c['icon']        ?? '📚',
            'cover_color' => $c['cover_color'] ?? '#f26419',
            'mandatory'   => false,
        ];
    }
    usort($published, fn($a, $b) => strcasecmp($a['title'], $b['title']));

    respondOk(array_merge($out, $published));
}

if ($method === 'GET' && $action === 'exams') {
    $exams = readJson('exams/exams.json');
    $out = [];
    foreach ($exams as $e) {
        if (($e['status'] ?? '') === 'deleted') continue;
        $out[] = [
            'id'                   => $e['id'],
            'title'                => $e['title'],
            'subtitle'             => $e['subtitle']    ?? '',
            'description'          => $e['description'] ?? '',
            'icon'                 => $e['icon']        ?? '📝',
            'cover_color'          => $e['cover_color'] ?? '#dc2626',
            'pass_score'           => (int)($e['pass_score'] ?? 70),
            'status'               => $e['status']      ?? 'draft',
            // Client uses this to auto-suggest a matching exam when the admin
            // picks a course in "Course + Exam" mode.
            'course_prerequisites' => array_values((array)($e['course_prerequisites'] ?? [])),
        ];
    }
    usort($out, fn($a, $b) => strcasecmp($a['title'], $b['title']));
    respondOk($out);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET default chat webhooks (from system-settings)
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'chat_webhooks') {
    $s = readJson('system-settings.json');
    respondOk(['webhooks' => array_values((array)($s['email_noti_chat_webhooks'] ?? []))]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — chat preview (build Google Chat card JSON, do NOT send)
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'chat_preview') {
    requireCsrf();
    $body = getBody();
    $type         = trim($body['type'] ?? '');
    $refId        = trim($body['ref_id'] ?? '');
    $examRefId    = trim($body['exam_ref_id'] ?? '');
    $extraMsg     = trim($body['message'] ?? '');
    $subjectInput = trim($body['subject'] ?? '');

    if (!in_array($type, ['course', 'exam', 'course_exam', 'custom'], true)) {
        respondError('Invalid notification type');
    }

    if ($type === 'course') {
        if (!$refId) respondError('Course ID is required');
        if ($refId === '__onboarding__') {
            $onb   = readJson('onboarding/config.json');
            $intro = $onb['intro'] ?? [];
            $course = [
                'id'          => '__onboarding__',
                'title'       => $intro['title']       ?? 'Team Onboarding',
                'subtitle'    => $intro['subtitle']    ?? '',
                'description' => $intro['description'] ?? '',
            ];
        } else {
            $courses = readJson('courses/courses.json');
            $course = null;
            foreach ($courses as $c) if ($c['id'] === $refId) { $course = $c; break; }
            if (!$course) respondError('Course not found', 404);
        }
        $card = buildCourseChatCard($course, $extraMsg);
    } elseif ($type === 'exam') {
        if (!$refId) respondError('Exam ID is required');
        $exams = readJson('exams/exams.json');
        $exam = null;
        foreach ($exams as $e) if ($e['id'] === $refId) { $exam = $e; break; }
        if (!$exam) respondError('Exam not found', 404);
        $card = buildExamChatCard($exam, $extraMsg);
    } elseif ($type === 'course_exam') {
        if (!$refId || !$examRefId) respondError('Course + Exam ID required');
        if ($refId === '__onboarding__') {
            $onb   = readJson('onboarding/config.json');
            $intro = $onb['intro'] ?? [];
            $course = [
                'id' => '__onboarding__',
                'title' => $intro['title'] ?? 'Team Onboarding',
                'subtitle' => $intro['subtitle'] ?? '',
            ];
        } else {
            $courses = readJson('courses/courses.json');
            $course = null;
            foreach ($courses as $c) if ($c['id'] === $refId) { $course = $c; break; }
            if (!$course) respondError('Course not found', 404);
        }
        $exams = readJson('exams/exams.json');
        $exam = null;
        foreach ($exams as $e) if ($e['id'] === $examRefId) { $exam = $e; break; }
        if (!$exam) respondError('Exam not found', 404);
        $card = buildCourseExamChatCard($course, $exam, $extraMsg);
    } else {
        if (!$subjectInput) respondError('Subject is required for custom announcements');
        if (!$extraMsg)     respondError('Message body is required for custom announcements');
        $card = buildCustomChatCard($subjectInput, $extraMsg);
    }

    respondOk(['card' => $card]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — preview (render template only, do NOT send)
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'preview') {
    requireCsrf();
    $body = getBody();
    $type         = trim($body['type'] ?? '');
    $refId        = trim($body['ref_id'] ?? '');
    $examRefId    = trim($body['exam_ref_id'] ?? '');
    $extraMsg     = trim($body['message'] ?? '');
    $subjectInput = trim($body['subject'] ?? '');

    if (!in_array($type, ['course', 'exam', 'course_exam', 'custom'], true)) {
        respondError('Invalid notification type');
    }

    // Sample recipient name for the preview personalization
    $sampleName = $payload['name'] ?? 'ทีมงาน';

    if ($type === 'course') {
        if (!$refId) respondError('Course ID is required');
        if ($refId === '__onboarding__') {
            $onb = readJson('onboarding/config.json');
            $intro = $onb['intro'] ?? [];
            $course = [
                'title'       => $intro['title']       ?? 'Team Onboarding',
                'subtitle'    => $intro['subtitle']    ?? 'คอร์สบังคับสำหรับสมาชิกใหม่ของทีม',
                'description' => $intro['description'] ?? '',
                'icon'        => '🎯',
                'cover_color' => '#f26419',
            ];
            $deepLink = APP_BASE_URL . '/onboarding.html';
        } else {
            $courses = readJson('courses/courses.json');
            $course = null;
            foreach ($courses as $c) if ($c['id'] === $refId) { $course = $c; break; }
            if (!$course) respondError('Course not found', 404);
            $deepLink = APP_BASE_URL . '/learn-course.html?id=' . rawurlencode($refId);
        }
        $tpl = buildCourseAnnouncementEmail($sampleName, $course, $extraMsg, $deepLink, $subjectInput);
    } elseif ($type === 'exam') {
        if (!$refId) respondError('Exam ID is required');
        $exams = readJson('exams/exams.json');
        $exam = null;
        foreach ($exams as $e) if ($e['id'] === $refId) { $exam = $e; break; }
        if (!$exam) respondError('Exam not found', 404);
        $deepLink = APP_BASE_URL . '/exam.html?id=' . rawurlencode($refId);
        $tpl = buildExamAnnouncementEmail($sampleName, $exam, $extraMsg, $deepLink, $subjectInput);
    } elseif ($type === 'course_exam') {
        if (!$refId)     respondError('Course ID is required');
        if (!$examRefId) respondError('Exam ID is required');

        // Course (share the onboarding shim used by the 'course' branch)
        if ($refId === '__onboarding__') {
            $onb = readJson('onboarding/config.json');
            $intro = $onb['intro'] ?? [];
            $course = [
                'id'          => '__onboarding__',
                'title'       => $intro['title']       ?? 'Team Onboarding',
                'subtitle'    => $intro['subtitle']    ?? 'คอร์สบังคับสำหรับสมาชิกใหม่ของทีม',
                'description' => $intro['description'] ?? '',
                'icon'        => '🎯',
                'cover_color' => '#f26419',
            ];
            $courseUrl = APP_BASE_URL . '/onboarding.html';
        } else {
            $courses = readJson('courses/courses.json');
            $course = null;
            foreach ($courses as $c) if ($c['id'] === $refId) { $course = $c; break; }
            if (!$course) respondError('Course not found', 404);
            $courseUrl = APP_BASE_URL . '/learn-course.html?id=' . rawurlencode($refId);
        }

        // Exam
        $exams = readJson('exams/exams.json');
        $exam = null;
        foreach ($exams as $e) if ($e['id'] === $examRefId) { $exam = $e; break; }
        if (!$exam) respondError('Exam not found', 404);
        $examUrl = APP_BASE_URL . '/exam.html?id=' . rawurlencode($examRefId);

        $tpl = buildCourseExamAnnouncementEmail(
            $sampleName, $course, $exam, $extraMsg, $courseUrl, $examUrl, $subjectInput
        );
    } else {
        if (!$subjectInput) respondError('Subject is required');
        if (!$extraMsg)     respondError('Message body is required');
        $tpl = buildCustomAnnouncementEmail($sampleName, $subjectInput, $extraMsg);
    }

    respondOk(['subject' => $tpl['subject'], 'html' => $tpl['html']]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — send broadcast
// ─────────────────────────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'send') {
    requireCsrf();
    $body = getBody();

    $type         = trim($body['type'] ?? '');
    $refId        = trim($body['ref_id'] ?? '');
    $examRefId    = trim($body['exam_ref_id'] ?? '');
    $extraMsg     = trim($body['message'] ?? '');
    $subjectInput = trim($body['subject'] ?? '');
    $recipientIds = array_values(array_filter((array)($body['recipient_ids'] ?? []), 'is_string'));

    if (!in_array($type, ['course', 'exam', 'course_exam', 'custom'], true)) {
        respondError('Invalid notification type');
    }
    if (!$recipientIds) {
        respondError('Recipient list is empty');
    }
    if (count($recipientIds) > 500) {
        respondError('Too many recipients (max 500 per send)');
    }

    // Resolve the content payload based on type
    // For type='course_exam', $courseOrExam holds the course and $examData holds the exam.
    $courseOrExam = null;
    $examData     = null;   // course_exam only
    $deepLink     = '';
    $examUrl      = '';     // course_exam only

    if ($type === 'course') {
        if (!$refId) respondError('Course ID is required');
        if ($refId === '__onboarding__') {
            // Synthetic course — pull intro from onboarding/config.json
            $onb = readJson('onboarding/config.json');
            $intro = $onb['intro'] ?? [];
            $courseOrExam = [
                'id'          => '__onboarding__',
                'title'       => $intro['title']       ?? 'Team Onboarding',
                'subtitle'    => $intro['subtitle']    ?? 'คอร์สบังคับสำหรับสมาชิกใหม่ของทีม',
                'description' => $intro['description'] ?? '',
                'icon'        => '🎯',
                'cover_color' => '#f26419',
            ];
            $deepLink = APP_BASE_URL . '/onboarding.html';
        } else {
            $courses = readJson('courses/courses.json');
            foreach ($courses as $c) {
                if ($c['id'] === $refId) { $courseOrExam = $c; break; }
            }
            if (!$courseOrExam) respondError('Course not found', 404);
            $deepLink = APP_BASE_URL . '/learn-course.html?id=' . rawurlencode($refId);
        }
    } elseif ($type === 'exam') {
        if (!$refId) respondError('Exam ID is required');
        $exams = readJson('exams/exams.json');
        foreach ($exams as $e) {
            if ($e['id'] === $refId) { $courseOrExam = $e; break; }
        }
        if (!$courseOrExam) respondError('Exam not found', 404);
        $deepLink = APP_BASE_URL . '/exam.html?id=' . rawurlencode($refId);
    } elseif ($type === 'course_exam') {
        if (!$refId)     respondError('Course ID is required');
        if (!$examRefId) respondError('Exam ID is required');

        // Course
        if ($refId === '__onboarding__') {
            $onb = readJson('onboarding/config.json');
            $intro = $onb['intro'] ?? [];
            $courseOrExam = [
                'id'          => '__onboarding__',
                'title'       => $intro['title']       ?? 'Team Onboarding',
                'subtitle'    => $intro['subtitle']    ?? 'คอร์สบังคับสำหรับสมาชิกใหม่ของทีม',
                'description' => $intro['description'] ?? '',
                'icon'        => '🎯',
                'cover_color' => '#f26419',
            ];
            $deepLink = APP_BASE_URL . '/onboarding.html';
        } else {
            $courses = readJson('courses/courses.json');
            foreach ($courses as $c) {
                if ($c['id'] === $refId) { $courseOrExam = $c; break; }
            }
            if (!$courseOrExam) respondError('Course not found', 404);
            $deepLink = APP_BASE_URL . '/learn-course.html?id=' . rawurlencode($refId);
        }

        // Exam
        $exams = readJson('exams/exams.json');
        foreach ($exams as $e) {
            if ($e['id'] === $examRefId) { $examData = $e; break; }
        }
        if (!$examData) respondError('Exam not found', 404);
        $examUrl = APP_BASE_URL . '/exam.html?id=' . rawurlencode($examRefId);
    } else { // custom
        if (!$subjectInput) respondError('Subject is required for custom announcements');
        if (!$extraMsg)     respondError('Message body is required for custom announcements');
    }

    // Load users + filter to requested recipients with valid emails
    $users  = readJson('users.json');
    $byId   = [];
    foreach ($users as $u) $byId[$u['id']] = $u;

    $sent = 0; $failed = 0; $details = [];

    foreach ($recipientIds as $uid) {
        $u = $byId[$uid] ?? null;
        if (!$u) {
            $details[] = ['user_id' => $uid, 'email' => '', 'status' => 'skipped', 'error' => 'user not found'];
            $failed++; continue;
        }
        $email = trim($u['email'] ?? '');
        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $details[] = ['user_id' => $uid, 'email' => $email, 'status' => 'skipped', 'error' => 'no email'];
            $failed++; continue;
        }

        // Build personalized email (template depends on type)
        $name = $u['name'] ?? $u['username'];
        if ($type === 'course') {
            $tpl = buildCourseAnnouncementEmail($name, $courseOrExam, $extraMsg, $deepLink, $subjectInput);
        } elseif ($type === 'exam') {
            $tpl = buildExamAnnouncementEmail($name, $courseOrExam, $extraMsg, $deepLink, $subjectInput);
        } elseif ($type === 'course_exam') {
            $tpl = buildCourseExamAnnouncementEmail(
                $name, $courseOrExam, $examData, $extraMsg, $deepLink, $examUrl, $subjectInput
            );
        } else {
            $tpl = buildCustomAnnouncementEmail($name, $subjectInput, $extraMsg);
        }

        $res = sendMailInternal($email, $tpl['subject'], $tpl['html'], [
            'sent_by'      => $payload['sub'],
            'sent_by_name' => $payload['name'] ?? '',
            'log_type'     => 'email_noti_' . $type,
            'log_meta'     => [
                'type'           => $type,
                'ref_id'         => $refId,
                'exam_ref_id'    => $examRefId ?: null,
                'target_user_id' => $uid,
                'username'       => $u['username'] ?? '',
            ],
        ]);

        if ($res['ok']) {
            $details[] = ['user_id' => $uid, 'email' => $email, 'status' => 'sent'];
            $sent++;
        } else {
            $details[] = ['user_id' => $uid, 'email' => $email, 'status' => 'failed', 'error' => $res['error']];
            $failed++;
        }
    }

    logActivity('email_noti_broadcast', [
        'type'        => $type,
        'ref_id'      => $refId,
        'exam_ref_id' => $examRefId ?: null,
        'subject'     => $subjectInput ?: ($courseOrExam['title'] ?? ''),
        'total'       => count($recipientIds),
        'sent'        => $sent,
        'failed'      => $failed,
    ], $payload['sub'], $payload['name']);

    // ── Optional: mirror the broadcast to Google Chat ─────────────
    $chatResult = null;
    if (!empty($body['also_chat'])) {
        // Resolve webhook list: caller-supplied > system-settings default
        $webhooks = array_values(array_filter(array_map('trim',
            (array)($body['chat_webhook_urls'] ?? []))));
        if (empty($webhooks)) {
            $s = readJson('system-settings.json');
            $webhooks = array_values((array)($s['email_noti_chat_webhooks'] ?? []));
        }

        if (empty($webhooks)) {
            $chatResult = ['success' => false, 'sent' => 0, 'failed' => 0,
                           'errors' => ['ยังไม่ได้ตั้งค่า Google Chat webhook — ตั้งใน System Settings หรือ override ตอนส่ง'],
                           'skipped_reason' => 'no_webhook'];
        } else {
            // Build card based on the same type
            if ($type === 'course') {
                $card = buildCourseChatCard($courseOrExam, $extraMsg);
            } elseif ($type === 'exam') {
                $card = buildExamChatCard($courseOrExam, $extraMsg);
            } elseif ($type === 'course_exam') {
                $card = buildCourseExamChatCard($courseOrExam, $examData, $extraMsg);
            } else {
                $card = buildCustomChatCard($subjectInput, $extraMsg);
            }
            $chatResult = sendGoogleChatCard($webhooks, $card, 'email-noti');
            logActivity('email_noti_chat_broadcast', [
                'type'      => $type,
                'webhooks'  => count($webhooks),
                'chat_sent' => $chatResult['sent'],
                'chat_fail' => $chatResult['failed'],
            ], $payload['sub'], $payload['name']);
        }
    }

    respondOk([
        'sent'    => $sent,
        'failed'  => $failed,
        'total'   => count($recipientIds),
        'details' => $details,
        'chat'    => $chatResult,
    ], "ส่งสำเร็จ {$sent} จาก " . count($recipientIds) . " ฉบับ");
}

respondError('Invalid action or method', 400);
