/* ══════════════════════════════════════════════════
   skeletons.js  |  Centralize-SOM skeleton loading
   ══════════════════════════════════════════════════
   Guard so double-loading (e.g. page already has its own
   <script src="skeletons.js"> AND theme.js auto-injects)
   doesn't throw "Identifier 'Skeleton' has already been declared". */
if (typeof window.Skeleton !== 'undefined') {
  // Already loaded — re-run initAll in case new [data-skel]
  // elements exist that weren't there at first init.
  try { window.Skeleton.initAll && window.Skeleton.initAll(); } catch (_) {}
} else {

window.Skeleton = {

  /* ── Internal line / circle / block helpers ──────────────── */
  _ln(w = '100%', h = '10px', mt = '0') {
    return `<div class="skel" style="width:${w};height:${h};margin-top:${mt}"></div>`;
  },
  _ci(sz = '28px') {
    return `<div class="skel" style="width:${sz};height:${sz};border-radius:50%;flex-shrink:0"></div>`;
  },
  _bk(w = '100%', h = '40px', r = '8px') {
    return `<div class="skel" style="width:${w};height:${h};border-radius:${r}"></div>`;
  },

  /* ── Table skeleton ──────────────────────────────────────────
     Used by: admin/users, admin/templates, admin/logs,
              admin/jenkins-servers, admin/tools, admin/links,
              admin/trash, admin/board (posts table)
  ─────────────────────────────────────────────────────────── */
  table(rows = 6) {
    const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4','skel-fade-5','skel-fade-6'];
    let html = '<div class="skel-table-wrap">';
    for (let i = 0; i < rows; i++) {
      const f = fades[Math.min(i, fades.length - 1)];
      html += `
        <div class="skel-tr ${f}">
          ${this._ci('26px')}
          <div style="flex:2;min-width:0;display:flex;flex-direction:column;gap:5px">
            ${this._ln('72%', '10px')}
            ${this._ln('44%', '8px')}
          </div>
          <div style="flex:1.5;min-width:0">${this._ln('80%', '10px')}</div>
          <div style="flex:1;min-width:0">${this._ln('58%', '10px')}</div>
          <div style="flex:0.8;min-width:0">${this._ln('46%', '10px')}</div>
          ${this._bk('52px', '20px', '6px')}
        </div>`;
    }
    html += '</div>';
    return html;
  },

  /* ── Board cards skeleton ────────────────────────────────────
     Used by: board.html
  ─────────────────────────────────────────────────────────── */
  board(n = 4) {
    const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4','skel-fade-5'];
    let html = '<div class="skel-board-grid">';
    for (let i = 0; i < n; i++) {
      const f = fades[Math.min(i, fades.length - 1)];
      html += `
        <div class="skel-board-card ${f}">
          ${this._bk('100%', '108px', '0')}
          <div style="padding:13px 15px;flex:1;display:flex;flex-direction:column;gap:7px">
            ${this._ln('82%', '12px')}
            ${this._ln('58%', '10px')}
            <div style="display:flex;gap:6px;margin-top:2px">
              ${this._bk('50px', '18px', '20px')}
              ${this._bk('64px', '18px', '20px')}
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:auto">
              ${this._ci('18px')}
              ${this._ln('38%', '8px')}
              <div style="margin-left:auto">${this._ln('52px', '8px')}</div>
            </div>
          </div>
        </div>`;
    }
    html += '</div>';
    return html;
  },

  /* ── Activity feed skeleton ──────────────────────────────────
     Used by: dashboard.html #recent-feed
  ─────────────────────────────────────────────────────────── */
  feed(n = 7) {
    const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4','skel-fade-5','skel-fade-6'];
    let html = '<div style="padding:2px 0">';
    for (let i = 0; i < n; i++) {
      const f = fades[Math.min(i, fades.length - 1)];
      const titleW = [88, 75, 92, 68, 80, 85, 70][i % 7] + '%';
      const metaW  = [48, 55, 42, 60, 50, 45, 52][i % 7] + '%';
      html += `
        <div class="skel-feed-item ${f}">
          <div class="skel" style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:5px"></div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
            ${this._ln(titleW, '11px')}
            ${this._ln(metaW,  '9px')}
          </div>
        </div>`;
    }
    html += '</div>';
    return html;
  },

  /* ── Link-card grid skeleton ─────────────────────────────────
     Used by: monitoring.html, dashboard.html, ma-status.html,
              batch-monitor.html, and any grid of monitor cards.
     cols: number of columns (default: auto-fill with minmax 190px)
  ─────────────────────────────────────────────────────────── */
  cards(n = 6, cols) {
    const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4','skel-fade-5','skel-fade-6'];
    const gridStyle = cols
      ? `style="grid-template-columns:repeat(${parseInt(cols)}, minmax(0, 1fr))"`
      : '';
    let html = `<div class="skel-link-grid" ${gridStyle}>`;
    for (let i = 0; i < n; i++) {
      const f = fades[Math.min(i, fades.length - 1)];
      html += `
        <div class="skel-link-card ${f}">
          ${this._bk('44px', '44px', '12px')}
          <div style="margin-top:auto;padding-top:14px;display:flex;flex-direction:column;gap:6px">
            ${this._ln('68%', '12px')}
            ${this._ln('90%', '9px')}
          </div>
        </div>`;
    }
    html += '</div>';
    return html;
  },

  /* ── KPI strip skeleton ──────────────────────────────────────
     Row of stat boxes (number + label). Used for hero KPIs on
     dashboard, ma-status, ma-services, batch-monitor, analytics.
  ─────────────────────────────────────────────────────────── */
  kpis(n = 4) {
    const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4','skel-fade-5','skel-fade-6'];
    let html = '<div class="skel-kpi-strip">';
    for (let i = 0; i < n; i++) {
      const f = fades[Math.min(i, fades.length - 1)];
      html += `
        <div class="skel-kpi-box ${f}">
          ${this._ln('42%', '10px')}
          ${this._ln('72%', '22px', '10px')}
          ${this._ln('56%', '8px', '8px')}
        </div>`;
    }
    html += '</div>';
    return html;
  },

  /* ── Text block skeleton ─────────────────────────────────────
     Stacked text lines with varying widths — for paragraphs,
     descriptions, page intros.
  ─────────────────────────────────────────────────────────── */
  text(lines = 3) {
    const widths = ['96%', '88%', '92%', '80%', '85%', '72%', '90%'];
    let html = '<div class="skel-text-block">';
    for (let i = 0; i < lines; i++) {
      html += this._ln(widths[i % widths.length], '10px', i === 0 ? '0' : '9px');
    }
    html += '</div>';
    return html;
  },

  /* ── Chart placeholder skeleton ──────────────────────────────
     Rectangle with faux bars/axis lines. Used for analytics
     charts, dashboards, weekly-report.
  ─────────────────────────────────────────────────────────── */
  chart() {
    // Bars with random-ish heights for a "chart" feel
    const heights = [55, 78, 42, 88, 62, 71, 48, 82, 66, 58, 75, 45];
    let bars = '';
    for (let i = 0; i < heights.length; i++) {
      bars += `<div class="skel skel-chart-bar" style="height:${heights[i]}%"></div>`;
    }
    return `
      <div class="skel-chart-wrap">
        <div class="skel-chart-bars">${bars}</div>
        <div class="skel-chart-axis">
          ${this._ln('16%', '8px')}
          ${this._ln('16%', '8px')}
          ${this._ln('16%', '8px')}
          ${this._ln('16%', '8px')}
          ${this._ln('16%', '8px')}
        </div>
      </div>`;
  },

  /* ── Simple list rows ────────────────────────────────────────
     Used by: admin/board.html (categories, service types)
  ─────────────────────────────────────────────────────────── */
  list(n = 4) {
    const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4','skel-fade-5'];
    let html = '<div style="padding:4px 0;display:flex;flex-direction:column;gap:2px">';
    for (let i = 0; i < n; i++) {
      const f = fades[Math.min(i, fades.length - 1)];
      html += `
        <div class="${f}" style="display:flex;align-items:center;gap:12px;padding:9px 4px">
          ${this._bk('28px', '28px', '8px')}
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
            ${this._ln('62%', '10px')}
            ${this._ln('38%', '8px')}
          </div>
          ${this._bk('52px', '20px', '20px')}
        </div>`;
    }
    html += '</div>';
    return html;
  },

  /* ── Settings form skeleton ──────────────────────────────────
     Used by: admin/system-settings.html
  ─────────────────────────────────────────────────────────── */
  settings(n = 4) {
    const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4'];
    let html = '<div style="display:flex;flex-direction:column;gap:14px;padding:2px 0">';
    for (let i = 0; i < n; i++) {
      const f = fades[Math.min(i, fades.length - 1)];
      html += `
        <div class="skel-settings-card ${f}">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            ${this._bk('36px', '36px', '8px')}
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
              ${this._ln('38%', '12px')}
              ${this._ln('58%', '9px')}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${this._bk('100%', '34px', '7px')}
            ${this._bk('100%', '34px', '7px')}
          </div>
        </div>`;
    }
    html += '</div>';
    return html;
  },

  /* ── Chip row skeleton ───────────────────────────────────────
     Used by: admin/board.html #cat-chips
  ─────────────────────────────────────────────────────────── */
  chips(n = 5) {
    const ws = ['68px','84px','54px','76px','60px','72px'];
    let html = '<div style="display:flex;flex-wrap:wrap;gap:8px;padding:2px 0">';
    for (let i = 0; i < n; i++) {
      html += this._bk(ws[i % ws.length], '26px', '20px');
    }
    html += '</div>';
    return html;
  },

  /* ── Auto-init all [data-skel] elements on page ─────────────
     Each element declares:
       data-skel="type"      — table | board | feed | cards | list |
                               settings | chips | kpis | text | chart
       data-rows="N"         — legacy alias for count (table/list/etc.)
       data-count="N"        — item count for cards/kpis/list/etc.
       data-cols="N"         — columns for cards()
       data-lines="N"        — text() line count
     Elements marked with `data-skel-done` are skipped so re-running
     initAll() (after DOM inserts) doesn't clobber rendered content.
  ─────────────────────────────────────────────────────────── */
  initAll(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-skel]:not([data-skel-done])').forEach(el => {
      const type  = el.dataset.skel;
      const fn    = this[type];
      if (typeof fn !== 'function') return;
      const count = el.dataset.count ? parseInt(el.dataset.count)
                  : el.dataset.rows  ? parseInt(el.dataset.rows)
                  : el.dataset.lines ? parseInt(el.dataset.lines)
                  : undefined;
      const cols  = el.dataset.cols ? parseInt(el.dataset.cols) : undefined;
      // Dispatch arg shape per pattern
      let html;
      if (type === 'cards')      html = fn.call(this, count, cols);
      else if (type === 'chart') html = fn.call(this);
      else                       html = fn.call(this, count);
      el.innerHTML = html;
      el.setAttribute('data-skel-done', '');
    });
  }
};

// Auto-init: fire on DOMContentLoaded so skeletons.js can be loaded
// from <head> (e.g. injected by theme.js) OR at end of <body>.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.Skeleton.initAll());
} else {
  window.Skeleton.initAll();
}

} // end guard
