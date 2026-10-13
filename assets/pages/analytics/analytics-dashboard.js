/* ══════════════════════════════════════════════════════════════════════════
   analytics-dashboard.js  |  Green Month Dashboard
   Server Monitoring · Batchfile · Monitoring — 12-month per-tab tracker.
   ══════════════════════════════════════════════════════════════════════════ */

const AnalyticsDash = {
  chart: null,
  chartBatch: null,
  chartMon: null,
  currentTab: 'server',
  detail: null,      // incident drill-down { sev, origin, detected, title, dateOverride? }
  smcDetail: null,   // SMC drill-down     { params, title, dateOverride? }
  _firstLoad: true,

  MONTH_NAMES: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],

  // Colors — mirror CSS custom props so JS-rendered chart bars match the theme.
  COLORS: {
    good:  '#16A34A',
    bad:   '#DC2626',
    warn:  '#F59E0B',
    grey:  '#CBD5E1',
    orange:'#F26419',
    blue:  '#3B82F6',
    purple:'#8B5CF6',
  },

  init() {
    const today = new Date();
    const y = today.getFullYear();
    document.getElementById('an-from-date').value = `${y}-01-01`;
    document.getElementById('an-to-date').value   = today.toISOString().slice(0, 10);

    document.querySelectorAll('.main-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    document.getElementById('an-refresh').addEventListener('click', () => this.loadCurrentTab());
    const hard = document.getElementById('an-hard-refresh');
    if (hard) hard.addEventListener('click', () => this.loadCurrentTab(true));
    document.getElementById('an-from-date').addEventListener('change', () => this.loadCurrentTab());
    document.getElementById('an-to-date').addEventListener('change',   () => this.loadCurrentTab());

    // Detail modal: SM / Other toggle (incident detail only)
    document.querySelectorAll('#an-detail-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#an-detail-toggle button')
          .forEach(b => b.classList.toggle('active', b === btn));
        if (this.detail) { this.detail.detected = btn.dataset.detected; this.loadDetail(); }
      });
    });

    this.initDayBrowser();
    this.loadCurrentTab();
  },

  // ── Day browser (Server tab) ─────────────────────────────────────────
  initDayBrowser() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const from = document.getElementById('srv-day-from');
    const to   = document.getElementById('srv-day-to');
    if (from) from.value = todayStr;
    if (to)   to.value   = todayStr;

    const searchBtn = document.getElementById('srv-day-search');
    if (searchBtn) searchBtn.addEventListener('click', () => this.loadDayIncidents());

    const clearBtn = document.getElementById('srv-day-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearDayPanel());

    // Enter key on either date input triggers search
    [from, to].forEach(el => {
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') this.loadDayIncidents(); });
    });
  },

  async loadDayIncidents() {
    const from = document.getElementById('srv-day-from')?.value;
    const to   = document.getElementById('srv-day-to')?.value;
    if (!from || !to) return;

    const panel = document.getElementById('srv-day-panel');
    if (!panel) return;

    panel.style.display = 'block';
    panel.innerHTML = `<div class="srv-day-result">
      <div class="srv-day-loading"><div class="an-spinner"></div> กำลังโหลด…</div>
    </div>`;
    document.querySelector('.srv-day-bar')?.classList.add('has-result');

    const clearBtn = document.getElementById('srv-day-clear');
    if (clearBtn) clearBtn.style.display = '';

    try {
      const qs = `detail=1&fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}&sev=all&origin=all&detected=all`;
      const r = await API.get(`/jira/incidents-analytics.php?${qs}`);
      if (!r?.ok) {
        panel.innerHTML = `<div class="srv-day-result">
          <div class="srv-day-summary">โหลดไม่สำเร็จ: ${escHtml(r?.data?.message || 'error')}</div>
        </div>`;
        return;
      }
      this.renderDayIncidents(r.data.data, from, to);
    } catch (e) {
      console.error('[analytics-dash] loadDayIncidents error', e);
      panel.innerHTML = '<div class="srv-day-result"><div class="srv-day-summary">เกิดข้อผิดพลาดระหว่างโหลดรายการ</div></div>';
    }
  },

  renderDayIncidents(d, from, to) {
    const panel = document.getElementById('srv-day-panel');
    if (!panel) return;
    const rows = d.rows || [];

    const fromLabel = from === to ? from : `${from} → ${to}`;
    const summary = `พบ <b>${d.count || 0}</b> incidents · ${escHtml(fromLabel)}` +
                    (d.truncated ? ' · <b>แสดง 1,000 แรก</b>' : '');

    if (!rows.length) {
      panel.innerHTML = `<div class="srv-day-result">
        <div class="srv-day-summary">${summary}</div>
        <div class="an-detail-empty" style="padding:28px">
          <i data-icon="folder-open"></i> ไม่มี incident ในช่วงเวลานี้
        </div>
      </div>`;
      window.Icons?.render?.(panel);
      return;
    }

    const body = rows.map(x => {
      const dt  = (x.created || '').slice(0, 10);
      const smB = x.isSM
        ? '<span class="an-detail-badge sm">SM</span>'
        : `<span class="an-detail-badge oth">${escHtml(x.detectedBy || 'Other')}</span>`;
      const sevCls = `s${x.severity}`;
      return `<tr>
        <td class="key"><a href="${escHtml(x.url)}" target="_blank" rel="noopener">${escHtml(x.key)}</a></td>
        <td><span class="an-detail-badge ${sevCls}">S${escHtml(String(x.severity))}</span></td>
        <td>${smB}</td>
        <td>${escHtml(x.origin || '—')}</td>
        <td>${escHtml(x.status || '—')}</td>
        <td style="white-space:nowrap">${escHtml(dt)}</td>
        <td class="summary">${escHtml(x.summary || '—')}</td>
      </tr>`;
    }).join('');

    panel.innerHTML = `<div class="srv-day-result">
      <div class="srv-day-summary">${summary}</div>
      <div class="an-detail-table-wrap" style="max-height:380px">
        <table class="an-detail-table">
          <thead><tr>
            <th>Key</th><th>Sev</th><th>Detected</th><th>Origin</th>
            <th>Status</th><th>Created</th><th>Summary</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
    window.Icons?.render?.(panel);
  },

  clearDayPanel() {
    const panel = document.getElementById('srv-day-panel');
    if (panel) { panel.innerHTML = ''; panel.style.display = 'none'; }
    document.querySelector('.srv-day-bar')?.classList.remove('has-result');
    const clearBtn = document.getElementById('srv-day-clear');
    if (clearBtn) clearBtn.style.display = 'none';
  },

  // ── Drill-down open helpers ─────────────────────────────────────────────
  openDetail(p) {
    this.detail = {
      sev: p.sev || 'all', origin: p.origin || 'all',
      detected: p.detected || 'all', title: p.label,
      dateOverride: p.dateOverride || null,
    };
    document.getElementById('an-detail-title').textContent = p.label;
    const tog = document.getElementById('an-detail-toggle');
    if (tog) tog.style.display = 'inline-flex';
    document.querySelectorAll('#an-detail-toggle button')
      .forEach(b => b.classList.toggle('active', b.dataset.detected === this.detail.detected));
    Modal.open('an-detail-modal');
    this.loadDetail();
  },

  openSmcDetail(params, title, dateOverride = null) {
    this.smcDetail = { params, title, dateOverride };
    document.getElementById('an-detail-title').textContent = title;
    const tog = document.getElementById('an-detail-toggle');
    if (tog) tog.style.display = 'none';
    Modal.open('an-detail-modal');
    this.loadSmcDetail();
  },

  async loadSmcDetail() {
    if (!this.smcDetail) return;
    const [from, to] = this._detailRange(this.smcDetail.dateOverride);
    const p = this.smcDetail.params;
    const box = document.getElementById('an-detail-content');
    box.innerHTML = '<div class="an-detail-empty"><div class="an-spinner" style="margin:0 auto 12px"></div>กำลังโหลดรายการ…</div>';
    try {
      const qs = new URLSearchParams({
        detail: '1', fromDate: from, toDate: to,
        type: p.type || 'batch', origin: p.origin || 'all',
        action: p.action || 'all', detected: p.detected || 'all', closed: p.closed || 'all',
      }).toString();
      const r = await API.get(`/jira/smc-analytics.php?${qs}`);
      if (!r?.ok) { box.innerHTML = `<div class="an-detail-empty">โหลดไม่สำเร็จ: ${escHtml(r?.data?.message || 'error')}</div>`; return; }
      this.renderSmcDetail(r.data.data);
    } catch (e) {
      console.error('[analytics-dash] loadSmcDetail error', e);
      box.innerHTML = '<div class="an-detail-empty">เกิดข้อผิดพลาดระหว่างโหลดรายการ</div>';
    }
  },

  renderSmcDetail(d) {
    const rows = d.rows || [];
    const from = d.filter?.fromDate || '', to = d.filter?.toDate || '';
    document.getElementById('an-detail-summary').innerHTML =
      `พบ <b>${d.count}</b> tickets · ${escHtml(from)} → ${escHtml(to)}` +
      (d.truncated ? ' · <b>แสดง 1,000 แรก</b>' : '');

    const box = document.getElementById('an-detail-content');
    if (!rows.length) {
      box.innerHTML = '<div class="an-detail-empty"><i data-icon="folder-open"></i> ไม่มี ticket ตรงเงื่อนไขนี้ในช่วงเวลาที่เลือก</div>';
      return;
    }
    const actBadge = { sm: 'sm', ts: 's2', other: 'oth' };
    const body = rows.map(x => {
      const dt = (x.created || '').slice(0, 10);
      const act = `<span class="an-detail-badge ${actBadge[x.actionBy] || 'oth'}">${escHtml((x.actionBy || '').toUpperCase())}</span>`;
      return `<tr>
        <td class="key"><a href="${escHtml(x.url)}" target="_blank" rel="noopener">${escHtml(x.key)}</a></td>
        <td>${escHtml(x.type)}</td>
        <td>${escHtml(x.status)}</td>
        <td>${escHtml(x.origin)}</td>
        <td>${escHtml(x.detectedBy)}</td>
        <td>${act}</td>
        <td>${escHtml(x.assignee)}</td>
        <td>${escHtml(dt)}</td>
        <td class="summary">${escHtml(x.summary)}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<div class="an-detail-table-wrap"><table class="an-detail-table">
      <thead><tr>
        <th>Key</th><th>Type</th><th>Status</th><th>Origin</th>
        <th>Detected</th><th>Action</th><th>Assignee</th><th>Created</th><th>Summary</th>
      </tr></thead><tbody>${body}</tbody></table></div>`;
  },

  async loadDetail() {
    if (!this.detail) return;
    const [from, to] = this._detailRange(this.detail.dateOverride);
    const { sev, origin, detected } = this.detail;
    const box = document.getElementById('an-detail-content');
    box.innerHTML = '<div class="an-detail-empty"><div class="an-spinner" style="margin:0 auto 12px"></div>กำลังโหลดรายการ…</div>';
    try {
      const qs = `detail=1&fromDate=${from}&toDate=${to}&sev=${sev}&origin=${origin}&detected=${detected}`;
      const r = await API.get(`/jira/incidents-analytics.php?${qs}`);
      if (!r?.ok) { box.innerHTML = `<div class="an-detail-empty">โหลดไม่สำเร็จ: ${escHtml(r?.data?.message || 'error')}</div>`; return; }
      this.renderDetail(r.data.data);
    } catch (e) {
      console.error('[analytics-dash] loadDetail error', e);
      box.innerHTML = '<div class="an-detail-empty">เกิดข้อผิดพลาดระหว่างโหลดรายการ</div>';
    }
  },

  renderDetail(d) {
    const rows = d.rows || [];
    const from = d.filter?.fromDate || '', to = d.filter?.toDate || '';
    document.getElementById('an-detail-summary').innerHTML =
      `พบ <b>${d.count}</b> incidents · ${escHtml(from)} → ${escHtml(to)}` +
      (d.truncated ? ' · <b>แสดง 1,000 แรก</b>' : '');

    const box = document.getElementById('an-detail-content');
    if (!rows.length) {
      box.innerHTML = '<div class="an-detail-empty"><i data-icon="folder-open"></i> ไม่มี incident ตรงเงื่อนไขนี้ในช่วงเวลาที่เลือก</div>';
      return;
    }
    const body = rows.map(x => {
      const dt  = (x.created || '').slice(0, 10);
      const smB = x.isSM ? '<span class="an-detail-badge sm">SM</span>'
                         : `<span class="an-detail-badge oth">${escHtml(x.detectedBy)}</span>`;
      return `<tr>
        <td class="key"><a href="${escHtml(x.url)}" target="_blank" rel="noopener">${escHtml(x.key)}</a></td>
        <td><span class="an-detail-badge s${x.severity}">S${escHtml(x.severity)}</span></td>
        <td>${smB}</td>
        <td>${escHtml(x.origin)}</td>
        <td>${escHtml(x.thirdParty)}</td>
        <td>${escHtml(x.status)}</td>
        <td>${escHtml(dt)}</td>
        <td class="summary">${escHtml(x.summary)}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<div class="an-detail-table-wrap"><table class="an-detail-table">
      <thead><tr>
        <th>Key</th><th>Sev</th><th>Detected</th><th>Origin</th>
        <th>Caused by 3rd</th><th>Status</th><th>Created</th><th>Summary</th>
      </tr></thead><tbody>${body}</tbody></table></div>`;
  },

  // Return [from, to] for detail queries — apply per-month override when set.
  _detailRange(override) {
    if (override) return [override.from, override.to];
    return [
      document.getElementById('an-from-date').value,
      document.getElementById('an-to-date').value,
    ];
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.main-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
    this.loadCurrentTab();
  },

  loadCurrentTab(force = false) {
    if (this.currentTab === 'server')          this.loadServer(force);
    else if (this.currentTab === 'batch')      this.loadSmc('batch', force);
    else if (this.currentTab === 'monitoring') this.loadSmc('monitoring', force);
  },

  setLoading(on) {
    const pill = document.getElementById('an-status-pill');
    if (pill) pill.style.display = on ? 'inline-flex' : 'none';
    // Per-tab chart overlay
    const overlayId = ({ server: 'server-chart-loading', batch: 'batch-chart-loading', monitoring: 'mon-chart-loading' })[this.currentTab];
    const overlay   = overlayId ? document.getElementById(overlayId) : null;
    if (overlay) overlay.style.display = on ? 'flex' : 'none';

    if (on) {
      // Skeleton KPIs of the active tab
      const kpis = this._activeTabKpiIds();
      kpis.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span class="skeleton skeleton-block">00.0%</span>';
      });
      // Also skeleton the months while loading
      const monthsId = this._activeTabMonthsId();
      const monthsEl = monthsId ? document.getElementById(monthsId) : null;
      if (monthsEl) monthsEl.innerHTML = this._renderSkeletonMonths();
    }
  },

  _activeTabKpiIds() {
    return ({
      server: ['srv-kpi-detect','srv-kpi-miss','srv-kpi-int','srv-kpi-ext'],
      batch:  ['bat-kpi-close','bat-kpi-open','bat-kpi-int','bat-kpi-ext'],
      monitoring: ['mon-kpi-close','mon-kpi-open','mon-kpi-sm','mon-kpi-oth'],
    })[this.currentTab] || [];
  },
  _activeTabMonthsId() {
    return ({ server: 'srv-months', batch: 'bat-months', monitoring: 'mon-months' })[this.currentTab];
  },
  _renderSkeletonMonths() {
    return this.MONTH_NAMES.map(m => (
      `<div class="gm-mcell future" style="cursor:default">
         <div class="m">${m}</div>
         <div class="badge"><span class="skeleton" style="display:inline-block;width:14px;height:14px;border-radius:50%">&nbsp;</span></div>
         <div class="cnt"><span class="skeleton skeleton-block" style="min-width:36px">&nbsp;</span></div>
       </div>`
    )).join('');
  },

  _isTransientCredError(r) {
    const msg = r?.data?.message || '';
    return /Jira credentials not configured/i.test(msg);
  },
  _isTransientNull(r) {
    if (r !== null) return false;
    const tk = Auth.getToken?.();
    return !!(tk && !Auth.isTokenExpired?.(tk));
  },
  async _fetchJiraWithRetry(url, tries = 3, delayMs = 700) {
    for (let i = 0; i < tries; i++) {
      const r = await API.get(url);
      if (r?.ok) return r;
      const transient = this._isTransientCredError(r) || this._isTransientNull(r);
      if (!transient) return r;
      if (i < tries - 1) await new Promise(res => setTimeout(res, delayMs));
    }
    return { ok: false, data: { message: 'Jira ยังไม่พร้อม — กรุณากด Refresh อีกครั้ง' } };
  },

  _markReady() {
    this._hideError();
    if (!this._firstLoad) return;
    this._firstLoad = false;
    const load = document.getElementById('an-firstload');
    const body = document.getElementById('an-body');
    if (load) load.style.display = 'none';
    if (body) body.removeAttribute('data-not-ready');
  },
  _showError(msg) {
    const load = document.getElementById('an-firstload');
    const err  = document.getElementById('an-error');
    const emsg = document.getElementById('an-error-msg');
    const body = document.getElementById('an-body');
    if (load) load.style.display = 'none';
    if (err)  err.style.display  = 'flex';
    if (emsg) emsg.textContent   = msg || 'Unknown error';
    if (body && this._firstLoad) body.setAttribute('data-not-ready', '');
  },
  _hideError() {
    const err = document.getElementById('an-error');
    if (err) err.style.display = 'none';
  },

  // ── SERVER MONITORING ────────────────────────────────────────────────
  async loadServer(force = false) {
    const from = document.getElementById('an-from-date').value;
    const to   = document.getElementById('an-to-date').value;
    if (!from || !to) return;

    const label = document.getElementById('server-range-label');
    if (label) label.textContent = `(${from} → ${to})`;
    this.setLoading(true);

    try {
      const qs = `fromDate=${from}&toDate=${to}` + (force ? '&refresh=1' : '');
      const r = await this._fetchJiraWithRetry(`/jira/incidents-analytics.php?${qs}`);
      if (!r?.ok) {
        const msg = r?.data?.message || 'Failed to load analytics';
        if (this._firstLoad) this._showError(msg);
        else {
          if (!this._isTransientCredError(r)) Toast?.error?.(msg);
          this.showEmptyServer(this._isTransientCredError(r) ? 'Jira ยังไม่พร้อม — กด Refresh อีกครั้งเพื่อลองใหม่' : null);
        }
        return;
      }
      this._markReady();
      this.renderServer(r.data.data, from, to);
    } catch (e) {
      console.error('[analytics-dash] loadServer error', e);
      const msg = 'Server error while loading analytics';
      if (this._firstLoad) this._showError(msg);
      else { Toast?.error?.(msg); this.showEmptyServer(); }
    } finally {
      this.setLoading(false);
    }
  },

  showEmptyServer(customMessage = null) {
    const wrap  = document.querySelector('#server-chart-card .gm-canvas-wrap');
    const empty = document.getElementById('server-chart-empty');
    if (wrap)  wrap.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      if (customMessage) {
        empty.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--text-muted);font-size:12px">
          <div style="font-size:28px;margin-bottom:8px;opacity:.6">⟳</div>
          <div style="font-weight:700;color:var(--text);margin-bottom:4px">${customMessage}</div>
        </div>`;
      }
    }
    setText('srv-kpi-detect', '—');
    setText('srv-kpi-miss',   '—');
    setText('srv-kpi-int',    '—');
    setText('srv-kpi-ext',    '—');
    this._closeSrvTicketList?.();
    const months = document.getElementById('srv-months');
    if (months) months.innerHTML = '';
    const sev = document.getElementById('srv-severity');
    if (sev) sev.innerHTML = '<div class="gm-brk-empty">ไม่มีข้อมูลในช่วงนี้</div>';
  },

  renderServer(d, fromDate, toDate) {
    const monthly    = d.monthly    || [];
    const overall    = d.overall    || {};
    const bySeverity = d.bySeverity || {};

    // ── KPIs ────────────────────────────────────────────────────────
    const total    = overall.total || 0;
    const smDetect = overall.detectedSM || 0;
    const missed   = Math.max(0, total - smDetect);
    setPctColored('srv-kpi-detect', overall.smPct, 90);
    setText('srv-kpi-detect-sub', total > 0 ? `${smDetect} / ${total} incidents (target 90%)` : 'no incidents in range');
    setText('srv-kpi-miss', String(missed));
    setText('srv-kpi-miss-sub', total > 0 ? `of ${total} incidents` : 'no incidents in range');
    setPctColored('srv-kpi-int', overall.internal?.smPct, 75);
    setText('srv-kpi-int-sub', `${overall.internal?.detectedSM ?? 0} / ${overall.internal?.total ?? 0} internal (target 75%)`);
    setPctColored('srv-kpi-ext', overall.external?.smPct, null);
    setText('srv-kpi-ext-sub', `${overall.external?.detectedSM ?? 0} / ${overall.external?.total ?? 0} 3rd-party`);

    // ── Monthly tracker ─────────────────────────────────────────────
    const year = parseInt((toDate || '').slice(0, 4), 10) || new Date().getFullYear();
    this._srvActiveMonthKey = null;
    this.renderMonthTracker('srv-months', monthly, {
      year, fromDate, toDate,
      missFn: m => Math.max(0, (m.total || 0) - (m.detectedSM || 0)),
      subFn: m => {
        const miss = Math.max(0, (m.total || 0) - (m.detectedSM || 0));
        const t = m.total || 0;
        return miss > 0 ? `${miss} of ${t} miss` : (t > 0 ? `${t} ok` : 'no data');
      },
      cleanSubFn: m => (m.total || 0) > 0 ? `${m.total} ok` : 'clean',
      onClick: (monthKey, m) => {
        const miss = Math.max(0, (m ? (m.total || 0) - (m.detectedSM || 0) : 0));
        if (miss === 0) { this._closeSrvTicketList(); return; }
        if (this._srvActiveMonthKey === monthKey) { this._closeSrvTicketList(); return; }
        this._srvActiveMonthKey = monthKey;
        document.querySelectorAll('#srv-months .gm-mcell').forEach(c => c.classList.remove('selected'));
        const sel = document.querySelector(`#srv-months .gm-mcell[data-key="${monthKey}"]`);
        if (sel) sel.classList.add('selected');
        this._showSrvTicketList(monthKey, m);
      },
    });

    // ── Bar chart: SM misses per month ──────────────────────────────
    this.chart = renderMissBarChart('server-chart', 'server-chart-card', this.chart, monthly, {
      missFn: m => Math.max(0, (m.total || 0) - (m.detectedSM || 0)),
      totalFn: m => m.total || 0,
      color: this.COLORS.bad,
      yTitle: 'SM Missed',
    });

    // ── Severity breakdown panel ────────────────────────────────────
    this.renderSeverityBreakdown('srv-severity', bySeverity, fromDate, toDate);

    // Tab counter
    this._setTabCounter('server', missed, missed > 0 ? 'bad' : 'good', missed > 0 ? `${missed} MISS` : 'GREEN');

    if (d.diagnostics) {
      console.log('[analytics-dash] Detected By values:', d.diagnostics.detectedByValues);
      console.log('[analytics-dash] Caused By 3rd Party values:', d.diagnostics.causedByValues);
      console.log('[analytics-dash] Fetched', d.fetchedCount, 'incidents');
    }
  },

  renderSeverityBreakdown(containerId, bySev, fromDate, toDate) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const items = [
      { key: '1', label: 'Severity 1', color: this.COLORS.bad,    origin: 'all' },
      { key: '2', label: 'Severity 2', color: this.COLORS.warn,   origin: 'all' },
      { key: '3', label: 'Severity 3', color: '#22C55E',          origin: 'all' },
    ];
    const totalAll = items.reduce((s, it) => s + ((bySev[it.key]?.total) || 0), 0);
    if (totalAll === 0) {
      box.innerHTML = '<div class="gm-brk-empty">ไม่มีข้อมูลในช่วงนี้</div>';
      return;
    }
    box.innerHTML = items.map(it => {
      const s = bySev[it.key] || {};
      const t = s.total || 0;
      const sm = s.detectedSM || 0;
      const miss = Math.max(0, t - sm);
      return `<div class="gm-brk-row" data-sev="${it.key}" style="cursor:${t > 0 ? 'pointer' : 'default'}">
        <div class="gm-brk-key">
          <span class="dot" style="background:${it.color}"></span>
          ${escHtml(it.label)}
        </div>
        <div class="gm-brk-val">
          <b>${miss}</b> miss · ${sm}/${t} detected · <b>${fmtPct(s.smPct)}</b>
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-sev]').forEach(row => {
      row.addEventListener('click', () => {
        const sev = row.dataset.sev;
        this.openDetail({
          sev, origin: 'all', detected: 'all',
          label: `Server Monitoring · Severity ${sev}`,
        });
      });
    });
  },

  // ── Batchfile / Monitoring (SMC) ──────────────────────────────────────
  async loadSmc(which, force = false) {
    const from = document.getElementById('an-from-date').value;
    const to   = document.getElementById('an-to-date').value;
    if (!from || !to) return;

    const labelId = which === 'batch' ? 'batch-range-label' : 'mon-range-label';
    const lbl = document.getElementById(labelId);
    if (lbl) lbl.textContent = `(${from} → ${to})`;

    this.setLoading(true);

    try {
      const qs = `fromDate=${from}&toDate=${to}` + (force ? '&refresh=1' : '');
      const r = await this._fetchJiraWithRetry(`/jira/smc-analytics.php?${qs}`);
      if (!r?.ok) {
        const msg = r?.data?.message || 'Failed to load SMC analytics';
        if (this._firstLoad) this._showError(msg);
        else if (!this._isTransientCredError(r)) Toast?.error?.(msg);
        return;
      }
      this._markReady();
      if (which === 'batch') this.renderBatch(r.data.data, from, to);
      else                   this.renderMonitoring(r.data.data, from, to);
      if (r.data.data?.diagnostics) {
        console.log(`[analytics-dash] SMC detectedBy:`, r.data.data.diagnostics.detectedByValues);
        console.log(`[analytics-dash] SMC causedBy(3rd):`, r.data.data.diagnostics.causedByValues);
        console.log(`[analytics-dash] SMC team counts:`, r.data.data.diagnostics.teamConfigCounts);
      }
    } catch (e) {
      console.error('[analytics-dash] loadSmc error', e);
      const msg = 'Server error while loading SMC analytics';
      if (this._firstLoad) this._showError(msg);
      else Toast?.error?.(msg);
    } finally {
      this.setLoading(false);
    }
  },

  renderBatch(d, fromDate, toDate) {
    const b = d.batchfile || {};
    const monthly = d.monthly?.batchfile || [];
    const open = Math.max(0, (b.total || 0) - (b.closed || 0));

    setPctColored('bat-kpi-close', b.closePct, 90);
    setText('bat-kpi-close-sub', `${b.closed ?? 0} closed / ${b.total ?? 0} tickets`);
    setText('bat-kpi-open', String(open));
    setText('bat-kpi-open-sub', open > 0 ? 'unresolved batchfiles' : 'all closed');
    setPctColored('bat-kpi-int', b.internal?.closePct, 90);
    setText('bat-kpi-int-sub', `${b.internal?.closed ?? 0} / ${b.internal?.total ?? 0} internal`);
    setPctColored('bat-kpi-ext', b.external?.closePct, 90);
    setText('bat-kpi-ext-sub', `${b.external?.closed ?? 0} / ${b.external?.total ?? 0} 3rd-party`);

    const year = parseInt((toDate || '').slice(0, 4), 10) || new Date().getFullYear();
    this.renderMonthTracker('bat-months', monthly, {
      year, fromDate, toDate,
      missFn: m => Math.max(0, (m.total || 0) - (m.closed || 0)),
      subFn: m => {
        const openM = Math.max(0, (m.total || 0) - (m.closed || 0));
        const t = m.total || 0;
        return openM > 0 ? `${openM} of ${t} open` : (t > 0 ? `${t} closed` : 'no data');
      },
      cleanSubFn: m => (m.total || 0) > 0 ? `${m.total} closed` : 'clean',
      onClick: (monthKey, m) => {
        const label = this._monthLabel(monthKey);
        this.openSmcDetail(
          { type: 'batch', closed: 'open' },
          `Batchfile · ${label} (open)`,
          this._monthRange(monthKey),
        );
      },
    });

    this.chartBatch = renderMissBarChart('batch-chart', 'batch-chart-card', this.chartBatch, monthly, {
      missFn: m => Math.max(0, (m.total || 0) - (m.closed || 0)),
      totalFn: m => m.total || 0,
      color: this.COLORS.orange,
      yTitle: 'Tickets',
      stacked: true,
      closedFn: m => m.closed || 0,
    });

    // Action-by breakdown (SM / TS / Other)
    this._renderCountBreakdown('bat-action', [
      { key: 'sm',    label: 'SM',    color: this.COLORS.orange, filter: { type: 'batch', action: 'sm' } },
      { key: 'ts',    label: 'TS',    color: this.COLORS.blue,   filter: { type: 'batch', action: 'ts' } },
      { key: 'other', label: 'Other', color: this.COLORS.grey,   filter: { type: 'batch', action: 'other' } },
    ], b.actionBy || {}, 'Batchfile');

    this._setTabCounter('batch', open, open > 0 ? 'bad' : 'good', open > 0 ? `${open} OPEN` : 'CLOSED');
  },

  renderMonitoring(d, fromDate, toDate) {
    const mo = d.monitoring || {};
    const monthly = d.monthly?.monitoring || [];
    const open = Math.max(0, (mo.total || 0) - (mo.closed || 0));
    const det  = mo.detectedBy || {};
    const detTotal = (det.sm || 0) + (det.ss || 0) + (det.other || 0);
    const smPct  = detTotal > 0 ? (det.sm  * 100 / detTotal) : 0;
    const othPct = detTotal > 0 ? ((det.ss + det.other) * 100 / detTotal) : 0;

    setPctColored('mon-kpi-close', mo.closePct, 90);
    setText('mon-kpi-close-sub', `${mo.closed ?? 0} closed / ${mo.total ?? 0} alerts`);
    setText('mon-kpi-open', String(open));
    setText('mon-kpi-open-sub', open > 0 ? 'unresolved monitoring' : 'all closed');
    setPctColored('mon-kpi-sm', smPct, 90);
    setText('mon-kpi-sm-sub', `${det.sm || 0} of ${detTotal} alerts`);
    setPctRaw('mon-kpi-oth', othPct);
    setText('mon-kpi-oth-sub', `${(det.ss || 0) + (det.other || 0)} caught by non-SM`);

    const year = parseInt((toDate || '').slice(0, 4), 10) || new Date().getFullYear();
    this.renderMonthTracker('mon-months', monthly, {
      year, fromDate, toDate,
      missFn: m => Math.max(0, (m.total || 0) - (m.closed || 0)),
      subFn: m => {
        const openM = Math.max(0, (m.total || 0) - (m.closed || 0));
        const t = m.total || 0;
        return openM > 0 ? `${openM} of ${t} open` : (t > 0 ? `${t} closed` : 'no data');
      },
      cleanSubFn: m => (m.total || 0) > 0 ? `${m.total} closed` : 'clean',
      onClick: (monthKey, m) => {
        const label = this._monthLabel(monthKey);
        this.openSmcDetail(
          { type: 'monitoring', closed: 'open' },
          `Monitoring · ${label} (open)`,
          this._monthRange(monthKey),
        );
      },
    });

    this.chartMon = renderMissBarChart('mon-chart', 'mon-chart-card', this.chartMon, monthly, {
      missFn: m => Math.max(0, (m.total || 0) - (m.closed || 0)),
      totalFn: m => m.total || 0,
      color: this.COLORS.blue,
      yTitle: 'Alerts',
      stacked: true,
      closedFn: m => m.closed || 0,
    });

    this._renderCountBreakdown('mon-detected', [
      { key: 'sm',    label: 'SM',    color: this.COLORS.good, filter: { type: 'monitoring', detected: 'sm' } },
      { key: 'ss',    label: 'SS',    color: this.COLORS.blue, filter: { type: 'monitoring', detected: 'ss' } },
      { key: 'other', label: 'Other', color: this.COLORS.grey, filter: { type: 'monitoring', detected: 'other' } },
    ], det, 'Monitoring');

    this._setTabCounter('monitoring', open, open > 0 ? 'bad' : 'good', open > 0 ? `${open} OPEN` : 'CLOSED');
  },

  // Render a simple count-based breakdown list in a right-side panel.
  _renderCountBreakdown(containerId, items, valuesObj, titlePrefix) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const total = items.reduce((s, it) => s + ((valuesObj[it.key]) || 0), 0);
    if (total === 0) {
      box.innerHTML = '<div class="gm-brk-empty">ไม่มีข้อมูลในช่วงนี้</div>';
      return;
    }
    box.innerHTML = items.map(it => {
      const v = valuesObj[it.key] || 0;
      const p = Math.round(v * 100 / total);
      return `<div class="gm-brk-row" data-key="${it.key}" style="cursor:${v > 0 ? 'pointer' : 'default'}">
        <div class="gm-brk-key">
          <span class="dot" style="background:${it.color}"></span>
          ${escHtml(it.label)}
        </div>
        <div class="gm-brk-val"><b>${v}</b> · ${p}%</div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-key]').forEach(row => {
      const it = items.find(x => x.key === row.dataset.key);
      if (!it || !valuesObj[it.key]) return;
      row.addEventListener('click', () => {
        this.openSmcDetail(it.filter, `${titlePrefix} · ${it.label}`);
      });
    });
  },

  _setTabCounter(tab, num, cls, label) {
    const btn = document.querySelector(`.main-tab[data-tab="${tab}"]`);
    if (!btn) return;
    let chip = btn.querySelector('.gm-cnt');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'gm-cnt';
      btn.appendChild(chip);
    }
    chip.textContent = label;
    chip.className = 'gm-cnt ' + (cls || '');
  },

  // ── Server tab: missed-ticket inline list ────────────────────────────
  _showSrvTicketList(monthKey, m) {
    const panel = document.getElementById('srv-month-tickets');
    if (!panel) return;
    const label = this._monthLabel(monthKey);
    const issues = (m && m.missedIssues) ? m.missedIssues : [];
    let listHtml;
    if (!issues.length) {
      listHtml = `<div class="gm-mt-empty">ไม่มีข้อมูล ticket ใน cache (ลอง Force refresh)</div>`;
    } else {
      listHtml = `<div class="gm-mt-list">${issues.map(t =>
        `<div class="gm-mt-item">
          <a class="gm-mt-key" href="${escHtml(t.url)}" target="_blank" rel="noopener">${escHtml(t.key)}</a>
          <span class="gm-mt-sum" title="${escHtml(t.summary)}">${escHtml(t.summary)}</span>
        </div>`
      ).join('')}</div>`;
    }
    panel.innerHTML = `
      <div class="gm-mt-head">
        <span class="gm-mt-title"><i data-icon="alert-triangle"></i> SM Missed · ${escHtml(label)} (${issues.length} tickets)</span>
        <div class="gm-mt-actions">
          <button class="gm-mt-view" id="srv-mt-view-btn">View full detail</button>
          <button class="gm-mt-close" title="Close"><i data-icon="x"></i></button>
        </div>
      </div>
      ${listHtml}`;
    panel.style.display = 'block';
    window.Icons?.render?.(panel);
    panel.querySelector('.gm-mt-close').addEventListener('click', () => this._closeSrvTicketList());
    panel.querySelector('#srv-mt-view-btn').addEventListener('click', () => {
      this.openDetail({
        sev: 'all', origin: 'all', detected: 'other',
        label: `Server Monitoring · ${label} (SM missed)`,
        dateOverride: this._monthRange(monthKey),
      });
    });
  },
  _closeSrvTicketList() {
    this._srvActiveMonthKey = null;
    document.querySelectorAll('#srv-months .gm-mcell').forEach(c => c.classList.remove('selected'));
    const panel = document.getElementById('srv-month-tickets');
    if (panel) panel.style.display = 'none';
  },

  // ── Month tracker (12 cells: Jan-Dec) ─────────────────────────────────
  renderMonthTracker(containerId, monthly, opts) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Index monthly[] by "YYYY-MM"
    const byKey = {};
    (monthly || []).forEach(m => { byKey[m.month] = m; });

    const year = opts.year;
    const now  = new Date();
    const curKey = now.toISOString().slice(0, 7);
    const from = opts.fromDate || '';
    const to   = opts.toDate   || '';

    const html = this.MONTH_NAMES.map((name, i) => {
      const mm = String(i + 1).padStart(2, '0');
      const key = `${year}-${mm}`;
      const m = byKey[key];
      const inRange = (!from || key >= from.slice(0, 7)) && (!to || key <= to.slice(0, 7));

      // Future = month is after current calendar month, or entirely outside requested range
      if (!inRange || key > curKey) {
        return this._monthCellHtml(name, key, 'future', '—', '—');
      }

      if (m) {
        const miss = opts.missFn ? opts.missFn(m) : 0;
        if (miss > 0) {
          return this._monthCellHtml(name, key, 'miss', String(miss), opts.subFn ? opts.subFn(m) : '', true);
        }
        return this._monthCellHtml(name, key, 'clean', '✓', opts.cleanSubFn ? opts.cleanSubFn(m) : 'clean');
      }
      // No bucket returned = no tickets that month (green)
      return this._monthCellHtml(name, key, 'clean', '✓', 'no data');
    }).join('');

    el.innerHTML = html;

    // Wire clicks
    if (opts.onClick) {
      el.querySelectorAll('.gm-mcell[data-key]').forEach(cell => {
        if (cell.classList.contains('future')) return;
        cell.addEventListener('click', () => {
          const key = cell.dataset.key;
          opts.onClick(key, byKey[key]);
        });
      });
    }
  },

  _monthCellHtml(name, key, cls, badge, sub, showBig = false) {
    const isMiss = cls === 'miss';
    return `<div class="gm-mcell ${cls}" data-key="${key}" title="${key}">
      <div class="m">${name}</div>
      <div class="badge">${badge}</div>
      ${isMiss && showBig ? `<div class="sub">${escHtml(sub)}</div>` : `<div class="cnt">${escHtml(sub)}</div>`}
    </div>`;
  },

  _monthLabel(monthKey) {
    const [y, mm] = String(monthKey).split('-');
    const idx = parseInt(mm, 10) - 1;
    return `${this.MONTH_NAMES[idx] || mm} ${y}`;
  },
  _monthRange(monthKey) {
    const [y, mm] = String(monthKey).split('-');
    const first = `${y}-${mm}-01`;
    const d = new Date(parseInt(y, 10), parseInt(mm, 10), 0);
    const last  = `${y}-${mm}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: first, to: last };
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Helpers (module-level)
   ══════════════════════════════════════════════════════════════════════════ */

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}
// Set a percentage with color that reflects a threshold: green ≥ target, warn < target-10, else default.
function setPctColored(id, val, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(val);
  if (!Number.isFinite(n)) { el.textContent = '—'; el.className = 'v'; return; }
  el.textContent = n.toFixed(2) + '%';
  let cls = 'v';
  if (target != null) {
    if (n >= target)           cls += ' good';
    else if (n >= target - 10) cls += ' warn';
    else                       cls += ' bad';
  }
  el.className = cls;
}
// No target — just show a percent without colour.
function setPctRaw(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(val);
  if (!Number.isFinite(n)) { el.textContent = '—'; el.className = 'v'; return; }
  el.textContent = n.toFixed(2) + '%';
  el.className = 'v';
}
function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) + '%' : '—';
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#333';
}

/**
 * Miss-count bar chart. Two modes:
 *   - non-stacked: single-series bars of missFn(m)
 *   - stacked:     open (missFn) + closed (closedFn) stacked, showing total volume
 */
function renderMissBarChart(canvasId, cardId, existing, monthly, opts) {
  if (existing) existing.destroy();
  const canvas = document.getElementById(canvasId);
  const wrap   = document.querySelector(`#${cardId} .gm-canvas-wrap`);
  const empty  = document.getElementById(`${canvasId}-empty`);
  const hasData = (monthly || []).some(m => (opts.totalFn ? opts.totalFn(m) : opts.missFn(m)) > 0);
  if (!canvas || !hasData) {
    if (wrap)  wrap.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return null;
  }
  if (wrap)  wrap.style.display = 'block';
  if (empty) empty.style.display = 'none';

  const labels = monthly.map(m => monthLabelShort(m.month));
  const missArr = monthly.map(m => opts.missFn(m));

  const datasets = [];
  if (opts.stacked && opts.closedFn) {
    const closedArr = monthly.map(m => opts.closedFn(m));
    datasets.push({
      type: 'bar', label: 'Closed / OK', data: closedArr,
      backgroundColor: '#CBD5E1', stack: 'v', borderRadius: 4, maxBarThickness: 34,
    });
    datasets.push({
      type: 'bar', label: 'Open / Missed', data: missArr,
      backgroundColor: opts.color, stack: 'v', borderRadius: 4, maxBarThickness: 34,
    });
  } else {
    datasets.push({
      type: 'bar', label: opts.yTitle || 'Miss', data: missArr,
      backgroundColor: opts.color, borderRadius: 4, maxBarThickness: 34,
    });
  }

  return new Chart(canvas.getContext('2d'), {
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: !!opts.stacked, position: 'top',
                  labels: { color: cssVar('--text-muted'), font: { size: 11, family: cssVar('--font') } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}` } },
      },
      scales: {
        x: { stacked: !!opts.stacked, grid: { display: false }, ticks: { color: cssVar('--text-muted') } },
        y: { stacked: !!opts.stacked, beginAtZero: true,
             grid: { color: cssVar('--border') },
             ticks: { color: cssVar('--text-muted'), precision: 0 },
             title: { display: true, text: opts.yTitle || '', color: cssVar('--text-muted') } },
      },
    },
  });
}

function monthLabelShort(monthStr) {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, mm] = String(monthStr).split('-');
  return `${MONTH_NAMES[parseInt(mm, 10) - 1] || mm} ${String(y).slice(2)}`;
}

// Basic HTML escape — used by rendered strings that come from Jira.
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
