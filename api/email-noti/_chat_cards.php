<?php
/**
 * Google Chat Card v2 builders for email-noti + exam-reminder broadcasts.
 *
 * These mirror the email template builders in api/mail/_templates.php but
 * render to Google Chat cardsV2 JSON (no HTML/CSS — chat cards are their
 * own thing). Per admin feedback the cards intentionally OMIT the action
 * button: recipients can click the exam/course link in the accompanying
 * email; here the card is just a visible "hey this happened" nudge.
 *
 *   buildCourseChatCard($course, $extraMsg):       array (full cardsV2 payload)
 *   buildExamChatCard($exam, $extraMsg):           array
 *   buildCourseExamChatCard($course, $exam, $msg): array
 *   buildCustomChatCard($subject, $bodyText):      array
 *   buildExamReminderChatCard($exam, $names, $msg, $deadline, $maxNames, $examUrl, $targetLabel): array
 */

if (!defined('SM_CHAT_ORANGE')) define('SM_CHAT_ORANGE', '#F26419');
if (!defined('SM_CHAT_MUTED'))  define('SM_CHAT_MUTED',  '#94a3b8');
if (!defined('SM_CHAT_BELL_ICON')) {
    define('SM_CHAT_BELL_ICON',
        'https://fonts.gstatic.com/s/i/googlematerialicons/notifications_active/v14/web_48dp/1x/baseline_notifications_active_black_48dp.png');
}

/**
 * Wrap a header + widgets array in the cardsV2 envelope.
 */
function _sm_chatCard(string $cardId, array $header, array $widgets): array
{
    return [
        'cardsV2' => [[
            'cardId' => $cardId,
            'card'   => [
                'header'   => $header,
                'sections' => [['widgets' => $widgets]],
            ],
        ]],
    ];
}

/** Escape user-provided text for chat HTML subset (b/i/font/br/a only). */
function _sm_chatEsc(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/** Muted footer chip with clock icon: "SOM-Portal · date · label". */
function _sm_chatFooter(string $label): array
{
    $muted = SM_CHAT_MUTED;
    $date  = date('d/m/Y');
    $text  = 'SOM-Portal · ' . $date . ($label ? " · {$label}" : '');
    return [
        'decoratedText' => [
            'startIcon' => ['knownIcon' => 'CLOCK'],
            'text'      => "<font color=\"{$muted}\">" . _sm_chatEsc($text) . '</font>',
        ],
    ];
}

/** Optional "ADMIN MESSAGE" block — returns [] when message is blank. */
function _sm_chatAdminMessage(string $msg): array
{
    $msg = trim($msg);
    if ($msg === '') return [];
    return [
        ['divider' => new stdClass()],
        [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'DESCRIPTION'],
                'topLabel'  => 'ADMIN MESSAGE',
                'text'      => nl2br(_sm_chatEsc($msg)),
                'wrapText'  => true,
            ],
        ],
    ];
}

// ═══════════════════════════════════════════════════════════════════
// 1. NEW COURSE
// ═══════════════════════════════════════════════════════════════════
function buildCourseChatCard(array $course, string $extraMsg = ''): array
{
    $title   = _sm_chatEsc($course['title']    ?? 'New Course');
    $subtitl = _sm_chatEsc($course['subtitle'] ?? '');
    $desc    = _sm_chatEsc($course['description'] ?? '');

    $widgets = [
        [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'BOOKMARK'],
                'topLabel'  => 'NEW COURSE',
                'text'      => "<b>{$title}</b>",
                'wrapText'  => true,
            ],
        ],
    ];
    if ($subtitl !== '') {
        $widgets[] = ['textParagraph' => ['text' => "<i>{$subtitl}</i>"]];
    }
    if ($desc !== '') {
        $widgets[] = ['textParagraph' => ['text' => nl2br($desc)]];
    }
    $widgets = array_merge($widgets, _sm_chatAdminMessage($extraMsg));
    $widgets[] = ['divider' => new stdClass()];
    $widgets[] = _sm_chatFooter('Course');

    return _sm_chatCard(
        'sm-email-noti-course-' . ($course['id'] ?? 'x'),
        [
            'title'     => '🚀 New Course Announcement',
            'subtitle'  => 'SOM-Portal · Broadcast',
            'imageUrl'  => SM_CHAT_BELL_ICON,
            'imageType' => 'CIRCLE',
        ],
        $widgets
    );
}

