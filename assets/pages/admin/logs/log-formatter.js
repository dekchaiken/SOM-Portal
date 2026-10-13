/**
 * Log Detail Formatter
 * แปลง log detail จาก JSON ให้อ่านง่ายเป็นภาษาไทย
 */

const LogFormatter = {
  format(action, detail) {
    if (!detail || (Array.isArray(detail) && !detail.length) || (typeof detail === 'object' && !Array.isArray(detail) && !Object.keys(detail).length)) {
      return '';
    }

    const formatters = {
      // ── Board ──────────────────────────────────────────────────────────────
      'board_create':        this.formatBoardCreate,
      'board_update':        this.formatBoardUpdate,
      'board_delete':        this.formatBoardDelete,
      'board_hard_delete':   this.formatBoardDelete,
      'board_auto_purge':    this.formatBoardDelete,
      'board_restore':       this.formatBoardRestore,
      'board_pin':           this.formatBoardPin,
      'board_status_change': this.formatBoardStatusChange,
      'board_comment':       this.formatBoardComment,
      'board_search':        this.formatBoardSearch,
      'board_star':          this.formatBoardStar,
      'board_unstar':        this.formatBoardStar,

      // ── User ───────────────────────────────────────────────────────────────
      'user_create':               this.formatUserCreate,
      'user_update':               this.formatUserUpdate,
      'user_delete':               this.formatUserDelete,
      'user_reset_password':       this.formatUserReset,
      'user_force_password_reset': this.formatUserForceReset,

      // ── Auth / Profile ─────────────────────────────────────────────────────
      'login':            this.formatLoginSuccess,
      'login_success':    this.formatLoginSuccess,
      'login_failed':     this.formatLoginFailed,
      'logout':           this.formatLogout,
      'profile_update':   this.formatProfileUpdate,
      'password_change':  this.formatPasswordChange,
      'password_changed': this.formatPasswordChange,

      // ── Schedule ───────────────────────────────────────────────────────────
      'schedule_update':    this.formatScheduleUpdate,
      'schedule_clear_day': this.formatScheduleClearDay,

      // ── Comments ───────────────────────────────────────────────────────────
      'comment_create': this.formatCommentCreate,
      'comment_update': this.formatCommentCreate,
      'comment_delete': this.formatCommentCreate,

      // ── Settings ───────────────────────────────────────────────────────────
      'settings_update': this.formatSettingsUpdate,

      // ── Templates ──────────────────────────────────────────────────────────
      'template_create': this.formatTemplateCreate,
      'template_update': this.formatTemplateCreate,
      'template_delete': this.formatTemplateCreate,

      // ── Jira ───────────────────────────────────────────────────────────────
      'jira_create_ticket': this.formatJiraTicket,
      'jiraconfig_add':     this.formatJiraConfig,
      'jiraconfig_update':  this.formatJiraConfig,
      'jiraconfig_delete':  this.formatJiraConfig,

      // ── Jenkins ────────────────────────────────────────────────────────────
      'jenkins_server_create':  this.formatJenkinsServer,
      'jenkins_server_update':  this.formatJenkinsServer,
      'jenkins_server_delete':  this.formatJenkinsServer,
      'jenkins_build_trigger':  this.formatJenkinsBuild,

      // ── Files ──────────────────────────────────────────────────────────────
      'file_upload': this.formatFileUpload,

      // ── Health Check ───────────────────────────────────────────────────────
      'health_check': this.formatHealthCheck,

      // ── Backup ─────────────────────────────────────────────────────────────
      'backup_created':    this.formatBackup,
      'backup_downloaded': this.formatBackup,
      'backup_deleted':    this.formatBackup,

      // ── Email / Mail ───────────────────────────────────────────────────────
      'email_sent':        this.formatEmailSent,
      'mail_config_updated': this.formatMailConfig,

      // ── Notifications ──────────────────────────────────────────────────────
      'noti_schedule_created': this.formatNotiSchedule,
      'noti_schedule_updated': this.formatNotiSchedule,
      'noti_schedule_deleted': this.formatNotiSchedule,
      'noti_chat_sent':        this.formatNotiChat,
      'noti_chat_test':        this.formatNotiChat,

      // ── Maintenance ────────────────────────────────────────────────────────
      'maintenance_page':   this.formatMaintenancePage,
      'maintenance_tool':   this.formatMaintenancePage,
      'maintenance_global': this.formatMaintenanceGlobal,

      // ── MA Services ────────────────────────────────────────────────────────
      'ma_cutoff_create':       this.formatMaCutoff,
      'ma_cutoff_update':       this.formatMaCutoff,
      'ma_cutoff_delete':       this.formatMaCutoff,
      'ma_usecase_create':      this.formatMaUsecase,
      'ma_usecase_update':      this.formatMaUsecase,
      'ma_usecase_delete':      this.formatMaUsecase,
      'ma_config_module_create': this.formatMaConfig,
      'ma_config_module_update': this.formatMaConfig,
      'ma_config_module_delete': this.formatMaConfig,
      'ma_config_type_create':   this.formatMaConfig,
      'ma_config_type_update':   this.formatMaConfig,
      'ma_config_type_delete':   this.formatMaConfig,
      // ── MA Backoffice (Admin Portal toggle / full edit) ────────────────────
      'ma_backoffice_toggle':   this.formatMaBackofficeToggle,
      'ma_backoffice_save':     this.formatMaBackofficeSave,

      // ── Batch Monitor ──────────────────────────────────────────────────────
      'batch_report_submitted': this.formatBatchSubmit,
      'batch_record_edited':    this.formatBatchEdited,
      'batch_record_deleted':   this.formatBatchRecord,
      'batch_records_cleared':  this.formatBatchCleared,

      // ── Test Service ───────────────────────────────────────────────────────
      'test_service_submitted':    this.formatTestSubmit,
      'test_record_edited':        this.formatTestEdited,
      'test_record_deleted':       this.formatBatchRecord,
      'test_records_cleared':      this.formatBatchCleared,
      'test_service_groups_saved': this.formatTestGroups,

      // ── Knowledge Base ─────────────────────────────────────────────────────
      'knowledge_base_create':          this.formatKnowledgeBase,
      'knowledge_base_update':          this.formatKnowledgeBase,
      'knowledge_base_delete':          this.formatKnowledgeBase,
      'knowledge_base_view':            this.formatKnowledgeBaseView,
      'knowledge_base_add_category':    this.formatKnowledgeBaseCategory,
      'knowledge_base_delete_category': this.formatKnowledgeBaseCategoryDel,

      // ── Board Config ───────────────────────────────────────────────────────
      'boardconfig_category_add':    this.formatBoardConfig,
      'boardconfig_servicetype_add': this.formatBoardConfig,
      'boardconfig_subtype_add':     this.formatBoardConfig,
      'boardconfig_rename':          this.formatBoardConfig,
      'boardconfig_delete':          this.formatBoardConfig,

      // ── Links ──────────────────────────────────────────────────────────────
      'link_create': this.formatLink,
      'link_update': this.formatLink,
      'link_delete': this.formatLink,

      // ── Sidebar Tools ──────────────────────────────────────────────────────
      'sidebar_tool_create': this.formatSidebarTool,
      'sidebar_tool_update': this.formatSidebarTool,
      'sidebar_tool_delete': this.formatSidebarTool,

      // ── Service Types ──────────────────────────────────────────────────────
      'servicetype_create':      this.formatServiceType,
      'servicetype_delete':      this.formatServiceType,
      'servicetype_subtype_add': this.formatServiceType,
      'servicetype_rename':      this.formatServiceType,

      // ── Docs (Sheets/embed) ────────────────────────────────────────────────
      'doc_create': this.formatDoc,
      'doc_update': this.formatDoc,
      'doc_delete': this.formatDoc,

      // ── Leave ──────────────────────────────────────────────────────────────
      'leave_request': this.formatLeaveRequest,
      'leave_review':  this.formatLeaveReview,
      'leave_cancel':  this.formatLeaveCancel,
      'leave_edit':    this.formatLeaveEdit,

      // ── Requests ───────────────────────────────────────────────────────────
      'request_created': this.formatRequest,
      'request_updated': this.formatRequest,
      'request_deleted': this.formatRequest,

      // ── Weekly Report ──────────────────────────────────────────────────────
      'weekly_report_add':    this.formatWeeklyReport,
      'weekly_report_delete': this.formatWeeklyReport,
      'weekly_report_UPDATE': this.formatWeeklyReport,

      // ── Misc ───────────────────────────────────────────────────────────────
      'sms_gateway_sync':    this.formatSmsGateway,
      'holiday_update':      this.formatHoliday,
      'announcement_create': this.formatAnnouncement,

      // ── Courses / Learning Path ────────────────────────────────────────────
      'course_create':         this.formatCourseCreate,
      'course_update':         this.formatCourseCreate,
      'course_delete':         this.formatCourseCreate,
      'course_phase_create':   this.formatCoursePhase,
      'course_phase_update':   this.formatCoursePhase,
      'course_phase_delete':   this.formatCoursePhase,
      'course_lesson_create':  this.formatCourseLesson,
      'course_lesson_update':  this.formatCourseLesson,
      'course_lesson_delete':  this.formatCourseLesson,
      'course_quiz_save':      this.formatCourseQuiz,
      'course_quiz_delete':    this.formatCourseQuiz,
      'course_phase_attempt':  this.formatCourseAttempt,
      'course_phase_passed':   this.formatCoursePassed,
    };

    const formatter = formatters[action];
    if (formatter) return formatter.call(this, detail);
    return this.formatDefault(detail);
  },

  // ─── Board ──────────────────────────────────────────────────────────────────

  formatBoardCreate(d) {
    return this._nice([
      ['<i data-icon="edit"></i>', 'หัวข้อ', d.title],
      ['<i data-icon="folder-open"></i>', 'บอร์ด', d.board_type],
      ['<i data-icon="tag"></i>', 'สถานะ', d.status ? this.formatStatus(d.status) : null],
    ]);
  },

  formatBoardUpdate(d) {
    return this._nice([
      ['<i data-icon="edit"></i>', 'หัวข้อ', d.title],
      ['<i data-icon="refresh-cw"></i>', 'เปลี่ยนสถานะ', d.status_from && d.status_to ? `${this.formatStatus(d.status_from)} → ${this.formatStatus(d.status_to)}` : null],
    ]);
  },

  formatBoardDelete(d) {
    return this._nice([
      ['<i data-icon="trash"></i>', 'หัวข้อ', d.title],
      ['<i data-icon="save"></i>', 'ประเภท', d.soft ? 'Soft Delete (กู้คืนได้)' : (d.hard ? 'Hard Delete (ถาวร)' : null)],
    ]);
  },

  formatBoardRestore(d) {
    return this._nice([
      ['<i data-icon="recycle"></i>', 'หัวข้อ', d.title],
      ['<i data-icon="pin"></i>', 'กู้คืนจาก', 'Trash'],
    ]);
  },

  formatBoardPin(d) {
    return this._nice([
      [d.pinned ? '<i data-icon="pin"></i>' : '<i data-icon="map-pin"></i>', 'การกระทำ', d.pinned ? 'ปักหมุดโพสต์' : 'ยกเลิกปักหมุด'],
    ]);
  },

  formatBoardStatusChange(d) {
    return this._nice([
      ['<i data-icon="edit"></i>', 'หัวข้อ', d.title],
      ['<i data-icon="refresh-cw"></i>', 'สถานะ', `${this.formatStatus(d.from)} → ${this.formatStatus(d.to)}`],
    ]);
  },

  formatBoardComment(d) {
    return this._nice([
      ['<i data-icon="message-circle"></i>', 'คอมเมนต์', d.comment_id ? `#${d.comment_id.slice(-6)}` : null],
      ['<i data-icon="users"></i>', 'mentions', d.mentions ? `${d.mentions} คน` : null],
    ]);
  },

  formatBoardSearch(d) {
    return this._nice([
      ['<i data-icon="search"></i>', 'ค้นหา', d.query ? `"${d.query}"` : '(ว่าง)'],
      ['<i data-icon="folder-open"></i>', 'บอร์ด', d.board_type || 'ทั้งหมด'],
      ['<i data-icon="tag"></i>', 'สถานะ', d.status || 'ทั้งหมด'],
    ]);
  },

  formatBoardStar(d) {
    return this._nice([
      ['<i data-icon="star"></i>', 'โพสต์', d.post_id ? `#${d.post_id.slice(-6)}` : null],
    ]);
  },

  // ─── User ───────────────────────────────────────────────────────────────────

  formatUserCreate(d) {
    return this._nice([
      ['<i data-icon="user"></i>', 'Username', d.username],
      ['<i data-icon="sticker"></i>', 'Role', d.role ? this.formatRole(d.role) : null],
    ]);
  },

  formatUserUpdate(d) {
    const changed = d.changed || [];
    return this._nice([
      ['<i data-icon="user"></i>', 'User', d.target_name || d.username || d.target_id],
      ['<i data-icon="pencil"></i>', 'แก้ไขฟิลด์', changed.length ? changed.join(', ') : null],
    ]);
  },

  formatUserDelete(d) {
    return this._nice([
      ['<i data-icon="user"></i>', 'Username', d.username],
    ]);
  },

  formatUserReset(d) {
    return this._nice([
      ['<i data-icon="key"></i>', 'Username', d.username],
      ['<i data-icon="refresh-cw"></i>', 'การกระทำ', 'Reset เป็น Temp Password'],
    ]);
  },

  formatUserForceReset(d) {
    return this._nice([
      ['<i data-icon="alert-triangle"></i>', 'User', d.target_name],
      ['<i data-icon="lock"></i>', 'การกระทำ', 'บังคับเปลี่ยนรหัสผ่านในครั้งถัดไป'],
    ]);
  },

  // ─── Auth / Profile ─────────────────────────────────────────────────────────

  formatLoginSuccess(d) {
    return this._nice([
      ['<i data-icon="user"></i>', 'Username', d.username],
      ['<i data-icon="sticker"></i>', 'Role', d.role ? this.formatRole(d.role) : null],
      ['<i data-icon="lock"></i>', 'หมดอายุ', d.pw_expired ? '<i data-icon="alert-triangle"></i> รหัสผ่านหมดอายุ' : null],
    ]);
  },

  formatLoginFailed(d) {
    return this._nice([
      ['<i data-icon="user"></i>', 'Username', d.username],
      ['<i data-icon="x-circle"></i>', 'เหตุผล', d.reason],
      ['<i data-icon="globe"></i>', 'IP', d.ip],
    ]);
  },

  formatLogout(d) {
    return this._nice([
      ['<i data-icon="hand"></i>', 'การกระทำ', 'ออกจากระบบ'],
    ]);
  },

  formatProfileUpdate(d) {
    const changed = Array.isArray(d.changed) ? d.changed : [];
    return this._nice([
      ['<i data-icon="pencil"></i>', 'แก้ไข', changed.length ? changed.join(', ') : 'ข้อมูลโปรไฟล์'],
    ]);
  },

  formatPasswordChange(d) {
    const reason = d.first_login_reset ? 'เปลี่ยนรหัสแรกเข้า'
                 : d.expired_reset     ? 'รหัสหมดอายุ'
                 : 'เปลี่ยนรหัสผ่าน';
    return this._nice([
      ['<i data-icon="key"></i>', 'เหตุผล', reason],
    ]);
  },

  // ─── Schedule ───────────────────────────────────────────────────────────────

  _renderScheduleNames(arr) {
    if (!arr || !arr.length) return '—';
    return arr.map(x => {
      const label = typeof x === 'object' ? x.name : x;
      return `<span style="display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:1px 7px;font-size:10.5px;margin:1px 2px">${this.esc(label)}</span>`;
    }).join('');
  },

  formatScheduleUpdate(d) {
    const actionMap = {
      add:    { icon: '<i data-icon="plus"></i>', label: 'เพิ่ม',    color: '#22c55e' },
      update: { icon: '<i data-icon="pencil"></i>', label: 'แก้ไข',   color: '#f59e0b' },
      clear:  { icon: '<i data-icon="trash"></i>', label: 'ล้างออก', color: '#ef4444' },
    };
    const a = actionMap[d.action] || actionMap.update;
    const rows = [
      ['<i data-icon="calendar"></i>', 'วันที่', this.formatDate(d.date)],
      ['⏰', 'Slot', this.formatSlot(d.slot)],
      [a.icon, 'การกระทำ', `<span style="color:${a.color};font-weight:600">${a.label}</span>`],
    ];
    if (d.added && d.added.length)   rows.push(['<i data-icon="user"></i>', 'เพิ่ม', this._renderScheduleNames(d.added)]);
    if (d.removed && d.removed.length) rows.push(['✂️', 'ลบออก', this._renderScheduleNames(d.removed)]);
    return this._nice(rows);
  },

  formatScheduleClearDay(d) {
    const cleared = d.cleared || {};
    const slotKeys = Object.keys(cleared).filter(s => {
      const v = cleared[s];
      return Array.isArray(v) ? v.length : !!v;
    });
    const rows = [
      ['<i data-icon="calendar"></i>', 'วันที่', this.formatDate(d.date)],
      ['<i data-icon="trash"></i>', 'ล้างทั้งวัน', `<span style="color:#ef4444;font-weight:600">${slotKeys.length} slot${slotKeys.length !== 1 ? 's' : ''}</span>`],
    ];
    slotKeys.forEach(s => rows.push(['·', this.formatSlot(s), this._renderScheduleNames(cleared[s])]));
    return this._nice(rows);
  },

  // ─── Comments ───────────────────────────────────────────────────────────────

  formatCommentCreate(d) {
    return this._nice([
      ['<i data-icon="edit"></i>', 'โพสต์', d.post_title],
      ['<i data-icon="message-circle"></i>', 'Comment', d.content ? this.truncate(d.content, 80) : null],
    ]);
  },

  // ─── Settings ───────────────────────────────────────────────────────────────

  formatSettingsUpdate(d) {
    const keys = Array.isArray(d) ? d : (d.keys ? (Array.isArray(d.keys) ? d.keys : [d.keys]) : Object.keys(d));
    return this._nice([
      ['<i data-icon="settings"></i>', 'อัปเดต', keys.length ? keys.join(', ') : 'การตั้งค่าระบบ'],
    ]);
  },

  // ─── Templates ──────────────────────────────────────────────────────────────

  formatTemplateCreate(d) {
    return this._nice([
      ['<i data-icon="file"></i>', 'ชื่อ Template', d.name],
      ['<i data-icon="folder-open"></i>', 'หมวด', d.category],
      ['<i data-icon="key"></i>', 'ID', d.id ? d.id.slice(-8) : null],
    ]);
  },

  // ─── Jira ───────────────────────────────────────────────────────────────────

  formatJiraTicket(d) {
    return this._nice([
      ['<i data-icon="ticket"></i>', 'Ticket', d.issue_key],
      ['<i data-icon="edit"></i>', 'Summary', d.summary ? this.truncate(d.summary, 80) : null],
    ]);
  },

  formatJiraConfig(d) {
    return this._nice([
      ['<i data-icon="wrench"></i>', 'ID', d.id],
    ]);
  },

  // ─── Jenkins ────────────────────────────────────────────────────────────────

  formatJenkinsServer(d) {
    return this._nice([
      ['<i data-icon="monitor"></i>', 'Server', d.display || d.name],
      ['<i data-icon="key"></i>', 'ID', d.id ? d.id.slice(-8) : null],
    ]);
  },

  formatJenkinsBuild(d) {
    return this._nice([
      ['<i data-icon="zap"></i>', 'Server', d.server || d.server_id],
      ['<i data-icon="wrench"></i>', 'Job', d.job],
      ['<i data-icon="package"></i>', 'Build', d.build_number ? `#${d.build_number}` : null],
    ]);
  },

  // ─── Files ──────────────────────────────────────────────────────────────────

  formatFileUpload(d) {
    const kb = d.size ? `${(d.size / 1024).toFixed(0)} KB` : null;
    return this._nice([
      ['<i data-icon="paperclip"></i>', 'ไฟล์', d.filename],
      ['<i data-icon="activity"></i>', 'ขนาด', kb],
      ['<i data-icon="folder-open"></i>', 'ประเภท', d.mime],
    ]);
  },

  // ─── Health Check ───────────────────────────────────────────────────────────

  formatHealthCheck(d) {
    const jira = d.jira_status === 'ok' ? '<i data-icon="check-circle"></i> OK' : `<i data-icon="x-circle"></i> ${d.jira_status}`;
    const smtp = d.smtp_status === 'ok' ? '<i data-icon="check-circle"></i> OK' : `<i data-icon="x-circle"></i> ${d.smtp_status}`;
    const jenkins = d.jenkins_errors > 0
      ? `<i data-icon="alert-triangle"></i> ${d.jenkins_errors}/${d.jenkins_total} error`
      : `<i data-icon="check-circle"></i> ${d.jenkins_total} servers`;
    return this._nice([
      ['<i data-icon="plug"></i>', 'Jira', jira],
      ['<i data-icon="mail"></i>', 'SMTP', smtp],
      ['<i data-icon="wrench"></i>', 'Jenkins', jenkins],
    ]);
  },

  // ─── Backup ─────────────────────────────────────────────────────────────────

  formatBackup(d) {
    const kb = d.size_kb ? `${(d.size_kb / 1024).toFixed(1)} MB` : null;
    return this._nice([
      ['<i data-icon="save"></i>', 'ไฟล์', d.file],
      ['<i data-icon="folder"></i>', 'จำนวนไฟล์', d.files ? `${d.files} files` : null],
      ['<i data-icon="activity"></i>', 'ขนาด', kb],
    ]);
  },

  // ─── Email / Mail ────────────────────────────────────────────────────────────

  formatEmailSent(d) {
    return this._nice([
      ['<i data-icon="mail"></i>', 'ถึง', d.to],
      ['<i data-icon="clipboard"></i>', 'Subject', d.subject ? this.truncate(d.subject, 80) : null],
      ['<i data-icon="pin"></i>', 'CC', d.cc || null],
    ]);
  },

  formatMailConfig(d) {
    const keys = d.keys ? (Array.isArray(d.keys) ? d.keys : [d.keys]) : [];
    return this._nice([
      ['<i data-icon="settings"></i>', 'อัปเดต', keys.length ? keys.join(', ') : 'Mail Config'],
    ]);
  },

  // ─── Notifications ──────────────────────────────────────────────────────────

  formatNotiSchedule(d) {
    const days = d.days === 'all' ? 'ทุกวัน' : d.days;
    return this._nice([
      ['⏰', 'เวลา', d.time],
      ['<i data-icon="calendar"></i>', 'วัน', days],
      ['<i data-icon="message-circle"></i>', 'ข้อความ', d.message ? this.truncate(d.message, 60) : null],
      ['<i data-icon="key"></i>', 'ID', d.noti_id ? d.noti_id.slice(-8) : null],
    ]);
  },

  formatNotiChat(d) {
    return this._nice([
      ['<i data-icon="message-circle"></i>', 'ช่องทาง', d.channel || d.platform],
      ['<i data-icon="edit"></i>', 'ข้อความ', d.message ? this.truncate(d.message, 60) : null],
    ]);
  },

  // ─── Maintenance ────────────────────────────────────────────────────────────

  formatMaintenancePage(d) {
    const state = d.active
      ? '<span style="color:#ef4444;font-weight:600"><i data-icon="circle"></i> เปิด MA</span>'
      : '<span style="color:#22c55e;font-weight:600"><i data-icon="circle"></i> ปิด MA</span>';
    return this._nice([
      ['<i data-icon="wrench"></i>', 'หน้า', d.id],
      ['<i data-icon="bar-chart"></i>', 'สถานะ', state],
      ['<i data-icon="message-circle"></i>', 'ข้อความ', d.message || null],
    ]);
  },

  formatMaintenanceGlobal(d) {
    const state = d.active
      ? '<span style="color:#ef4444;font-weight:600"><i data-icon="circle"></i> Global MA เปิด</span>'
      : '<span style="color:#22c55e;font-weight:600"><i data-icon="circle"></i> Global MA ปิด</span>';
    return this._nice([
      ['<i data-icon="globe"></i>', 'สถานะ', state],
      ['<i data-icon="message-circle"></i>', 'ข้อความ', d.message || null],
    ]);
  },

  // ─── MA Services ────────────────────────────────────────────────────────────

  formatMaCutoff(d) {
    return this._nice([
      ['⏰', 'ชื่อ', d.item_name],
      ['<i data-icon="edit"></i>', 'รายละเอียด', d.details ? this.truncate(d.details, 80) : null],
    ]);
  },

  formatMaUsecase(d) {
    return this._nice([
      ['<i data-icon="zap"></i>', 'ชื่อ', d.name || d.item_name],
      ['<i data-icon="edit"></i>', 'รายละเอียด', d.details ? this.truncate(d.details, 80) : null],
    ]);
  },

  formatMaConfig(d) {
    return this._nice([
      ['<i data-icon="wrench"></i>', 'ชื่อ', d.name],
      ['<i data-icon="pin"></i>', 'ประเภท', d.type],
    ]);
  },

  // Quick toggle chip (enable / disable button in the MA table row)
  formatMaBackofficeToggle(d) {
    const statusBadge = d.ma_status === 'MAINTENANCE'
      ? '<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">🔴 MAINTENANCE</span>'
      : '<span style="background:#22c55e;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">🟢 AVAILABLE</span>';
    const enableProps = Array.isArray(d.enable_properties) && d.enable_properties.length
      ? d.enable_properties.map(p => this.esc(p)).join('<br>')
      : null;
    const msgThProps = Array.isArray(d.msg_th_properties) && d.msg_th_properties.length
      ? d.msg_th_properties.map(p => this.esc(p)).join('<br>')
      : null;
    const msgEnProps = Array.isArray(d.msg_en_properties) && d.msg_en_properties.length
      ? d.msg_en_properties.map(p => this.esc(p)).join('<br>')
      : null;
    return this._nice([
      ['<i data-icon="zap"></i>',        'Use Case',        d.use_case_name ? this.esc(d.use_case_name) : (d.service_name ? this.esc(d.service_name) : null)],
      ['<i data-icon="hash"></i>',        'use_case_id',    d.use_case_id != null ? String(d.use_case_id) : null],
      ['<i data-icon="toggle-right"></i>', 'สถานะใหม่',     statusBadge],
      ['<i data-icon="key"></i>',          'MA Property Keys', enableProps],
      ['<i data-icon="message-circle"></i>', 'Message TH',  d.ma_message_th ? this.esc(this.truncate(d.ma_message_th, 120)) : null],
      ['<i data-icon="message-circle"></i>', 'Message EN',  d.ma_message_en ? this.esc(this.truncate(d.ma_message_en, 120)) : null],
      ['<i data-icon="key"></i>',          'Msg TH Keys',   msgThProps],
      ['<i data-icon="key"></i>',          'Msg EN Keys',   msgEnProps],
      ['<i data-icon="edit"></i>',         'เหตุผล',        d.reason ? this.esc(d.reason) : null],
      ['<i data-icon="check-circle"></i>', 'ผล',            d.result === 'ok' ? '<span style="color:#22c55e">✓ สำเร็จ</span>' : `<span style="color:#ef4444">✗ ล้มเหลว (${this.esc(d.upstream_error || '')})</span>`],
    ]);
  },

  // Full Edit modal save (Edit Use Case modal with all fields)
  formatMaBackofficeSave(d) {
    const statusBadge = d.ma_status === 'MAINTENANCE'
      ? '<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">🔴 MAINTENANCE</span>'
      : '<span style="background:#22c55e;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">🟢 AVAILABLE</span>';
    const enableIds = Array.isArray(d.enable_property_ids) && d.enable_property_ids.length
      ? d.enable_property_ids.join(', ') : null;
    const msgThIds = Array.isArray(d.msg_th_property_ids) && d.msg_th_property_ids.length
      ? d.msg_th_property_ids.join(', ') : null;
    const msgEnIds = Array.isArray(d.msg_en_property_ids) && d.msg_en_property_ids.length
      ? d.msg_en_property_ids.join(', ') : null;
    return this._nice([
      ['<i data-icon="zap"></i>',          'Use Case',       d.use_case_name ? this.esc(d.use_case_name) : null],
      ['<i data-icon="hash"></i>',          'use_case_id',   d.use_case_id != null ? String(d.use_case_id) : null],
      ['<i data-icon="tag"></i>',           'type',          d.use_case_type ? this.esc(d.use_case_type) : null],
      ['<i data-icon="toggle-right"></i>',  'สถานะใหม่',    statusBadge],
      ['<i data-icon="message-circle"></i>', 'Message TH',   d.ma_message_th ? this.esc(this.truncate(d.ma_message_th, 150)) : null],
      ['<i data-icon="message-circle"></i>', 'Message EN',   d.ma_message_en ? this.esc(this.truncate(d.ma_message_en, 150)) : null],
      ['<i data-icon="key"></i>',            'MA Property IDs',   enableIds ? `[${this.esc(enableIds)}]` : null],
      ['<i data-icon="key"></i>',            'Msg TH Property IDs', msgThIds ? `[${this.esc(msgThIds)}]` : null],
      ['<i data-icon="key"></i>',            'Msg EN Property IDs', msgEnIds ? `[${this.esc(msgEnIds)}]` : null],
      ['<i data-icon="check-circle"></i>',   'ผล',           d.result === 'ok' ? '<span style="color:#22c55e">✓ สำเร็จ</span>' : `<span style="color:#ef4444">✗ ล้มเหลว (${this.esc(d.upstream_error || '')})</span>`],
    ]);
  },

  // ─── Batch Monitor ──────────────────────────────────────────────────────────

  formatBatchSubmit(d) {
    return this._nice([
      ['<i data-icon="user"></i>', 'ผู้รายงาน', d.reporter],
      ['<i data-icon="monitor"></i>', 'Server', d.server],
      ['<i data-icon="clock"></i>', 'เวลา', d.timestamp ? this.formatDateTime(d.timestamp) : null],
    ]);
  },

  formatBatchEdited(d) {
    const changes = d.changed ? Object.keys(d.changed).join(', ') : null;
    return this._nice([
      ['<i data-icon="pencil"></i>', 'แก้ไขฟิลด์', changes],
      ['<i data-icon="key"></i>', 'Record', d.record_id ? d.record_id.slice(-10) : null],
    ]);
  },

  formatBatchRecord(d) {
    return this._nice([
      ['<i data-icon="key"></i>', 'Record ID', d.record_id ? d.record_id.slice(-10) : null],
    ]);
  },

  formatBatchCleared(d) {
    return this._nice([
      ['<i data-icon="trash"></i>', 'ลบทั้งหมด', `${d.deleted_count ?? '?'} records`],
    ]);
  },

  // ─── Test Service ────────────────────────────────────────────────────────────

  formatTestSubmit(d) {
    return this._nice([
      ['<i data-icon="user"></i>', 'ผู้รายงาน', d.reporter],
      ['<i data-icon="clock"></i>', 'เวลา', d.timestamp ? this.formatDateTime(d.timestamp) : null],
    ]);
  },

  formatTestEdited(d) {
    const changes = d.changed ? Object.keys(d.changed).join(', ') : null;
    return this._nice([
      ['<i data-icon="pencil"></i>', 'แก้ไขฟิลด์', changes],
      ['<i data-icon="key"></i>', 'Record', d.record_id ? d.record_id.slice(-10) : null],
    ]);
  },

  formatTestGroups(d) {
    return this._nice([
      ['<i data-icon="wrench"></i>', 'บันทึก', 'Test Service Groups'],
    ]);
  },

  // ─── Knowledge Base ─────────────────────────────────────────────────────────

  formatKnowledgeBase(d) {
    return this._nice([
      ['<i data-icon="book-open"></i>', 'หมวด', d.category],
      ['<i data-icon="key"></i>', 'Entry ID', d.entry_id ? d.entry_id.slice(-8) : null],
    ]);
  },

  formatKnowledgeBaseView(d) {
    return this._nice([
      ['<i data-icon="book-open"></i>', 'หมวด', `${d.categories_count} หมวด`],
      ['<i data-icon="file"></i>', 'รายการ', `${d.entries_count} รายการ`],
    ]);
  },

  formatKnowledgeBaseCategory(d) {
    return this._nice([
      ['<i data-icon="folder-open"></i>', 'ชื่อหมวด', d.name],
      ['<i data-icon="key"></i>', 'ID', d.category_id],
    ]);
  },

  formatKnowledgeBaseCategoryDel(d) {
    return this._nice([
      ['<i data-icon="trash"></i>', 'หมวด', d.category_name],
      ['<i data-icon="file"></i>', 'ลบรายการ', `${d.entries_deleted ?? 0} รายการ`],
    ]);
  },

  // ─── Board Config ────────────────────────────────────────────────────────────

  formatBoardConfig(d) {
    return this._nice([
      ['<i data-icon="folder-open"></i>', 'ชื่อ', d.name],
      ['<i data-icon="key"></i>', 'ID', d.id || null],
    ]);
  },

  // ─── Links ──────────────────────────────────────────────────────────────────

  formatLink(d) {
    return this._nice([
      ['<i data-icon="link"></i>', 'ชื่อ', d.name],
      ['<i data-icon="folder-open"></i>', 'Section', d.section],
    ]);
  },

  // ─── Sidebar Tools ───────────────────────────────────────────────────────────

  formatSidebarTool(d) {
    return this._nice([
      ['<i data-icon="wrench"></i>', 'ชื่อ', d.name],
      ['<i data-icon="link"></i>', 'ประเภท Link', d.link_type],
    ]);
  },

  // ─── Service Types ───────────────────────────────────────────────────────────

  formatServiceType(d) {
    return this._nice([
      ['<i data-icon="tag"></i>', 'ชื่อ', d.name],
      ['<i data-icon="pin"></i>', 'Parent', d.parent_id || null],
    ]);
  },

  // ─── Docs ───────────────────────────────────────────────────────────────────

  formatDoc(d) {
    return this._nice([
      ['<i data-icon="file"></i>', 'ชื่อ', d.name],
      ['<i data-icon="folder-open"></i>', 'ประเภท', d.type],
    ]);
  },

  // ─── Leave ──────────────────────────────────────────────────────────────────

  formatLeaveRequest(d) {
    const typeMap = { vacation: '<i data-icon="umbrella-beach"></i> พักร้อน', sick: '<i data-icon="thermometer"></i> ลาป่วย', personal: '<i data-icon="edit"></i> ธุระส่วนตัว' };
    return this._nice([
      ['<i data-icon="calendar"></i>', 'ประเภท', typeMap[d.type] || d.type],
      ['<i data-icon="calendar"></i>', 'วันที่', d.start === d.end ? this.formatDate(d.start) : `${this.formatDate(d.start)} – ${this.formatDate(d.end)}`],
      ['<i data-icon="users"></i>', 'แทนคนอื่น', d.forced ? 'ใช่' : null],
    ]);
  },

  formatLeaveReview(d) {
    const statusMap = { approved: '<i data-icon="check-circle"></i> อนุมัติ', rejected: '<i data-icon="x-circle"></i> ไม่อนุมัติ', pending: '⏳ รอ' };
    return this._nice([
      ['<i data-icon="clipboard"></i>', 'ผลการพิจารณา', statusMap[d.status] || d.status],
      ['<i data-icon="key"></i>', 'ID', d.id ? d.id.slice(-8) : null],
    ]);
  },

  formatLeaveCancel(d) {
    return this._nice([
      ['<i data-icon="x-circle"></i>', 'ยกเลิก', 'คำขอลา'],
      ['<i data-icon="briefcase"></i>', 'คืนโควต้า', d.quota_restored ? `${d.quota_restored} วัน` : null],
      ['<i data-icon="edit"></i>', 'เหตุผล', d.reason],
    ]);
  },

  formatLeaveEdit(d) {
    const changes = d.changes ? Object.keys(d.changes).join(', ') : null;
    return this._nice([
      ['<i data-icon="pencil"></i>', 'แก้ไข', changes],
      ['<i data-icon="briefcase"></i>', 'โควต้าเปลี่ยน', d.quota_change !== undefined ? (d.quota_change > 0 ? `+${d.quota_change}` : `${d.quota_change}`) + ' วัน' : null],
    ]);
  },

  // ─── Requests ───────────────────────────────────────────────────────────────

  formatRequest(d) {
    const typeMap = { feature: '<i data-icon="sparkles"></i> Feature', bug: '<i data-icon="bug"></i> Bug', other: '<i data-icon="edit"></i> อื่นๆ' };
    const statusMap = { pending: '⏳ รอ', in_progress: '<i data-icon="circle"></i> กำลังทำ', completed: '<i data-icon="check-circle"></i> เสร็จ', rejected: '<i data-icon="x-circle"></i> ปฏิเสธ' };
    return this._nice([
      ['<i data-icon="edit"></i>', 'หัวข้อ', d.title],
      ['<i data-icon="tag"></i>', 'ประเภท', d.type ? (typeMap[d.type] || d.type) : null],
      ['<i data-icon="refresh-cw"></i>', 'สถานะ', d.new_status ? (statusMap[d.new_status] || d.new_status) : null],
    ]);
  },

  // ─── Weekly Report ───────────────────────────────────────────────────────────

  formatWeeklyReport(d) {
    const catMap = {
      incidents:  '<i data-icon="alert-triangle"></i> Incidents',
      updates:    '<i data-icon="megaphone"></i> Updates',
      tasks:      '<i data-icon="check-circle"></i> Tasks',
      highlights: '<i data-icon="star"></i> Highlights',
    };
    return this._nice([
      ['<i data-icon="bar-chart"></i>', 'หมวด', catMap[d.category] || d.category],
      ['<i data-icon="calendar"></i>', 'สัปดาห์', d.week],
      ['<i data-icon="edit"></i>', 'ชื่อ', d.name || d.ticket_id],
      ['<i data-icon="tag"></i>', 'ประเภทย่อย', d.sub_type || null],
    ]);
  },

  // ─── Misc ────────────────────────────────────────────────────────────────────

  formatSmsGateway(d) {
    return this._nice([
      ['<i data-icon="smartphone"></i>', 'Project', d.project],
      ['<i data-icon="plus"></i>', 'เพิ่มมาใหม่', `${d.added} รายการ`],
    ]);
  },

  formatHoliday(d) {
    return this._nice([
      ['<i data-icon="calendar"></i>', 'วันที่', this.formatDate(d.date)],
      ['<i data-icon="sparkles"></i>', 'ชื่อวันหยุด', d.name],
    ]);
  },

  formatAnnouncement(d) {
    return this._nice([
      ['<i data-icon="megaphone"></i>', 'ประเภท', d.type],
      ['<i data-icon="key"></i>', 'ID', d.id ? d.id.slice(-8) : null],
    ]);
  },

  // ─── Courses / Learning Path ────────────────────────────────────────────────

  formatCourseCreate(d) {
    return this._nice([
      ['<i data-icon="graduation-cap"></i>', 'คอร์ส', d.title],
      ['<i data-icon="key"></i>', 'ID', d.id ? d.id.slice(-8) : null],
    ]);
  },

  formatCoursePhase(d) {
    return this._nice([
      ['<i data-icon="target"></i>', 'Phase', d.title],
      ['<i data-icon="graduation-cap"></i>', 'Course', d.course_id ? d.course_id.slice(-8) : null],
      ['<i data-icon="key"></i>', 'ID', d.id ? d.id.slice(-8) : null],
    ]);
  },

  formatCourseLesson(d) {
    return this._nice([
      ['<i data-icon="file"></i>', 'Lesson ID', d.id ? d.id.slice(-8) : null],
      ['<i data-icon="target"></i>', 'Phase', d.phase_id ? d.phase_id.slice(-8) : null],
    ]);
  },

  formatCourseQuiz(d) {
    return this._nice([
      ['<i data-icon="help-circle"></i>', 'Phase', d.phase_id ? d.phase_id.slice(-8) : null],
      ['🔢', 'จำนวนคำถาม', d.count != null ? d.count + ' ข้อ' : null],
      ['<i data-icon="key"></i>', 'Quiz ID', d.id ? d.id.slice(-8) : null],
    ]);
  },

  formatCourseAttempt(d) {
    return this._nice([
      ['<i data-icon="target"></i>', 'Phase', d.phase_id ? d.phase_id.slice(-8) : null],
      ['<i data-icon="bar-chart"></i>', 'คะแนน', d.score != null ? d.score + '%' : null],
      ['<i data-icon="refresh-cw"></i>', 'ครั้งที่', d.attempts != null ? d.attempts : null],
      ['<i data-icon="x-circle"></i>', 'ผล', 'ยังไม่ผ่าน'],
    ]);
  },

  formatCoursePassed(d) {
    return this._nice([
      ['<i data-icon="target"></i>', 'Phase', d.phase_id ? d.phase_id.slice(-8) : null],
      ['<i data-icon="bar-chart"></i>', 'คะแนน', d.score != null ? d.score + '%' : null],
      ['<i data-icon="refresh-cw"></i>', 'ครั้งที่', d.attempts != null ? d.attempts : null],
      ['<i data-icon="check-circle"></i>', 'ผล', 'ผ่าน!'],
    ]);
  },

  // ─── Default Fallback ────────────────────────────────────────────────────────

  formatDefault(detail) {
    if (Array.isArray(detail)) {
      if (!detail.length) return '';
      return this._nice(detail.map((v, i) => ['·', String(i), String(v)]));
    }
    const rows = Object.entries(detail).map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return ['·', k, val];
    });
    return this._nice(rows);
  },

  // ─── Layout Helper ───────────────────────────────────────────────────────────

  _nice(rows) {
    const items = rows
      .filter(([, , v]) => v !== null && v !== undefined && v !== '')
      .map(([icon, label, value]) => `
        <div class="log-detail-item">
          ${icon !== '·' ? `<span class="log-detail-icon">${icon}</span>` : ''}
          <span class="log-detail-label">${this.esc(label)}:</span>
          <span class="log-detail-value">${value}</span>
        </div>`).join('');
    return items ? `<div class="log-detail-nice">${items}</div>` : '';
  },

  // ─── Helpers ────────────────────────────────────────────────────────────────

  formatStatus(s) {
    return { open: '<i data-icon="circle"></i> Open', in_progress: '<i data-icon="circle"></i> In Progress', resolved: '<i data-icon="circle"></i> Resolved', closed: '<i data-icon="circle"></i> Closed' }[s] || s;
  },

  formatRole(r) {
    return { sm_admin: '👑 Admin', sm_lead: '<i data-icon="star"></i> Team Lead', sm_user: '<i data-icon="user"></i> User', dev_sm: '<i data-icon="zap"></i> Dev SM' }[r] || r;
  },

  formatSlot(s) {
    return {
      shift1_tdpk:  'Shift 1 – TDPK',
      shift1_wah:   'Shift 1 – WFH',
      shift1_oncall:'Shift 1 – On-call',
      shift2_wah:   'Shift 2 – WFH',
      shift2_oncall:'Shift 2 – On-call',
      vacation:     'ลาพักร้อน',
      sick:         'ลาป่วย',
      events:       'กิจกรรม',
    }[s] || s;
  },

  formatDate(str) {
    if (!str) return '-';
    try {
      return new Date(str).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return str; }
  },

  formatDateTime(str) {
    if (!str) return '-';
    try {
      return new Date(str).toLocaleString('th-TH', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return str; }
  },

  truncate(str, max) {
    if (!str) return '';
    str = String(str);
    return str.length <= max ? this.esc(str) : this.esc(str.slice(0, max)) + '…';
  },

  esc(str) {
    if (str === null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  },
};

window.LogFormatter = LogFormatter;
