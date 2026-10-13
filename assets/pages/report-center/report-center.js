/* ═══════════════════════════════════════════════════════════════
   report-center.js  |  Weekly & Monthly Report Center
   ═══════════════════════════════════════════════════════════════ */

const RC = (() => {
  /* ── State ──────────────────────────────────────────────────── */
  let mode        = 'weekly';
  let currentWeek = null;
  let currentMonth = null;
  let weekList    = [];
  const cache     = {};

  const SECTION_DEFAULTS = {
    weekly:  { maTest: true, incidents: true, batchIssues: true, ticketMon: true, supportMA: true, supportDev: true, improvements: true, updates: false },
    monthly: { alertSummary: true, alertMoM: true, maMonthly: true },
  };

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* ── Bootstrap ──────────────────────────────────────────────── */
  async function init() {
    if (typeof Auth !== 'undefined') Auth.requireAuth();
    if (typeof Layout !== 'undefined') Layout.render('report-center');

    loadSections();
    bindSidebar();
    bindModeToggle();
    bindWeekNav();
    bindMonthNav();
    bindPresentation();

    // Bootstrap state from URL params
    const _rcp = new URLSearchParams(location.search);
    const _rcUrlMode  = _rcp.get('mode');
    const _rcUrlWeek  = _rcp.get('week');
    const _rcUrlMonth = _rcp.get('month');
    if (_rcUrlMode === 'monthly') {
      mode = 'monthly';
      document.querySelectorAll('.rc-mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === 'monthly'));
      toggle('rcWeekNav', false); toggle('rcMonthNav', true);
      toggle('weeklyPane', false); toggle('monthlyPane', true);
      toggle('rcSidebarWeekly', false); toggle('rcSidebarMonthly', true);
      applySections();
    }
    if (_rcUrlWeek  && /^\d{4}-\d{2}-\d{2}$/.test(_rcUrlWeek))  currentWeek  = 'week-' + _rcUrlWeek;
    if (_rcUrlMonth && /^\d{4}-\d{2}$/.test(_rcUrlMonth))        currentMonth = _rcUrlMonth;

    await loadWeekList();
    try {
      if (mode === 'monthly') { if (!currentMonth) initMonthNav(); await renderMonthly(); }
      else await renderWeekly();
    } catch { /* showError() already called inside */ }
  }

  /* ── Section persistence ────────────────────────────────────── */
  let sections = null;

  function loadSections() {
    try {
      sections = JSON.parse(localStorage.getItem('rc_sections_v1') || 'null')
        || structuredClone(SECTION_DEFAULTS);
    } catch { sections = structuredClone(SECTION_DEFAULTS); }
    applySections();
  }

  function saveSections() {
    localStorage.setItem('rc_sections_v1', JSON.stringify(sections));
  }

  function applySections() {
    const modeKey = mode;
    const items   = sections[modeKey] || {};
    Object.entries(items).forEach(([key, visible]) => {
      const el = document.getElementById('rc-sec-' + key);
      if (el) el.classList.toggle('rc-hidden', !visible);
    });
    document.querySelectorAll('[data-section-key]').forEach(cb => {
      if (cb.dataset.sectionMode !== mode) return;
      const key = cb.dataset.sectionKey;
      cb.checked = sections[mode]?.[key] !== false;
    });
  }

  function bindSidebar() {
    document.querySelectorAll('[data-section-key]').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.sectionKey;
        const m   = cb.dataset.sectionMode;
        if (!sections[m]) sections[m] = {};
        sections[m][key] = cb.checked;
        const el = document.getElementById('rc-sec-' + key);
        if (el) el.classList.toggle('rc-hidden', !cb.checked);
        saveSections();
      });
    });
    document.getElementById('rcResetSections')?.addEventListener('click', () => {
      sections[mode] = structuredClone(SECTION_DEFAULTS[mode]);
      saveSections();
      applySections();
    });
  }

  /* ── Mode toggle ─────────────────────────────────────────────── */
  function bindModeToggle() {
    document.querySelectorAll('.rc-mode-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        const m = btn.dataset.mode;
        if (m === mode) return;
        mode = m;
        document.querySelectorAll('.rc-mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
        toggle('rcWeekNav',        m === 'weekly');
        toggle('rcMonthNav',       m === 'monthly');
        toggle('weeklyPane',       m === 'weekly');
        toggle('monthlyPane',      m === 'monthly');
        toggle('rcSidebarWeekly',  m === 'weekly');
        toggle('rcSidebarMonthly', m === 'monthly');
        applySections();
        _rcUpdateUrl();
        if (m === 'weekly') await renderWeekly();
        else { if (!currentMonth) initMonthNav(); await renderMonthly(); }
      });
    });
  }

  function toggle(id, visible) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('rc-hidden', !visible);
  }

  /* ── Week navigation ────────────────────────────────────────── */
  function bindWeekNav() {
    document.getElementById('rcWeekPrev')?.addEventListener('click', () => navWeek(-1));
    document.getElementById('rcWeekNext')?.addEventListener('click', () => navWeek(+1));
  }

  async function loadWeekList() {
    try {
      const r = await API.get('/weekly-report/list.php');
      if (r === null) { currentWeek = currentWeek || _fallbackWeek(); updateWeekLabel(); return; }
      weekList = r.data?.weeks || [];
      if (!currentWeek) {
        // Prefer the COMPUTED current week (Tuesday-start) over weekList[0].
        // weekList[0] might be a ghost empty file created by a previous bug;
        // the computed week always matches WeeklyDateUtils.getCurrentWeek().
        const computed = _fallbackWeek();
        currentWeek = weekList.includes(computed) ? computed : (weekList[0] || computed);
      }
      updateWeekLabel();
      updateWeekNavBtns();
    } catch { currentWeek = currentWeek || _fallbackWeek(); updateWeekLabel(); }
  }

  function _fallbackWeek() {
    // Match WeeklyDateUtils: week starts on Tuesday (day=2)
    const d = new Date();
    const day  = d.getDay(); // 0=Sun … 6=Sat
    const diff = day >= 2 ? day - 2 : day + 5;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    // Use local date parts (NOT toISOString which is UTC)
    const y  = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `week-${y}-${mo}-${dy}`;
  }

  function updateWeekLabel() {
    const el = document.getElementById('rcWeekLabel');
    if (!el || !currentWeek) return;
    const start = new Date(currentWeek.replace('week-', '') + 'T00:00:00');
    const end   = new Date(start); end.setDate(end.getDate() + 6);
    const fmt   = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    el.textContent = `Week ${_isoWeek(start)} · ${fmt(start)}–${fmt(end)} ${start.getFullYear()}`;
  }

  function _isoWeek(d) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const y1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    return Math.ceil(((dt - y1) / 86400000 + 1) / 7);
  }

  function updateWeekNavBtns() {
    const idx = weekList.indexOf(currentWeek);
    const prev = document.getElementById('rcWeekPrev');
    const next = document.getElementById('rcWeekNext');
    if (prev) prev.disabled = (idx < 0 && weekList.length) || idx >= weekList.length - 1;
    if (next) next.disabled = idx <= 0;
  }

  function _rcUpdateUrl() {
    const _p = new URLSearchParams();
    if (mode !== 'weekly') _p.set('mode', mode);
    if (mode === 'weekly'  && currentWeek)  _p.set('week',  currentWeek.replace('week-', ''));
    if (mode === 'monthly' && currentMonth) _p.set('month', currentMonth);
    history.replaceState(null, '', _p.toString() ? '?' + _p.toString() : location.pathname);
  }

  async function navWeek(dir) {
    // dir = -1 → older (higher index), dir = +1 → newer (lower index)
    const idx    = weekList.indexOf(currentWeek);
    const newIdx = idx - dir;
    if (newIdx < 0 || newIdx >= weekList.length) return;
    currentWeek = weekList[newIdx];
    updateWeekLabel();
    updateWeekNavBtns();
    _rcUpdateUrl();
    await renderWeekly();
  }

  /* ── Month navigation ───────────────────────────────────────── */
  function bindMonthNav() {
    document.getElementById('rcMonthPrev')?.addEventListener('click', () => navMonth(-1));
    document.getElementById('rcMonthNext')?.addEventListener('click', () => navMonth(+1));
  }

  function initMonthNav() {
    const n = new Date();
    currentMonth = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    updateMonthLabel();
    updateMonthNavBtns();
  }

  function updateMonthLabel() {
    const el = document.getElementById('rcMonthLabel');
    if (!el || !currentMonth) return;
    const [y, m] = currentMonth.split('-').map(Number);
    el.textContent = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function updateMonthNavBtns() {
    const n = new Date();
    const now = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    const next = document.getElementById('rcMonthNext');
    if (next) next.disabled = currentMonth >= now;
  }

  async function navMonth(dir) {
    const [y, m] = currentMonth.split('-').map(Number);
    const d      = new Date(y, m - 1 + dir, 1);
    const n      = new Date();
    if (d > n) return;
    currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    updateMonthLabel();
    updateMonthNavBtns();
    _rcUpdateUrl();
    await renderMonthly();
  }

  /* ── Present button state ──────────────────────────────────── */
  function _setPresentLoading(on) {
    const btn = document.getElementById('rcPresentBtn');
    if (!btn) return;
    btn.disabled = on;
    btn.title = on ? 'กำลังโหลดข้อมูล…' : 'Present';
  }

  /* ── Weekly render ──────────────────────────────────────────── */
  async function renderWeekly() {
    if (!currentWeek) return;
    const month = currentWeek.replace('week-', '').slice(0, 7);

    _setPresentLoading(true);
    ['maTest','incidents','batchIssues','ticketMon','supportMA','supportDev','improvements','updates'].forEach(showLoading);

    const wk = _weekRange(currentWeek);

    const _timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
    const [weekRes, maRes, monRes] = await Promise.allSettled([
      Promise.race([_fetchWeekData(currentWeek),            _timeout(12000)]),
      Promise.race([_fetchMATest(month),                     _timeout(12000)]),
      Promise.race([_fetchWeeklyMonitoring(wk.from, wk.to), _timeout(12000)]),
    ]);

    if (weekRes.status === 'fulfilled') {
      const d = weekRes.value;
      _renderIncidents(d.incidents || []);
      _renderBatch(d.batch || {});
      _renderSupportList('supportMA', d.support?.ma || []);
      _renderSupportList('supportDev', d.support?.dev || []);
      _renderImprovements(d.improvements || {});
      _renderUpdates(d.updates || {});
    } else {
      ['incidents','batchIssues','supportMA','supportDev','improvements','updates'].forEach(id => showError(id));
    }

    if (maRes.status === 'fulfilled') {
      _renderMATest(maRes.value, month);
    } else {
      showError('maTest');
    }

    if (monRes.status === 'fulfilled') _renderTicketMon(monRes.value, wk);
    else showError('ticketMon');

    _setPresentLoading(false);
  }

  function _weekRange(weekId) {
    const start = new Date(weekId.replace('week-', '') + 'T00:00:00');
    const end   = new Date(start); end.setDate(end.getDate() + 6);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return { from: fmt(start), to: fmt(end), start, end };
  }

  async function _fetchWeeklyMonitoring(from, to) {
    const key = `wmon:${from}:${to}`;
    if (cache[key]) return cache[key];
    // Use ?detail=1 — the aggregated (non-detail) mode filters only by MONTH,
    // so a weekly range would return the whole month's totals. Detail mode
    // filters by exact created date range and returns each ticket row.
    const qs = `detail=1&type=monitoring&closed=all&detected=all&origin=all&action=all&fromDate=${from}&toDate=${to}`;
    const r = await API.get(`/jira/smc-analytics.php?${qs}`);
    if (r === null) throw new Error('aborted');
    const d = r.data?.data;
    if (!d) throw new Error('empty');
    cache[key] = d;
    return d;
  }

  function _renderTicketMon(data, wk) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const total   = rows.length;
    const closed  = rows.filter(r => r.closed).length;
    const smCount = rows.filter(r => (r.detectedBy || '').toUpperCase().match(/\bSM\b/)).length;
    const closePct = total > 0 ? Math.round(closed * 100 / total) : 0;
    const smPct    = total > 0 ? Math.round(smCount * 100 / total) : 0;

    const closeCls = closePct >= 90 ? 'good' : closePct >= 70 ? 'warn' : 'bad';
    const smCls    = smPct    >= 90 ? 'good' : smPct    >= 70 ? 'warn' : 'bad';
    const fmtRange = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const rangeLbl = `${fmtRange(wk.start)} – ${fmtRange(wk.end)} ${wk.start.getFullYear()}`;

    if (total === 0) {
      setContent('ticketMon', `
        <div class="rc-empty" style="padding:24px 0">No monitoring alerts this week (${esc(rangeLbl)})</div>
      `);
      return;
    }

    // Sort: open first, then by created DESC (endpoint already returns created DESC)
    const sorted = [...rows].sort((a, b) => (a.closed === b.closed ? 0 : a.closed ? 1 : -1));

    const listRows = sorted.map(r => {
      const db = (r.detectedBy || '').toUpperCase();
      const detTag = /\bSM\b/.test(db) ? { cls: 'good', lbl: 'SM' }
                   : /\bSS\b/.test(db) ? { cls: 'warn', lbl: 'SS' }
                   : { cls: 'bad',  lbl: db || '—' };
      const stateCls = r.closed ? 'good' : 'bad';
      const stateLbl = r.closed ? '✓ Closed' : '● Open';
      const url = r.url ? esc(r.url) : '';
      return `<div class="rc-item-row rc-row-click" ${url ? `onclick="window.open('${url}','_blank')"` : ''} title="${url ? 'เปิดใน Jira ↗' : ''}">
        <span class="rc-det ${stateCls}" style="min-width:64px">${stateLbl}</span>
        <span class="rc-key">${esc(r.key || '')}</span>
        <span class="rc-iname">${esc(r.summary || '—')}</span>
        <span class="rc-det ${detTag.cls}" title="Detected by">${esc(detTag.lbl)}</span>
        ${url ? `<span class="rc-open-jira">↗</span>` : ''}
      </div>`;
    }).join('');

    // Scroll container ≈ 5 rows visible; overflow scrolls (also works in Present mode)
    const listHint = total > 5
      ? ` <span style="font-weight:500;font-size:9px;color:var(--text-muted)">— แสดง 5 · เลื่อนดูได้ทั้งหมด ${total} · กดแถวเพื่อเปิด Jira</span>`
      : ` <span style="font-weight:500;font-size:9px;color:var(--text-muted)">— กดแถวเพื่อเปิด Jira</span>`;

    setContent('ticketMon', `
      <div class="gm-kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="gm-kpi">
          <div class="v">${total}</div>
          <div class="l">Total Alerts</div>
          <div class="s">${esc(rangeLbl)}</div>
        </div>
        <div class="gm-kpi">
          <div class="v ${closeCls}">${closePct}%</div>
          <div class="l">Close Rate</div>
          <div class="s">${closed} closed / ${total} alerts</div>
        </div>
        <div class="gm-kpi">
          <div class="v ${smCls}">${smPct}%</div>
          <div class="l">Detected by SM</div>
          <div class="s">${smCount} of ${total} (target 90%)</div>
        </div>
      </div>
      <div class="gm-section-head">Monitoring List${listHint}</div>
      <div class="rc-item-list rc-scroll-5">${listRows}</div>
    `);
  }

  async function _fetchWeekData(weekId) {
    const key = 'w:' + weekId;
    if (cache[key]) return cache[key];
    const r = await API.get('/weekly-report/get.php?week=' + encodeURIComponent(weekId));
    if (r === null) throw new Error('aborted');
    const weekData = r.data?.data;
    cache[key] = weekData;
    return weekData;
  }

  async function _fetchUserMap() {
    if (cache['users']) return cache['users'];
    try {
      const r = await API.get('/users/index.php');
      const list = Array.isArray(r.data?.data) ? r.data.data : [];
      const map  = {};
      list.forEach(u => { if (u.id) map[u.id] = u.name || u.username || u.id; });
      cache['users'] = map;
      return map;
    } catch { cache['users'] = {}; return {}; }
  }

  async function _fetchMATest(month) {
    const key = 'ma:' + month;
    if (cache[key]) return cache[key];
    const [pl, re, userMap] = await Promise.all([
      API.get('/ma-test/plans.php?month=' + month),
      API.get('/ma-test/results.php?month=' + month),
      _fetchUserMap(),
    ]);
    if (pl === null || re === null) throw new Error('aborted');
    const rawResults = re.data?.data?.items || [];
    const results = rawResults.map(r => ({
      ...r,
      tested_by_name: userMap[r.tested_by] || r.tested_by || '',
    }));
    const data = { plans: pl.data?.data?.items || [], results };
    cache[key] = data;
    return data;
  }

  /* ── Weekly section renderers ───────────────────────────────── */
  function _renderMATest(data, month) {
    _renderMASection('maTest', data, month);
  }

  function _renderMASection(secId, { plans, results }, month) {
    const total     = plans.length;
    const passed    = results.filter(r => r.result === 'Successed').length;
    const failed    = results.filter(r => r.result === 'Failed').length;
    const pct       = total > 0 ? Math.round(passed / total * 100) : 0;
    const pctCls    = pct >= 80 ? 'good' : pct >= 60 ? 'warn' : 'bad';
    const fillColor = pct >= 80 ? 'var(--gm-good)' : pct >= 60 ? 'var(--gm-warn)' : 'var(--gm-bad)';

    // ALL results, expandable on click
    const rows = results.map(r => {
      const cls   = r.result === 'Successed' ? 'clean' : r.result === 'Failed' ? 'miss' : 'warn';
      const badge = r.result === 'Successed' ? '✓' : r.result === 'Failed' ? '✗' : '…';
      const name  = esc(r.catalog?.name || r.plan?.note || r.catalog?.usecase_id || 'Test case');

      const details = [
        r.type        ? `<span class="rc-dtag">${esc(r.type)}</span>` : '',
        r.test_date   ? `<span class="rc-dtag">${esc(r.test_date)}</span>` : '',
        r.tested_by_name ? `<span class="rc-dtag">by ${esc(r.tested_by_name)}</span>` : '',
        r.refer_ticket && r.refer_ticket !== '-'
          ? `<a class="rc-dtag rc-dtag-link" href="https://truemoney.atlassian.net/browse/${esc(r.refer_ticket)}" target="_blank" rel="noopener">${esc(r.refer_ticket)} ↗</a>` : '',
      ].filter(Boolean).join('');

      const notes = [
        r.before_test && r.before_test !== '-' ? `<div class="rc-dnote"><b>Before:</b> ${esc(r.before_test)}</div>` : '',
        r.during_test && r.during_test !== '-' ? `<div class="rc-dnote"><b>During:</b> ${esc(r.during_test)}</div>` : '',
      ].filter(Boolean).join('');

      const hasDetail = details || notes;
      return `<div class="rc-test-row ${cls}${hasDetail ? ' rc-expandable' : ''}" ${hasDetail ? `onclick="var d=this.querySelector('.rc-expand');if(d)d.style.display=d.style.display==='block'?'none':'block'"` : ''}>
        <div style="display:flex;align-items:center;gap:8px;width:100%">
          <span class="rc-test-badge">${badge}</span>
          <span class="rc-test-name">${name}</span>
          <span class="rc-test-res">${esc(r.result || '—')}</span>
          ${hasDetail ? '<span class="rc-expand-icon">›</span>' : ''}
        </div>
        ${hasDetail ? `<div class="rc-expand" style="display:none;padding:6px 0 2px 28px">
          ${details ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px">${details}</div>` : ''}
          ${notes}
        </div>` : ''}
      </div>`;
    }).join('');

    const pending = results.filter(r => r.result === 'Pending' || r.result === '-').length;
    const subLabel = secId === 'maMonthly' ? `${pending} pending` : 'needs follow-up';

    setContent(secId, `
      <div class="gm-kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="gm-kpi"><div class="v">${total||'—'}</div><div class="l">Planned</div><div class="s">${month}</div></div>
        <div class="gm-kpi"><div class="v good">${passed}</div><div class="l">Passed</div><div class="s">Successed</div></div>
        <div class="gm-kpi"><div class="v ${failed?'bad':''}">${failed}</div><div class="l">Failed</div><div class="s">${subLabel}</div></div>
        <div class="gm-kpi"><div class="v ${pctCls}">${pct}%</div><div class="l">Pass Rate</div><div class="s">${results.length} executed of ${total}</div></div>
      </div>
      <div class="rc-prog-wrap">
        <div class="rc-prog-labels"><span>Completion</span><span class="rc-prog-pct">${pct}%</span></div>
        <div class="rc-prog-track"><div class="rc-prog-fill" style="width:${pct}%;background:${fillColor}"></div></div>
      </div>
      ${rows
        ? `<div class="gm-section-head">Test Items <span style="font-weight:500;font-size:9px;color:var(--text-muted)">— กดเพื่อดู detail</span></div>
           <div class="rc-test-list rc-scroll-list">${rows}</div>`
        : '<div class="rc-empty">No test results recorded this month</div>'}
    `);
  }

  function _renderIncidents(incidents) {
    const total    = incidents.length;
    const detected = incidents.filter(i => i.detected === 'Y').length;
    const pct      = total > 0 ? Math.round(detected / total * 100) : 0;
    const pctCls   = pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad';

    const rows = incidents.map(i => {
      const sev    = i.severity || '?';
      const detCls = i.detected === 'Y' ? 'good' : 'bad';
      const detLbl = i.detected === 'Y' ? '✓ SM' : '✗ SM';
      const url    = i.ticketUrl ? esc(i.ticketUrl) : '';
      return `<div class="rc-item-row rc-row-click" ${url ? `onclick="window.open('${url}','_blank')"` : ''} title="${url ? 'เปิดใน Jira ↗' : ''}">
        <span class="rc-sev s${sev}">S${sev}</span>
        <span class="rc-key">${esc((i.ticketId||'').trim())}</span>
        <span class="rc-iname">${esc(i.title || '—')}</span>
        <span class="rc-det ${detCls}">${detLbl}</span>
        ${url ? `<span class="rc-open-jira">↗</span>` : ''}
      </div>`;
    }).join('');

    setContent('incidents', `
      <div class="gm-kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="gm-kpi"><div class="v">${total}</div><div class="l">Total Incidents</div><div class="s">this week</div></div>
        <div class="gm-kpi"><div class="v good">${detected}</div><div class="l">Detected by SM</div><div class="s">out of ${total}</div></div>
        <div class="gm-kpi"><div class="v ${pctCls}">${pct}%</div><div class="l">SM Detection Rate</div><div class="s">target: 90%</div></div>
      </div>
      ${rows
        ? `<div class="gm-section-head">Incident List <span style="font-weight:500;font-size:9px;color:var(--text-muted)">— กดแถวเพื่อเปิด Jira</span></div>
           <div class="rc-item-list">${rows}</div>`
        : '<div class="rc-empty">No incidents recorded this week</div>'}
    `);
  }

  function _renderBatch(batch) {
    const pending = batch.pending || [];
    const events  = batch.event   || [];

    const renderGroup = (items, label) => {
      if (!items.length) return '';
      const rows = items.map(i => {
        const done = (i.status || '').toLowerCase() === 'done';
        return `<div class="rc-item-row">
          <span class="rc-dot ${done ? 'ok' : 'warn'}"></span>
          <span class="rc-iname">${esc(i.name || i.ticketId || '—')}</span>
          ${i.url ? `<a class="rc-key" href="${esc(i.url)}" target="_blank" rel="noopener">Link</a>` : ''}
          <span class="rc-tag-sm">${esc(i.status || '')}</span>
        </div>`;
      }).join('');
      return `<div class="gm-section-head">${label}</div><div class="rc-item-list">${rows}</div>`;
    };

    const html = renderGroup(pending, 'Pending') + renderGroup(events, 'Events / Done');
    setContent('batchIssues', html || '<div class="rc-empty">No batch issues this week</div>');
  }

  function _renderSupportList(secId, items) {
    const emptyMsg = secId === 'supportMA' ? 'No MA support tasks this week' : 'No Dev support tasks this week';
    const teamLbl  = secId === 'supportMA' ? 'MA team' : 'Dev team';
    const total    = items.length;
    const done     = items.filter(i => (i.status || '').toLowerCase() === 'done').length;
    const wip      = total - done;
    const rate     = total > 0 ? Math.round(done / total * 100) : 0;
    const rateCls  = rate >= 80 ? 'good' : rate >= 50 ? 'warn' : 'bad';

    const kpiHtml = `
      <div class="gm-kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="gm-kpi"><div class="v">${total}</div><div class="l">Total Tasks</div><div class="s">${teamLbl} · this week</div></div>
        <div class="gm-kpi"><div class="v good">${done}</div><div class="l">Completed</div><div class="s">status: Done</div></div>
        <div class="gm-kpi"><div class="v ${wip>0?'warn':''}">${wip}</div><div class="l">In Progress</div><div class="s">still open</div></div>
      </div>`;

    if (!items.length) { setContent(secId, `${kpiHtml}<div class="rc-empty">${emptyMsg}</div>`); return; }
    const rows = items.map(i => {
      const isDone = (i.status || '').toLowerCase() === 'done';
      return `<div class="rc-item-row">
        <span class="rc-dot ${isDone ? 'ok' : 'warn'}"></span>
        ${i.ticketUrl ? `<a class="rc-key" href="${esc(i.ticketUrl)}" target="_blank" rel="noopener">${esc((i.ticketId||'').replace(/^Ticket:\s*/i,'').trim())}</a>` : ''}
        <span class="rc-iname">${esc(i.summary || i.name || '—')}</span>
        ${i.owner ? `<span class="rc-owner">${esc(i.owner)}</span>` : ''}
      </div>`;
    }).join('');
    setContent(secId, `${kpiHtml}<div class="gm-section-head">Task List <span style="font-weight:500;font-size:9px;color:var(--text-muted)">— ${rate}% completion</span></div><div class="rc-item-list">${rows}</div>`);
  }

  function _renderImprovements(imp) {
    const improve = imp.improve || [];
    const project = imp.project || [];
    const all     = [...improve, ...project];
    const total   = all.length;
    const done    = all.filter(i => (i.status || '').toLowerCase() === 'done').length;
    const wip     = total - done;

    const kpiHtml = `
      <div class="gm-kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="gm-kpi"><div class="v">${total}</div><div class="l">Total Items</div><div class="s">this week</div></div>
        <div class="gm-kpi"><div class="v">${improve.length}</div><div class="l">Improvements</div><div class="s">enhancements</div></div>
        <div class="gm-kpi"><div class="v">${project.length}</div><div class="l">Projects</div><div class="s">project updates</div></div>
        <div class="gm-kpi"><div class="v good">${done}</div><div class="l">Completed</div><div class="s">${wip} in progress</div></div>
      </div>`;

    if (!total) { setContent('improvements', `${kpiHtml}<div class="rc-empty">No improvements or projects this week</div>`); return; }

    const renderGroup = (items, label) => {
      if (!items.length) return '';
      const rows = items.map(i => {
        const isDone = (i.status || '').toLowerCase() === 'done';
        return `<div class="rc-item-row">
          <span class="rc-dot ${isDone ? 'ok' : 'warn'}"></span>
          ${i.url ? `<a class="rc-key" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.ticketId || 'link')}</a>`
                  : (i.ticketId ? `<span class="rc-key">${esc(i.ticketId)}</span>` : '')}
          <span class="rc-iname">${esc(i.name || '—')}</span>
          ${i.desc && i.desc !== '-' ? `<span class="rc-idesc">${esc(i.desc)}</span>` : ''}
          <span class="rc-tag-sm">${esc(i.status || '—')}</span>
        </div>`;
      }).join('');
      return `<div class="gm-section-head">${label}</div><div class="rc-item-list">${rows}</div>`;
    };

    setContent('improvements', `${kpiHtml}${renderGroup(improve, 'Improvement')}${renderGroup(project, 'Project Update')}`);
  }

  function _renderUpdates(updates) {
    const groups = [
      { items: updates.alert    || [], label: 'Alerts' },
      { items: updates.handover || [], label: 'Handover' },
      { items: updates.other    || [], label: 'Other' },
    ];
    const total    = groups.reduce((a, g) => a + g.items.length, 0);
    const alertN   = groups[0].items.length;
    const handoN   = groups[1].items.length;
    const otherN   = groups[2].items.length;

    const kpiHtml = `
      <div class="gm-kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="gm-kpi"><div class="v">${total}</div><div class="l">Total Updates</div><div class="s">this week</div></div>
        <div class="gm-kpi"><div class="v ${alertN>0?'warn':''}">${alertN}</div><div class="l">Alerts</div><div class="s">notifications</div></div>
        <div class="gm-kpi"><div class="v">${handoN}</div><div class="l">Handover</div><div class="s">shift handovers</div></div>
        <div class="gm-kpi"><div class="v">${otherN}</div><div class="l">Other</div><div class="s">misc updates</div></div>
      </div>`;

    const html = groups.map(g => {
      if (!g.items.length) return '';
      const rows = g.items.map(i => `<div class="rc-item-row">
        <span class="rc-dot info"></span>
        <span class="rc-iname">${esc(i.name || i.summary || '—')}</span>
        ${i.desc && i.desc !== '-' ? `<span class="rc-idesc">${esc(i.desc)}</span>` : ''}
      </div>`).join('');
      return `<div class="gm-section-head">${g.label}</div><div class="rc-item-list">${rows}</div>`;
    }).join('');
    setContent('updates', `${kpiHtml}${html || '<div class="rc-empty">No updates or alerts this week</div>'}`);
  }

  /* ── Monthly render ─────────────────────────────────────────── */
  async function renderMonthly() {
    if (!currentMonth) initMonthNav();
    const year = currentMonth.slice(0, 4);
    const [y, m] = currentMonth.split('-').map(Number);
    const prev   = m === 1
      ? `${y - 1}-12`
      : `${y}-${String(m - 1).padStart(2, '0')}`;

    _setPresentLoading(true);
    ['alertSummary','alertMoM','maMonthly'].forEach(showLoading);

    const [statsRes, cmpRes, maRes] = await Promise.allSettled([
      _fetchAlertStats(`${year}-01`, currentMonth),
      _fetchAlertCmp(prev, currentMonth),
      _fetchMATest(currentMonth),
    ]);

    if (statsRes.status === 'fulfilled') _renderAlertSummary(statsRes.value, year);
    else showError('alertSummary');

    if (cmpRes.status === 'fulfilled') _renderAlertMoM(cmpRes.value);
    else showError('alertMoM');

    if (maRes.status === 'fulfilled') _renderMAMonthly(maRes.value, currentMonth);
    else showError('maMonthly');

    _setPresentLoading(false);
  }

  async function _fetchAlertStats(from, to) {
    const key = `as:${from}:${to}`;
    if (cache[key]) return cache[key];
    const r = await API.get(`/alert-monitor/stats.php?from=${from}&to=${to}`);
    const d = r.data?.data; // api.js wraps + respondOk wraps → actual payload at r.data.data
    cache[key] = d;
    return d;
  }

  async function _fetchAlertCmp(a, b) {
    const key = `ac:${a}:${b}`;
    if (cache[key]) return cache[key];
    const r = await API.get(`/alert-monitor/compare.php?a=${a}&b=${b}`);
    const d = r.data?.data; // api.js wraps + respondOk wraps → actual payload at r.data.data
    cache[key] = d;
    return d;
  }

  /* ── Monthly section renderers ──────────────────────────────── */
  function _renderAlertSummary(data, year) {
    const monthly = data.monthly || [];
    const total   = data.total   || 0;

    const catTotals = {};
    monthly.forEach(m => {
      Object.entries(m.by_category || {}).forEach(([k, v]) => {
        catTotals[k] = (catTotals[k] || 0) + v;
      });
    });

    const kpiExtra = Object.entries(catTotals).map(([k, v]) => {
      const pct = total > 0 ? Math.round(v / total * 100) : 0;
      return `<div class="gm-kpi"><div class="v">${v}</div><div class="l">${_cap(k)}</div><div class="s">${pct}% of total</div></div>`;
    }).join('');

    const cellsBuilt = _buildAlertCells(monthly, year);

    setContent('alertSummary', `
      <div class="gm-kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="gm-kpi"><div class="v ${total>200?'bad':total>100?'warn':''}">${total}</div><div class="l">Total YTD</div><div class="s">${year}</div></div>
        ${kpiExtra}
      </div>
      <div class="gm-section-head" style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span>Monthly Volume · ${year}</span>
        <span style="font-weight:600;font-size:11px;color:var(--text-muted);letter-spacing:.02em;text-transform:none">
          ค่าเฉลี่ย <b style="color:var(--text)">${cellsBuilt.avg}</b> alerts/เดือน — สีเขียว = ต่ำกว่าเฉลี่ย, สีแดง = สูงกว่าเฉลี่ย
        </span>
      </div>
      <div class="gm-months">${cellsBuilt.html}</div>
    `);
  }

  function _buildAlertCells(monthly, year) {
    const now       = new Date();
    const nowKey    = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const byMonth   = {};
    monthly.forEach(m => { byMonth[m.month] = m; });
    const counts    = monthly.map(m => m.total || 0).filter(n => n > 0);
    const avg       = counts.length ? Math.round(counts.reduce((a,b)=>a+b,0)/counts.length) : 0;

    const CAT_LABELS = { monitoring: 'Monitoring', batch: 'Batch', other: 'Other' };

    const html = MONTH_NAMES.map((label, i) => {
      const mKey = `${year}-${String(i+1).padStart(2,'0')}`;
      const md   = byMonth[mKey];
      const isFuture = mKey > nowKey;
      if (isFuture || !md) {
        return `<div class="gm-mcell future" title="ไม่มีข้อมูล / ยังไม่ถึงเดือนนี้">
          <div class="m">${label}</div>
          <div class="badge">—</div>
          <div class="sub">no data</div>
        </div>`;
      }
      const n     = md.total || 0;
      const cls   = n <= avg ? 'clean' : 'miss';
      const delta = n - avg;
      const deltaTxt = delta === 0
        ? '= ค่าเฉลี่ย'
        : (delta > 0 ? `↑ +${delta} จากเฉลี่ย` : `↓ ${Math.abs(delta)} ต่ำกว่าเฉลี่ย`);

      const cats = md.by_category || {};
      const catRows = Object.keys(CAT_LABELS)
        .filter(k => cats[k] > 0)
        .map(k => `<div class="gm-catr"><span>${CAT_LABELS[k]}</span><b>${cats[k]}</b></div>`)
        .join('');

      return `<div class="gm-mcell ${cls}" title="${label} ${year} — ${n} alerts (${deltaTxt} · avg ${avg})">
        <div class="m">${label}</div>
        <div class="badge">${n}</div>
        <div class="sub">${deltaTxt}</div>
        ${catRows ? `<div class="gm-cats">${catRows}</div>` : ''}
      </div>`;
    }).join('');

    return { html, avg };
  }

  function _renderAlertMoM(data) {
    const a = data.a || {};
    const b = data.b || {};
    const delta  = data.delta_total ?? (b.total - a.total);
    const pct    = data.pct_total   ?? 0;
    const better = delta <= 0;
    const fmtM   = ym => {
      if (!ym) return '—';
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, m-1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    };

    const catRows = Object.entries(data.category_delta || {}).map(([k, d]) => {
      const sign = d.delta >= 0 ? '+' : '';
      const cls  = d.delta <= 0 ? 'good' : 'bad';
      return `<div class="rc-cat-row">
        <span class="rc-cat-name">${_cap(k)}</span>
        <span class="rc-cat-a">${d.a}</span>
        <span class="rc-cat-arr">→</span>
        <span class="rc-cat-b">${d.b}</span>
        <span class="rc-cat-delta ${cls}">${sign}${d.delta} (${sign}${(d.pct||0).toFixed(1)}%)</span>
      </div>`;
    }).join('');

    const analysis = (data.analysis || []).map(l => `<div class="rc-analysis-line">${esc(l)}</div>`).join('');

    setContent('alertMoM', `
      <div class="rc-mom-hero">
        <div class="rc-mom-block">
          <div class="rc-mom-ml">${fmtM(a.month)}</div>
          <div class="rc-mom-mv">${a.total ?? '—'}</div>
          <div class="rc-mom-ms">alerts</div>
        </div>
        <div class="rc-mom-arrow ${better?'good':'bad'}">→</div>
        <div class="rc-mom-block current">
          <div class="rc-mom-ml">${fmtM(b.month)}</div>
          <div class="rc-mom-mv">${b.total ?? '—'}</div>
          <div class="rc-mom-ms">${better?'↓':'↑'} ${Math.abs(pct).toFixed(1)}% vs prev</div>
        </div>
      </div>
      ${catRows ? `<div class="gm-section-head">By Category</div><div class="rc-cat-list">${catRows}</div>` : ''}
      ${analysis ? `<div class="rc-analysis">${analysis}</div>` : ''}
    `);
  }

  function _renderMAMonthly(data, month) {
    _renderMASection('maMonthly', data, month);
  }

  /* ── Presentation mode ──────────────────────────────────────── */
  let presSlide = 0;
  let presTotal = 0;

  function bindPresentation() {
    document.getElementById('rcPresentBtn')?.addEventListener('click', openPresentation);
    document.getElementById('rcPresClose')?.addEventListener('click', closePresentation);
    document.getElementById('rcPresPrev')?.addEventListener('click', () => goToSlide(presSlide - 1));
    document.getElementById('rcPresNext')?.addEventListener('click', () => goToSlide(presSlide + 1));
    document.addEventListener('keydown', e => {
      const ov = document.getElementById('rcPresOverlay');
      if (!ov || ov.classList.contains('rc-hidden')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); goToSlide(presSlide + 1); }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')                     { e.preventDefault(); goToSlide(presSlide - 1); }
      if (e.key === 'Escape') closePresentation();
    });
  }

  async function openPresentation() {
    _setPresentLoading(true);
    const slides = await _buildSlides();
    _setPresentLoading(false);
    if (!slides.length) return;
    presTotal = slides.length;

    const container = document.getElementById('rcPresSlides');
    const dotsEl    = document.getElementById('rcPresDots');

    container.innerHTML = slides.map((s, i) => `
      <div class="rc-pres-slide ${i===0?'active':''}" id="rcPresSlide${i}">
        <div class="rc-slide-card">
          <div class="rc-slide-head" style="background:${s.headBg||'var(--bg)'}">
            <div class="rc-slide-icon" style="background:${s.iconBg};color:${s.iconColor}">${s.icon}</div>
            <div class="rc-slide-head-text"><h1>${s.title}</h1><p>${s.subtitle}</p></div>
            ${s.badge?`<span class="rc-slide-badge" style="background:${s.badgeBg};color:${s.badgeColor}">${s.badge}</span>`:''}
          </div>
          <div class="rc-slide-body">${s.body}</div>
        </div>
      </div>
    `).join('');

    dotsEl.innerHTML = slides.map((_, i) =>
      `<div class="rc-pres-dot ${i===0?'active':''}" data-n="${i}"></div>`
    ).join('');
    dotsEl.querySelectorAll('.rc-pres-dot').forEach(d =>
      d.addEventListener('click', () => goToSlide(+d.dataset.n))
    );

    goToSlide(0);
    document.getElementById('rcPresOverlay').classList.remove('rc-hidden');
    document.body.style.overflow = 'hidden';
  }

  function closePresentation() {
    document.getElementById('rcPresOverlay').classList.add('rc-hidden');
    document.body.style.overflow = '';
  }

  function goToSlide(n) {
    if (n < 0 || n >= presTotal) return;
    document.querySelectorAll('.rc-pres-slide').forEach((s, i) => s.classList.toggle('active', i === n));
    document.querySelectorAll('.rc-pres-dot').forEach((d, i)   => d.classList.toggle('active', i === n));
    presSlide = n;
    const prog = document.getElementById('rcPresProgress');
    if (prog) prog.style.width = (presTotal > 1 ? ((n + 1) / presTotal) * 100 : 100) + '%';
    const ctr = document.getElementById('rcPresCounter');
    if (ctr) ctr.textContent = `${n + 1} / ${presTotal}`;
    const prev = document.getElementById('rcPresPrev');
    const next = document.getElementById('rcPresNext');
    if (prev) prev.disabled = n === 0;
    if (next) next.disabled = n === presTotal - 1;
  }

  async function _buildSlides() {
    const slides = [];
    const dateLabel = mode === 'weekly'
      ? (document.getElementById('rcWeekLabel')?.textContent || '')
      : (document.getElementById('rcMonthLabel')?.textContent || '');

    const _rCls = c => c >= 80 ? 'ok' : c >= 60 ? 'warn' : 'bad';
    let _titleBody = '';

    if (mode === 'weekly') {
      const _month    = currentWeek?.replace('week-','').slice(0,7) || '';
      const _wd       = cache['w:' + currentWeek] || {};
      const _mad      = cache['ma:' + _month] || { plans: [], results: [] };
      const _inc      = (_wd.incidents || []).length;
      const _maPassed = (_mad.results || []).filter(r => r.result === 'Successed').length;
      const _maTotal  = (_mad.results || []).length;
      const _maRate   = _maTotal > 0 ? Math.round(_maPassed / _maTotal * 100) : 0;
      const _supp     = ((_wd.support?.ma || []).length) + ((_wd.support?.dev || []).length);
      const _batch    = ((_wd.batch?.pending || []).length) + ((_wd.batch?.event || []).length);

      _titleBody = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:32px;padding:24px 12px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px;max-width:920px;width:100%">
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">Incidents</div><div class="rc-slide-kpi-val ${_inc>0?'bad':'ok'}">${_inc}</div><div class="rc-slide-kpi-sub">this week</div></div>
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">MA Test</div><div class="rc-slide-kpi-val ${_rCls(_maRate)}">${_maRate}%</div><div class="rc-slide-kpi-sub">${_maPassed}/${_maTotal} passed</div></div>
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">Support</div><div class="rc-slide-kpi-val">${_supp}</div><div class="rc-slide-kpi-sub">MA + Dev</div></div>
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">Batch</div><div class="rc-slide-kpi-val ${_batch>0?'warn':''}">${_batch}</div><div class="rc-slide-kpi-sub">issues</div></div>
          </div>
          <p style="font-size:13px;color:var(--text-muted);margin:0;letter-spacing:.06em;text-transform:uppercase;font-weight:700">SM Team · Weekly Operations Report</p>
        </div>`;
    } else {
      // ── Monthly cover: aggregate ALL weeks of this month + MA + Alerts ──
      const monthWeeks = (weekList || []).filter(w => w.replace('week-','').slice(0,7) === currentMonth);
      const weekDatas  = await Promise.all(monthWeeks.map(w => _fetchWeekData(w).catch(() => null)));

      let incTotal = 0, incDetected = 0, suppMA = 0, suppDev = 0;
      let batchPending = 0, batchEvent = 0, updAlert = 0, updHandover = 0;
      let impImprove = 0, impProject = 0;
      weekDatas.forEach(d => {
        if (!d) return;
        const inc = d.incidents || [];
        incTotal    += inc.length;
        incDetected += inc.filter(i => i.detected === 'Y').length;
        suppMA      += (d.support?.ma  || []).length;
        suppDev     += (d.support?.dev || []).length;
        batchPending += (d.batch?.pending || []).length;
        batchEvent   += (d.batch?.event   || []).length;
        updAlert     += (d.updates?.alert    || []).length;
        updHandover  += (d.updates?.handover || []).length;
        impImprove   += (d.improvements?.improve || []).length;
        impProject   += (d.improvements?.project || []).length;
      });
      const incRate = incTotal > 0 ? Math.round(incDetected / incTotal * 100) : 100;

      const _mad     = cache['ma:' + currentMonth] || { plans: [], results: [] };
      const maPass   = (_mad.results || []).filter(r => r.result === 'Successed').length;
      const maTotal  = (_mad.results || []).length;
      const maPct    = maTotal > 0 ? Math.round(maPass / maTotal * 100) : 0;

      const year     = currentMonth.slice(0, 4);
      const alertStats = cache[`as:${year}-01:${currentMonth}`] || null;
      const alertThis  = alertStats?.monthly?.find(m => m.month === currentMonth)?.total ?? null;

      const weekCount = monthWeeks.length;
      const monthName = document.getElementById('rcMonthLabel')?.textContent || currentMonth;

      _titleBody = `
        <div style="display:flex;flex-direction:column;justify-content:center;height:100%;gap:28px;padding:12px 8px">
          <div style="text-align:center">
            <div style="font-size:11px;font-weight:800;letter-spacing:.18em;color:var(--text-muted);text-transform:uppercase">Monthly Summary</div>
            <div style="font-size:24px;font-weight:800;letter-spacing:-.02em;margin-top:8px;color:var(--text)">${esc(monthName)}</div>
            <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px">รวม ${weekCount} สัปดาห์ ในเดือนนี้</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px;width:100%">
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">Incidents</div><div class="rc-slide-kpi-val ${incTotal>0?'bad':'ok'}">${incTotal}</div><div class="rc-slide-kpi-sub">${incDetected} SM-detected · ${incRate}%</div></div>
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">MA Test</div><div class="rc-slide-kpi-val ${_rCls(maPct)}">${maTotal>0?maPct+'%':'—'}</div><div class="rc-slide-kpi-sub">${maPass}/${maTotal} passed</div></div>
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">Support</div><div class="rc-slide-kpi-val">${suppMA+suppDev}</div><div class="rc-slide-kpi-sub">${suppMA} MA · ${suppDev} Dev</div></div>
            <div class="rc-slide-kpi"><div class="rc-slide-kpi-label">Alerts</div><div class="rc-slide-kpi-val ${alertThis!=null&&alertThis>50?'warn':''}">${alertThis??'—'}</div><div class="rc-slide-kpi-sub">this month</div></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;width:100%">
            <div class="rc-slide-mini"><span class="rc-slide-mini-l">Batch Issues</span><span class="rc-slide-mini-v ${batchPending>0?'warn':''}">${batchPending+batchEvent}</span><span class="rc-slide-mini-s">${batchPending} pending · ${batchEvent} events</span></div>
            <div class="rc-slide-mini"><span class="rc-slide-mini-l">Improvements</span><span class="rc-slide-mini-v">${impImprove+impProject}</span><span class="rc-slide-mini-s">${impImprove} imp · ${impProject} proj</span></div>
            <div class="rc-slide-mini"><span class="rc-slide-mini-l">Updates</span><span class="rc-slide-mini-v">${updAlert+updHandover}</span><span class="rc-slide-mini-s">${updAlert} alerts · ${updHandover} handover</span></div>
            <div class="rc-slide-mini"><span class="rc-slide-mini-l">Weeks Reported</span><span class="rc-slide-mini-v">${weekCount}</span><span class="rc-slide-mini-s">weekly reports</span></div>
          </div>
          <p style="text-align:center;font-size:13px;color:var(--text-muted);margin:0;letter-spacing:.06em;text-transform:uppercase;font-weight:700">SM Team · Monthly Operations Summary</p>
        </div>`;
    }

    slides.push({
      title: mode === 'weekly' ? 'Weekly Report' : 'Monthly Report',
      subtitle: dateLabel + ' · SM Team',
      icon: svgMonitor(),
      iconBg: 'rgba(242,100,25,.12)', iconColor: 'var(--orange)',
      headBg: 'linear-gradient(135deg, color-mix(in srgb, var(--orange) 5%, var(--bg)) 0%, var(--bg-card) 65%)',
      body: _titleBody,
    });

    // ── Per-section slide subtitles (present-only, overrides card sub) ──
    const SUBTITLES = {
      alertSummary: 'ภาพรวม Alert รายเดือนตลอดทั้งปี — จาก Alert Monitor',
      alertMoM:     'เดือนนี้ vs เดือนก่อน · ↑ เพิ่มขึ้น (แย่ลง), ↓ ลดลง (ดีขึ้น)',
      maMonthly:    'ผลการทดสอบ MA ทั้งเดือน · Pass Rate = executed ÷ planned',
    };

    const secOrder = mode === 'weekly'
      ? ['maTest','incidents','batchIssues','ticketMon','supportMA','supportDev','improvements','updates']
      : ['alertSummary','alertMoM','maMonthly'];

    secOrder.forEach(id => {
      const card = document.getElementById('rc-sec-' + id);
      if (!card || card.classList.contains('rc-hidden')) return;
      const content = document.getElementById('rc-sec-' + id + '-content');
      if (!content || content.classList.contains('rc-hidden')) return;

      const titleEl = card.querySelector('.rc-card-title');
      const subEl   = card.querySelector('.rc-card-sub');
      const iconEl  = card.querySelector('.rc-card-icon');

      slides.push({
        title:     titleEl?.textContent || id,
        subtitle:  SUBTITLES[id] || subEl?.textContent || dateLabel,
        icon:      iconEl?.innerHTML   || svgMonitor(),
        iconBg:    iconEl?.style.background || 'var(--bg)',
        iconColor: iconEl?.style.color      || 'var(--text)',
        body: `<div class="rc-slide-clone rc-slide-clone-${id}">${content.innerHTML}</div>`,
      });
    });

    return slides;
  }

  /* ── Section state helpers ──────────────────────────────────── */
  function showLoading(id) {
    _setState(id, 'loading');
  }
  function showError(id) {
    _setState(id, 'error');
  }
  function setContent(id, html) {
    const el = document.getElementById('rc-sec-' + id + '-content');
    if (el) el.innerHTML = html;
    _setState(id, 'content');
  }
  function _setState(id, state) {
    ['loading','error','content'].forEach(s => {
      const el = document.getElementById(`rc-sec-${id}-${s}`);
      if (el) el.classList.toggle('rc-hidden', s !== state);
    });
  }

  /* ── Utilities ───────────────────────────────────────────────── */
  function esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function svgMonitor() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>`;
  }

  return { init, navWeek, navMonth, goToSlide };
})();
