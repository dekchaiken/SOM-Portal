/* ══════════════════════════════════════════════════
   log-explain-th.js  —  Thai-language explanations for audit log entries
   ══════════════════════════════════════════════════

   Turns cryptic event keys (`login_failed`, `board_hard_delete`, `pf_add_job`)
   into readable Thai captions on the admin/logs page.

   Two layers:
   1. EXPLAIN_TH — curated per-action entries. Every security/error event has
      one, plus any activity action whose meaning isn't obvious from its name.
   2. Pattern fallback — for CRUD-shaped names (`_create`/`_update`/`_delete`
      ฯลฯ) we combine a verb table with a noun table to generate a decent
      caption. Pattern hits still count as `matched` (no "not documented"
      note in the UI).

   Public API: LogExplainTH.get(action, entry?) → { short, long, cause, matched }
   ══════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // ── Curated dictionary ────────────────────────────────────────────────
  const EXPLAIN_TH = {
    // ─── Auth ─────────────────────────────────────────────────────────
    login:                        { short: 'เข้าสู่ระบบสำเร็จ' },
    login_success:                { short: 'เข้าสู่ระบบสำเร็จ (บันทึกฝั่ง security)' },
    logout:                       { short: 'ออกจากระบบ' },
    password_change:              { short: 'ผู้ใช้เปลี่ยนรหัสผ่านเอง' },
    password_reset_via_token:     { short: 'รีเซ็ตรหัสผ่านผ่านลิงก์อีเมล' },
    password_reset_completed:     { short: 'รีเซ็ตรหัสผ่านสำเร็จ (บันทึกฝั่ง security)' },
    profile_update:               { short: 'อัปเดตข้อมูลโปรไฟล์ผู้ใช้' },

    // ─── Security: failed auth ────────────────────────────────────────
    login_failed: {
      short: 'พยายามล็อกอินแต่รหัสผ่าน/username ผิด',
      cause: 'ผู้ใช้พิมพ์ผิด หรืออาจเป็นการเดารหัส (brute-force)',
      long:  'ระบบไม่พบ user หรือรหัสผ่านไม่ตรง — บันทึกไว้เพื่อตรวจสอบพฤติกรรมและป้องกันการเดารหัสอัตโนมัติ',
    },
    brute_force_blocked: {
      short: 'บล็อกชั่วคราวเพราะพยายามล็อกอินผิดซ้ำเกินกำหนด',
      cause: 'มี login ผิดเกิน 5 ครั้งในช่วงสั้นๆ จาก IP/username เดียวกัน',
      long:  'ระบบตัดการ login 15 นาที เพื่อป้องกัน brute-force — ตรวจดูว่าเป็นผู้ใช้จริงลืมรหัส หรือเป็นการโจมตี',
    },
    login_block_reset: {
      short: 'Admin ปลดล็อกการ login block ให้ผู้ใช้',
      cause: 'ผู้ใช้ถูกล็อกจากการพิมพ์รหัสผิดหลายครั้ง แล้ว admin ปลดให้',
    },
    token_invalid: {
      short: 'JWT token ไม่ถูกต้อง / หมดอายุ / ถูกดัดแปลง',
      cause: 'session หมดอายุ, ล็อกอินจากเครื่องใหม่, หรือมีการปลอมแปลง token',
      long:  'API ปฏิเสธ request เพราะ verify token ไม่ผ่าน — browser จะพา user ไปหน้า login ใหม่',
    },
    auth_no_token: {
      short: 'เรียก API โดยไม่ได้แนบ token',
      cause: 'ผู้ใช้ยังไม่ได้ login, หรือ script เรียก endpoint ที่ต้องยืนยันตัวตน',
    },
    forbidden: {
      short: 'ผู้ใช้ไม่มีสิทธิ์ทำ action นี้',
      cause: 'role ของผู้ใช้ไม่ครอบคลุมสิทธิ์ที่ต้องการ',
    },
    forbidden_page: {
      short: 'พยายามเข้าหน้าเว็บที่ไม่มีสิทธิ์',
      cause: 'ผู้ใช้เปิด admin page แต่ role ไม่ถึง',
    },
    page_mode_forbidden: {
      short: 'หน้านี้ถูกปิดสำหรับ role ของผู้ใช้ (page mode)',
      cause: 'admin ตั้ง page mode ให้เฉพาะบาง role เข้าได้',
    },
    feature_forbidden: {
      short: 'ทีมนี้ไม่ได้เปิดใช้งานฟีเจอร์',
      cause: 'ฟีเจอร์ที่เรียกใช้ ไม่ได้ถูกเปิดในการตั้งค่าของทีม',
    },
    sm_coverage_denied: {
      short: 'ผู้ใช้ไม่ใช่ SM coverage admin แต่พยายามแก้ shared resource',
      cause: 'resource ที่แชร์ทั้งระบบ (SM-owned) จำกัดให้เฉพาะ SM admin เท่านั้นที่แก้ได้',
    },
    super_viewer_access_denied: {
      short: 'บัญชี super-viewer ถูกปฏิเสธ (ไม่มีสิทธิ์เข้าถึง endpoint นี้)',
    },
    super_viewer_write_blocked: {
      short: 'บัญชี super-viewer พยายามใช้ method เขียนข้อมูล (POST/PUT/DELETE)',
      cause: 'super_viewer ตั้งใจให้ read-only — เขียนข้อมูลจะถูกบล็อกอัตโนมัติ',
    },
    csrf_validation_failed: {
      short: 'CSRF token ไม่ตรง — request อาจถูกยิงจากเว็บอื่น',
      cause: 'CSRF token หมดอายุ, ไม่ได้แนบ, หรือมีคน craft request มาจากภายนอก',
    },
    file_upload_threat_detected: {
      short: 'ไฟล์ที่อัปโหลดเข้ามาโดนสแกนแล้วพบว่าเป็นอันตราย',
      cause: 'พบ signature ของ malware / script อันตราย ใน content ของไฟล์',
      long:  'อัปโหลดถูกปฏิเสธ ไฟล์ไม่ได้ถูกเก็บ — ตรวจสอบ detail เพื่อดูชนิดของภัยคุกคามที่พบ',
    },
    api_rate_limit_exceeded: {
      short: 'ยิง API ถี่เกิน rate limit',
      cause: 'ผู้ใช้/script เรียก API ถี่เกิน — อาจเป็น bug ที่ loop หรือกำลัง scrape',
      long:  'ระบบตัด request ชั่วคราวเพื่อกันเซิร์ฟเวอร์ล่ม — ถ้าเห็นบ่อยจากผู้ใช้จริง ตรวจว่า UI มี infinite loop หรือ polling ถี่ไปหรือไม่',
    },
    jenkins_build_checker_submit_blocked: {
      short: 'ผู้ใช้ role "checker" พยายามสร้าง Jenkins build request',
      cause: 'checker มีสิทธิ์แค่ตรวจสอบ/อนุมัติ — สร้าง request เองไม่ได้',
    },
    restart_monitor_upload_unauthorized: {
      short: 'มีคนเรียก endpoint อัปโหลด restart monitor โดยไม่มีสิทธิ์',
      cause: 'ต้องเป็น n8n / service account ที่ตั้งไว้ — request นี้ไม่ผ่าน auth',
    },

    // ─── Forgot password flow ─────────────────────────────────────────
    forgot_password_no_email: { short: 'กรอก forgot password แต่ไม่ได้ใส่อีเมล' },
    forgot_password_no_user:  { short: 'ไม่พบผู้ใช้ตามอีเมลที่กรอก — ไม่ส่งอีเมล reset', cause: 'อีเมลไม่ตรงกับบัญชีในระบบ' },
    forgot_password_invalid_input: { short: 'input ที่ส่งมาไม่ผ่าน validation (รูปแบบอีเมลผิด)' },
    forgot_password_rate_limited:  { short: 'ขอ reset ถี่เกินไปจาก IP เดียวกัน', cause: 'อาจเป็นการเดา email อัตโนมัติ' },
    forgot_password_sent:     { short: 'ส่งอีเมล reset password ให้ผู้ใช้แล้ว' },
    forgot_password_email_failed: { short: 'ส่งอีเมล reset ไม่สำเร็จ (SMTP error)', cause: 'SMTP config ผิด, mailbox ปลายทางเต็ม, หรือเน็ตหลุด' },
    reset_email_failed:       { short: 'ส่งอีเมลยืนยัน reset ไม่สำเร็จ', cause: 'SMTP หรือ mailbox ปลายทางมีปัญหา' },
    reset_token_invalid:      { short: 'reset token ที่ใช้ไม่ถูกต้อง/หมดอายุ', cause: 'ลิงก์เก่าเกิน 30 นาที หรือถูกใช้ไปแล้ว' },
    reset_token_orphan:       { short: 'reset token ถูกต้อง แต่ user ถูกลบไปแล้ว', cause: 'ผู้ใช้ถูก admin ลบระหว่างที่ยังถือลิงก์ reset' },
    user_create_email_failed: { short: 'สร้าง user สำเร็จ แต่ส่งอีเมลแจ้ง credential ไม่ได้', cause: 'ตรวจ SMTP หรือ email address ของ user ที่สร้าง' },

    // ─── Server errors ────────────────────────────────────────────────
    fatal_error: {
      short: 'PHP เกิด fatal error — script หยุดทำงานกลางคัน',
      cause: 'syntax error, memory exhausted, หรือเรียก function ที่ไม่มี',
      long:  'ระบบเจอ error รุนแรงที่ทำงานต่อไม่ได้ — ตรวจ detail เพื่อหา file/line',
    },
    uncaught_exception: {
      short: 'มี exception ที่ไม่ได้ถูก catch ในโค้ด',
      cause: 'โยน Exception แต่ไม่มี try-catch ครอบ',
      long:  'ถือเป็น bug ที่ควรแก้ — ครอบ try-catch หรือแก้ที่ต้นเหตุ',
    },
    server_error: {
      short: 'API ตอบกลับด้วย HTTP 5xx',
      cause: 'เซิร์ฟเวอร์เกิดปัญหาภายใน (bug, DB down, external API ล่ม, ฯลฯ)',
      long:  'ผู้ใช้จะเห็น error toast — ตรวจ detail เพื่อดูว่า endpoint ไหนพัง',
    },
    integration_error: {
      short: 'เชื่อมต่อระบบภายนอก (Jira/Jenkins/Grafana/OpenSearch/etc.) ล้มเหลว',
      cause: 'API ปลายทาง down, credential หมดอายุ, network timeout, หรือ endpoint เปลี่ยน',
    },
    backup_failed:         { short: 'สร้าง backup ล้มเหลว', cause: 'พื้นที่ disk เต็ม, permission ผิด, หรือมี process ล็อกไฟล์อยู่' },
    backup_restore_failed: { short: 'restore backup ล้มเหลว', cause: 'ไฟล์ backup เสียหาย หรือ schema ไม่ตรงกับ code เวอร์ชันปัจจุบัน' },
    alert_monitor_sync_error: { short: 'sync alerts จากปลายทางล้มเหลว', cause: 'Grafana ตอบไม่ทัน / credential หมดอายุ / endpoint เปลี่ยน' },

    // ─── Client errors ────────────────────────────────────────────────
    js_error: {
      short: 'JavaScript ในหน้าเว็บของผู้ใช้เกิด error',
      cause: 'bug ใน frontend, browser เก่า, หรือ extension รบกวน',
    },
    api_error: {
      short: 'Frontend เรียก API แล้วได้ error กลับมา',
      cause: 'endpoint 4xx/5xx, network ตัด, หรือ response ไม่ตรง schema',
    },
    unhandled_rejection: {
      short: 'Promise reject แต่ไม่ได้ .catch()',
      cause: 'โค้ดลืมจัดการ error path — งานพังเงียบๆ ในเบื้องหลัง',
    },

    // ─── Board ────────────────────────────────────────────────────────
    board_create:        { short: 'โพสต์เรื่องใหม่ใน Service Board' },
    board_update:        { short: 'แก้ไขเนื้อหาโพสต์ใน Service Board' },
    board_delete:        { short: 'ย้ายโพสต์ไปถังขยะ (soft-delete)' },
    board_hard_delete:   { short: 'ลบโพสต์ออกถาวร (กู้คืนไม่ได้)', cause: 'admin เลือกลบจากถังขยะ' },
    board_restore:       { short: 'กู้โพสต์คืนจากถังขยะ' },
    board_auto_purge:    { short: 'ระบบลบโพสต์ในถังขยะอัตโนมัติตามอายุ' },
    board_pin:           { short: 'ปักหมุด/เลิกปักหมุดโพสต์' },
    board_status_change: { short: 'เปลี่ยนสถานะโพสต์ (open / in_progress / resolved)' },
    board_search:        { short: 'ค้นหาบน Service Board' },
    board_comment:       { short: 'เพิ่มคอมเมนต์บนโพสต์' },
    board_star:          { short: 'บุ๊กมาร์กโพสต์ (star)' },
    board_unstar:        { short: 'เอาบุ๊กมาร์กออก' },
    comment_delete:      { short: 'ลบคอมเมนต์' },
    comment_edit:        { short: 'แก้ไขคอมเมนต์' },
    comment_restore:     { short: 'กู้คอมเมนต์ที่ลบไปแล้วคืน' },

    // ─── User & team admin ────────────────────────────────────────────
    user_create:               { short: 'สร้างบัญชีผู้ใช้ใหม่' },
    user_update:               { short: 'แก้ไขข้อมูลผู้ใช้ (role, ชื่อ, ทีม)' },
    user_delete:               { short: 'ลบบัญชีผู้ใช้' },
    user_reset_password:       { short: 'Admin รีเซ็ตรหัสผ่านให้ผู้ใช้' },
    user_force_password_reset: { short: 'บังคับให้ผู้ใช้เปลี่ยนรหัสตอน login ครั้งถัดไป' },
    settings_update:           { short: 'แก้ไข system settings' },
    team_created:              { short: 'สร้างทีมใหม่ในระบบ' },
    team_deactivated:          { short: 'ปิดใช้งานทีม (ยังไม่ลบข้อมูล)' },
    team_deleted:              { short: 'ลบทีมและข้อมูลทั้งหมด' },
    team_config_update:        { short: 'แก้ config ของทีม' },
    team_permissions_updated:  { short: 'ปรับสิทธิ์เข้าถึงของทีม' },
    menu_permissions_update:   { short: 'ปรับ menu ที่แต่ละ role มองเห็น' },
    feature_config_copied:     { short: 'copy config feature จากทีมอื่นมา' },
    feature_requested:         { short: 'ทีมยื่นขอเปิดใช้ฟีเจอร์เพิ่ม' },
    email_templates_updated:   { short: 'แก้ template อีเมลของระบบ' },

    // ─── Jira / Jenkins core ──────────────────────────────────────────
    jira_create_ticket:    { short: 'สร้าง Jira ticket ใหม่ผ่าน portal' },
    jira_add_comment:      { short: 'ใส่คอมเมนต์ใน Jira ticket' },
    jira_assign:           { short: 'มอบหมาย Jira ticket ให้ผู้ใช้' },
    jira_attach:           { short: 'แนบไฟล์ใน Jira ticket' },
    jira_transition:       { short: 'เปลี่ยน status ของ Jira ticket' },
    // ─── MA Backoffice (Admin Portal — ปิด/เปิด MA บน Portal จริง) ──────
    ma_backoffice_toggle: {
      short: 'กดปุ่ม Toggle MA บน Admin Portal (เปิด/ปิดสถานะ Use Case)',
      long:  'ผู้ใช้กดปุ่ม AVAILABLE หรือ MAINTENANCE ในหน้า MA Services — ระบบเรียก Admin Portal API ด้วย service account sm@ascendcorp.com และบันทึกผลลัพธ์',
    },
    ma_backoffice_save: {
      short: 'บันทึกข้อมูล Use Case (Full Edit) ผ่าน Admin Portal',
      long:  'ผู้ใช้เปิด modal "Edit Use Case" แล้วกด Save — ส่งข้อมูลทั้งหมด (ชื่อ, สถานะ, message TH/EN, property IDs) ไปที่ Admin Portal API',
    },
    ma_backoffice_toggle_failed: {
      short: 'Toggle MA ล้มเหลว — Admin Portal ตอบ error',
      cause: 'token หมดอายุ, property ID ผิด, หรือ Admin Portal ไม่พร้อม',
    },
    ma_backoffice_save_failed: {
      short: 'Full Edit MA ล้มเหลว — Admin Portal ตอบ error',
      cause: 'payload ไม่ถูกต้อง, property ID ผิด, หรือ Admin Portal ไม่พร้อม',
    },

    jenkins_server_create: { short: 'เพิ่ม Jenkins server ในระบบ' },
    jenkins_server_update: { short: 'แก้ config ของ Jenkins server' },
    jenkins_server_delete: { short: 'ลบ Jenkins server' },
    jenkins_build_trigger: { short: 'สั่งรัน Jenkins job จากใน portal' },
    jenkins_build_submit:  { short: 'สร้างคำขอรัน Jenkins build (รออนุมัติ)' },
    jenkins_build_approve: { short: 'อนุมัติคำขอ Jenkins build → job เข้า queue' },
    jenkins_build_reject:  { short: 'ปฏิเสธคำขอ Jenkins build' },

    // ─── Jenkins portal (per-server maker/checker flow) ──────────────
    jenkins_portal_trigger:       { short: 'สั่งรัน job ผ่าน Jenkins Portal (maker-checker)' },
    jenkins_portal_app_add:       { short: 'เพิ่ม app/tool ใน Jenkins Portal' },
    jenkins_portal_app_delete:    { short: 'ลบ app/tool ใน Jenkins Portal' },
    jenkins_portal_user_create:   { short: 'สร้าง Jenkins Portal user (maker/checker)' },
    jenkins_portal_user_update:   { short: 'แก้ Jenkins Portal user' },
    jenkins_portal_user_delete:   { short: 'ลบ Jenkins Portal user' },
    jenkins_portal_user_reset:    { short: 'รีเซ็ตรหัส Jenkins Portal user' },
    jenkins_portal_user_unlock:   { short: 'ปลดล็อก Jenkins Portal user ที่โดนล็อก' },
    jenkins_portal_history_clear: { short: 'ล้างประวัติการรันใน Jenkins Portal' },
    jenkins_portal_logs_clear:    { short: 'ล้าง log ใน Jenkins Portal' },

    // ─── Service Operations Jenkins (so_jenkins — คู่ขนานสำหรับทีม SO) ──
    so_jenkins_trigger:      { short: 'SO Portal — สั่งรัน Jenkins job' },
    so_jenkins_user_create:  { short: 'SO Portal — สร้าง Jenkins Portal user' },
    so_jenkins_user_update:  { short: 'SO Portal — แก้ Jenkins Portal user' },
    so_jenkins_user_delete:  { short: 'SO Portal — ลบ Jenkins Portal user' },
    so_jenkins_user_reset:   { short: 'SO Portal — รีเซ็ตรหัส user' },
    so_jenkins_user_unlock:  { short: 'SO Portal — ปลดล็อก user' },
    so_jenkins_history_clear:{ short: 'SO Portal — ล้างประวัติการรัน' },
    so_jenkins_logs_clear:   { short: 'SO Portal — ล้าง log' },

    // ─── Notifications & email ────────────────────────────────────────
    noti_chat_sent:         { short: 'ส่งข้อความแจ้งเตือนเข้า Google Chat / Line' },
    noti_chat_test:         { short: 'ทดสอบส่งข้อความไปยัง chat webhook' },
    email_sent:             { short: 'ส่งอีเมลออกจากระบบ' },
    test_email_sent:        { short: 'ทดสอบส่ง email (ตรวจ SMTP)' },
    inbox_sent:             { short: 'ส่งข้อความเข้า inbox ผู้ใช้ในระบบ' },
    announcement_create:    { short: 'สร้างประกาศแสดงในหน้าแรก' },
    announcement_delete:    { short: 'ลบประกาศ' },
    email_noti_broadcast:   { short: 'ส่งอีเมล broadcast ให้ผู้ใช้จำนวนมาก' },
    email_noti_chat_broadcast: { short: 'ส่ง broadcast ทั้ง email และ chat' },
    fh_email_config_save:   { short: 'บันทึก config อีเมลของ Feature Health' },
    batch_monitor_noti_sent:            { short: 'ส่งแจ้งเตือน batch monitor ออกจากระบบ' },
    batch_monitor_noti_webhook_save:    { short: 'บันทึก webhook สำหรับ batch monitor' },
    batch_monitor_noti_webhook_clear:   { short: 'ล้าง webhook batch monitor' },
    batch_monitor_noti_webhook_test:    { short: 'ทดสอบยิง webhook batch monitor' },
    mail_config_updated:    { short: 'แก้ SMTP config ของระบบ' },

    // ─── Health & monitoring ──────────────────────────────────────────
    health_check:          { short: 'ระบบเช็ก health ของ integration' },
    uptime_monitor_add:    { short: 'เพิ่ม uptime monitor' },
    uptime_monitor_delete: { short: 'ลบ uptime monitor' },
    alert_monitor_config_update: { short: 'แก้ config ของ Alert Monitor' },
    alert_monitor_sync:    { short: 'ดึงข้อมูล alerts จาก source (Grafana ฯลฯ)' },

    // ─── Grafana alerts ───────────────────────────────────────────────
    grafana_alert_resume:      { short: 'ยกเลิก silence ของ Grafana alert (ให้กลับมาแจ้งเตือนได้)' },
    grafana_alerts_config_save:{ short: 'บันทึก config ระบบดึง Grafana alerts' },
    grafana_alerts_test_send:  { short: 'ทดสอบส่งสรุป Grafana alerts ไป webhook' },
    grafana_source_create:     { short: 'เพิ่ม Grafana data source' },
    grafana_source_update:     { short: 'แก้ Grafana data source' },
    grafana_source_delete:     { short: 'ลบ Grafana data source' },
    grafana_source_test:       { short: 'ทดสอบเชื่อมต่อ Grafana source' },

    // ─── Backup / maintenance ─────────────────────────────────────────
    backup_created:    { short: 'สร้าง backup ของข้อมูลระบบ' },
    backup_downloaded: { short: 'admin ดาวน์โหลด backup' },
    backup_deleted:    { short: 'ลบไฟล์ backup' },
    backup_restored:   { short: 'restore ข้อมูลจาก backup — เขียนทับข้อมูลปัจจุบัน', cause: 'ใช้กู้ข้อมูลหลังพลาด (ระวังทับของใหม่)' },
    cache_cleared:     { short: 'ล้าง cache ของระบบ' },
    cleanup_completed: { short: 'ระบบทำ housekeeping/cleanup เสร็จเรียบร้อย' },
    logs_rotated:      { short: 'ระบบหมุน log file (ตัดเก็บของเก่า)' },
    maintenance_global:{ short: 'เปิด maintenance mode ทั้งระบบ', cause: 'admin เตรียมทำ deploy หรือแก้ปัญหา' },
    maintenance_page:  { short: 'เปิด maintenance mode เฉพาะบางหน้า' },
    maintenance_tool:  { short: 'เปิด maintenance mode เฉพาะบาง tool' },

    // ─── Restart Monitor (pod restart audit) ─────────────────────────
    restart_monitor_iteration_start: {
      short: 'เริ่มรอบดึง restart data ของ runway หนึ่ง',
      cause: 'บันทึกไว้เพื่อ debug — ถ้า iteration หาย = job ตายกลางคัน',
    },
    restart_monitor_raw_fetch:         { short: 'ดึง restart data จาก Grafana/Prometheus สำเร็จ' },
    restart_monitor_raw_fetch_empty:   { short: 'ดึงมาสำเร็จ แต่ไม่พบข้อมูล restart', cause: 'ช่วงเวลานั้น pod ไม่ restart จริง หรือ query ไม่ตรง label' },
    restart_monitor_raw_fetch_retry:   { short: 'ดึงข้อมูลรอบแรกล้มเหลว — retry ใหม่' },
    restart_monitor_raw_fetch_locked:  { short: 'ข้าม fetch เพราะมี job อื่นกำลังรัน (file lock)', cause: 'ระบบใช้ lock กันรัน job ซ้อน — เจอบ่อยไม่เป็นไร' },
    restart_monitor_upload:            { short: 'อัปโหลดสรุป pod restart รายวัน' },
    restart_monitor_upload_inconsistent_totals: {
      short: 'ยอด total ไม่ตรงกับผลรวมรายบริการ',
      cause: 'ข้อมูลจากต้นทางไม่สมบูรณ์ หรือมี pod ตกหล่นระหว่าง fetch',
      long:  'ควรเช็คว่า Prometheus/metrics source ให้ข้อมูลครบทุก namespace',
    },
    restart_monitor_notify:            { short: 'ส่งแจ้งเตือน pod restart ให้ทีมที่เกี่ยวข้อง' },
    restart_monitor_send_monthly:      { short: 'ส่งสรุป pod restart รายเดือน' },
    restart_monitor_recipients_update: { short: 'แก้รายชื่อผู้รับแจ้งเตือน Restart Monitor' },
    restart_monitor_webhook_save:      { short: 'บันทึก webhook ของ Restart Monitor' },
    restart_monitor_webhook_clear:     { short: 'ล้าง webhook ของ Restart Monitor' },
    restart_monitor_webhook_test:      { short: 'ทดสอบยิง webhook ของ Restart Monitor' },
    restart_monitor_webhook_toggle:    { short: 'เปิด/ปิด webhook ของ Restart Monitor' },
    service_severity_upsert:  { short: 'เพิ่ม/อัปเดต severity ของ service' },
    service_severity_delete:  { short: 'ลบ severity ของ service' },
    service_severity_import:  { short: 'import severity จากไฟล์ CSV' },
    n8n_severity_config_save: { short: 'บันทึก config webhook n8n สำหรับ severity' },
    n8n_severity_sync:        { short: 'ซิงก์ severity ไป Google Sheet ผ่าน n8n' },

    // ─── Batch / test service ─────────────────────────────────────────
    batch_report_submitted:   { short: 'ส่งรายงาน batch เข้าระบบ' },
    batch_record_edited:      { short: 'แก้ไข batch record' },
    batch_record_deleted:     { short: 'ลบ batch record' },
    batch_records_cleared:    { short: 'ล้าง batch records ทั้งหมด' },
    test_service_submitted:   { short: 'ส่งผลทดสอบ service เข้าระบบ' },
    test_record_edited:       { short: 'แก้ไข test record' },
    test_record_deleted:      { short: 'ลบ test record' },
    test_records_cleared:     { short: 'ล้าง test records ทั้งหมด' },
    test_service_groups_saved:{ short: 'บันทึก config กลุ่ม test service' },
    reconcile_credentials_saved: { short: 'บันทึก credential ของ reconcile' },
    step1_settings_saved:     { short: 'บันทึก config Test Service — Step 1' },
    step2_settings_saved:     { short: 'บันทึก config Test Service — Step 2' },
    step3_settings_saved:     { short: 'บันทึก config Test Service — Step 3' },
    batch_meta_config_create: { short: 'สร้าง batch metadata config' },
    batch_meta_config_delete: { short: 'ลบ batch metadata config' },
    batch_meta_manual_edit:   { short: 'แก้ batch metadata ด้วยมือ (ไม่ผ่าน sync)' },
    batch_meta_sync:          { short: 'ซิงก์ batch metadata จากต้นทาง' },
    batch_deps_set:           { short: 'ตั้ง dependency ของ batch job (upstream/downstream)' },
    batch_deps_delete:        { short: 'ลบ dependency ของ batch job' },
    batch_deps_clear:         { short: 'ล้าง dependencies ของ batch job ทั้งหมด' },
    batch_file_index_crawl:   { short: 'crawl Jenkins jobs เพื่อสร้าง index ของ batch files' },
    batch_file_index_run:     { short: 'รันสร้าง index ของ batch files' },
    batch_file_index_lookup:  { short: 'ค้นหาไฟล์ใน batch file index' },

    // ─── Templates / docs / links / sidebar tools ─────────────────────
    template_create:  { short: 'สร้าง Jira template ใหม่' },
    template_update:  { short: 'แก้ Jira template' },
    template_delete:  { short: 'ลบ Jira template' },
    doc_create:       { short: 'สร้างเอกสารใน Docs' },
    doc_update:       { short: 'แก้ไขเอกสาร' },
    doc_delete:       { short: 'ลบเอกสาร' },
    link_create:      { short: 'เพิ่มลิงก์ด่วน' },
    link_update:      { short: 'แก้ลิงก์ด่วน' },
    link_delete:      { short: 'ลบลิงก์ด่วน' },
    sidebar_tool_create: { short: 'เพิ่ม tool ใน sidebar' },
    sidebar_tool_update: { short: 'แก้ tool ใน sidebar' },
    sidebar_tool_delete: { short: 'ลบ tool ใน sidebar' },
    file_upload:      { short: 'อัปโหลดไฟล์แนบ' },

    // ─── Board config / service type ──────────────────────────────────
    boardconfig_category_add:    { short: 'เพิ่มหมวดหมู่ใน Service Board config' },
    boardconfig_servicetype_add: { short: 'เพิ่ม service type ใน Board config' },
    boardconfig_subtype_add:     { short: 'เพิ่ม subtype ใน Board config' },
    boardconfig_rename:          { short: 'เปลี่ยนชื่อรายการใน Board config' },
    boardconfig_delete:          { short: 'ลบรายการใน Board config' },
    servicetype_create:          { short: 'สร้าง service type' },
    servicetype_rename:          { short: 'เปลี่ยนชื่อ service type' },
    servicetype_delete:          { short: 'ลบ service type' },
    servicetype_subtype_add:     { short: 'เพิ่ม subtype ใน service type' },
    servicetype_service_add:     { short: 'เพิ่ม service ใน service type' },

    // ─── Schedule & leave ────────────────────────────────────────────
    schedule_update:      { short: 'อัปเดตตารางเวร' },
    schedule_clear_day:   { short: 'ล้างตารางเวรทั้งวัน' },
    schedule_color_update:{ short: 'เปลี่ยนสี label ในตารางเวร' },
    leave_request:        { short: 'ยื่นใบลา' },
    leave_review:         { short: 'อนุมัติ/ปฏิเสธใบลา' },
    leave_edit:           { short: 'แก้ใบลา' },
    leave_cancel:         { short: 'ยกเลิกใบลา' },
    holiday_add:          { short: 'เพิ่มวันหยุด' },
    holiday_update:       { short: 'แก้วันหยุด' },
    holiday_delete:       { short: 'ลบวันหยุด' },

    // ─── Knowledge Base ──────────────────────────────────────────────
    knowledge_base_add_category:    { short: 'เพิ่มหมวดหมู่ใน KB' },
    knowledge_base_update_category: { short: 'แก้หมวดหมู่ใน KB' },
    knowledge_base_delete_category: { short: 'ลบหมวดหมู่ใน KB' },
    knowledge_base_delete:          { short: 'ลบบทความ KB' },
    knowledge_base_clear_all:       { short: 'ลบข้อมูล KB ทั้งหมด (destructive)', cause: 'admin เลือก reset KB' },
    knowledge_base_import:          { short: 'import ข้อมูล KB จากไฟล์' },
    knowledge_base_view:            { short: 'เปิดดูบทความ KB' },

    // ─── Courses & exams ─────────────────────────────────────────────
    course_create:        { short: 'สร้างคอร์สเรียนใหม่' },
    course_update:        { short: 'แก้คอร์ส' },
    course_delete:        { short: 'ลบคอร์ส' },
    course_phase_create:  { short: 'เพิ่ม phase ในคอร์ส' },
    course_phase_update:  { short: 'แก้ phase ในคอร์ส' },
    course_phase_delete:  { short: 'ลบ phase ในคอร์ส' },
    course_lesson_create: { short: 'เพิ่มบทเรียน' },
    course_lesson_update: { short: 'แก้บทเรียน' },
    course_lesson_delete: { short: 'ลบบทเรียน' },
    course_quiz_save:     { short: 'บันทึก quiz ในบทเรียน' },
    course_quiz_delete:   { short: 'ลบ quiz' },
    course_progress_reset:{ short: 'รีเซ็ต progress ของผู้เรียน' },
    course_share_enabled: { short: 'เปิด share คอร์สให้ทีมอื่นเข้าถึงได้' },
    course_share_disabled:{ short: 'ปิด share คอร์ส' },
    exam_create:          { short: 'สร้างข้อสอบ' },
    exam_update:          { short: 'แก้ข้อสอบ' },
    exam_delete:          { short: 'ลบข้อสอบ' },
    exam_attempt_start:   { short: 'ผู้ใช้เริ่มทำข้อสอบ' },
    exam_attempts_reset:  { short: 'admin รีเซ็ต attempts ของข้อสอบ' },
    exam_share_enabled:   { short: 'เปิด share ข้อสอบให้ทีมอื่น' },
    exam_share_disabled:  { short: 'ปิด share ข้อสอบ' },
    exam_reminder_sent:   { short: 'ส่งเตือนให้ทำข้อสอบให้ครบ' },
    learn_page_config_update: { short: 'แก้ config หน้า Learn' },

    // ─── Onboarding ──────────────────────────────────────────────────
    onboarding_finish:          { short: 'ผู้ใช้ทำ onboarding เสร็จ' },
    onboarding_config_update:   { short: 'แก้ config ระบบ onboarding' },
    onboarding_admin_reset:     { short: 'admin รีเซ็ต onboarding ให้ผู้ใช้ทำใหม่' },
    onboarding_pdf_upload:      { short: 'อัปโหลด PDF สำหรับ onboarding' },
    onboarding_pdf_delete:      { short: 'ลบ PDF onboarding' },
    onboarding_exam_submit:     { short: 'ส่งข้อสอบ onboarding' },

    // ─── Ops runbook ─────────────────────────────────────────────────
    ops_runbook_section_create: { short: 'สร้าง section ใน Ops Runbook' },
    ops_runbook_section_update: { short: 'แก้ section ใน Ops Runbook' },
    ops_runbook_section_delete: { short: 'ลบ section ใน Ops Runbook' },
    ops_runbook_column_create:  { short: 'สร้าง column ใน Ops Runbook' },
    ops_runbook_column_update:  { short: 'แก้ column ใน Ops Runbook' },
    ops_runbook_column_delete:  { short: 'ลบ column ใน Ops Runbook' },
    ops_runbook_row_create:     { short: 'สร้าง row ใน Ops Runbook' },
    ops_runbook_row_update:     { short: 'แก้ row ใน Ops Runbook' },
    ops_runbook_row_delete:     { short: 'ลบ row ใน Ops Runbook' },

    // ─── Password Manager ────────────────────────────────────────────
    pw_item_created:  { short: 'เพิ่มรายการรหัสผ่านใน Password Manager' },
    pw_item_updated:  { short: 'แก้รายการรหัสผ่าน' },
    pw_item_deleted:  { short: 'ลบรายการรหัสผ่าน' },
    pw_item_toggle:   { short: 'สลับสถานะรายการรหัสผ่าน (เปิด/ปิดใช้งาน)' },
    pw_config_updated:{ short: 'แก้ config Password Manager' },
    pw_sync:          { short: 'ซิงก์ Password Manager กับต้นทาง' },
    pw_notify_sent:   { short: 'ส่งแจ้งเตือนของ Password Manager' },
    pw_notify_test:   { short: 'ทดสอบส่งแจ้งเตือน PW' },
    pw_notify_text:   { short: 'ส่งข้อความ PW notification (custom text)' },
    pw_notify_reply_failed: { short: 'ตอบกลับข้อความ PW ไม่สำเร็จ', cause: 'chat webhook มีปัญหา หรือ thread ปิดไปแล้ว' },

    // ─── Requests ────────────────────────────────────────────────────
    request_created:  { short: 'สร้าง request ใหม่' },
    request_updated:  { short: 'แก้ request' },
    request_deleted:  { short: 'ลบ request' },
    request_commented:{ short: 'คอมเมนต์ใน request' },

    // ─── SMS Gateway ─────────────────────────────────────────────────
    sms_gateway_remark: { short: 'แก้หมายเหตุ SMS Gateway' },
    sms_gateway_sync:   { short: 'ซิงก์ข้อมูล SMS Gateway' },

    // ─── Syncup ──────────────────────────────────────────────────────
    syncup_uploaded:     { short: 'อัปโหลดไฟล์ syncup' },
    syncup_deleted:      { short: 'ลบไฟล์ syncup' },
    syncup_config_saved: { short: 'บันทึก config syncup' },
    syncup_notify_sent:  { short: 'ส่งแจ้งเตือน syncup' },

    // ─── Jira config ─────────────────────────────────────────────────
    jiraconfig_add:    { short: 'เพิ่ม Jira custom field mapping' },
    jiraconfig_update: { short: 'แก้ Jira custom field mapping' },
    jiraconfig_delete: { short: 'ลบ Jira custom field mapping' },

    // ─── OpenSearch ──────────────────────────────────────────────────
    opensearch_config_create:          { short: 'เพิ่ม OpenSearch cluster config' },
    opensearch_config_update:          { short: 'แก้ OpenSearch cluster config' },
    opensearch_config_delete:          { short: 'ลบ OpenSearch cluster config' },
    opensearch_config_defaults_update: { short: 'ปรับ defaults ของ OpenSearch (index/timeout)' },
    opensearch_saved_search_create:    { short: 'บันทึก OpenSearch search (Save By SM)' },
    opensearch_saved_search_delete:    { short: 'ลบ OpenSearch saved search' },
    opensearch_user_creds_save:        { short: 'ผู้ใช้บันทึก OpenSearch credential ส่วนตัว (encrypted)' },
    opensearch_user_creds_remove:      { short: 'ลบ OpenSearch credential ส่วนตัวของผู้ใช้' },

    // ─── MA (Monitoring Alerts) test suite ──────────────────────────
    ma_status_mapping:          { short: 'จับคู่ service กับ use-case ใน MA Status' },
    ma_status_hidden_saved:     { short: 'บันทึกรายการ MA Status ที่ซ่อน' },
    ma_status_jobs_saved:       { short: 'บันทึก Jenkins jobs ที่ MA Status ใช้ตรวจ' },
    ma_status_jobs_reset:       { short: 'รีเซ็ต MA Status jobs กลับเป็น default' },
    ma_test_catalog_create:     { short: 'สร้างรายการใน MA Test Catalog' },
    ma_test_catalog_update:     { short: 'แก้รายการ MA Test Catalog' },
    ma_test_catalog_delete:     { short: 'ลบรายการ MA Test Catalog' },
    ma_test_catalog_bulk_create:{ short: 'สร้างรายการ MA Test Catalog หลายรายการพร้อมกัน' },
    ma_test_catalog_import:     { short: 'import MA Test Catalog จากไฟล์' },
    ma_test_catalog_auto_link:  { short: 'auto-link MA Test Catalog กับ MA Services' },
    ma_test_plan_add:           { short: 'เพิ่ม MA Test Plan' },
    ma_test_plan_delete:        { short: 'ลบ MA Test Plan' },
    ma_test_result_create:      { short: 'บันทึกผล MA Test' },
    ma_test_result_update:      { short: 'แก้ผล MA Test' },
    ma_test_result_delete:      { short: 'ลบผล MA Test' },
    ma_test_webhook_add:        { short: 'เพิ่ม webhook สำหรับ MA Test' },
    ma_test_webhook_update:     { short: 'แก้ webhook MA Test' },
    ma_test_webhook_delete:     { short: 'ลบ webhook MA Test' },
    ma_test_notify:             { short: 'ส่งแจ้งเตือนผล MA Test ไป webhook' },

    // ─── Collection Lead flow (cl_flow_*) ────────────────────────────
    cl_flow_edge_add:    { short: 'เพิ่มเส้นเชื่อม (edge) ใน Collection Lead flow diagram' },
    cl_flow_edge_delete: { short: 'ลบเส้นเชื่อมใน Collection Lead flow diagram' },
    cl_flow_note_set:    { short: 'ตั้ง note บน node ใน Collection Lead flow' },

    // ─── Pipeline Flows (pf_*) ───────────────────────────────────────
    pf_create:     { short: 'สร้าง Pipeline Flow ใหม่' },
    pf_delete:     { short: 'ลบ Pipeline Flow' },
    pf_add_job:    { short: 'เพิ่ม/แก้ Jenkins job ใน Pipeline Flow' },
    pf_delete_job: { short: 'ลบ Jenkins job ออกจาก Pipeline Flow' },

    // ─── Service Inventory / Performance ─────────────────────────────
    service_inventory_upload:    { short: 'อัปโหลด service inventory (รายชื่อบริการ)' },
    service_inventory_restore:   { short: 'restore service inventory จาก backup' },
    service_performance_refresh: { short: 'รีเฟรช cache Service Performance (ดึงใหม่จาก Grafana)' },

    // ─── DNS diag / dev tools ────────────────────────────────────────
    dns_diag_clear_cooldown: { short: 'ล้าง host cooldown ของ DNS-diagnose (ให้เรียก host ซ้ำได้)', cause: 'ใช้ตอน debug — ปกติ cooldown ตั้งไว้กันยิง host ที่ down ซ้ำ' },

    // ─── n8n oncall ──────────────────────────────────────────────────
    n8n_oncall_config_save: { short: 'บันทึก config n8n oncall integration' },
  };

  // ── Pattern-based fallback ─────────────────────────────────────────────
  // สำหรับ action ที่ไม่ได้ระบุใน dictionary ตรงๆ — เดาจาก suffix ของชื่อ
  const VERB_MAP = [
    [/_created?$/i,   'สร้าง'],
    [/_updated?$/i,   'แก้ไข'],
    [/_edited?$/i,    'แก้ไข'],
    [/_deleted?$/i,   'ลบ'],
    [/_removed?$/i,   'ลบ'],
    [/_added?$/i,     'เพิ่ม'],
    [/_saved?$/i,     'บันทึก'],
    [/_uploaded?$/i,  'อัปโหลด'],
    [/_downloaded?$/i,'ดาวน์โหลด'],
    [/_sent$/i,       'ส่ง'],
    [/_send$/i,       'ส่ง'],
    [/_viewed?$/i,    'เปิดดู'],
    [/_sync$/i,       'ซิงก์ข้อมูล'],
    [/_reset$/i,      'รีเซ็ต'],
    [/_toggle$/i,     'สลับสถานะ'],
    [/_test$/i,       'ทดสอบ'],
    [/_cleared?$/i,   'ล้าง'],
    [/_import$/i,     'นำเข้า'],
    [/_export$/i,     'ส่งออก'],
    [/_submitted?$/i, 'ส่ง'],
    [/_started?$/i,   'เริ่ม'],
    [/_finished?$/i,  'จบ'],
    [/_reviewed?$/i,  'พิจารณา'],
    [/_cancell?ed?$/i,'ยกเลิก'],
    [/_requested?$/i, 'ร้องขอ'],
    [/_blocked$/i,    'ถูกบล็อก'],
    [/_failed$/i,     'ล้มเหลว'],
    [/_denied$/i,     'ถูกปฏิเสธ'],
  ];

  // Noun prefix → Thai resource name. Longer keys are matched first.
  const NOUN_MAP = {
    board: 'โพสต์ใน Service Board',
    board_comment: 'คอมเมนต์บน Board',
    comment: 'คอมเมนต์',
    user: 'ผู้ใช้',
    team: 'ทีม',
    template: 'template',
    link: 'ลิงก์ด่วน',
    doc: 'เอกสาร',
    file: 'ไฟล์',
    sidebar_tool: 'เครื่องมือใน sidebar',
    jira: 'Jira',
    jiraconfig: 'Jira config',
    jenkins: 'Jenkins',
    jenkins_server: 'Jenkins server',
    jenkins_portal: 'Jenkins Portal',
    jenkins_portal_user: 'Jenkins Portal user',
    jenkins_portal_app: 'Jenkins Portal app',
    so_jenkins: 'SO Portal Jenkins',
    so_jenkins_user: 'SO Portal user',
    noti: 'notification',
    noti_schedule: 'ตารางแจ้งเตือน',
    noti_chat: 'chat notification',
    email: 'อีเมล',
    email_noti: 'อีเมล broadcast',
    inbox: 'inbox',
    announcement: 'ประกาศ',
    schedule: 'ตารางเวร',
    leave: 'ใบลา',
    holiday: 'วันหยุด',
    knowledge_base: 'Knowledge Base',
    course: 'คอร์สเรียน',
    course_phase: 'phase คอร์สเรียน',
    course_lesson: 'บทเรียน',
    course_quiz: 'quiz คอร์สเรียน',
    exam: 'ข้อสอบ',
    exam_attempt: 'การทำข้อสอบ',
    onboarding: 'onboarding',
    onboarding_pdf: 'PDF onboarding',
    ops_runbook: 'Ops Runbook',
    ops_runbook_section: 'section ใน Ops Runbook',
    ops_runbook_column: 'column ใน Ops Runbook',
    ops_runbook_row: 'row ใน Ops Runbook',
    pw_item: 'รายการรหัสผ่าน',
    pw_config: 'ค่า config Password Manager',
    pw_notify: 'แจ้งเตือน Password Manager',
    request: 'request',
    batch_report: 'batch report',
    batch_record: 'batch record',
    batch_meta: 'batch metadata',
    batch_deps: 'batch dependencies',
    batch_file_index: 'batch file index',
    batch_monitor_noti: 'แจ้งเตือน batch monitor',
    test_service: 'test service',
    test_record: 'test record',
    sms_gateway: 'SMS Gateway',
    restart_monitor: 'Restart Monitor',
    servicetype: 'ประเภทบริการ',
    boardconfig: 'ตั้งค่า Service Board',
    backup: 'ไฟล์ backup',
    cache: 'cache ระบบ',
    maintenance: 'สถานะ maintenance',
    syncup: 'syncup',
    alert_monitor: 'Alert Monitor',
    fh_email_config: 'Feature-Health email config',
    learn_page: 'หน้า Learn',
    mail_config: 'SMTP config',
    n8n_severity: 'ค่า severity บน n8n',
    n8n_oncall: 'n8n oncall integration',
    service_severity: 'ค่า severity ของบริการ',
    service_inventory: 'service inventory',
    service_performance: 'Service Performance',
    reconcile: 'reconcile',
    grafana_source: 'Grafana source',
    grafana_alerts: 'Grafana alerts',
    grafana_alert: 'Grafana alert',
    ma_status: 'MA Status',
    ma_test_catalog: 'MA Test Catalog',
    ma_test_plan: 'MA Test Plan',
    ma_test_result: 'ผล MA Test',
    ma_test_webhook: 'MA Test webhook',
    ma_test: 'MA Test',
    opensearch_config: 'OpenSearch cluster config',
    opensearch_saved_search: 'OpenSearch saved search',
    opensearch_user_creds: 'OpenSearch credential ส่วนตัว',
    cl_flow: 'Collection Lead flow diagram',
    cl_flow_edge: 'เส้นเชื่อมใน Collection Lead flow',
    cl_flow_note: 'note บน Collection Lead flow',
    pf: 'Pipeline Flow',
    pf_job: 'Jenkins job ใน Pipeline Flow',
    dns_diag: 'DNS diagnose',
    n8n: 'n8n integration',
  };

  function guessFromPattern(action) {
    if (!action || typeof action !== 'string') return null;
    let verb = null;
    let base = action;
    for (const [re, v] of VERB_MAP) {
      if (re.test(action)) { verb = v; base = action.replace(re, ''); break; }
    }
    if (!verb) return null;
    const nounKeys = Object.keys(NOUN_MAP).sort((a, b) => b.length - a.length);
    const noun = nounKeys.find(k => base === k || base.startsWith(k + '_'));
    const nounLabel = noun ? NOUN_MAP[noun] : base.replace(/_/g, ' ');
    return { short: `${verb} ${nounLabel}`.trim() };
  }

  // ── Detail extraction — เพิ่ม context จาก detail JSON ถ้ามี ─────────────
  function detailContext(entry) {
    if (!entry || !entry.detail || typeof entry.detail !== 'object') return '';
    const d = entry.detail;
    const bits = [];
    if (d.title)              bits.push(`หัวข้อ "${d.title}"`);
    if (d.name && !d.title)   bits.push(`ชื่อ "${d.name}"`);
    if (d.reason)             bits.push(`เหตุผล: ${d.reason}`);
    if (d.error)              bits.push(`error: ${typeof d.error === 'string' ? d.error : JSON.stringify(d.error).slice(0, 100)}`);
    if (d.message && !d.error) bits.push(`ข้อความ: ${String(d.message).slice(0, 120)}`);
    if (d.method && d.path)   bits.push(`${d.method} ${d.path}`);
    if (d.status && !d.method) bits.push(`status ${d.status}`);
    if (d.target)             bits.push(`เป้าหมาย ${d.target}`);
    if (d.ip && !entry.ip)    bits.push(`จาก IP ${d.ip}`);
    return bits.join(' · ');
  }

  // ── Public: build explanation ────────────────────────────────────────
  function get(action, entry) {
    const dictHit = EXPLAIN_TH[action] || null;
    let base = dictHit;
    let matched = !!dictHit;

    if (!base) {
      const pattern = guessFromPattern(action);
      if (pattern) { base = pattern; matched = true; }  // pattern hits count as matched
    }
    if (!base) base = { short: 'ไม่มีคำอธิบายสำหรับ action นี้' };

    if (typeof base === 'string') base = { short: base };

    const ctx = detailContext(entry);
    const short = base.short + (ctx ? ' — ' + ctx : '');
    const long  = base.long || base.short;
    return {
      short,
      long,
      cause:   base.cause || '',
      matched,
    };
  }

  global.LogExplainTH = { get, _dict: EXPLAIN_TH };

})(window);
