// monitoring — page script, extracted from monitoring.html.
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
  Layout.render('monitoring');
  trackMonitoringView('monitoring');

  let MONITORS    = [];
  let POLYWALL_URL = '';

  /* ── Section config ──────────────────────────────────── */
  const SECTION_META = {
    overview: { label: 'Service Overview',   live: true,  color: '#f59e0b' },
    monitor:  { label: 'Monitor Dashboards', live: true,  color: '#3b82f6' },
    polywall: { label: 'Polywall',           live: false, color: '#8b5cf6' },
    '':       { label: 'Other',              live: false, color: '#64748b' }
  };
  const SECTION_ORDER = ['overview', 'monitor', 'polywall', ''];

  /* ── Load monitors from API ──────────────────────────── */
  async function loadMonitors() {
    const res = await API.links.list('monitoring');
    const links = res?.ok ? (res.data.data || []) : [];

    // Group by subsection
    const grouped = {};
    links.forEach(l => {
      const key = l.subsection || '';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(l);
    });

    // Populate MONITORS for wall/polywall
    MONITORS = (grouped['monitor'] || []).map((l, i) => ({
      id:        i + 1,
      name:      l.name,
      desc:      l.description || '',
      url:       l.url,
      icon:      l.icon || '',
      open_mode: l.open_mode || 'iframe'
    }));

    POLYWALL_URL = (grouped['polywall'] || [])[0]?.url || '';

    // Compute stats
    const allLinks = links.filter(l => l.subsection !== 'polywall');
    const liveKeys = ['overview', 'monitor'];
    const liveCount = links.filter(l => liveKeys.includes(l.subsection || '')).length;
    const sectionsUsed = SECTION_ORDER.filter(k => grouped[k]?.length).length;

    document.getElementById('stat-total').textContent    = allLinks.length || '0';
    document.getElementById('stat-sections').textContent = sectionsUsed || '0';
    document.getElementById('stat-live').textContent     = liveCount || '0';

    // Render list sections
    const container = document.getElementById('monitor-sections');
    const sectionsHtml = SECTION_ORDER
      .filter(k => grouped[k]?.length)
      .map(k => {
        const meta  = SECTION_META[k] || { label: k, live: false, color: '#64748b' };
        const items = grouped[k];
        const isPolywall = k === 'polywall';

        const cards = items.map(l => {
          const actionType = l.open_mode === 'iframe' ? 'iframe' : 'newtab';
          const secLabel = meta.label;
          return `
            <div class="monitor-card" data-action="${actionType}" data-url="${escHtml(l.url)}" data-name="${escHtml(l.name)}" data-sec="${escHtml(k)}" data-search-text="${escHtml((l.name + ' ' + (l.description || '')).toLowerCase())}">
              <div class="mc-top">
                <div class="mc-icon-wrap">${renderIcon(l.icon, '<i data-icon="bar-chart-2"></i>')}</div>
                ${meta.live ? '<span class="mc-live-badge"><span class="dot"></span>LIVE</span>' : ''}
              </div>
              <div class="mc-body">
                <div class="mc-name">${escHtml(l.name)}</div>
                ${l.description ? `<div class="mc-desc">${escHtml(l.description)}</div>` : ''}
              </div>
              <div class="mc-footer">
                <span class="mc-section-chip">${escHtml(secLabel)}</span>
                <span class="mc-open-btn"><i data-icon="arrow-right"></i></span>
              </div>
            </div>`;
        }).join('');

        const gridStyle = isPolywall ? 'style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))"' : '';
        return `
          <div class="monitor-section">
            <div class="monitor-section-header">
              <span class="mon-sec-accent" style="background:${meta.color}"></span>
              <span class="mon-sec-label">${escHtml(meta.label)}</span>
              <span class="mon-sec-count">${items.length}</span>
              ${meta.live ? `<span class="mon-sec-live" style="background:color-mix(in srgb,${meta.color} 10%,transparent);color:${meta.color};border:1px solid color-mix(in srgb,${meta.color} 25%,transparent)"><span class="dot" style="background:${meta.color}"></span>LIVE</span>` : ''}
            </div>
            <div class="monitor-grid" ${gridStyle}>${cards}</div>
          </div>`;
      }).join('');

    container.innerHTML = sectionsHtml || `
      <div class="mon-empty">
        <i data-icon="monitor-off"></i>
        No monitors configured
      </div>`;

    // Re-run icon renderer after dynamic HTML
    if (window.Icons && Icons.render) Icons.render(container);
  }

  /* ── Filter / search ─────────────────────────────────── */
  function filterCards(q) {
    const term = q.toLowerCase().trim();
    const cards = document.querySelectorAll('.monitor-card');
    let visible = 0;
    cards.forEach(c => {
      const match = !term || c.dataset.searchText.includes(term) || c.dataset.name.toLowerCase().includes(term);
      c.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    // Hide/show empty sections
    document.querySelectorAll('.monitor-section').forEach(sec => {
      const hasVisible = [...sec.querySelectorAll('.monitor-card')].some(c => c.style.display !== 'none');
      sec.style.display = hasVisible ? '' : 'none';
    });
    const noRes = document.getElementById('mon-no-results');
    noRes.classList.toggle('visible', visible === 0 && !!term);
  }

  /* ── View toggle ──────────────────────────────────────── */
  async function setView(mode) {
    if (mode === 'polywall') {
      if (!POLYWALL_URL) { await SOMDialog.alert('Polywall URL not configured', { title: 'แจ้งเตือน', icon: 'info' }); return; }
      window.location.href = './viewer.html?src=' + encodeURIComponent(POLYWALL_URL) + '&title=Polywall';
      return;
    }
    const listEl = document.getElementById('list-view');
    const wallEl = document.getElementById('wall-view');
    const statBar = document.getElementById('mon-stat-bar');
    const btnList = document.getElementById('btn-list');
    const btnWall = document.getElementById('btn-wall');
    const zoomEl  = document.getElementById('wall-zoom');

    if (mode === 'wall') {
      renderWall();
      listEl.style.display = 'none';
      statBar.style.display = 'none';
      wallEl.classList.add('active');
      btnList.classList.remove('active');
      btnWall.classList.add('active');
      zoomEl.style.display = 'flex';
      zoomEl.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.res === WALL_RES);
      });
    } else {
      listEl.style.display = '';
      statBar.style.display = '';
      wallEl.classList.remove('active');
      btnList.classList.add('active');
      btnWall.classList.remove('active');
      zoomEl.style.display = 'none';
      document.getElementById('wall-grid').innerHTML = '';
    }
  }

  /* ── Wall renderer ───────────────────────────────────── */
  let WALL_RES = localStorage.getItem('som_wall_res') || 'fhd';
  const RES_MAP = { fhd: [1920, 1080], hd: [1280, 720] };

  const UNEMBEDDABLE_HOSTS = new Set([
    'app.datadoghq.com', 'app.datadoghq.eu',
    'datadoghq.com',     'datadoghq.eu',
  ]);
  const EMBEDDABLE_HOSTS = new Set([
    'p.datadoghq.com', 'p.datadoghq.eu',
  ]);
  function isUnembeddable(url, openMode) {
    if (openMode === 'newtab') return true;
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (EMBEDDABLE_HOSTS.has(host)) return false;
      return UNEMBEDDABLE_HOSTS.has(host);
    } catch { return false; }
  }

  function renderWall() {
    const grid = document.getElementById('wall-grid');
    const cells = [];
    for (let i = 0; i < 9; i++) {
      const m = MONITORS[i];
      if (!m) {
        cells.push(`<div class="wall-cell"><div class="wall-cell-head"><span class="wall-cell-name">— slot ${i+1}</span></div><div class="wall-cell-empty">No monitor configured</div></div>`);
        continue;
      }
      const head = `
        <div class="wall-cell-head">
          <span class="live-dot"></span>
          <span class="wall-cell-name">${escHtml(m.name)}</span>
          <div class="wall-cell-actions">
            <button class="wall-cell-expand" data-expand-url="${escHtml(m.url)}" data-expand-name="${escHtml(m.name)}" title="Expand"><i data-icon="maximize"></i></button>
            <a class="wall-cell-open" href="${escHtml(m.url)}" target="_blank" rel="noopener" title="Open in new tab"><i data-icon="external-link"></i></a>
          </div>
        </div>`;

      if (isUnembeddable(m.url, m.open_mode)) {
        let hostLabel = '';
        try { hostLabel = new URL(m.url).hostname; } catch {}
        cells.push(`
          <div class="wall-cell">
            ${head}
            <div class="wall-cell-fallback" data-url="${escHtml(m.url)}">
              <div class="wall-cell-fallback-icon">${renderIcon(m.icon, '<i data-icon="bar-chart-2"></i>')}</div>
              <div class="wall-cell-fallback-title">${escHtml(m.name)}</div>
              <div class="wall-cell-fallback-desc">${escHtml(m.desc || hostLabel || 'External dashboard — embed not allowed')}</div>
              <div class="wall-cell-fallback-btn">Open in new tab ↗</div>
            </div>
          </div>`);
        continue;
      }

      const proxied = rewriteForProxy(m.url);
      const isFit = WALL_RES === 'fit';
      const iframeStyle = isFit ? 'position:relative;width:100%;height:100%;transform:none;' : '';
      cells.push(`
        <div class="wall-cell">
          ${head}
          <div class="wall-cell-frame">
            <iframe src="${escHtml(proxied)}" allowfullscreen style="${iframeStyle}"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
          </div>
        </div>`);
    }
    grid.innerHTML = cells.join('');
    requestAnimationFrame(() => { applyWallScale(); attachWallObserver(); });
    if (window.Icons && Icons.render) Icons.render(grid);
  }

  function applyScaleToFrame(frame) {
    if (WALL_RES === 'fit') return;
    const [vw, vh] = RES_MAP[WALL_RES] || RES_MAP.fhd;
    const cw = frame.clientWidth, ch = frame.clientHeight;
    if (!cw || !ch) return;
    const scale = Math.max(cw / vw, ch / vh);
    frame.style.setProperty('--scale', scale);
    const iframe = frame.querySelector('iframe');
    if (iframe) { iframe.style.width = vw + 'px'; iframe.style.height = vh + 'px'; }
  }
  function applyWallScale() {
    document.querySelectorAll('#wall-grid .wall-cell-frame').forEach(applyScaleToFrame);
  }
  let _wallObserver = null;
  function attachWallObserver() {
    if (_wallObserver) _wallObserver.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    _wallObserver = new ResizeObserver(entries => { entries.forEach(e => applyScaleToFrame(e.target)); });
    document.querySelectorAll('#wall-grid .wall-cell-frame').forEach(f => _wallObserver.observe(f));
  }
  function setWallRes(res) {
    WALL_RES = res;
    localStorage.setItem('som_wall_res', res);
    document.querySelectorAll('.wall-zoom-toggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.res === res);
    });
    renderWall();
  }
  let _wallResizeT;
  window.addEventListener('resize', () => {
    if (!document.getElementById('wall-view').classList.contains('active')) return;
    clearTimeout(_wallResizeT);
    _wallResizeT = setTimeout(applyWallScale, 120);
  });

  document.getElementById('wall-grid').addEventListener('click', e => {
    const expand = e.target.closest('.wall-cell-expand');
    if (expand) { e.preventDefault(); openIframe(expand.dataset.expandUrl, expand.dataset.expandName); return; }
    const fb = e.target.closest('.wall-cell-fallback');
    if (fb) window.open(fb.dataset.url, '_blank', 'noopener');
  });

  /* ── Init ─────────────────────────────────────────────── */
  loadMonitors();

  /* ── Grafana proxy ───────────────────────────────────── */
  const GRAFANA_PROXY = {
    origin:   '',
    prefix:   '',
    upstream: 'https://grafana-thanos.truemoney.com',
  };
  function rewriteForProxy(url) {
    if (!url || !url.startsWith(GRAFANA_PROXY.upstream)) return url;
    const tail  = url.slice(GRAFANA_PROXY.upstream.length);
    const token = (typeof Auth !== 'undefined' && Auth.getToken) ? Auth.getToken() : null;
    const sep   = tail.includes('?') ? '&' : '?';
    const auth  = token ? `${sep}token=${encodeURIComponent(token)}` : '';
    return GRAFANA_PROXY.origin + GRAFANA_PROXY.prefix + tail + auth;
  }

  /* ── Iframe helpers ──────────────────────────────────── */
  function openIframe(url, name) {
    const proxied = rewriteForProxy(url);
    document.getElementById('iframe-title').textContent     = name;
    document.getElementById('iframe-url-label').textContent = url;
    document.getElementById('iframe-el').src               = proxied;
    document.getElementById('iframe-newtab-btn').onclick    = () => window.open(url, '_blank', 'noopener');
    document.getElementById('iframe-overlay').classList.add('open');
  }
  function closeIframe() {
    document.getElementById('iframe-overlay').classList.remove('open');
    document.getElementById('iframe-el').src = 'about:blank';
  }
  document.getElementById('iframe-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('iframe-overlay')) closeIframe();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeIframe(); });

  // Event delegation for monitor cards
  document.getElementById('monitor-sections').addEventListener('click', e => {
    const card = e.target.closest('[data-action]');
    if (!card) return;
    const url  = card.dataset.url;
    const name = card.dataset.name;
    if (card.dataset.action === 'newtab') window.open(url, '_blank', 'noopener');
    if (card.dataset.action === 'iframe') openIframe(url, name);
  });

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyScaleToFrame", { configurable: true, get: () => applyScaleToFrame, set: (v) => { applyScaleToFrame = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyWallScale", { configurable: true, get: () => applyWallScale, set: (v) => { applyWallScale = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "attachWallObserver", { configurable: true, get: () => attachWallObserver, set: (v) => { attachWallObserver = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeIframe", { configurable: true, get: () => closeIframe, set: (v) => { closeIframe = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterCards", { configurable: true, get: () => filterCards, set: (v) => { filterCards = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isUnembeddable", { configurable: true, get: () => isUnembeddable, set: (v) => { isUnembeddable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMonitors", { configurable: true, get: () => loadMonitors, set: (v) => { loadMonitors = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openIframe", { configurable: true, get: () => openIframe, set: (v) => { openIframe = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderWall", { configurable: true, get: () => renderWall, set: (v) => { renderWall = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rewriteForProxy", { configurable: true, get: () => rewriteForProxy, set: (v) => { rewriteForProxy = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setView", { configurable: true, get: () => setView, set: (v) => { setView = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setWallRes", { configurable: true, get: () => setWallRes, set: (v) => { setWallRes = v; } }); } catch (e) {}
})();
