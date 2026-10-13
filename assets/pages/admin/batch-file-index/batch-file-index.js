// admin/batch-file-index — page script, extracted from admin/batch-file-index.html.
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

if (!Auth.requireAdmin()) {}
  (function () {
    const u = Auth.getUser?.();
    if (u && u.role !== 'super_admin' && u.team !== 'sm') {
      alert('หน้านี้ใช้จัดการ Batch File Index ของทีม SM เท่านั้น');
      window.location.href = 'index.html';
    }
  })();
  Layout.render('admin-batch-file-index');

  let SERVERS      = [];
  let CATALOG      = { servers: {} };
  let INDEX_STATUS = {};

  async function loadAll() {
    const [srvRes, catRes] = await Promise.all([
      API.jenkinsServers.list(),
      API.batchFileIndex.getCatalog(),
    ]);
    SERVERS = (srvRes?.ok && Array.isArray(srvRes.data?.data)) ? srvRes.data.data : [];
    const catPayload = catRes?.ok ? (catRes.data?.data || {}) : {};
    CATALOG = { servers: catPayload.servers || {} };

    const crawledIds = Object.keys(CATALOG.servers);
    if (crawledIds.length) {
      const statusResults = await Promise.all(
        crawledIds.map(id => API.batchFileIndex.indexStatus(id).then(r => [id, r]))
      );
      INDEX_STATUS = {};
      for (const [id, r] of statusResults) {
        INDEX_STATUS[id] = (r?.ok && r.data?.data) ? r.data.data : null;
      }
    }
    render();
  }

  function fmtRelTime(iso) {
    if (!iso) return 'never';
    const t = new Date(iso).getTime();
    if (!t) return iso;
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60)    return s + 's ago';
    if (s < 3600)  return Math.floor(s/60)  + 'm ago';
    if (s < 86400) return Math.floor(s/3600)+ 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }

  function render() {
    const list = document.getElementById('srv-list');
    if (!SERVERS.length) {
      list.innerHTML = '<div class="sn-empty">ยังไม่มี Jenkins server — ไปที่ Admin → Integrations → Jenkins เพื่อเพิ่ม</div>';
      return;
    }
    const sorted = [...SERVERS].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    list.innerHTML = '<div class="sn-server-list">' + sorted.map(s => renderRow(s)).join('') + '</div>';
  }

  function renderRow(s) {
    const cat     = CATALOG.servers[s.id] || null;
    const enabled = !!s.enabled;
    const idx     = INDEX_STATUS[s.id] || null;
    const summary = idx?.summary || null;
    const jobsMap = idx?.jobs || {};
    const indexedJobsCount = Object.values(jobsMap).filter(j => (j?.status === 'ok')).length;

    const stateBadge = !enabled
      ? '<span class="sn-badge sn-badge-amber">Disabled</span>'
      : (cat ? `<span class="sn-badge sn-badge-green">${cat.job_count || 0} jobs</span>`
             : '<span class="sn-badge">Never crawled</span>');

    return `
      <div class="sn-server-row" data-server="${escAttr(s.id)}">
        <div class="sn-server-head">
          <div class="sn-server-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
          </div>
          <div class="sn-server-name">${escHtml(s.display || s.id)}</div>
          ${stateBadge}
        </div>
        <div class="sn-server-url">${escHtml(s.base_url || '')}</div>
        <div class="sn-stats">
          <div><span>Catalog</span><b>${cat?.job_count ?? '—'}</b></div>
          <div><span>Indexed</span><b>${indexedJobsCount || 0}${cat ? ` <span style="color:var(--text-muted);font-weight:400;">/ ${cat.job_count}</span>` : ''}</b></div>
          <div><span>Last crawled</span><b>${cat ? fmtRelTime(cat.crawled_at) : 'never'}</b></div>
          <div><span>Last indexed</span><b>${summary?.finished_at ? fmtRelTime(summary.finished_at) : 'never'}</b></div>
          ${summary ? `<div><span>Patterns +</span><b>${summary.patterns_added ?? 0}</b></div>` : ''}
          ${summary ? `<div><span>Errors</span><b style="color:${(summary.jobs_error ?? 0) > 0 ? '#dc2626' : 'inherit'};">${summary.jobs_error ?? 0}</b></div>` : ''}
        </div>
        <div class="sn-actions">
          <button class="sn-btn ${cat ? 'sn-btn-outline' : 'sn-btn-primary'}" ${enabled ? '' : 'disabled'} onclick="crawlServer('${escAttr(s.id)}', this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            ${cat ? 'Re-crawl' : 'Crawl now'}
          </button>
          ${cat ? `
            <input type="text" class="sn-input" id="dry-query-${escAttr(s.id)}" placeholder='pipe substring (e.g. "settlement")' style="min-width:220px;">
            <button class="sn-btn sn-btn-outline" onclick="dryRunOne('${escAttr(s.id)}', this)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l1 9H8L9 3z"/><path d="M6.7 14.4C5 16 4 18 4 20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2c0-2-1-4-2.7-5.6"/></svg>
              Dry-run
            </button>
            <button class="sn-btn sn-btn-primary" onclick="indexLogs('${escAttr(s.id)}', this)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              ${summary ? 'Re-index logs' : 'Index logs'}
            </button>
            <button class="sn-btn sn-btn-ghost" onclick="toggleSample('${escAttr(s.id)}')">Sample jobs</button>
          ` : ''}
        </div>
        ${cat ? `
          <div class="sn-output" id="sample-${escAttr(s.id)}" style="display:none;">
            <b>First ${Math.min(cat.jobs?.length || 0, 12)} of ${cat.job_count} jobs:</b>
            ${(cat.jobs || []).slice(0, 12).map(j => `<div>• ${escHtml(j.name)}</div>`).join('')}
          </div>
        ` : ''}
        <div id="idx-out-${escAttr(s.id)}" style="display:none;"></div>
      </div>
    `;
  }

  function toggleSample(sid) {
    const el = document.getElementById('sample-' + sid);
    if (el) el.style.display = (el.style.display === 'none' ? 'block' : 'none');
  }

  async function crawlServer(serverId, btn) {
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = 'Crawling…';
    const res = await API.batchFileIndex.crawl(serverId);
    btn.disabled = false;
    btn.innerHTML = original;
    if (!res?.ok || !res.data?.success) { Toast.error(res?.data?.message || 'Crawl failed'); return; }
    const d = res.data.data || {};
    Toast.success(`Crawled ${d.job_count} jobs from ${d.server_display}`);
    await loadAll();
  }

  async function dryRunOne(serverId, btn) {
    const cat = CATALOG.servers[serverId];
    if (!cat?.jobs?.length) { Toast.error('No jobs in catalog'); return; }
    const query = (document.getElementById('dry-query-' + serverId)?.value || '').trim();

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = 'Dry-running…';
    const res = await API.batchFileIndex.indexLogs(serverId, { dry_run: true, job_name_query: query });
    btn.disabled = false;
    btn.innerHTML = original;
    if (!res?.ok || !res.data?.success) { Toast.error(res?.data?.message || 'Dry-run failed'); return; }

    const out = document.getElementById('idx-out-' + serverId);
    const d = res.data.data || {};

    if (d.no_match) {
      out.style.display = 'block';
      out.innerHTML = `
        <div class="sn-output sn-output-warning">
          <b>No match for filter:</b> <span style="font-family:ui-monospace,monospace;">${escHtml(d.job_name_query || '')}</span><br>
          <span style="opacity:.75">Catalog มี ${d.catalog_size ?? '?'} jobs · ลองใช้ substring สั้นกว่านี้.</span>
        </div>
      `;
      Toast.error(res.data.message || 'No matching job');
      return;
    }

    const samples  = d.sample_extractions   || [];
    const winner   = d.dry_run_winner       || null;
    const attempts = d.dry_run_attempts     || [];
    const lastAtt  = d.dry_run_last_attempt || null;

    out.style.display = 'block';
    if (winner) {
      out.innerHTML = `
        <div class="sn-output">
          <b>Winner:</b> ${escHtml(winner.job_name)}
          <span style="opacity:.6"> · build #${winner.build_number} · ${winner.log_bytes.toLocaleString()} bytes</span><br>
          Tried ${attempts.length} job(s) — first success returned ${samples.length} pattern(s)
          <br><br>
          <b>Extracted patterns:</b><br>
          ${samples.map(s => `
            <div style="margin:6px 0;padding-bottom:6px;border-bottom:1px dashed var(--border);">
              <b style="color:var(--text);">${escHtml(s.raw)}</b><br>
              <span style="opacity:.7">→ ${escHtml(s.normalized)}</span><br>
              <span style="opacity:.55;font-size:10.5px">${escHtml(s.snippet)}</span>
            </div>
          `).join('')}
          <details>
            <summary>Show log preview (first 2500 chars)</summary>
            <pre>${escHtml(winner.log_preview || '')}</pre>
          </details>
        </div>
      `;
      Toast.success(`Extracted ${samples.length} pattern(s) from ${winner.job_name}`);
    } else {
      out.innerHTML = `
        <div class="sn-output sn-output-warning">
          <b>Tried ${attempts.length} job(s), 0 patterns extracted</b><br>
          ${query ? `Filter: <span style="font-family:ui-monospace,monospace;">${escHtml(query)}</span>` : '<i>(no filter — walked first ' + attempts.length + ' catalog jobs)</i>'}
          <br><br>
          <b>Attempts:</b><br>
          ${attempts.map(a => `
            • ${escHtml(a.job_name)} — ${escHtml(a.status)}
            ${a.build_number ? `(build #${a.build_number}, ${a.log_bytes?.toLocaleString() ?? 0} bytes)` : ''}
            ${a.reason ? ` — <span style="opacity:.7">${escHtml(a.reason)}</span>` : ''}
          `).join('<br>')}
          ${lastAtt?.log_preview ? `
            <details>
              <summary>Show last log preview (${escHtml(lastAtt.job_name)}, first 2500 chars)</summary>
              <pre>${escHtml(lastAtt.log_preview)}</pre>
            </details>
          ` : ''}
          <br><span style="opacity:.75">Try a more targeted query (e.g. <code>settlement</code>) or crawl a different server.</span>
        </div>
      `;
      Toast.error(`0 patterns from ${attempts.length} job(s)`);
    }
  }

  let _pendingIndex = null;

  function indexLogs(serverId, btn) {
    const cat = CATALOG.servers[serverId];
    if (!cat) { Toast.error('Server not crawled yet'); return; }
    _pendingIndex = { serverId, btn };
    document.getElementById('mci-server').textContent = cat.server_display || serverId;
    document.getElementById('mci-jobs').textContent   = String(cat.job_count || 0);
    const estSec = Math.min(Math.round((cat.job_count || 0) * 0.6), 360);
    document.getElementById('mci-time').textContent =
      estSec < 60 ? `~${estSec}s` : `~${Math.ceil(estSec/60)} min`;
    document.getElementById('modal-confirm-index').classList.add('open');
  }

  function closeConfirmIndex() {
    document.getElementById('modal-confirm-index').classList.remove('open');
    _pendingIndex = null;
  }

  function renderProgressUI(state) {
    const s = state || {};
    const stats = s.stats || {};
    const total = s.total ?? 0;
    const processed = s.processed ?? 0;
    const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    const statusColor = s.status === 'done' ? '#16a34a'
                      : s.status === 'error' ? '#dc2626'
                      : '#2563eb';
    const statusLabel = s.status === 'done'    ? 'Done'
                      : s.status === 'error'   ? 'Error'
                      : s.status === 'running' ? 'Running…'
                      : 'Starting…';
    const elapsed = s.started_at ? Math.max(0, Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000)) : 0;
    const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed/60)}m ${elapsed%60}s`;
    const skipped = (stats.jobs_skipped_same_build ?? 0)
                  + (stats.jobs_skipped_backoff ?? 0)
                  + (stats.jobs_skipped_too_large ?? 0)
                  + (stats.jobs_skipped_no_build ?? 0);
    const logMB = ((stats.log_bytes_read ?? 0) / 1024 / 1024).toFixed(1);

    return `
      <div class="sn-output" style="max-height:none;font-family:inherit;font-size:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <b>Indexing progress</b>
          <span style="color:${statusColor};font-weight:600;font-size:11px;">${statusLabel} · ${elapsedStr}</span>
        </div>
        <div style="background:var(--sidebar-bg);border-radius:6px;height:12px;overflow:hidden;margin-bottom:6px;position:relative;">
          <div style="background:${statusColor};height:100%;width:${pct}%;transition:width .3s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:10px;">
          <span>${processed.toLocaleString()} / ${total.toLocaleString()} jobs</span>
          <b style="color:var(--text);">${pct}%</b>
        </div>
        ${s.current_job ? `<div style="margin-bottom:10px;color:var(--text-muted);font-size:11px;">Current: <span style="color:var(--text);font-family:ui-monospace,monospace;">${escHtml(s.current_job)}</span></div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px 16px;font-size:11px;">
          <div><span style="opacity:.6;">Indexed</span><br><b style="color:var(--text);">${(stats.jobs_indexed ?? 0).toLocaleString()}</b></div>
          <div><span style="opacity:.6;">Skipped</span><br><b style="color:var(--text);">${skipped.toLocaleString()}</b></div>
          <div><span style="opacity:.6;">Errors</span><br><b style="color:${(stats.jobs_error ?? 0) > 0 ? '#dc2626' : 'var(--text)'};">${(stats.jobs_error ?? 0).toLocaleString()}</b></div>
          <div><span style="opacity:.6;">+Patterns</span><br><b style="color:var(--text);">${(stats.patterns_added ?? 0).toLocaleString()}</b></div>
          <div><span style="opacity:.6;">~Patterns</span><br><b style="color:var(--text);">${(stats.patterns_updated ?? 0).toLocaleString()}</b></div>
          <div><span style="opacity:.6;">Log read</span><br><b style="color:var(--text);">${logMB} MB</b></div>
        </div>
        ${s.message ? `<div style="margin-top:10px;color:#dc2626;font-size:11px;">${escHtml(s.message)}</div>` : ''}
      </div>
    `;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function doIndexLogs() {
    if (!_pendingIndex) return;
    const { serverId, btn } = _pendingIndex;
    _pendingIndex = null;
    document.getElementById('modal-confirm-index').classList.remove('open');

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = 'Indexing…';

    // Show initial progress UI
    const out = document.getElementById('idx-out-' + serverId);
    out.style.display = 'block';
    out.innerHTML = renderProgressUI({ status: 'running', started_at: new Date().toISOString(), total: 0, processed: 0 });

    // Kick off the POST. We do NOT await it here — polling the progress file is
    // the source of truth. If Apache times out the response, PHP keeps running
    // (ignore_user_abort), and the progress file will still hit 'done'/'error'.
    const postPromise = API.batchFileIndex.indexLogs(serverId, {}).catch(err => ({ ok: false, err }));

    let lastState = null;
    const maxWaitMs = 20 * 60 * 1000; // 20 min ceiling
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      await sleep(1500);
      try {
        const r = await API.batchFileIndex.indexProgress(serverId);
        if (r?.ok && r.data?.data) {
          lastState = r.data.data;
          out.innerHTML = renderProgressUI(lastState);
          if (lastState.status === 'done' || lastState.status === 'error') break;
        }
      } catch (_) { /* transient — keep polling */ }
    }

    await postPromise; // best-effort; may 500 from Apache Timeout even if PHP finished OK
    btn.disabled = false;
    btn.innerHTML = original;

    if (lastState?.status === 'done') {
      const s = lastState.stats || {};
      Toast.success(`Indexed ${s.jobs_indexed ?? 0} jobs · +${s.patterns_added ?? 0} patterns · ${s.jobs_error ?? 0} errors`);
      if ((s.jobs_error ?? 0) > 0 && (s.error_samples || []).length) {
        out.innerHTML += `
          <div class="sn-output sn-output-error" style="margin-top:10px;">
            <b>${s.jobs_error} error(s):</b><br>
            ${s.error_samples.slice(0, 8).map(e => `• ${escHtml(e)}`).join('<br>')}
          </div>
        `;
      }
      await loadAll();
      return;
    }
    if (lastState?.status === 'error') {
      Toast.error(lastState.message || 'Indexer failed');
      await loadAll();
      return;
    }
    Toast.error('Indexer still running past 20 min — check back later');
    await loadAll();
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escAttr(s) { return escHtml(s).replace(/`/g, '&#96;'); }

  loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "closeConfirmIndex", { configurable: true, get: () => closeConfirmIndex, set: (v) => { closeConfirmIndex = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "crawlServer", { configurable: true, get: () => crawlServer, set: (v) => { crawlServer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doIndexLogs", { configurable: true, get: () => doIndexLogs, set: (v) => { doIndexLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dryRunOne", { configurable: true, get: () => dryRunOne, set: (v) => { dryRunOne = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escAttr", { configurable: true, get: () => escAttr, set: (v) => { escAttr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtRelTime", { configurable: true, get: () => fmtRelTime, set: (v) => { fmtRelTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "indexLogs", { configurable: true, get: () => indexLogs, set: (v) => { indexLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderProgressUI", { configurable: true, get: () => renderProgressUI, set: (v) => { renderProgressUI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRow", { configurable: true, get: () => renderRow, set: (v) => { renderRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sleep", { configurable: true, get: () => sleep, set: (v) => { sleep = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleSample", { configurable: true, get: () => toggleSample, set: (v) => { toggleSample = v; } }); } catch (e) {}
})();
