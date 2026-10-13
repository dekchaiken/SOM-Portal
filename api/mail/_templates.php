<?php
/**
 * Bauhaus-D email builders — used by all transactional/broadcast emails.
 *
 *   buildResetPasswordEmail($name, $resetUrl, $expiresAt, $reason): {subject, html}
 *   buildWelcomeEmail($name, $username, $tempPassword, $loginUrl):  {subject, html}
 *   buildCourseAnnouncementEmail($name, $course, $extraMsg, $url):  {subject, html}
 *   buildExamAnnouncementEmail($name, $exam, $extraMsg, $url):      {subject, html}
 *   buildCourseExamAnnouncementEmail($name, $course, $exam, $extraMsg, $courseUrl, $examUrl): {subject, html}
 *   buildCustomAnnouncementEmail($name, $subject, $bodyText):       {subject, html}
 *
 * Each builder returns an array {subject, html}. The HTML is a complete
 * <!doctype html> document wrapped by buildBrandedEmail() in _branding.php.
 *
 * Design language: see admin/email-mockups.html (option D — Bauhaus Block).
 * Fonts: JetBrains Mono (English) + IBM Plex Sans Thai (Thai), loaded by frame.
 */

require_once __DIR__ . '/_branding.php';

const _BD_ORANGE = '#F26419';
const _BD_BLACK  = '#111111';
const _BD_CREAM  = '#f4f1eb';

// ─── Private layout helpers ──────────────────────────────────────────────────

/**
 * The signature two-column Bauhaus hero — orange block (SMC label + big step
 * number) on the left, black block (type tag + main heading + accent bar) on
 * the right.
 *
 * @param string $stepNumber  "01" / "02" etc. (the cycle number — purely cosmetic)
 * @param string $sublabel    "BROADCAST" / "ACCOUNT" / "RESET" / "EXAM"
 * @param string $typeTag     "NEW COURSE" / "RESET PASSWORD" / ...
 * @param string $heading     The actual headline (HTML allowed — may contain <br>)
 */
function _bdHero(string $stepNumber, string $sublabel, string $typeTag, string $headingHtml): string {
    $stepN  = htmlspecialchars($stepNumber, ENT_QUOTES, 'UTF-8');
    $subL   = htmlspecialchars($sublabel,   ENT_QUOTES, 'UTF-8');
    $type   = htmlspecialchars($typeTag,    ENT_QUOTES, 'UTF-8');
    // headingHtml: caller responsible (may include <br>)

    return <<<HTML
<tr><td style="padding:0">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="38%" style="background:#F26419;padding:48px 32px;color:#fff;vertical-align:top;font-family:'JetBrains Mono','IBM Plex Sans Thai',monospace">
      <div style="width:54px;height:54px;background:#fff;border-radius:50%;display:inline-block"></div>
      <div style="font-size:13px;font-weight:700;letter-spacing:.22em;margin-top:24px">SMC</div>
      <div style="font-size:13px;letter-spacing:.22em;opacity:.85">{$subL}</div>
      <div style="font-size:68px;font-weight:900;margin-top:22px;line-height:1;font-family:'JetBrains Mono',monospace">{$stepN}</div>
    </td>
    <td width="62%" style="background:#111;padding:48px 32px;color:#fff;vertical-align:top;font-family:'JetBrains Mono','IBM Plex Sans Thai','Segoe UI',sans-serif">
      <div style="font-size:13px;letter-spacing:.22em;color:#F26419;font-weight:700;font-family:'JetBrains Mono',monospace">{$type}</div>
      <h1 style="font-size:36px;font-weight:800;margin:18px 0 0;letter-spacing:-.02em;line-height:1.16;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">{$headingHtml}</h1>
      <div style="margin-top:28px;height:5px;width:80px;background:#F26419"></div>
    </td>
  </tr></table>
</td></tr>
HTML;
}

/**
 * A numbered "step" row — the orange/black circle pill on the left + label
 * and title on the right. Used to structure the email into 01 / 02 / 03 beats.
 *
 * @param string $num       "01" / "02" / "03"
 * @param string $label     small uppercase label above the title (e.g. "HELLO")
 * @param string $title     main title text for this step
 * @param string $color     'orange' (default) | 'black' | 'outline'
 */