// ═══════════════════════════════════════════════════════════════════
// 2. NEW EXAM
// ═══════════════════════════════════════════════════════════════════
function buildExamChatCard(array $exam, string $extraMsg = ''): array
{
    $title    = _sm_chatEsc($exam['title']    ?? 'New Exam');
    $subtitl  = _sm_chatEsc($exam['subtitle'] ?? '');
    $desc     = _sm_chatEsc($exam['description'] ?? '');
    $passScore = (int)($exam['pass_score'] ?? 70);
    $maxAtt   = (int)($exam['config']['attempts']['max'] ?? 0);
    $orange   = SM_CHAT_ORANGE;

    $chip = "<b>PASS SCORE</b> · <font color=\"{$orange}\">{$passScore}%</font>";
    if ($maxAtt > 0) {
        $chip .= "&nbsp;&nbsp;·&nbsp;&nbsp;<b>MAX ATTEMPTS</b> · <font color=\"{$orange}\">{$maxAtt} ครั้ง</font>";
    }

    $widgets = [
        [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'BOOKMARK'],
                'topLabel'  => 'NEW EXAM',
                'text'      => "<b>{$title}</b>",
                'wrapText'  => true,
            ],
        ],
    ];
    if ($subtitl !== '') {
        $widgets[] = ['textParagraph' => ['text' => "<i>{$subtitl}</i>"]];
    }
    $widgets[] = [
        'decoratedText' => [
            'startIcon' => ['knownIcon' => 'DESCRIPTION'],
            'text'      => $chip,
            'wrapText'  => true,
        ],
    ];
    if ($desc !== '') {
        $widgets[] = ['textParagraph' => ['text' => nl2br($desc)]];
    }
    $widgets = array_merge($widgets, _sm_chatAdminMessage($extraMsg));
    $widgets[] = ['divider' => new stdClass()];
    $widgets[] = _sm_chatFooter('Exam');

    return _sm_chatCard(
        'sm-email-noti-exam-' . ($exam['id'] ?? 'x'),
        [
            'title'     => '🚀 New Exam Announcement',
            'subtitle'  => 'SOM-Portal · Broadcast',
            'imageUrl'  => SM_CHAT_BELL_ICON,
            'imageType' => 'CIRCLE',
        ],
        $widgets
    );
}

// ═══════════════════════════════════════════════════════════════════
// 3. COURSE + EXAM combined
// ═══════════════════════════════════════════════════════════════════
function buildCourseExamChatCard(array $course, array $exam, string $extraMsg = ''): array
{
    $cTitle = _sm_chatEsc($course['title']    ?? 'New Course');
    $cSub   = _sm_chatEsc($course['subtitle'] ?? '');
    $eTitle = _sm_chatEsc($exam['title']      ?? 'New Exam');
    $passScore = (int)($exam['pass_score'] ?? 70);
    $orange = SM_CHAT_ORANGE;

    $widgets = [
        [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'BOOKMARK'],
                'topLabel'  => 'NEW COURSE',
                'text'      => "<b>{$cTitle}</b>",
                'wrapText'  => true,
            ],
        ],
    ];
    if ($cSub !== '') {
        $widgets[] = ['textParagraph' => ['text' => "<i>{$cSub}</i>"]];
    }
    $widgets[] = ['divider' => new stdClass()];
    $widgets[] = [
        'decoratedText' => [
            'startIcon' => ['knownIcon' => 'STAR'],
            'topLabel'  => 'FINAL EXAM',
            'text'      => "<b>{$eTitle}</b>",
            'wrapText'  => true,
        ],
    ];
    $widgets[] = [
        'decoratedText' => [
            'startIcon' => ['knownIcon' => 'DESCRIPTION'],
            'text'      => "<b>PASS SCORE</b> · <font color=\"{$orange}\">{$passScore}%</font>",
            'wrapText'  => true,
        ],
    ];
    $widgets = array_merge($widgets, _sm_chatAdminMessage($extraMsg));
    $widgets[] = ['divider' => new stdClass()];
    $widgets[] = _sm_chatFooter('Course + Exam');

    return _sm_chatCard(
        'sm-email-noti-ce-' . ($course['id'] ?? 'x'),
        [
            'title'     => '🚀 New Course + Exam',
            'subtitle'  => 'SOM-Portal · Broadcast',
            'imageUrl'  => SM_CHAT_BELL_ICON,
            'imageType' => 'CIRCLE',
        ],
        $widgets
    );
}

