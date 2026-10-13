// admin/logs — page script, extracted from admin/logs.html.
//
// Wrapped in an IIFE on purpose. When this code lived inline it was run through
// Layout's indirect eval, which kept const/let/class LOCAL; as a plain external
// script those would become global lexical bindings and collide with other pages'
// scripts (both stay loaded across SPA navigation). The IIFE restores that scoping.
//
// Top-level function/var declarations DID leak to global under eval, and inline
// on*="" handlers in the HTML call them, so they are re-published on window below
// via accessor bridges (get + set, so later reassignment stays in sync).
(function () {
'use strict';

if (!Auth.requireAdmin()) {}
  if (Auth.getUser()?.role !== 'super_admin') window.location.href = './index.html';
  Layout.render('admin-logs');

  let activeTab  = 'activity';
  let currentPage = 0;
  const PAGE_SIZE = 20;
  let autoRefreshTimer = null;
  let tailTimer = null;
  let tailNewestTs = '';  // cursor — highest ts we've already rendered
  let currentItems = [];  // last page of rows, indexed for expand-row lookup
  const PRESETS_KEY = 'som_log_presets_v1';

  // slug → { name, color } — populated from API.teams.list() at boot.
  // SM is always present as a fallback (some entries land in the global LOG_DIR
  // under 'sm' before teams are loaded).
  const _teamsMap = { sm: { name: 'SM Team', color: '#94a3b8' } };

  // Action definitions: [key, label, color, group]
  // Groups appear as <optgroup> in the filter dropdown.
  const ACTION_DEFS = [
    // Auth & Account
    ['login',                      'Login',                   '#22c55e', 'Auth'],
    ['logout',                     'Logout',                  '#64748b', 'Auth'],
    ['password_change',            'Password Change',         '#f97316', 'Auth'],
    ['password_changed',           'Password Changed',        '#7c3aed', 'Auth'],
    ['profile_update',             'Profile Update',          '#6366f1', 'Auth'],

    // Board
    ['board_create',               'Board Create',            '#3b82f6', 'Board'],
    ['board_update',               'Board Update',            '#f59e0b', 'Board'],
    ['board_delete',               'Board Delete',            '#ef4444', 'Board'],
    ['board_pin',                  'Board Pin',               '#8b5cf6', 'Board'],
    ['board_status_change',        'Board Status Change',     '#f59e0b', 'Board'],
    ['board_search',               'Board Search',            '#94a3b8', 'Board'],
    ['board_comment',              'Board Comment',           '#06b6d4', 'Board'],
    ['board_star',                 '<i data-icon="star"></i> Board Star',            '#f59e0b', 'Board'],
    ['board_unstar',               '<i data-icon="star"></i> Board Unstar',          '#94a3b8', 'Board'],
    ['board_restore',              '<i data-icon="recycle"></i> Board Restore',         '#22c55e', 'Board'],
    ['board_hard_delete',          '<i data-icon="trash"></i> Board Hard Delete',    '#ef4444', 'Board'],
    ['board_auto_purge',           '<i data-icon="trash"></i> Board Auto Purge',     '#ef4444', 'Board'],
    ['comment_delete',             'Comment Delete',          '#ef4444', 'Board'],
    ['comment_edit',               'Comment Edit',            '#f59e0b', 'Board'],
    ['comment_restore',            '<i data-icon="recycle"></i> Comment Restore',       '#22c55e', 'Board'],

    // Board Config / Service Type
    ['boardconfig_category_add',   'Category Add',            '#3b82f6', 'Board Config'],
    ['boardconfig_servicetype_add','ServiceType Add',         '#3b82f6', 'Board Config'],
    ['boardconfig_subtype_add',    'Subtype Add',             '#3b82f6', 'Board Config'],
    ['boardconfig_rename',         'Config Rename',           '#f59e0b', 'Board Config'],
    ['boardconfig_delete',         'Config Delete',           '#ef4444', 'Board Config'],
    ['servicetype_create',         'ServiceType Create',      '#3b82f6', 'Board Config'],
    ['servicetype_subtype_add',    'ServiceType Subtype Add', '#3b82f6', 'Board Config'],
    ['servicetype_service_add',    'ServiceType Service Add', '#3b82f6', 'Board Config'],
    ['servicetype_rename',         'ServiceType Rename',      '#f59e0b', 'Board Config'],
    ['servicetype_delete',         'ServiceType Delete',      '#ef4444', 'Board Config'],

    // User Admin
    ['user_create',                'User Create',             '#3b82f6', 'User Admin'],
    ['user_update',                'User Update',             '#f59e0b', 'User Admin'],
    ['user_delete',                'User Delete',             '#ef4444', 'User Admin'],
    ['user_reset_password',        '↺ Reset Password',        '#f97316', 'User Admin'],
    ['user_force_password_reset',  '<i data-icon="key"></i> Force PW Reset',       '#7c3aed', 'User Admin'],
    ['settings_update',            'Settings Update',         '#8b5cf6', 'User Admin'],

    // Docs / Templates / Links / Tools
    ['doc_create',                 'Doc Create',              '#3b82f6', 'Docs & Tools'],
    ['doc_update',                 'Doc Update',              '#f59e0b', 'Docs & Tools'],
    ['doc_delete',                 'Doc Delete',              '#ef4444', 'Docs & Tools'],
    ['template_create',            'Template Create',         '#3b82f6', 'Docs & Tools'],
    ['template_update',            'Template Update',         '#f59e0b', 'Docs & Tools'],
    ['template_delete',            'Template Delete',         '#ef4444', 'Docs & Tools'],
    ['link_create',                'Link Add',                '#3b82f6', 'Docs & Tools'],
    ['link_update',                'Link Edit',               '#f59e0b', 'Docs & Tools'],
    ['link_delete',                'Link Delete',             '#ef4444', 'Docs & Tools'],
    ['sidebar_tool_create',        'Sidebar Tool Add',        '#3b82f6', 'Docs & Tools'],
    ['sidebar_tool_update',        'Sidebar Tool Edit',       '#f59e0b', 'Docs & Tools'],
    ['sidebar_tool_delete',        'Sidebar Tool Delete',     '#ef4444', 'Docs & Tools'],
    ['file_upload',                '<i data-icon="paperclip"></i> File Upload',          '#22c55e', 'Docs & Tools'],

    // Jira & Jenkins
    ['jira_create_ticket',         'Jira Create Ticket',      '#8b5cf6', 'Jira & Jenkins'],
    ['jira_add_comment',           'Jira Add Comment',        '#06b6d4', 'Jira & Jenkins'],
    ['jira_assign',                'Jira Assign',             '#3b82f6', 'Jira & Jenkins'],
    ['jira_attach',                'Jira Attach',             '#22c55e', 'Jira & Jenkins'],
    ['jira_transition',            'Jira Transition',         '#f59e0b', 'Jira & Jenkins'],
    ['jiraconfig_add',             'Jira Config Add',         '#3b82f6', 'Jira & Jenkins'],
    ['jiraconfig_update',          'Jira Config Update',      '#f59e0b', 'Jira & Jenkins'],
    ['jiraconfig_delete',          'Jira Config Delete',      '#ef4444', 'Jira & Jenkins'],
    ['jenkins_server_create',      'Jenkins Server Add',      '#3b82f6', 'Jira & Jenkins'],
    ['jenkins_server_update',      'Jenkins Server Edit',     '#f59e0b', 'Jira & Jenkins'],
    ['jenkins_server_delete',      'Jenkins Server Delete',   '#ef4444', 'Jira & Jenkins'],
    ['jenkins_build_trigger',      '<i data-icon="zap"></i> Jenkins Build Trigger','#f97316', 'Jira & Jenkins'],

    // Notifications & Email
    ['noti_schedule_created',      '<i data-icon="bell"></i> Schedule Created',     '#22c55e', 'Notifications'],
    ['noti_schedule_updated',      '<i data-icon="bell"></i> Schedule Updated',     '#f59e0b', 'Notifications'],
    ['noti_schedule_deleted',      '<i data-icon="bell"></i> Schedule Deleted',     '#ef4444', 'Notifications'],
    ['noti_chat_sent',             '<i data-icon="message-circle"></i> Chat Sent',            '#4285f4', 'Notifications'],
    ['noti_chat_test',             '<i data-icon="message-circle"></i> Chat Test',            '#8b5cf6', 'Notifications'],
    ['email_sent',                 '<i data-icon="mail"></i> Email Sent',           '#3b82f6', 'Notifications'],
    ['test_email_sent',            '<i data-icon="mail"></i> Test Email Sent',      '#8b5cf6', 'Notifications'],
    ['mail_config_updated',        '<i data-icon="settings"></i> Mail Config Updated',   '#f59e0b', 'Notifications'],
    ['inbox_sent',                 '<i data-icon="inbox"></i> Inbox Sent',           '#3b82f6', 'Notifications'],
    ['announcement_create',        '<i data-icon="megaphone"></i> Announcement Create',  '#3b82f6', 'Notifications'],
    ['announcement_delete',        '<i data-icon="megaphone"></i> Announcement Delete',  '#ef4444', 'Notifications'],

    // Health & Monitoring
    ['health_check',               '<i data-icon="plug"></i> Health Check',         '#06b6d4', 'Health'],
    ['uptime_monitor_add',         '<i data-icon="circle"></i> Monitor Add',           '#22c55e', 'Health'],
    ['uptime_monitor_delete',      '<i data-icon="circle"></i> Monitor Delete',        '#ef4444', 'Health'],
    ['bot_oncall_query',           '<i data-icon="chip"></i> Bot Oncall Query',     '#06b6d4', 'Health'],

    // Backup & Maintenance
    ['backup_created',             '<i data-icon="save"></i> Backup Created',       '#22c55e', 'Backup & Maint'],
    ['backup_downloaded',          '<i data-icon="arrow-down"></i> Backup Downloaded',     '#3b82f6', 'Backup & Maint'],
    ['backup_deleted',             '<i data-icon="trash"></i> Backup Deleted',       '#ef4444', 'Backup & Maint'],
    ['backup_restored',            '<i data-icon="recycle"></i> Backup Restored',       '#f97316', 'Backup & Maint'],
    ['logs_rotated',               '<i data-icon="refresh-cw"></i> Logs Rotated',         '#8b5cf6', 'Backup & Maint'],
    ['cache_cleared',              '<i data-icon="trash"></i> Cache Cleared',        '#f97316', 'Backup & Maint'],
    ['cleanup_completed',          '<i data-icon="trash"></i> Cleanup Completed',    '#22c55e', 'Backup & Maint'],
    ['maintenance_global',         '<i data-icon="wrench"></i> Maintenance Global',   '#dc2626', 'Backup & Maint'],
    ['maintenance_page',           '<i data-icon="wrench"></i> Maintenance Page',     '#f97316', 'Backup & Maint'],
    ['maintenance_tool',           '<i data-icon="wrench"></i> Maintenance Tool',     '#f59e0b', 'Backup & Maint'],

    // Schedule & Leave
    ['schedule_update',            '<i data-icon="calendar"></i> Schedule Update',      '#f59e0b', 'Schedule & Leave'],
    ['schedule_clear_day',         '<i data-icon="calendar"></i> Schedule Clear Day',   '#ef4444', 'Schedule & Leave'],
    ['schedule_color_update',      '<i data-icon="palette"></i> Schedule Color Update','#8b5cf6', 'Schedule & Leave'],
    ['leave_request',              '<i data-icon="umbrella-beach"></i> Leave Request',        '#3b82f6', 'Schedule & Leave'],
    ['leave_review',               '<i data-icon="umbrella-beach"></i> Leave Review',         '#f59e0b', 'Schedule & Leave'],
    ['leave_edit',                 '<i data-icon="umbrella-beach"></i> Leave Edit',           '#f59e0b', 'Schedule & Leave'],
    ['leave_cancel',               '<i data-icon="umbrella-beach"></i> Leave Cancel',         '#ef4444', 'Schedule & Leave'],
    ['holiday_add',                '<i data-icon="sparkles"></i> Holiday Add',          '#3b82f6', 'Schedule & Leave'],
    ['holiday_update',             '<i data-icon="sparkles"></i> Holiday Update',       '#f59e0b', 'Schedule & Leave'],
    ['holiday_delete',             '<i data-icon="sparkles"></i> Holiday Delete',       '#ef4444', 'Schedule & Leave'],

    // Knowledge Base
    ['knowledge_base_add_category',    'KB Category Add',     '#3b82f6', 'Knowledge Base'],
    ['knowledge_base_update_category', 'KB Category Update',  '#f59e0b', 'Knowledge Base'],
    ['knowledge_base_delete_category', 'KB Category Delete',  '#ef4444', 'Knowledge Base'],
    ['knowledge_base_delete',          'KB Article Delete',   '#ef4444', 'Knowledge Base'],
    ['knowledge_base_clear_all',       'KB Clear All',        '#dc2626', 'Knowledge Base'],
    ['knowledge_base_import',          'KB Import',           '#22c55e', 'Knowledge Base'],
    ['knowledge_base_view',            'KB View',             '#94a3b8', 'Knowledge Base'],

    // Courses & Exams
    ['course_create',              'Course Create',           '#3b82f6', 'Courses & Exams'],
    ['course_update',              'Course Update',           '#f59e0b', 'Courses & Exams'],
    ['course_delete',              'Course Delete',           '#ef4444', 'Courses & Exams'],
    ['course_phase_create',        'Course Phase Create',     '#3b82f6', 'Courses & Exams'],
    ['course_phase_update',        'Course Phase Update',     '#f59e0b', 'Courses & Exams'],
    ['course_phase_delete',        'Course Phase Delete',     '#ef4444', 'Courses & Exams'],
    ['course_lesson_create',       'Course Lesson Create',    '#3b82f6', 'Courses & Exams'],
    ['course_lesson_update',       'Course Lesson Update',    '#f59e0b', 'Courses & Exams'],
    ['course_lesson_delete',       'Course Lesson Delete',    '#ef4444', 'Courses & Exams'],
    ['course_quiz_save',           'Course Quiz Save',        '#3b82f6', 'Courses & Exams'],
    ['course_quiz_delete',         'Course Quiz Delete',      '#ef4444', 'Courses & Exams'],
    ['course_progress_reset',      '↺ Course Progress Reset', '#f97316', 'Courses & Exams'],
    ['exam_create',                'Exam Create',             '#3b82f6', 'Courses & Exams'],
    ['exam_update',                'Exam Update',             '#f59e0b', 'Courses & Exams'],
    ['exam_delete',                'Exam Delete',             '#ef4444', 'Courses & Exams'],
    ['exam_attempt_start',         'Exam Attempt Start',      '#06b6d4', 'Courses & Exams'],
    ['exam_attempts_reset',        '↺ Exam Attempts Reset',   '#f97316', 'Courses & Exams'],

    // Onboarding
    ['onboarding_finish',          'Onboarding Finish',       '#22c55e', 'Onboarding'],
    ['onboarding_config_update',   'Onboarding Config Update','#f59e0b', 'Onboarding'],
    ['onboarding_admin_reset',     '↺ Onboarding Admin Reset','#f97316', 'Onboarding'],
    ['onboarding_pdf_upload',      '<i data-icon="paperclip"></i> Onboarding PDF Upload','#3b82f6', 'Onboarding'],
    ['onboarding_pdf_delete',      '<i data-icon="trash"></i> Onboarding PDF Delete','#ef4444', 'Onboarding'],

    // Ops Runbook
    ['ops_runbook_section_create', 'Runbook Section Create',  '#3b82f6', 'Ops Runbook'],
    ['ops_runbook_section_update', 'Runbook Section Update',  '#f59e0b', 'Ops Runbook'],
    ['ops_runbook_section_delete', 'Runbook Section Delete',  '#ef4444', 'Ops Runbook'],
    ['ops_runbook_column_create',  'Runbook Column Create',   '#3b82f6', 'Ops Runbook'],
    ['ops_runbook_column_update',  'Runbook Column Update',   '#f59e0b', 'Ops Runbook'],
    ['ops_runbook_column_delete',  'Runbook Column Delete',   '#ef4444', 'Ops Runbook'],
    ['ops_runbook_row_create',     'Runbook Row Create',      '#3b82f6', 'Ops Runbook'],
    ['ops_runbook_row_update',     'Runbook Row Update',      '#f59e0b', 'Ops Runbook'],
    ['ops_runbook_row_delete',     'Runbook Row Delete',      '#ef4444', 'Ops Runbook'],

    // Password Manager
    ['pw_item_created',            '<i data-icon="lock"></i> PW Item Create',       '#3b82f6', 'Password Mgr'],
    ['pw_item_updated',            '<i data-icon="lock"></i> PW Item Update',       '#f59e0b', 'Password Mgr'],
    ['pw_item_deleted',            '<i data-icon="lock"></i> PW Item Delete',       '#ef4444', 'Password Mgr'],
    ['pw_item_toggle',             '<i data-icon="lock"></i> PW Item Toggle',       '#8b5cf6', 'Password Mgr'],
    ['pw_config_updated',          '<i data-icon="settings"></i> PW Config Updated',     '#f59e0b', 'Password Mgr'],
    ['pw_sync',                    '<i data-icon="refresh-cw"></i> PW Sync',              '#06b6d4', 'Password Mgr'],
    ['pw_notify_sent',             '<i data-icon="bell"></i> PW Notify Sent',       '#22c55e', 'Password Mgr'],
    ['pw_notify_test',             '<i data-icon="bell"></i> PW Notify Test',       '#8b5cf6', 'Password Mgr'],
    ['pw_notify_reply_failed',     '<i data-icon="alert-triangle"></i> PW Notify Reply Failed','#ef4444', 'Password Mgr'],

    // Requests
    ['request_created',            '<i data-icon="clipboard"></i> Request Created',      '#3b82f6', 'Requests'],
    ['request_updated',            '<i data-icon="clipboard"></i> Request Updated',      '#f59e0b', 'Requests'],
    ['request_deleted',            '<i data-icon="clipboard"></i> Request Deleted',      '#ef4444', 'Requests'],

    // Batch & Test Service
    ['batch_report_submitted',     '<i data-icon="bar-chart"></i> Batch Report Submitted','#22c55e', 'Batch & Test'],
    ['batch_record_edited',        '<i data-icon="bar-chart"></i> Batch Record Edited',  '#f59e0b', 'Batch & Test'],
    ['batch_record_deleted',       '<i data-icon="bar-chart"></i> Batch Record Deleted', '#ef4444', 'Batch & Test'],
    ['batch_records_cleared',      '<i data-icon="bar-chart"></i> Batch Records Cleared','#dc2626', 'Batch & Test'],
    ['test_service_submitted',     '<i data-icon="test-tube"></i> Test Submitted',       '#22c55e', 'Batch & Test'],
    ['test_record_edited',         '<i data-icon="test-tube"></i> Test Record Edited',   '#f59e0b', 'Batch & Test'],
    ['test_record_deleted',        '<i data-icon="test-tube"></i> Test Record Deleted',  '#ef4444', 'Batch & Test'],
    ['test_records_cleared',       '<i data-icon="test-tube"></i> Test Records Cleared', '#dc2626', 'Batch & Test'],
    ['test_service_groups_saved',  '<i data-icon="test-tube"></i> Test Groups Saved',    '#f59e0b', 'Batch & Test'],
    ['reconcile_credentials_saved','<i data-icon="key"></i> Reconcile Creds Saved','#8b5cf6', 'Batch & Test'],

    // SMS Gateway
    ['sms_gateway_remark',         '<i data-icon="message-circle"></i> SMS Gateway Remark',   '#f59e0b', 'SMS Gateway'],
    ['sms_gateway_sync',           '<i data-icon="refresh-cw"></i> SMS Gateway Sync',     '#06b6d4', 'SMS Gateway'],

    // Restart Monitor (EKS / OCP pod restart audit)
    ['restart_monitor_raw_fetch',        '<i data-icon="refresh-cw"></i> RM · Raw Fetch',           '#3b82f6', 'Restart Monitor'],
    ['restart_monitor_raw_fetch_locked', '<i data-icon="lock"></i> RM · Fetch Locked (skip)', '#94a3b8', 'Restart Monitor'],
    ['restart_monitor_upload',           '<i data-icon="arrow-up"></i> RM · Daily Upload',         '#3b82f6', 'Restart Monitor'],
    ['restart_monitor_upload_inconsistent_totals', '<i data-icon="alert-triangle"></i> RM · Inconsistent Totals', '#f59e0b', 'Restart Monitor'],
    ['restart_monitor_notify',           '<i data-icon="megaphone"></i> RM · Notify Sent',         '#22c55e', 'Restart Monitor'],
    ['restart_monitor_send_monthly',     '<i data-icon="calendar"></i> RM · Send Monthly',        '#8b5cf6', 'Restart Monitor'],
    ['service_severity_upsert',          'Severity · Upsert',           '#3b82f6', 'Restart Monitor'],
    ['service_severity_delete',          'Severity · Delete',           '#ef4444', 'Restart Monitor'],
    ['service_severity_import',          'Severity · Import CSV',       '#06b6d4', 'Restart Monitor'],
    ['n8n_severity_config_save',         'Severity · Webhook Save',     '#f59e0b', 'Restart Monitor'],
    ['n8n_severity_sync',                '<i data-icon="refresh-cw"></i> Severity · Sheet Sync',    '#22c55e', 'Restart Monitor'],

    // System
    ['api_rate_limit_exceeded',    '<i data-icon="circle"></i> Rate Limit Exceeded',  '#f97316', 'System'],

    // ── Additions (previously missing from dropdown) ──────────────────────

    // Auth extras
    ['password_reset_via_token',   '<i data-icon="key"></i> Password Reset (Token)','#f97316', 'Auth'],

    // Team Admin (super_admin actions on teams/permissions)
    ['team_created',               '<i data-icon="building"></i> Team Create',           '#3b82f6', 'Team Admin'],
    ['team_deactivated',           '<i data-icon="pause"></i> Team Deactivate',       '#f97316', 'Team Admin'],
    ['team_deleted',               '<i data-icon="trash"></i> Team Delete',           '#ef4444', 'Team Admin'],
    ['team_config_update',         'Team Config Update',       '#f59e0b', 'Team Admin'],
    ['team_permissions_updated',   '<i data-icon="shield"></i> Team Permissions Update','#8b5cf6', 'Team Admin'],
    ['feature_requested',          '<i data-icon="zap"></i> Feature Requested',     '#3b82f6', 'Team Admin'],
    ['feature_config_copied',      '<i data-icon="inbox"></i> Feature Config Copied', '#22c55e', 'Team Admin'],
    ['menu_permissions_update',    '<i data-icon="shield"></i> Menu Permissions Update','#8b5cf6', 'Team Admin'],
    ['email_templates_updated',    '<i data-icon="settings"></i> Email Templates Updated','#f59e0b', 'Team Admin'],

    // Syncup
    ['syncup_uploaded',            '<i data-icon="refresh-cw"></i> Syncup Upload',         '#22c55e', 'Syncup'],
    ['syncup_deleted',             '<i data-icon="refresh-cw"></i> Syncup Delete',         '#ef4444', 'Syncup'],
    ['syncup_config_saved',        '<i data-icon="settings"></i> Syncup Config',          '#f59e0b', 'Syncup'],
    ['syncup_notify_sent',         '<i data-icon="megaphone"></i> Syncup Notify',         '#3b82f6', 'Syncup'],

    // Monitoring (alert monitor + related)
    ['alert_monitor_config_update','<i data-icon="settings"></i> Alert Config Update',    '#f59e0b', 'Monitoring'],
    ['alert_monitor_sync',         '<i data-icon="refresh-cw"></i> Alert Sync',            '#06b6d4', 'Monitoring'],

    // Batch & Test (additions)
    ['batch_meta_config_create',   '<i data-icon="bar-chart"></i> Batch Meta Create',     '#3b82f6', 'Batch & Test'],
    ['batch_meta_config_delete',   '<i data-icon="bar-chart"></i> Batch Meta Delete',     '#ef4444', 'Batch & Test'],
    ['batch_meta_sync',            '<i data-icon="refresh-cw"></i> Batch Meta Sync',       '#06b6d4', 'Batch & Test'],

    // Notifications (additions)
    ['batch_monitor_noti_sent',           '<i data-icon="megaphone"></i> Batch Noti Sent',       '#22c55e', 'Notifications'],
    ['batch_monitor_noti_webhook_save',   '<i data-icon="settings"></i> Batch Noti Webhook Save', '#f59e0b', 'Notifications'],
    ['batch_monitor_noti_webhook_clear',  '<i data-icon="settings"></i> Batch Noti Webhook Clear','#ef4444', 'Notifications'],
    ['batch_monitor_noti_webhook_test',   '<i data-icon="settings"></i> Batch Noti Webhook Test', '#8b5cf6', 'Notifications'],
    ['email_noti_broadcast',              '<i data-icon="megaphone"></i> Email Broadcast',        '#3b82f6', 'Notifications'],
    ['fh_email_config_save',              '<i data-icon="settings"></i> FH Email Config',         '#f59e0b', 'Notifications'],

    // Courses & Exams (addition)
    ['learn_page_config_update',   '<i data-icon="settings"></i> Learn Config Update',    '#f59e0b', 'Courses & Exams'],

    // Onboarding (addition)
    ['onboarding_exam_submit',     'Onboarding Exam Submit',   '#3b82f6', 'Onboarding'],

    // Restart Monitor (additions)
    ['restart_monitor_recipients_update','<i data-icon="users"></i> RM · Recipients Update', '#f59e0b', 'Restart Monitor'],
    ['restart_monitor_webhook_save',     '<i data-icon="settings"></i> RM · Webhook Save',       '#f59e0b', 'Restart Monitor'],
    ['restart_monitor_webhook_clear',    '<i data-icon="settings"></i> RM · Webhook Clear',      '#ef4444', 'Restart Monitor'],
    ['restart_monitor_webhook_test',     '<i data-icon="settings"></i> RM · Webhook Test',       '#8b5cf6', 'Restart Monitor'],
    ['restart_monitor_webhook_toggle',   '<i data-icon="settings"></i> RM · Webhook Toggle',     '#94a3b8', 'Restart Monitor'],
  ];

  // Group display order
  const ACTION_GROUP_ORDER = [
    'Auth','Board','Board Config','User Admin','Team Admin','Docs & Tools',
    'Jira & Jenkins','Notifications','Health','Monitoring','Backup & Maint',
    'Schedule & Leave','Knowledge Base','Courses & Exams','Onboarding',
    'Ops Runbook','Password Mgr','Requests','Batch & Test','SMS Gateway',
    'Syncup','Restart Monitor','System',
  ];

  // Build maps
  const ACTION_COLORS = Object.fromEntries(ACTION_DEFS.map(([k,_l,c]) => [k,c]));
  const ACTION_LABELS = Object.fromEntries(ACTION_DEFS.map(([k,l]) => [k,l]));

  // Security-only entries
  Object.assign(ACTION_COLORS, {
    login_failed:            '#ef4444',
    brute_force_blocked:     '#dc2626',
    token_invalid:           '#f97316',
    auth_no_token:           '#f59e0b',
    forbidden:               '#ef4444',
    forbidden_page:          '#ef4444',
    page_mode_forbidden:     '#f97316',
    api_rate_limit_exceeded: '#f97316',
    // Server-side error events (logged by helpers.php)
    fatal_error:             '#dc2626',
    uncaught_exception:      '#dc2626',
    server_error:            '#ef4444',
    integration_error:       '#f97316',
  });
  Object.assign(ACTION_LABELS, {
    login_failed:            'Login Failed',
    brute_force_blocked:     '<i data-icon="siren"></i> Brute Force',
    token_invalid:           'Token Invalid',
    auth_no_token:           'No Token',
    forbidden:               'Forbidden',
    forbidden_page:          'Forbidden Page',
    page_mode_forbidden:     '<i data-icon="lock"></i> Page Mode Forbidden',
    api_rate_limit_exceeded: '<i data-icon="circle"></i> Rate Limit Exceeded',
    fatal_error:             '<i data-icon="zap"></i> Fatal PHP Error',
    uncaught_exception:      '<i data-icon="zap"></i> Uncaught Exception',
    server_error:            '<i data-icon="flame"></i> Server Error (5xx)',
    integration_error:       '<i data-icon="plug"></i> Integration Error',
  });

  function getColor(action) { return ACTION_COLORS[action] || '#94a3b8'; }
  function getLabel(action) { return ACTION_LABELS[action] || action; }

  // Labels in ACTION_LABELS may contain trusted icon markup like
  // `<i data-icon="X"></i>`; unknown actions fall back to the raw event name
  // (which is untrusted). Escape only the fallback path — never double-escape
  // curated labels, or icons render as literal text (bug: "<i data-icon=...>").
  function renderLabel(action) {
    const known = ACTION_LABELS[action];
    return known != null ? known : escHtml(action);
  }

  function formatThaiDateTime(isoString) {
    if (!isoString) return '-';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('th-TH', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return isoString.replace('T', ' ').substring(0, 19);
    }
  }

  const CE_TYPE_META = {
    js_error:             { label: 'JS Error',           color: '#ef4444' },
    api_error:            { label: 'API Error',          color: '#f59e0b' },
    unhandled_rejection:  { label: 'Promise Rejection',  color: '#8b5cf6' },
  };

  function switchTab(tab) {
    activeTab = tab;
    currentPage = 0;
    ['activity','security','errors','client_error'].forEach(t => {
      const el = document.getElementById(`tab-${t}`);
      if (el) el.classList.toggle('active', t === tab);
    });

    const sel = document.getElementById('f-action-select');
    const txt = document.getElementById('f-action');

    if (tab === 'activity') {
      sel.style.display = ''; txt.style.display = 'none';
      const SKIP = new Set(['health_check']);
      const byGroup = {};
      for (const [key, label, , group] of ACTION_DEFS) {
        if (SKIP.has(key)) continue;
        (byGroup[group] = byGroup[group] || []).push({ key, label });
      }
      const orderedGroups = ACTION_GROUP_ORDER.filter(g => byGroup[g]);
      const stripIcon = s => s.replace(/<i\s+data-icon="[^"]*"><\/i>\s*/g, '').trim();
      const optgroups = orderedGroups.map(g => {
        const opts = byGroup[g]
          .map(o => ({ key: o.key, text: stripIcon(o.label) }))
          .sort((a, b) => a.text.localeCompare(b.text))
          .map(o => `<option value="${o.key}">${escHtml(o.text)}</option>`)
          .join('');
        return `<optgroup label="${g}">${opts}</optgroup>`;
      }).join('');
      sel.innerHTML = '<option value="">All Actions</option>' + optgroups;
    } else if (tab === 'client_error') {
      sel.style.display = ''; txt.style.display = 'none';
      sel.innerHTML = `
        <option value="">All Error Types</option>
        <option value="js_error">JS Error</option>
        <option value="api_error">API Error</option>
        <option value="unhandled_rejection">Promise Rejection</option>`;
    } else if (tab === 'errors') {
      sel.style.display = ''; txt.style.display = 'none';
      sel.innerHTML = `
        <option value="">All Errors</option>
        <option value="fatal_error">Fatal PHP Error</option>
        <option value="uncaught_exception">Uncaught Exception</option>
        <option value="server_error">Server Error (5xx)</option>
        <option value="integration_error">Integration Error</option>`;
    } else {
      // security tab uses free-text event search
      sel.style.display = 'none'; txt.style.display = '';
    }
    loadLogs();
  }

  // ── Load team roster into filter dropdown + colour lookup map ────────
  async function loadTeamsForFilter() {
    const res = await API.teams.list();
    if (!res?.ok) return;
    const teams = res.data?.data || res.data || [];
    const sel = document.getElementById('f-team');
    // Sort by name for a stable dropdown
    teams.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    teams.forEach(t => {
      const slug = t.slug;
      if (!slug) return;
      _teamsMap[slug] = { name: t.name || slug, color: t.color || '#6366F1' };
      // Skip re-adding SM if the option already exists
      if (sel.querySelector(`option[value="${slug}"]`)) return;
      const opt = document.createElement('option');
      opt.value = slug;
      opt.textContent = `${t.name || slug}  /${slug}`;
      sel.appendChild(opt);
    });
  }

  function teamBadge(slug, cnt) {
    const meta = _teamsMap[slug] || { name: slug || 'unknown', color: '#94a3b8' };
    const cntHtml = (cnt !== undefined) ? `<span class="cnt">${cnt}</span>` : '';
    return `<span class="log-team-badge" style="--tm-color:${meta.color}" title="${escHtml(meta.name)}">${escHtml(slug || '?')}${cntHtml}</span>`;
  }

  function onTeamChange() {
    currentPage = 0;
    loadLogs();
  }

  function buildParams(extra = {}) {
    const params = {
      type:   activeTab,
      limit:  PAGE_SIZE,
      offset: currentPage * PAGE_SIZE,
    };
    let teamSel = document.getElementById('f-team').value;
    const rawSearch = document.getElementById('f-search').value.trim();
    let u  = document.getElementById('f-user').value.trim();
    let a  = (activeTab === 'activity' || activeTab === 'client_error')
      ? document.getElementById('f-action-select').value
      : document.getElementById('f-action').value.trim();
    const d  = document.getElementById('f-date').value;
    const dt = document.getElementById('f-date-to').value;

    // Advanced search: pull key:value tokens out of the search box and route
    // them to their proper params. Leftover free-text stays as full-text search.
    // Explicit fields (dropdowns / date pickers) always win over inline tokens.
    const parsed = parseSearch(rawSearch);
    if (!u && parsed.user)     u = parsed.user;
    if (!a && parsed.action)   a = parsed.action;
    if (!teamSel && parsed.team) teamSel = parsed.team;
    const freeText = parsed.rest;

    if (teamSel) params.team    = teamSel;
    if (freeText) params.search = freeText;
    if (u)       params.user    = u;
    if (a)       params.action  = a;
    if (d)       params.date    = d;
    if (dt)      params.date_to = dt;
    return { ...params, ...extra };
  }

  async function loadLogs(opts = {}) {
    const wrap = document.getElementById('log-table-wrap');
    if (!opts.silent) wrap.innerHTML = Skeleton.table(8);

    const prevTailTs = tailNewestTs;
    const params = buildParams();

    const res = await API.logs.query(params);
    if (!res?.ok) { wrap.innerHTML = '<div class="empty-state"><p>โหลด logs ไม่ได้</p></div>'; return; }

    const { items, total, today_count, unique_users, top_actions, team_counts, all_actions, hourly, hourly_by_team, newest_ts } = res.data.data;

    currentItems = items;
    tailNewestTs = newest_ts || (items[0]?.ts || '');
    renderSparkline(hourly || [], hourly_by_team || []);
    renderStats(today_count, unique_users, total, top_actions);
    renderTeamsBar(team_counts || {}, params.team || '');
    syncActionDropdown(all_actions || []);
    renderTable(items);
    renderPagination(total);

    // Live-tail: mark rows whose ts is newer than what we knew before this fetch
    if (opts.tail && prevTailTs) {
      document.querySelectorAll('tr.log-row-main').forEach(tr => {
        const idx = +tr.dataset.logIdx;
        const entry = currentItems[idx];
        if (entry && entry.ts && entry.ts > prevTailTs) tr.classList.add('log-row-new');
      });
    }
  }

  // ── 24h sparkline (stacked bars by team) ───────────────────────────────
  // Each hour bucket is a stack of team-coloured segments summing to the total
  // for that hour. Falls back to a single orange bar if per-team data isn't
  // available (older backend or empty scope).
  function renderSparkline(hourly, hourlyByTeam) {
    const wrap = document.getElementById('log-sparkline');
    if (!hourly.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const svg = document.getElementById('log-sparkline-svg');
    const maxVal = Math.max(1, ...hourly);
    const W = 100, H = 100, gap = 1.2;
    const bw = (W - gap * (hourly.length - 1)) / hourly.length;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const nowHour = new Date().getHours();
    const hasStacks = Array.isArray(hourlyByTeam) && hourlyByTeam.length === hourly.length;

    // Stable team ordering across bars — sort by total descending so dominant
    // teams sit at the bottom, giving a cleaner visual baseline
    const teamTotals = {};
    if (hasStacks) hourlyByTeam.forEach(b => {
      for (const [t, c] of Object.entries(b || {})) teamTotals[t] = (teamTotals[t] || 0) + c;
    });
    const teamOrder = Object.keys(teamTotals).sort((a, b) => teamTotals[b] - teamTotals[a]);
    const legendTeams = teamOrder.slice(0, 6);

    const bars = hourly.map((v, i) => {
      const totalH = maxVal ? (v / maxVal) * H : 0;
      const x = i * (bw + gap);
      const hoursAgo = 23 - i;
      const hour = (nowHour - hoursAgo + 24) % 24;
      const timeLabel = String(hour).padStart(2, '0') + ':00';

      if (!hasStacks || !v) {
        return `<rect class="log-sparkline-bar"
          x="${x.toFixed(2)}" y="${(H - totalH).toFixed(2)}"
          width="${bw.toFixed(2)}" height="${totalH.toFixed(2)}"
          fill="var(--orange, #F26419)" rx="0.8">
          <title>${timeLabel} — ${v} events</title>
        </rect>`;
      }

      const buck = hourlyByTeam[i] || {};
      // Stack segments bottom-up in the same order for every bar
      let yCursor = H;
      const segments = teamOrder.map(team => {
        const cnt = buck[team] || 0;
        if (!cnt) return '';
        const segH = maxVal ? (cnt / maxVal) * H : 0;
        yCursor -= segH;
        const color = (_teamsMap[team]?.color) || '#94a3b8';
        return `<rect class="log-sparkline-bar"
          x="${x.toFixed(2)}" y="${yCursor.toFixed(2)}"
          width="${bw.toFixed(2)}" height="${segH.toFixed(2)}"
          fill="${color}" rx="0.6"
          onclick="filterByTeam('${team}')"
          style="cursor:pointer">
          <title>${timeLabel} · ${_teamsMap[team]?.name || team} — ${cnt} events</title>
        </rect>`;
      }).join('');

      // Invisible full-height hit-target that shows the total breakdown on hover
      const breakdown = Object.entries(buck)
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${_teamsMap[t]?.name || t}: ${c}`).join('\n');
      const overlay = `<rect x="${x.toFixed(2)}" y="${(H - totalH).toFixed(2)}"
        width="${bw.toFixed(2)}" height="${totalH.toFixed(2)}"
        fill="transparent" pointer-events="all">
        <title>${timeLabel} — รวม ${v} events\n${breakdown}</title>
      </rect>`;

      return segments + overlay;
    }).join('');

    svg.innerHTML = bars;
    document.getElementById('log-sparkline-max').textContent = `peak ${maxVal}/h`;

    // Legend chips (top-N teams contributing to the sparkline)
    const legend = document.getElementById('log-sparkline-legend');
    if (legend) {
      if (!hasStacks || !legendTeams.length) { legend.innerHTML = ''; }
      else {
        legend.innerHTML = legendTeams.map(t => {
          const meta = _teamsMap[t] || { name: t, color: '#94a3b8' };
          return `<span class="spark-legend-item" onclick="filterByTeam('${t}')" title="Filter logs to ${escHtml(meta.name)}">
            <span class="spark-legend-dot" style="background:${meta.color}"></span>${escHtml(meta.name)}
          </span>`;
        }).join('');
      }
    }
  }

  // ── Row expand: pretty-print full log entry as syntax-highlighted JSON ──
  function toggleExpandRow(idx) {
    const mainTr = document.querySelector(`tr[data-log-idx="${idx}"]`);
    if (!mainTr) return;
    const existing = mainTr.nextElementSibling;
    if (existing && existing.classList.contains('log-row-expanded')) {
      existing.remove();
      mainTr.classList.remove('expanded');
      return;
    }
    const entry = currentItems[idx];
    if (!entry) return;
    const cols = mainTr.children.length;
    const json = JSON.stringify(entry, null, 2);
    const actionKey = entry.action || entry.event || entry.type || '';
    const ex = LogExplainTH.get(actionKey, entry);
    const explainBlock = `
      <dl class="log-explain-block">
        <dt>คืออะไร</dt>
        <dd>${escHtml(ex.long)}</dd>
        ${ex.cause ? `<dt>สาเหตุที่พบบ่อย</dt><dd class="muted">${escHtml(ex.cause)}</dd>` : ''}
        ${!ex.matched ? `<dt>หมายเหตุ</dt><dd class="muted">action นี้ยังไม่ได้ระบุใน dictionary และไม่เข้ากับ pattern มาตรฐาน — เพิ่มลง <code>assets/pages/admin/logs/log-explain-th.js</code> เพื่อให้มีคำอธิบายเฉพาะ</dd>` : ''}
      </dl>`;
    const tr = document.createElement('tr');
    tr.className = 'log-row-expanded';
    tr.innerHTML = `
      <td colspan="${cols}">
        ${explainBlock}
        <div class="log-json-viewer">
          <pre>${highlightJson(json)}</pre>
          <button class="log-json-copy" onclick="copyToClipboard(this, ${idx})">Copy</button>
        </div>
      </td>`;
    mainTr.after(tr);
    mainTr.classList.add('expanded');
    if (window.Icons?.render) window.Icons.render(tr);
  }

  function copyToClipboard(btn, idx) {
    const entry = currentItems[idx]; if (!entry) return;
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2)).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    });
  }

  function highlightJson(json) {
    return escHtml(json)
      .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="json-key">$1</span>$2')
      .replace(/: (&quot;.*?&quot;)/g, ': <span class="json-str">$1</span>')
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>');
  }

  function dayLabel(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d)) return ts.slice(0, 10);
    const today = new Date(); today.setHours(0,0,0,0);
    const y = new Date(today); y.setDate(y.getDate() - 1);
    const dOnly = new Date(d); dOnly.setHours(0,0,0,0);
    if (dOnly.getTime() === today.getTime()) return 'Today · ' + d.toLocaleDateString('th-TH');
    if (dOnly.getTime() === y.getTime())     return 'Yesterday · ' + d.toLocaleDateString('th-TH');
    return d.toLocaleDateString('th-TH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ── Auto-populate unknown actions into the filter dropdown ────────────────
  // ACTION_DEFS is a manually curated catalog (nice labels, colors, groups).
  // But new features can log new actions that aren't documented yet — this
  // syncs the dropdown so no action is invisible to filters.
  // Runs after every loadLogs; only applies to activity/security tabs
  // (client_error has a fixed 3-item list).
  function syncActionDropdown(allActions) {
    // Client errors and Errors tabs have small fixed lists — no auto-populate
    if (activeTab === 'client_error' || activeTab === 'errors') return;
    const sel = document.getElementById('f-action-select');
    if (!sel || sel.style.display === 'none') return; // security tab uses free-text
    const preserved = sel.value;
    // Determine which actions the dropdown already covers. For activity we use
    // ACTION_DEFS keys; also honour security-only overrides added elsewhere.
    const known = new Set(Object.keys(ACTION_LABELS));
    const missing = allActions.filter(a => a && !known.has(a) && a !== 'health_check').sort();
    // Remove any previously-appended "Other" optgroup so we don't stack them
    const oldOther = sel.querySelector('optgroup[data-og="other"]');
    if (oldOther) oldOther.remove();
    if (!missing.length) { sel.value = preserved; return; }
    const og = document.createElement('optgroup');
    og.label = 'Other (undocumented)';
    og.dataset.og = 'other';
    missing.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      og.appendChild(opt);
    });
    sel.appendChild(og);
    sel.value = preserved;
  }

  // Per-team breakdown (only rendered when viewing All Teams; empty otherwise so CSS hides it)
  function renderTeamsBar(counts, currentTeam) {
    const bar = document.getElementById('log-teams-bar');
    // Hide when scoped to a single team — no breakdown needed
    if (currentTeam) { bar.innerHTML = ''; return; }
    const entries = Object.entries(counts);
    if (!entries.length) { bar.innerHTML = ''; return; }
    // Sort by count desc, then slug asc
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const chips = entries.map(([slug, cnt]) =>
      `<span onclick="filterByTeam('${slug}')" style="cursor:pointer">${teamBadge(slug, cnt)}</span>`
    ).join('');
    bar.innerHTML = `<span class="log-filters-hint">Per team</span>${chips}`;
  }

  function filterByTeam(slug) {
    document.getElementById('f-team').value = slug;
    onTeamChange();
  }

  function renderStats(today, users, total, top) {
    const securityWarn  = activeTab === 'security'     && today > 0;
    const clientErrWarn = activeTab === 'client_error' && today > 0;
    const errorsWarn    = activeTab === 'errors'       && today > 0;
    document.getElementById('log-stats').innerHTML = `
      <div class="log-stat">
        <div class="log-stat-val" style="${securityWarn || clientErrWarn || errorsWarn ? 'color:var(--danger)' : ''}">${today}</div>
        <div class="log-stat-lbl">วันนี้</div>
      </div>
      <div class="log-stat">
        <div class="log-stat-val">${total}</div>
        <div class="log-stat-lbl">ทั้งหมด</div>
      </div>
      <div class="log-stat">
        <div class="log-stat-val">${users}</div>
        <div class="log-stat-lbl">Users ที่พบ</div>
      </div>
      ${Object.entries(top).slice(0,3).map(([a,c]) => {
        const meta  = CE_TYPE_META[a];
        const color = meta ? meta.color : getColor(a);
        const lbl   = meta ? escHtml(meta.label) : renderLabel(a);
        return `<div class="log-stat">
          <div class="log-stat-val" style="font-size:14px;color:${color}">${c}</div>
          <div class="log-stat-lbl">${lbl}</div>
        </div>`;
      }).join('')}`;
  }

  function renderTable(items) {
    const wrap    = document.getElementById('log-table-wrap');
    const isSec   = activeTab === 'security';
    const isErr   = activeTab === 'errors';
    const isCE    = activeTab === 'client_error';
    // Errors + Security both store data as 'event' in security.json
    const useEvent = isSec || isErr;

    if (!items.length) {
      wrap.innerHTML = '<div class="empty-state" style="padding:32px 0"><p>ไม่มี logs ที่ตรงกัน</p></div>';
      return;
    }

    if (isCE) {
      let lastDay = '';
      const rows = items.map((e, idx) => {
        const day = (e.ts || '').slice(0, 10);
        let sep = '';
        if (day && day !== lastDay) {
          lastDay = day;
          sep = `<tr class="log-day-sep"><td colspan="7">${escHtml(dayLabel(e.ts))}</td></tr>`;
        }
        const meta   = CE_TYPE_META[e.type] || { label: e.type, color: '#64748b' };
        const pageShort = e.page ? e.page.replace(/^https?:\/\/[^/]+/, '') : '—';
        const explain = LogExplainTH.get(e.type, e);
        return `${sep}<tr class="log-row-main" data-log-idx="${idx}" onclick="toggleExpandRow(${idx})">
          <td style="color:var(--text-muted);white-space:nowrap;font-size:10px">${formatThaiDateTime(e.ts)}</td>
          <td>${teamBadge(e._team)}</td>
          <td>
            <div style="font-size:12px;font-weight:600;color:var(--text)">${escHtml(e.user_name || '—')}</div>
            <div class="log-ip">${escHtml(e.user_id || '')}</div>
          </td>
          <td>
            <div class="log-action">
              <div class="log-dot" style="background:${meta.color}"></div>
              <span style="font-weight:600;color:${meta.color}">${escHtml(meta.label)}</span>
              <span class="expander">▶</span>
            </div>
            <div style="font-size:11px;color:var(--text);margin-top:2px;word-break:break-word">${escHtml(e.message || '—')}</div>
            <div class="log-explain-th${explain.matched ? '' : ' unknown'}">${escHtml(explain.short)}</div>
          </td>
          <td class="log-ip" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(e.page || '')}">${escHtml(pageShort)}</td>
          <td class="log-ip">${escHtml(e.ip || '—')}</td>
          <td class="log-ip" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(e.ua || '—')}</td>
        </tr>`;
      }).join('');

      wrap.innerHTML = `
        <table class="log-table">
          <thead><tr>
            <th>Timestamp</th><th>Team</th><th>User</th><th>Error</th><th>Page</th><th>IP</th><th>Browser</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      return;
    }

    let lastDay = '';
    const rows = items.map((e, idx) => {
      const day = (e.ts || '').slice(0, 10);
      let sep = '';
      if (day && day !== lastDay) {
        lastDay = day;
        sep = `<tr class="log-day-sep"><td colspan="6">${escHtml(dayLabel(e.ts))}</td></tr>`;
      }
      const action = useEvent ? e.event : e.action;
      const color  = getColor(action);
      const detail = e.detail && Object.keys(e.detail).length
        ? LogFormatter.format(action, e.detail) : '';
      const explain = LogExplainTH.get(action, e);
      const explainHtml = `<div class="log-explain-th${explain.matched ? '' : ' unknown'}">${escHtml(explain.short)}</div>`;

      return `${sep}<tr class="log-row-main" data-log-idx="${idx}" onclick="toggleExpandRow(${idx})">
        <td style="color:var(--text-muted);white-space:nowrap;font-size:10px">
          ${formatThaiDateTime(e.ts)}
        </td>
        <td>${teamBadge(e._team)}</td>
        <td>
          <div style="font-size:12px;font-weight:600;color:var(--text)">${escHtml(e.user_name || '—')}</div>
          <div class="log-ip">${escHtml(e.user_id || '')}</div>
        </td>
        <td>
          <div class="log-action">
            <div class="log-dot" style="background:${color}"></div>
            <span style="font-weight:600;color:${color}">${renderLabel(action)}</span>
            <span class="expander">▶</span>
          </div>
          ${explainHtml}
          ${detail}
        </td>
        <td class="log-ip">${escHtml(e.ip || '—')}</td>
        <td class="log-ip" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(e.ua || '—')}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="log-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Team</th>
            <th>User</th>
            <th>${isErr ? 'Error Event' : (isSec ? 'Security Event' : 'Action')}</th>
            <th>IP</th>
            <th>Browser</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderPagination(total) {
    const pg   = document.getElementById('log-pagination');
    const info = document.getElementById('pg-info');
    const prev = document.getElementById('pg-prev');
    const next = document.getElementById('pg-next');
    const totalPages = Math.ceil(total / PAGE_SIZE);

    if (totalPages <= 1) { pg.style.display = 'none'; return; }
    pg.style.display = 'flex';
    info.textContent = `หน้า ${currentPage + 1} / ${totalPages}  (${total} รายการ)`;
    prev.disabled = currentPage === 0;
    next.disabled = currentPage >= totalPages - 1;
  }

  function prevPage() { if (currentPage > 0) { currentPage--; loadLogs(); } }
  function nextPage() { currentPage++; loadLogs(); }

  function clearFilters() {
    ['f-search','f-user','f-action','f-date','f-date-to'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('f-action-select').value = '';
    document.getElementById('f-team').value = '';
    currentPage = 0;
    loadLogs();
  }

  // Auto-refresh
  document.getElementById('auto-refresh-toggle').addEventListener('change', (e) => {
    const dot = document.getElementById('rf-dot');
    if (e.target.checked) {
      dot.style.display = 'inline-block';
      autoRefreshTimer = setInterval(loadLogs, 15000);
    } else {
      dot.style.display = 'none';
      clearInterval(autoRefreshTimer);
    }
  });

  // Live Tail — polls first page every 5s and highlights newer rows with a
  // green flash. Pauses on hidden tab so background tabs don't hammer the API.
  document.getElementById('tail-mode-toggle').addEventListener('change', (e) => {
    const dot = document.getElementById('tail-dot');
    if (e.target.checked) {
      dot.style.display = 'inline-block';
      currentPage = 0;
      tailTimer = setInterval(() => {
        if (document.hidden) return;
        loadLogs({ silent: true, tail: true });
      }, 5000);
    } else {
      dot.style.display = 'none';
      clearInterval(tailTimer);
      tailTimer = null;
    }
  });

  // Export — fetch matching rows (respects all current filters) and trigger
  // client-side download. Server caps at 5000 rows and flags truncation.
  async function exportLogs(format) {
    const params = buildParams({ export: '1', limit: 5000, offset: 0 });
    Toast?.show?.('กำลังเตรียม export…', 'info', 1500);
    const res = await API.logs.query(params);
    if (!res?.ok) { Toast?.show?.('Export failed', 'error'); return; }
    const items = res.data.data.items || [];
    const truncated = res.data.data.export_truncated;
    if (!items.length) { Toast?.show?.('ไม่มีรายการที่ตรงกัน', 'warning'); return; }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `logs_${activeTab}_${stamp}.${format}`;
    let blob;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    } else {
      blob = new Blob([toCsv(items)], { type: 'text/csv;charset=utf-8' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; document.body.appendChild(a);
    a.click(); a.remove();
    URL.revokeObjectURL(url);
    Toast?.show?.(
      `ดาวน์โหลด ${items.length} รายการ` + (truncated ? ' (ตัดที่ 5000 rows)' : ''),
      truncated ? 'warning' : 'success'
    );
  }

  function toCsv(rows) {
    // Union of keys across all rows — logs are heterogenous (activity vs
    // security vs client_error), so a fixed schema would drop columns.
    const keys = Array.from(rows.reduce((acc, r) => {
      Object.keys(r).forEach(k => acc.add(k));
      return acc;
    }, new Set()));
    const esc = v => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = keys.join(',');
    const body = rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
    return '﻿' + header + '\n' + body;  // BOM so Excel opens UTF-8 correctly
  }

  const debouncedLoad = debounce(() => { currentPage = 0; loadLogs(); }, 350);

  // ── Advanced search parser: user:x action:y team:z rest… ────────────────
  // Splits the search box into structured params + leftover free-text.
  // Known keys: user, action, team. Unknown key:value tokens are kept as-is
  // in the free-text (so `ip:1.2.3.4` still matches via full-text search).
  function parseSearch(raw) {
    const out = { user: '', action: '', team: '', rest: '' };
    if (!raw) return out;
    const tokens = raw.split(/\s+/);
    const leftover = [];
    for (const tok of tokens) {
      const m = tok.match(/^(user|action|team):(.+)$/i);
      if (m) { out[m[1].toLowerCase()] = m[2]; }
      else   { leftover.push(tok); }
    }
    out.rest = leftover.join(' ').trim();
    return out;
  }

  // ── Saved filter presets (localStorage) ─────────────────────────────────
  function getPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); }
    catch { return []; }
  }
  function setPresets(list) {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  }

  function savePreset() {
    const name = prompt('ตั้งชื่อ preset สำหรับ filter ปัจจุบัน:', '');
    if (!name) return;
    const snap = {
      name: name.trim().slice(0, 40),
      tab:    activeTab,
      team:   document.getElementById('f-team').value,
      search: document.getElementById('f-search').value,
      user:   document.getElementById('f-user').value,
      action_select: document.getElementById('f-action-select').value,
      action_text:   document.getElementById('f-action').value,
      date:    document.getElementById('f-date').value,
      date_to: document.getElementById('f-date-to').value,
    };
    const presets = getPresets().filter(p => p.name !== snap.name);
    presets.unshift(snap);
    setPresets(presets.slice(0, 12));
    renderPresets();
    Toast?.show?.('บันทึก preset "' + snap.name + '" แล้ว', 'success');
  }

  function applyPreset(name) {
    const p = getPresets().find(x => x.name === name);
    if (!p) return;
    if (p.tab && p.tab !== activeTab) {
      switchTab(p.tab);
      // switchTab calls loadLogs asynchronously; defer field-setting until DOM settles
      setTimeout(() => applyPresetFields(p), 30);
      return;
    }
    applyPresetFields(p);
  }
  function applyPresetFields(p) {
    document.getElementById('f-team').value        = p.team || '';
    document.getElementById('f-search').value      = p.search || '';
    document.getElementById('f-user').value        = p.user || '';
    document.getElementById('f-action-select').value = p.action_select || '';
    document.getElementById('f-action').value      = p.action_text || '';
    document.getElementById('f-date').value        = p.date || '';
    document.getElementById('f-date-to').value     = p.date_to || '';
    currentPage = 0;
    loadLogs();
  }

  function deletePreset(name, ev) {
    ev.stopPropagation();
    if (!confirm('ลบ preset "' + name + '" ?')) return;
    setPresets(getPresets().filter(p => p.name !== name));
    renderPresets();
  }

  function renderPresets() {
    const box = document.getElementById('log-presets');
    const list = getPresets();
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<span class="log-filters-hint">Presets</span>' + list.map(p =>
      `<span class="log-preset-chip" onclick="applyPreset('${escHtml(p.name).replace(/'/g,"\\'")}')">
         <i data-icon="star"></i> ${escHtml(p.name)}
         <span class="rm" onclick="deletePreset('${escHtml(p.name).replace(/'/g,"\\'")}', event)" title="Delete">×</span>
       </span>`).join('');
    if (window.Icons?.render) window.Icons.render(box);
  }

  // Init: load team roster first (populates the dropdown + colour map), then
  // render the default Activity tab.
  (async () => {
    await loadTeamsForFilter();
    renderPresets();
    switchTab('activity');
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyPreset", { configurable: true, get: () => applyPreset, set: (v) => { applyPreset = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyPresetFields", { configurable: true, get: () => applyPresetFields, set: (v) => { applyPresetFields = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deletePreset", { configurable: true, get: () => deletePreset, set: (v) => { deletePreset = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getPresets", { configurable: true, get: () => getPresets, set: (v) => { getPresets = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "parseSearch", { configurable: true, get: () => parseSearch, set: (v) => { parseSearch = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPresets", { configurable: true, get: () => renderPresets, set: (v) => { renderPresets = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "savePreset", { configurable: true, get: () => savePreset, set: (v) => { savePreset = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setPresets", { configurable: true, get: () => setPresets, set: (v) => { setPresets = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildParams", { configurable: true, get: () => buildParams, set: (v) => { buildParams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearFilters", { configurable: true, get: () => clearFilters, set: (v) => { clearFilters = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyToClipboard", { configurable: true, get: () => copyToClipboard, set: (v) => { copyToClipboard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dayLabel", { configurable: true, get: () => dayLabel, set: (v) => { dayLabel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportLogs", { configurable: true, get: () => exportLogs, set: (v) => { exportLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterByTeam", { configurable: true, get: () => filterByTeam, set: (v) => { filterByTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatThaiDateTime", { configurable: true, get: () => formatThaiDateTime, set: (v) => { formatThaiDateTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getColor", { configurable: true, get: () => getColor, set: (v) => { getColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getLabel", { configurable: true, get: () => getLabel, set: (v) => { getLabel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "highlightJson", { configurable: true, get: () => highlightJson, set: (v) => { highlightJson = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLogs", { configurable: true, get: () => loadLogs, set: (v) => { loadLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadTeamsForFilter", { configurable: true, get: () => loadTeamsForFilter, set: (v) => { loadTeamsForFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "nextPage", { configurable: true, get: () => nextPage, set: (v) => { nextPage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onTeamChange", { configurable: true, get: () => onTeamChange, set: (v) => { onTeamChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "prevPage", { configurable: true, get: () => prevPage, set: (v) => { prevPage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderLabel", { configurable: true, get: () => renderLabel, set: (v) => { renderLabel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPagination", { configurable: true, get: () => renderPagination, set: (v) => { renderPagination = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSparkline", { configurable: true, get: () => renderSparkline, set: (v) => { renderSparkline = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTeamsBar", { configurable: true, get: () => renderTeamsBar, set: (v) => { renderTeamsBar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncActionDropdown", { configurable: true, get: () => syncActionDropdown, set: (v) => { syncActionDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "teamBadge", { configurable: true, get: () => teamBadge, set: (v) => { teamBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toCsv", { configurable: true, get: () => toCsv, set: (v) => { toCsv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleExpandRow", { configurable: true, get: () => toggleExpandRow, set: (v) => { toggleExpandRow = v; } }); } catch (e) {}
})();