function _bdStepHead(string $num, string $label, string $title, string $color = 'orange'): string {
    $numEsc   = htmlspecialchars($num,   ENT_QUOTES, 'UTF-8');
    $labelEsc = htmlspecialchars($label, ENT_QUOTES, 'UTF-8');
    $titleEsc = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');

    if ($color === 'black') {
        $bullet = 'background:#111;color:#fff;border:none';
    } elseif ($color === 'outline') {
        $bullet = 'background:#111;border:3px solid #F26419;color:#fff';
    } else {
        $bullet = 'background:#F26419;color:#fff;border:none';
    }

    return <<<HTML
<tr><td style="padding:32px 44px 0;font-family:'JetBrains Mono','IBM Plex Sans Thai',sans-serif">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="width:48px;height:48px;{$bullet};border-radius:50%;text-align:center;font-size:16px;font-weight:800;line-height:42px;font-family:'JetBrains Mono',monospace">{$numEsc}</td>
    <td style="padding-left:18px;vertical-align:middle">
      <div style="font-size:11px;letter-spacing:.22em;color:#888;font-weight:700;font-family:'JetBrains Mono',monospace">{$labelEsc}</div>
      <div style="font-size:16px;color:#111;font-weight:700;margin-top:4px;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">{$titleEsc}</div>
    </td>
  </tr></table>
</td></tr>
HTML;
}

/**
 * The cream-background callout block that sits inside a step (the actual
 * content card). Has a left orange spine and free body HTML.
 */
function _bdCalloutBlock(string $innerHtml): string {
    return <<<HTML
<tr><td style="padding:18px 44px 0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb">
    <tr>
      <td width="6" style="background:#F26419"></td>
      <td style="padding:22px 28px;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">{$innerHtml}</td>
    </tr>
  </table>
</td></tr>
HTML;
}

/**
 * The amber "admin message" sticky block — used for extra messages, warnings,
 * expiry notices. Top orange bar + amber background.
 */
function _bdAmberNote(string $label, string $bodyHtml): string {
    $labelEsc = htmlspecialchars($label, ENT_QUOTES, 'UTF-8');
    return <<<HTML
<tr><td style="padding:22px 44px 0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-top:3px solid #F26419">
    <tr><td style="padding:20px 26px;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">
      <div style="font-size:11px;letter-spacing:.18em;color:#92400e;font-weight:800;font-family:'JetBrains Mono',monospace">▸ {$labelEsc}</div>
      <div style="margin:10px 0 0;font-size:14px;color:#78350f;line-height:1.75">{$bodyHtml}</div>
    </td></tr>
  </table>
</td></tr>
HTML;
}

/**
 * The bottom CTA button — orange block with optional dark spacer on the right
 * (matches the Bauhaus geometric vibe).
 */
function _bdCtaButton(string $url, string $label): string {
    $urlEsc   = htmlspecialchars($url,   ENT_QUOTES, 'UTF-8');
    $labelEsc = htmlspecialchars($label, ENT_QUOTES, 'UTF-8');
    return <<<HTML
<tr><td style="padding:22px 44px 44px">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="background:#F26419">
      <a href="{$urlEsc}" style="display:inline-block;padding:18px 40px;font-size:14px;font-weight:800;color:#fff;text-decoration:none;letter-spacing:.06em;font-family:'JetBrains Mono','IBM Plex Sans Thai',sans-serif">▶ &nbsp; {$labelEsc}</a>
    </td>
    <td style="background:#111;padding:0">
      <div style="width:18px;height:57px"></div>
    </td>
  </tr></table>
</td></tr>
HTML;
}

/**
 * Greeting block for "Step 01 · HELLO" — common to every transactional email.
 */
function _bdGreeting(string $name, string $followUpHtml = ''): string {
    $nameEsc = htmlspecialchars($name ?: 'ทีมงาน', ENT_QUOTES, 'UTF-8');
    $fu = $followUpHtml ? <<<EX
  <p style="margin:18px 0 0;font-size:15px;color:#555;line-height:1.75;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">{$followUpHtml}</p>
EX : '';
    return _bdStepHead('01', 'HELLO', "สวัสดีคุณ {$nameEsc}", 'orange') . <<<HTML
<tr><td style="padding:0 44px 0 44px">{$fu}</td></tr>
HTML;
}

