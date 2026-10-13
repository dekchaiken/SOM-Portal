/* ══════════════════════════════════════════════════════════════════════════
   ma-services-stats.js
   ──────────────────────────────────────────────────────────────────────────
   Renders the yearly MA overview block at the top of ma-services.html.
   Shows:
     • Total closed MA tickets in the calendar year
     • TrueMoney vs Nano breakdown (from linked TJCR customfield_16681)
     • Monthly trend (single bar per month)

   Data source: GET /api/ma-services/jira-stats.php?year=YYYY
     • Cache <2 min served instantly; older → fetches fresh
     • Refresh button forces a fresh fetch (?refresh=1)
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  const TMN_COLOR  = '#F26419';
  const NANO_COLOR = '#6366f1';
  const OTHER_COLOR = '#94a3b8';

  function populateYears(selectedYear) {
    const sel = $('ma-stats-year');
    if (!sel) return;
    const now = new Date().getFullYear();
    const years = [];
    for (let y = now; y >= now - 3; y--) years.push(y);
    sel.innerHTML = years.map(y =>
      `<option value="${y}"${y === selectedYear ? ' selected' : ''}>${y}</option>`
    ).join('');
  }

  const fmtNum = (n) => (n ?? 0).toLocaleString('en-US');

  function setLoading(loading) {
    ['ma-stat-total', 'ma-stat-tmn', 'ma-stat-nano'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle('loading', loading);
      if (loading) el.textContent = '—';
    });
    const btn = $('ma-stats-refresh');
    if (btn) btn.classList.toggle('spinning', loading);
  }

  function renderError(msg) {
    setLoading(false);
    const total = $('ma-stat-total');
    if (total) { total.textContent = '—'; total.classList.remove('loading'); }
    const meta = $('ma-stat-total-meta');
    if (meta) meta.textContent = '⚠ ' + (msg || 'failed to load');
    $('ma-monthly-card')?.style && ($('ma-monthly-card').style.display = 'none');
    $('ma-domain-card')?.style  && ($('ma-domain-card').style.display  = 'none');
  }

  function renderStats(d) {
    setLoading(false);
    if (!d) return renderError('no data');

    $('ma-stats-year-badge').textContent = d.year;

    // Number cards
    $('ma-stat-total').textContent = fmtNum(d.total);
    $('ma-stat-tmn').textContent   = fmtNum(d.tmn?.count);
    $('ma-stat-nano').textContent  = fmtNum(d.nano?.count);

    // Active pipeline (upcoming / in-progress MAs — see backend jira-stats.php)
    if (window.MAPipeline?.render) window.MAPipeline.render(d.pipeline || null);

    const rangeTxt = d.range ? `${d.range.start} → ${d.range.end}` : `${d.year}`;
    $('ma-stat-total-meta').textContent = `tickets · ${rangeTxt}`;
    $('ma-stat-tmn-meta').textContent   = `${d.tmn?.percent ?? 0}% of total`;
    $('ma-stat-nano-meta').textContent  = `${d.nano?.percent ?? 0}% of total`;

    // Distribution bar
    const tPct = d.tmn?.percent  ?? 0;
    const nPct = d.nano?.percent ?? 0;
    const tSeg = $('ma-dist-tmn'); const nSeg = $('ma-dist-nano');
    if (tSeg) tSeg.style.flex = tPct.toString();
    if (nSeg) nSeg.style.flex = nPct.toString();
    $('ma-dist-tmn-lbl').textContent  = `TrueMoney ${tPct}%`;
    $('ma-dist-nano-lbl').textContent = `Nano ${nPct}%`;

    // ── Business Domain breakdown card ────────────────────────────────
    const domains = Array.isArray(d.byDomain) ? d.byDomain : [];
    const domCard = $('ma-domain-card');
    const domList = $('ma-domain-list');
    if (domains.length && domList) {
      const grandTotal = domains.reduce((s, r) => s + (r.count || 0), 0) || 1;
      // Primary buckets (TMN/Nano) are always visible. Everything else is
      // hidden behind a "Show more" toggle so the section stays compact.
      const isPrimary = (r) => r.label === 'TrueMoney' || r.label === 'Nano';
      const rowHtml = (row, idx, extra) => {
        const total = row.count || 0;
        const pct   = row.percent ?? Math.round((total / grandTotal) * 100);
        const barColor = row.label === 'TrueMoney' ? TMN_COLOR
                       : row.label === 'Nano'      ? NANO_COLOR
                       : OTHER_COLOR;
        const barPctOfMax = Math.round((total / grandTotal) * 100);
        const label = row.label || row.key;
        const showKey = row.key && row.key !== label && row.key !== '(none)';
        return `
          <div class="ma-domain-item${extra ? ' extra' : ''}">
            <div class="ma-domain-row" data-idx="${idx}">
              <div class="ma-domain-label">
                <span class="name">${escHtml(label)}</span>
                ${showKey ? `<span class="k">${escHtml(row.key)}</span>` : ''}
              </div>
              <div class="ma-domain-bar" title="${total} ticket${total===1?'':'s'} (${pct}%)">
                <div style="flex:${barPctOfMax};background:${barColor};"></div>
                <div style="flex:${100 - barPctOfMax};background:transparent;"></div>
              </div>
              <div class="ma-domain-count">${fmtNum(total)}<span class="pct">${pct}%</span></div>
              <div class="ma-domain-caret" aria-hidden="true">›</div>
            </div>
            <div class="ma-domain-detail" id="ma-dom-detail-${idx}" data-loaded="0"></div>
          </div>`;
      };
      domList.innerHTML = domains.map((row, idx) => rowHtml(row, idx, !isPrimary(row))).join('');
      domList.classList.remove('show-all');

      // Wire click-to-expand for each row
      domList.querySelectorAll('.ma-domain-row').forEach(rowEl => {
        rowEl.addEventListener('click', () => toggleDomainDetail(rowEl, domains));
      });

      // Insert / update the Show more / less toggle
      const extraCount = domains.filter(r => !isPrimary(r)).length;
      let toggle = domCard.querySelector('.ma-domain-toggle');
      if (extraCount > 0) {
        if (!toggle) {
          toggle = document.createElement('button');
          toggle.className = 'ma-domain-toggle';
          toggle.type = 'button';
          domList.after(toggle);
          toggle.addEventListener('click', () => {
            const open = domList.classList.toggle('show-all');
            toggle.classList.toggle('open', open);
            toggle.firstChild.textContent = open
              ? `Show less  `
              : `Show ${extraCount} more domain${extraCount === 1 ? '' : 's'}  `;
          });
        }
        toggle.innerHTML = `Show ${extraCount} more domain${extraCount === 1 ? '' : 's'}  <span class="caret">▾</span>`;
        toggle.style.display = '';
      } else if (toggle) {
        toggle.style.display = 'none';
      }

      domCard.style.display = '';
    } else if (domCard) {
      domCard.style.display = 'none';
    }

    // ── Monthly trend ─────────────────────────────────────────────────
    // Zero-count months render as an empty stub (dashed baseline) instead of
    // a fake 4% bar. Non-zero bars scale to at least 6px so the smallest
    // month is still visible.
    const months = Array.isArray(d.byMonth) ? d.byMonth : [];
    const maxTotal = months.reduce((m, x) => Math.max(m, x.count || 0), 0);
    const bars = months.map(m => {
      const label = new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short' });
      const total = m.count || 0;
      const stackH = maxTotal > 0 && total > 0
        ? Math.max(8, Math.round(total / maxTotal * 100)) + '%'
        : null;
      return `
        <div class="ma-mo" title="${escHtml(label)} — ${total} ticket${total===1?'':'s'}">
          <div class="ma-mo-total${total ? '' : ' empty'}">${total || '·'}</div>
          ${stackH
            ? `<div class="ma-mo-stack" style="height:${stackH};"><div class="fill" style="height:100%;"></div></div>`
            : `<div class="ma-mo-stack empty"></div>`}
          <div class="ma-mo-label">${escHtml(label)}</div>
        </div>`;
    }).join('');
    const barsEl = $('ma-monthly-bars');
    const cardEl = $('ma-monthly-card');
    if (barsEl) barsEl.innerHTML = bars;
    if (cardEl) cardEl.style.display = maxTotal > 0 ? '' : 'none';

    // ── Cache indicator ───────────────────────────────────────────────
    const hintEl = $('ma-cache-hint');
    if (hintEl) {
      const upd = d.updatedAt ? new Date(d.updatedAt) : null;
      const ageLabel = upd ? relTime(upd) : '';
      hintEl.classList.remove('fresh', 'cache', 'stale');
      if (d.stale) {
        hintEl.textContent = `⚠ cached · Jira unreachable · ${ageLabel}`;
        hintEl.classList.add('stale');
      } else if (d.fromCache) {
        hintEl.textContent = `cached · updated ${ageLabel}`;
        hintEl.classList.add('cache');
      } else {
        hintEl.textContent = `fresh · ${ageLabel}`;
        hintEl.classList.add('fresh');
      }
    }
  }

  // ── Domain drill-down ──────────────────────────────────────────────
  // Row click → expand the .ma-domain-detail child to show the tickets
  // belonging to that domain. Tickets come from the endpoint response so
  // no extra network call is needed.
  function toggleDomainDetail(rowEl, domains) {
    const idx = parseInt(rowEl.dataset.idx, 10);
    const domain = domains[idx];
    const detail = document.getElementById('ma-dom-detail-' + idx);
    if (!domain || !detail) return;

    const isOpen = rowEl.classList.contains('expanded');
    // Close any other open row (accordion behaviour). Detail is now a sibling
    // of the row inside the item wrapper — find it via nextElementSibling.
    const list = rowEl.closest('.ma-domain-list');
    list?.querySelectorAll('.ma-domain-row.expanded').forEach(r => {
      if (r !== rowEl) {
        r.classList.remove('expanded');
        r.nextElementSibling?.classList.remove('open');
      }
    });

    if (isOpen) {
      rowEl.classList.remove('expanded');
      detail.classList.remove('open');
      return;
    }

    if (detail.dataset.loaded !== '1') {
      const tickets = Array.isArray(domain.tickets) ? domain.tickets : [];
      if (!tickets.length) {
        detail.innerHTML = `<div class="ma-detail-inner"><div class="ma-detail-empty">No tickets in this domain.</div></div>`;
      } else {
        const rows = tickets.map(t => {
          const key = t.key || '';
          const jiraUrl = `https://truemoney.atlassian.net/browse/${encodeURIComponent(key)}`;
          const tjcrUrl = t.tjcr ? `https://truemoney.atlassian.net/browse/${encodeURIComponent(t.tjcr)}` : null;
          const dateShort = t.resolved
            ? new Date(t.resolved).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
            : '';
          return `
            <div class="ma-detail-row">
              <a class="k" href="${jiraUrl}" target="_blank" rel="noopener">${escHtml(key)}</a>
              <div class="sum" title="${escHtml(t.summary || '')}">${escHtml(t.summary || '')}</div>
              <div class="owner" title="${escHtml(t.owner || '')}">${escHtml(t.owner || '')}</div>
              <div class="date">
                ${escHtml(dateShort)}${tjcrUrl ? ` <a class="k" href="${tjcrUrl}" target="_blank" rel="noopener" style="font-size:9.5px;color:var(--text-muted);text-decoration:none;">↗ ${escHtml(t.tjcr)}</a>` : ''}
              </div>
            </div>`;
        }).join('');
        detail.innerHTML = `<div class="ma-detail-inner">${rows}</div>`;
      }
      detail.dataset.loaded = '1';
    }
    rowEl.classList.add('expanded');
    detail.classList.add('open');
  }

  function relTime(d) {
    const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  let _currentYear = new Date().getFullYear();
  let _inFlight = null;

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Single fetch attempt. Returns the parsed data or throws.
  async function _fetchOnce(year, force) {
    const qs = `year=${year}${force ? '&refresh=1' : ''}`;
    const res = await API.get('/ma-services/jira-stats.php?' + qs);
    // 5xx / network → res may be null-ish or !ok. 503 (Jira unreachable) is
    // the endpoint's own retryable signal. API.get returns null on 401 —
    // surface a clear "session rejected" hint since it usually means the
    // server was restarted with a new JWT_SECRET.
    if (!res) throw new Error('Session rejected by server — try logging out and back in');
    if (!res.ok) {
      const msg = res.data?.message || `HTTP ${res.status || 'error'}`;
      const retryable = !res.status || res.status >= 500 || res.status === 429;
      const err = new Error(msg);
      err.retryable = retryable;
      throw err;
    }
    const data = res.data?.data;
    if (!data) throw new Error('Empty response');
    // Stale-cache guard — server cache TTL is 2 min. If we got a cached response
    // that predates the pipeline field (or has zero total when we know work
    // exists), transparently retry with refresh=1 so the user doesn't see stale
    // "0 tickets" on the first page load. Only retries when the initial call
    // wasn't already forced (avoids infinite loops).
    if (!force && !('pipeline' in data)) {
      console.info('[ma-stats] cache missing pipeline field — forcing refresh');
      return await _fetchOnce(year, true);
    }
    return data;
  }

  // Attempt with one auto-retry after a short delay. Callers stay responsive
  // because setLoading(true) is shown throughout.
  async function loadStats(year, force) {
    setLoading(true);
    _currentYear = year;
    const my = Symbol('req');
    _inFlight = my;

    try {
      let data;
      try {
        data = await _fetchOnce(year, force);
      } catch (e1) {
        if (_inFlight !== my) return;
        if (!e1.retryable) throw e1;
        // Transient — wait then retry once. Don't force cache-bypass on the
        // retry (the server-side cache is likely populated by now).
        await _sleep(2000);
        if (_inFlight !== my) return;
        try {
          data = await _fetchOnce(year, false);
        } catch (e2) {
          // Both attempts failed. Ask the server for whatever cache it has
          // (even stale) as a last resort before showing an error state.
          try {
            const staleRes = await API.get('/ma-services/jira-stats.php?year=' + year);
            const stale = staleRes?.ok ? staleRes.data?.data : null;
            if (stale && stale.total) {
              stale.stale = true;
              renderStats(stale);
              flashRetryHint(e2.message || 'Jira unreachable');
              return;
            }
          } catch { /* fall through */ }
          throw e2;
        }
      }
      if (_inFlight !== my) return;
      renderStats(data);
    } catch (e) {
      if (_inFlight !== my) return;
      renderError(e.message || 'error');
    }
  }

  // Show a subtle "couldn't refresh — showing cached view" cue on the hint chip
  // + orange-tint the Refresh button so the user knows a retry is available.
  function flashRetryHint(msg) {
    const hint = $('ma-cache-hint');
    if (hint) {
      hint.classList.remove('fresh', 'cache');
      hint.classList.add('stale');
      hint.textContent = `⚠ ${msg} · showing cache`;
    }
    const btn = $('ma-stats-refresh');
    if (btn) {
      btn.style.color = 'var(--orange)';
      btn.style.borderColor = 'var(--orange)';
      setTimeout(() => { btn.style.color = ''; btn.style.borderColor = ''; }, 6000);
    }
  }

  function initMaStats() {
    if (!$('ma-stats-grid')) return;
    // Bail early if no valid token — Auth.requireAuth() in the page's inline
    // script will redirect to login. Avoids firing a 401 API call while the
    // redirect is in progress (timing: this IIFE runs before that inline script
    // when readyState is already 'interactive' / 'complete').
    const _tk = Auth.getToken?.();
    if (!_tk || Auth.isTokenExpired?.(_tk)) return;
    populateYears(_currentYear);
    $('ma-stats-year')?.addEventListener('change', (ev) => {
      const y = parseInt(ev.target.value, 10) || _currentYear;
      loadStats(y, false);
    });
    $('ma-stats-refresh')?.addEventListener('click', () => loadStats(_currentYear, true));
    // Force refresh on first page-load so the user never sees stale/empty stats
    // due to server-cache format drift. Subsequent year switches use the cache.
    loadStats(_currentYear, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMaStats);
  } else {
    initMaStats();
  }
})();
