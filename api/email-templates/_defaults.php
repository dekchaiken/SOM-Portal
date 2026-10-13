<?php
/**
 * Default subject/intro strings for transactional emails, shared by the
 * email-templates endpoint (returned as "defaults" for UI restore) and by
 * api/mail/_templates.php (fallback when no per-team override is set).
 *
 * Supported placeholders in stored overrides: {name}, {app_name}
 */

function emailTemplateDefaults(): array {
    return [
        'welcome' => [
            'subject' => 'ยินดีต้อนรับสู่ {app_name} — บัญชีของคุณพร้อมใช้งาน',
            'intro'   => 'ผู้ดูแลระบบได้สร้างบัญชี {app_name} ให้คุณเรียบร้อยแล้ว — ใช้ข้อมูลด้านล่างเข้าสู่ระบบครั้งแรก',
        ],
        'reset_password_admin' => [
            'subject' => 'ตั้งรหัสผ่านใหม่ — {app_name}',
            'intro'   => 'ผู้ดูแลระบบได้ขอให้คุณ <strong>ตั้งรหัสผ่านใหม่</strong> สำหรับบัญชี {app_name} ของคุณ<br>กรุณาคลิกปุ่มด้านล่างเพื่อดำเนินการต่อ',
        ],
        'reset_password_forgot' => [
            'subject' => 'รีเซ็ตรหัสผ่าน — {app_name}',
            'intro'   => 'เราได้รับคำขอ <strong>รีเซ็ตรหัสผ่าน</strong> สำหรับบัญชีของคุณในระบบ {app_name}<br>หากคุณเป็นคนส่งคำขอนี้ กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่',
        ],
    ];
}

// Resolve subject/intro for a given key, applying stored override if any and
// substituting placeholders. Values come from data/{team}/email_templates.json.
function resolveEmailTemplate(string $key, array $vars = []): array {
    static $cache = null;
    if ($cache === null) $cache = readJson('email_templates.json');
    $defaults = emailTemplateDefaults();
    $def = $defaults[$key] ?? ['subject' => '', 'intro' => ''];

    $subject = trim((string)($cache[$key]['subject'] ?? '')) !== ''
        ? (string)$cache[$key]['subject']
        : $def['subject'];
    $intro   = trim((string)($cache[$key]['intro'] ?? '')) !== ''
        ? (string)$cache[$key]['intro']
        : $def['intro'];

    // Substitute placeholders — both keys are safe HTML (name is escaped upstream).
    $map = [];
    foreach ($vars as $k => $v) $map['{' . $k . '}'] = (string)$v;
    return [
        'subject' => strtr($subject, $map),
        'intro'   => strtr($intro,   $map),
    ];
}