// ═══════════════════════════════════════════════════════════════════════════
//   1. RESET PASSWORD EMAIL  (admin-triggered / forgot-password)
// ═══════════════════════════════════════════════════════════════════════════
function buildResetPasswordEmail(string $name, string $resetUrl, string $expiresAt, string $reason = 'admin'): array
{
    $cfg     = readJson('mail_config.json');
    $urlEsc  = htmlspecialchars($resetUrl, ENT_QUOTES, 'UTF-8');
    $expTs   = strtotime($expiresAt) ?: time() + 86400;
    $expFmt  = htmlspecialchars(date('d M Y, H:i', $expTs) . ' (Asia/Bangkok)', ENT_QUOTES, 'UTF-8');

    require_once __DIR__ . '/../email-templates/_defaults.php';
    $appName = trim((string)($cfg['from_name'] ?? '')) !== '' ? $cfg['from_name'] : 'SOM-Portal';
    $vars    = ['name' => htmlspecialchars($name, ENT_QUOTES, 'UTF-8'), 'app_name' => htmlspecialchars($appName, ENT_QUOTES, 'UTF-8')];

    if ($reason === 'forgot') {
        $typeTag = 'FORGOT PASSWORD';
        $tpl     = resolveEmailTemplate('reset_password_forgot', $vars);
    } else {
        $typeTag = 'ADMIN RESET';
        $tpl     = resolveEmailTemplate('reset_password_admin', $vars);
    }
    $subject = $tpl['subject'];
    $intro   = $tpl['intro'];

    $rows  = _bdHero('01', 'RESET', $typeTag, 'รีเซ็ต<br>รหัสผ่าน.');
    $rows .= _bdGreeting($name, $intro);

    $rows .= _bdStepHead('02', 'NOTICE', 'ลิงก์มีอายุจำกัด', 'black');
    $rows .= _bdAmberNote('LINK EXPIRES IN 24 HOURS', "หมดอายุ: <strong>{$expFmt}</strong><br>หากเลยกำหนด กรุณาขอลิงก์ใหม่จากหน้าเข้าสู่ระบบ");

    $rows .= _bdStepHead('03', 'ACTION', 'ตั้งรหัสผ่านใหม่', 'outline');
    $rows .= _bdCtaButton($resetUrl, 'ตั้งรหัสผ่านใหม่');

    // Plaintext fallback link
    $rows .= <<<HTML
<tr><td style="padding:0 44px 32px;font-family:'JetBrains Mono','IBM Plex Sans Thai',monospace">
  <div style="font-size:11px;letter-spacing:.05em;color:#888;margin-bottom:8px">// คัดลอกลิงก์ไปวางในเบราว์เซอร์ได้ถ้าปุ่มใช้ไม่ได้</div>
  <div style="font-size:12px;color:#475569;word-break:break-all;background:#f4f1eb;padding:12px 14px;border-left:3px solid #F26419;font-family:'JetBrains Mono',monospace">{$urlEsc}</div>
  <div style="font-size:11px;color:#94a3b8;line-height:1.65;margin-top:22px;border-top:1px solid #e2e8f0;padding-top:16px;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">
    หากคุณไม่ได้เป็นคนขอรีเซ็ตรหัสผ่าน สามารถละเลยอีเมลฉบับนี้ได้ — รหัสผ่านของคุณจะไม่ถูกเปลี่ยน
  </div>
</td></tr>
HTML;

    return ['subject' => $subject, 'html' => buildBrandedEmail($rows, $subject, $cfg, true)];
}

