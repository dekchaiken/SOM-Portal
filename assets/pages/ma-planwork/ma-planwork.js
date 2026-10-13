// ma-planwork — page script, extracted from ma-planwork.html.
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

  // Access gate: admin AND team === 'sm'. Kick anyone else to dashboard.
  (async function () {
    const u = Auth.getUser?.() || {};
    const isAdmin = ['super_admin', 'sm_admin', 'dev_sm'].includes(u.role);
    const isSm    = u.team === 'sm';
    if (!isAdmin || !isSm) {
      await SOMDialog.alert('This page is for SM team admins only.', { title: 'ไม่มีสิทธิ์เข้าถึง', icon: 'warning' });
      window.location.href = './ma-services.html';
    }
  })();

  const MAPlan = {
    data: null,
    search: '',
    inFlight: false,
    firstLoad: true,          // becomes false only after a successful fetch
    JIRA_BASE: 'https://truemoney.atlassian.net/browse/',

    // First load bypasses the server cache. Older cached responses (from before
    // the pipeline field was added) return empty items and would flash "no active
    // MA items" incorrectly. Force refresh guarantees a fresh payload with the
    // full schema.
    init() { this.refresh(true); },

    setSearch(q) {
      this.search = (q || '').toLowerCase().trim();
      if (this.data) this.render(this.data);
    },

    async _fetchOnce(userInitiated) {
      const y = new Date().getFullYear();
      const qs = `year=${y}${userInitiated ? '&refresh=1' : ''}`;
      const res = await API.get('/ma-services/jira-stats.php?' + qs);
      // API.get returns null on 401 (server rejected token) — surface a clear msg
      if (!res)    return { ok: false, error: 'Server rejected session — try logging out and back in' };
      if (!res.ok) return { ok: false, error: res.data?.message || `HTTP ${res.status || 'error'}` };
      return { ok: true, data: res.data.data || res.data };
    },

    async refresh(userInitiated) {
      if (this.inFlight) return;
      this.inFlight = true;
      const btn = document.getElementById('pw-refresh');
      btn.classList.add('spinning');
      try {
        let attempt = await this._fetchOnce(userInitiated);
        if (!attempt.ok) {
          // One silent retry — covers transient network hiccups (brief connection
          // drops, 5xx, slow Jira response) so the user doesn't hit the error
          // banner for a problem that clears itself on the next request.
          await new Promise(r => setTimeout(r, 600));
          attempt = await this._fetchOnce(userInitiated);
        }
        if (!attempt.ok) {
          // Persistent failure: if we already have data on screen, keep it —
          // don't blank the board just because a background refresh failed.
          if (this.data && !this.firstLoad) {
            Toast?.error?.(`Refresh failed: ${attempt.error}`);
            document.getElementById('pw-sub').textContent =
              `<i data-icon="alert-triangle"></i> Refresh failed — showing cached data · click Refresh to retry`;
          } else {
            this._showError(attempt.error);
          }
          return;
        }
        this.data = attempt.data;
        // Validate the payload carries the pipeline field. Old cached responses
        // from before the pipeline feature don't have it — treat as failure and
        // force a fresh fetch so the user doesn't see "no active MA items" on
        // stale data.
        if (this.data && !('pipeline' in this.data) && !userInitiated) {
          console.warn('[ma-planwork] response missing pipeline field, forcing refresh…');
          this.inFlight = false;
          btn.classList.remove('spinning');
          return this.refresh(true);
        }
        this.firstLoad = false;
        this.render(this.data);
      } catch (e) {
        console.error('[ma-planwork]', e);
        const msg = e?.message || 'Failed to load';
        if (this.data && !this.firstLoad) {
          Toast?.error?.(`Refresh failed: ${msg}`);
        } else {
          this._showError(msg);
        }
      } finally {
        this.inFlight = false;
        btn.classList.remove('spinning');
      }
    },

    _showError(msg) {
      document.getElementById('pw-board').innerHTML = `
        <div class="pw-error">
          <div class="ico"><i data-icon="alert-triangle"></i></div>
          <div class="pw-error-body">
            <div class="pw-error-title">Failed to load MA Planwork</div>
            <div class="pw-error-msg">${escHtml(msg)}</div>
            <div class="pw-error-msg" style="color:var(--text-muted);margin-bottom:12px">
              Common fixes: <b>logout &amp; login again</b> · check <code>data/logs/security.json</code> on server · verify <code>JWT_SECRET</code> in <code>.env</code> hasn't changed
            </div>
            <div class="pw-error-actions">
              <button onclick="MAPlan.refresh(true)">↻ Retry</button>
              <button class="secondary" onclick="location.reload()">Reload page</button>
            </div>
          </div>
        </div>`;
      document.getElementById('pw-sub').textContent = 'Failed to fetch — click Retry above';
    },

    render(d) {
      const pipeline = d.pipeline || { total: 0, todo: 0, inProgress: 0, items: [] };
      const items = pipeline.items || [];

      // KPIs
      const today = new Date(); today.setHours(0,0,0,0);
      const overdueCount = items.filter(it => it.due && new Date(it.due) < today).length;
      document.getElementById('pw-kpi-total').textContent   = pipeline.total ?? 0;
      document.getElementById('pw-kpi-backlog').textContent = pipeline.todo ?? 0;
      document.getElementById('pw-kpi-inprog').textContent  = pipeline.inProgress ?? 0;
      document.getElementById('pw-kpi-overdue').textContent = overdueCount;

      // Filter by search
      const q = this.search;
      const filtered = q
        ? items.filter(it =>
            (it.key || '').toLowerCase().includes(q) ||
            (it.summary || '').toLowerCase().includes(q) ||
            (it.owner || '').toLowerCase().includes(q) ||
            (it.description || '').toLowerCase().includes(q))
        : items;

      // Group by status name (Jira board columns feel natural like this)
      const groups = new Map();
      for (const it of filtered) {
        const key = it.status || '—';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }

      // Column ordering preference: In Progress ish first, then Backlog, then rest
      const order = (name) => {
        const n = (name || '').toLowerCase();
        if (n.includes('progress'))                return 1;
        if (n.includes('review'))                  return 2;
        if (n.includes('board') || n.includes('backlog') || n.includes('to do') || n.includes('open')) return 3;
        return 4;
      };
      const sortedCols = [...groups.entries()].sort((a,b) => order(a[0]) - order(b[0]));

      // Update sub-line + visible count
      document.getElementById('pw-visible-count').textContent =
        q ? `${filtered.length} / ${items.length} items` : `${items.length} items`;
      const when = new Date().toLocaleTimeString('th-TH', { hour12:false });
      document.getElementById('pw-sub').textContent =
        `Fetched ${when} · ${items.length} open items across ${groups.size} column(s)`;

      // Render board
      const board = document.getElementById('pw-board');
      if (!sortedCols.length) {
        // Only claim "no items" if we have a real answer from the server —
        // otherwise the user might see this flash during a slow first fetch.
        if (this.firstLoad || this.inFlight) {
          board.innerHTML = `
            <div class="pw-loading">
              <div class="spin"></div>
              <div class="txt">Fetching MA Planwork…</div>
              <div class="dots">Loading upcoming maintenance tickets from Jira</div>
            </div>`;
        } else if (q) {
          board.innerHTML = `
            <div class="pw-loading">
              <div class="txt">no matches for "${escHtml(q)}"</div>
              <div class="dots">try clearing the search box above</div>
            </div>`;
        } else {
          board.innerHTML = `
            <div class="pw-loading">
              <div style="font-size:36px"><i data-icon="check-circle"></i></div>
              <div class="txt">No active MA items right now</div>
              <div class="dots">Nothing scheduled in Jira · click Refresh to check again</div>
            </div>`;
        }
        return;
      }
      board.innerHTML = sortedCols.map(([name, list]) => this.renderCol(name, list)).join('');
    },

    renderCol(name, list) {
      const swatch = this.colorFor(name);
      return `
        <div class="pw-col">
          <div class="pw-col-head">
            <span class="pw-col-title">
              <span class="swatch" style="background:${swatch}"></span>${escHtml(name)}
            </span>
            <span class="pw-col-count">${list.length}</span>
          </div>
          ${list.length
            ? list.map(it => this.renderCard(it, name)).join('')
            : '<div class="pw-col-empty">no items</div>'}
        </div>`;
    },

    renderCard(it, colName) {
      const colClass = this.colorClassFor(colName);
      const initials = (it.owner || '?').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase() || '?';
      const prio = (it.priority || '').toLowerCase();
      const prioCls = prio.includes('high') || prio.includes('crit') || prio.includes('block') ? 'high'
                    : prio.includes('med') ? 'medium'
                    : prio ? 'low' : '';
      // Date badge state
      const today = new Date(); today.setHours(0,0,0,0);
      const dateShown = it.due || it.created || '';
      let dateCls = '';
      if (it.due) {
        const d = new Date(it.due);
        const diff = Math.floor((d - today) / 86400000);
        if (diff < 0)  dateCls = 'overdue';
        else if (diff <= 3) dateCls = 'soon';
      }
      const dateLabel = it.due ? `due ${dateShown}` : `created ${dateShown}`;
      const jiraUrl = this.JIRA_BASE + encodeURIComponent(it.key);

      // ── Meta rows (Key details block) ───────────────────
      const metaRows = [];
      const row = (label, val, opts) => {
        if (val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length)) {
          if (!opts?.alwaysShow) return;
          val = 'None';
        }
        metaRows.push([label, val, opts]);
      };
      row('Reporter',      it.reporter);
      row('Reference',     it.reference);
      row('MOP link',      it.mopLink ? `<a href="${escAttr(it.mopLink)}" target="_blank" rel="noopener">${escHtml(it.mopLink.length > 46 ? it.mopLink.slice(0,43)+'…' : it.mopLink)}</a>` : null, { html: true });
      row('Start',         it.startAt);
      row('End',           it.endAt);
      if (it.reviewers && it.reviewers.length) {
        row('Manager Review', it.reviewers.map(n => `<span class="reviewer">${escHtml(n)}</span>`).join(''), { html: true });
      }
      row('Toggle Features', it.toggle1);
      row('Toggle Features.', it.toggle2);
      row('Main Type',     it.mainType);

      const metaHtml = metaRows.length
        ? `<dl class="pw-card-meta">${metaRows.map(([l, v, opts]) =>
            `<dt>${escHtml(l)}</dt><dd${(v==='None')?' class="dim"':''}>${opts?.html ? v : escHtml(v)}</dd>`
          ).join('')}</dl>`
        : '';

      // ── MA Messages (TH / EN) ─────────────────────────────
      const msgs = [];
      if (it.maMsgTh) msgs.push(`<div class="pw-card-msg-block"><span class="lbl">MA Message (TH)</span>${escHtml(it.maMsgTh)}</div>`);
      if (it.maMsgEn) msgs.push(`<div class="pw-card-msg-block"><span class="lbl">MA Message (EN)</span>${escHtml(it.maMsgEn)}</div>`);
      const msgsHtml = msgs.length ? `<div class="pw-card-msg">${msgs.join('')}</div>` : '';

      return `
        <div class="pw-card ${colClass}">
          <div class="pw-card-head">
            <span class="pw-card-key">
              <a href="${jiraUrl}" target="_blank" rel="noopener" title="Open ${escAttr(it.key)} in Jira">${escHtml(it.key)}</a>
              ${it.priority ? `<span class="prio ${prioCls}">${escHtml(it.priority)}</span>` : ''}
            </span>
            <span class="pw-card-date ${dateCls}">${escHtml(dateLabel)}</span>
          </div>
          <div class="pw-card-title">${escHtml(it.summary || '(no title)')}</div>
          ${it.description ? `<div class="pw-card-desc${(it.description || '').length > 1500 ? ' is-huge' : ''}">${escHtml(it.description)}</div>` : ''}
          ${metaHtml}
          ${msgsHtml}
          <div class="pw-card-foot">
            <span class="pw-card-owner"><span class="avatar">${escHtml(initials)}</span>${escHtml(it.owner || '')}</span>
            <a class="pw-card-jira" href="${jiraUrl}" target="_blank" rel="noopener" title="Open in Jira">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
              open
            </a>
          </div>
        </div>`;
    },

    colorFor(name) {
      const n = (name || '').toLowerCase();
      if (n.includes('progress')) return '#f59e0b';
      if (n.includes('review'))   return '#3b82f6';
      if (n.includes('board') || n.includes('backlog') || n.includes('to do')) return '#a855f7';
      return '#94a3b8';
    },
    colorClassFor(name) {
      const n = (name || '').toLowerCase();
      if (n.includes('progress')) return 'color-inprog';
      if (n.includes('review'))   return 'color-open';
      if (n.includes('board'))    return 'color-jira';
      return 'color-backlog';
    },
  };

  function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escAttr(s) { return escHtml(s); }

  MAPlan.init();
  window.MAPlan = MAPlan;

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "escAttr", { configurable: true, get: () => escAttr, set: (v) => { escAttr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
})();
