/* ══════════════════════════════════════════════════════════════════
   alert-monitor.js  |  Dashboard controller
   Handles: sync-on-load, year selector, KPI + chart + analysis,
            heatmap Hour×Month, compare, per-month Top10 drill-down.
   ══════════════════════════════════════════════════════════════════ */
const AlertMonitor = (() => {
  const el = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');

  const TOP_DISPLAY   = 10;   // rows shown in the "รวมทั้งช่วง" tab
  const TOP_FETCH     = 50;   // depth fetched from stats.php (enough for the ≥20/เดือน filter)
  const HIGH_FREQ_MIN = 20;   // threshold for the "≥20 ครั้ง/เดือน" tab

  const state = {
    availableYears: [],       // [{year, months: [{month, count}], total}]
    selectedYear:   null,     // number
    stats:          null,     // stats.php response
    chart:          null,
    topView:        'all',    // 'all' | 'per-month' | 'high-freq'
    topSelectedMonth: null,   // when topView = per-month / high-freq
  };

  // ── Public entry ──────────────────────────────────────────────────
  async function init() {
    _bindUI();
    _showConfigButtonIfLead();

    // Fire sync + hydrate in parallel for fastest first paint
    _syncOnLoad();               // background
    await _hydrateAvailableYears();
    if (state.selectedYear) await _loadStats();
  }

  // ── UI wiring ─────────────────────────────────────────────────────
  function _bindUI() {
    el('am-btn-refresh').addEventListener('click', _manualRefresh);
    el('am-cmp-btn').addEventListener('click', _runCompare);

    el('am-top-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.am-top-tab');
      if (!btn) return;
      document.querySelectorAll('#am-top-tabs .am-top-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.topView = btn.dataset.view;
      const _p = new URLSearchParams(location.search);
      if (state.topView !== 'all') _p.set('view', state.topView); else _p.delete('view');
      history.replaceState(null, '', _p.toString() ? '?' + _p.toString() : location.pathname);
      _renderTop();
    });

    // Bootstrap topView from URL ?view=
    const _amUrlView = new URLSearchParams(location.search).get('view');
    if (_amUrlView && ['all','per-month','high-freq'].includes(_amUrlView)) {
      state.topView = _amUrlView;
      document.querySelectorAll('#am-top-tabs .am-top-tab').forEach(b => b.classList.toggle('active', b.dataset.view === _amUrlView));
    }
  }

  function _showConfigButtonIfLead() {
    try {
      const u = Auth.getUser?.() || {};
      const leadRoles = ['sm_admin', 'sm_lead', 'dev_sm'];
      if (leadRoles.includes(u.role)) el('am-btn-config').style.display = '';
    } catch {}
  }

  // ── Available months / year tabs ──────────────────────────────────
  async function _hydrateAvailableYears() {
    const res = await API.alertMonitor.state ? await API.alertMonitor.state() : null;
    const av  = await API.get('/alert-monitor/available-months.php');
    if (!av.ok) return;
    state.availableYears = av.data.data?.years || [];
    if (!state.availableYears.length) {
      el('am-year-tabs').innerHTML = '<div class="am-empty" style="padding:8px 12px;font-size:11px">ยังไม่มีข้อมูล กด รีเฟรช เพื่อดึงจาก JSM</div>';
      return;
    }
    // Default: current year if available, else newest. URL ?year= overrides.
    const currentYear = new Date().getFullYear();
    const hasCurrent  = state.availableYears.find(y => y.year === currentYear);
    state.selectedYear = hasCurrent ? currentYear : state.availableYears[0].year;
    const _urlYear = parseInt(new URLSearchParams(location.search).get('year'), 10);
    if (_urlYear && state.availableYears.find(y => y.year === _urlYear)) state.selectedYear = _urlYear;
    _renderYearTabs();
    _updateHeroStats(av.data.data);
    _populateCompareSelects();
  }

  function _renderYearTabs() {
    const html = state.availableYears
      .slice()
      .sort((a, b) => a.year - b.year)   // oldest→newest reads left→right
      .map(y => `
        <button class="am-year-tab ${y.year === state.selectedYear ? 'active' : ''}"
                data-year="${y.year}">
          ${y.year}
          <sup>${y.month_count}</sup>
        </button>
      `).join('');
    el('am-year-tabs').innerHTML = html;
    el('am-year-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.am-year-tab');
      if (!btn) return;
      const y = parseInt(btn.dataset.year, 10);
      if (y === state.selectedYear) return;
      state.selectedYear = y;
      document.querySelectorAll('.am-year-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const _p = new URLSearchParams(location.search);
      _p.set('year', String(y));
      history.replaceState(null, '', '?' + _p.toString());
      _loadStats();
    });
  }

  function _updateHeroStats(avData) {
    // Total across selected year, months tracked, last sync (from state.php)
    const selYearObj = (avData.years || []).find(y => y.year === state.selectedYear);
    const total = selYearObj?.total || 0;
    const months = selYearObj?.month_count || 0;
    _setHero('am-hs-total', fmt.format(total), `${state.selectedYear}`);
    _setHero('am-hs-months', String(months), `เดือนใน ${state.selectedYear}`);

    // Fetch state for last_sync timestamp
    API.alertMonitor.state().then(r => {
      if (!r.ok) return;
      const st = r.data.data?.state || {};
      const t = st.last_sync_finished_at || 0;
      _setHero('am-hs-sync', t ? _relTime(t * 1000) : '—', 'JSM Ops');
    }).catch(() => {});
  }
  function _setHero(id, val, sub) {
    const v = el(id); v.textContent = val; v.classList.remove('am-skel');
    const s = el(id + '-sub'); if (s && sub) s.textContent = sub;
  }

  function _populateCompareSelects() {
    const all = [];
    state.availableYears.slice().sort((a,b) => a.year - b.year).forEach(y => {
      y.months.forEach(m => all.push(m.month));
    });
    if (!all.length) return;
    const opt = (m) => `<option value="${m}">${m}</option>`;
    const html = all.map(opt).join('');
    el('am-cmp-a').innerHTML = html;
    el('am-cmp-b').innerHTML = html;
    // Default: prev vs last
    const last = all[all.length - 1];
    const prev = all.length >= 2 ? all[all.length - 2] : last;
    el('am-cmp-a').value = prev;
    el('am-cmp-b').value = last;
  }

  // ── Sync flow (page-load + manual) ────────────────────────────────
  async function _syncOnLoad() {
    _setSyncStatus('syncing', 'sync ทำงานอยู่');
    try {
      const first = await _postSync('');
      await _handleSyncResult(first);
    } catch (e) {
      _setSyncStatus('error', 'sync ล้มเหลว');
    }
  }
  async function _manualRefresh() {
    const btn = el('am-btn-refresh'); btn.disabled = true;
    const icon = el('am-refresh-icon'); icon.innerHTML = '<span class="spinner"></span>';
    _setSyncStatus('syncing', 'กำลังรีเฟรช...');
    try {
      const res = await _postSync('?force=1');
      await _handleSyncResult(res);
      await _hydrateAvailableYears();
      if (state.selectedYear) await _loadStats();
    } catch {
      _setSyncStatus('error', 'รีเฟรชล้มเหลว');
    } finally {
      btn.disabled = false; icon.textContent = '↻';
    }
  }
  async function _handleSyncResult(res) {
    if (!res || !res.data) return;
    const d = res.data;
    if (d.skipped) { _setSyncStatus('ok', 'เพิ่งซิงค์'); return; }
    if (d.has_more) {
      _showProgress(true);
      let chunk = 1;
      while (true) {
        _updateProgress(chunk, d.mode === 'backfill');
        chunk++;
        const next = await _postSync('?continue=1');
        if (!next?.data) break;
        if (!next.data.has_more) {
          _showProgress(false);
          _setSyncStatus('ok', 'sync เสร็จ');
          await _hydrateAvailableYears();
          if (state.selectedYear) await _loadStats();
          return;
        }
        if (chunk > 100) { _showProgress(false); break; }
      }
    } else {
      const n = (d.new ?? 0) + (d.updated ?? 0);
      _setSyncStatus('ok', n > 0 ? `อัปเดต ${n} รายการ` : 'ไม่มีของใหม่');
      if (n > 0) {
        await _hydrateAvailableYears();
        if (state.selectedYear) await _loadStats();
      }
    }
  }
  async function _postSync(qs) {
    const r = await API.request('POST', '/alert-monitor/sync.php' + qs, {});
    if (!r.ok) throw new Error(r.data?.message || 'sync failed');
    return r.data;
  }
  function _setSyncStatus(kind, text) {
    const dot = el('am-sync-dot');
    dot.className = 'am-sync-dot' + (kind === 'syncing' ? ' syncing' : kind === 'error' ? ' error' : '');
    el('am-sync-text').textContent = text;
  }
  function _showProgress(v) { el('am-progress').classList.toggle('visible', v); }
  function _updateProgress(chunk, isBackfill) {
    const pct = Math.min(95, Math.round((1 - 1 / (chunk + 1)) * 100));
    el('am-progress-fill').style.width = pct + '%';
    el('am-progress-pct').textContent = pct + '%';
    el('am-progress-label').textContent = isBackfill
      ? `กำลัง backfill ย้อนหลัง · chunk ${chunk}`
      : `กำลัง sync · chunk ${chunk}`;
  }

  // ── Stats fetch + full render ─────────────────────────────────────
  async function _loadStats() {
    const y = state.availableYears.find(x => x.year === state.selectedYear);
    if (!y || !y.months.length) return;
    const from = y.months[0].month;
    const to   = y.months[y.months.length - 1].month;
    const res  = await API.alertMonitor.stats(from, to, TOP_FETCH);
    if (!res.ok) { _setSyncStatus('error', 'โหลด stats ล้มเหลว'); return; }
    state.stats = res.data.data;
    // Reset per-month top10 selection to newest month by default
    if (state.stats.range?.months?.length) {
      state.topSelectedMonth = state.stats.range.months[state.stats.range.months.length - 1];
    }
    _renderAll();
  }

  function _renderAll() {
    const s = state.stats;
    if (!s || !s.monthly?.length) return _renderEmpty();
    _renderKpis(s);
    _renderChart(s);
    _renderAnalysis(s);
    _renderHeatmap(s);
    _renderTop();
  }

  function _renderEmpty() {
    ['am-kpi-total','am-kpi-mon','am-kpi-batch','am-kpi-delta']
      .forEach(id => { const e = el(id); e.textContent = '0'; e.classList.remove('am-skel'); });
    el('am-analysis').innerHTML = '<li>ยังไม่มีข้อมูลให้วิเคราะห์</li>';
    el('am-heatmap-scroll').innerHTML = '<div class="am-empty">ยังไม่มีข้อมูล heatmap</div>';
    el('am-top-body').innerHTML = `<tr><td colspan="6"><div class="am-empty">
      <h4>ยังไม่มีข้อมูล</h4><p>กด <b>รีเฟรช</b> เพื่อดึงจาก JSM Ops</p></div></td></tr>`;
  }

  function _renderKpis(s) {
    const last = s.monthly[s.monthly.length - 1];
    const prev = s.monthly.length >= 2 ? s.monthly[s.monthly.length - 2] : null;
    const setV = (id, v) => { const e = el(id); e.textContent = fmt.format(v); e.classList.remove('am-skel'); };
    setV('am-kpi-total', last.total);
    setV('am-kpi-mon',   last.by_category.monitoring ?? 0);
    setV('am-kpi-batch', last.by_category.batch ?? 0);

    const dPct = last.change_pct;
    const dE   = el('am-kpi-delta'); dE.classList.remove('am-skel');
    if (dPct == null) {
      dE.textContent = '—';
      el('am-kpi-delta-sub').textContent = 'ไม่มีเดือนก่อนหน้าให้เทียบ';
    } else {
      dE.innerHTML = `<span class="${dPct >= 0 ? 'up' : 'down'}">${dPct >= 0 ? '+' : ''}${dPct.toFixed(1)}%</span>`;
      dE.style.color = dPct >= 0 ? 'var(--am-c-up)' : 'var(--am-c-down)';
      el('am-kpi-delta-sub').innerHTML = `เทียบ ${prev?.month || ''} (${fmt.format(prev?.total || 0)})`;
    }
    el('am-kpi-total-sub').textContent = `เดือน ${last.month}`;
    const subMon = last.change_pct_by_cat?.monitoring;
    el('am-kpi-mon-sub').innerHTML = subMon != null ? _pctSpan(subMon) + ' vs เดือนก่อน' : '';
    const subBat = last.change_pct_by_cat?.batch;
    el('am-kpi-batch-sub').innerHTML = subBat != null ? _pctSpan(subBat) + ' vs เดือนก่อน' : '';
  }
  function _pctSpan(p) {
    if (p == null) return '';
    const cls = p >= 0 ? 'up' : 'down';
    return `<span class="${cls}">${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span>`;
  }

  function _renderChart(s) {
    const ctx = el('am-chart-monthly').getContext('2d');
    if (state.chart) state.chart.destroy();
    const labels = s.monthly.map(m => m.month);
    const mon = s.monthly.map(m => m.by_category.monitoring ?? 0);
    const bat = s.monthly.map(m => m.by_category.batch ?? 0);
    const oth = s.monthly.map(m => m.by_category.other ?? 0);
    const cs  = getComputedStyle(document.querySelector('.am-wrap'));
    const cMon = cs.getPropertyValue('--am-c-monitoring').trim();
    const cBat = cs.getPropertyValue('--am-c-batch').trim();
    const cOth = cs.getPropertyValue('--am-c-other').trim();
    const cTxt = cs.getPropertyValue('--text-muted').trim();
    const cGrd = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#e5e7eb';

    state.chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Monitoring', data: mon, backgroundColor: cMon, borderRadius: 4, stack: 'a' },
        { label: 'Batch',      data: bat, backgroundColor: cBat, borderRadius: 4, stack: 'a' },
        { label: 'Other',      data: oth, backgroundColor: cOth, borderRadius: 4, stack: 'a' },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { footer: (items) => 'รวม: ' + fmt.format(items.reduce((a,b)=>a+b.parsed.y,0)) } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: cTxt } },
          y: { stacked: true, grid: { color: cGrd }, ticks: { color: cTxt, precision: 0 } }
        },
        onClick: (evt, els) => {
          if (!els?.length) return;
          const idx = els[0].index;
          const m = s.range.months[idx];
          state.topView = 'per-month';
          state.topSelectedMonth = m;
          document.querySelectorAll('#am-top-tabs .am-top-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.view === 'per-month');
          });
          _renderTop();
        }
      }
    });
  }

  function _renderAnalysis(s) {
    const ul = el('am-analysis');
    if (!s.analysis?.length) { ul.innerHTML = '<li>ไม่มีข้อมูลให้วิเคราะห์</li>'; return; }
    ul.innerHTML = s.analysis.map((line, i) => {
      const cls = i === 0 ? 'emphasis' : '';
      const html = _escape(line).replace(/(-?\d[\d.,]*%?)/g, '<b>$1</b>');
      return `<li class="${cls}">${html}</li>`;
    }).join('');
  }

  // ── Heatmap ───────────────────────────────────────────────────────
  function _renderHeatmap(s) {
    const hm = s.hour_matrix;
    if (!hm || !hm.months?.length) {
      el('am-heatmap-scroll').innerHTML = '<div class="am-empty">ไม่มีข้อมูล</div>';
      return;
    }
    // Group months by year for the super-header
    const yearGroups = [];  // [{year, months: [YYYY-MM]}]
    hm.months.forEach(m => {
      const y = m.slice(0, 4);
      const last = yearGroups[yearGroups.length - 1];
      if (last && last.year === y) last.months.push(m);
      else yearGroups.push({ year: y, months: [m] });
    });

    // Super-header — year bands
    const yearRow = ['<th class="corner">Hour</th>']
      .concat(yearGroups.map((g, i) =>
        `<th class="year-band y-${i % 3}" colspan="${g.months.length}">${g.year}</th>`))
      .concat(['<th class="year-band y-0" rowspan="2">Total</th>'])
      .join('');

    // Month header row
    const monthRow = ['<th></th>']
      .concat(hm.months.map(m => {
        const monKey = m.slice(5);
        const name = _MONTHS[parseInt(monKey, 10) - 1];
        return `<th class="month-col">${name}</th>`;
      }))
      .join('');

    // Body: 24 hour rows
    const bodyRows = hm.rows.map(row => {
      const cells = row.counts.map(c => {
        const i = hm.max_cell ? Math.min(1, c / hm.max_cell) : 0;
        const val = c === 0 ? '·' : fmt.format(c);
        return `<td class="cell" style="--i:${i.toFixed(3)}" title="${fmt.format(c)}">${val}</td>`;
      }).join('');
      const rowTot = hm.row_totals[row.hour] ?? 0;
      return `<tr>
        <th class="hour-col">${String(row.hour).padStart(2, '0')}</th>
        ${cells}
        <td class="total-col">${fmt.format(rowTot)}</td>
      </tr>`;
    }).join('');

    // Grand-total row
    const totalRow = `<tr class="grand-total">
      <th class="hour-col">Total</th>
      ${hm.months.map(m => `<td>${fmt.format(hm.col_totals[m] ?? 0)}</td>`).join('')}
      <td class="total-col">${fmt.format(hm.grand_total)}</td>
    </tr>`;

    el('am-heatmap-scroll').innerHTML = `
      <table class="am-heatmap">
        <thead>
          <tr>${yearRow}</tr>
          <tr>${monthRow}</tr>
        </thead>
        <tbody>${bodyRows}${totalRow}</tbody>
      </table>`;
  }

  // ── Top 10 (with drill-down) ──────────────────────────────────────
  function _renderTop() {
    const s = state.stats;
    if (!s) return;
    const meta    = el('am-top-meta');
    const trendTh = el('am-top-trend-th');
    const deltaTh = el('am-top-delta-th');

    trendTh.textContent = 'Trend';   // restore label (only 'all' view shows it)

    if (state.topView === 'high-freq') {
      // Pick a month from the strip first, then show that month's alerts ≥N.
      el('am-top-month-strip').classList.add('visible');
      _renderTopMonthStrip(s);
      trendTh.style.display = 'none';
      deltaTh.style.display = 'none';
      _renderHighFreq(s);
      return;
    }

    if (state.topView === 'per-month') {
      el('am-top-month-strip').classList.add('visible');
      _renderTopMonthStrip(s);
      trendTh.style.display = 'none';
      deltaTh.style.display = 'none';
      _renderTopRows(_perMonthRows(s), false);
      meta.textContent = `เดือน ${state.topSelectedMonth || '—'}`;
    } else {
      el('am-top-month-strip').classList.remove('visible');
      trendTh.style.display = '';
      deltaTh.style.display = '';
      _renderTopRows((s.top || []).slice(0, TOP_DISPLAY), true);
      meta.textContent = `${s.range.from} → ${s.range.to} · รวม ${fmt.format(s.total)} alerts`;
    }
  }

  // Alerts in the month picked from the strip that hit ≥ HIGH_FREQ_MIN,
  // sorted worst-first.
  function _renderHighFreq(s) {
    const month = state.topSelectedMonth;
    const rows = (s.top_by_month?.[month] || [])
      .filter(a => (a.count || 0) >= HIGH_FREQ_MIN)
      .sort((x, y) => y.count - x.count);

    const monName = month
      ? `${_MONTHS[parseInt(month.slice(5), 10) - 1] || month} ${month.slice(0, 4)}`
      : '—';
    el('am-top-meta').textContent =
      `${monName} · เกณฑ์ ≥ ${HIGH_FREQ_MIN} ครั้ง · พบ ${fmt.format(rows.length)} ตัว`;

    if (!rows.length) {
      el('am-top-body').innerHTML = `<tr><td colspan="6"><div class="am-empty">
        <h4>ไม่มี alert ที่ ≥ ${HIGH_FREQ_MIN} ครั้ง</h4>
        <p>เดือน ${_escape(monName)} ไม่มี alert ตัวไหนถึงเกณฑ์ — ลองเลือกเดือนอื่นด้านบน</p></div></td></tr>`;
      return;
    }

    el('am-top-body').innerHTML = rows.map((t, i) => {
      const catCls  = t.category === 'monitoring' ? 'monitoring'
                    : t.category === 'batch'      ? 'batch' : 'other';
      const rankCls = i < 3 ? 'am-rank top3' : 'am-rank';
      return `<tr>
        <td><span class="${rankCls}">${i + 1}</span></td>
        <td class="am-title-cell">
          <b>${_escape(t.title)}</b>
          <small title="${_escape(t.sample || '')}">${_escape(t.sample || '')}</small>
        </td>
        <td><span class="am-cat-tag ${catCls}">${_escape(t.category)}</span></td>
        <td style="text-align:right" class="am-count-val">${fmt.format(t.count)}</td>
      </tr>`;
    }).join('');
  }
  function _renderTopMonthStrip(s) {
    const strip = el('am-top-month-strip');
    strip.innerHTML = s.range.months.map(m =>
      `<button class="mp ${m === state.topSelectedMonth ? 'active' : ''}" data-m="${m}">${m}</button>`
    ).join('');
    strip.onclick = (e) => {
      const btn = e.target.closest('.mp');
      if (!btn) return;
      state.topSelectedMonth = btn.dataset.m;
      _renderTop();
    };
  }
  function _perMonthRows(s) {
    const arr = (s.top_by_month?.[state.topSelectedMonth] || []);
    return arr.map(a => ({ ...a, trend_series: [], trend_delta: 0 }));
  }
  function _renderTopRows(list, showTrend) {
    if (!list.length) {
      el('am-top-body').innerHTML = `<tr><td colspan="6"><div class="am-empty">
        <h4>ยังไม่มี top alerts</h4></div></td></tr>`;
      return;
    }
    const rows = list.map((t, i) => {
      const catCls = t.category === 'monitoring' ? 'monitoring'
                   : t.category === 'batch'      ? 'batch' : 'other';
      const rankCls = i < 3 ? 'am-rank top3' : 'am-rank';
      const trendHtml = showTrend ? (() => {
        const trend = t.trend_delta || 0;
        const cls = trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat';
        const arrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '–';
        return `
          <td>${_sparkline(t.trend_series || [])}</td>
          <td style="text-align:right"><span class="am-trend ${cls}">${arrow} ${fmt.format(Math.abs(trend))}</span></td>`;
      })() : '';
      return `<tr>
        <td><span class="${rankCls}">${i + 1}</span></td>
        <td class="am-title-cell">
          <b>${_escape(t.title)}</b>
          <small title="${_escape(t.sample || '')}">${_escape(t.sample || '')}</small>
        </td>
        <td><span class="am-cat-tag ${catCls}">${_escape(t.category)}</span></td>
        <td style="text-align:right" class="am-count-val">${fmt.format(t.count)}</td>
        ${trendHtml}
      </tr>`;
    }).join('');
    el('am-top-body').innerHTML = rows;
  }

  // ── Compare 2 months ──────────────────────────────────────────────
  async function _runCompare() {
    const a = el('am-cmp-a').value;
    const b = el('am-cmp-b').value;
    if (!a || !b) return;
    if (a === b) {
      el('am-compare-body').innerHTML = '<div class="am-compare-empty">กรุณาเลือกคนละเดือน</div>';
      return;
    }
    el('am-compare-body').innerHTML = '<div class="am-skel" style="height:180px"></div>';
    const btn = el('am-cmp-btn'); btn.disabled = true;
    try {
      const r = await API.get(`/alert-monitor/compare.php?a=${a}&b=${b}`);
      if (!r.ok) throw new Error(r.data?.message || 'compare failed');
      _renderCompare(r.data.data);
    } catch (e) {
      el('am-compare-body').innerHTML = `<div class="am-compare-empty">Compare ล้มเหลว: ${_escape(e.message)}</div>`;
    } finally { btn.disabled = false; }
  }
  function _renderCompare(d) {
    const A = d.a, B = d.b;
    const catRow = (cat, label, color) => {
      const cd = d.category_delta[cat] || {};
      const dv = cd.delta || 0;
      const pc = cd.pct;
      return `<div class="row">
        <span style="color:${color};font-weight:600">● ${label}</span>
        <span><b>${fmt.format(cd.a || 0)}</b> → <b>${fmt.format(cd.b || 0)}</b>
          ${pc != null ? `<span class="${dv>=0?'up':'down'}" style="font-size:11px;margin-left:4px">${dv>=0?'+':''}${pc.toFixed(1)}%</span>` : ''}
        </span>
      </div>`;
    };
    const delta = d.delta_total, pct = d.pct_total;
    const deltaStrip = `
      <div class="am-compare-delta-strip">
        <div class="am-cd">
          <div class="lbl">Total</div>
          <div class="row1">${fmt.format(A.total)} → ${fmt.format(B.total)}</div>
          <div class="row2"><span class="${delta>=0?'up':'down'}">${delta>=0?'+':''}${fmt.format(delta)}</span> (${pct!=null?`${delta>=0?'+':''}${pct.toFixed(1)}%`:'—'})</div>
        </div>
        ${['monitoring','batch','other'].map(c => {
          const cd = d.category_delta[c] || {};
          const dv = cd.delta || 0;
          return `<div class="am-cd">
            <div class="lbl">${c}</div>
            <div class="row1">${fmt.format(cd.a || 0)} → ${fmt.format(cd.b || 0)}</div>
            <div class="row2"><span class="${dv>=0?'up':'down'}">${dv>=0?'+':''}${fmt.format(dv)}</span> (${cd.pct!=null?`${dv>=0?'+':''}${cd.pct.toFixed(1)}%`:'—'})</div>
          </div>`;
        }).join('')}
      </div>`;

    const listBox = (title, items, kind) => `
      <div class="am-cmp-list">
        <h4>${title}</h4>
        <ul>
          ${items.length ? items.slice(0, 5).map(x => `
            <li>
              <span class="txt" title="${_escape(x.sample || x.title)}">${_escape(x.title)}</span>
              <span class="n ${kind === 'up' ? 'up' : kind === 'down' ? 'down' : ''}">${
                kind === 'new'  ? '+' + fmt.format(x.count_b)
              : kind === 'gone' ? '−' + fmt.format(x.count_a)
              : (x.delta >= 0 ? '+' : '') + fmt.format(x.delta)
              }</span>
            </li>`).join('') : '<li style="color:var(--text-muted)">–</li>'}
        </ul>
      </div>`;

    el('am-compare-body').innerHTML = `
      ${deltaStrip}
      ${d.analysis?.length ? `<ul class="am-analysis" style="margin-bottom:14px">${
        d.analysis.map((line,i)=>`<li class="${i===0?'emphasis':''}">${_escape(line).replace(/(-?\d[\d.,]*%?)/g,'<b>$1</b>')}</li>`).join('')
      }</ul>` : ''}
      <div class="am-cmp-lists">
        ${listBox('▲ พุ่งสูงสุด', d.top_increases || [], 'up')}
        ${listBox('▼ ลดลงสูงสุด', d.top_decreases || [], 'down')}
        ${listBox(`🆕 ใหม่ใน ${B.month}`, d.new_in_b || [], 'new')}
        ${listBox(`✓ หายไปใน ${B.month}`, d.gone_in_b || [], 'gone')}
      </div>`;
  }

  // ── Helpers ───────────────────────────────────────────────────────
  const _MONTHS = ['Jan','Feb','Mar','Apr','May','June','July','Aug','Sep','Oct','Nov','Dec'];
  function _sparkline(data) {
    if (!data || data.length < 2) return '<span style="color:var(--text-muted);font-size:11px">–</span>';
    const w = 90, h = 26, pad = 2;
    const max = Math.max(...data, 1);
    const step = (w - pad * 2) / (data.length - 1);
    const pts = data.map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`).join(' ');
    const lx = pad + (data.length - 1) * step;
    const ly = h - pad - (data[data.length - 1] / max) * (h - pad * 2);
    return `<svg class="am-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="currentColor"/>
    </svg>`;
  }
  function _relTime(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  }
  function _escape(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[ch]));
  }

  return { init };
})();