// ═══════════════════════════════════════════════════════════════════════════
//   2. WELCOME EMAIL  (new user account)
// ═══════════════════════════════════════════════════════════════════════════
function buildWelcomeEmail(string $name, string $username, string $tempPassword, string $loginUrl): array
{
    $cfg     = readJson('mail_config.json');
    $nameEsc = htmlspecialchars($name ?: $username, ENT_QUOTES, 'UTF-8');
    $userEsc = htmlspecialchars($username,           ENT_QUOTES, 'UTF-8');
    $pwEsc   = htmlspecialchars($tempPassword,       ENT_QUOTES, 'UTF-8');

    require_once __DIR__ . '/../email-templates/_defaults.php';
    $appName = trim((string)($cfg['from_name'] ?? '')) !== '' ? $cfg['from_name'] : 'SOM-Portal';
    $vars    = ['name' => $nameEsc, 'app_name' => htmlspecialchars($appName, ENT_QUOTES, 'UTF-8')];
    $tpl     = resolveEmailTemplate('welcome', $vars);
    $subject = $tpl['subject'];

    $rows  = _bdHero('01', 'ACCOUNT', 'WELCOME', 'บัญชีของคุณ<br>พร้อมแล้ว.');
    $rows .= _bdGreeting($name, $tpl['intro']);

    $rows .= _bdStepHead('02', 'CREDENTIALS', 'ข้อมูลเข้าสู่ระบบ', 'black');
    $credInner = <<<INNER
<table width="100%" cellpadding="0" cellspacing="0" style="font-family:'JetBrains Mono','IBM Plex Sans Thai',monospace">
  <tr><td style="padding-bottom:14px;border-bottom:1px dashed #d4cdc0">
    <div style="font-size:10px;color:#92400e;letter-spacing:.18em;font-weight:700">// USERNAME</div>
    <div style="font-size:16px;color:#111;font-weight:700;margin-top:4px;font-family:'JetBrains Mono',monospace">{$userEsc}</div>
  </td></tr>
  <tr><td style="padding-top:14px">
    <div style="font-size:10px;color:#92400e;letter-spacing:.18em;font-weight:700">// TEMP PASSWORD</div>
    <div style="font-size:16px;color:#111;font-weight:700;margin-top:4px;font-family:'JetBrains Mono',monospace">{$pwEsc}</div>
  </td></tr>
</table>
INNER;
    $rows .= _bdCalloutBlock($credInner);

    $rows .= _bdAmberNote('CHANGE PASSWORD ON FIRST LOGIN', 'กรุณาเปลี่ยนรหัสผ่านทันทีหลังเข้าสู่ระบบครั้งแรก — ระบบจะบังคับให้คุณตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน');

    $rows .= _bdStepHead('03', 'ACTION', 'เข้าสู่ระบบ', 'outline');
    $rows .= _bdCtaButton($loginUrl, 'เข้าสู่ระบบ');

    return ['subject' => $subject, 'html' => buildBrandedEmail($rows, $subject, $cfg, true)];
}

// ═══════════════════════════════════════════════════════════════════════════
//   3. COURSE ANNOUNCEMENT
// ═══════════════════════════════════════════════════════════════════════════
function buildCourseAnnouncementEmail(string $name, array $course, string $extraMsg, string $courseUrl, string $subjectOverride = ''): array
{
    $cfg = readJson('mail_config.json');

    $title    = htmlspecialchars($course['title']    ?? 'New Course', ENT_QUOTES, 'UTF-8');
    $subtitle = htmlspecialchars($course['subtitle'] ?? '',           ENT_QUOTES, 'UTF-8');
    $desc     = htmlspecialchars($course['description'] ?? '',        ENT_QUOTES, 'UTF-8');
    $icon     = htmlspecialchars($course['icon']     ?? '📚',         ENT_QUOTES, 'UTF-8');
    $courseId = htmlspecialchars($course['id']       ?? '',           ENT_QUOTES, 'UTF-8');

    // Subject: admin's override wins, else default to mandatory-training pattern.
    // Onboarding gets a fixed label since "Team Onboarding Platform" reads better
    // than the literal Thai title in inbox previews.
    if (trim($subjectOverride) !== '') {
        $subject = trim($subjectOverride);
    } elseif (($course['id'] ?? '') === '__onboarding__') {
        $subject = '🚀 [SM - Action Required] Mandatory Training: Team Onboarding Platform';
    } else {
        $subject = '🚀 [SM - Action Required] Mandatory Training: ' . ($course['title'] ?? 'New Course');
    }

    $rows  = _bdHero('01', 'BROADCAST', 'NEW COURSE', 'มีคอร์สเรียนใหม่<br>สำหรับทีม.');
    $rows .= _bdGreeting($name, 'ทีม SMC ขอประกาศคอร์สเรียนใหม่ — รายละเอียดของคอร์สอยู่ใน Step 02 ด้านล่าง');

    $rows .= _bdStepHead('02', 'THE COURSE', $course['title'] ?? 'New Course', 'black');
    $cardInner = <<<INNER
<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background:#F26419;color:#fff;font-size:24px;width:54px;height:54px;text-align:center;line-height:54px">{$icon}</td>
    <td style="padding-left:14px;vertical-align:middle;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">
      <div style="font-size:15px;font-weight:800;color:#111;letter-spacing:-.01em">{$title}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;font-family:'JetBrains Mono',monospace">{$courseId}</div>
    </td>
  </tr>
</table>
INNER;
    if ($subtitle) {
        $cardInner .= '<div style="margin-top:14px;font-size:13px;color:#3a3a3a;line-height:1.65;font-style:italic;border-left:3px solid #F26419;padding-left:12px;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . $subtitle . '</div>';
    }
    if ($desc) {
        $cardInner .= '<div style="margin-top:14px;font-size:12.5px;color:#444;line-height:1.75;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . nl2br($desc) . '</div>';
    }
    $rows .= _bdCalloutBlock($cardInner);

    if (trim($extraMsg) !== '') {
        $extraEsc = nl2br(htmlspecialchars($extraMsg, ENT_QUOTES, 'UTF-8'));
        $rows .= _bdAmberNote('ADMIN MESSAGE', $extraEsc);
    }

    $rows .= _bdStepHead('03', 'ACTION', 'เริ่มเรียน', 'outline');
    $rows .= _bdCtaButton($courseUrl, 'ไปยังคอร์ส');

    return ['subject' => $subject, 'html' => buildBrandedEmail($rows, $subject, $cfg, true)];
}

