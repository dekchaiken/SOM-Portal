/* ══════════════════════════════════════════════════════════
   Incident Launcher — Page JS
   ══════════════════════════════════════════════════════════ */

/* jshint esversion:8 */
Auth.requireAuth();
Layout.render('incident-launcher');

const IL = (() => {

  // ── State ──────────────────────────────────────────────
  let _mode     = 'guided';
  let _severity = 'sev1';
  let _partners = [];
  let _config   = { chat_webhook_url: '', default_partners: [], jira_issue_type: 'Monitoring', channels: [], ma_jobs: [] };
  const HISTORY_KEY = 'il_history_v1';

  // Task statuses
  const _taskState = {};

  // Channel state: id → { alertSent, resolvedSent, alertTime }
  const _chState = {};

  // Last Jira ticket from Jira task result
  let _lastTicket = '';

  // MA state: id → { done, timestamp }
  const _maState = {};

  // Jenkins modal state
  let _currentJenkinsJob = null;

  // Timeline entries
  const _timeline = [];

  const PLATFORM_ICONS = { googlechat: 'message-square', line: 'message-circle', dingtalk: 'bell', manual: 'clipboard' };
  const PLATFORM_LABELS = { googlechat: 'Google Chat', line: 'LINE Notify', dingtalk: 'DingTalk', manual: 'Manual (Copy)' };

  // ── Task Definitions ────────────────────────────────────
  const TASKS = [
    {
      id: 'board',
      icon: 'layout',
      label: 'Post Board Announcement',
      desc: 'สร้าง post ใน SOM board แจ้งทีมทราบ',
      group: 'phase1',
      async execute(incident) {
        const statusTag = `<strong>[${incident.severity.toUpperCase()}]</strong>`;
        const body = [
          `${statusTag} พบปัญหา: ${incident.title}`,
          '',
          `Service: ${incident.service || '-'}`,
          `เวลาเริ่มต้น: ${incident.time || '-'}`,
          `Reported by: ${incident.reporter || '-'}`,
          '',
          incident.description || '',
        ].join('\n').trim();

        const r = await API.board.create({
          title: `[INCIDENT ${incident.severity.toUpperCase()}] ${incident.title}`,
          content: body,
          status: 'open',
          is_pinned: incident.severity === 'sev1' ? 1 : 0,
        });
        return { ok: true, detail: `Post ID: ${r.id || r.data?.id || '—'}` };
      },
    },
    {
      id: 'jira',
      icon: 'ticket',
      label: 'Create Jira Ticket',
      desc: 'เปิด Jira ticket ระดับ ' + '—',
      descFn: (inc) => `เปิด Jira ticket ระดับ ${inc.severity.toUpperCase()}`,
      group: 'phase1',
      async execute(incident) {
        const sevLabel = { sev1: 'Sev1 / Critical', sev2: 'Sev2 / Major', sev3: 'Sev3 / Minor' }[incident.severity] || incident.severity;
        // Use jira_summary from template if set, else default format
        const tpl = (_config.templates || []).find(t => document.querySelector(`.il-tpl-chip.active[onclick*="${t.id}"]`));
        const summaryTpl = tpl?.jira_summary || '';
        const summary = summaryTpl
          ? summaryTpl
              .replace(/\$\{severity\}/gi, sevLabel.split(' / ')[0].toUpperCase())
              .replace(/\$\{service\}/gi, incident.service || '-')
              .replace(/\$\{title\}/gi, incident.title)
          : `[${sevLabel.split(' / ')[0].toUpperCase()}] ${incident.title}`;
        const desc = [
          `Service: ${incident.service || '-'}`,
          `Severity: ${sevLabel}`,
          `เวลาเริ่มต้น: ${incident.time || '-'}`,
          `Reported by: ${incident.reporter || '-'}`,
          '',
          incident.description || '',
        ].join('\n');

        // Build extra fields from jira_preset_fields config
        const extraFields = {};
        (_config.jira_preset_fields || []).forEach(f => {
          if (f.field_id && f.value) extraFields[f.field_id] = f.value;
        });
        // Always set fault_start if we have a fault_start field configured
        if (_config.jira_fault_start_field_id && incident.time) {
          extraFields[_config.jira_fault_start_field_id] = incident.time;
        }

        const r = await API.jira.createTicket({
          summary,
          description: desc,
          fields: { issuetype: _config.jira_issue_type || 'Monitoring', ...extraFields },
        });
        // respondOk(['issue_key'=>...]) → r.data = {success,message,data:{issue_key,url}}
        const key = r?.data?.data?.issue_key || r?.data?.data?.key || r?.data?.key || '';
        if (key) {
          _lastTicket = key;
          _refreshChannelTemplates();
          _timelineAdd('ticket', `Jira ticket สร้างแล้ว: ${key}`);
          // Update escalate modal link
          const escLink = document.getElementById('il-esc-jira-link');
          if (escLink) { escLink.href = `https://truemoney.atlassian.net/browse/${key}`; escLink.style.display = ''; }
        }
        const url = key ? `https://truemoney.atlassian.net/browse/${key}` : null;
        return { ok: true, detail: key ? `Ticket: ${key}` : 'สร้างสำเร็จ', link: url, linkLabel: key };
      },
    },
    {
      id: 'escalate',
      icon: 'arrow-up-circle',
      label: 'Escalate as Incident',
      desc: 'กรอกข้อมูล Escalate ใน Jira อย่างเป็นทางการ',
      group: 'phase1',
      expressSkip: true,  // modal task — skip in Express, do manually in Guided
      async execute(incident) {
        if (!_lastTicket) {
          return { ok: false, skip: true, detail: 'ยังไม่มี Jira ticket — รัน "Create Jira Ticket" ก่อน' };
        }
        openEscalate(incident);
        return { ok: true, detail: `กรอก Escalate form สำหรับ ${_lastTicket}` };
      },
    },
    {
      id: 'impact',
      icon: 'bar-chart-2',
      label: 'Generate Impact Summary',
      desc: 'Query Prometheus ดู services ที่กระทบช่วง incident พร้อม Grafana links',
      group: 'phase2',
      expressSkip: true,  // modal task — skip in Express
      async execute(incident) {
        await openImpact(incident);
        return { ok: true, detail: 'เปิด Impact Summary — ดูรายละเอียดใน modal' };
      },
    },
    {
      id: 'meet',
      icon: 'video',
      label: 'Open War Room (Google Meet)',
      desc: 'เปิด Google Meet room สำหรับ War Room',
      group: 'phase1',
      isLink: true,
      async execute(incident) {
        window.open('https://meet.google.com/new', '_blank', 'noopener');
        return { ok: true, detail: 'เปิด Google Meet ในหน้าต่างใหม่ — copy link แล้วส่งทีม' };
      },
    },
    {
      id: 'gchat',
      icon: 'message-square',
      label: 'Notify Google Chat',
      desc: 'ส่ง notification ไปยัง Google Chat space',
      group: 'phase2',
      async execute(incident) {
        const webhookUrl = document.getElementById('il-chat-url')?.value?.trim() || _config.chat_webhook_url;
        if (!webhookUrl) {
          return { ok: false, skip: true, detail: 'ไม่มี Webhook URL — ตั้งค่าที่ปุ่ม "ตั้งค่า" ด้านบน' };
        }
        const sevEmoji = { sev1: '🔴', sev2: '🟠', sev3: '🔵' }[incident.severity] || '⚪';
        const text = [
          `${sevEmoji} *[INCIDENT ${incident.severity.toUpperCase()}] ${incident.title}*`,
          ``,
          `📌 Service: ${incident.service || '-'}`,
          `🕐 เวลาเริ่มต้น: ${incident.time || '-'}`,
          `👤 Reported by: ${incident.reporter || '-'}`,
          ``,
          incident.description ? `📋 ${incident.description}` : '',
          ``,
          `🚨 War Room กำลังถูกจัดตั้ง — โปรดรอ link จาก SM Team`,
        ].filter(l => l !== undefined).join('\n');

        await API.post('/incident-launcher/index.php', {
          action: 'webhook',
          url: webhookUrl,
          text,
        });
        return { ok: true, detail: 'ส่ง notification ไปยัง Google Chat สำเร็จ' };
      },
    },
    {
      id: 'email',
      icon: 'mail',
      label: 'Email Partners',
      desc: 'ส่ง email แจ้ง partner ที่ได้รับผลกระทบ',
      group: 'phase2',
      async execute(incident) {
        const recipients = [..._partners, ...(_config.default_partners || [])];
        const uniqueTo = [...new Set(recipients.filter(e => e && e.includes('@')))];
        if (!uniqueTo.length) {
          return { ok: false, skip: true, detail: 'ไม่มี partner email — เพิ่ม email ในฟอร์มก่อน' };
        }
        const sevLabel = { sev1: 'Critical (Sev1)', sev2: 'Major (Sev2)', sev3: 'Minor (Sev3)' }[incident.severity] || incident.severity;
        const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        const htmlBody = `
<div style="font-family:sans-serif;max-width:600px">
  <div style="background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:16px">
    [INCIDENT ${incident.severity.toUpperCase()}] ${incident.title}
  </div>
  <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:6px 0;color:#6b7280;width:140px">Severity</td><td style="padding:6px 0;font-weight:600">${sevLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Service affected</td><td style="padding:6px 0">${incident.service || '-'}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Time detected</td><td style="padding:6px 0">${incident.time || '-'}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Reported by</td><td style="padding:6px 0">${incident.reporter || '-'}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Notified at</td><td style="padding:6px 0">${now}</td></tr>
    </table>
    ${incident.description ? `<hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb">
    <div style="font-size:13px;color:#374151;white-space:pre-wrap">${incident.description}</div>` : ''}
    <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb">
    <p style="font-size:12px;color:#9ca3af;margin:0">
      This notification was sent automatically by SOM-Portal Incident Launcher.<br>
      Please do not reply directly to this email.
    </p>
  </div>
</div>`;

        await API.post('/mail/send.php', {
          to: uniqueTo,
          subject: `[INCIDENT ${incident.severity.toUpperCase()}] ${incident.title}`,
          body: htmlBody,
          isHtml: true,
        });
        return { ok: true, detail: `ส่ง email ไปยัง ${uniqueTo.length} recipient สำเร็จ` };
      },
    },
  ];

  // ── Init ──────────────────────────────────────────────
  async function init() {
    _setDefaultTime();
    _initTagInput();
    await _loadConfig();
    _prefillReporter();

    document.getElementById('il-partner-input')?.addEventListener('keydown', _onTagKey);

    // Auto-enter ready state — wizard replaces Guided/Express mode picker
    const ilRoot  = document.querySelector('.il');
    const modeRow = document.getElementById('il-mode-row');
    const layout  = document.getElementById('il-layout');
    if (modeRow) modeRow.style.display = 'none';
    if (ilRoot)  ilRoot.classList.add('il-ready');
    if (layout)  { layout.style.removeProperty('display'); layout.classList.add('il-layout--entering', 'il-layout--visible'); }

    // Legacy launch button (hidden in new UI, kept for compat)
    document.getElementById('il-wizard-launch-btn')?.addEventListener('click', openWizard);
  }

  function _setDefaultTime() {
    const el = document.getElementById('il-time');
    if (!el) return;
    const now = new Date();
    // Round down to current minute
    now.setSeconds(0, 0);
    el.value = now.toISOString().slice(0, 16);
  }

  async function _prefillReporter() {
    try {
      const me = Auth.getUser();
      if (me?.name) document.getElementById('il-reporter').value = me.name;
    } catch (_) {}
  }

  async function _loadConfig() {
    try {
      const r = await API.get('/incident-launcher/index.php?action=config');
      const cfg = r?.data?.config;
      if (cfg) _config = { ..._config, ...cfg };
    } catch (_) { /* no config yet, use defaults */ }
    _config.channels = _config.channels || [];

    _renderTemplatePicker();
    _renderPartnerGroups();
    _renderQuickLinks();
    _showAdminButtons();
    _renderChannelCards();
    _renderMaSection();
    _renderCasePicker();
  }

  // ── Case Picker ───────────────────────────────────────

  function _renderCasePicker() {
    const grid = document.getElementById('il-case-grid');
    if (!grid) return;
    const cases = _config.cases || [];
    const ADMIN_ROLES = ['sm_admin', 'dev_sm', 'sm_lead'];
    const user = Auth.getUser?.() || JSON.parse(localStorage.getItem('som_user') || '{}');
    const isAdmin = ADMIN_ROLES.includes(user?.role);

    const SEV_LABEL = { sev1: 'SEV 1', sev2: 'SEV 2', sev3: 'SEV 3' };

    if (!cases.length) {
      const emptyHtml = isAdmin
        ? `<div class="il-case-empty">
             <i data-icon="layers"></i>
             ยังไม่มี Incident Case
             <a href="admin/incident-launcher-config.html#cases" class="il-cp-admin-hint" style="margin-top:12px">
               <i data-icon="plus"></i> เพิ่ม Case แรกที่ Admin Config
             </a>
           </div>`
        : `<div class="il-case-empty">
             <i data-icon="layers"></i>
             ยังไม่มี Incident Case — ติดต่อ Admin เพื่อตั้งค่า
           </div>`;
      grid.innerHTML = emptyHtml;
      if (window.Icons) Icons.replaceAll(grid);
      return;
    }

    const casesHtml = cases.map(c => {
      const clr      = c.color || '#6366f1';
      const sev      = c.default_severity || 'sev1';
      const maCount  = (c.ma_job_ids         || []).length;
      const chCount  = (c.channel_ids        || []).length;
      const grpCount = (c.partner_group_ids  || []).length;
      const spCount  = (c.sp_services        || []).length;
      const hasCfg   = maCount || chCount || grpCount || spCount;
      return `
      <div class="il-case-card" style="--case-clr:${_escAttr(clr)}"
           onclick="IL.launchWithCase('${_escAttr(c.id)}')" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')IL.launchWithCase('${_escAttr(c.id)}')">
        <span class="il-case-sev il-case-sev--${_escAttr(sev)}">${_escHtml(SEV_LABEL[sev] || sev)}</span>
        <div class="il-case-body">
          <div class="il-case-icon-wrap">
            <i data-icon="${_escAttr(c.icon || 'zap')}"></i>
          </div>
          <div class="il-case-info">
            <div class="il-case-name">${_escHtml(c.name)}</div>
            ${c.description ? `<div class="il-case-desc">${_escHtml(c.description)}</div>` : ''}
            ${c.default_service ? `<div class="il-case-svc">${_escHtml(c.default_service)}</div>` : ''}
          </div>
          <div class="il-case-arrow"><i data-icon="arrow-right"></i></div>
        </div>
        ${hasCfg ? `<div class="il-case-footer">
          ${maCount  ? `<span class="il-case-badge"><i data-icon="zap"></i> ${maCount} MA</span>` : ''}
          ${chCount  ? `<span class="il-case-badge"><i data-icon="send"></i> ${chCount} CH</span>` : ''}
          ${grpCount ? `<span class="il-case-badge"><i data-icon="users"></i> ${grpCount} GRP</span>` : ''}
          ${spCount  ? `<span class="il-case-badge"><i data-icon="activity"></i> ${spCount} SP</span>` : ''}
        </div>` : ''}
      </div>`;
    }).join('');

    const adminHintHtml = isAdmin ? `
      <a href="admin/incident-launcher-config.html#cases" class="il-cp-admin-hint">
        <i data-icon="plus"></i> เพิ่ม Case ใหม่ที่ Admin Config → Cases
      </a>` : '';

    grid.innerHTML = casesHtml + adminHintHtml;
    if (window.Icons) Icons.replaceAll(grid);
  }

  function launchWithCase(caseId) {
    const c = (_config.cases || []).find(x => x.id === caseId);
    if (!c) { launchCustom(); return; }

    // Build filtered config for this case
    const filtered = { ..._config };

    if (c.ma_job_ids?.length) {
      const ids = new Set(c.ma_job_ids);
      filtered.ma_jobs = (_config.ma_jobs || []).filter(j => ids.has(j.id));
    }
    if (c.channel_ids?.length) {
      const ids = new Set(c.channel_ids);
      filtered.channels = (_config.channels || []).filter(ch => ids.has(ch.id));
    }
    if (c.partner_group_ids?.length) {
      const ids = new Set(c.partner_group_ids);
      filtered.partner_groups = (_config.partner_groups || []).filter(g => ids.has(g.id));
    }
    if (c.sp_services?.length) {
      filtered.sp_services = c.sp_services;
    }

    const inc = {
      title:       c.default_title    || '',
      service:     c.default_service  || '',
      severity:    c.default_severity || 'sev1',
      time:        new Date().toISOString().slice(0, 16),
      reporter:    '',
      description: '',
      partners:    [],
    };

    const el = document.getElementById('ilw');
    if (!el) { console.error('[IL] #ilw not found'); return; }
    el.style.display = 'flex';
    ILW.open(inc, filtered, c);
  }

  function launchCustom() {
    window._ilwLaunch();
  }

  function _getConfig() { return _config; }

  function _showAdminButtons() {
    const ADMIN_ROLES = ['sm_admin', 'dev_sm', 'sm_lead'];
    const user = Auth.getUser?.() || JSON.parse(localStorage.getItem('som_user') || '{}');
    const isAdmin = ADMIN_ROLES.includes(user?.role);
    const cfgBtn = document.getElementById('il-config-btn');
    if (cfgBtn) cfgBtn.style.display = isAdmin ? '' : 'none';
    const manageBtn = document.getElementById('il-template-manage');
    if (manageBtn) manageBtn.style.display = isAdmin ? '' : 'none';
  }

  function _renderTemplatePicker() {
    const bar = document.getElementById('il-template-bar');
    const chips = document.getElementById('il-template-chips');
    if (!bar || !chips) return;
    const templates = _config.templates || [];
    if (!templates.length) { bar.style.display = 'none'; return; }

    bar.style.display = 'flex';
    chips.innerHTML = templates.map(t => `
      <button type="button" class="il-tpl-chip" onclick="IL._applyTemplate('${_escAttr(t.id)}')"
              style="--tpl-color:${t.color || '#6366f1'}">
        <i data-icon="${t.icon || 'zap'}"></i>
        <span>${_escHtml(t.name)}</span>
      </button>`).join('');
    if (window.Icons) Icons.process(chips);
  }

  function _applyTemplate(tplId) {
    const t = (_config.templates || []).find(x => x.id === tplId);
    if (!t) return;
    if (t.service)      document.getElementById('il-service').value = t.service;
    if (t.description)  document.getElementById('il-desc').value    = t.description;
    if (t.severity)     setSev(t.severity);

    // Apply partner groups from template
    if (t.partner_group_ids?.length) {
      t.partner_group_ids.forEach(gid => {
        const grp = (_config.partner_groups || []).find(g => g.id === gid);
        if (grp) grp.emails?.forEach(e => _addTag(e));
      });
    }

    // Highlight selected chip
    document.querySelectorAll('.il-tpl-chip').forEach(b => b.classList.remove('active'));
    document.querySelector(`.il-tpl-chip[onclick*="${tplId}"]`)?.classList.add('active');

    window.showToast?.(`ใช้ template: ${t.name}`, 'success');
  }

  function _renderPartnerGroups() {
    const wrap = document.getElementById('il-partner-groups');
    if (!wrap) return;
    const groups = _config.partner_groups || [];
    if (!groups.length) { wrap.style.display = 'none'; return; }

    wrap.style.display = 'flex';
    wrap.innerHTML = `<span class="il-partner-groups-label">Groups:</span>` +
      groups.map(g => `
        <button type="button" class="il-grp-btn" onclick="IL._toggleGroup('${_escAttr(g.id)}')"
                id="il-grp-${_escAttr(g.id)}"
                style="--grp-color:${g.color || '#3b82f6'}">
          <span class="il-grp-dot"></span>
          ${_escHtml(g.name)}
          <span class="il-grp-count">(${(g.emails||[]).length})</span>
        </button>`).join('');
  }

  const _activeGroups = new Set();

  function _toggleGroup(gid) {
    const grp = (_config.partner_groups || []).find(g => g.id === gid);
    if (!grp) return;
    const btn = document.getElementById(`il-grp-${gid}`);

    if (_activeGroups.has(gid)) {
      // Remove emails of this group
      _activeGroups.delete(gid);
      grp.emails?.forEach(e => _removeTag(e));
      btn?.classList.remove('active');
    } else {
      // Add emails of this group
      _activeGroups.add(gid);
      grp.emails?.forEach(e => _addTag(e));
      btn?.classList.add('active');
    }
  }

  function _renderQuickLinks() {
    const grid = document.getElementById('il-quick-links-grid');
    if (!grid) return;
    const links = _config.quick_links || [];
    if (!links.length) return; // keep defaults in HTML

    grid.innerHTML = links.map(l => `
      <a class="il-qlink" href="${_escHtml(l.url)}" target="_blank" rel="noopener">
        <i data-icon="${l.icon || 'link'}"></i> ${_escHtml(l.label)}
      </a>`).join('');
    if (window.Icons) Icons.process(grid);
  }

  function _escAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // ── Channel Notifications ─────────────────────────────

  function _fillTemplate(tpl, extra = {}) {
    const inc  = _collectIncident() || {};
    const vars = {
      severity:      (inc.severity || _severity || 'sev1').toUpperCase(),
      title:         inc.title        || '(ยังไม่ระบุ)',
      service:       inc.service      || '-',
      time:          inc.time         || '-',
      reporter:      inc.reporter     || '-',
      description:   inc.description  || '-',
      ticket:        _lastTicket      || '(รอ Jira ticket)',
      resolved_time: extra.resolved_time || new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    };
    return (tpl || '').replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? `\${${k}}`);
  }

  function _renderChannelCards() {
    const section = document.getElementById('il-channel-section');
    const cards   = document.getElementById('il-channel-cards');
    const channels = _config.channels || [];
    if (!channels.length || !section) return;

    section.style.display = '';
    cards.innerHTML = channels.map(ch => {
      const icon  = PLATFORM_ICONS[ch.platform]  || 'send';
      const label = PLATFORM_LABELS[ch.platform] || ch.platform;
      const isManual = ch.platform === 'manual';
      const alertText = _fillTemplate(ch.template_alert);
      return `
      <div class="il-ch-card" id="il-ch-${_escAttr(ch.id)}">
        <div class="il-ch-card-header">
          <div class="il-ch-icon il-ch-icon--${ch.platform}"><i data-icon="${icon}"></i></div>
          <div class="il-ch-meta">
            <div class="il-ch-name">${_escHtml(ch.name)}</div>
            <div class="il-ch-platform-lbl">${label}</div>
          </div>
          <div class="il-ch-status-badge" id="il-ch-badge-${_escAttr(ch.id)}">ยังไม่ส่ง</div>
        </div>
        <div class="il-ch-msg-tabs">
          <button type="button" class="il-ch-tab active" onclick="IL._chShowTab('${_escAttr(ch.id)}','alert')" id="il-ch-tab-alert-${_escAttr(ch.id)}">
            <i data-icon="alert-triangle"></i> แจ้งปัญหา
          </button>
          <button type="button" class="il-ch-tab" onclick="IL._chShowTab('${_escAttr(ch.id)}','resolved')" id="il-ch-tab-resolved-${_escAttr(ch.id)}">
            <i data-icon="check-circle"></i> กลับปกติ
          </button>
        </div>
        <div id="il-ch-pane-alert-${_escAttr(ch.id)}">
          <textarea class="il-ch-textarea" id="il-ch-alert-${_escAttr(ch.id)}" rows="5">${_escHtml(alertText)}</textarea>
          <div class="il-ch-actions">
            ${isManual ? '' : `<button type="button" class="il-ch-btn-send" id="il-ch-sendbtn-${_escAttr(ch.id)}" onclick="IL.sendChannel('${_escAttr(ch.id)}','alert')"><i data-icon="send"></i> ส่ง</button>`}
            <button type="button" class="il-ch-btn-copy" onclick="IL.copyChannel('${_escAttr(ch.id)}','alert')"><i data-icon="copy"></i> Copy</button>
            <button type="button" class="il-ch-btn-refresh" onclick="IL._chRefreshText('${_escAttr(ch.id)}','alert')" title="Re-fill จาก template"><i data-icon="rotate-ccw"></i></button>
          </div>
        </div>
        <div id="il-ch-pane-resolved-${_escAttr(ch.id)}" style="display:none">
          <textarea class="il-ch-textarea" id="il-ch-resolved-${_escAttr(ch.id)}" rows="4">${_escHtml(_fillTemplate(ch.template_resolved))}</textarea>
          <div class="il-ch-actions">
            ${isManual ? '' : `<button type="button" class="il-ch-btn-send il-ch-btn-send--resolved" id="il-ch-resolvedbtn-${_escAttr(ch.id)}" onclick="IL.sendChannel('${_escAttr(ch.id)}','resolved')"><i data-icon="check-circle"></i> ส่ง Resolved</button>`}
            <button type="button" class="il-ch-btn-copy" onclick="IL.copyChannel('${_escAttr(ch.id)}','resolved')"><i data-icon="copy"></i> Copy</button>
            <button type="button" class="il-ch-btn-refresh" onclick="IL._chRefreshText('${_escAttr(ch.id)}','resolved')" title="Re-fill จาก template"><i data-icon="rotate-ccw"></i></button>
          </div>
        </div>
      </div>`;
    }).join('');
    if (window.Icons) Icons.replaceAll(cards);
  }

  function _refreshChannelTemplates() {
    (_config.channels || []).forEach(ch => {
      _chRefreshText(ch.id, 'alert');
      _chRefreshText(ch.id, 'resolved');
    });
  }

  function _chRefreshText(chId, type) {
    const ch = (_config.channels || []).find(c => c.id === chId);
    if (!ch) return;
    const el = document.getElementById(`il-ch-${type}-${chId}`);
    if (el) el.value = _fillTemplate(type === 'alert' ? ch.template_alert : ch.template_resolved);
  }

  function _chShowTab(chId, type) {
    document.getElementById(`il-ch-pane-alert-${chId}`).style.display    = type === 'alert'    ? '' : 'none';
    document.getElementById(`il-ch-pane-resolved-${chId}`).style.display = type === 'resolved' ? '' : 'none';
    document.getElementById(`il-ch-tab-alert-${chId}`).classList.toggle('active', type === 'alert');
    document.getElementById(`il-ch-tab-resolved-${chId}`).classList.toggle('active', type === 'resolved');
  }

  async function sendChannel(chId, type = 'alert') {
    const ch = (_config.channels || []).find(c => c.id === chId);
    if (!ch) return;
    const textarea = document.getElementById(`il-ch-${type}-${chId}`);
    const message  = textarea?.value?.trim();
    if (!message) { window.showToast?.('ข้อความว่างเปล่า', 'error'); return; }

    const btn = document.getElementById(type === 'alert' ? `il-ch-sendbtn-${chId}` : `il-ch-resolvedbtn-${chId}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> กำลังส่ง…'; if (window.Icons) Icons.replaceAll(btn); }

    try {
      await API.post('/incident-launcher/index.php', { action: 'notify_channel', channel_id: chId, message });
      _chSetSent(chId, type);
      _timelineAdd('send', `ส่ง${type === 'alert' ? 'แจ้งปัญหา' : 'กลับปกติ'}: ${ch.name}`);
      window.showToast?.(`ส่งไปยัง ${ch.name} สำเร็จ`, 'success');
    } catch (e) {
      window.showToast?.(`ส่ง ${ch.name} ไม่สำเร็จ: ${e?.message || 'error'}`, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<i data-icon="send"></i> ส่ง`; if (window.Icons) Icons.replaceAll(btn); }
    }
  }

  function copyChannel(chId, type = 'alert') {
    const textarea = document.getElementById(`il-ch-${type}-${chId}`);
    const text = textarea?.value || '';
    navigator.clipboard?.writeText(text)
      .then(() => {
        const ch = (_config.channels || []).find(c => c.id === chId);
        window.showToast?.(`Copy ข้อความสำหรับ ${ch?.name || 'channel'} แล้ว — วางในแชทได้เลย`, 'success');
        if (type === 'alert') { _chSetSent(chId, 'alert'); _timelineAdd('copy', `Copy แจ้งปัญหา: ${ch?.name || ''}`); }
      })
      .catch(() => window.showToast?.('ไม่สามารถ copy ได้', 'error'));
  }

  function _chSetSent(chId, type) {
    if (!_chState[chId]) _chState[chId] = {};
    const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    if (type === 'alert')    { _chState[chId].alertSent = true;    _chState[chId].alertTime = now; }
    if (type === 'resolved') { _chState[chId].resolvedSent = true; }

    const badge = document.getElementById(`il-ch-badge-${chId}`);
    if (badge) {
      if (_chState[chId].resolvedSent) { badge.className = 'il-ch-status-badge il-ch-status-badge--resolved'; badge.textContent = 'Resolved ✓'; }
      else if (_chState[chId].alertSent) { badge.className = 'il-ch-status-badge il-ch-status-badge--sent'; badge.textContent = `ส่งแล้ว ${_chState[chId].alertTime}`; }
    }

    // Show "Notify Resolved" button when at least 1 alert sent
    const sentAny = Object.values(_chState).some(s => s.alertSent);
    const resolvedRow = document.getElementById('il-resolved-row');
    if (resolvedRow) resolvedRow.style.display = sentAny ? '' : 'none';
  }

  async function notifyResolved() {
    const resolvedTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const channels = (_config.channels || []).filter(ch => _chState[ch.id]?.alertSent && !_chState[ch.id]?.resolvedSent);
    if (!channels.length) { window.showToast?.('ยังไม่มี channel ที่ส่ง alert ไปแล้ว', 'warn'); return; }
    for (const ch of channels) {
      _chRefreshText(ch.id, 'resolved');
      // Override ${resolved_time} in the textarea
      const el = document.getElementById(`il-ch-resolved-${ch.id}`);
      if (el) el.value = _fillTemplate(ch.template_resolved, { resolved_time: resolvedTime });
      await sendChannel(ch.id, 'resolved');
    }
  }

  // ── Service Health ────────────────────────────────────
  let _lastImpactData = null;

  async function checkServiceHealth() {
    const svcInput = document.getElementById('il-service')?.value?.trim();
    const chips    = document.getElementById('il-svc-health-chips');
    const btn      = document.getElementById('il-svc-health-btn');
    if (!chips) return;

    chips.innerHTML = '<span class="il-svc-health-hint"><i data-icon="loader"></i> กำลัง query…</span>';
    if (window.Icons) Icons.replaceAll(chips);
    if (btn) { btn.disabled = true; }

    try {
      // respondOk([...]) → r.data = {success,message,data:{results:[...],hasInventory,...}}
      const r = await API.get('/service-performance/index.php?runway=all');
      const allServices = (r?.data?.data?.results || r?.data?.results || []).flatMap(rw => rw.services || []);

      // Filter by service name if provided
      const query = (svcInput || '').toLowerCase();
      const matched = query
        ? allServices.filter(s => (s.service || s.name || '').toLowerCase().includes(query))
        : allServices.slice(0, 12);

      if (!matched.length) {
        chips.innerHTML = `<span class="il-svc-health-hint">ไม่พบ service "${_escHtml(svcInput || '')}" ใน SP data</span>`;
        return;
      }

      chips.innerHTML = matched.slice(0, 15).map(s => {
        const name  = s.service || s.name || '?';
        const pods  = s.pods    || s.podCount || 0;
        const cpu   = s.cpuPct != null ? Math.round(s.cpuPct) : null;
        const mem   = s.memPct != null ? Math.round(s.memPct) : null;
        const hot   = cpu > 80 || mem > 85;
        const spUrl = `service-performance.html?service=${encodeURIComponent(name)}`;
        return `
          <a class="il-sh-chip ${hot ? 'il-sh-chip--hot' : ''}" href="${_escHtml(spUrl)}" target="_blank" rel="noopener" title="${_escHtml(name)}">
            <span class="il-sh-name">${_escHtml(name)}</span>
            <span class="il-sh-pods"><i data-icon="box"></i>${pods}</span>
            ${cpu != null ? `<span class="il-sh-cpu ${cpu > 80 ? 'hot' : ''}">${cpu}%</span>` : ''}
            ${mem != null ? `<span class="il-sh-mem ${mem > 85 ? 'hot' : ''}">${mem}%</span>` : ''}
          </a>`;
      }).join('');
      if (window.Icons) Icons.replaceAll(chips);
    } catch (e) {
      chips.innerHTML = `<span class="il-svc-health-hint" style="color:#ef4444"><i data-icon="alert-circle"></i> Error: ${_escHtml(e?.message || 'ไม่สำเร็จ')}</span>`;
      if (window.Icons) Icons.replaceAll(chips);
    } finally {
      if (btn) { btn.disabled = false; }
    }
  }

  // ── Impact Summary ────────────────────────────────────
  async function openImpact(incident) {
    const inc    = incident || _collectIncident() || {};
    const modal  = document.getElementById('il-impact-modal');
    const body   = document.getElementById('il-impact-body');
    const range  = document.getElementById('il-impact-range');
    const cpyBtn = document.getElementById('il-impact-copy-btn');
    if (!modal) return;

    _lastImpactData = null;
    if (cpyBtn) cpyBtn.style.display = 'none';
    body.innerHTML = '<div class="il-loading-hint"><i data-icon="loader"></i> กำลัง query Prometheus… (4 layers)</div>';
    if (window.Icons) Icons.replaceAll(body);
    modal.style.display = 'flex';

    const from  = inc.time  || new Date(Date.now() - 3600000).toISOString().slice(0,16);
    const toIso = new Date().toISOString();
    if (range) range.textContent = `${from} → now`;

    try {
      const r = await API.get(
        `/incident-launcher/index.php?action=impact_summary&from=${encodeURIComponent(from)}&to=${encodeURIComponent(toIso)}`
      );
      const rd = r?.data || {};
      _lastImpactData = rd;
      const layers = rd.layers || {};
      const sum    = rd.summary || {};

      const hasAny = (sum.total_http_5xx > 0) || (sum.total_restarts > 0) ||
                     (sum.total_bank_errors > 0) || (rd.business_impact || []).length > 0;

      if (!hasAny) {
        body.innerHTML = '<div class="il-impact-empty"><i data-icon="check-circle"></i><div>ไม่พบ anomaly ในช่วงเวลานี้<br><span style="font-size:11px;color:var(--text-muted)">อาจหมายถึงปัญหาเป็น transient หรือยังไม่มี pod/http errors</span></div></div>';
        if (window.Icons) Icons.replaceAll(body);
        return;
      }

      const sevColor = { critical:'#ef4444', high:'#f59e0b', medium:'#3b82f6', low:'#6b7280' };
      const sev      = rd.severity || 'low';

      // ── Business Impact (top section — most actionable) ──────────────────
      const bizHtml = _renderBizImpact(rd.business_impact || [], rd.unknown_apps || []);

      // ── Layer 1: Infrastructure ───────────────────────────────────────────
      const infraHtml = _renderInfraLayer(layers.infrastructure || []);

      // ── Layer 2: HTTP Errors ──────────────────────────────────────────────
      const httpHtml = _renderHttpLayer(layers.http_errors || []);

      // ── Layer 3: Performance ──────────────────────────────────────────────
      const perfHtml = _renderPerfLayer(layers.performance || []);

      // ── Layer 4: Banking + Business Ops ──────────────────────────────────
      const bankHtml = _renderBankLayer(layers.banking || []);
      const vasHtml  = _renderVasLayer(layers.business_ops || []);

      body.innerHTML = `
        <div class="il-impact-header-bar">
          <div class="il-impact-sev-badge" style="background:${sevColor[sev]}20;color:${sevColor[sev]};border-color:${sevColor[sev]}40">
            <i data-icon="${sev === 'critical' ? 'alert-triangle' : sev === 'high' ? 'alert-circle' : 'info'}"></i>
            ${sev.toUpperCase()}
          </div>
          <div class="il-impact-stats">
            ${sum.total_http_5xx > 0    ? `<span class="il-impact-stat il-impact-stat--err"><i data-icon="x-circle"></i> ${Math.round(sum.total_http_5xx).toLocaleString()} HTTP 5xx</span>` : ''}
            ${sum.total_restarts > 0    ? `<span class="il-impact-stat il-impact-stat--warn"><i data-icon="refresh-cw"></i> ${Math.round(sum.total_restarts)} pod restarts</span>` : ''}
            ${sum.total_bank_errors > 0 ? `<span class="il-impact-stat il-impact-stat--bank"><i data-icon="credit-card"></i> ${Math.round(sum.total_bank_errors).toLocaleString()} bank errors</span>` : ''}
          </div>
          <div class="il-impact-meta-right">Range: ${Math.round((rd.range_seconds||0)/60)} min · ${rd.source_count||0} source</div>
        </div>

        ${bizHtml}
        ${bankHtml}
        ${httpHtml}
        ${infraHtml}
        ${perfHtml}
        ${vasHtml}
      `;
      if (window.Icons) Icons.replaceAll(body);
      if (cpyBtn) cpyBtn.style.display = '';

      const affectedCount = (rd.business_impact || []).reduce((n, g) => n + (g.services||[]).length, 0);
      _timelineAdd('bar-chart-2', 'Impact Summary generated',
        `${affectedCount} business services · ${Math.round(sum.total_http_5xx||0)} 5xx · ${Math.round(sum.total_bank_errors||0)} bank errors`);
    } catch (e) {
      body.innerHTML = `<div class="il-error-hint"><i data-icon="alert-circle"></i> Query ไม่สำเร็จ: ${_escHtml(e?.message || 'error')}<br><small>ตรวจสอบ service-performance-sources.json และ GRAFANA_BASIC_USER/PASS ใน .env</small></div>`;
      if (window.Icons) Icons.replaceAll(body);
    }
  }

  function _renderBizImpact(bizImpact, unknownApps) {
    if (!bizImpact.length && !unknownApps.length) return '';
    const groups = bizImpact.map(g => `
      <div class="il-biz-group">
        <div class="il-biz-cat">${_escHtml(g.category)}</div>
        <div class="il-biz-chips">
          ${(g.services||[]).map(s => `<span class="il-biz-chip">${_escHtml(s)}</span>`).join('')}
        </div>
      </div>`).join('');
    const unknownHtml = unknownApps.length
      ? `<div class="il-biz-group il-biz-group--unknown">
           <div class="il-biz-cat">Unknown (no mapping)</div>
           <div class="il-biz-chips">${unknownApps.map(a => `<span class="il-biz-chip il-biz-chip--unknown">${_escHtml(a)}</span>`).join('')}</div>
         </div>` : '';
    return `<div class="il-impact-section">
      <div class="il-impact-section-title"><i data-icon="layers"></i> Business Services Impacted</div>
      <div class="il-biz-groups">${groups}${unknownHtml}</div>
    </div>`;
  }

  function _renderBankLayer(banking) {
    if (!banking.length) return '';
    const total = banking.reduce((n, b) => n + (b.errors||0), 0);
    const rows = banking.map(b => `
      <div class="il-impact-row2">
        <div class="il-impact-svc">${_escHtml(b.bankName||b.bankCode)}</div>
        <div class="il-impact-cnt il-impact-cnt--high">${Math.round(b.errors).toLocaleString()}</div>
        <div class="il-impact-links">
          <a href="${_escHtml(b.exploreUrl||'#')}" target="_blank" rel="noopener" class="il-impact-explore-btn">
            <i data-icon="bar-chart-2"></i> Grafana
          </a>
        </div>
      </div>`).join('');
    return `<div class="il-impact-section">
      <div class="il-impact-section-title"><i data-icon="credit-card"></i> Bank Errors — ${Math.round(total).toLocaleString()} total</div>
      <div class="il-impact-table2">
        <div class="il-impact-thead2"><div>Bank</div><div>Errors</div><div>Graph</div></div>
        ${rows}
      </div>
    </div>`;
  }

  function _renderHttpLayer(httpErrors) {
    if (!httpErrors.length) return '';
    const rows = httpErrors.slice(0, 20).map((s, i) => {
      const uriHtml = (s.top_uris||[]).slice(0,2).map(u =>
        `<span class="il-uri-chip" title="${_escHtml(u.uri)}">${_escHtml(u.uri.split('/').slice(-2).join('/'))} <em>${Math.round(u.count)}</em></span>`
      ).join('');
      return `<div class="il-impact-row ${i===0?'il-impact-row--top':''}">
        <div class="il-impact-svc">${_escHtml(s.app_name)}</div>
        <div class="il-impact-cnt ${s.http_5xx>=500?'il-impact-cnt--high':s.http_5xx>=50?'il-impact-cnt--med':''}">${Math.round(s.http_5xx).toLocaleString()}${s.error_pct!=null?`<em style="font-weight:400;font-size:10px;color:var(--text-muted)"> (${s.error_pct}%)</em>`:''}</div>
        <div class="il-impact-pods">${uriHtml||'—'}</div>
        <div class="il-impact-links">
          <a href="${_escHtml(s.exploreUrl||'#')}" target="_blank" rel="noopener" class="il-impact-explore-btn"><i data-icon="bar-chart-2"></i> Explore</a>
          <a href="service-performance.html?service=${encodeURIComponent(s.app_name)}" target="_blank" rel="noopener" class="il-impact-sp-btn"><i data-icon="activity"></i> SP</a>
        </div>
      </div>`;
    }).join('');
    return `<div class="il-impact-section">
      <div class="il-impact-section-title"><i data-icon="x-circle"></i> HTTP 5xx Errors — ${httpErrors.length} services</div>
      <div class="il-impact-table">
        <div class="il-impact-thead"><div>Service</div><div>5xx Count</div><div>Top URIs</div><div>Links</div></div>
        ${rows}
      </div>
    </div>`;
  }

  function _renderInfraLayer(infra) {
    if (!infra.length) return '';
    const rows = infra.slice(0, 15).map((s, i) => `
      <div class="il-impact-row ${i===0?'il-impact-row--top':''}">
        <div class="il-impact-svc">${_escHtml(s.service)}</div>
        <div class="il-impact-ns" title="${_escHtml(s.namespace)}">${_escHtml(s.namespace)}</div>
        <div class="il-impact-cnt ${s.restarts>=5?'il-impact-cnt--high':s.restarts>=2?'il-impact-cnt--med':''}">${Math.round(s.restarts)}</div>
        <div class="il-impact-pods">${(s.pods||[]).slice(0,3).map(p=>`<span title="${_escHtml(p.pod)}">${_escHtml(p.pod.split('-').slice(-2).join('-'))}</span>`).join(', ')}${(s.pods||[]).length>3?` +${s.pods.length-3}`:''}</div>
        <div class="il-impact-links">
          <a href="${_escHtml(s.exploreUrl||'#')}" target="_blank" rel="noopener" class="il-impact-explore-btn"><i data-icon="bar-chart-2"></i> Explore</a>
        </div>
      </div>`).join('');
    return `<div class="il-impact-section">
      <div class="il-impact-section-title"><i data-icon="server"></i> Pod Restarts — ${infra.length} services</div>
      <div class="il-impact-table">
        <div class="il-impact-thead"><div>Service</div><div>Namespace</div><div>Restarts</div><div>Pods</div><div>Graph</div></div>
        ${rows}
      </div>
    </div>`;
  }

  function _renderPerfLayer(perf) {
    if (!perf.length) return '';
    const rows = perf.slice(0, 10).map((s, i) => `
      <div class="il-impact-row2">
        <div class="il-impact-svc">${_escHtml(s.app_name)}</div>
        <div class="il-impact-cnt il-impact-cnt--high">${s.peak_ms}ms${s.ratio?` <em style="font-weight:400;font-size:10px;color:var(--text-muted)">(${s.ratio}× normal)</em>`:''}</div>
        <div class="il-impact-links">
          <a href="${_escHtml(s.exploreUrl||'#')}" target="_blank" rel="noopener" class="il-impact-explore-btn"><i data-icon="bar-chart-2"></i> Explore</a>
        </div>
      </div>`).join('');
    return `<div class="il-impact-section">
      <div class="il-impact-section-title"><i data-icon="clock"></i> Latency Spikes — ${perf.length} services</div>
      <div class="il-impact-table2">
        <div class="il-impact-thead2"><div>Service</div><div>Peak Latency</div><div>Graph</div></div>
        ${rows}
      </div>
    </div>`;
  }

  function _renderVasLayer(bizOps) {
    const notable = bizOps.filter(v => v.errors >= 5);
    if (!notable.length) return '';
    const rows = notable.slice(0, 10).map(v => `
      <div class="il-impact-row2">
        <div class="il-impact-svc">${_escHtml(v.app_name)}</div>
        <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(v.uri||'')}</div>
        <div class="il-impact-cnt ${v.errors>=100?'il-impact-cnt--high':'il-impact-cnt--med'}">${Math.round(v.errors)} <em style="font-size:10px;font-weight:400;color:var(--text-muted)">${v.status||''}</em></div>
        <div class="il-impact-links">
          <a href="${_escHtml(v.exploreUrl||'#')}" target="_blank" rel="noopener" class="il-impact-explore-btn"><i data-icon="bar-chart-2"></i> Grafana</a>
        </div>
      </div>`).join('');
    return `<div class="il-impact-section">
      <div class="il-impact-section-title"><i data-icon="zap"></i> Business Ops Errors — ${notable.length} endpoints</div>
      <div class="il-impact-table2">
        <div class="il-impact-thead2"><div>Service</div><div>URI</div><div>Errors</div><div>Graph</div></div>
        ${rows}
      </div>
    </div>`;
  }

  function closeImpact() {
    const modal = document.getElementById('il-impact-modal');
    if (modal) modal.style.display = 'none';
  }

  function copyImpactReport() {
    const data = _lastImpactData;
    if (!data) return;
    const inc   = _collectIncident() || {};
    const sum   = data.summary || {};
    const layers= data.layers  || {};
    const lines = [
      `[IMPACT SUMMARY] ${inc.title || '—'}`,
      `Severity: ${(data.severity||'').toUpperCase()}`,
      `Time range: ${data.from} → ${data.to}`,
      ``,
    ];

    if ((data.business_impact||[]).length) {
      lines.push('Business Services Impacted:');
      (data.business_impact||[]).forEach(g => {
        lines.push(`  [${g.category}] ${(g.services||[]).join(', ')}`);
      });
      lines.push('');
    }

    if (sum.total_bank_errors > 0) {
      lines.push(`Bank Errors: ${Math.round(sum.total_bank_errors).toLocaleString()} total`);
      (layers.banking||[]).forEach(b => lines.push(`  - ${b.bankName||b.bankCode}: ${Math.round(b.errors).toLocaleString()}`));
      lines.push('');
    }

    if (sum.total_http_5xx > 0) {
      lines.push(`HTTP 5xx: ${Math.round(sum.total_http_5xx).toLocaleString()} total across ${sum.services_count} services`);
      (layers.http_errors||[]).slice(0,10).forEach(s =>
        lines.push(`  - ${s.app_name}: ${Math.round(s.http_5xx).toLocaleString()} errors`)
      );
      lines.push('');
    }

    if (sum.total_restarts > 0) {
      lines.push(`Pod Restarts: ${Math.round(sum.total_restarts)} across ${(layers.infrastructure||[]).length} services`);
      (layers.infrastructure||[]).slice(0,8).forEach(s =>
        lines.push(`  - ${s.service} (${s.namespace}): ${Math.round(s.restarts)} restarts`)
      );
      lines.push('');
    }

    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => window.showToast?.('Copy Impact Report สำเร็จ', 'success'))
      .catch(() => window.showToast?.('ไม่สามารถ copy ได้', 'error'));
  }

  // ── MA Section ────────────────────────────────────────
  function _renderMaSection() {
    const section = document.getElementById('il-ma-section');
    const cards   = document.getElementById('il-ma-cards');
    const jobs    = (_config.ma_jobs || []).filter(j => j.enabled !== false);
    if (!jobs.length || !section || !cards) return;

    section.style.display = '';
    cards.innerHTML = jobs.map(j => {
      const state    = _maState[j.id] || {};
      const typeIcon = j.type === 'jenkins' ? 'settings' : j.type === 'rundeck' ? 'terminal' : 'clipboard';
      const typeLbl  = j.type === 'jenkins' ? 'Jenkins' : j.type === 'rundeck' ? 'Rundeck' : 'Manual';
      return `
      <div class="il-ma-card ${state.done ? 'il-ma-card--done' : ''}" id="il-ma-card-${_escAttr(j.id)}">
        <div class="il-ma-card-hd">
          <div class="il-ma-icon il-ma-icon--${j.type}"><i data-icon="${typeIcon}"></i></div>
          <div class="il-ma-meta">
            <div class="il-ma-name">${_escHtml(j.name)}</div>
            <div class="il-ma-badges">
              <span class="il-ma-type-badge il-ma-type-badge--${j.type}">${typeLbl}</span>
              ${j.optional ? '<span class="il-ma-opt-badge">ไม่บังคับ</span>' : '<span class="il-ma-req-badge">ต้องทำ</span>'}
            </div>
          </div>
          ${state.done ? `<div class="il-ma-done-ts"><i data-icon="check-circle"></i> ${state.ts || ''}</div>` : ''}
        </div>
        ${j.notes ? `<div class="il-ma-notes">${_escHtml(j.notes)}</div>` : ''}
        <div class="il-ma-actions">
          ${j.type === 'jenkins'
            ? `<button type="button" class="il-ma-btn-open" onclick="IL.openJenkinsJob('${_escAttr(j.id)}')"><i data-icon="play"></i> Open MA Form</button>`
            : j.type === 'rundeck' && j.url
            ? `<a href="${_escHtml(j.url)}" target="_blank" rel="noopener" class="il-ma-btn-link"><i data-icon="external-link"></i> เปิด Rundeck</a>`
            : ''}
          <button type="button" class="il-ma-btn-done ${state.done ? 'active' : ''}" onclick="IL._markMaDone('${_escAttr(j.id)}')">
            <i data-icon="${state.done ? 'check-circle' : 'check'}"></i> ${state.done ? 'Done ✓' : 'Mark Done'}
          </button>
        </div>
      </div>`;
    }).join('');
    if (window.Icons) Icons.replaceAll(cards);
  }

  function _markMaDone(maId, extra = '') {
    const job = (_config.ma_jobs || []).find(j => j.id === maId);
    if (!job) return;
    const ts = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    _maState[maId] = { done: true, ts };
    _timelineAdd('toggle-left', `MA Done: ${job.name}`, extra || ts);
    _renderMaSection();
    window.showToast?.(`${job.name} — บันทึกเวลา ${ts}`, 'success');
  }

  // ── Jenkins Modal (batch-monitor style) ──────────────
  // Tree query: only fetch what we need — param definitions
  const _JK_TREE = 'displayName,buildable,nextBuildNumber,lastBuild[number,result,timestamp],property[parameterDefinitions[name,_class,defaultParameterValue[value],description,choices]]';
  let _jkParamDefs = []; // current job's param definitions

  async function openJenkinsJob(maId) {
    const job = (_config.ma_jobs || []).find(j => j.id === maId);
    if (!job) return;
    _currentJenkinsJob = job;
    _jkParamDefs = [];

    const modal  = document.getElementById('il-jenkins-modal');
    const title  = document.getElementById('il-jenkins-modal-title');
    const params = document.getElementById('il-jenkins-params');
    const buildBtn = document.getElementById('il-jenkins-build-btn');

    title.textContent = `Build: ${job.name}`;
    params.innerHTML  = '<div class="il-loading-hint"><i data-icon="loader"></i> กำลังโหลด parameters…</div>';
    if (window.Icons) Icons.replaceAll(params);
    if (buildBtn) { buildBtn.disabled = false; buildBtn.innerHTML = '<i data-icon="play"></i> Build'; }
    modal.style.display = 'flex';

    // If no server_id, fall back to open URL in browser
    if (!job.server_id && job.url) {
      params.innerHTML = `<div class="il-jenkins-noparams">
        <i data-icon="external-link"></i>
        <div>Job นี้ใช้ Direct URL<br><small style="color:var(--text-muted)">ไม่สามารถ fetch parameters ได้ กด Build เพื่อเปิด Jenkins ในหน้าต่างใหม่</small></div>
      </div>`;
      if (window.Icons) Icons.replaceAll(params);
      if (buildBtn) { buildBtn.innerHTML = '<i data-icon="external-link"></i> เปิด Jenkins'; }
      return;
    }

    try {
      const r = await API.get(
        `/jenkins-proxy/index.php?server=${encodeURIComponent(job.server_id)}&path=${encodeURIComponent(job.job_path + '/api/json')}&tree=${encodeURIComponent(_JK_TREE)}`
      );
      if (!r?.ok) throw new Error(r?.data?.message || `HTTP ${r?.status} — ตรวจสอบ Server ID และ Job Path`);

      // respondOk($data) → r.data = {success, message, data: Jenkins_JSON}
      const jd = r?.data?.data || {};
      _jkParamDefs = (jd.property || []).find(p => p._class?.includes('ParametersDefinition'))?.parameterDefinitions || [];

      // Header info
      const lastBuildNum = jd.lastBuild?.number ? `#${jd.lastBuild.number} · ${jd.lastBuild.result || 'IN PROGRESS'}` : 'ยังไม่มี build';
      const headerHtml = `
        <div class="il-jk-info">
          <div class="il-jk-info-name">${_escHtml(jd.displayName || job.name)}</div>
          <div class="il-jk-info-meta">
            Next build: <strong>#${jd.nextBuildNumber || '—'}</strong>
            · Last: <span class="il-jk-result il-jk-result--${(jd.lastBuild?.result || '').toLowerCase()}">${lastBuildNum}</span>
            · <a href="${_escHtml('https://' + (job.server_id ? '' : '') + job.job_path)}" target="_blank" rel="noopener" class="il-jk-open-link" style="display:none">↗ Open in Jenkins</a>
          </div>
        </div>`;

      if (!_jkParamDefs.length) {
        params.innerHTML = headerHtml + `
          <div class="il-jenkins-noparams">
            <i data-icon="info"></i> Job นี้ไม่มี parameters — กด Build ได้เลย
          </div>`;
        if (window.Icons) Icons.replaceAll(params);
        return;
      }

      // Render params — same style as batch-monitor
      params.innerHTML = headerHtml + '<div class="il-bwp-params">' + _jkParamDefs.map((p, i) => {
        const defVal   = String(p.defaultParameterValue?.value ?? '');
        const cls      = p._class || '';
        const isChoice = cls.includes('Choice') && Array.isArray(p.choices) && p.choices.length;
        const isBool   = cls.includes('Boolean');
        const isText   = cls.includes('TextParameter');
        const isPass   = cls.includes('Password');

        let input;
        if (isChoice) {
          input = `<select class="bt-select" id="bwp-p-${i}">
            ${p.choices.map(c => `<option value="${_escHtml(c)}"${c === defVal ? ' selected' : ''}>${_escHtml(c)}</option>`).join('')}
          </select>`;
        } else if (isBool) {
          const checked = defVal === 'true' || p.defaultParameterValue?.value === true;
          input = `<div style="display:flex;align-items:center;gap:10px;padding:6px 0">
            <input type="checkbox" id="bwp-p-${i}" ${checked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:#e85d04">
            <label for="bwp-p-${i}" style="font-size:12px;cursor:pointer;color:var(--text)" id="bwp-pl-${i}">${checked ? 'true (enabled)' : 'false (disabled)'}</label>
          </div>`;
        } else if (isText) {
          input = `<textarea class="bt-input" id="bwp-p-${i}" rows="3" style="resize:vertical;font-family:monospace;font-size:11px">${_escHtml(defVal)}</textarea>`;
        } else if (isPass) {
          input = `<input type="password" class="bt-input" id="bwp-p-${i}" value="${_escHtml(defVal)}">`;
        } else {
          input = `<input type="text" class="bt-input" id="bwp-p-${i}" value="${_escHtml(defVal)}" placeholder="${_escHtml(p.name)}">`;
        }

        return `<div class="bt-form-group">
          <label class="bt-label">${_escHtml(p.name)}</label>
          ${p.description ? `<div class="il-jk-param-desc" data-desc-idx="${i}" style="font-size:10.5px;color:var(--text-muted);margin-bottom:3px;line-height:1.5"></div>` : ''}
          ${input}
        </div>`;
      }).join('') + '</div>';

      // Wire up boolean toggle labels
      _jkParamDefs.forEach((p, i) => {
        if ((p._class || '').includes('Boolean')) {
          const cb = document.getElementById(`bwp-p-${i}`);
          const lb = document.getElementById(`bwp-pl-${i}`);
          cb?.addEventListener('change', () => { if (lb) lb.textContent = cb.checked ? 'true (enabled)' : 'false (disabled)'; });
        }
        // Inject description as HTML (Jenkins descriptions are trusted internal content)
        if (p.description) {
          const descEl = params.querySelector(`[data-desc-idx="${i}"]`);
          if (descEl) descEl.innerHTML = p.description;
        }
      });

      // Show BO Config values above params (if configured)
      _loadBoValuesForJob(job, params);

    } catch (e) {
      params.innerHTML = `<div class="il-error-hint"><i data-icon="alert-circle"></i> โหลดไม่สำเร็จ: ${_escHtml(e?.message || 'error')}<br><small style="color:var(--text-muted)">Server: ${_escHtml(job.server_id)} · Path: ${_escHtml(job.job_path)}</small></div>`;
      if (window.Icons) Icons.replaceAll(params);
    }
  }

  async function _loadBoValuesForJob(job, paramsContainer) {
    const cfgs = job.bo_configs?.length ? job.bo_configs
      : (job.bo_application ? [{ application: job.bo_application, key: job.bo_key || '', label: '' }] : []);
    if (!cfgs.length) return;

    // Insert BO preview block at top of params container
    const boBlock = document.createElement('div');
    boBlock.className = 'il-bo-preview';
    boBlock.innerHTML = `
      <div class="il-bo-preview-hd"><i data-icon="database"></i> Admin Portal Config</div>
      <div class="il-bo-preview-rows" id="il-bo-preview-rows">
        ${cfgs.map((c, i) => `<div class="il-bo-row" id="il-bo-pr-${i}">
          <span class="il-bo-key-badge">${_escHtml(c.label || c.key)}</span>
          <span class="il-bo-val il-bo-val--loading">กำลังโหลด…</span>
        </div>`).join('')}
      </div>`;
    paramsContainer.prepend(boBlock);
    if (window.Icons) Icons.replaceAll(boBlock);

    // Fetch all in parallel
    await Promise.all(cfgs.map(async (c, i) => {
      const row = document.getElementById(`il-bo-pr-${i}`);
      if (!row) return;
      const valEl = row.querySelector('.il-bo-val');
      try {
        const r = await API.get(`/incident-launcher/index.php?action=bo_config_peek&application=${encodeURIComponent(c.application)}&key=${encodeURIComponent(c.key)}`);
        const p = r?.data?.property;
        if (!p) throw new Error('ไม่พบ');
        if (valEl) {
          valEl.className = 'il-bo-val';
          valEl.textContent = p.value || '(ว่าง)';
        }
      } catch (e) {
        if (valEl) {
          valEl.className = 'il-bo-val il-bo-val--err';
          valEl.textContent = e?.message || 'ดึงข้อมูลไม่สำเร็จ';
        }
      }
    }));
  }

  async function triggerJenkinsBuild() {
    const job = _currentJenkinsJob;
    if (!job) return;

    // If no server_id, open URL directly
    if (!job.server_id && job.url) {
      window.open(job.url, '_blank', 'noopener');
      closeJenkinsModal();
      _markMaDone(job.id, 'Opened in Jenkins');
      return;
    }

    // Collect params from form
    const params = {};
    _jkParamDefs.forEach((p, i) => {
      const el = document.getElementById(`bwp-p-${i}`);
      if (!el) return;
      params[p.name] = (p._class || '').includes('Boolean') ? (el.checked ? 'true' : 'false') : el.value;
    });

    const btn = document.getElementById('il-jenkins-build-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> กำลัง queue…'; if (window.Icons) Icons.replaceAll(btn); }

    try {
      await API.post('/jenkins-proxy/index.php?action=build', {
        server: job.server_id,
        path:   job.job_path,
        params: Object.keys(params).length ? params : undefined,
      });
      if (btn) { btn.className = 'il-btn il-btn--primary'; btn.style.background = '#16a34a'; btn.innerHTML = '<i data-icon="check"></i> Queued!'; if (window.Icons) Icons.replaceAll(btn); }
      setTimeout(() => { closeJenkinsModal(); _markMaDone(job.id, 'Build queued'); }, 1200);
      window.showToast?.(`Build "${job.name}" queued สำเร็จ`, 'success');
    } catch (e) {
      window.showToast?.(e?.message || 'Build ล้มเหลว', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="play"></i> Build'; if (window.Icons) Icons.replaceAll(btn); }
    }
  }

  function closeJenkinsModal() {
    document.getElementById('il-jenkins-modal').style.display = 'none';
    _currentJenkinsJob = null;
    _jkParamDefs = [];
  }

  // ── Timeline ──────────────────────────────────────────
  function _timelineAdd(icon, label, detail = '') {
    const ts = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    _timeline.push({ ts, icon, label, detail });
    _renderTimeline();
    const section = document.getElementById('il-timeline-section');
    if (section) section.style.display = '';
  }

  function _renderTimeline() {
    const list = document.getElementById('il-timeline-entries');
    if (!list) return;
    list.innerHTML = [..._timeline].reverse().map(e => `
      <div class="il-tl-entry">
        <div class="il-tl-dot"><i data-icon="${e.icon}"></i></div>
        <div class="il-tl-body">
          <div class="il-tl-time">${e.ts}</div>
          <div class="il-tl-label">${_escHtml(e.label)}</div>
          ${e.detail ? `<div class="il-tl-detail">${_escHtml(e.detail)}</div>` : ''}
        </div>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  // ── Escalate as Incident ──────────────────────────────
  function openEscalate(incident) {
    const inc   = incident || _collectIncident() || {};
    const modal = document.getElementById('il-escalate-modal');
    if (!modal) return;

    document.getElementById('il-esc-ticket-key').textContent = _lastTicket || '(ยังไม่มี ticket)';
    document.getElementById('il-esc-summary').value = inc.title || '';
    document.getElementById('il-esc-detected').value = 'Service Monitoring (SM)';
    document.getElementById('il-esc-status').style.display = 'none';

    // Auto-fill fault start from incident time
    const faultStart = document.getElementById('il-esc-fault-start');
    if (faultStart && inc.time) faultStart.value = inc.time;
    else if (faultStart) {
      const now = new Date(); now.setSeconds(0,0);
      faultStart.value = now.toISOString().slice(0,16);
    }

    const confirmTime = document.getElementById('il-esc-confirm-time');
    if (confirmTime) { const now = new Date(); now.setSeconds(0,0); confirmTime.value = now.toISOString().slice(0,16); }

    const escLink = document.getElementById('il-esc-jira-link');
    if (escLink && _lastTicket) {
      escLink.href = `https://truemoney.atlassian.net/browse/${_lastTicket}`;
      escLink.style.display = '';
    } else if (escLink) escLink.style.display = 'none';

    const btn = document.getElementById('il-esc-submit-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="arrow-up-circle"></i> Escalate as Incident'; if (window.Icons) Icons.replaceAll(btn); }

    modal.style.display = 'flex';
  }

  function closeEscalate() {
    const modal = document.getElementById('il-escalate-modal');
    if (modal) modal.style.display = 'none';
  }

  function _escFill(fieldId, value) {
    const map = { subject: 'il-esc-subject', action: 'il-esc-action' };
    const el = document.getElementById(map[fieldId] || `il-esc-${fieldId}`);
    if (el) el.value = value;
  }

  async function submitEscalate() {
    if (!_lastTicket) { window.showToast?.('ยังไม่มี Jira ticket', 'error'); return; }

    const transId = (_config.jira_escalate_transition || '').trim();
    if (!transId) {
      window.showToast?.('ยังไม่มี Transition ID — ตั้งค่าใน Admin Config → Jira Settings', 'error');
      return;
    }

    const summary  = document.getElementById('il-esc-summary').value.trim();
    if (!summary) { window.showToast?.('กรุณาระบุ Summary', 'error'); return; }

    const btn = document.getElementById('il-esc-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> กำลัง Escalate…'; if (window.Icons) Icons.replaceAll(btn); }

    const status = document.getElementById('il-esc-status');

    try {
      const fields = {};
      const sev   = document.getElementById('il-esc-sev').value;
      const bu    = document.getElementById('il-esc-bu').value.trim();
      const svc   = document.getElementById('il-esc-svc').value.trim();
      const ch    = document.getElementById('il-esc-channel').value.trim();
      const act   = document.getElementById('il-esc-action').value.trim();
      const cause = document.getElementById('il-esc-cause').value.trim();
      const sub   = document.getElementById('il-esc-subject').value.trim();

      // Map fields → summary updated via comment field (plain text payload for transition)
      if (summary) fields.summary = summary;
      // Add as comment for now (actual field IDs need admin config for custom fields)
      const notes = [
        sub     ? `Subject: ${sub}` : '',
        sev     ? `Severity: ${sev}` : '',
        bu      ? `Business Unit: ${bu}` : '',
        svc     ? `Service Impacted: ${svc}` : '',
        ch      ? `Channel: ${ch}` : '',
        act     ? `Action: ${act}` : '',
        cause   ? `Initial Cause: ${cause}` : '',
      ].filter(Boolean).join('\n');

      if (notes) fields.comment = notes;

      await API.post('/jira/transition.php', {
        key:          _lastTicket,
        transitionId: transId,
        fields,
      });

      if (status) {
        status.style.display = '';
        status.className = 'il-esc-status il-esc-status--ok';
        status.innerHTML = `<i data-icon="check-circle"></i> Escalate สำเร็จ — <a href="https://truemoney.atlassian.net/browse/${_lastTicket}" target="_blank">${_lastTicket}</a>`;
        if (window.Icons) Icons.replaceAll(status);
      }
      _timelineAdd('arrow-up-circle', `Escalate as Incident: ${_lastTicket}`);
      window.showToast?.(`Escalate ${_lastTicket} สำเร็จ`, 'success');
    } catch (e) {
      if (status) {
        status.style.display = '';
        status.className = 'il-esc-status il-esc-status--error';
        status.textContent = `Error: ${e?.message || 'Escalate ไม่สำเร็จ'}`;
      }
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="arrow-up-circle"></i> Escalate as Incident'; if (window.Icons) Icons.replaceAll(btn); }
    }
  }

  // ── Mode ──────────────────────────────────────────────
  function setMode(mode) {
    _mode = mode;

    // Toggle active class on panels
    document.getElementById('il-mode-guided').classList.toggle('active', mode === 'guided');
    document.getElementById('il-mode-express').classList.toggle('active', mode === 'express');

    // Mark mode row as chosen → dims the inactive panel
    document.getElementById('il-mode-row')?.classList.add('il-chosen');

    // First pick: transition from fullscreen splash → main layout
    const ilRoot = document.querySelector('.il');
    if (ilRoot && !ilRoot.classList.contains('il-ready')) {
      // Brief flash to show selection, then switch
      const modeRow = document.getElementById('il-mode-row');
      if (modeRow) {
        modeRow.style.transition = 'opacity .3s, transform .35s cubic-bezier(.4,0,.2,1)';
        modeRow.style.opacity    = '0';
        modeRow.style.transform  = 'translateY(-8px)';
      }
      setTimeout(() => {
        ilRoot.classList.add('il-ready');
        if (modeRow) { modeRow.style.removeProperty('opacity'); modeRow.style.removeProperty('transform'); modeRow.style.removeProperty('transition'); }
        const layout = document.getElementById('il-layout');
        if (layout) {
          layout.style.removeProperty('display');
          layout.classList.add('il-layout--entering');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => layout.classList.add('il-layout--visible'));
          });
        }
        // Scroll to top after transition
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 280);
    }

    document.getElementById('il-guided-tasks')?.style?.setProperty('display', mode === 'guided'  ? '' : 'none');
    document.getElementById('il-express-tasks')?.style?.setProperty('display', mode === 'express' ? '' : 'none');
    document.getElementById('il-result-panel')?.style?.setProperty('display', 'none');

    const title = document.getElementById('il-task-panel-title');
    if (title) title.textContent = mode === 'guided' ? 'Guided Actions' : 'Express Launch';
    _resetTaskStates();
  }

  // ── Severity ──────────────────────────────────────────
  function setSev(sev) {
    _severity = sev;
    document.querySelectorAll('.il-sev-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sev === sev);
    });
  }

  // ── Tag Input ─────────────────────────────────────────
  function _initTagInput() {
    const wrap = document.getElementById('il-partner-wrap');
    if (wrap) wrap.addEventListener('click', () => document.getElementById('il-partner-input')?.focus());
  }

  function _onTagKey(e) {
    const input = e.target;
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      _addTag(input.value.trim());
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && _partners.length) {
      _removeTag(_partners[_partners.length - 1]);
    }
  }

  function _addTag(email, silent = false) {
    if (!email || _partners.includes(email)) return;
    if (silent && _config.default_partners?.includes(email)) {
      // Don't show default partners as tags in the UI (they're auto-included at send time)
      _config._defaultLoaded = true;
      return;
    }
    _partners.push(email);
    const container = document.getElementById('il-tags');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'il-tag';
    el.dataset.email = email;
    el.innerHTML = `<span>${_escHtml(email)}</span><button type="button" onclick="IL._removeTag('${_escHtml(email)}')" title="ลบ">×</button>`;
    container.appendChild(el);
  }

  function _removeTag(email) {
    _partners = _partners.filter(e => e !== email);
    document.querySelector(`.il-tag[data-email="${CSS.escape(email)}"]`)?.remove();
  }

  // ── Task Rendering ────────────────────────────────────
  function _renderGuidedTasks() {
    const list = document.getElementById('il-task-list-guided');
    if (!list) return;
    list.innerHTML = TASKS.map((t, i) => `
      <div class="il-task-row" id="il-gtask-${t.id}" data-task="${t.id}">
        <div class="il-task-status il-task-status--pending" id="il-gstatus-${t.id}">
          <i data-icon="circle"></i>
        </div>
        <div class="il-task-info">
          <div class="il-task-label"><span class="il-task-num">${i + 1}.</span> ${t.label}</div>
          <div class="il-task-desc" id="il-gdesc-${t.id}">${t.desc}</div>
          <div class="il-task-result" id="il-gresult-${t.id}" style="display:none"></div>
        </div>
        <div class="il-task-action">
          ${t.isLink
            ? `<button type="button" class="il-open-btn" id="il-gbtn-${t.id}" onclick="IL._runTask('${t.id}','guided')"><i data-icon="external-link"></i> Open</button>`
            : `<button type="button" class="il-run-btn" id="il-gbtn-${t.id}" onclick="IL._runTask('${t.id}','guided')"><i data-icon="play"></i> Run</button>`
          }
        </div>
      </div>`).join('');
    window.Icons?.process?.(list);
  }

  function _renderExpressTasks() {
    const list = document.getElementById('il-express-checklist');
    if (!list) return;
    list.innerHTML = TASKS.map(t => `
      <div class="il-express-row" id="il-etask-${t.id}">
        <div class="il-express-check" id="il-echeck-${t.id}"></div>
        <div class="il-express-row-label">
          <i data-icon="${t.icon}"></i> ${t.label}
        </div>
        <div class="il-express-row-status" id="il-estatus-${t.id}">pending</div>
      </div>`).join('');
    window.Icons?.process?.(list);
  }

  function _resetTaskStates() {
    TASKS.forEach(t => {
      _taskState[t.id] = 'pending';
      // Guided
      const row = document.getElementById(`il-gtask-${t.id}`);
      if (row) row.className = 'il-task-row';
      const statusEl = document.getElementById(`il-gstatus-${t.id}`);
      if (statusEl) { statusEl.className = 'il-task-status il-task-status--pending'; statusEl.innerHTML = '<i data-icon="circle"></i>'; }
      const resultEl = document.getElementById(`il-gresult-${t.id}`);
      if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
      const btn = document.getElementById(`il-gbtn-${t.id}`);
      if (btn) btn.disabled = false;
      // Express
      const erow = document.getElementById(`il-etask-${t.id}`);
      if (erow) erow.className = 'il-express-row';
      const echeck = document.getElementById(`il-echeck-${t.id}`);
      if (echeck) echeck.innerHTML = '';
      const estatus = document.getElementById(`il-estatus-${t.id}`);
      if (estatus) { estatus.textContent = 'pending'; }
    });
    document.getElementById('il-result-panel')?.style?.setProperty('display','none');
    document.getElementById('il-express-tasks')?.style?.setProperty('display', _mode==='express' ? '' : 'none');
    document.getElementById('il-guided-tasks')?.style?.setProperty('display',  _mode==='guided'  ? '' : 'none');
    if (window.Icons) window.Icons.process?.(document.getElementById('il-task-panel'));
    document.getElementById('il-progress-wrap')?.style?.setProperty('display','none');
    document.getElementById('il-launch-btn')?.removeAttribute('disabled');
  }

  // ── Collect Incident Data ─────────────────────────────
  function _collectIncident() {
    const title = document.getElementById('il-title')?.value?.trim();
    if (!title) { window.showToast?.('กรุณาระบุ Incident Title', 'error'); return null; }
    return {
      title,
      service:     document.getElementById('il-service')?.value?.trim() || '',
      severity:    _severity,
      time:        document.getElementById('il-time')?.value || '',
      reporter:    document.getElementById('il-reporter')?.value?.trim() || '',
      description: document.getElementById('il-desc')?.value?.trim() || '',
      partners:    [..._partners],
    };
  }

  // ── Run Single Task (Guided) ──────────────────────────
  async function _runTask(taskId, panel = 'guided') {
    const task = TASKS.find(t => t.id === taskId);
    if (!task) return;

    const incident = _collectIncident();
    if (!incident) return;

    _setTaskStatus(taskId, 'running', panel);
    try {
      const result = await task.execute(incident);
      if (result.skip) {
        _setTaskStatus(taskId, 'skipped', panel, result.detail);
      } else if (result.ok) {
        _setTaskStatus(taskId, 'success', panel, result.detail, result.link, result.linkLabel);
      } else {
        _setTaskStatus(taskId, 'error', panel, result.detail || 'เกิดข้อผิดพลาด');
      }
    } catch (err) {
      _setTaskStatus(taskId, 'error', panel, err?.message || String(err));
    }
  }

  function _setTaskStatus(taskId, status, panel, detail = '', link = null, linkLabel = null) {
    _taskState[taskId] = status;

    if (panel === 'guided' || panel === 'both') {
      const row     = document.getElementById(`il-gtask-${taskId}`);
      const statEl  = document.getElementById(`il-gstatus-${taskId}`);
      const resEl   = document.getElementById(`il-gresult-${taskId}`);
      const btn     = document.getElementById(`il-gbtn-${taskId}`);

      if (row) {
        row.classList.remove('il-task--running','il-task--success','il-task--error','il-task--skipped');
        if (status !== 'pending') row.classList.add(`il-task--${status}`);
      }
      if (statEl) {
        const iconMap = { pending: 'circle', running: 'loader', success: 'check-circle', error: 'x-circle', skipped: 'minus-circle' };
        const clsMap  = { pending: 'pending', running: 'running', success: 'success', error: 'error', skipped: 'pending' };
        statEl.className = `il-task-status il-task-status--${clsMap[status]}`;
        statEl.innerHTML = `<i data-icon="${iconMap[status] || 'circle'}"></i>`;
        window.Icons?.process?.(statEl);
      }
      if (resEl && detail) {
        resEl.style.display = '';
        resEl.className = `il-task-result il-task-result--${status === 'success' ? 'success' : 'error'}`;
        let html = _escHtml(detail);
        if (link) html += ` — <a href="${_escHtml(link)}" target="_blank" rel="noopener">${_escHtml(linkLabel || link)}</a>`;
        resEl.innerHTML = html;
      }
      if (btn && (status === 'success' || status === 'skipped')) btn.disabled = true;
    }

    if (panel === 'express' || panel === 'both') {
      const erow   = document.getElementById(`il-etask-${taskId}`);
      const echeck = document.getElementById(`il-echeck-${taskId}`);
      const estat  = document.getElementById(`il-estatus-${taskId}`);

      if (erow) {
        erow.classList.remove('il-task--running','il-task--success','il-task--error','il-task--skipped');
        if (status !== 'pending') erow.classList.add(`il-task--${status}`);
      }
      if (echeck) {
        const iconMap = { running: '<i data-icon="loader"></i>', success: '<i data-icon="check"></i>', error: '<i data-icon="x"></i>', skipped: '–' };
        echeck.innerHTML = iconMap[status] || '';
        window.Icons?.process?.(echeck);
      }
      if (estat) {
        const lblMap = { pending: 'pending', running: 'กำลังส่ง…', success: detail || 'สำเร็จ', error: detail || 'ผิดพลาด', skipped: detail || 'ข้าม' };
        estat.textContent = lblMap[status] || status;
      }
    }
  }

  // ── Launch Console ────────────────────────────────────
  function _consoleOpen(taskList) {
    const el = document.getElementById('il-console');
    const steps = document.getElementById('il-console-steps');
    if (!el || !steps) return;

    // Render step rows
    steps.innerHTML = taskList.map(t => `
      <div class="il-cs-step pending" id="ilcs-${t.id}">
        <div class="il-cs-icon" id="ilcs-ic-${t.id}">○</div>
        <span class="il-cs-label">${_escHtml(t.label)}</span>
        <span class="il-cs-detail" id="ilcs-d-${t.id}">pending</span>
        <span id="ilcs-lk-${t.id}"></span>
      </div>`).join('');

    document.getElementById('il-console-title').textContent = 'Launch Console';
    document.getElementById('il-console-subtitle').textContent = 'กำลังเตรียม…';
    document.getElementById('il-console-pct').textContent = '0%';
    document.getElementById('il-console-progress-fill').style.width = '0%';
    document.getElementById('il-console-progress-fill').className = 'il-console-progress-fill';
    document.getElementById('il-console-pulse').className = 'il-console-pulse running';
    document.getElementById('il-console-close').style.display = 'none';

    el.classList.remove('il-console--collapsed');
    el.classList.add('il-console--open');
    if (window.Icons) Icons.replaceAll(el);
  }

  function _consoleStep(taskId, status, detail = '', link = null, linkLabel = null) {
    const row  = document.getElementById(`ilcs-${taskId}`);
    const icon = document.getElementById(`ilcs-ic-${taskId}`);
    const det  = document.getElementById(`ilcs-d-${taskId}`);
    const lk   = document.getElementById(`ilcs-lk-${taskId}`);
    if (!row) return;

    const iconMap = {
      running: '<i data-icon="loader" style="animation:spin-icon .8s linear infinite"></i>',
      success: '<i data-icon="check-circle"></i>',
      error:   '<i data-icon="x-circle"></i>',
      skipped: '<i data-icon="minus-circle"></i>',
      manual:  '<i data-icon="user"></i>',
      pending: '○',
    };
    row.className = `il-cs-step ${status}`;
    if (icon) { icon.innerHTML = iconMap[status] || '○'; if (window.Icons) Icons.replaceAll(icon); }
    if (det)  det.textContent = detail || status;
    if (lk && link) lk.innerHTML = `<a href="${_escHtml(link)}" target="_blank" rel="noopener" class="il-cs-link">${_escHtml(linkLabel || '↗')}</a>`;
  }

  function _consolePct(done, total, currentLabel = '') {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const fill = document.getElementById('il-console-progress-fill');
    const pctEl = document.getElementById('il-console-pct');
    const sub = document.getElementById('il-console-subtitle');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (sub && currentLabel) sub.textContent = currentLabel;
  }

  function _consoleDone(hasError) {
    const pulse = document.getElementById('il-console-pulse');
    const fill  = document.getElementById('il-console-progress-fill');
    const title = document.getElementById('il-console-title');
    const sub   = document.getElementById('il-console-subtitle');
    const close = document.getElementById('il-console-close');
    if (pulse) pulse.className = 'il-console-pulse ' + (hasError ? 'error' : 'done');
    if (fill)  { fill.style.width = '100%'; fill.className = 'il-console-progress-fill ' + (hasError ? 'error' : 'done'); }
    if (title) title.textContent = hasError ? 'Launch เสร็จ (มี error)' : 'Launch สำเร็จ ✓';
    if (sub)   sub.textContent   = hasError ? 'บางขั้นตอนล้มเหลว — ดูรายละเอียดด้านล่าง' : 'ทุก task เสร็จสิ้น';
    if (close) close.style.display = '';
    document.getElementById('il-console-pct').textContent = '100%';
  }

  function toggleConsole() {
    document.getElementById('il-console')?.classList.toggle('il-console--collapsed');
  }

  function closeConsole() {
    document.getElementById('il-console')?.classList.remove('il-console--open');
  }

  // ── Launch All (Express) ──────────────────────────────
  async function launchAll() {
    const incident = _collectIncident();
    if (!incident) return;

    const btn = document.getElementById('il-launch-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> กำลัง Launch…'; if (window.Icons) Icons.replaceAll(btn); }

    // Separate: auto-runnable vs modal tasks
    const autoTasks   = TASKS.filter(t => !t.expressSkip);
    const manualTasks = TASKS.filter(t =>  t.expressSkip);

    // Open console with all tasks
    _consoleOpen(TASKS);

    // Mark modal tasks immediately
    manualTasks.forEach(t => {
      _consoleStep(t.id, 'manual', 'ต้องทำเองใน Guided Mode');
      _setTaskStatus(t.id, 'skipped', 'express', 'ทำเองใน Guided Mode');
    });

    let done = 0;
    const results = [];
    let hasError = false;

    // Run auto tasks SEQUENTIALLY
    for (const task of autoTasks) {
      _consoleStep(task.id, 'running', 'กำลังดำเนินการ…');
      _consolePct(done, autoTasks.length, task.label + '…');
      _setTaskStatus(task.id, 'running', 'express');

      try {
        const r = await task.execute(incident);
        if (r.skip) {
          _consoleStep(task.id, 'skipped', r.detail);
          _setTaskStatus(task.id, 'skipped', 'express', r.detail);
          results.push({ task, status: 'skip', detail: r.detail });
        } else if (r.ok) {
          _consoleStep(task.id, 'success', r.detail || 'สำเร็จ', r.link, r.linkLabel);
          _setTaskStatus(task.id, 'success', 'express', r.detail, r.link, r.linkLabel);
          results.push({ task, status: 'success', detail: r.detail, link: r.link, linkLabel: r.linkLabel });
        } else {
          _consoleStep(task.id, 'error', r.detail || 'ผิดพลาด');
          _setTaskStatus(task.id, 'error', 'express', r.detail);
          results.push({ task, status: 'error', detail: r.detail });
          hasError = true;
        }
      } catch (err) {
        const msg = err?.message || String(err);
        _consoleStep(task.id, 'error', msg);
        _setTaskStatus(task.id, 'error', 'express', msg);
        results.push({ task, status: 'error', detail: msg });
        hasError = true;
      }
      done++;
      _consolePct(done, autoTasks.length);
    }

    manualTasks.forEach(t => results.push({ task: t, status: 'manual', detail: 'ต้องทำใน Guided Mode' }));

    _consoleDone(hasError);
    if (btn) { btn.innerHTML = hasError ? '<i data-icon="alert-circle"></i> มี Error' : '<i data-icon="check"></i> Launch Complete'; btn.style.background = hasError ? '#ef4444' : '#16a34a'; if (window.Icons) Icons.replaceAll(btn); }

    _saveHistory(incident, results);
    _showResultPanel(results, incident);
  }

  // ── Result Panel ──────────────────────────────────────
  function _showResultPanel(results, incident) {
    const panel = document.getElementById('il-result-panel');
    const list  = document.getElementById('il-result-list');
    if (!panel || !list) return;

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount   = results.filter(r => r.status === 'error').length;
    const manualCount  = results.filter(r => r.status === 'manual').length;

    // Header summary badge
    const headerHtml = `
      <div class="il-result-summary">
        <span class="il-rs-ok"><i data-icon="check-circle"></i> ${successCount} สำเร็จ</span>
        ${errorCount  ? `<span class="il-rs-err"><i data-icon="x-circle"></i> ${errorCount} ผิดพลาด</span>` : ''}
        ${manualCount ? `<span class="il-rs-manual"><i data-icon="user"></i> ${manualCount} ต้องทำเอง</span>` : ''}
        ${_lastTicket ? `<a href="https://truemoney.atlassian.net/browse/${_escHtml(_lastTicket)}" target="_blank" rel="noopener" class="il-rs-ticket"><i data-icon="ticket"></i> ${_escHtml(_lastTicket)}</a>` : ''}
      </div>`;

    list.innerHTML = headerHtml + results.map(r => {
      const isManual = r.status === 'manual';
      const iconMap = { success: 'check-circle', error: 'x-circle', skip: 'minus-circle', manual: 'user' };
      const clsMap  = { success: 'success', error: 'error', skip: 'skip', manual: 'manual' };
      const iconEl  = `<i data-icon="${iconMap[r.status] || 'circle'}" class="il-result-item-icon il-result-item-icon--${clsMap[r.status] || 'skip'}"></i>`;
      const linkHtml = r.link ? `<a href="${_escHtml(r.link)}" target="_blank" rel="noopener" class="il-result-item-link">${_escHtml(r.linkLabel || r.link)} →</a>` : '';
      const manualHint = isManual ? `<button type="button" class="il-result-manual-btn" onclick="IL.setMode('guided')"><i data-icon="arrow-right"></i> ทำใน Guided Mode</button>` : '';
      return `<div class="il-result-item il-result-item--${clsMap[r.status] || 'skip'}">
        ${iconEl}
        <div class="il-result-item-body">
          <div class="il-result-item-label">${_escHtml(r.task.label)}</div>
          <div class="il-result-item-detail">${_escHtml(r.detail || '')}</div>
          ${linkHtml}${manualHint}
        </div>
      </div>`;
    }).join('');

    panel.style.display = '';
    window.Icons?.replaceAll?.(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _saveHistory(incident, results) {
    try {
      const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      hist.unshift({
        id: Date.now(),
        ts: new Date().toISOString(),
        incident,
        results: results.map(r => ({ taskId: r.task.id, label: r.task.label, status: r.status, detail: r.detail })),
      });
      // Keep last 20
      localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 20)));
    } catch (_) {}
  }

  // ── Config Modal ──────────────────────────────────────
  function openConfig() {
    document.getElementById('il-cfg-webhook').value    = _config.chat_webhook_url || '';
    document.getElementById('il-cfg-partners').value   = (_config.default_partners || []).join(', ');
    document.getElementById('il-cfg-jira-type').value  = _config.jira_issue_type || 'Incident';
    document.getElementById('il-config-modal').style.display = 'flex';
  }

  function closeConfig() {
    document.getElementById('il-config-modal').style.display = 'none';
  }

  async function saveConfig() {
    const cfg = {
      chat_webhook_url: document.getElementById('il-cfg-webhook').value.trim(),
      default_partners: document.getElementById('il-cfg-partners').value
        .split(',').map(s => s.trim()).filter(Boolean),
      jira_issue_type: document.getElementById('il-cfg-jira-type').value.trim() || 'Incident',
    };
    try {
      await API.post('/incident-launcher/index.php', { action: 'save_config', config: cfg });
      _config = cfg;
      closeConfig();
      window.showToast?.('บันทึก config สำเร็จ', 'success');
    } catch (err) {
      window.showToast?.(err?.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  }

  // ── History Modal ─────────────────────────────────────
  function showHistory() {
    const body = document.getElementById('il-history-body');
    try {
      const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!hist.length) {
        body.innerHTML = '<div class="il-empty">ยังไม่มีประวัติ</div>';
      } else {
        body.innerHTML = hist.map(h => {
          const inc = h.incident;
          const dt  = new Date(h.ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
          const ok  = h.results.filter(r => r.status === 'success').length;
          return `<div class="il-history-item">
            <div class="il-history-sev il-history-sev--${inc.severity}">${inc.severity.toUpperCase()}</div>
            <div class="il-history-body">
              <div class="il-history-title">${_escHtml(inc.title)}</div>
              <div class="il-history-meta">${dt} · ${_escHtml(inc.service || '-')} · ${ok}/${h.results.length} tasks สำเร็จ</div>
            </div>
          </div>`;
        }).join('');
      }
    } catch (_) {
      body.innerHTML = '<div class="il-empty">ไม่สามารถโหลดประวัติได้</div>';
    }
    document.getElementById('il-history-modal').style.display = 'flex';
  }

  function closeHistory() {
    document.getElementById('il-history-modal').style.display = 'none';
  }

  // ── Reset ─────────────────────────────────────────────
  function resetForm() {
    document.getElementById('il-title').value   = '';
    document.getElementById('il-service').value = '';
    document.getElementById('il-desc').value    = '';
    document.getElementById('il-chat-url').value = '';
    document.getElementById('il-tags').innerHTML = '';
    _partners = [];
    setSev('sev1');
    _setDefaultTime();
    _prefillReporter();
    _resetTaskStates();
  }

  function resetLaunch() {
    _resetTaskStates();
  }

  // ── Copy Report ───────────────────────────────────────
  function copyReport() {
    const inc = _collectIncident();
    if (!inc) return;
    const lines = [
      `[INCIDENT REPORT] ${inc.severity.toUpperCase()} — ${inc.title}`,
      `Service: ${inc.service || '-'}`,
      `Time: ${inc.time || '-'}`,
      `Reporter: ${inc.reporter || '-'}`,
      ``,
      inc.description,
    ].filter(l => l !== undefined);
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => window.showToast?.('คัดลอก report สำเร็จ', 'success'))
      .catch(() => window.showToast?.('ไม่สามารถคัดลอกได้', 'error'));
  }

  // ── Utils ─────────────────────────────────────────────
  function _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Keyboard shortcuts ────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeConfig(); closeHistory(); closeJenkinsModal(); closeEscalate(); closeImpact(); }
  });

  // ── openWizard: launch ILW wizard with current form data ──
  function openWizard() {
    const inc = {
      title:       document.getElementById('il-title')?.value?.trim()    || '',
      service:     document.getElementById('il-service')?.value?.trim()  || '',
      severity:    _severity || 'sev1',
      time:        document.getElementById('il-time')?.value             || new Date().toISOString().slice(0,16),
      reporter:    document.getElementById('il-reporter')?.value?.trim() || '',
      description: document.getElementById('il-desc')?.value?.trim()    || '',
      partners:    [..._partners],
    };
    IL._getPartners       = () => [..._partners];
    IL._openJenkinsForJob = (job) => { openJenkinsJob(job.id, job.url, job.name); };

    if (!window.ILW) { window.showToast?.('Wizard ยังโหลดไม่เสร็จ — รีเฟรชหน้า', 'error'); return; }

    try {
      ILW.open(inc, _config);
    } catch(e) {
      console.error('[openWizard] ILW.open threw:', e);
    }

    // Failsafe: force display regardless of what happened inside open()
    const ilwEl = document.getElementById('ilw');
    if (ilwEl) ilwEl.style.display = 'flex';
  }

  // ── Boot ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  return {
    setMode, setSev,
    _removeTag, _applyTemplate, _toggleGroup,
    _runTask, launchAll,
    openConfig, closeConfig, saveConfig,
    showHistory, closeHistory,
    resetForm, resetLaunch, copyReport,
    // Channels
    sendChannel, copyChannel, notifyResolved,
    _chShowTab, _chRefreshText,
    // MA
    openJenkinsJob, triggerJenkinsBuild, closeJenkinsModal,
    _markMaDone,
    // Escalate
    openEscalate, closeEscalate, submitEscalate, _escFill,
    // Service Health + Impact
    checkServiceHealth, openImpact, closeImpact, copyImpactReport,
    // Console
    toggleConsole, closeConsole,
    // Wizard
    openWizard,
    launchWithCase, launchCustom,
    _getPartners:     () => [..._partners],
    _getConfig:       () => _config,
    _openJenkinsForJob: null,
  };
})();
