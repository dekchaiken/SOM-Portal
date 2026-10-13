/* ══ Incident Launcher Config — Admin JS ══ */
Auth.requireAuth();
Layout.render('incident-launcher-config');

const ILC = (() => {
  const ADMIN_ROLES = ['sm_admin', 'dev_sm', 'sm_lead'];

  // ── UI helpers (no native alert/confirm) ──────────
  function _toast(msg, type = 'error') {
    if (typeof Toast !== 'undefined') { Toast.show(msg, type); return; }
    if (typeof showToast === 'function') { showToast(msg, type); return; }
    console.warn('[ILC]', msg);
  }

  // Inline confirm banner injected above the target element
  function _confirm(question, onYes) {
    // Remove any existing confirm banner
    document.querySelectorAll('.ilc-confirm-banner').forEach(el => el.remove());
    const banner = document.createElement('div');
    banner.className = 'ilc-confirm-banner';
    banner.innerHTML = `
      <span class="ilc-confirm-msg"><i data-icon="alert-triangle"></i> ${question}</span>
      <div class="ilc-confirm-actions">
        <button class="ilc-btn ghost" onclick="this.closest('.ilc-confirm-banner').remove()">ยกเลิก</button>
        <button class="ilc-btn danger" id="_ilc_confirm_yes">ยืนยัน ลบ</button>
      </div>`;
    // Insert at top of page-content
    const pc = document.querySelector('.page-content');
    if (pc) pc.prepend(banner);
    if (window.Icons) Icons.replaceAll(banner);
    banner.querySelector('#_ilc_confirm_yes').onclick = () => { banner.remove(); onYes(); };
  }

  let _cfg = {
    chat_webhook_url: '',
    meet_main_url: '',
    meet_channel_ids: [],
    meet_msg_tpl: '',
    jira_issue_type: 'Monitoring',
    jira_default_severity: 'sev1',
    jira_summary_tpl: '',
    jira_detected_by: 'Service Monitoring (SM)',
    jira_desc_tpl: '',
    jira_field_defaults: { bu: [], svc: [], chn: [], detected: 'Service Monitoring (SM)', third_party: '' },
    jira_escalate_transition: '',
    partner_groups: [],
    templates: [],
    quick_links: [],
    channels: [],
    ma_jobs: [],
    cases: [],
    jira_preset_fields: [],
    sp_services: ['tmn-mobile-gateway','mobile-auth-service','core-service','wallet-payment-service','vas-service'],
    email_template: { subject: '', body: '' },
  };
  let _jenkinsServers = [];

  const PLATFORM_META = {
    googlechat: { label: 'Google Chat', icon: 'message-square', color: '#1a73e8', authLabel: 'Webhook URL',    authHint: 'https://chat.googleapis.com/v1/spaces/…/messages?key=…',   authPh: 'https://chat.googleapis.com/…' },
    line:       { label: 'LINE Notify',  icon: 'message-circle', color: '#00b900', authLabel: 'LINE Notify Token', authHint: 'Bearer token จาก notify.line.me (ไม่ใส่ Bearer นำหน้า)', authPh: 'xxxxxx…' },
    dingtalk:   { label: 'DingTalk',     icon: 'bell',           color: '#ff6700', authLabel: 'Webhook URL',    authHint: 'Webhook URL ของ DingTalk bot',                            authPh: 'https://oapi.dingtalk.com/robot/send?access_token=…' },
    manual:     { label: 'Manual (Copy)',icon: 'clipboard',       color: '#6b7280', authLabel: '',               authHint: '',                                                        authPh: '' },
  };

  // ── Init ──────────────────────────────────────────────
  async function init() {
    const user = Auth.getUser?.() || JSON.parse(localStorage.getItem('som_user') || '{}');
    if (!ADMIN_ROLES.includes(user?.role)) {
      document.querySelector('.ilc')?.insertAdjacentHTML('afterbegin',
        '<div style="padding:32px;text-align:center;color:var(--text-muted)">เฉพาะ Admin / Lead เท่านั้น</div>'
      );
      return;
    }
    await load();
  }

  async function load() {
    try {
      // API.get() returns {ok, status, data} where data = raw JSON body
      // incident-launcher config uses respond(['config'=>...]) → data = {config:{...}}
      const r = await API.get('/incident-launcher/index.php?action=config');
      const cfg = r?.data?.config;
      if (cfg) _cfg = { ..._cfg, ...cfg };
      _cfg.partner_groups  = _cfg.partner_groups  || [];
      _cfg.templates       = _cfg.templates       || [];
      _cfg.quick_links     = _cfg.quick_links     || [];
      _cfg.channels        = _cfg.channels        || [];
      _cfg.ma_jobs         = _cfg.ma_jobs         || [];
      _cfg.cases           = _cfg.cases           || [];
      _cfg.email_template  = _cfg.email_template  || { subject: '', body: '' };
    } catch (_) {}
    try {
      // jenkins-proxy uses respondOk($list) → data = {success,message,data:[...servers...]}
      const jr = await API.get('/jenkins-proxy/index.php?list=1');
      const srv = jr?.data?.data;
      _jenkinsServers = Array.isArray(srv) ? srv : [];
    } catch (_) { _jenkinsServers = []; }
    _populateStep2();
    _populateStep1(); /* after channels loaded */
    _populateStep3();
    _populateStep7();
    _renderChannels();
    _renderMaJobs();
    _renderCases();
    _renderTemplates();
    _renderGroups();
    _renderEmailTemplate();
    _renderLinks();
    _renderSpServices();
    if (window.Icons) Icons.replaceAll(document.body);

    // Auto-open cases tab if hash says so
    if (window.location.hash === '#cases') ILC.switchTab('cases');
  }

  // ── Tabs ──────────────────────────────────────────────
  const ALL_TABS = ['s1','s2','s3','s4','s5','s6','s7','s8','s9','cases','templates','links'];
  function switchTab(tab) {
    document.querySelectorAll('.ilc-step-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ALL_TABS.forEach(t => {
      const p = document.getElementById(`ilc-panel-${t}`);
      if (p) p.style.display = t === tab ? '' : 'none';
    });
  }

  // ── Channels ──────────────────────────────────────────
  function _renderChannels() {
    const list = document.getElementById('ilc-channel-list');
    const badge = document.getElementById('ilc-tab-ch-count');
    if (badge) badge.textContent = _cfg.channels.length ? _cfg.channels.length : '';
    if (!_cfg.channels.length) {
      list.innerHTML = '<div class="ilc-empty"><i data-icon="send"></i><br>ยังไม่มี channel — กด "เพิ่ม Channel" ด้านบน</div>';
      return;
    }
    list.innerHTML = _cfg.channels.map((c, i) => {
      const pm = PLATFORM_META[c.platform] || PLATFORM_META.manual;
      const hasAuth = c.platform !== 'manual' && c.auth;
      return `
      <div class="ilc-item">
        <div class="ilc-ch-platform" style="background:${pm.color}22;color:${pm.color}">
          <i data-icon="${pm.icon}"></i>
        </div>
        <div class="ilc-item-body">
          <div class="ilc-item-name">${_esc(c.name)}</div>
          <div class="ilc-item-sub">
            <span class="ilc-platform-badge" style="--pc:${pm.color}">${pm.label}</span>
            ${hasAuth ? '<span style="color:var(--ilc-ok)"><i data-icon="check-circle"></i> Webhook ตั้งค่าแล้ว</span>' : '<span style="color:var(--ilc-warn)"><i data-icon="alert-triangle"></i> ยังไม่มี webhook (copy only)</span>'}
          </div>
        </div>
        <div class="ilc-item-actions">
          <button class="icon-btn" onclick="ILC.openChannelForm(${i})" title="แก้ไข"><i data-icon="edit"></i></button>
          <button class="icon-btn danger" onclick="ILC.deleteChannel(${i})" title="ลบ"><i data-icon="trash"></i></button>
        </div>
      </div>`;
    }).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  function openChannelForm(idx = null) {
    closeTemplateForm(); closeGroupForm(); closeLinkForm();
    const form  = document.getElementById('ilc-channel-form');
    const title = document.getElementById('ilc-channel-form-title');
    document.getElementById('ilc-ch-id').value = idx !== null ? idx : '';
    title.textContent = idx !== null ? 'แก้ไข Channel' : 'เพิ่ม Channel';
    if (idx !== null) {
      const c = _cfg.channels[idx];
      document.getElementById('ilc-ch-name').value         = c.name             || '';
      document.getElementById('ilc-ch-platform').value     = c.platform         || 'googlechat';
      document.getElementById('ilc-ch-auth').value         = c.auth             || '';
      document.getElementById('ilc-ch-tpl-alert').value    = c.template_alert   || '';
      document.getElementById('ilc-ch-tpl-resolved').value = c.template_resolved|| '';
    } else {
      ['ilc-ch-name','ilc-ch-auth','ilc-ch-tpl-alert','ilc-ch-tpl-resolved'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('ilc-ch-platform').value = 'googlechat';
    }
    onPlatformChange();
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function onPlatformChange() {
    const platform = document.getElementById('ilc-ch-platform').value;
    const pm = PLATFORM_META[platform] || PLATFORM_META.manual;
    const wrap  = document.getElementById('ilc-ch-auth-wrap');
    const label = document.getElementById('ilc-ch-auth-label');
    const hint  = document.getElementById('ilc-ch-auth-hint');
    const input = document.getElementById('ilc-ch-auth');
    if (platform === 'manual') {
      wrap.style.display = 'none';
    } else {
      wrap.style.display = '';
      label.textContent  = pm.authLabel;
      hint.textContent   = pm.authHint;
      input.placeholder  = pm.authPh;
    }
  }

  function closeChannelForm() { document.getElementById('ilc-channel-form').style.display = 'none'; }

  async function saveChannel() {
    const name = document.getElementById('ilc-ch-name').value.trim();
    if (!name) { _toast('กรุณาระบุชื่อ Channel'); return; }
    const obj = {
      id:               'ch_' + Date.now(),
      name,
      platform:         document.getElementById('ilc-ch-platform').value,
      auth:             document.getElementById('ilc-ch-auth').value.trim(),
      template_alert:   document.getElementById('ilc-ch-tpl-alert').value.trim(),
      template_resolved:document.getElementById('ilc-ch-tpl-resolved').value.trim(),
      enabled:          true,
    };
    const idxStr = document.getElementById('ilc-ch-id').value;
    if (idxStr !== '') {
      _cfg.channels[parseInt(idxStr)] = { ..._cfg.channels[parseInt(idxStr)], ...obj, id: _cfg.channels[parseInt(idxStr)].id };
    } else {
      _cfg.channels.push(obj);
    }
    await _save();
    closeChannelForm();
    _renderChannels();
  }

  async function deleteChannel(idx) {
    const name = _cfg.channels[idx]?.name || 'channel นี้';
    _confirm(`ยืนยันลบ channel "${name}" ?`, async () => {
      _cfg.channels.splice(idx, 1);
      await _save();
      _renderChannels();
    });
  }

  async function testChannel(idx) {
    const c = _cfg.channels[idx];
    if (!c) return;
    if (c.platform === 'manual') { _toast('Manual channel ไม่มี webhook ใช้ Copy เท่านั้น', 'info'); return; }
    const msg = `[TEST] ทดสอบ channel "${c.name}" จาก Incident Launcher Config`;
    try {
      await API.post('/incident-launcher/index.php', { action: 'notify_channel', channel_id: c.id, message: msg });
      _toast(`✓ ส่ง test ไปยัง "${c.name}" สำเร็จ`, 'success');
    } catch (e) {
      _toast(`✗ ส่งไม่สำเร็จ: ${e?.message || 'error'}`, 'error');
    }
  }

  // ── Jira Issue Types ──────────────────────────────────
  async function loadIssueTypes() {
    const btn = document.getElementById('ilc-jira-type-load-btn');
    const sel = document.getElementById('ilc-jira-type');
    if (!sel) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> กำลังโหลด…'; if(window.Icons)Icons.replaceAll(btn); }
    try {
      const r = await API.get('/jira/issue-types.php');
      if (!r?.ok) throw new Error(r?.data?.message || `HTTP ${r?.status}`);
      const raw   = r?.data?.data || r?.data || [];
      const types = (Array.isArray(raw) ? raw : []).map(t => t.name || t).filter(Boolean);
      if (!types.length) throw new Error('ไม่พบ issue types');
      const current = sel.value || _cfg.jira_issue_type || 'Monitoring';
      sel.innerHTML = types.map(t =>
        `<option value="${_esc(t)}" ${t===current?'selected':''}>${_esc(t)}</option>`
      ).join('');
      _toast(`โหลด ${types.length} issue types สำเร็จ`, 'success');
    } catch(e) {
      _toast(`โหลด issue types ไม่สำเร็จ: ${e?.message || ''}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="refresh-cw"></i> โหลดจาก Jira'; if(window.Icons)Icons.replaceAll(btn); }
    }
  }

  // ── Per-step populate ─────────────────────────────────
  function _populateStep1() {
    const el = document.getElementById('ilc-meet-main');
    if (el) el.value = _cfg.meet_main_url || '';
    const tpl = document.getElementById('ilc-meet-msg-tpl');
    if (tpl) tpl.value = _cfg.meet_msg_tpl || '';
    _populateMeetChannelSelect();
  }

  function _populateMeetChannelSelect() {
    const sel = document.getElementById('ilc-meet-channel-id');
    if (!sel) return;
    const channels  = _cfg.channels || [];
    const selected  = new Set(_cfg.meet_channel_ids || []);
    if (!channels.length) {
      sel.innerHTML = '<option value="" disabled>ยังไม่มี channel — ตั้งค่า Step 2 ก่อน</option>';
      return;
    }
    sel.innerHTML = channels.map(c => {
      const PLATFORM_ICONS_MAP = { googlechat:'💬', line:'📱', dingtalk:'🔔', manual:'📋' };
      const icon = PLATFORM_ICONS_MAP[c.platform] || '📢';
      return `<option value="${_esc(c.id)}" ${selected.has(c.id)?'selected':''}>${icon} ${_esc(c.name)}</option>`;
    }).join('');
  }
  function _populateStep2() {
    const el = document.getElementById('ilc-webhook');
    if (el) el.value = _cfg.chat_webhook_url || '';
  }
  function _populateStep3() {
    const _v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    /* jira_type is now a select */
    const jtEl = document.getElementById('ilc-jira-type');
    if (jtEl) jtEl.value = _cfg.jira_issue_type || 'Monitoring';
    _v('ilc-jira-type',         _cfg.jira_issue_type       || 'Monitoring');
    _v('ilc-jira-default-sev',  _cfg.jira_default_severity || 'sev1');
    _v('ilc-jira-summary-tpl',  _cfg.jira_summary_tpl      || '');
    _v('ilc-jira-detected-by',  _cfg.jira_detected_by      || 'Service Monitoring (SM)');
    _v('ilc-jira-desc-tpl',     _cfg.jira_desc_tpl         || '');
    _renderPresetFields();
    /* render field defaults chips — needs options so load lazily */
    _renderFieldDefaults(null);
  }

  /* ── Jira Field Defaults (BU/Service/Channel/Detected/3rd) ── */
  let _jiraOpts = null; // cached from field-options.php

  const FD_KEYS = [
    { key:'bu',          label:'Business Unit Impacted',    cfid:'customfield_17066', multi:true  },
    { key:'svc',         label:'TH Service Impacted',       cfid:'customfield_17024', multi:true  },
    { key:'chn',         label:'TH Channel / Component',    cfid:'customfield_17023', multi:true  },
    { key:'detected',    label:'Detected by',               cfid:'customfield_17016', multi:false },
    { key:'third_party', label:'Caused by 3rd Party',       cfid:'customfield_17238', multi:false },
  ];

  async function loadFieldDefaults() {
    const btn = document.getElementById('ilc-fd-load-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> กำลังโหลด…'; if(window.Icons)Icons.replaceAll(btn); }
    try {
      if (!_jiraOpts) {
        const r = await API.get('/jira/field-options.php');
        if (!r?.ok) throw new Error(r?.data?.message || `HTTP ${r?.status}`);
        _jiraOpts = r?.data?.data || {};
      }
      _renderFieldDefaults(_jiraOpts);
    } catch(e) {
      _toast(`โหลด Jira options ไม่สำเร็จ: ${e?.message || ''}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="refresh-cw"></i> Reload จาก Jira'; if(window.Icons)Icons.replaceAll(btn); }
    }
  }

  function _renderFieldDefaults(opts) {
    const wrap = document.getElementById('ilc-field-defaults-wrap');
    if (!wrap) return;
    const fd      = _cfg.jira_field_defaults || {};
    const hasOpts = !!opts;

    wrap.innerHTML = `<div class="ilc-fd-grid">${FD_KEYS.map(f => {
      const options  = opts?.[f.cfid]?.options || [];
      const selected = f.multi ? (Array.isArray(fd[f.key]) ? fd[f.key] : []) : (fd[f.key] || '');
      const badge    = f.multi
        ? `<span class="ilc-fd-badge ilc-fd-badge--multi">multi</span>`
        : `<span class="ilc-fd-badge">single</span>`;

      if (f.multi) {
        const availOpts = options.filter(o => !selected.includes(o));
        const chips = selected.map(v => `
          <span class="ilc-fd-chip">
            ${_esc(v)}
            <button type="button" onclick="ILC._fdRemoveChip('${_esc(f.key)}','${_esc(v)}')" tabindex="-1"><i data-icon="x"></i></button>
          </span>`).join('');
        return `
          <div class="ilc-fd-field ilc-fd-field--multi">
            <div class="ilc-fd-field-hd">
              <label class="ilc-fd-label">${_esc(f.label)}</label>${badge}
            </div>
            <div class="ilc-fd-chip-area">
              ${chips || `<span class="ilc-fd-empty-chips">ยังไม่มีค่า default — เลือกด้านล่าง</span>`}
            </div>
            ${options.length
              ? `<select class="ilc-fd-select" onchange="ILC._fdAddChip('${_esc(f.key)}',this)">
                  <option value="">+ เพิ่ม default…</option>
                  ${availOpts.map(o=>`<option value="${_esc(o)}">${_esc(o)}</option>`).join('')}
                </select>`
              : `<div class="ilc-fd-load-hint"><i data-icon="cloud-download"></i> กด "โหลดจาก Jira" ด้านบนเพื่อดู options</div>`}
          </div>`;
      } else {
        const inputEl = options.length
          ? `<select class="ilc-fd-select" id="ilc-fd-sel-${f.key}">
              <option value="">— ว่าง —</option>
              ${options.map(o=>`<option value="${_esc(o)}" ${o===selected?'selected':''}>${_esc(o)}</option>`).join('')}
            </select>`
          : `<input class="ilc-fd-input" id="ilc-fd-input-${f.key}" type="text"
              value="${_esc(selected)}" placeholder="เช่น ${_esc(f.label)}">`;
        return `
          <div class="ilc-fd-field">
            <div class="ilc-fd-field-hd">
              <label class="ilc-fd-label">${_esc(f.label)}</label>${badge}
              ${!options.length ? `<span class="ilc-fd-load-hint-inline"><i data-icon="info"></i> โหลดจาก Jira เพื่อดู dropdown</span>` : ''}
            </div>
            ${inputEl}
          </div>`;
      }
    }).join('')}</div>`;
    if (window.Icons) Icons.replaceAll(wrap);
  }

  function _fdAddChip(key, sel) {
    const val = sel.value;
    if (!val) return;
    sel.value = '';
    const fd = _cfg.jira_field_defaults = _cfg.jira_field_defaults || {};
    if (!Array.isArray(fd[key])) fd[key] = [];
    if (!fd[key].includes(val)) {
      fd[key].push(val);
      _renderFieldDefaults(_jiraOpts);
    }
  }

  function _fdRemoveChip(key, val) {
    const fd = _cfg.jira_field_defaults = _cfg.jira_field_defaults || {};
    fd[key] = (fd[key] || []).filter(v => v !== val);
    _renderFieldDefaults(_jiraOpts);
  }

  function _collectFieldDefaults() {
    const fd = _cfg.jira_field_defaults || {};
    const result = {};
    FD_KEYS.forEach(f => {
      if (f.multi) {
        result[f.key] = fd[f.key] || [];
      } else {
        /* single — prefer select, fallback to text input */
        const sel = document.getElementById(`ilc-fd-sel-${f.key}`);
        const inp = document.getElementById(`ilc-fd-input-${f.key}`);
        result[f.key] = sel ? sel.value.trim() : (inp?.value.trim() || fd[f.key] || '');
      }
    });
    return result;
  }
  function _populateStep7() {
    const el = document.getElementById('ilc-escalate-tid');
    if (el) el.value = _cfg.jira_escalate_transition || '';
  }
  // keep alias for legacy callers
  function _populateGeneral() { _populateStep1(); _populateStep2(); _populateStep3(); _populateStep7(); }

  function _renderPresetFields() {
    const list = document.getElementById('ilc-preset-fields-list');
    if (!list) return;
    const fields = _cfg.jira_preset_fields || [];
    if (!fields.length) {
      list.innerHTML = '<div class="ilc-empty" style="padding:16px 0"><i data-icon="list"></i><br>ยังไม่มี preset field — กด "เพิ่ม Field" ด้านบน</div>';
      if (window.Icons) Icons.replaceAll(list);
      return;
    }
    list.innerHTML = fields.map((f, i) => `
      <div class="ilc-preset-row" id="ilc-pf-${i}">
        <div class="ilc-preset-col">
          <label class="ilc-pf-label">Field ID</label>
          <input class="ilc-pf-input" id="ilc-pf-fid-${i}" type="text" value="${_esc(f.field_id)}" placeholder="customfield_17031">
        </div>
        <div class="ilc-preset-col">
          <label class="ilc-pf-label">Label (แสดงผล)</label>
          <input class="ilc-pf-input" id="ilc-pf-lbl-${i}" type="text" value="${_esc(f.label)}" placeholder="เช่น TH Severity">
        </div>
        <div class="ilc-preset-col ilc-preset-col--wide">
          <label class="ilc-pf-label">Default Value</label>
          <input class="ilc-pf-input" id="ilc-pf-val-${i}" type="text" value="${_esc(f.value)}" placeholder="ค่าที่ต้องการ preset">
        </div>
        <button class="icon-btn danger ilc-pf-del" onclick="ILC.removePresetField(${i})" title="ลบ"><i data-icon="trash"></i></button>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  function addPresetField(fieldId = '', label = '') {
    _cfg.jira_preset_fields = _cfg.jira_preset_fields || [];
    _cfg.jira_preset_fields.push({ field_id: fieldId, label, value: '' });
    _renderPresetFields();
    const list = document.getElementById('ilc-preset-fields-list');
    list?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function removePresetField(idx) {
    _cfg.jira_preset_fields = (_cfg.jira_preset_fields || []).filter((_, i) => i !== idx);
    _renderPresetFields();
  }

  // ── SP Services (Step 8) ─────────────────────────────
  let _spSearchTimer = null;
  let _spDropActive  = -1; // keyboard nav index

  function _renderSpServices() {
    const list   = document.getElementById('ilc-sp-services-list');
    const badge  = document.getElementById('ilc-tab-sp-count');
    const badge2 = document.getElementById('ilc-tab-sp-count2');
    const svcs   = _cfg.sp_services || [];
    if (badge)  badge.textContent  = svcs.length || '';
    if (badge2) badge2.textContent = svcs.length || '';
    if (!list) return;
    if (!svcs.length) {
      list.innerHTML = '<div class="ilc-empty" style="padding:14px 0"><i data-icon="activity"></i><br>ยังไม่มี service — ค้นหาด้านบนแล้วคลิกเพิ่ม</div>';
      if (window.Icons) Icons.replaceAll(list);
      return;
    }
    list.innerHTML = svcs.map((s, i) => `
      <div class="ilc-sp-svc-row" draggable="true"
        ondragstart="ILC._spDragStart(event,${i})"
        ondragover="event.preventDefault();ILC._spDragOver(event,${i})"
        ondrop="ILC._spDrop(event,${i})"
        id="ilc-svc-row-${i}">
        <div class="ilc-sp-svc-drag"><i data-icon="grip-vertical"></i></div>
        <div class="ilc-sp-svc-num">${i + 1}</div>
        <div class="ilc-sp-svc-name">${_esc(s)}</div>
        <a href="../service-performance.html?service=${encodeURIComponent(s)}" target="_blank"
           class="ilc-sp-svc-link" title="ดูหน้า Service Performance">
          <i data-icon="external-link"></i>
        </a>
        <button class="icon-btn danger" onclick="ILC.removeSpService(${i})" title="ลบ">
          <i data-icon="trash"></i>
        </button>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  /* drag-reorder */
  let _spDragFrom = -1;
  function _spDragStart(e, i) { _spDragFrom = i; e.dataTransfer.effectAllowed = 'move'; }
  function _spDragOver(e, i) {
    e.preventDefault();
    document.querySelectorAll('.ilc-sp-svc-row').forEach((r,j) => r.classList.toggle('drag-over', j === i && i !== _spDragFrom));
  }
  function _spDrop(e, i) {
    e.preventDefault();
    document.querySelectorAll('.ilc-sp-svc-row').forEach(r => r.classList.remove('drag-over'));
    if (_spDragFrom === -1 || _spDragFrom === i) return;
    const svcs = _cfg.sp_services || [];
    const item = svcs.splice(_spDragFrom, 1)[0];
    svcs.splice(i, 0, item);
    _cfg.sp_services = svcs;
    _spDragFrom = -1;
    _renderSpServices();
  }

  async function spSearch(q) {
    const dropdown = document.getElementById('ilc-sp-dropdown');
    const status   = document.getElementById('ilc-sp-search-status');
    _spDropActive  = -1;
    clearTimeout(_spSearchTimer);
    if (!q.trim()) { if (dropdown) dropdown.style.display = 'none'; return; }
    if (status) { status.textContent = ''; }

    _spSearchTimer = setTimeout(async () => {
      if (status) status.innerHTML = '<i data-icon="loader"></i>';
      if (window.Icons) Icons.replaceAll(status);
      try {
        const r = await API.get(`/service-performance/suggestions.php?q=${encodeURIComponent(q)}&limit=15`);
        const suggestions = r?.data?.data?.suggestions || [];
        _renderSpDropdown(suggestions, q);
      } catch(e) {
        if (dropdown) dropdown.style.display = 'none';
      } finally {
        if (status) { status.textContent = ''; }
      }
    }, 220);
  }

  function _renderSpDropdown(suggestions, q) {
    const dropdown = document.getElementById('ilc-sp-dropdown');
    const selected = new Set(_cfg.sp_services || []);
    if (!dropdown) return;
    if (!suggestions.length) {
      dropdown.innerHTML = `<div class="ilc-sp-drop-empty">ไม่พบ service ที่ตรงกับ "${_esc(q)}"</div>`;
      dropdown.style.display = '';
      return;
    }
    const highlight = (text) => {
      const i = text.toLowerCase().indexOf(q.toLowerCase());
      if (i === -1) return _esc(text);
      return _esc(text.slice(0,i)) + `<mark>${_esc(text.slice(i,i+q.length))}</mark>` + _esc(text.slice(i+q.length));
    };
    dropdown.innerHTML = suggestions.map((s, i) => {
      const name   = s.service || s;
      const added  = selected.has(name);
      const source = s.source === 'grafana' ? `<span class="ilc-sp-drop-src grafana">Grafana</span>` : `<span class="ilc-sp-drop-src csv">CSV</span>`;
      return `<div class="ilc-sp-drop-item ${added?'added':''}" data-idx="${i}" data-name="${_esc(name)}"
        onclick="${added?'':` ILC.spAddService('${_esc(name)}')`}"
        onmouseover="ILC._spDropHighlight(${i})">
        <div class="ilc-sp-drop-item-body">
          <span class="ilc-sp-drop-name">${highlight(name)}</span>
          ${source}
        </div>
        ${added ? `<span class="ilc-sp-drop-added"><i data-icon="check"></i> เพิ่มแล้ว</span>`
                : `<span class="ilc-sp-drop-add"><i data-icon="plus"></i> เพิ่ม</span>`}
      </div>`;
    }).join('');
    dropdown.style.display = '';
    if (window.Icons) Icons.replaceAll(dropdown);
  }

  function _spDropHighlight(i) { _spDropActive = i; }

  function spSearchKeydown(e) {
    const dropdown = document.getElementById('ilc-sp-dropdown');
    const items = dropdown?.querySelectorAll('.ilc-sp-drop-item:not(.added)');
    if (!items?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); _spDropActive = Math.min(_spDropActive+1, items.length-1); _spHighlightDropItem(items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _spDropActive = Math.max(_spDropActive-1, 0); _spHighlightDropItem(items); }
    else if (e.key === 'Enter' && _spDropActive >= 0) {
      e.preventDefault();
      const name = items[_spDropActive]?.dataset.name;
      if (name) spAddService(name);
    } else if (e.key === 'Escape') { if (dropdown) dropdown.style.display = 'none'; }
  }

  function _spHighlightDropItem(items) {
    items.forEach((el, i) => el.classList.toggle('hover', i === _spDropActive));
    items[_spDropActive]?.scrollIntoView({ block:'nearest' });
  }

  function spAddService(name) {
    if (!name) return;
    _cfg.sp_services = _cfg.sp_services || [];
    if (_cfg.sp_services.includes(name)) {
      _toast(`"${name}" มีอยู่แล้ว`, 'warn'); return;
    }
    _cfg.sp_services.push(name);
    _renderSpServices();
    /* re-render dropdown to mark as added */
    const search = document.getElementById('ilc-sp-search');
    if (search?.value) {
      const items = document.querySelectorAll('.ilc-sp-drop-item');
      items.forEach(el => { if (el.dataset.name === name) { el.classList.add('added'); el.onclick=null; el.querySelector('.ilc-sp-drop-add')?.replaceWith(Object.assign(document.createElement('span'),{className:'ilc-sp-drop-added',innerHTML:'<i data-icon="check"></i> เพิ่มแล้ว'})); if(window.Icons)Icons.replaceAll(el); } });
    }
  }

  function addSpService() { /* legacy — no longer used */ }

  function removeSpService(idx) {
    _cfg.sp_services = (_cfg.sp_services || []).filter((_, i) => i !== idx);
    _renderSpServices();
  }

  function _collectSpServices() {
    return (_cfg.sp_services || []).filter(Boolean);
  }

  // ── Jira Field Picker ─────────────────────────────────
  let _jiraFieldsCache = null;

  async function loadJiraFields() {
    const btn = document.getElementById('ilc-jira-fields-load-btn');
    const modal = document.getElementById('ilc-jira-fields-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    const list = document.getElementById('ilc-jira-fields-list');
    if (list) list.innerHTML = '<div class="ilc-empty" style="padding:24px 0"><i data-icon="loader"></i><br>กำลังโหลด fields จาก Jira…</div>';
    if (window.Icons) Icons.replaceAll(list);

    if (!_jiraFieldsCache) {
      try {
        const r = await API.get('/jira/fields.php');
        if (!r?.ok) throw new Error(r?.data?.message || `HTTP ${r?.status}`);
        _jiraFieldsCache = r?.data?.data || [];
      } catch (e) {
        if (list) list.innerHTML = `<div class="ilc-empty" style="padding:24px 0;color:#ef4444"><i data-icon="alert-circle"></i><br>โหลดไม่สำเร็จ: ${_esc(e?.message || 'error')}</div>`;
        if (window.Icons) Icons.replaceAll(list);
        return;
      }
    }
    _renderJiraFieldsList(_jiraFieldsCache, '');
    const search = document.getElementById('ilc-jira-fields-search');
    if (search) { search.value = ''; search.focus(); }
  }

  function _renderJiraFieldsList(fields, q) {
    const list = document.getElementById('ilc-jira-fields-list');
    if (!list) return;
    const filtered = q
      ? fields.filter(f => f.name.toLowerCase().includes(q.toLowerCase()) || f.id.includes(q))
      : fields;
    if (!filtered.length) {
      list.innerHTML = `<div class="ilc-empty" style="padding:16px 0">ไม่พบ field ที่ตรงกับ "${_esc(q)}"</div>`;
      return;
    }
    list.innerHTML = filtered.map(f => {
      const existing = (_cfg.jira_preset_fields || []).some(p => p.field_id === f.id);
      return `
        <div class="ilc-jira-field-row ${existing ? 'ilc-jira-field-row--added' : ''}" onclick="ILC._pickJiraField('${_esc(f.id)}','${_esc(f.name)}')">
          <div class="ilc-jira-field-id">${_esc(f.id)}</div>
          <div class="ilc-jira-field-body">
            <div class="ilc-jira-field-name">${_esc(f.name)}</div>
            <div class="ilc-jira-field-type">${_esc(f.type || '')}</div>
          </div>
          ${existing ? '<span class="ilc-jira-field-added"><i data-icon="check"></i> เพิ่มแล้ว</span>' : '<span class="ilc-jira-field-pick"><i data-icon="plus"></i> เพิ่ม</span>'}
        </div>`;
    }).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  function filterJiraFields(q) {
    if (!_jiraFieldsCache) return;
    _renderJiraFieldsList(_jiraFieldsCache, q);
  }

  function _pickJiraField(fieldId, label) {
    const exists = (_cfg.jira_preset_fields || []).some(f => f.field_id === fieldId);
    if (exists) { _toast(`"${label}" มีอยู่แล้ว`, 'warn'); return; }
    addPresetField(fieldId, label);
    _renderJiraFieldsList(_jiraFieldsCache || [], document.getElementById('ilc-jira-fields-search')?.value || '');
    _toast(`เพิ่ม "${label}" แล้ว`, 'success');
  }

  function closeJiraFieldsModal() {
    const modal = document.getElementById('ilc-jira-fields-modal');
    if (modal) modal.style.display = 'none';
  }

  function _collectPresetFields() {
    const fields = _cfg.jira_preset_fields || [];
    return fields.map((_, i) => ({
      field_id: (document.getElementById(`ilc-pf-fid-${i}`)?.value || '').trim(),
      label:    (document.getElementById(`ilc-pf-lbl-${i}`)?.value || '').trim(),
      value:    (document.getElementById(`ilc-pf-val-${i}`)?.value || '').trim(),
    })).filter(f => f.field_id);
  }

  async function saveGeneral() {
    _cfg.chat_webhook_url         = document.getElementById('ilc-webhook')?.value.trim()      || '';
    _cfg.jira_issue_type          = document.getElementById('ilc-jira-type')?.value.trim()    || 'Incident';
    _cfg.jira_escalate_transition = document.getElementById('ilc-escalate-tid')?.value.trim() || '';
    _cfg.jira_preset_fields       = _collectPresetFields();
    await _save();
  }

  function validateMeetUrl(input) {
    const val  = input.value.trim();
    const hint = document.getElementById('ilc-meet-main-hint');
    if (!val) { input.style.borderColor = ''; if (hint) hint.style.color = ''; return; }
    const ok = val.startsWith('https://meet.google.com/');
    input.style.borderColor = ok ? '#22c55e' : '#ef4444';
    if (hint) hint.style.color = ok ? '' : '#ef4444';
    if (!ok && hint) hint.innerHTML = `<strong>URL ไม่ถูกต้อง!</strong> ต้องขึ้นต้นด้วย <code>https://meet.google.com/</code> — อย่าใส่ Webhook URL ที่นี่`;
  }

  async function saveStep1() {
    const meetVal = document.getElementById('ilc-meet-main')?.value.trim() || '';
    if (meetVal && !meetVal.startsWith('https://meet.google.com/')) {
      _toast('Meet URL ไม่ถูกต้อง — ต้องขึ้นต้นด้วย https://meet.google.com/', 'error');
      document.getElementById('ilc-meet-main')?.focus();
      return;
    }
    _cfg.meet_main_url    = meetVal;
    _cfg.meet_msg_tpl     = document.getElementById('ilc-meet-msg-tpl')?.value.trim() || '';
    const sel = document.getElementById('ilc-meet-channel-id');
    _cfg.meet_channel_ids = sel ? Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean) : [];
    await _save();
  }
  async function saveStep2() {
    _cfg.chat_webhook_url = document.getElementById('ilc-webhook')?.value.trim() || '';
    await _save();
  }
  async function saveStep3() {
    _cfg.jira_issue_type       = document.getElementById('ilc-jira-type')?.value.trim()         || 'Monitoring';
    _cfg.jira_default_severity = document.getElementById('ilc-jira-default-sev')?.value         || 'sev1';
    _cfg.jira_summary_tpl      = document.getElementById('ilc-jira-summary-tpl')?.value.trim()  || '';
    _cfg.jira_detected_by      = document.getElementById('ilc-jira-detected-by')?.value.trim()  || '';
    _cfg.jira_desc_tpl         = document.getElementById('ilc-jira-desc-tpl')?.value.trim()     || '';
    _cfg.jira_preset_fields    = _collectPresetFields();
    _cfg.jira_field_defaults   = _collectFieldDefaults();
    await _save();
  }
  async function saveStep7() {
    _cfg.jira_escalate_transition = document.getElementById('ilc-escalate-tid')?.value.trim() || '';
    await _save();
  }
  async function saveStep8() {
    _cfg.sp_services = _collectSpServices();
    await _save();
  }

  async function lookupEscalateTransition() {
    const key    = document.getElementById('ilc-escalate-lookup-key').value.trim();
    const status = document.getElementById('ilc-escalate-lookup-status');
    if (!key) { status.textContent = 'ใส่ ticket key ก่อน เช่น SMC-10461'; return; }
    status.textContent = 'กำลังค้นหา…';
    try {
      // respond(['transitions'=>...]) → r.data = {transitions:[...]}
      const r = await API.get(`/incident-launcher/index.php?action=jira_transitions&key=${encodeURIComponent(key)}`);
      const transitions = r?.data?.transitions || [];
      const escalate = transitions.find(t => t.name?.toLowerCase().includes('escalate'));
      if (escalate) {
        document.getElementById('ilc-escalate-tid').value = escalate.id;
        status.textContent = `✓ พบ: "${escalate.name}" (ID: ${escalate.id})`;
        _cfg.jira_escalate_transition = escalate.id;
      } else {
        const names = transitions.map(t => `"${t.name}"(${t.id})`).join(', ');
        status.textContent = `ไม่พบ Escalate — transitions ที่มี: ${names || '(ว่าง)'}`;
      }
    } catch (e) {
      status.textContent = `Error: ${e?.message || 'ไม่สำเร็จ'}`;
    }
  }

  async function testWebhook() {
    const url = document.getElementById('ilc-webhook').value.trim();
    const status = document.getElementById('ilc-webhook-test-status');
    if (!url) { if (status) status.textContent = 'กรุณาใส่ Webhook URL ก่อน'; return; }
    if (status) status.textContent = 'กำลังส่ง…';
    try {
      await API.post('/incident-launcher/index.php', {
        action: 'webhook', url,
        text: '✅ [SOM] ทดสอบ Webhook จาก Incident Launcher Config — ถ้าเห็นข้อความนี้แสดงว่า Webhook ทำงานปกติ',
      });
      if (status) status.textContent = '✓ ส่งสำเร็จ — เช็ค Google Chat ได้เลย';
    } catch (e) {
      if (status) status.textContent = `✗ Error: ${e?.message || 'ส่งไม่สำเร็จ'}`;
    }
  }

  // ── Templates ─────────────────────────────────────────
  function _renderTemplates() {
    const list = document.getElementById('ilc-template-list');
    const badge = document.getElementById('ilc-step-tpl-count');
    if (badge) badge.textContent = _cfg.templates.length ? _cfg.templates.length : '';
    if (!_cfg.templates.length) { list.innerHTML = '<div class="ilc-empty">ยังไม่มี template — กด "เพิ่ม Template" ด้านบน</div>'; return; }
    list.innerHTML = _cfg.templates.map((t, i) => `
      <div class="ilc-item">
        <div class="ilc-item-icon" style="background:${t.color || '#6366f1'}22;color:${t.color || '#6366f1'}">
          <i data-icon="${t.icon || 'zap'}"></i>
        </div>
        <div class="ilc-item-body">
          <div class="ilc-item-name">${_esc(t.name)}</div>
          <div class="ilc-item-sub">
            ${t.service ? `Service: <strong>${_esc(t.service)}</strong> · ` : ''}
            <span class="ilc-sev ilc-sev--${t.severity || 'sev1'}">${(t.severity || 'sev1').toUpperCase()}</span>
            ${t.partner_group_ids?.length ? ` · ${t.partner_group_ids.length} partner group` : ''}
          </div>
        </div>
        <div class="ilc-item-actions">
          <button class="icon-btn" onclick="ILC.openTemplateForm(${i})" title="แก้ไข"><i data-icon="edit"></i></button>
          <button class="icon-btn danger" onclick="ILC.deleteTemplate(${i})" title="ลบ"><i data-icon="trash"></i></button>
        </div>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  function openTemplateForm(idx = null) {
    closeGroupForm(); closeLinkForm();
    const form = document.getElementById('ilc-template-form');
    const title = document.getElementById('ilc-template-form-title');
    document.getElementById('ilc-tpl-id').value = idx !== null ? idx : '';
    if (idx !== null) {
      const t = _cfg.templates[idx];
      title.textContent = 'แก้ไข Template';
      document.getElementById('ilc-tpl-name').value    = t.name    || '';
      document.getElementById('ilc-tpl-icon').value    = t.icon    || 'zap';
      document.getElementById('ilc-tpl-color').value   = t.color   || '#ef4444';
      document.getElementById('ilc-tpl-service').value = t.service || '';
      document.getElementById('ilc-tpl-sev').value     = t.severity|| 'sev1';
      document.getElementById('ilc-tpl-desc').value    = t.description || '';
    } else {
      title.textContent = 'เพิ่ม Template';
      ['ilc-tpl-name','ilc-tpl-service','ilc-tpl-desc'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('ilc-tpl-icon').value  = 'zap';
      document.getElementById('ilc-tpl-color').value = '#ef4444';
      document.getElementById('ilc-tpl-sev').value   = 'sev1';
    }
    _renderPartnerChecks(idx !== null ? _cfg.templates[idx]?.partner_group_ids || [] : []);
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _renderPartnerChecks(selected = []) {
    const wrap = document.getElementById('ilc-tpl-partner-checks');
    if (!_cfg.partner_groups.length) { wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">ยังไม่มี Partner Group — สร้างใน tab "Partner Groups" ก่อน</span>'; return; }
    wrap.innerHTML = _cfg.partner_groups.map(g => `
      <label class="ilc-check-item">
        <input type="checkbox" value="${g.id}" ${selected.includes(g.id) ? 'checked' : ''}>
        <span style="width:8px;height:8px;border-radius:50%;background:${g.color || '#3b82f6'};flex-shrink:0"></span>
        ${_esc(g.name)}
      </label>`).join('');
  }

  function closeTemplateForm() { document.getElementById('ilc-template-form').style.display = 'none'; }

  async function saveTemplate() {
    const name = document.getElementById('ilc-tpl-name').value.trim();
    if (!name) { _toast('กรุณาระบุชื่อ Template'); return; }
    const checks = [...document.querySelectorAll('#ilc-tpl-partner-checks input:checked')].map(c => c.value);
    const obj = {
      id:              'tpl_' + Date.now(),
      name,
      icon:            document.getElementById('ilc-tpl-icon').value.trim()  || 'zap',
      color:           document.getElementById('ilc-tpl-color').value,
      service:         document.getElementById('ilc-tpl-service').value.trim(),
      severity:        document.getElementById('ilc-tpl-sev').value,
      description:     document.getElementById('ilc-tpl-desc').value.trim(),
      partner_group_ids: checks,
    };
    const idxStr = document.getElementById('ilc-tpl-id').value;
    if (idxStr !== '') { _cfg.templates[parseInt(idxStr)] = { ..._cfg.templates[parseInt(idxStr)], ...obj, id: _cfg.templates[parseInt(idxStr)].id }; }
    else { _cfg.templates.push(obj); }
    await _save();
    closeTemplateForm();
    _renderTemplates();
  }

  async function deleteTemplate(idx) {
    const name = _cfg.templates[idx]?.name || 'template นี้';
    _confirm(`ยืนยันลบ template "${name}" ?`, async () => {
      _cfg.templates.splice(idx, 1);
      await _save();
      _renderTemplates();
    });
    return;
  }

  // ── Partner Groups ────────────────────────────────────
  function _renderGroups() {
    const list = document.getElementById('ilc-group-list');
    const badge = document.getElementById('ilc-step-grp-count');
    if (badge) badge.textContent = _cfg.partner_groups.length ? _cfg.partner_groups.length : '';
    if (!_cfg.partner_groups.length) { list.innerHTML = '<div class="ilc-empty">ยังไม่มี partner group</div>'; return; }
    list.innerHTML = _cfg.partner_groups.map((g, i) => `
      <div class="ilc-item">
        <div class="ilc-item-dot" style="background:${g.color || '#3b82f6'}"></div>
        <div class="ilc-item-body">
          <div class="ilc-item-name">${_esc(g.name)}
            ${(g.to_emails||g.emails||[]).length ? `<span class="ilc-platform-badge" style="--pc:#3b82f6">TO ${(g.to_emails||g.emails||[]).length}</span>` : ''}
            ${(g.cc_emails||[]).length  ? `<span class="ilc-platform-badge" style="--pc:#6366f1">CC ${g.cc_emails.length}</span>` : ''}
            ${(g.bcc_emails||[]).length ? `<span class="ilc-platform-badge" style="--pc:#6b7280">BCC ${g.bcc_emails.length}</span>` : ''}
          </div>
          <div class="ilc-item-sub">${(g.to_emails||g.emails||[]).length} To · ${(g.cc_emails||[]).length} CC · ${(g.bcc_emails||[]).length} BCC</div>
        </div>
        <div class="ilc-item-actions">
          <button class="icon-btn" onclick="ILC.openGroupForm(${i})" title="แก้ไข"><i data-icon="edit"></i></button>
          <button class="icon-btn danger" onclick="ILC.deleteGroup(${i})" title="ลบ"><i data-icon="trash"></i></button>
        </div>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  function openGroupForm(idx = null) {
    closeTemplateForm(); closeLinkForm();
    const form = document.getElementById('ilc-group-form');
    document.getElementById('ilc-group-form-title').textContent = idx !== null ? 'แก้ไข Partner Group' : 'เพิ่ม Partner Group';
    document.getElementById('ilc-grp-id').value = idx !== null ? idx : '';
    if (idx !== null) {
      const g = _cfg.partner_groups[idx];
      // backward compat: old flat emails → to_emails
      const toOld = g.to_emails || (g.emails?.length && !g.cc_emails && !g.bcc_emails ? g.emails : g.to_emails) || [];
      document.getElementById('ilc-grp-name').value        = g.name  || '';
      document.getElementById('ilc-grp-color').value       = g.color || '#3b82f6';
      document.getElementById('ilc-grp-to-emails').value   = (toOld || []).join('\n');
      document.getElementById('ilc-grp-cc-emails').value   = (g.cc_emails  || []).join('\n');
      document.getElementById('ilc-grp-bcc-emails').value  = (g.bcc_emails || []).join('\n');
    } else {
      document.getElementById('ilc-grp-name').value        = '';
      document.getElementById('ilc-grp-color').value       = '#3b82f6';
      document.getElementById('ilc-grp-to-emails').value   = '';
      document.getElementById('ilc-grp-cc-emails').value   = '';
      document.getElementById('ilc-grp-bcc-emails').value  = '';
    }
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Wire live preview on each textarea
    ['to','cc','bcc'].forEach(f => {
      const ta = document.getElementById(`ilc-grp-${f}-emails`);
      if (ta && !ta.dataset.previewWired) {
        ta.dataset.previewWired = '1';
        ta.addEventListener('input', () => _renderEmailPreview(f));
      }
      _renderEmailPreview(f);
    });
  }

  function _renderEmailPreview(field) {
    const ta      = document.getElementById(`ilc-grp-${field}-emails`);
    const preview = document.getElementById(`ilc-grp-${field}-preview`);
    if (!ta || !preview) return;
    const emails = _parseEmails(ta.value);
    if (!emails.length) { preview.innerHTML = ''; return; }
    const colors = { to: '#3b82f6', cc: '#6366f1', bcc: '#6b7280' };
    const c = colors[field] || '#3b82f6';
    preview.innerHTML = `
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:5px">
        ${field.toUpperCase()}: พบ ${emails.length} email
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${emails.map(e => `<span style="padding:2px 8px;border-radius:10px;font-size:10.5px;background:${c}18;color:${c};border:1px solid ${c}33">${_esc(e)}</span>`).join('')}
      </div>`;
  }

  function closeGroupForm() {
    document.getElementById('ilc-group-form').style.display = 'none';
    ['to','cc','bcc'].forEach(f => {
      const preview = document.getElementById(`ilc-grp-${f}-preview`);
      if (preview) preview.innerHTML = '';
    });
  }

  function _parseEmails(raw) {
    // Handle: plain email, Name <email>, "Name" <email>, name@domain
    const results = [];
    const parts = raw.split(/[\n,]+/);
    parts.forEach(part => {
      part = part.trim();
      if (!part) return;
      // Extract from angle-bracket format: "Name <email@domain>"
      const angleMatch = part.match(/<([^>]+@[^>]+)>/);
      if (angleMatch) { results.push(angleMatch[1].trim()); return; }
      // Plain email
      const plainMatch = part.match(/[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
      if (plainMatch) { results.push(plainMatch[0].trim()); }
    });
    return [...new Set(results)]; // deduplicate
  }

  async function saveGroup() {
    const name = document.getElementById('ilc-grp-name').value.trim();
    if (!name) { _toast('กรุณาระบุชื่อกลุ่ม'); return; }
    const toEmails  = _parseEmails(document.getElementById('ilc-grp-to-emails')?.value  || '');
    const ccEmails  = _parseEmails(document.getElementById('ilc-grp-cc-emails')?.value  || '');
    const bccEmails = _parseEmails(document.getElementById('ilc-grp-bcc-emails')?.value || '');
    if (!toEmails.length && !ccEmails.length && !bccEmails.length) {
      _toast('กรุณาใส่ email อย่างน้อย 1 ที่อยู่ใน To, CC หรือ BCC'); return;
    }
    const obj = {
      id:        'grp_' + Date.now(),
      name,
      color:     document.getElementById('ilc-grp-color').value,
      to_emails:  toEmails,
      cc_emails:  ccEmails,
      bcc_emails: bccEmails,
      // keep flat emails for backward compat with old code
      emails:     toEmails,
    };
    const idxStr = document.getElementById('ilc-grp-id').value;
    if (idxStr !== '') { _cfg.partner_groups[parseInt(idxStr)] = { ..._cfg.partner_groups[parseInt(idxStr)], ...obj, id: _cfg.partner_groups[parseInt(idxStr)].id }; }
    else { _cfg.partner_groups.push(obj); }
    await _save();
    closeGroupForm();
    _renderGroups();
  }

  async function deleteGroup(idx) {
    const name = _cfg.partner_groups[idx]?.name || 'group นี้';
    _confirm(`ยืนยันลบ group "${name}" ?`, async () => {
      const gid = _cfg.partner_groups[idx]?.id;
      _cfg.partner_groups.splice(idx, 1);
      _cfg.templates.forEach(t => { if (t.partner_group_ids) t.partner_group_ids = t.partner_group_ids.filter(id => id !== gid); });
      await _save();
      _renderGroups();
    });
    return;
  }

  // ── Email Template ────────────────────────────────────
  function _renderEmailTemplate() {
    const subj = document.getElementById('ilc-email-tpl-subject');
    const body = document.getElementById('ilc-email-tpl-body');
    if (subj) subj.value = _cfg.email_template?.subject || '';
    if (body) body.value = _cfg.email_template?.body    || '';
  }

  async function saveEmailTemplate() {
    const subject = (document.getElementById('ilc-email-tpl-subject')?.value || '').trim();
    const body    = (document.getElementById('ilc-email-tpl-body')?.value    || '').trim();
    _cfg.email_template = { subject, body };
    await _save();
    _toast('บันทึก Email Template แล้ว');
  }

  // ── Quick Links ───────────────────────────────────────
  function _renderLinks() {
    const list = document.getElementById('ilc-link-list');
    const badge = document.getElementById('ilc-step-lnk-count');
    if (badge) badge.textContent = _cfg.quick_links.length ? _cfg.quick_links.length : '';
    if (!_cfg.quick_links.length) { list.innerHTML = '<div class="ilc-empty">ยังไม่มี quick link</div>'; return; }
    list.innerHTML = _cfg.quick_links.map((l, i) => `
      <div class="ilc-item">
        <div class="ilc-item-icon" style="background:rgba(99,102,241,.1);color:var(--accent,#6366f1)">
          <i data-icon="${l.icon || 'link'}"></i>
        </div>
        <div class="ilc-item-body">
          <div class="ilc-item-name">${_esc(l.label)}</div>
          <div class="ilc-item-sub" style="word-break:break-all">${_esc(l.url)}</div>
        </div>
        <div class="ilc-item-actions">
          <button class="icon-btn" onclick="ILC.openLinkForm(${i})" title="แก้ไข"><i data-icon="edit"></i></button>
          <button class="icon-btn danger" onclick="ILC.deleteLink(${i})" title="ลบ"><i data-icon="trash"></i></button>
        </div>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  function openLinkForm(idx = null) {
    closeTemplateForm(); closeGroupForm();
    const form = document.getElementById('ilc-link-form');
    document.getElementById('ilc-link-form-title').textContent = idx !== null ? 'แก้ไข Quick Link' : 'เพิ่ม Quick Link';
    document.getElementById('ilc-lnk-id').value = idx !== null ? idx : '';
    if (idx !== null) {
      const l = _cfg.quick_links[idx];
      document.getElementById('ilc-lnk-label').value = l.label || '';
      document.getElementById('ilc-lnk-icon').value  = l.icon  || 'link';
      document.getElementById('ilc-lnk-url').value   = l.url   || '';
    } else {
      ['ilc-lnk-label','ilc-lnk-url'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('ilc-lnk-icon').value = 'link';
    }
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeLinkForm() { document.getElementById('ilc-link-form').style.display = 'none'; }

  async function saveLink() {
    const label = document.getElementById('ilc-lnk-label').value.trim();
    const url   = document.getElementById('ilc-lnk-url').value.trim();
    if (!label || !url) { _toast('กรุณาระบุ Label และ URL'); return; }
    const obj = { id: 'lnk_' + Date.now(), label, icon: document.getElementById('ilc-lnk-icon').value.trim() || 'link', url };
    const idxStr = document.getElementById('ilc-lnk-id').value;
    if (idxStr !== '') { _cfg.quick_links[parseInt(idxStr)] = { ..._cfg.quick_links[parseInt(idxStr)], ...obj, id: _cfg.quick_links[parseInt(idxStr)].id }; }
    else { _cfg.quick_links.push(obj); }
    await _save();
    closeLinkForm();
    _renderLinks();
  }

  async function deleteLink(idx) {
    const label = _cfg.quick_links[idx]?.label || 'link นี้';
    _confirm(`ยืนยันลบ link "${label}" ?`, async () => {
      _cfg.quick_links.splice(idx, 1);
      await _save();
      _renderLinks();
    });
  }

  // ── MA Jobs ───────────────────────────────────────────
  const MA_TYPE_META = {
    jenkins: { label: 'Jenkins', icon: 'settings', color: '#e85d04' },
    rundeck: { label: 'Rundeck', icon: 'terminal', color: '#7c3aed' },
    manual:  { label: 'Manual',  icon: 'clipboard', color: '#6b7280' },
  };

  function _renderMaJobs() {
    const list  = document.getElementById('ilc-ma-list');
    const badge = document.getElementById('ilc-tab-ma-count');
    if (!list) return;
    if (badge) badge.textContent = _cfg.ma_jobs.length || '';
    if (!_cfg.ma_jobs.length) {
      list.innerHTML = '<div class="ilc-empty"><i data-icon="toggle-left"></i><br>ยังไม่มี MA job</div>';
      if (window.Icons) Icons.replaceAll(list);
      return;
    }
    list.innerHTML = _cfg.ma_jobs.map((j, i) => {
      const m = MA_TYPE_META[j.type] || MA_TYPE_META.manual;
      const boCfgs = j.bo_configs?.length ? j.bo_configs
        : (j.bo_application ? [{ application: j.bo_application, key: j.bo_key, label: '' }] : []);
      const hasBo = boCfgs.length > 0;
      const boTitle = hasBo ? boCfgs.map(c => `${c.application}/${c.key}`).join(', ') : '';
      return `
      <div class="ilc-item">
        <div class="ilc-item-icon" style="background:${m.color}22;color:${m.color}">
          <i data-icon="${m.icon}"></i>
        </div>
        <div class="ilc-item-body">
          <div class="ilc-item-name">${_esc(j.name)} ${j.optional ? '<span class="ilc-platform-badge" style="--pc:#6b7280">Optional</span>' : '<span class="ilc-platform-badge" style="--pc:#ef4444">Required</span>'}${hasBo ? ` <span class="ilc-platform-badge" style="--pc:#0ea5e9" title="${_esc(boTitle)}"><i data-icon="database"></i> BO ×${boCfgs.length}</span>` : ''}</div>
          <div class="ilc-item-sub">
            <span class="ilc-platform-badge" style="--pc:${m.color}">${m.label}</span>
            ${j.type === 'jenkins' ? ` · server: <code>${_esc(j.server_id)}</code> · path: <code>${_esc(j.job_path)}</code>` : ''}
            ${j.type === 'rundeck' && j.url ? ` · ${_esc(j.url.slice(0,60))}…` : ''}
            ${hasBo ? `<br><span style="color:var(--text-muted)"><i data-icon="database"></i> BO: ${boCfgs.map(c => `<code>${_esc(c.label || c.key)}</code>`).join(', ')} <button class="ilc-btn-mini" style="padding:1px 7px;font-size:10px" onclick="ILC.peekBoValueFor(${i})"><i data-icon="eye"></i> ดูข้อความ</button></span>` : ''}
            ${j.notes ? `<br><span style="color:var(--text-muted)">${_esc(j.notes)}</span>` : ''}
          </div>
          <div id="ilc-ma-bo-peek-${i}" style="display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:var(--bg-hover,rgba(0,0,0,.04));border:1px solid var(--border);font-size:11px;white-space:pre-wrap;word-break:break-word;color:var(--text)"></div>
        </div>
        <div class="ilc-item-actions">
          <button class="icon-btn" onclick="ILC.openMaForm(${i})" title="แก้ไข"><i data-icon="edit"></i></button>
          <button class="icon-btn danger" onclick="ILC.deleteMaJob(${i})" title="ลบ"><i data-icon="trash"></i></button>
        </div>
      </div>`;
    }).join('');
    if (window.Icons) Icons.replaceAll(list);
  }

  function _populateMaServerDropdown() {
    const sel = document.getElementById('ilc-ma-server');
    if (!sel) return;
    sel.innerHTML = '<option value="">— เลือก Server —</option>' +
      _jenkinsServers.map(s => `<option value="${_esc(s.id)}">${_esc(s.display)} · ${_esc(s.base_url?.replace('https://',''))}</option>`).join('');
    if (!_jenkinsServers.length) {
      sel.innerHTML += '<option value="" disabled style="color:#888">ยังไม่มี server — ตั้งค่าใน Admin → Jenkins Servers</option>';
    }
  }

  // Cached job list: server_id → [jobs]
  const _jobCache = {};

  async function parseJenkinsUrl() {
    const rawUrl = (document.getElementById('ilc-ma-job-url')?.value || '').trim();
    const status = document.getElementById('ilc-ma-parse-status');
    if (!rawUrl) { if (status) status.textContent = 'วาง Jenkins Job URL ก่อน'; return; }

    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) { if (status) status.textContent = 'URL ไม่ถูกต้อง'; return; }
    const origin = parsed.origin;

    // If server list hasn't loaded yet, try again now
    if (!_jenkinsServers.length) {
      try {
        const jr = await API.get('/jenkins-proxy/index.php?list=1');
        const srv = jr?.data?.data;
        _jenkinsServers = Array.isArray(srv) ? srv : [];
        _populateMaServerDropdown();
      } catch (_) {}
    }

    // Extract job path from URL: strip /view/... segments, keep /job/... chain
    const rawPath = parsed.pathname;
    const jobMatch = rawPath.match(/((?:\/job\/[^/]+)+)\/?$/);
    const jobPath = jobMatch ? jobMatch[1] : rawPath.replace(/\/$/, '');

    // Try to match against known servers by base_url
    const matched = _jenkinsServers.find(s => {
      const base = (s.base_url || '').replace(/\/$/, '');
      return base && base === origin.replace(/\/$/, '');
    });

    if (matched) {
      const sel = document.getElementById('ilc-ma-server');
      if (sel) sel.value = matched.id;
      const manual = document.getElementById('ilc-ma-server-manual');
      if (manual) manual.value = '';
      _showServerResolved(matched.display + ' (' + matched.id + ')');
      if (status) status.textContent = `✓ Server: ${matched.display} · Path: ${jobPath}`;
    } else {
      // Not in configured list — but we can still use the URL directly
      // Try to find server_id by checking known prefixes
      const manual = document.getElementById('ilc-ma-server-manual');
      if (manual) {
        manual.placeholder = `Server ID สำหรับ ${origin} (เช่น jsrv_99316f22f9ad)`;
        manual.value = '';
        manual.focus();
      }
      if (status) status.textContent = `⚠ ไม่พบ server "${origin}" ใน list — ใส่ Server ID ในช่องด้านล่าง หรือกด Search เพื่อค้นหา job`;
    }

    const pathEl = document.getElementById('ilc-ma-jobpath');
    if (pathEl && jobPath) pathEl.value = jobPath;
    if (window.Icons) Icons.replaceAll(document.getElementById('ilc-ma-form'));
  }

  function _showServerResolved(text) {
    const el = document.getElementById('ilc-ma-server-resolved');
    if (!el) return;
    el.textContent = text ? `✓ ${text}` : '';
    el.style.display = text ? '' : 'none';
  }

  function onServerChange() {
    const sel = document.getElementById('ilc-ma-server');
    const manual = document.getElementById('ilc-ma-server-manual');
    if (sel?.value) {
      if (manual) manual.value = '';
      const srv = _jenkinsServers.find(s => s.id === sel.value);
      _showServerResolved(srv ? srv.display + ' (' + srv.id + ')' : '');
    }
    // Hide job search on server change
    const wrap = document.getElementById('ilc-ma-job-search-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  function onServerManualInput() {
    const manual = document.getElementById('ilc-ma-server-manual');
    const sel = document.getElementById('ilc-ma-server');
    if (manual?.value?.trim()) {
      if (sel) sel.value = '';
      // Check if manual ID matches a known server
      const srv = _jenkinsServers.find(s => s.id === manual.value.trim());
      _showServerResolved(srv ? `✓ ${srv.display} (${srv.id})` : '');
    } else {
      _showServerResolved('');
    }
  }

  async function searchJenkinsJobs() {
    // Get effective server ID
    const selVal    = document.getElementById('ilc-ma-server')?.value?.trim()        || '';
    const manualVal = document.getElementById('ilc-ma-server-manual')?.value?.trim() || '';
    const serverId  = selVal || manualVal;
    if (!serverId) { _toast('เลือก Jenkins Server ก่อน หรือใส่ Server ID ในช่องด้านล่าง'); return; }

    const wrap   = document.getElementById('ilc-ma-job-search-wrap');
    const list   = document.getElementById('ilc-ma-job-list');
    const filter = document.getElementById('ilc-ma-job-filter');
    const btn    = document.getElementById('ilc-ma-search-btn');

    wrap.style.display = '';
    list.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px"><i data-icon="loader"></i> กำลังโหลด jobs…</div>';
    if (window.Icons) Icons.replaceAll(list);
    if (btn) btn.disabled = true;

    try {
      // Try to load jobs from server root + view list
      const r = await API.get(`/jenkins-proxy/index.php?server=${encodeURIComponent(serverId)}&path=/api/json&tree=jobs%5Bname%2CbuildableType%2Curl%2Cjobs%5Bname%2Curl%5D%5D`);
      if (!r?.ok) throw new Error(r?.data?.message || `HTTP ${r?.status}`);
      const topJobs = r?.data?.data?.jobs || [];

      // Flatten: include top-level jobs + one level of folder children
      const all = [];
      topJobs.forEach(j => {
        if (j.jobs?.length) {
          // folder — add children
          j.jobs.forEach(child => all.push({ name: j.name + ' / ' + child.name, path: '/job/' + encodeURIComponent(j.name) + '/job/' + encodeURIComponent(child.name) }));
        } else {
          all.push({ name: j.name, path: '/job/' + encodeURIComponent(j.name) });
        }
      });

      _jobCache[serverId] = all;
      if (filter) filter.value = '';
      _renderJobList(all, serverId);
    } catch (e) {
      list.innerHTML = `<div style="padding:10px;color:#ef4444;font-size:12px"><i data-icon="alert-circle"></i> โหลดไม่สำเร็จ: ${_esc(e?.message || 'error')}</div>`;
      if (window.Icons) Icons.replaceAll(list);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function filterJobs() {
    const selVal    = document.getElementById('ilc-ma-server')?.value?.trim() || '';
    const manualVal = document.getElementById('ilc-ma-server-manual')?.value?.trim() || '';
    const serverId  = selVal || manualVal;
    const all = _jobCache[serverId] || [];
    const q   = (document.getElementById('ilc-ma-job-filter')?.value || '').toLowerCase();
    const filtered = q ? all.filter(j => j.name.toLowerCase().includes(q)) : all;
    _renderJobList(filtered, serverId);
  }

  function _renderJobList(jobs, serverId) {
    const list = document.getElementById('ilc-ma-job-list');
    if (!list) return;
    if (!jobs.length) {
      list.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">ไม่พบ job ที่ตรงกัน</div>';
      return;
    }
    list.innerHTML = jobs.slice(0, 50).map(j => `
      <div class="ilc-job-item" onclick="ILC.selectJob('${_esc(j.path)}', '${_esc(j.name)}')">
        <i data-icon="settings" style="flex-shrink:0;font-size:12px;color:var(--text-muted)"></i>
        <span>${_esc(j.name)}</span>
        <code>${_esc(j.path)}</code>
      </div>`).join('');
    if (jobs.length > 50) list.innerHTML += `<div style="padding:6px 10px;font-size:11px;color:var(--text-muted)">แสดง 50 จาก ${jobs.length} — กรองเพื่อค้นหาเพิ่ม</div>`;
    if (window.Icons) Icons.replaceAll(list);
  }

  function selectJob(path, name) {
    const pathEl = document.getElementById('ilc-ma-jobpath');
    if (pathEl) pathEl.value = path;
    const wrap = document.getElementById('ilc-ma-job-search-wrap');
    if (wrap) wrap.style.display = 'none';
    // Auto-fill MA name if still default
    const nameEl = document.getElementById('ilc-ma-name');
    if (nameEl && (!nameEl.value || nameEl.value === 'Login')) nameEl.value = name;
  }

  function openMaForm(idx = null) {
    closeTemplateForm(); closeGroupForm(); closeLinkForm(); closeChannelForm();
    _populateMaServerDropdown();
    const form  = document.getElementById('ilc-ma-form');
    const title = document.getElementById('ilc-ma-form-title');
    document.getElementById('ilc-ma-idx').value = idx !== null ? idx : '';
    title.textContent = idx !== null ? 'แก้ไข MA Job' : 'เพิ่ม MA Job';
    const _setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const _setChk = (id, v)  => { const el = document.getElementById(id); if (el) el.checked = v; };
    const _clear  = (...ids) => ids.forEach(id => _setVal(id, ''));

    if (idx !== null) {
      const j = _cfg.ma_jobs[idx];
      _setVal('ilc-ma-name', j.name || '');
      _setVal('ilc-ma-type', j.type || 'jenkins');
      // server: try dropdown first, fallback to manual input
      const sel = document.getElementById('ilc-ma-server');
      if (sel) {
        sel.value = j.server_id || '';
        if (sel.value !== (j.server_id || '')) sel.value = ''; // not in list
      }
      _setVal('ilc-ma-server-manual', sel?.value ? '' : (j.server_id || ''));
      _setVal('ilc-ma-jobpath', j.job_path || '');
      _setVal('ilc-ma-job-url', '');
      _setVal('ilc-ma-url', j.url || '');
      _setChk('ilc-ma-optional', !!j.optional);
      _setVal('ilc-ma-notes', j.notes || '');
      // BO config fields — backward compat: old single entry → array
      const cfgs = j.bo_configs?.length ? j.bo_configs
        : (j.bo_application ? [{ label: '', application: j.bo_application, key: j.bo_key || '' }] : []);
      _boConfigs = cfgs.map(c => ({
        label:       c.label       || '',
        application: c.application || '',
        key:         c.key         || '',
        environment: c.environment || 'production',
        profile:     c.profile     || 'main',
        editable:    c.editable    || false,
      }));
      const hasBo = _boConfigs.length > 0;
      _setChk('ilc-ma-bo-enabled', hasBo);
      _setBoFieldsVisible(hasBo);
      _renderBoConfigList();
    } else {
      _setVal('ilc-ma-type', 'jenkins');
      _clear('ilc-ma-name','ilc-ma-server-manual','ilc-ma-jobpath','ilc-ma-job-url','ilc-ma-url','ilc-ma-notes');
      const sel = document.getElementById('ilc-ma-server'); if (sel) sel.value = '';
      _setChk('ilc-ma-optional', false);
      _setChk('ilc-ma-bo-enabled', false);
      _boConfigs = [];
      _setBoFieldsVisible(false);
      _renderBoConfigList();
    }
    const parseStatus = document.getElementById('ilc-ma-parse-status');
    if (parseStatus) parseStatus.textContent = '';
    _showServerResolved('');
    const jobWrap = document.getElementById('ilc-ma-job-search-wrap');
    if (jobWrap) jobWrap.style.display = 'none';
    onMaTypeChange();
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (window.Icons) Icons.replaceAll(form);
  }

  function onMaTypeChange() {
    const type = document.getElementById('ilc-ma-type').value;
    document.getElementById('ilc-ma-jenkins-fields').style.display = type === 'jenkins' ? 'grid' : 'none';
    document.getElementById('ilc-ma-url-wrap').style.display       = type === 'rundeck' ? '' : 'none';
  }

  function closeMaForm() {
    const form = document.getElementById('ilc-ma-form');
    if (form) form.style.display = 'none';
  }

  async function saveMaJob() {
    const name = document.getElementById('ilc-ma-name').value.trim();
    if (!name) { _toast('กรุณาระบุชื่อ MA Job'); return; }
    const type = document.getElementById('ilc-ma-type').value;
    // server_id: dropdown value OR manual text input
    const serverFromDrop   = document.getElementById('ilc-ma-server')?.value?.trim()       || '';
    const serverFromManual = document.getElementById('ilc-ma-server-manual')?.value?.trim() || '';
    const serverId = serverFromDrop || serverFromManual;
    const boEnabled = document.getElementById('ilc-ma-bo-enabled')?.checked || false;
    let boCfgs = [];
    if (boEnabled) {
      _syncBoConfigs();
      boCfgs = _boConfigs.filter(c => c.application && c.key);
    }
    const obj = {
      id:         'ma_' + Date.now(),
      name,
      type,
      server_id:  serverId,
      job_path:   document.getElementById('ilc-ma-jobpath')?.value?.trim()  || '',
      url:        document.getElementById('ilc-ma-url')?.value?.trim()      || '',
      optional:   document.getElementById('ilc-ma-optional')?.checked       || false,
      notes:      document.getElementById('ilc-ma-notes')?.value?.trim()    || '',
      bo_configs: boCfgs,
      enabled:    true,
    };
    if (type === 'jenkins' && !obj.server_id && !obj.url) {
      _toast('กรุณาเลือก Jenkins Server / ใส่ Server ID หรือวาง Jenkins Job URL ด้านบน'); return;
    }
    if (type === 'jenkins' && !obj.job_path && !obj.url) {
      _toast('กรุณาระบุ Job Path หรือวาง Jenkins Job URL ด้านบนแล้วกด Parse'); return;
    }
    // If only URL given (no server_id), store url and clear job_path requirement
    if (type === 'jenkins' && !obj.server_id && obj.url) {
      // Extract path from url as fallback
      if (!obj.job_path) {
        try {
          const u = new URL(obj.url);
          const m = u.pathname.match(/((?:\/job\/[^/]+)+)\/?$/);
          if (m) obj.job_path = m[1];
        } catch (_) {}
      }
    }
    const idxStr = document.getElementById('ilc-ma-idx').value;
    if (idxStr !== '') {
      _cfg.ma_jobs[parseInt(idxStr)] = { ..._cfg.ma_jobs[parseInt(idxStr)], ...obj, id: _cfg.ma_jobs[parseInt(idxStr)].id };
    } else {
      _cfg.ma_jobs.push(obj);
    }
    await _save();
    closeMaForm();
    _renderMaJobs();
  }

  // ── BO Config (multi-entry) ───────────────────────────
  let _boConfigs = []; // [{label, application, key}]

  function _setBoFieldsVisible(visible) {
    const el = document.getElementById('ilc-ma-bo-fields');
    if (el) el.style.display = visible ? '' : 'none';
  }

  function onBoToggle() {
    const chk = document.getElementById('ilc-ma-bo-enabled');
    const on = chk?.checked || false;
    _setBoFieldsVisible(on);
    if (on && !_boConfigs.length) { _boConfigs = [{ label: '', application: '', key: '' }]; _renderBoConfigList(); }
  }

  function _syncBoConfigs() {
    _boConfigs = _boConfigs.map((_, i) => ({
      label:       document.getElementById(`ilc-bo-${i}-label`)?.value?.trim()     || '',
      application: document.getElementById(`ilc-bo-${i}-app`)?.value?.trim()       || '',
      key:         document.getElementById(`ilc-bo-${i}-key`)?.value?.trim()       || '',
      environment: document.getElementById(`ilc-bo-${i}-env`)?.value?.trim()       || 'production',
      profile:     document.getElementById(`ilc-bo-${i}-profile`)?.value?.trim()   || 'main',
      editable:    document.getElementById(`ilc-bo-${i}-editable`)?.checked        || false,
    }));
  }

  function _renderBoConfigList() {
    const wrap = document.getElementById('ilc-ma-bo-list');
    if (!wrap) return;
    wrap.innerHTML = _boConfigs.map((c, i) => `
      <div class="ilc-bo-entry" style="${i > 0 ? 'border-top:1px dashed var(--border);padding-top:10px;margin-top:10px' : ''}">
        <div style="display:grid;grid-template-columns:160px 1fr 1fr auto;gap:8px;align-items:end">
          <div class="ilc-field" style="margin:0">
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:.04em">Label <span style="font-weight:400;opacity:.6">(optional)</span></label>
            <input id="ilc-bo-${i}-label" type="text" placeholder="เช่น Title TH" value="${_esc(c.label || '')}">
          </div>
          <div class="ilc-field" style="margin:0">
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:.04em">Application <span style="color:#ef4444">*</span></label>
            <input id="ilc-bo-${i}-app" type="text" placeholder="เช่น mobile-auth-service" value="${_esc(c.application || '')}">
          </div>
          <div class="ilc-field" style="margin:0">
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:.04em">Key <span style="color:#ef4444">*</span></label>
            <input id="ilc-bo-${i}-key" type="text" placeholder="เช่น MAS-TITLE-50011.message.th" value="${_esc(c.key || '')}">
          </div>
          <button type="button" class="icon-btn danger" onclick="ILC.removeBoConfig(${i})" title="ลบ row นี้" style="margin-bottom:1px"><i data-icon="trash"></i></button>
        </div>
        <!-- Edit settings (env/profile/editable) -->
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-top:6px">
          <div class="ilc-field" style="margin:0">
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)">Environment</label>
            <input id="ilc-bo-${i}-env" type="text" placeholder="production" value="${_esc(c.environment || 'production')}" style="font-size:11px">
          </div>
          <div class="ilc-field" style="margin:0">
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)">Profile</label>
            <input id="ilc-bo-${i}-profile" type="text" placeholder="main" value="${_esc(c.profile || 'main')}" style="font-size:11px">
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text);margin-bottom:6px;white-space:nowrap;cursor:pointer">
            <input type="checkbox" id="ilc-bo-${i}-editable" ${c.editable ? 'checked' : ''}>
            แก้ไขได้ใน Launcher
          </label>
        </div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button type="button" class="ilc-btn-mini" onclick="ILC.peekBoConfigRow(${i})"><i data-icon="eye"></i> ดูค่าปัจจุบัน</button>
          <span id="ilc-bo-${i}-status" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
        <div id="ilc-bo-${i}-result" style="display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:var(--bg-hover,rgba(0,0,0,.04));border:1px solid var(--border);font-size:11px;word-break:break-word;color:var(--text)"></div>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(wrap);
  }

  function addBoConfig() {
    _syncBoConfigs();
    _boConfigs.push({ label: '', application: '', key: '' });
    _renderBoConfigList();
  }

  function removeBoConfig(idx) {
    _syncBoConfigs();
    _boConfigs.splice(idx, 1);
    _renderBoConfigList();
  }

  async function peekBoConfigRow(idx) {
    _syncBoConfigs();
    const c   = _boConfigs[idx];
    const st  = document.getElementById(`ilc-bo-${idx}-status`);
    const res = document.getElementById(`ilc-bo-${idx}-result`);
    if (!c?.application || !c?.key) { if (st) st.textContent = 'ใส่ Application และ Key ก่อน'; return; }
    if (st) st.textContent = 'กำลังโหลด…';
    if (res) { res.style.display = 'none'; res.textContent = ''; }
    try {
      const r = await API.get(`/incident-launcher/index.php?action=bo_config_peek&application=${encodeURIComponent(c.application)}&key=${encodeURIComponent(c.key)}`);
      const p = r?.data?.property;
      if (!p) throw new Error('ไม่พบข้อมูล');
      if (st) st.textContent = '';
      if (res) { res.style.display = ''; res.textContent = `Value: ${p.value || '(ว่าง)'}  |  Group: ${p.property_group || '-'}  |  ID: ${p.property_id}`; }
    } catch (e) {
      if (st) st.textContent = `Error: ${e?.message || 'ไม่สำเร็จ'}`;
    }
  }

  async function peekBoValueFor(idx) {
    const j    = _cfg.ma_jobs[idx];
    const cfgs = j?.bo_configs || (j?.bo_application ? [{ application: j.bo_application, key: j.bo_key, label: '' }] : []);
    if (!cfgs.length) return;
    const container = document.getElementById(`ilc-ma-bo-peek-${idx}`);
    if (!container) return;
    container.style.display = '';
    container.textContent = 'กำลังโหลด…';
    try {
      const rows = await Promise.all(cfgs.map(async c => {
        try {
          const r = await API.get(`/incident-launcher/index.php?action=bo_config_peek&application=${encodeURIComponent(c.application)}&key=${encodeURIComponent(c.key)}`);
          const p = r?.data?.property;
          return `${c.label ? _esc(c.label) + ': ' : ''}${_esc(p?.value || '(ว่าง)')}`;
        } catch { return `${c.label || c.key}: (ดึงข้อมูลไม่สำเร็จ)`; }
      }));
      container.textContent = rows.join('\n');
    } catch (e) {
      container.textContent = `Error: ${e?.message || 'ไม่สำเร็จ'}`;
    }
  }

  async function deleteMaJob(idx) {
    const name = _cfg.ma_jobs[idx]?.name || 'MA job นี้';
    _confirm(`ยืนยันลบ "${name}" ?`, async () => {
      _cfg.ma_jobs.splice(idx, 1);
      await _save();
      _renderMaJobs();
    });
  }

  // ── Save ──────────────────────────────────────────────
  async function _save() {
    try {
      const r = await API.post('/incident-launcher/index.php', { action: 'save_config', config: _cfg });
      console.log('[ILC save_config] status:', r?.status, 'data:', r?.data);
      if (r?.data?.ok === true) {
        _toast('บันทึกสำเร็จ', 'success');
      } else {
        const msg = r?.data?.message || r?.data?.error || `HTTP ${r?.status||'?'} — บันทึกไม่สำเร็จ`;
        _toast(msg, 'error');
        console.error('[ILC save_config] error response:', r);
      }
    } catch (e) {
      _toast(e?.message || 'บันทึกไม่สำเร็จ', 'error');
      console.error('[ILC save_config] exception:', e);
    }
  }

  /* ══════════════════════════════════════════════════════
     CASES — Two-view system: List → Case Step Config
  ══════════════════════════════════════════════════════ */

  let _activeCaseId   = null;  // null = list view | 'new' | case id = detail view
  let _activeCaseTab  = 'basic'; // 'basic' | 'channels' | 'partners' | 'ma' | 'sp'
  let _caseSPServices = [];    // sp services for current case being edited

  const CASE_TABS = [
    { id: 'basic',    icon: 'edit-3',         label: 'ข้อมูลทั่วไป' },
    { id: 'channels', icon: 'send',           label: 'Step 2 · Channels' },
    { id: 'partners', icon: 'users',          label: 'Step 4 · Partners' },
    { id: 'ma',       icon: 'zap',            label: 'Step 5 · MA Jobs' },
    { id: 'sp',       icon: 'activity',       label: 'Step 8 · Services' },
  ];

  /* ── Main render entry — decides list vs detail view ─────── */
  function _renderCases() {
    const root  = document.getElementById('ilc-cases-root');
    const badge = document.getElementById('ilc-step-case-count');
    const cases = _cfg.cases || [];
    if (badge) badge.textContent = cases.length || '';
    if (!root) return;

    if (_activeCaseId === null) {
      _renderCaseList(root, cases);
    } else {
      _renderCaseDetail(root);
    }
    if (window.Icons) Icons.replaceAll(root);
  }

  /* ── VIEW 1: Case list ───────────────────────────────────── */
  function _renderCaseList(root, cases) {
    const SEV_LBL = { sev1: 'SEV 1', sev2: 'SEV 2', sev3: 'SEV 3' };
    const cardsHtml = cases.length ? cases.map((c, i) => {
      const maCount  = (c.ma_job_ids         || []).length;
      const chCount  = (c.channel_ids        || []).length;
      const grpCount = (c.partner_group_ids  || []).length;
      const spCount  = (c.sp_services        || []).length;
      return `
      <div class="ilcc-case-card" style="--cc:${_esc(c.color||'#ef4444')}">
        <div class="ilcc-case-stripe"></div>
        <div class="ilcc-case-card-body">
          <div class="ilcc-case-icon" style="background:color-mix(in srgb,${_esc(c.color||'#ef4444')} 15%,transparent);color:${_esc(c.color||'#ef4444')}">
            <i data-icon="${_esc(c.icon||'zap')}"></i>
          </div>
          <div class="ilcc-case-info">
            <div class="ilcc-case-name">
              ${_esc(c.name)}
              <span class="ilcc-sev-tag ilcc-sev-tag--${_esc(c.default_severity||'sev1')}">${SEV_LBL[c.default_severity||'sev1']||''}</span>
            </div>
            ${c.description ? `<div class="ilcc-case-desc">${_esc(c.description)}</div>` : ''}
            <div class="ilcc-case-badges">
              ${maCount  ? `<span class="ilcc-badge ilcc-badge--ma"><i data-icon="zap"></i>${maCount} MA</span>` : '<span class="ilcc-badge ilcc-badge--none">ใช้ global</span>'}
              ${chCount  ? `<span class="ilcc-badge ilcc-badge--ch"><i data-icon="send"></i>${chCount} CH</span>` : ''}
              ${grpCount ? `<span class="ilcc-badge ilcc-badge--grp"><i data-icon="users"></i>${grpCount} GRP</span>` : ''}
              ${spCount  ? `<span class="ilcc-badge ilcc-badge--sp"><i data-icon="activity"></i>${spCount} SP</span>` : ''}
            </div>
          </div>
          <div class="ilcc-case-actions">
            <button type="button" class="ilcc-btn-config" onclick="ILC.openCaseDetail('${_esc(c.id)}')">
              <i data-icon="settings"></i> ตั้งค่า
            </button>
            <button type="button" class="ilcc-btn-del" onclick="ILC.deleteCase('${_esc(c.id)}')" title="ลบ">
              <i data-icon="trash-2"></i>
            </button>
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="ilc-empty" style="padding:32px 0"><i data-icon="layers"></i><br>ยังไม่มี case — กด "+ เพิ่ม Case" เพื่อเริ่ม</div>`;

    root.innerHTML = `
      <div class="ilcc-header">
        <div>
          <div class="ilcc-title"><i data-icon="layers"></i> Incident Cases</div>
          <div class="ilcc-subtitle">แต่ละ case แสดงเป็น card ใน Launcher · กด "ตั้งค่า" เพื่อกำหนด steps ของแต่ละ case</div>
        </div>
        <button type="button" class="ilc-btn primary" onclick="ILC.openCaseDetail('new')">
          <i data-icon="plus"></i> เพิ่ม Case
        </button>
      </div>
      <div class="ilcc-card-grid">${cardsHtml}</div>`;
  }

  /* ── VIEW 2: Case detail (step tabs) ─────────────────────── */
  function openCaseDetail(caseId) {
    _activeCaseId  = caseId;
    _activeCaseTab = 'basic';
    // Seed SP services from case data
    const c = (caseId === 'new') ? null : (_cfg.cases||[]).find(x => x.id === caseId);
    _caseSPServices = c ? [...(c.sp_services||[])] : [];
    _renderCases();
    document.getElementById('ilc-cases-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function backToCaseList() {
    _activeCaseId = null;
    _activeCaseTab = 'basic';
    _caseSPServices = [];
    _renderCases();
  }

  function switchCaseTab(tab) {
    _activeCaseTab = tab;
    _renderCases();
    document.getElementById('ilcc-tab-content')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _renderCaseDetail(root) {
    const isNew = _activeCaseId === 'new';
    const c     = isNew ? {} : ((_cfg.cases||[]).find(x => x.id === _activeCaseId) || {});

    // Tab nav HTML
    const tabNavHtml = CASE_TABS.map(t => `
      <button type="button"
        class="ilcc-step-tab ${_activeCaseTab === t.id ? 'active' : ''}"
        onclick="ILC.switchCaseTab('${t.id}')">
        <i data-icon="${t.icon}"></i>
        <span>${t.label}</span>
      </button>`).join('');

    root.innerHTML = `
      <div class="ilcc-detail-header">
        <button type="button" class="ilcc-back-btn" onclick="ILC.backToCaseList()">
          <i data-icon="arrow-left"></i> กลับ
        </button>
        <div class="ilcc-detail-title" ${c.color?`style="color:${_esc(c.color)}"`:''}">
          ${c.icon ? `<i data-icon="${_esc(c.icon)}"></i>` : '<i data-icon="layers"></i>'}
          ${_esc(c.name || 'Case ใหม่')}
        </div>
        ${isNew ? '<span class="ilcc-new-badge">ใหม่</span>' : ''}
      </div>

      <div class="ilcc-detail-body">
        <!-- Step tabs nav -->
        <nav class="ilcc-step-tabs">${tabNavHtml}</nav>

        <!-- Tab content -->
        <div class="ilcc-tab-content" id="ilcc-tab-content">
          ${_renderCaseTabContent(c)}
        </div>
      </div>`;
  }

  function _renderCaseTabContent(c) {
    switch (_activeCaseTab) {
      case 'basic':    return _renderCaseTabBasic(c);
      case 'channels': return _renderCaseTabChannels(c);
      case 'partners': return _renderCaseTabPartners(c);
      case 'ma':       return _renderCaseTabMA(c);
      case 'sp':       return _renderCaseTabSP(c);
      default:         return '';
    }
  }

  function _renderCaseTabBasic(c) {
    return `
      <div class="ilcc-tab-section">
        <div class="ilcc-tab-section-title"><i data-icon="edit-3"></i> ข้อมูล Case</div>
        <div class="ilc-form-grid">
          <div class="ilc-field span2">
            <label>ชื่อ Case <span class="req">*</span></label>
            <input id="ilcc-basic-name" type="text" value="${_esc(c.name||'')}" placeholder="เช่น Login Down, Fund-in Unavailable">
          </div>
          <div class="ilc-field">
            <label>Icon</label>
            <input id="ilcc-basic-icon" type="text" value="${_esc(c.icon||'zap')}" placeholder="zap">
            <span class="ilc-hint-text">ชื่อ icon เช่น lock, credit-card, zap</span>
          </div>
          <div class="ilc-field">
            <label>สี</label>
            <input id="ilcc-basic-color" type="color" value="${_esc(c.color||'#ef4444')}">
          </div>
          <div class="ilc-field full">
            <label>คำอธิบาย</label>
            <input id="ilcc-basic-desc" type="text" value="${_esc(c.description||'')}" placeholder="เช่น ระบบ Login ไม่สามารถใช้งานได้">
          </div>
        </div>

        <div class="ilcc-tab-section-title" style="margin-top:20px"><i data-icon="fill"></i> ค่า Default ใน Wizard</div>
        <div class="ilc-form-grid">
          <div class="ilc-field full">
            <label>Default Title <span class="hint-inline">pre-fill ในช่อง Incident Title</span></label>
            <input id="ilcc-basic-title" type="text" value="${_esc(c.default_title||'')}" placeholder="เช่น Login Service Unavailable">
          </div>
          <div class="ilc-field span2">
            <label>Default Service</label>
            <input id="ilcc-basic-service" type="text" value="${_esc(c.default_service||'')}" placeholder="เช่น TrueMoney Wallet Login">
          </div>
          <div class="ilc-field">
            <label>Default Severity</label>
            <select id="ilcc-basic-sev">
              <option value="sev1" ${(c.default_severity||'sev1')==='sev1'?'selected':''}>SEV 1 — Critical</option>
              <option value="sev2" ${c.default_severity==='sev2'?'selected':''}>SEV 2 — Major</option>
              <option value="sev3" ${c.default_severity==='sev3'?'selected':''}>SEV 3 — Minor</option>
            </select>
          </div>
        </div>
        <div class="ilcc-save-row">
          <button type="button" class="ilc-btn primary" onclick="ILC.saveCaseBasic()">
            <i data-icon="save"></i> บันทึกข้อมูลทั่วไป
          </button>
          ${_activeCaseId !== 'new' ? `<button type="button" class="ilc-btn ghost" style="color:#ef4444" onclick="ILC.deleteCase('${_esc(c.id||'')}')"><i data-icon="trash-2"></i> ลบ Case นี้</button>` : ''}
        </div>
      </div>`;
  }

  function _renderCaseTabChannels(c) {
    const channels  = _cfg.channels || [];
    const selected  = c.channel_ids || [];
    const PLAT_ICONS = { googlechat:'message-square', line:'message-circle', dingtalk:'bell', manual:'clipboard' };
    const PLAT_LBL   = { googlechat:'Google Chat', line:'LINE Notify', dingtalk:'DingTalk', manual:'Manual' };
    const hint = selected.length ? '' : '<div class="ilcc-global-note"><i data-icon="info"></i> ไม่ได้เลือก = แสดง channels ทั้งหมด (global)</div>';
    const checks = !channels.length
      ? '<div class="ilcc-empty-note">ยังไม่มี channel — ตั้งค่าใน <strong>Step 2</strong> ก่อน</div>'
      : channels.map(ch => `
        <label class="ilcc-check-row">
          <input type="checkbox" class="ilcc-ch-check" value="${_esc(ch.id)}" ${selected.includes(ch.id)?'checked':''}
            style="accent-color:#3b82f6">
          <i data-icon="${PLAT_ICONS[ch.platform]||'send'}" style="color:#3b82f6"></i>
          <span class="ilcc-check-label">${_esc(ch.name)}</span>
          <span class="ilcc-check-sub">${PLAT_LBL[ch.platform]||ch.platform}</span>
        </label>`).join('');
    return `
      <div class="ilcc-tab-section">
        <div class="ilcc-tab-section-title"><i data-icon="send"></i> Channels สำหรับ case นี้</div>
        <div class="ilcc-hint-text">เลือก channels ที่ต้องแจ้งเมื่อเกิด incident ประเภทนี้ · ถ้าไม่เลือก = แสดงทุก channel</div>
        ${hint}
        <div class="ilcc-check-list">${checks}</div>
        <div class="ilcc-save-row">
          <button type="button" class="ilc-btn primary" onclick="ILC.saveCaseStep('channels')">
            <i data-icon="save"></i> บันทึก Channels
          </button>
        </div>
      </div>`;
  }

  function _renderCaseTabPartners(c) {
    const groups   = _cfg.partner_groups || [];
    const selected = c.partner_group_ids || [];
    const hint = selected.length ? '' : '<div class="ilcc-global-note"><i data-icon="info"></i> ไม่ได้เลือก = แสดง partner groups ทั้งหมด (global)</div>';
    const checks = !groups.length
      ? '<div class="ilcc-empty-note">ยังไม่มี partner group — ตั้งค่าใน <strong>Step 4</strong> ก่อน</div>'
      : groups.map(g => `
        <label class="ilcc-check-row">
          <input type="checkbox" class="ilcc-grp-check" value="${_esc(g.id)}" ${selected.includes(g.id)?'checked':''}
            style="accent-color:#16a34a">
          <span style="width:10px;height:10px;border-radius:50%;background:${_esc(g.color||'#3b82f6')};flex-shrink:0"></span>
          <span class="ilcc-check-label">${_esc(g.name)}</span>
          <span class="ilcc-check-sub">${(g.to_emails||g.emails||[]).length} emails</span>
        </label>`).join('');
    return `
      <div class="ilcc-tab-section">
        <div class="ilcc-tab-section-title"><i data-icon="users"></i> Partner Groups สำหรับ case นี้</div>
        <div class="ilcc-hint-text">เลือก partner groups ที่จะได้รับ email เมื่อเกิด incident ประเภทนี้</div>
        ${hint}
        <div class="ilcc-check-list">${checks}</div>
        <div class="ilcc-save-row">
          <button type="button" class="ilc-btn primary" onclick="ILC.saveCaseStep('partners')">
            <i data-icon="save"></i> บันทึก Partner Groups
          </button>
        </div>
      </div>`;
  }

  function _renderCaseTabMA(c) {
    const jobs     = _cfg.ma_jobs || [];
    const selected = c.ma_job_ids || [];
    const TYPE_ICONS = { jenkins:'settings', rundeck:'terminal', manual:'clipboard' };
    const hint = selected.length ? '' : '<div class="ilcc-global-note"><i data-icon="info"></i> ไม่ได้เลือก = แสดง MA jobs ทั้งหมด (global)</div>';
    const checks = !jobs.length
      ? '<div class="ilcc-empty-note">ยังไม่มี MA job — ตั้งค่าใน <strong>Step 5</strong> ก่อน</div>'
      : jobs.map(j => `
        <label class="ilcc-check-row">
          <input type="checkbox" class="ilcc-ma-check" value="${_esc(j.id)}" ${selected.includes(j.id)?'checked':''}
            style="accent-color:#f59e0b">
          <i data-icon="${TYPE_ICONS[j.type]||'zap'}" style="color:#f59e0b"></i>
          <span class="ilcc-check-label">${_esc(j.name)}</span>
          <span class="ilcc-check-sub">${j.type}${j.optional?' · optional':''}</span>
        </label>`).join('');
    return `
      <div class="ilcc-tab-section">
        <div class="ilcc-tab-section-title"><i data-icon="zap"></i> MA Jobs สำหรับ case นี้</div>
        <div class="ilcc-hint-text">เลือก MA jobs ที่ต้องรันเมื่อเกิด incident ประเภทนี้</div>
        ${hint}
        <div class="ilcc-check-list">${checks}</div>
        <div class="ilcc-save-row">
          <button type="button" class="ilc-btn primary" onclick="ILC.saveCaseStep('ma')">
            <i data-icon="save"></i> บันทึก MA Jobs
          </button>
        </div>
      </div>`;
  }

  function _renderCaseTabSP(c) {
    const spHtml = !_caseSPServices.length
      ? '<div class="ilcc-empty-note">ยังไม่มี service — ค้นหาด้านบน · ถ้าว่าง = ใช้ services จาก global Step 8</div>'
      : `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">` +
        _caseSPServices.map(name => `
          <span class="ilcc-sp-chip">
            <i data-icon="activity"></i> ${_esc(name)}
            <button type="button" onclick="ILC.caseSPRemove('${_esc(name)}')">&times;</button>
          </span>`).join('') + `</div>`;
    return `
      <div class="ilcc-tab-section">
        <div class="ilcc-tab-section-title"><i data-icon="activity"></i> Service Performance ของ case นี้</div>
        <div class="ilcc-hint-text">services ที่แสดงใน Step 8 ของ wizard สำหรับ case นี้ · ถ้าไม่กำหนด = ใช้ global config</div>
        <div class="ilc-sp-search-wrap" style="margin-top:12px">
          <div class="ilc-sp-search-box">
            <i data-icon="search" class="ilc-sp-search-icon"></i>
            <input id="ilcc-sp-search" type="text" class="ilc-sp-search-input"
              placeholder="ค้นหา service เช่น wallet, login, topup…"
              autocomplete="off"
              oninput="ILC.caseSPSearch(this.value)"
              onkeydown="ILC.caseSPSearchKeydown(event)">
          </div>
          <div class="ilc-sp-dropdown" id="ilcc-sp-dropdown" style="display:none"></div>
        </div>
        ${spHtml}
        <div class="ilcc-save-row">
          <button type="button" class="ilc-btn primary" onclick="ILC.saveCaseStep('sp')">
            <i data-icon="save"></i> บันทึก SP Services
          </button>
        </div>
      </div>`;
  }

  /* ── Save functions ──────────────────────────────────────── */
  async function saveCaseBasic() {
    const name = document.getElementById('ilcc-basic-name')?.value.trim();
    if (!name) { _toast('กรุณาระบุชื่อ Case', 'error'); return; }

    const isNew = _activeCaseId === 'new';
    const newId = isNew ? ('case_' + Date.now().toString(36)) : _activeCaseId;

    const cases = _cfg.cases || [];
    const idx   = cases.findIndex(c => c.id === newId);
    const existing = idx >= 0 ? cases[idx] : {};

    const updated = {
      ...existing,
      id:               newId,
      name,
      icon:             document.getElementById('ilcc-basic-icon')?.value.trim()    || 'zap',
      color:            document.getElementById('ilcc-basic-color')?.value           || '#ef4444',
      description:      document.getElementById('ilcc-basic-desc')?.value.trim()    || '',
      default_title:    document.getElementById('ilcc-basic-title')?.value.trim()   || '',
      default_service:  document.getElementById('ilcc-basic-service')?.value.trim() || '',
      default_severity: document.getElementById('ilcc-basic-sev')?.value            || 'sev1',
    };

    if (idx >= 0) { cases[idx] = updated; }
    else          { cases.push(updated); }
    _cfg.cases = cases;

    const prevToast = _toast;
    try {
      const r = await API.post('/incident-launcher/index.php', { action: 'save_config', config: _cfg });
      console.log('[ILC saveCaseBasic] status:', r?.status, 'data:', r?.data);
      if (r?.data?.ok === true) {
        _toast(`บันทึก "${name}" สำเร็จ`, 'success');
        _activeCaseId = newId;
        _renderCases();
      } else {
        const msg = r?.data?.message || r?.data?.error || `HTTP ${r?.status||'?'}`;
        _toast(`บันทึกไม่สำเร็จ: ${msg}`, 'error');
        console.error('[ILC saveCaseBasic] non-ok response:', r);
      }
    } catch(e) {
      _toast(`บันทึกไม่สำเร็จ: ${e?.message||'error'}`, 'error');
      console.error('[ILC saveCaseBasic] exception:', e);
    }
  }

  async function saveCaseStep(stepKey) {
    const cases = _cfg.cases || [];
    const idx   = cases.findIndex(c => c.id === _activeCaseId);
    if (idx < 0) { _toast('บันทึกข้อมูลทั่วไปก่อน', 'error'); return; }

    const c = { ...cases[idx] };
    if (stepKey === 'channels') {
      c.channel_ids = [...document.querySelectorAll('.ilcc-ch-check:checked')].map(el => el.value);
    } else if (stepKey === 'partners') {
      c.partner_group_ids = [...document.querySelectorAll('.ilcc-grp-check:checked')].map(el => el.value);
    } else if (stepKey === 'ma') {
      c.ma_job_ids = [...document.querySelectorAll('.ilcc-ma-check:checked')].map(el => el.value);
    } else if (stepKey === 'sp') {
      c.sp_services = [..._caseSPServices];
    }
    cases[idx] = c;
    _cfg.cases = cases;

    const STEP_LABELS = { channels:'Channels', partners:'Partner Groups', ma:'MA Jobs', sp:'SP Services' };
    try {
      const r = await API.post('/incident-launcher/index.php', { action: 'save_config', config: _cfg });
      console.log('[ILC saveCaseStep] status:', r?.status, 'data:', r?.data);
      if (r?.data?.ok === true) {
        _toast(`บันทึก ${STEP_LABELS[stepKey]||stepKey} สำเร็จ`, 'success');
        _renderCases();
      } else {
        const msg = r?.data?.message || r?.data?.error || `HTTP ${r?.status||'?'}`;
        _toast(`บันทึกไม่สำเร็จ: ${msg}`, 'error');
        console.error('[ILC saveCaseStep] non-ok response:', r);
      }
    } catch(e) {
      _toast(`บันทึกไม่สำเร็จ: ${e?.message||'error'}`, 'error');
      console.error('[ILC saveCaseStep] exception:', e);
    }
  }

  async function deleteCase(caseId) {
    const c = (_cfg.cases||[]).find(x => x.id === caseId);
    if (!c) return;
    if (!confirm(`ลบ Case "${c.name}" ใช่ไหม?`)) return;
    _cfg.cases = (_cfg.cases||[]).filter(x => x.id !== caseId);
    try {
      const r = await API.post('/incident-launcher/index.php', { action: 'save_config', config: _cfg });
      if (r?.data?.ok === true) {
        _toast('ลบ Case เรียบร้อย', 'success');
        _activeCaseId = null;
        _renderCases();
      } else {
        _toast(`ลบไม่สำเร็จ: ${r?.data?.message||r?.status||'error'}`, 'error');
      }
    } catch(e) { _toast(`ลบไม่สำเร็จ: ${e?.message||'error'}`, 'error'); }
  }

  /* ── SP Services search (shared by case SP tab) ─────────── */
  async function caseSPSearch(q) {
    const drop = document.getElementById('ilcc-sp-dropdown');
    if (!drop) return;
    if (!q || q.length < 1) { drop.style.display = 'none'; return; }

    let matches = [];
    try {
      const r = await API.get('/service-performance/index.php?runway=all');
      const all = (r?.data?.data?.results || r?.data?.results || []).flatMap(rw => rw.services || []);
      matches = all.filter(s => (s.service||s.name||'').toLowerCase().includes(q.toLowerCase())).slice(0, 15);
    } catch(_) {}

    // Build dropdown — always show "add as typed" option at top
    const exactAlreadyAdded = _caseSPServices.includes(q);
    const manualItem = !exactAlreadyAdded ? `
      <div class="ilc-sp-drop-item ilc-sp-drop-manual" onclick="ILC.caseSPAdd('${_esc(q)}')">
        <i data-icon="plus-circle"></i>
        เพิ่ม "<strong>${_esc(q)}</strong>" — หรือกด Enter
      </div>` : '';

    const inventoryItems = matches.length
      ? matches.map(s => {
          const name = s.service || s.name || '?';
          const already = _caseSPServices.includes(name);
          return `<div class="ilc-sp-drop-item ${already ? 'ilc-sp-drop-added' : ''}" onclick="${already ? '' : `ILC.caseSPAdd('${_esc(name)}')`}">
            <i data-icon="activity"></i> ${_esc(name)}
            ${already ? '<span style="font-size:10px;color:var(--text-muted)">เพิ่มแล้ว</span>' : ''}
          </div>`;
        }).join('')
      : `<div class="ilc-sp-drop-empty"><i data-icon="info"></i> ไม่พบ service ใน inventory — พิมพ์ชื่อแล้วกด Enter เพื่อเพิ่มเอง</div>`;

    drop.innerHTML = manualItem + inventoryItems;
    drop.style.display = '';
    if (window.Icons) Icons.replaceAll(drop);
  }

  function caseSPSearchKeydown(e) {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) caseSPAdd(q);
    }
    if (e.key === 'Escape') {
      const d = document.getElementById('ilcc-sp-dropdown');
      if (d) d.style.display = 'none';
    }
  }

  function caseSPAdd(name) {
    if (!name || _caseSPServices.includes(name)) return;
    _caseSPServices.push(name);
    const inp = document.getElementById('ilcc-sp-search');
    if (inp) inp.value = '';
    const d = document.getElementById('ilcc-sp-dropdown');
    if (d) d.style.display = 'none';
    // Re-render just the SP tab content
    const content = document.getElementById('ilcc-tab-content');
    if (content) {
      const c = (_cfg.cases||[]).find(x => x.id === _activeCaseId) || {};
      content.innerHTML = _renderCaseTabSP(c);
      if (window.Icons) Icons.replaceAll(content);
    }
  }

  function caseSPRemove(name) {
    _caseSPServices = _caseSPServices.filter(s => s !== name);
    const content = document.getElementById('ilcc-tab-content');
    if (content) {
      const c = (_cfg.cases||[]).find(x => x.id === _activeCaseId) || {};
      content.innerHTML = _renderCaseTabSP(c);
      if (window.Icons) Icons.replaceAll(content);
    }
  }

  function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('click', e => {
    if (!e.target.closest('.ilc-sp-search-wrap') && !e.target.closest('#ilcc-sp-dropdown')) {
      document.getElementById('ilc-sp-dropdown')?.style.setProperty('display','none');
      document.getElementById('ilcc-sp-dropdown')?.style.setProperty('display','none');
    }
  });

  return { switchTab, saveGeneral, saveStep1, saveStep2, saveStep3, saveStep7, saveStep8,
    testWebhook, lookupEscalateTransition, loadIssueTypes, validateMeetUrl,
    addPresetField, removePresetField, loadJiraFields, filterJiraFields, _pickJiraField, closeJiraFieldsModal,
    loadFieldDefaults, _fdAddChip, _fdRemoveChip,
    addSpService, removeSpService, spSearch, spSearchKeydown, spAddService,
    _spDragStart, _spDragOver, _spDrop, _spDropHighlight,
    openChannelForm, closeChannelForm, saveChannel, deleteChannel, testChannel, onPlatformChange,
    openMaForm, closeMaForm, saveMaJob, deleteMaJob, onMaTypeChange, onBoToggle, addBoConfig, removeBoConfig, peekBoConfigRow, peekBoValueFor,
    parseJenkinsUrl, onServerChange, onServerManualInput,
    searchJenkinsJobs, filterJobs, selectJob,
    openCaseDetail, backToCaseList, switchCaseTab,
    saveCaseBasic, saveCaseStep, deleteCase,
    caseSPSearch, caseSPSearchKeydown, caseSPAdd, caseSPRemove,
    openTemplateForm, closeTemplateForm, saveTemplate, deleteTemplate,
    openGroupForm, closeGroupForm, saveGroup, deleteGroup, saveEmailTemplate,
    openLinkForm, closeLinkForm, saveLink, deleteLink };
})();