// ═══════════════════════════════════════════════════════════════════════════
//   4. EXAM ANNOUNCEMENT
// ═══════════════════════════════════════════════════════════════════════════
function buildExamAnnouncementEmail(string $name, array $exam, string $extraMsg, string $examUrl, string $subjectOverride = ''): array
{
    $cfg = readJson('mail_config.json');

    $title    = htmlspecialchars($exam['title']    ?? 'New Exam', ENT_QUOTES, 'UTF-8');
    $subtitle = htmlspecialchars($exam['subtitle'] ?? '',         ENT_QUOTES, 'UTF-8');
    $desc     = htmlspecialchars($exam['description'] ?? '',      ENT_QUOTES, 'UTF-8');
    $icon     = htmlspecialchars($exam['icon']     ?? '📝',       ENT_QUOTES, 'UTF-8');
    $examId   = htmlspecialchars($exam['id']       ?? '',         ENT_QUOTES, 'UTF-8');
    $passScore= (int)($exam['pass_score'] ?? 70);

    $subject = trim($subjectOverride) !== ''
        ? trim($subjectOverride)
        : '🚀 [SM - Action Required] Mandatory Exam: ' . ($exam['title'] ?? 'New Exam');

    $rows  = _bdHero('01', 'BROADCAST', 'NEW EXAM', 'ข้อสอบใหม่<br>สำหรับทีม.');
    $rows .= _bdGreeting($name, 'มีข้อสอบใหม่สำหรับทีมพร้อมให้คุณเข้าทำแล้ว — รายละเอียดด้านล่าง');

    $rows .= _bdStepHead('02', 'THE EXAM', $exam['title'] ?? 'New Exam', 'black');
    $cardInner = <<<INNER
<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background:#F26419;color:#fff;font-size:24px;width:54px;height:54px;text-align:center;line-height:54px">{$icon}</td>
    <td style="padding-left:14px;vertical-align:middle;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">
      <div style="font-size:15px;font-weight:800;color:#111;letter-spacing:-.01em">{$title}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;font-family:'JetBrains Mono',monospace">{$examId}</div>
    </td>
  </tr>
</table>
<div style="margin-top:14px;display:inline-block;background:#111;color:#fff;padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:.08em;font-family:'JetBrains Mono',monospace">▸ PASS SCORE · {$passScore}%</div>
INNER;
    if ($subtitle) {
        $cardInner .= '<div style="margin-top:14px;font-size:13px;color:#3a3a3a;line-height:1.65;font-style:italic;border-left:3px solid #F26419;padding-left:12px;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . $subtitle . '</div>';
    }
    if ($desc) {
        $cardInner .= '<div style="margin-top:14px;font-size:12.5px;color:#444;line-height:1.75;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . nl2br($desc) . '</div>';
    }
    $rows .= _bdCalloutBlock($cardInner);

    if (trim($extraMsg) !== '') {
        $extraEsc = nl2br(htmlspecialchars($extraMsg, ENT_QUOTES, 'UTF-8'));
        $rows .= _bdAmberNote('ADMIN MESSAGE', $extraEsc);
    }

    $rows .= _bdStepHead('03', 'ACTION', 'เริ่มทำข้อสอบ', 'outline');
    $rows .= _bdCtaButton($examUrl, 'เริ่มทำข้อสอบ');

    return ['subject' => $subject, 'html' => buildBrandedEmail($rows, $subject, $cfg, true)];
}