// ═══════════════════════════════════════════════════════════════════
// 4. CUSTOM ANNOUNCEMENT
// ═══════════════════════════════════════════════════════════════════
function buildCustomChatCard(string $subject, string $body): array
{
    $subjectEsc = _sm_chatEsc($subject);
    $bodyEsc    = nl2br(_sm_chatEsc($body));

    $widgets = [
        [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'BOOKMARK'],
                'topLabel'  => 'ANNOUNCEMENT',
                'text'      => "<b>{$subjectEsc}</b>",
                'wrapText'  => true,
            ],
        ],
        ['textParagraph' => ['text' => $bodyEsc]],
        ['divider' => new stdClass()],
        _sm_chatFooter(''),
    ];

    return _sm_chatCard(
        'sm-email-noti-custom-' . substr(md5($subject), 0, 8),
        [
            'title'     => '📢 Team Announcement',
            'subtitle'  => 'SOM-Portal · Broadcast',
            'imageUrl'  => SM_CHAT_BELL_ICON,
            'imageType' => 'CIRCLE',
        ],
        $widgets
    );
}

// ═══════════════════════════════════════════════════════════════════
// 5. EXAM REMINDER (list of not-attempted names)
// ═══════════════════════════════════════════════════════════════════
/**
 * @param array    $exam
 * @param string[] $names       Users targeted by this reminder
 * @param string   $extraMsg    Optional admin message
 * @param string   $deadline    Optional deadline label (Thai date string)
 * @param int      $maxNames    Names to show inline before "...และอีก N คน" (default 15)
 * @param string   $examUrl     Deep-link to the exam page (rendered as inline <a>)
 * @param string   $targetLabel Section label describing the target audience
 *                              (e.g. "ยังไม่ได้ทำข้อสอบ" / "ทำแล้วแต่ยังไม่ผ่าน")
 */
function buildExamReminderChatCard(array $exam, array $names, string $extraMsg = '', string $deadline = '', int $maxNames = 15, string $examUrl = '', string $targetLabel = 'ยังไม่ได้ทำข้อสอบ'): array
{
    $title     = _sm_chatEsc($exam['title'] ?? 'Exam');
    $passScore = (int)($exam['pass_score'] ?? 70);
    $orange    = SM_CHAT_ORANGE;

    $chip = "<b>PASS SCORE</b> · <font color=\"{$orange}\">{$passScore}%</font>";
    if ($deadline !== '') {
        $chip .= "&nbsp;&nbsp;·&nbsp;&nbsp;<b>Deadline</b> · <font color=\"{$orange}\">" . _sm_chatEsc($deadline) . '</font>';
    }

    $total = count($names);
    $shown = array_slice($names, 0, $maxNames);
    $listHtml = '';
    foreach ($shown as $n) {
        $listHtml .= '• ' . _sm_chatEsc((string)$n) . '<br>';
    }
    if ($total > $maxNames) {
        $listHtml .= '<font color="' . SM_CHAT_MUTED . '">…และอีก ' . ($total - $maxNames) . ' คน</font>';
    } else {
        $listHtml = rtrim($listHtml, '<br>');
    }

    $widgets = [
        [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'BOOKMARK'],
                'topLabel'  => 'PENDING EXAM',
                'text'      => "<b>{$title}</b>",
                'wrapText'  => true,
            ],
        ],
        [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'DESCRIPTION'],
                'text'      => $chip,
                'wrapText'  => true,
            ],
        ],
    ];

    // Exam URL — rendered as an inline anchor (admin asked for a link, not a
    // button). Chat cards v2 accept <a href> inside decoratedText.text.
    if ($examUrl !== '') {
        $safeUrl = _sm_chatEsc($examUrl);
        $widgets[] = [
            'decoratedText' => [
                'startIcon' => ['knownIcon' => 'BOOKMARK'],
                'topLabel'  => 'EXAM LINK',
                'text'      => "<a href=\"{$safeUrl}\">{$safeUrl}</a>",
                'wrapText'  => true,
            ],
        ];
    }

    $widgets[] = ['divider' => new stdClass()];
    $widgets[] = [
        'decoratedText' => [
            'startIcon' => ['knownIcon' => 'PERSON'],
            'topLabel'  => _sm_chatEsc($targetLabel) . " ({$total} คน)",
            'text'      => $listHtml !== '' ? $listHtml : '<i>ไม่มีผู้รับ reminder 🎉</i>',
            'wrapText'  => true,
        ],
    ];
    $widgets = array_merge($widgets, _sm_chatAdminMessage($extraMsg));
    $widgets[] = ['divider' => new stdClass()];
    $widgets[] = _sm_chatFooter('Reminder');

    return _sm_chatCard(
        'sm-exam-reminder-' . ($exam['id'] ?? 'x'),
        [
            'title'     => '🔔 Exam Reminder',
            'subtitle'  => 'SOM-Portal · Reminder',
            'imageUrl'  => SM_CHAT_BELL_ICON,
            'imageType' => 'CIRCLE',
        ],
        $widgets
    );
}
