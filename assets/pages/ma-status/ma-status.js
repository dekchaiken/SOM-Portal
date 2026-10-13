// ma-status — page script, extracted from ma-status.html.
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
  Layout.render('ma-services');

  // Reveal Admin link only for admin roles
  (function () {
    const u = Auth.getUser?.();
    const adminRoles = ['super_admin', 'sm_admin', 'dev_sm'];
    if (u && adminRoles.includes(u.role)) {
      const link = document.getElementById('mst-admin-link');
      if (link) link.style.display = 'inline-flex';
    }
  })();

  const MAStatus = {
    autoOn: true,
    autoIntervalMs: 30000,
    autoTimer: null,
    filter: 'all',
    view: 'all',                 // all | nano | jenkins | admin
    search: '',
    data: null,
    inFlight: false,

    VALID_VIEWS: ['all', 'nano', 'jenkins', 'features', 'admin'],

    init() {
      // Mark KPI values as loading until first fetch completes
      document.querySelectorAll('.mst-kpi-value').forEach(el => el.classList.add('is-loading'));
      // Hash routing — pick view from URL hash
      this._applyHash();
      window.addEventListener('hashchange', () => this._applyHash());
      this.refresh(false);
      this.startAuto();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stopAuto();
        else if (this.autoOn) { this.startAuto(); this.refresh(false); }
      });
    },

    _applyHash() {
      const h = (location.hash || '#all').replace('#', '').toLowerCase();
      const v = this.VALID_VIEWS.includes(h) ? h : 'all';
      if (v !== this.view) {
        this.view = v;
        if (this.data) this.render(this.data);
      }
      // Reflect active tab (always sync, even on first load)
      document.querySelectorAll('.mst-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.view === this.view);
      });
    },

    switchView(v, ev) {
      if (ev) ev.preventDefault();
      if (!this.VALID_VIEWS.includes(v)) v = 'all';
      if (v === this.view) return;              // no-op if same tab clicked
      history.replaceState(null, '', '#' + v);  // update URL bar
      // _applyHash compares hash to current this.view → detects change → renders
      this._applyHash();
    },

    setSearch(q) {
      this.search = (q || '').toLowerCase().trim();
      const input = document.getElementById('mst-search-input');
      if (input && input.value !== q) input.value = q;
      const wrap = input && input.closest('.mst-search');
      if (wrap) wrap.classList.toggle('has-value', !!this.search);
      if (this.data) this.render(this.data);
    },

    startAuto() {
      this.stopAuto();
      this.autoTimer = setInterval(() => {
        if (!document.hidden) this.refresh(false);
      }, this.autoIntervalMs);
    },
    stopAuto() { if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; } },

    toggleAuto() {
      this.autoOn = !this.autoOn;
      const btn = document.getElementById('mst-auto');
      const lbl = document.getElementById('mst-auto-lbl');
      if (this.autoOn) {
        btn.classList.remove('off'); lbl.textContent = 'Auto 30s';
        this.startAuto();
      } else {
        btn.classList.add('off'); lbl.textContent = 'Paused';
        this.stopAuto();
      }
    },

    setFilter(f) {
      this.filter = f;
      document.querySelectorAll('.mst-filter').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === f);
      });
      if (this.data) this.render(this.data);
    },

    async refresh(userInitiated) {
      if (this.inFlight) return;
      this.inFlight = true;
      const btn = document.getElementById('mst-refresh');
      if (btn) btn.classList.add('spinning');

      // Fetch with a 12s hard timeout so a hung request doesn't leave the page
      // stuck on the loading state forever.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('timeout'), 12000);
      const url = userInitiated ? '/ma-status/?refresh=1' : '/ma-status/';

      try {
        const token = Auth.getToken?.();
        const headers = { 'Accept': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        // Also send the admin-team header so super_admin's team context is respected
        const adminTeam = API.getAdminTeam?.();
        if (adminTeam) headers['X-Admin-Team'] = adminTeam;

        const resp = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : '/api') + url, {
          method: 'GET', headers, signal: controller.signal, credentials: 'same-origin',
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.json();
        if (!body.success) throw new Error(body.message || 'API error');

        this.data = body.data || body;
        this._retryCount = 0;
        this._markReady();
        this.render(this.data);
      } catch (e) {
        console.error('[ma-status] fetch failed:', e);
        const msg = (e && e.name === 'AbortError') ? 'Request timed out (>12s)' : (e?.message || String(e));

        // Auto-retry once on background refresh (silent), max 2 attempts total
        if (!userInitiated && (this._retryCount || 0) < 1) {
          this._retryCount = (this._retryCount || 0) + 1;
          console.log('[ma-status] auto-retry', this._retryCount);
          setTimeout(() => this.refresh(true), 800);
          return;
        }
        this._retryCount = 0;

        // Show error UI. If we never loaded successfully, keep content hidden.
        this._showError(msg);
      } finally {
        clearTimeout(timer);
        this.inFlight = false;
        if (btn) btn.classList.remove('spinning');
      }
    },

    _markReady() {
      const err = document.getElementById('mst-error');
      if (err) err.style.display = 'none';
      // Remove loading pulse from KPI values
      document.querySelectorAll('.mst-kpi-value').forEach(el => el.classList.remove('is-loading'));
    },

    _showError(msg) {
      const err  = document.getElementById('mst-error');
      const emsg = document.getElementById('mst-error-msg');
      if (err)  err.style.display = '';
      if (emsg) emsg.textContent  = msg;
      // Remove loading pulse — show dashes as-is with error banner above
      document.querySelectorAll('.mst-kpi-value').forEach(el => el.classList.remove('is-loading'));
    },

    render(data) {
      const s = data.summary || {};

      // KPI
      document.querySelector('#kpi-open .mst-kpi-value').textContent = s.open ?? 0;
      document.querySelector('#kpi-closed .mst-kpi-value').textContent = s.closed ?? 0;
      document.querySelector('#kpi-unknown .mst-kpi-value').textContent = s.unknown ?? 0;
      document.querySelector('#kpi-total .mst-kpi-value').textContent = s.matched ?? 0;
      document.getElementById('kpi-matched-num').textContent = s.matched ?? 0;
      document.getElementById('kpi-total-num').textContent = s.total ?? 0;
      document.getElementById('kpi-closed-hint').innerHTML = (s.closed > 0) ? `<i data-icon="alert-triangle"></i> ${s.closed} services need attention` : 'all clear <i data-icon="check"></i>';

      // Hero — color the left rail + status pill based on whether anything is closed
      const hero = document.getElementById('mst-hero');
      const heroTxt = document.getElementById('mst-hero-status-txt');
      if (s.closed > 0) {
        hero.classList.add('has-closed');
        heroTxt.textContent = `${s.closed} SERVICES IN MAINTENANCE`;
      } else {
        hero.classList.remove('has-closed');
        heroTxt.textContent = 'ALL SYSTEMS OPERATIONAL';
      }

      // Sub-line
      const ageSec = data.cached ? (data.cache_age || 0) : 0;
      const when = new Date((data.fetched_at || Date.now()/1000) * 1000).toLocaleTimeString('th-TH', { hour12:false });
      document.getElementById('mst-sub').textContent =
        `Last fetched ${when}${ageSec ? ` · cached ${ageSec}s ago` : ''} · auto-refresh every 30s`;

      // Source chips
      const chips = [];
      for (const [k, v] of Object.entries(s.per_source || {})) {
        const ok = v.ok !== false && !v.error;
        chips.push(`<span class="src-chip${ok?'':' err'}"><span class="dot"></span>${escHtml(k)}: ${v.count ?? 0}</span>`);
      }
      document.getElementById('mst-src-chips').innerHTML = chips.join('');

      // Build data pools
      const nanoAll     = data.sources?.nano?.items          || [];
      const jenkinsAll  = data.sources?.tmn_jenkins?.items   || [];
      const featuresAll = data.sources?.tmn_features?.items  || [];
      const boMatchedAll = (data.services || []).filter(r => r.source === 'tmn_backoffice');
      const criticalsAll = jenkinsAll.filter(it => it.critical);

      // Search filter (case-insensitive substring match on title/label)
      const q = this.search;
      const matchesSearch = (title) => !q || String(title || '').toLowerCase().includes(q);

      // Tab counts (based on source-only, ignoring status filter + search — so user
      // can see how many exist in each tab regardless of what filter is active)
      document.getElementById('tc-all').textContent      = nanoAll.length + jenkinsAll.length + featuresAll.length + boMatchedAll.length;
      document.getElementById('tc-nano').textContent     = nanoAll.length;
      document.getElementById('tc-jenkins').textContent  = jenkinsAll.length;
      document.getElementById('tc-features').textContent = featuresAll.length;
      document.getElementById('tc-admin').textContent    = boMatchedAll.length;

      // Status-filter counts (based on CURRENT tab's pool — so numbers make sense)
      let poolForCounts;
      if (this.view === 'nano')          poolForCounts = nanoAll;
      else if (this.view === 'jenkins')  poolForCounts = jenkinsAll;
      else if (this.view === 'features') poolForCounts = featuresAll;
      else if (this.view === 'admin')    poolForCounts = boMatchedAll;
      else                               poolForCounts = [...nanoAll, ...jenkinsAll, ...featuresAll, ...boMatchedAll];
      document.getElementById('fc-all').textContent    = poolForCounts.length;
      document.getElementById('fc-open').textContent   = poolForCounts.filter(x=>x.status==='open').length;
      document.getElementById('fc-closed').textContent = poolForCounts.filter(x=>x.status==='closed').length;
      document.getElementById('fc-crit').textContent   = poolForCounts.filter(x=>x.critical).length;

      const passesStatus = (x) => {
        if (this.filter === 'all')      return true;
        if (this.filter === 'critical') return !!x.critical;
        return (x.status || 'unknown') === this.filter;
      };
      const passesAll = (x, title) => passesStatus(x) && matchesSearch(title);

      // Section visibility by view + filter
      const showAll        = this.view === 'all';
      const isCritFilter   = this.filter === 'critical';
      // Only sources that CAN contain critical items are shown when critical filter is on.
      // Currently only Jenkins items have the `critical` flag.
      const showNano     = (showAll || this.view === 'nano')     && !isCritFilter;
      const showJenkins  = (showAll || this.view === 'jenkins')  || isCritFilter;
      const showFeatures = (showAll || this.view === 'features') && !isCritFilter;
      const showBo       = (showAll || this.view === 'admin')    && !isCritFilter;
      // Critical section = dedicated grid, only shown in "All" view when NOT already
      // filtering by critical (would duplicate the Jenkins section).
      const showCritical = showAll && !isCritFilter && criticalsAll.length > 0;
      // Discovery only when looking at Admin Portal (or All) and NOT filtering by
      // critical/closed (backoffice items don't have critical flag).
      const showDisc = (showAll || this.view === 'admin') && !isCritFilter;

      document.getElementById('sec-nano').style.display     = showNano     ? '' : 'none';
      document.getElementById('sec-jenkins').style.display  = showJenkins  ? '' : 'none';
      document.getElementById('sec-features').style.display = showFeatures ? '' : 'none';
      document.getElementById('sec-bo').style.display       = showBo       ? '' : 'none';
      document.getElementById('sec-critical').style.display = showCritical ? '' : 'none';
      document.getElementById('sec-disc').style.display     = showDisc     ? '' : 'none';

      // Critical section (only when showAll)
      if (showCritical) {
        const critShow = criticalsAll.filter(it => passesAll(it, it.label));
        document.getElementById('cnt-critical').textContent = critShow.length;
        document.getElementById('grid-critical').innerHTML = critShow.length
          ? critShow.map(it => this.monCard({
              title: it.label, status: it.status, critical: true,
              sub: `Build #${it.build_number ?? '?'} · state=${it.state_value ?? '—'}`,
              by: it.triggered_by || null, at: it.updated_at || null,
              link: it.link, when: it.updated_at ? tsToStr(it.updated_at) : null,
              tag: 'JENKINS',
            })).join('')
          : emptyMsg('no matches');
      }

      // NANO
      if (showNano) {
        const nanoShow = nanoAll.filter(it => passesAll(it, it.label) && this.filter !== 'critical');
        document.getElementById('cnt-nano').textContent = nanoShow.length;
        document.getElementById('grid-nano').innerHTML = nanoShow.length
          ? nanoShow.map(it => this.monCard({
              title: it.label, status: it.status,
              sub: `${escHtml(it.product)} · ${escHtml(it.sub_service)}`,
              by: it.triggered_by || null, at: it.triggered_at || null,
              link: it.link, tag: 'CDN',
            })).join('')
          : emptyMsg(q ? `no matches for "${q}"` : 'no items match filter');
        const nSrc = data.sources?.nano || {};
        document.getElementById('meta-nano').innerHTML = nSrc.ok
          ? escHtml(`${nanoAll.length} sub-services · fetched ${tsRel(nSrc.fetched_at)}`)
          : `<i data-icon="alert-triangle"></i> ${escHtml(nSrc.error || 'no data')}`;
      }

      // Jenkins
      if (showJenkins) {
        const jShow = jenkinsAll.filter(it => passesAll(it, it.label) && (this.filter !== 'critical' || it.critical));
        document.getElementById('cnt-jenkins').textContent = jShow.length;
        document.getElementById('grid-jenkins').innerHTML = jShow.length
          ? jShow.map(it => this.monCard({
              title: it.label, status: it.status, critical: !!it.critical,
              sub: `Build #${it.build_number ?? '?'} · state=${it.state_value ?? '—'}`,
              by: it.triggered_by || null, at: it.updated_at || null,
              link: it.link, when: it.updated_at ? tsToStr(it.updated_at) : null,
              tag: 'JENKINS',
            })).join('')
          : emptyMsg(q ? `no matches for "${q}"` : 'no jobs match filter');
        const jSrc = data.sources?.tmn_jenkins || {};
        document.getElementById('meta-jenkins').innerHTML = jSrc.ok
          ? escHtml(`${jenkinsAll.length} jobs · fetched ${tsRel(jSrc.fetched_at)}`)
          : `<i data-icon="alert-triangle"></i> ${escHtml(jSrc.error || 'no data')}`;
      }

      // Feature toggles (mobile-gateway)
      if (showFeatures) {
        const fShow = featuresAll.filter(it => passesAll(it, it.label));
        document.getElementById('cnt-features').textContent = fShow.length;
        document.getElementById('grid-features').innerHTML = fShow.length
          ? fShow.map(it => this.monCard({
              title: it.label, status: it.status,
              sub: `${escHtml(it.method || 'ANY')} · ${escHtml(it.url_pattern || '')}`,
              by: it.triggered_by || null, at: it.triggered_at || null,
              link: it.link, tag: it.error_code || 'FEATURE',
            })).join('')
          : emptyMsg(q ? `no matches for "${q}"` : 'no features match filter');
        const fSrc = data.sources?.tmn_features || {};
        document.getElementById('meta-features').innerHTML = fSrc.ok
          ? escHtml(`${featuresAll.length} features · fetched ${tsRel(fSrc.fetched_at)}`)
          : `<i data-icon="alert-triangle"></i> ${escHtml(fSrc.error || 'no data')}`;
      }

      // Backoffice matched
      if (showBo) {
        const boShow = boMatchedAll.filter(r => passesAll({ status: r.status, critical: false }, r.service_name));
        document.getElementById('cnt-bo').textContent = boShow.length;
        document.getElementById('grid-bo').innerHTML = boShow.length
          ? boShow.map(r => this.monCard({
              title: r.service_name, status: r.status,
              sub: `${escHtml(r.tool_type || '')} · ${escHtml(r.upstream_ref || '')}`,
              link: r.link, when: r.updated_at || null,
              tag: r.service_type || 'ADMIN',
            })).join('')
          : emptyMsg(q ? `no matches for "${q}"` : 'no services match filter');
        const bSrc = data.sources?.tmn_backoffice || {};
        document.getElementById('meta-bo').innerHTML = bSrc.ok
          ? escHtml(`${boMatchedAll.length} matched of ${bSrc.total_upstream ?? '?'} upstream · fetched ${tsRel(bSrc.fetched_at)}`)
          : `<i data-icon="alert-triangle"></i> ${escHtml(bSrc.error || 'no data')}`;
      }

      // Discovery — respect search too. Filter to type='use_case' only —
      // 'client'-level rows are aggregate handles that SM doesn't manage individually.
      const unmappedAll = (data.unmapped_backoffice || []).filter(it => (it.category || '') === 'use_case');
      const unmapped = q
        ? unmappedAll.filter(it => matchesSearch(it.label) || String(it.use_case_id || '').includes(q))
        : unmappedAll;
      document.getElementById('cnt-disc').textContent = `${unmapped.length}${q && unmapped.length !== unmappedAll.length ? ' / ' + unmappedAll.length : ''}`;
      if (unmapped.length) {
        const rows = unmapped.slice(0, 300).map(it => `
          <tr>
            <td class="id">${it.use_case_id ?? '—'}</td>
            <td>${escHtml(it.label || '')}</td>
            <td><span class="mst-tag">${escHtml(it.category || '')}</span></td>
            <td><span class="mst-mon-status ${it.status}">${(it.status||'').toUpperCase()}</span></td>
            <td style="color:var(--text-muted);font-size:10.5px">${escHtml(it.updated_at || '')}</td>
          </tr>`).join('');
        document.getElementById('disc-body').innerHTML = `
          <div style="padding:8px 0 4px;font-size:11px;color:var(--text-muted)">
            Showing ${Math.min(unmapped.length, 300)} of ${unmapped.length}. To link a row to ma-services, add
            <code style="padding:1px 5px;background:var(--bg);border-radius:3px;font-size:10.5px">"backoffice_use_case_id": &lt;id&gt;</code> to the service entry.
          </div>
          <table class="mst-disc-tbl">
            <thead><tr>
              <th style="width:90px">USE CASE ID</th><th>NAME</th>
              <th style="width:100px">TYPE</th><th style="width:90px">STATUS</th><th style="width:180px">UPDATED</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      } else {
        document.getElementById('disc-body').innerHTML = emptyMsg('nothing to discover');
      }
    },

    // ── Monitor card ─────────────────────────────────────────────
    monCard({ title, status, sub, link, when, critical, tag, by, at }) {
      const st = status || 'unknown';
      const cardCls = ['mst-mon', st, critical ? 'critical' : ''].join(' ').trim();
      const atStr = at ? fmtTsShort(at) : '';
      const byHtml = by ? `<div class="mst-mon-by"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escHtml(by)}${atStr ? `<span style="opacity:.55;margin-left:3px">· ${escHtml(atStr)}</span>` : ''}</div>` : '';
      return `
        <div class="${cardCls}">
          <div class="mst-mon-head">
            <div class="mst-mon-dot ${st}"></div>
            <div class="mst-mon-title-wrap">
              <div class="mst-mon-title">${escHtml(title || '—')}</div>
              ${sub ? `<div class="mst-mon-sub">${sub}</div>` : ''}
              ${byHtml}
            </div>
            ${critical ? '<div class="mst-mon-crit">CRIT</div>' : ''}
          </div>
          <div class="mst-mon-status ${st}">
            <span>${labelOfStatus(st)}</span>
            ${when ? `<span class="mst-mon-when">${escHtml(when)}</span>` : ''}
          </div>
          <div class="mst-mon-foot">
            <span class="mst-tag">${escHtml(tag || 'SVC')}</span>
            ${link ? `<a href="${escAttr(link)}" target="_blank" rel="noopener">open ↗</a>` : ''}
          </div>
        </div>`;
    },
  };

  // ── Helpers ──────────────────────────────────────────────────────
  function labelOfStatus(s) {
    if (s === 'open')    return 'Operational';
    if (s === 'closed')  return 'Maintenance';
    return 'Unknown';
  }
  function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escAttr(s) { return escHtml(s); }
  function tsToStr(ts) {
    if (!ts) return '';
    if (typeof ts === 'string') return ts;
    return new Date(ts * 1000).toLocaleString('th-TH', { hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  function tsRel(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor(Date.now()/1000 - ts));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    return Math.floor(s/3600) + 'h ago';
  }
  function emptyMsg(msg) { return `<div class="mst-empty">${escHtml(msg)}</div>`; }
  function fmtTsShort(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const now = new Date();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return d.toDateString() === now.toDateString()
      ? `${hh}:${mi}`
      : `${dd}/${mm} ${hh}:${mi}`;
  }

  MAStatus.init();
  window.MAStatus = MAStatus;

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "emptyMsg", { configurable: true, get: () => emptyMsg, set: (v) => { emptyMsg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escAttr", { configurable: true, get: () => escAttr, set: (v) => { escAttr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTsShort", { configurable: true, get: () => fmtTsShort, set: (v) => { fmtTsShort = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "labelOfStatus", { configurable: true, get: () => labelOfStatus, set: (v) => { labelOfStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tsRel", { configurable: true, get: () => tsRel, set: (v) => { tsRel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tsToStr", { configurable: true, get: () => tsToStr, set: (v) => { tsToStr = v; } }); } catch (e) {}
})();