// ═══════════════════════════════════════════════════════════════════════════
//   4b. COURSE + EXAM ANNOUNCEMENT
//   Combined announcement — introduces a course and the exam that unlocks
//   after passing it. One subject, one email, two CTAs.
// ═══════════════════════════════════════════════════════════════════════════
function buildCourseExamAnnouncementEmail(
    string $name,
    array  $course,
    array  $exam,
    string $extraMsg,
    string $courseUrl,
    string $examUrl,
    string $subjectOverride = ''
): array {
    $cfg = readJson('mail_config.json');

    $cTitle    = htmlspecialchars($course['title']    ?? 'New Course', ENT_QUOTES, 'UTF-8');
    $cSubtitle = htmlspecialchars($course['subtitle'] ?? '',           ENT_QUOTES, 'UTF-8');
    $cDesc     = htmlspecialchars($course['description'] ?? '',        ENT_QUOTES, 'UTF-8');
    $cIcon     = htmlspecialchars($course['icon']     ?? '📚',         ENT_QUOTES, 'UTF-8');
    $cId       = htmlspecialchars($course['id']       ?? '',           ENT_QUOTES, 'UTF-8');

    $eTitle    = htmlspecialchars($exam['title']    ?? 'New Exam', ENT_QUOTES, 'UTF-8');
    $eSubtitle = htmlspecialchars($exam['subtitle'] ?? '',         ENT_QUOTES, 'UTF-8');
    $eDesc     = htmlspecialchars($exam['description'] ?? '',      ENT_QUOTES, 'UTF-8');
    $eIcon     = htmlspecialchars($exam['icon']     ?? '📝',       ENT_QUOTES, 'UTF-8');
    $eId       = htmlspecialchars($exam['id']       ?? '',         ENT_QUOTES, 'UTF-8');
    $passScore = (int)($exam['pass_score'] ?? 70);

    if (trim($subjectOverride) !== '') {
        $subject = trim($subjectOverride);
    } else {
        $subject = '🚀 [SM - Action Required] Mandatory Training + Exam: ' . ($course['title'] ?? 'New Course');
    }

    $rows  = _bdHero('01', 'BROADCAST', 'COURSE + EXAM', 'คอร์สใหม่<br>+ ข้อสอบจบคอร์ส.');
    $rows .= _bdGreeting($name, 'ทีม SMC ขอประกาศคอร์สเรียนใหม่พร้อมข้อสอบจบคอร์ส — เรียนคอร์สให้จบก่อน แล้วข้อสอบจะเปิดให้ทำ');

    // ── Step 02 · THE COURSE ──
    $rows .= _bdStepHead('02', 'THE COURSE', $course['title'] ?? 'New Course', 'black');
    $courseCard = <<<INNER
<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background:#F26419;color:#fff;font-size:24px;width:54px;height:54px;text-align:center;line-height:54px">{$cIcon}</td>
    <td style="padding-left:14px;vertical-align:middle;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">
      <div style="font-size:15px;font-weight:800;color:#111;letter-spacing:-.01em">{$cTitle}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;font-family:'JetBrains Mono',monospace">{$cId}</div>
    </td>
  </tr>
</table>
INNER;
    if ($cSubtitle) {
        $courseCard .= '<div style="margin-top:14px;font-size:13px;color:#3a3a3a;line-height:1.65;font-style:italic;border-left:3px solid #F26419;padding-left:12px;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . $cSubtitle . '</div>';
    }
    if ($cDesc) {
        $courseCard .= '<div style="margin-top:14px;font-size:12.5px;color:#444;line-height:1.75;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . nl2br($cDesc) . '</div>';
    }
    $rows .= _bdCalloutBlock($courseCard);

    // ── Step 03 · THE EXAM ──
    $rows .= _bdStepHead('03', 'THE EXAM', $exam['title'] ?? 'New Exam', 'black');
    $examCard = <<<INNER
<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background:#111;color:#fff;font-size:24px;width:54px;height:54px;text-align:center;line-height:54px">{$eIcon}</td>
    <td style="padding-left:14px;vertical-align:middle;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">
      <div style="font-size:15px;font-weight:800;color:#111;letter-spacing:-.01em">{$eTitle}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;font-family:'JetBrains Mono',monospace">{$eId}</div>
    </td>
  </tr>
</table>
<div style="margin-top:14px;display:inline-block;background:#111;color:#fff;padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:.08em;font-family:'JetBrains Mono',monospace">▸ PASS SCORE · {$passScore}%</div>
<div style="margin-top:10px;display:inline-block;background:#F26419;color:#fff;padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:.08em;font-family:'JetBrains Mono',monospace;margin-left:6px">▸ UNLOCKS AFTER COURSE</div>
INNER;
    if ($eSubtitle) {
        $examCard .= '<div style="margin-top:14px;font-size:13px;color:#3a3a3a;line-height:1.65;font-style:italic;border-left:3px solid #111;padding-left:12px;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . $eSubtitle . '</div>';
    }
    if ($eDesc) {
        $examCard .= '<div style="margin-top:14px;font-size:12.5px;color:#444;line-height:1.75;font-family:\'IBM Plex Sans Thai\',\'JetBrains Mono\',sans-serif">' . nl2br($eDesc) . '</div>';
    }
    $rows .= _bdCalloutBlock($examCard);

    if (trim($extraMsg) !== '') {
        $extraEsc = nl2br(htmlspecialchars($extraMsg, ENT_QUOTES, 'UTF-8'));
        $rows .= _bdAmberNote('ADMIN MESSAGE', $extraEsc);
    }

    // ── Step 04 · ACTION — two CTAs stacked ──
    $rows .= _bdStepHead('04', 'ACTION', 'เริ่มเรียน · ทำข้อสอบ', 'outline');
    $rows .= _bdCtaButton($courseUrl, '① ไปยังคอร์ส');
    $rows .= _bdCtaButton($examUrl,   '② เริ่มทำข้อสอบ');

    return ['subject' => $subject, 'html' => buildBrandedEmail($rows, $subject, $cfg, true)];
}

