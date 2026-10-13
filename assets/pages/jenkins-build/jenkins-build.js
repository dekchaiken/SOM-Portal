// jenkins-build — page script, extracted from jenkins-build.html.
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

if (!Auth.requireAuth()) {}
  Layout.render('jenkins-build');

  const state = {
    tools: [], servers: {}, canApprove: false, jbRole: 'maker', toolId: null,
    history: [], approvals: [], pollTimer: null,
  };

  const isChecker = () => state.jbRole === 'checker';

  const $ = id => document.getElementById(id);

  // ── Loaders ────────────────────────────────────────────────────────────────
  async function loadTools() {
    const res = await API.get('/jenkins-build/');
    if (!res?.ok) throw new Error(res?.data?.message || 'โหลดไม่สำเร็จ');
    state.tools   = res.data.data.tools   || [];
    state.servers = res.data.data.servers || {};
    state.canApprove = !!res.data.data.can_approve;
    state.jbRole     = res.data.data.jb_role || 'maker';
    if (!state.tools.length) {
      $('jb-loading').textContent = 'ทีมของคุณยังไม่มี Jenkins Build tool ที่เปิดใช้งาน — ติดต่อ Admin';
      $('jb-loading').style.display = '';
      return;
    }
    if (!state.toolId || !state.tools.find(t => t.id === state.toolId)) {
      state.toolId = state.tools[0].id;
    }
    // Tag page with role so CSS can hide back-button etc.
    const pageEl = document.querySelector('.jb-page');
    if (pageEl) {
      pageEl.classList.remove('role-maker', 'role-checker', 'role-admin');
      pageEl.classList.add('role-' + (state.jbRole || 'maker'));
    }
    renderToolbar();
    renderRoleHeader();
    // Trigger card ถูกซ่อนไว้เสมอ: Checker สร้างไม่ได้, Maker เข้ามาก็ไปหน้า Trigger ตรงๆ อยู่แล้ว
    $('jb-home-trigger').style.display = 'none';
    // Maker/Admin → ข้าม landing ไปหน้า Trigger เลย; Checker → เห็น landing 2 การ์ด (รออนุมัติ/History)
    if (isChecker()) {
      showCheckerHome();
      renderCheckerHome();
      const h1 = document.querySelector('.jb-hero h1');
      const sub = document.getElementById('jb-page-sub');
      if (h1) h1.innerHTML = 'Checker <span class="jb-orange">Dashboard</span>';
      if (sub) sub.textContent = 'เลือกงานที่ต้องการตรวจสอบ · ' + state.approvals.filter(a => a.status === 'pending').length + ' รายการรออนุมัติ';
    } else {
      renderCheckerHome();
      openCheckerPanel('trigger');
    }
  }

  // ── Landing (all roles) ────────────────────────────────────────────────────
  // Home shows choice cards (Trigger / รออนุมัติ / Build History). Checker sees
  // only the last two. Clicking a card slides the matching panel in.
  function showCheckerHome() {
    $('jb-checker-panels').classList.remove('visible');
    $('jb-checker-home').style.display = '';
    document.querySelectorAll('#jb-checker-panels > div').forEach(p => { p.style.display = 'none'; });
    state.checkerPanel = null;
    const tb = $('jb-toolbar');
    if (tb) tb.style.display = '';
  }

  function renderCheckerHome() {
    const ap = $('jb-ch-approvals-count');
    if (ap) ap.textContent = state.approvals.filter(a => a.status === 'pending').length + ' รายการ';
    const hc = $('jb-ch-history-count');
    if (hc) hc.textContent = state.history.length + ' รายการ';
  }

  function openCheckerPanel(name) {
    const panels = $('jb-checker-panels');
    $('jb-checker-home').style.display = 'none';
    const tb = $('jb-toolbar');
    if (tb) tb.style.display = 'none';
    document.querySelectorAll('#jb-checker-panels > div').forEach(p => { p.style.display = 'none'; });
    const target = $('jb-panel-' + name);
    if (!target) return;
    target.style.display = '';
    target.classList.remove('jb-panel-enter');
    void target.offsetWidth; // restart animation
    target.classList.add('jb-panel-enter');
    panels.classList.add('visible');
    state.checkerPanel = name;
    updateHero(name);
    if (name === 'trigger') renderForm();
    if (name === 'approvals') renderApprovals();
    if (name === 'history') renderHistory();
  }

  // Hero title changes per panel — Trigger keeps "Trigger Jenkins Job",
  // Approvals switches to "Pending Approvals", History to "Build History".
  function updateHero(panel) {
    const h1 = document.querySelector('.jb-hero h1');
    const sub = document.getElementById('jb-page-sub');
    if (!h1 || !sub) return;
    if (panel === 'approvals') {
      h1.innerHTML = 'Pending <span class="jb-orange">Approvals</span>';
      sub.textContent = 'Review and authorize submitted pipelines';
    } else if (panel === 'history') {
      h1.innerHTML = 'Build <span class="jb-orange">History</span>';
      sub.textContent = 'ประวัติการ Build ของทีม · auto-refresh ทุก 30 วิ';
    } else {
      h1.innerHTML = 'Trigger <span class="jb-orange">Jenkins Job</span>';
      const tool = state.tools.find(t => t.id === state.toolId);
      sub.textContent = tool ? 'Pipeline: ' + (tool.name || tool.id) : 'Pipeline: Config-driven build launcher';
    }
  }

  function backToCheckerHome() {
    showCheckerHome();
    renderCheckerHome();
    // Checker landing = pick between รออนุมัติ / History
    const h1 = document.querySelector('.jb-hero h1');
    const sub = document.getElementById('jb-page-sub');
    if (h1 && sub) {
      if (isChecker()) {
        h1.innerHTML = 'Checker <span class="jb-orange">Dashboard</span>';
        sub.textContent = 'เลือกงานที่ต้องการตรวจสอบ';
      } else {
        h1.innerHTML = 'Trigger <span class="jb-orange">Jenkins Job</span>';
        sub.textContent = 'Pipeline: Config-driven build launcher';
      }
    }
  }

  // Role banner — explains what this user can/cannot do (maker vs checker).
  function renderRoleHeader() {
    const el = $('jb-role-banner');
    if (!el) return;
    if (state.jbRole === 'checker') {
      el.style.display = '';
      el.innerHTML = '🛂 คุณเป็น <b>Checker</b> — ตรวจสอบและอนุมัติรายการได้อย่างเดียว ไม่สามารถสร้างรายการ Build ใหม่ได้';
    } else if (state.jbRole === 'maker') {
      el.style.display = '';
      el.innerHTML = '✍️ คุณเป็น <b>Maker</b> — สร้างรายการ Build ได้ และรอ Checker อนุมัติก่อนเริ่ม Build';
    } else if (state.jbRole === 'admin') {
      el.style.display = '';
      el.innerHTML = '👑 คุณเป็น <b>Admin</b> — สร้างรายการได้ และอนุมัติได้โดยตรง';
    } else {
      el.style.display = 'none';
    }
  }

  async function loadHistory() {
    const res = await API.get('/jenkins-build/?history=1');
    if (!res?.ok) return;
    state.history = res.data.data || [];
    renderHistory();
    renderStats();
    renderCheckerHome();
  }

  async function loadApprovals() {
    const res = await API.get('/jenkins-build/?approvals=1');
    if (!res?.ok) return;
    state.approvals = (res.data.data || []).filter(a => a.status === 'pending');
    renderApprovals();
    renderStats();
    renderCheckerHome();
  }

  async function refreshAll() {
    try {
      await Promise.all([loadTools(), loadHistory(), loadApprovals()]);
      $('jb-loading').style.display = 'none';
      $('jb-body').style.display = '';
    } catch (e) {
      $('jb-loading').textContent = e.message;
    }
  }

  // ── Stats + Server status (portal-style cards) ────────────────────────────
  function renderStats() {
    const recent  = state.history.slice(0, 50);
    const succ    = recent.filter(h => String(h.status).toLowerCase() === 'success').length;
    const rateEl  = $('jb-status-rate');
    if (rateEl) rateEl.textContent = recent.length ? Math.round(succ / recent.length * 100) + '%' : '—';
    const pendEl  = $('jb-status-pending');
    if (pendEl) {
      const n = state.approvals.length;
      pendEl.textContent = n + ' รายการ';
      pendEl.className = 'jb-status-value' + (n > 0 ? ' warn' : '');
    }
  }

  async function loadStatus() {
    const el = $('jb-jenkins-status');
    if (!el) return;
    const tool = state.tools[0];
    if (!tool) return;
    try {
      const res = await API.get('/jenkins-build/?status=1&tool_id=' + encodeURIComponent(tool.id));
      if (!res?.ok) { el.textContent = 'ไม่สามารถเช็คได้'; el.className = 'jb-status-value bad'; return; }
      const d = res.data.data || {};
      if (d.reachable) {
        el.textContent = 'Connected' + (d.last_build ? ' · #' + d.last_build.number : '');
        el.className = 'jb-status-value ok';
      } else {
        el.textContent = 'Offline'; el.title = d.message || ''; el.className = 'jb-status-value bad';
      }
    } catch { el.textContent = '—'; }
  }

  // ── Toolbar + form ─────────────────────────────────────────────────────────
  function renderToolbar() {
    const sel = $('jb-tool-select');
    sel.innerHTML = state.tools.map(t =>
      `<option value="${escHtml(t.id)}">${escHtml(t.name || t.id)}</option>`
    ).join('');
    sel.value = state.toolId;

    const tool = state.tools.find(t => t.id === state.toolId);
    const srv  = tool ? state.servers[tool.server_id] : null;
    $('jb-server-pill').textContent = srv ? '⊙ ' + (srv.display || srv.base_url) : '⊙ server not configured';
    $('jb-form-tool-name').textContent = tool ? '— ' + escHtml(tool.name || '') : '';
    $('jb-form-desc').textContent = tool?.description || 'Please fill in all required information correctly to initiate the automation process.';
    const sub = document.getElementById('jb-page-sub');
    if (sub && tool) sub.textContent = 'Pipeline: ' + (tool.name || tool.id);
  }

  function renderForm() {
    const tool = state.tools.find(t => t.id === state.toolId);
    const form = $('jb-form');
    if (!tool) { form.innerHTML = '<div class="jb-empty">ไม่พบ tool</div>'; return; }
    // Checker cannot create build requests — show a notice instead of the form.
    if (isChecker()) {
      form.innerHTML = '<div class="jb-empty" style="padding:24px">🛂 Checker ไม่สามารถสร้างรายการได้ — ตรวจสอบและอนุมัติจากช่อง "รออนุมัติ" ทางขวาเท่านั้น</div>';
      const btn = $('jb-submit-btn');
      if (btn) btn.style.display = 'none';
      return;
    }

    form.innerHTML = (tool.params || []).map(p => {
      const label = escHtml(p.label || p.key) + (p.required ? ' <span style="color:#ef4444">*</span>' : '');
      const hint = p.hint ? `<div class="jb-hint">${escHtml(p.hint)}</div>` : '';
      const err  = '<div class="jb-err">รูปแบบไม่ถูกต้อง</div>';
      if (p.type === 'select' && Array.isArray(p.options)) {
        const opts = (p.required ? '<option value="">— เลือก —</option>' : '') + p.options
          .map(o => typeof o === 'object'
            ? `<option value="${escHtml(String(o.value ?? o.label))}">${escHtml(String(o.label ?? o.value))}</option>`
            : `<option value="${escHtml(String(o))}">${escHtml(String(o))}</option>`).join('');
        return `<div class="jb-field" data-key="${escHtml(p.key)}">
          <label>${label}</label>
          <select data-key="${escHtml(p.key)}" data-required="${p.required ? 1 : 0}">${opts}</select>
          ${hint}${err}</div>`;
      }
      const isReadonly = (tool.auto_params || {})[p.key];
      const roAttr = isReadonly ? ' readonly class="jb-readonly"' : '';
      return `<div class="jb-field" data-key="${escHtml(p.key)}">
        <label>${label}</label>
        <input type="text" data-key="${escHtml(p.key)}" placeholder="${escHtml(p.placeholder || '')}"
               data-pattern="${escHtml(p.pattern || '')}" data-required="${p.required ? 1 : 0}"
               ${p.required ? 'required' : ''}${roAttr}>
        ${hint}${err}</div>`;
    }).join('') + `
      <button type="submit" class="jb-submit" id="jb-submit-btn">
        <span>⚡</span> ${tool.approval?.enabled && !state.canApprove ? 'ส่งเพื่อขออนุมัติ' : 'Run Build Pipeline'}
      </button>`;

    const me = Auth.getUser();
    form.querySelectorAll('input[readonly]').forEach(inp => {
      if ((tool.auto_params || {})[inp.dataset.key] === 'username') inp.value = me?.username || '';
    });
    form.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input',  () => { validateField(el); updateSubmitState(); });
      el.addEventListener('change', () => { validateField(el); updateSubmitState(); });
    });
    updateSubmitState();
  }

  function validateField(el) {
    const field = el.closest('.jb-field');
    const pattern = el.dataset.pattern;
    const val = el.value.trim();
    let ok = true;
    if (el.dataset.required === '1' && val === '') ok = false;
    else if (val && pattern) { try { ok = new RegExp('^(?:' + pattern + ')$').test(val); } catch { ok = true; } }
    el.classList.toggle('jb-invalid', !ok);
    field.classList.toggle('jb-has-err', !ok && val !== '');
    return ok;
  }

  function updateSubmitState() {
    const btn = $('jb-submit-btn');
    if (!btn) return;
    const els = [...$('jb-form').querySelectorAll('input, select')];
    btn.disabled = !els.every(validateField) || els.some(e => e.dataset.required === '1' && !e.value.trim());
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  // Guard: if Auth/Layout already showed a No Access overlay, document.body
  // was wiped — stop before touching elements that no longer exist.
  const _jbForm = document.getElementById('jb-form');
  if (_jbForm) {
    _jbForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tool = state.tools.find(t => t.id === state.toolId);
    if (!tool) return;

    const params = {};
    $('jb-form').querySelectorAll('input, select').forEach(el => { params[el.dataset.key] = el.value.trim(); });

    const res = await API.post('/jenkins-build/', { action: 'submit', tool_id: state.toolId, params });
    if (!res?.ok) { Toast.error(res?.data?.message || 'Submit ล้มเหลว'); return; }

    const d = res.data.data;
    if (d.status === 'pending_approval') {
      $('jb-form').reset();
      updateSubmitState();
      await loadApprovals();
      openApprovalSentModal(d.approval_id || d.id, params, tool);
    } else if (d.status === 'queued') {
      Toast.success('Build ถูก queue แล้ว');
      $('jb-form').reset();
      updateSubmitState();
      openProgress(d.queue_id);
      await loadHistory();
    }
    });
  }

  // ── Approvals (table view, wealth-portal style) ────────────────────────────
  function renderApprovals() {
    $('jb-approvals-count').textContent = state.approvals.length;
    const body = $('jb-approvals-body');
    if (!body) return;
    if (!state.approvals.length) {
      body.innerHTML = '<tr><td colspan="4" class="jb-empty">&#127881; No pending approvals right now.</td></tr>';
      return;
    }
    body.innerHTML = state.approvals.map(a => {
      const paramsHtml = Object.entries(a.params || {})
        .filter(([k]) => !k.startsWith('updated_by'))
        .map(([k, v]) => `<span class="jb-pk">${escHtml(k)}:</span> ${escHtml(String(v))}`)
        .join('<br>');
      const decisionCell = state.canApprove
        ? `<div style="display:inline-flex;gap:.5rem">
            <button class="jb-btn-sm jb-btn-approve-sm" onclick="decideApproval('${escHtml(a.id)}', 'approve')">&#10003; Approve</button>
            <button class="jb-btn-sm jb-btn-reject-sm" onclick="decideApproval('${escHtml(a.id)}', 'reject')">&#10007; Reject</button>
          </div>`
        : '<span class="jb-hint" style="margin:0">รอ Checker…</span>';
      return `<tr data-id="${escHtml(a.id)}">
        <td class="jb-meta-cell">${escHtml(fmtTime(a.submitted_at))}</td>
        <td>
          <div class="jb-maker-name">${escHtml(a.submitted_name || a.submitted_by || '—')}</div>
          <div class="jb-maker-handle">${escHtml(a.tool_name || a.tool_id || '')}</div>
        </td>
        <td><div class="jb-param-box">${paramsHtml || '<span style="color:var(--jb-muted)">(no params)</span>'}</div></td>
        <td class="jb-decision-cell">${decisionCell}</td>
      </tr>`;
    }).join('');
  }

  async function decideApproval(id, action) {
    const a = state.approvals.find(x => x.id === id);
    const label = action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ';
    const paramsText = Object.entries(a?.params || {}).map(([k,v]) => k + ': ' + v).join('\n');
    if (!await confirmDialog(paramsText || '(ไม่มีข้อมูล params)', `ยืนยันการ${label}?`, {
      variant: action === 'approve' ? 'primary' : 'danger',
      confirmText: label, cancelText: 'ยกเลิก'
    })) return;
    const res = await API.post('/jenkins-build/', { action, approval_id: id });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ดำเนินการไม่สำเร็จ'); return; }
    Toast.success(res.data.message || (label + 'สำเร็จ'));
    const d = res.data.data;
    if (d?.status === 'queued') openProgress(d.queue_id);
    await Promise.all([loadApprovals(), loadHistory()]);
  }

  // ── History ────────────────────────────────────────────────────────────────
  function fmtDuration(val) {
    if (!val) return '';
    const ms = Number(val);
    if (isNaN(ms) || ms <= 0) return String(val);
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), rem = s % 60;
    if (m < 60) return m + 'm' + (rem ? ' ' + rem + 's' : '');
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function buildUrl(h) {
    if (!h.build_number) return null;
    const tool = state.tools.find(t => t.id === h.tool_id);
    if (!tool) return null;
    const srv = state.servers[tool.server_id];
    if (!srv?.base_url) return null;
    return srv.base_url.replace(/\/$/, '') + tool.job_path + '/' + h.build_number + '/';
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      success: ['jb-b-success', 'Success'], failure: ['jb-b-failure', 'Failure'],
      aborted: ['jb-b-aborted', 'Aborted'], rejected: ['jb-b-rejected', 'Rejected'],
      queued: ['jb-b-running', 'Queued'], 'in queue': ['jb-b-running', 'In Queue'],
      building: ['jb-b-running', 'Building'],
    };
    const [cls, label] = map[s] || ['jb-b-unknown', status || 'Unknown'];
    return `<span class="jb-badge ${cls}">${escHtml(label)}</span>`;
  }

  function historyRowsHtml() {
    if (!state.history.length) {
      return '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">ยังไม่มีประวัติ</td></tr>';
    }
    return state.history.map(h => {
      const params = Object.entries(h.params || {})
        .filter(([k]) => !k.startsWith('updated_by'))
        .map(([k, v]) => `${k}=${v}`).join(' · ');
      const url = buildUrl(h);
      const s = String(h.status || '').toLowerCase();
      const isLive = ['queued', 'in queue', 'building'].includes(s);
      const buildCell = h.build_number
        ? (url
            ? `<a href="${url}" target="_blank" rel="noopener" style="color:var(--orange);font-weight:800;text-decoration:none">#${escHtml(String(h.build_number))} <span style="font-size:9px;opacity:.7">&#8599;</span></a>`
            : `<span style="font-weight:800">#${escHtml(String(h.build_number))}</span>`)
        : (isLive ? `<span style="color:var(--text-muted);font-size:10px">In Queue</span>` : '<span style="opacity:.35">—</span>');
      const dur = h.duration ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${fmtDuration(h.duration)}</div>` : '';
      const approval = [
        h.approved_by ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">✓ ${escHtml(h.approved_by)}</div>` : '',
        h.rejected_by ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">✕ ${escHtml(h.rejected_by)}</div>` : '',
      ].join('');
      const resultLabel = h.result && !isLive
        ? `<div style="font-size:9.5px;color:var(--text-muted);margin-top:2px;letter-spacing:.03em">${escHtml(h.result)}</div>`
        : '';
      return `<tr>
        <td class="jb-tool-cell">${escHtml(h.tool_name || h.tool_id || '')}</td>
        <td class="jb-params-cell">${escHtml(params)}</td>
        <td>${statusBadge(h.status)}${resultLabel}</td>
        <td class="jb-meta-cell">${escHtml(h.user_name || h.user_id || '')}</td>
        <td class="jb-meta-cell">${escHtml(fmtTime(h.ts))}</td>
        <td class="jb-meta-cell">${buildCell}${dur}${approval}</td>
      </tr>`;
    }).join('');
  }

  function renderHistory() {
    $('jb-history-count').textContent = state.history.length;
    const body = $('jb-history-body');
    if (body) body.innerHTML = historyRowsHtml();
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ── Progress modal ─────────────────────────────────────────────────────────
  function openProgress(queueId) {
    const tool = state.tools.find(t => t.id === state.toolId);
    if (!tool) return;
    const modal = $('jb-progress-modal');
    $('jb-modal-title').textContent = 'Executing Pipeline';
    $('jb-modal-status').textContent = 'Waiting in Jenkins queue...';
    $('jb-progress-bar').style.width = '0%';
    $('jb-progress-pct').textContent = '0%';
    $('jb-modal-result').style.display = 'none';
    $('jb-modal-close').style.display = 'none';
    modal.style.display = 'flex';

    let tries = 0;
    const poll = async () => {
      tries++;
      const res = await API.get(`/jenkins-build/?action=status&tool_id=${encodeURIComponent(tool.id)}&queue_id=${encodeURIComponent(queueId)}`);
      if (!res?.ok) { $('jb-modal-status').textContent = 'Error polling status'; return; }
      const st = res.data.data || {};
      $('jb-progress-bar').style.width = (st.progress || 0) + '%';
      $('jb-progress-pct').textContent = (st.progress || 0) + '%';
      if (st.status === 'Finished') {
        $('jb-modal-status').textContent = 'Build completed.';
        $('jb-modal-title').textContent = 'Pipeline Finished';
        const result = (st.result || 'UNKNOWN').toUpperCase();
        const el = $('jb-modal-result');
        el.textContent = 'STATUS: ' + result;
        el.className = 'jb-modal-result ' + (result === 'SUCCESS' ? 'ok' : result === 'FAILURE' ? 'bad' : 'mid');
        el.style.display = 'block';
        $('jb-progress-bar').style.width = '100%';
        $('jb-progress-pct').textContent = '100%';
        $('jb-modal-close').style.display = '';
        await loadHistory();
        return;
      }
      if (st.status === 'Building') $('jb-modal-status').textContent = 'Processing pipeline steps...';
      if (st.status === 'In Queue') $('jb-modal-status').textContent = 'Waiting in Jenkins queue...';
      if (st.status === 'Unknown' && tries > 40) { // ~60s timeout
        $('jb-modal-status').textContent = 'ไม่สามารถติดตามสถานะได้ (Jenkins queue หมดอายุ) — ตรวจใน History';
        $('jb-modal-close').style.display = '';
        return;
      }
      setTimeout(poll, 1500);
    };
    poll();
  }

  $('jb-modal-close').addEventListener('click', () => { $('jb-progress-modal').style.display = 'none'; });

  // ── Approval-sent popup (Maker) ───────────────────────────────────────────
  // Opens after submit-with-approval succeeds. Lists what was sent and polls
  // /approvals every 5s; when the item disappears from pending, cross-checks
  // history to say Approved or Rejected, and shows a "start build progress"
  // button if Checker approved (queued).
  let apprPollTimer = null;
  function openApprovalSentModal(approvalId, params, tool) {
    const modal = $('jb-approval-modal');
    const details = $('jb-appr-details');
    const rows = Object.entries(params || {})
      .filter(([k]) => !k.startsWith('updated_by'))
      .map(([k, v]) => `
        <div class="jb-confirm-row">
          <span class="jb-confirm-label">${escHtml(k)}</span>
          <span class="jb-confirm-value">${escHtml(String(v))}</span>
        </div>`).join('');
    const me = Auth.getUser();
    details.innerHTML = `
      <div class="jb-confirm-row">
        <span class="jb-confirm-label">Tool</span>
        <span class="jb-confirm-value orange">${escHtml(tool?.name || tool?.id || '')}</span>
      </div>
      ${rows}
      <div class="jb-confirm-row">
        <span class="jb-confirm-label">Submitted By</span>
        <span class="jb-confirm-value">${escHtml(me?.fullname || me?.username || '')}</span>
      </div>
      <div class="jb-confirm-row">
        <span class="jb-confirm-label">Submitted At</span>
        <span class="jb-confirm-value">${escHtml(fmtTime(new Date().toISOString()))}</span>
      </div>`;

    setApprState('pending', 'Pending Approval', 'Checker กำลังตรวจสอบคำขอของคุณ', '⏳');
    modal.style.display = 'flex';

    if (apprPollTimer) clearInterval(apprPollTimer);
    if (!approvalId) return; // no id → static popup, user can close manually
    apprPollTimer = setInterval(() => pollApproval(approvalId), 5000);
  }

  function setApprState(state, statusText, subText, icon) {
    const statusEl = $('jb-appr-status');
    statusEl.className = 'jb-appr-status ' + state;
    $('jb-appr-status-text').textContent = statusText;
    $('jb-appr-sub').textContent = subText;
    const iconEl = $('jb-appr-icon');
    iconEl.textContent = icon;
    iconEl.className = 'jb-modal-icon' + (state === 'approved' ? ' ok' : state === 'rejected' ? ' bad' : '');
    if (state === 'approved') $('jb-appr-title').textContent = 'Checker อนุมัติแล้ว';
    else if (state === 'rejected') $('jb-appr-title').textContent = 'Checker ปฏิเสธรายการ';
    else $('jb-appr-title').textContent = 'ส่งรายการให้ Checker แล้ว';
  }

  async function pollApproval(approvalId) {
    try {
      const apvRes = await API.get('/jenkins-build/?approvals=1');
      const stillPending = (apvRes?.data?.data || [])
        .some(a => a.id === approvalId && a.status === 'pending');
      if (stillPending) return; // keep polling

      // Not pending anymore → check history to see if approved (queued/building/done) or rejected
      const hRes = await API.get('/jenkins-build/?history=1');
      const hist = (hRes?.data?.data || []).find(h => h.approval_id === approvalId);
      const status = String(hist?.status || '').toLowerCase();

      if (['queued', 'in queue', 'building', 'success', 'failure', 'aborted'].includes(status)) {
        setApprState('approved', 'Approved & Building', 'Checker อนุมัติแล้ว · Build กำลังทำงาน', '✓');
      } else if (status === 'rejected' || hist?.rejected_by) {
        setApprState('rejected', 'Rejected', 'Checker ปฏิเสธรายการนี้', '✕');
      } else {
        // Fallback: no longer pending, no history match — assume acted on
        setApprState('approved', 'Reviewed', 'Checker ได้ตรวจสอบรายการแล้ว', '✓');
      }
      clearInterval(apprPollTimer);
      apprPollTimer = null;
      await loadHistory();
    } catch { /* keep polling on transient errors */ }
  }

  $('jb-appr-close').addEventListener('click', () => {
    $('jb-approval-modal').style.display = 'none';
    if (apprPollTimer) { clearInterval(apprPollTimer); apprPollTimer = null; }
  });
  $('jb-appr-view').addEventListener('click', () => {
    $('jb-approval-modal').style.display = 'none';
    if (apprPollTimer) { clearInterval(apprPollTimer); apprPollTimer = null; }
    // Maker doesn't normally have the approvals landing — show it explicitly.
    showCheckerHome();
    renderCheckerHome();
    openCheckerPanel('approvals');
  });

  // ── Tool switch ────────────────────────────────────────────────────────────
  $('jb-tool-select').addEventListener('change', (e) => {
    state.toolId = e.target.value;
    renderToolbar();
    renderForm();
  });

  $('jb-refresh-btn').addEventListener('click', async () => {
    await Promise.all([loadHistory(), loadApprovals()]);
    Toast.success('อัปเดตแล้ว');
  });

  // ── Side "System Status" panel (Trigger view) ────────────────────────────
  function renderSideStatus() {
    const me = Auth.getUser();
    const nameEl = document.getElementById('jb-side-user');
    const dotEl  = document.getElementById('jb-side-dot');
    if (nameEl) {
      const display = me?.fullname || me?.name || me?.username || 'Guest';
      nameEl.textContent = 'Authenticated: ' + display;
    }
    if (dotEl) dotEl.className = 'jb-dot' + (me ? '' : ' bad');
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  (async function init() {
    renderSideStatus();
    await refreshAll();
    loadStatus();
    setInterval(() => { loadHistory(); loadApprovals(); }, 30_000);
    setInterval(loadStatus, 60_000);
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "backToCheckerHome", { configurable: true, get: () => backToCheckerHome, set: (v) => { backToCheckerHome = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildUrl", { configurable: true, get: () => buildUrl, set: (v) => { buildUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "decideApproval", { configurable: true, get: () => decideApproval, set: (v) => { decideApproval = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDuration", { configurable: true, get: () => fmtDuration, set: (v) => { fmtDuration = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTime", { configurable: true, get: () => fmtTime, set: (v) => { fmtTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "historyRowsHtml", { configurable: true, get: () => historyRowsHtml, set: (v) => { historyRowsHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadApprovals", { configurable: true, get: () => loadApprovals, set: (v) => { loadApprovals = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHistory", { configurable: true, get: () => loadHistory, set: (v) => { loadHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadStatus", { configurable: true, get: () => loadStatus, set: (v) => { loadStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadTools", { configurable: true, get: () => loadTools, set: (v) => { loadTools = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openApprovalSentModal", { configurable: true, get: () => openApprovalSentModal, set: (v) => { openApprovalSentModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCheckerPanel", { configurable: true, get: () => openCheckerPanel, set: (v) => { openCheckerPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openProgress", { configurable: true, get: () => openProgress, set: (v) => { openProgress = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pollApproval", { configurable: true, get: () => pollApproval, set: (v) => { pollApproval = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshAll", { configurable: true, get: () => refreshAll, set: (v) => { refreshAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderApprovals", { configurable: true, get: () => renderApprovals, set: (v) => { renderApprovals = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCheckerHome", { configurable: true, get: () => renderCheckerHome, set: (v) => { renderCheckerHome = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderForm", { configurable: true, get: () => renderForm, set: (v) => { renderForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHistory", { configurable: true, get: () => renderHistory, set: (v) => { renderHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRoleHeader", { configurable: true, get: () => renderRoleHeader, set: (v) => { renderRoleHeader = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSideStatus", { configurable: true, get: () => renderSideStatus, set: (v) => { renderSideStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderToolbar", { configurable: true, get: () => renderToolbar, set: (v) => { renderToolbar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setApprState", { configurable: true, get: () => setApprState, set: (v) => { setApprState = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showCheckerHome", { configurable: true, get: () => showCheckerHome, set: (v) => { showCheckerHome = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "statusBadge", { configurable: true, get: () => statusBadge, set: (v) => { statusBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateHero", { configurable: true, get: () => updateHero, set: (v) => { updateHero = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateSubmitState", { configurable: true, get: () => updateSubmitState, set: (v) => { updateSubmitState = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "validateField", { configurable: true, get: () => validateField, set: (v) => { validateField = v; } }); } catch (e) {}
})();
