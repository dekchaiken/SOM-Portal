// compare — page script, extracted from compare.html.
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

Auth.requireAuth();
  Layout.render('compare');

  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ── Palette — one distinct colour per service. 8 slots (any more and
  //    overlay stops being readable anyway; UI caps at 8).
  const PALETTE = ['#8b5cf6', '#f59e0b', '#10b981', '#06b6d4', '#ec4899', '#f43f5e', '#84cc16', '#eab308'];

  // ── Range presets — matches SP page vocabulary
  const RANGES = [
    { min: 30,    label: '30m' },
    { min: 60,    label: '1h'  },
    { min: 180,   label: '3h'  },
    { min: 360,   label: '6h'  },
    { min: 720,   label: '12h' },
    { min: 1440,  label: '24h' },
    { min: 4320,  label: '3d'  },
  ];

  // ── Chart specs — metrics to overlay. Each entry says which series to
  //    pull from detail.php's response for each service. Aggregation is
  //    already service-scoped so "line per service" is 1-to-1.
  const CHART_SPECS = [
    { key: 'cpu',        label: 'CPU · avg per pod',       unit: 'cores', pick: d => d.series?.cpu     || [] },
    { key: 'mem',        label: 'MEM · avg per pod',       unit: 'bytes', pick: d => d.series?.mem     || [] },
    { key: 'txnRate',    label: 'TXN rate',                unit: 'reqs',  pick: d => d.series?.txnRate || [] },
    { key: 'procMs',     label: 'Avg latency',             unit: 'ms',    pick: d => d.series?.procMs  || [] },
    { key: 'procMsMax',  label: 'Latency MAX (worst req)', unit: 'ms',    pick: d => d.series?.procMsMax || [] },
  ];

  const CMP = window.CMP = {
    services:  [],       // [{name, color, data, error}]
    windowMin: 60,
    cluster:   '',

    init() {
      // Boot from URL params
      const p = new URLSearchParams(location.search);
      const svcParam = p.get('services') || '';
      const winParam = parseInt(p.get('window') || '60', 10);
      this.cluster = p.get('cluster') || '';
      this.windowMin = Number.isFinite(winParam) && winParam >= 5 ? winParam : 60;
      this._paintRange();
      const svcs = svcParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
      for (const name of svcs) this._addService(name, false);
      this._renderChips();
      this._paintAdder();
      if (this.services.length) this.load();
      else this._renderEmpty();
    },

    _paintRange() {
      const wrap = $('cmp-range');
      // Preserve the label (first child) + rebuild buttons.
      const lbl = wrap.querySelector('.cmp-range-lbl');
      wrap.innerHTML = '';
      wrap.appendChild(lbl);
      RANGES.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'cmp-range-btn' + (r.min === this.windowMin ? ' on' : '');
        btn.textContent = r.label;
        btn.onclick = () => { this.windowMin = r.min; this._paintRange(); this._syncUrl(); this.load(); };
        wrap.appendChild(btn);
      });
    },

    _addService(name, autoLoad = true) {
      if (this.services.length >= 8) return alert('Max 8 services (chart becomes unreadable beyond that)');
      if (this.services.some(s => s.name === name)) return;
      const color = PALETTE[this.services.length % PALETTE.length];
      this.services.push({ name, color, data: null, error: null });
      this._renderChips();
      this._syncUrl();
      if (autoLoad) this.load();
    },

    _removeService(name) {
      this.services = this.services.filter(s => s.name !== name);
      // Re-assign colors so they stay dense (no gaps in palette)
      this.services.forEach((s, i) => s.color = PALETTE[i % PALETTE.length]);
      this._renderChips();
      this._syncUrl();
      if (this.services.length) this._renderCharts();
      else this._renderEmpty();
    },

    _renderChips() {
      const row = $('cmp-svc-row');
      const chipsHtml = this.services.map(s => `
        <span class="cmp-svc-chip">
          <span class="dot" style="background:${s.color}"></span>
          <span class="name">${esc(s.name)}</span>
          <button class="rm" onclick="CMP._removeService('${esc(s.name)}')" title="Remove">✕</button>
        </span>`).join('');
      const adderHtml = this.services.length < 8 ? `
        <span class="cmp-add-wrap">
          <input class="cmp-add-input" id="cmp-add" list="cmp-add-list"
                 placeholder="+ พิมพ์ชื่อ service แล้ว Enter (add up to ${8 - this.services.length} more)">
          <datalist id="cmp-add-list"></datalist>
        </span>` : '';
      row.innerHTML = chipsHtml + adderHtml;
      // Wire the adder
      const inp = $('cmp-add');
      if (inp) {
        inp.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          const val = inp.value.trim();
          if (!val) return;
          this._addService(val);
          inp.value = '';
        });
        // Preload service list into datalist for typeahead
        if (!CMP._svcList) {
          API.servicePerformance.suggest('', 500).then(r => {
            CMP._svcList = r?.data?.data?.suggestions || [];
            this._paintAdder();
          }).catch(() => {});
        } else {
          this._paintAdder();
        }
      }
    },

    _paintAdder() {
      const list = $('cmp-add-list');
      if (!list || !CMP._svcList) return;
      list.innerHTML = CMP._svcList
        .filter(s => !this.services.some(x => x.name === (s.service || s)))
        .map(s => {
          const name = s.service || s;
          const meta = s.bu || s.team ? ` — ${s.bu || ''}${s.team ? ' · ' + s.team : ''}` : '';
          return `<option value="${esc(name)}">${esc(name + meta)}</option>`;
        }).join('');
    },

    _syncUrl() {
      const p = new URLSearchParams();
      if (this.services.length) p.set('services', this.services.map(s => s.name).join(','));
      if (this.windowMin !== 60) p.set('window', String(this.windowMin));
      if (this.cluster) p.set('cluster', this.cluster);
      const q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    },

    copyLink() {
      navigator.clipboard.writeText(location.href).then(() => {
        const t = $('cmp-refresh-status');
        const orig = t.textContent;
        t.textContent = '✓ Copied link';
        t.style.color = 'var(--ok)';
        setTimeout(() => { t.textContent = orig; t.style.color = ''; }, 1500);
      });
    },

    async load() {
      if (!this.services.length) return this._renderEmpty();
      this._renderLoading();
      // Parallel fetch — 1 detail.php per service. Server-side 60s cache
      // means switching between service sets is nearly free after warmup.
      const win = this.windowMin;
      const cluster = this.cluster;
      await Promise.all(this.services.map(async (s) => {
        try {
          const res = await API.servicePerformance.detail(s.name, '', { windowMin: win, cluster });
          if (res?.ok && res.data?.data?.found) {
            s.data = res.data.data;
            s.error = null;
          } else {
            s.error = res?.data?.data?.message || 'not found';
            s.data = null;
          }
        } catch (e) {
          s.error = e.message;
          s.data = null;
        }
      }));
      $('cmp-refresh-status').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
      this._renderCharts();
    },

    refresh() { this.load(); },

    _renderLoading() {
      $('cmp-content').innerHTML = `
        <div class="cmp-empty-state">
          <div class="icon"><i data-icon="refresh-cw" style="width:30px;height:30px;animation:spin 1s linear infinite"></i></div>
          <h2>กำลังโหลดข้อมูล...</h2>
          <p>Fetching ${this.services.length} service${this.services.length!==1?'s':''} · ${this.windowMin}m window</p>
        </div>
        <style>@keyframes spin { to { transform:rotate(360deg); } }</style>`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll($('cmp-content'));
    },

    _renderEmpty() {
      $('cmp-content').innerHTML = `
        <div class="cmp-empty-state">
          <div class="icon"><i data-icon="bar-chart" style="width:30px;height:30px"></i></div>
          <h2>ยังไม่มี service ให้เทียบ</h2>
          <p>พิมพ์ชื่อ service ในช่องด้านบน → กด Enter → เพิ่มได้สูงสุด 8 services<br>
          หรือเปิด link แบบ <code>compare.html?services=svc-a,svc-b</code></p>
        </div>`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll($('cmp-content'));
    },

    _renderCharts() {
      const anyOk = this.services.some(s => s.data);
      if (!anyOk) {
        const errs = this.services.map(s => `<b>${esc(s.name)}</b>: ${esc(s.error || 'no data')}`).join('<br>');
        $('cmp-content').innerHTML = `
          <div class="cmp-empty-state" style="color:var(--hot)">
            <div class="icon" style="background:color-mix(in srgb,var(--hot) 12%,transparent);color:var(--hot)"><i data-icon="alert-triangle" style="width:30px;height:30px"></i></div>
            <h2>โหลด service ทั้งหมดไม่สำเร็จ</h2>
            <p>${errs}</p>
          </div>`;
        if (window.Icons?.replaceAll) window.Icons.replaceAll($('cmp-content'));
        return;
      }

      // Render one chart per metric — each is a multi-line SVG with 1 line
      // per service.
      const chartsHtml = CHART_SPECS.map(spec => this._renderChart(spec)).join('');
      const rankHtml = this._renderRankTable();
      $('cmp-content').innerHTML = `
        <div class="cmp-grid">${chartsHtml}</div>
        ${rankHtml}`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll($('cmp-content'));
    },

    _renderChart(spec) {
      // Collect one series per service (that has data for this metric)
      const seriesList = this.services
        .map(s => ({ name: s.name, color: s.color, values: s.data ? spec.pick(s.data) : [] }))
        .filter(x => x.values.length >= 2);
      if (!seriesList.length) {
        return `<div class="cmp-chart-card">
          <div class="cmp-chart-title">
            <span class="lbl">${esc(spec.label)}</span>
          </div>
          <div class="cmp-chart-empty">ไม่มีข้อมูล metric นี้สำหรับ service ที่เลือก</div>
        </div>`;
      }
      // Global x + y extents across every service's timeline
      let xMin=Infinity, xMax=-Infinity, yMax=-Infinity, yMin=Infinity;
      for (const s of seriesList) for (const [x, y] of s.values) {
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y > yMax) yMax = y; if (y < yMin) yMin = y;
      }
      const W = 480, H = 180, PL = 52, PR = 12, PT = 12, PB = 22;
      const yRange = yMax - yMin;
      if (yRange <= 0) { yMin = Math.max(0, yMax * 0.9); yMax = yMax * 1.1 || 1; }
      else { const pad = yRange * 0.1; yMin = Math.max(0, yMin - pad); yMax = yMax + pad; }
      const sx = (x) => PL + ((x - xMin) / (xMax - xMin || 1)) * (W - PL - PR);
      const sy = (y) => H - PB - ((y - yMin) / (yMax - yMin || 1)) * (H - PT - PB);
      const fmtV = (v) => this._fmtVal(v, spec.unit);
      // Y-axis: 3 ticks + gridlines
      let yTicks = '';
      for (let i = 0; i <= 2; i++) {
        const yv = yMin + (yMax - yMin) * (i / 2);
        const yy = sy(yv);
        yTicks += `<line x1="${PL}" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
        yTicks += `<text x="${PL-6}" y="${yy}" font-size="9.5" fill="var(--sp-text-soft)" text-anchor="end" dominant-baseline="middle">${fmtV(yv)}</text>`;
      }
      // X-axis: 3 time ticks
      const fmtT = (ts) => new Date(ts*1000).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
      const xLabels = [xMin, (xMin+xMax)/2, xMax].map(x =>
        `<text x="${sx(x).toFixed(1)}" y="${H-6}" font-size="9.5" fill="var(--sp-text-soft)" text-anchor="middle">${fmtT(x)}</text>`
      ).join('');
      // One <path> per service
      const paths = seriesList.map(s => {
        const d = s.values.map((p, i) => (i?'L':'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.75" stroke-linejoin="round" opacity=".9"/>`;
      }).join('');
      // Legend below the chart
      const legend = seriesList.map(s => {
        const last = s.values[s.values.length-1]?.[1];
        return `<span class="item"><span class="dot" style="background:${s.color}"></span>${esc(s.name)} · <b style="color:${s.color}">${fmtV(last)}</b></span>`;
      }).join('');
      return `<div class="cmp-chart-card">
        <div class="cmp-chart-title">
          <span class="lbl">${esc(spec.label)}</span>
          <span class="hint">${seriesList.length} of ${this.services.length} services</span>
        </div>
        <div class="cmp-chart-body">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
            ${yTicks}
            ${paths}
            ${xLabels}
          </svg>
        </div>
        <div class="cmp-legend">${legend}</div>
      </div>`;
    },

    // Ranking table below charts — for each metric, which service has the
    // highest/lowest current value? Fast way to spot which service is
    // dragging the fleet up.
    _renderRankTable() {
      const rows = [];
      const fmt = (v, u) => v == null ? '—' : this._fmtVal(v, u);
      for (const spec of CHART_SPECS) {
        const vals = this.services
          .map(s => {
            const series = s.data ? spec.pick(s.data) : [];
            const last = series.length ? series[series.length-1][1] : null;
            return { name: s.name, color: s.color, last };
          })
          .filter(x => x.last != null);
        if (!vals.length) continue;
        vals.sort((a, b) => b.last - a.last);
        const top = vals[0], bot = vals[vals.length-1];
        // "Spread" = top / bot ratio → detects fleet skew
        const spread = bot.last > 0 ? (top.last / bot.last) : 1;
        const spreadCls = spread >= 3 ? 'hot' : spread >= 2 ? 'warn' : '';
        rows.push(`
          <tr>
            <td>${esc(spec.label)}</td>
            <td class="dot"><span class="col-dot" style="background:${top.color}"></span></td>
            <td class="svc">${esc(top.name)}</td>
            <td class="right">${esc(fmt(top.last, spec.unit))}</td>
            <td class="dot"><span class="col-dot" style="background:${bot.color}"></span></td>
            <td class="svc">${esc(bot.name)}</td>
            <td class="right">${esc(fmt(bot.last, spec.unit))}</td>
            <td class="right ${spreadCls}">${spread.toFixed(1)}×</td>
          </tr>`);
      }
      if (!rows.length) return '';
      return `<div class="cmp-rank">
        <h3>📊 Ranking · ค่าปัจจุบันของแต่ละ metric — เห็น service ที่กิน resource มากสุด vs น้อยสุด</h3>
        <table>
          <thead><tr>
            <th>Metric</th>
            <th colspan="3">🔥 Highest</th>
            <th colspan="3">🟢 Lowest</th>
            <th>Spread</th>
          </tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
    },

    _fmtVal(v, unit) {
      if (v == null || !isFinite(v)) return '—';
      if (unit === 'ms')    return v >= 1000 ? (v/1000).toFixed(2) + 's' : v.toFixed(0) + 'ms';
      if (unit === 'pct')   return v.toFixed(1) + '%';
      if (unit === 'bytes') return v >= 1e9 ? (v/1e9).toFixed(2) + 'GB' : (v/1e6).toFixed(0) + 'MB';
      if (unit === 'cores') return v >= 1 ? v.toFixed(2) + ' cores' : Math.round(v*1000) + 'm';
      if (unit === 'reqs')  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
      return v.toFixed(2);
    },
  };

  CMP.init();

})();