// ═══════════════════════════════════════════════════════════════════════════
//   5. CUSTOM ANNOUNCEMENT  (free-form admin message)
// ═══════════════════════════════════════════════════════════════════════════
function buildCustomAnnouncementEmail(string $name, string $subject, string $bodyText): array
{
    $cfg     = readJson('mail_config.json');
    $bodyEsc = nl2br(htmlspecialchars(trim($bodyText), ENT_QUOTES, 'UTF-8'));
    $subj    = trim($subject) !== '' ? $subject : 'ประกาศจากทีม SMC';
    $subjEsc = htmlspecialchars(mb_strlen($subj) > 60 ? mb_substr($subj, 0, 57) . '...' : $subj, ENT_QUOTES, 'UTF-8');

    $rows  = _bdHero('01', 'BROADCAST', 'ANNOUNCEMENT', 'ประกาศจากทีม.');
    $rows .= _bdGreeting($name, 'มีประกาศจากทีม SMC สำหรับคุณ — รายละเอียดอยู่ด้านล่าง');

    $rows .= _bdStepHead('02', 'SUBJECT', $subjEsc, 'black');
    $rows .= _bdCalloutBlock("<div style=\"font-size:13px;color:#222;line-height:1.85;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif\">{$bodyEsc}</div>");

    // Custom announcements have no CTA — add a generic closing note
    $rows .= <<<HTML
<tr><td style="padding:32px 44px 44px;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">
  <div style="height:4px;width:80px;background:#F26419;margin-bottom:18px"></div>
  <div style="font-size:12px;color:#888;line-height:1.75;letter-spacing:.02em">
    อีเมลฉบับนี้ถูกส่งถึงสมาชิกทีม SMC ที่ผู้ดูแลระบบเลือก<br>
    หากมีข้อสงสัยติดต่อ <a href="mailto:sm@ascendcorp.com" style="color:#F26419;text-decoration:none">sm@ascendcorp.com</a>
  </div>
</td></tr>
HTML;

    return ['subject' => $subj, 'html' => buildBrandedEmail($rows, $subj, $cfg, true)];
}
