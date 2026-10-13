// ma-test — page script, extracted from ma-test.html.
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
const _u = Auth.getUser();
if (_u && _u.team && _u.team !== 'sm' && !['super_admin','super_viewer'].includes(_u.role)) {
  Toast?.error?.('SM team only');
  setTimeout(() => location.replace('./dashboard.html'), 800);
}
Layout.render('ma-test');

const isAdmin = ['super_admin','sm_admin','sm_lead','dev_sm'].includes(_u?.role);

MaTest.SERVICES.forEach(s => document.getElementById('f-service').insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
MaTest.TYPES  .forEach(t => document.getElementById('t-type').insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`));
MaTest.RESULTS.forEach(r => document.getElementById('t-result').insertAdjacentHTML('beforeend', `<option value="${r}">${r}</option>`));
document.getElementById('t-result').value = 'Pending';
document.getElementById('t-owner').textContent = _u?.name || _u?.id || '';
document.getElementById('month').value = MaTest.currentMonth();

let plan = [];
let results = [];
let editing = { planItem: null, resultId: null, screenshots: [] };
let _hasLoadedOnce = false;
let _loadSeq = 0;  // guards against out-of-order responses when month changes fast

// Toggle the hero spinner / error banner / real content. Only used before the
// first successful load — after that, reloads keep the content visible and
// surface errors via a toast so the page doesn't flash.
function _mtShowState(state, msg) {
  const load = document.getElementById('mt-loading');
  const err  = document.getElementById('mt-error');
  const body = document.getElementById('mt-content');
  load.hidden = (state !== 'loading');
  err.hidden  = (state !== 'error');
  body.hidden = (state !== 'ready');
  if (state === 'error') {
    document.getElementById('mt-error-msg').textContent = msg || 'Network error';
  }
}

async function _fetchMonthOnce(month) {
  const [planRes, resRes] = await Promise.all([
    MaTest.api.listPlan(month),
    MaTest.api.listResults(month),
  ]);
  const ok = !!(planRes?.success && resRes?.success);
  const error = ok ? '' : (
    (!planRes?.success ? planRes?.message : resRes?.message) || 'Failed to load'
  );
  return { planRes, resRes, ok, error };
}

async function load() {
  const month = document.getElementById('month').value;
  const seq = ++_loadSeq;

  // First load → show hero spinner so the page doesn't render an empty stats
  // row + empty split columns while waiting. Subsequent reloads (after saving
  // a result, or month change) keep the current content visible so the UI
  // doesn't flash. Errors are surfaced via toast in that case.
  if (!_hasLoadedOnce) {
    _mtShowState('loading');
  } else {
    document.getElementById('plan-sub').textContent = `${month} · กำลังโหลด…`;
  }

  let attempt = await _fetchMonthOnce(month);
  if (seq !== _loadSeq) return;  // month changed mid-fetch — abandon this run
  if (!attempt.ok) {
    // One silent retry — covers transient network hiccups without user action.
    await new Promise(r => setTimeout(r, 500));
    if (seq !== _loadSeq) return;
    attempt = await _fetchMonthOnce(month);
    if (seq !== _loadSeq) return;
  }

  if (!attempt.ok) {
    // Persistent failure: preserve old data if we already had a successful
    // load, so an accidental reload after save doesn't blank the page. First
    // load ever → show the hero-error banner instead of empty content.
    if (!_hasLoadedOnce) {
      _mtShowState('error', attempt.error);
    } else {
      Toast?.error?.(`โหลดข้อมูลไม่สำเร็จ: ${attempt.error}`);
      document.getElementById('plan-sub').textContent =
        `${month} · ${plan.length} planned · ${results.length} recorded · <i data-icon="alert-triangle"></i> ข้อมูลอาจไม่ใช่ล่าสุด`;
    }
    return;
  }

  plan = attempt.planRes.data.items || [];
  // Drop orphan records — those whose catalog_id is no longer in this month's
  // plan (e.g. admin removed the plan item after a Failed record was saved).
  // They'd otherwise skew "Recorded"/Successed/Failed/Pending counts without
  // being visible in any card, so users can't reconcile the numbers.
  const _allResults = attempt.resRes.data.items || [];
  const _planCatIds = new Set(plan.map(p => p.catalog_id));
  results = _allResults.filter(r => _planCatIds.has(r.catalog_id));
  _hasLoadedOnce = true;
  _mtShowState('ready');
  document.getElementById('plan-sub').textContent =
    `${month} · ${plan.length} planned · ${results.length} recorded`;
  renderStats();
  renderPlan();
}
// Expose for the inline Retry button in the error state.
window._reloadMaTest = load;

function renderStats() {
  const total = plan.length;
  const succ  = results.filter(r => r.result === 'Successed').length;
  const fail  = results.filter(r => r.result === 'Failed').length;
  const pend  = results.filter(r => r.result === 'Pending').length;
  document.getElementById('stats').innerHTML = `
    <div class="mt-stat info"><div class="l">Planned</div><div class="n">${total}</div></div>
    <div class="mt-stat"><div class="l">Recorded</div><div class="n">${results.length}</div></div>
    <div class="mt-stat success"><div class="l">Successed</div><div class="n">${succ}</div></div>
    <div class="mt-stat danger"><div class="l">Failed</div><div class="n">${fail}</div></div>
    <div class="mt-stat warning"><div class="l">Pending</div><div class="n">${pend}</div></div>`;
}

function resultsForCatalog(catalogId) {
  return results.filter(r => r.catalog_id === catalogId);
}

function renderPlan() {
  const todoWrap = document.getElementById('todo-list');
  const doneWrap = document.getElementById('done-list');
  const fs  = document.getElementById('f-service').value;
  const fst = document.getElementById('f-status').value;
  const esc = MaTest.escapeHtml;

  const filtered = plan.filter(p => {
    const c = p.catalog || {};
    if (fs && c.service !== fs) return false;
    const has = resultsForCatalog(p.catalog_id).length > 0;
    if (fst === 'untested' && has) return false;
    if (fst === 'tested'   && !has) return false;
    return true;
  });

  // Split by "has any Successed result" — Success → right, everything else → left.
  const isDone = (p) => resultsForCatalog(p.catalog_id).some(r => r.result === 'Successed');
  const todo = filtered.filter(p => !isDone(p));
  const done = filtered.filter(p =>  isDone(p));

  document.getElementById('todo-count').textContent = todo.length;
  document.getElementById('done-count').textContent = done.length;

  const renderItem = (p) => {
    const c = p.catalog || {};
    const rs = resultsForCatalog(p.catalog_id);
    const rowDone = rs.some(r => r.result === 'Successed');
    const rsHtml = rs.map(r => {
      const contribs = r.contributors?.length
        ? r.contributors
        : [{id: r.tested_by, name: r.tested_by_name || r.tested_by}];
      const whoHtml = contribs.map(c => {
        const initials = (c.name || c.id || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:6px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--orange-bg,rgba(255,140,0,.12));color:var(--orange);font-size:9px;font-weight:800;flex-shrink:0">${esc(initials)}</span>
          <span style="font-weight:700;color:var(--text);font-size:12px">${esc(c.name || c.id || 'unknown')}</span>
        </span>`;
      }).join('');
      return `
      <div class="mt-result">
        <div>${MaTest.resultBadge(r.result)}</div>
        <div>
          <div class="who" style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;margin-bottom:3px">
            <span style="font-size:10px;color:var(--text-muted);margin-right:4px">by</span>
            ${whoHtml}
          </div>
          <div class="meta">
            ${esc(r.type || '—')} · ${esc(r.test_date || '—')}
            ${r.start_time || r.end_time ? ' · ' + esc(r.start_time || '') + '–' + esc(r.end_time || '') : ''}
            ${r.refer_ticket ? ' · ' + esc(r.refer_ticket) : ''}
          </div>
          ${r.screenshots?.length ? `<div class="mt-thumbs">${
            r.screenshots.map(url => `<div class="mt-thumb"><img src="${esc(url)}" onclick="openLightbox('${esc(url)}')" alt=""></div>`).join('')
          }</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn btn-ghost btn-sm" data-edit-r="${esc(r.id)}">Edit</button>
          ${(isAdmin || (r.tested_by === (_u?.sub || _u?.id)) || (r.contributors || []).some(c => c.id === (_u?.sub || _u?.id)))
            ? `<button class="btn btn-ghost btn-sm" data-del-r="${esc(r.id)}" style="color:var(--danger,#dc2626)" title="ลบ result นี้">Delete</button>`
            : ''}
        </div>
      </div>`;
    }).join('');

    const isUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v.trim());
    const resPills = [
      isUrl(c.link_manual)
        ? `<a href="${esc(c.link_manual)}" target="_blank" rel="noopener" class="mt-res-pill" title="เปิดคู่มือในแท็บใหม่"><i data-icon="book-open"></i> Manual</a>`
        : '',
      isUrl(c.graph_url)
        ? `<button type="button" class="mt-res-pill graph" title="เปิด Grafana graph ใน popup" data-graph="${esc(c.graph_url)}" data-graph-name="${esc(c.name || '')}"><i data-icon="bar-chart"></i> Graph</button>`
        : '',
    ].filter(Boolean).join('');

    return `
      <div class="mt-item">
        <div class="mt-item-top">
          <div>
            <div class="name">${esc(c.name || '(missing catalog)')}</div>
            ${c.remark ? `<div class="remark">${esc(c.remark)}</div>` : ''}
            ${resPills ? `<div class="mt-res-links" style="margin-top:6px">${resPills}</div>` : ''}
          </div>
          <div>${MaTest.serviceBadge(c.service)}</div>
          <div>${MaTest.priorityBadge(c.priority)}</div>
          <div>${MaTest.toolBadge(c.tool)}</div>
          <div>${rowDone
            ? `<span class="mt-done-mark" title="Test succeeded — use Edit on the record below to change">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                 Done
               </span>`
            : `<button class="btn btn-primary btn-sm" data-test="${esc(p.id)}">+ Record</button>`
          }</div>
        </div>
        ${rsHtml}
      </div>`;
  };

  const emptyTodo = `
    <div class="mt-split-empty">
      <h4><i data-icon="sparkles"></i> ไม่มีอะไรค้างในคอลัมน์นี้</h4>
      <p>${plan.length ? 'ทุกอันเทสสำเร็จหมดแล้ว หรือ filter ไม่ตรง' : 'Admin ยังไม่ได้ add plan ของเดือนนี้'}</p>
    </div>`;
  const emptyDone = `
    <div class="mt-split-empty">
      <h4>ยังไม่มีอันไหน Success</h4>
      <p>เมื่อบันทึกผลเป็น "Successed" แล้ว จะย้ายมาที่นี่</p>
    </div>`;

  todoWrap.innerHTML = todo.length ? todo.map(renderItem).join('') : emptyTodo;
  doneWrap.innerHTML = done.length ? done.map(renderItem).join('') : emptyDone;

  document.querySelectorAll('#todo-list [data-test], #done-list [data-test]').forEach(b => b.onclick = () => openTest(b.dataset.test, null));
  document.querySelectorAll('#todo-list [data-edit-r], #done-list [data-edit-r]').forEach(b => b.onclick = () => openTest(null, b.dataset.editR));
  document.querySelectorAll('#todo-list [data-graph], #done-list [data-graph]').forEach(b => b.onclick = () => openGrafanaPopup(b.dataset.graph, b.dataset.graphName));
  document.querySelectorAll('#todo-list [data-del-r], #done-list [data-del-r]').forEach(b => b.onclick = () => deleteResult(b.dataset.delR));
}

// ── Test modal ───────────────────────────────────────────────
function openTest(planId, resultId) {
  const item = planId ? plan.find(p => p.id === planId) : null;
  const existing = resultId ? results.find(r => r.id === resultId) : null;
  const cat = item?.catalog || existing?.catalog || null;
  if (!cat) { Toast?.error?.('Catalog reference missing'); return; }
  editing = {
    planItem: item || (existing ? { id: existing.plan_id, catalog_id: existing.catalog_id, catalog: existing.catalog } : null),
    resultId: resultId || null,
    screenshots: existing?.screenshots ? [...existing.screenshots] : [],
  };

  document.getElementById('test-title').textContent = existing ? 'Edit result' : 'Record test result';
  const esc = MaTest.escapeHtml;
  document.getElementById('test-sub').innerHTML = `
    <b style="color:var(--text); font-size:13px">${esc(cat.name)}</b>
    <span style="margin-left:8px">${MaTest.serviceBadge(cat.service)}</span>
    <span style="margin-left:4px">${MaTest.toolBadge(cat.tool)}</span>
    ${cat.remark ? '<div style="font-size:11px; color:var(--text-muted); margin-top:6px">' + esc(cat.remark) + '</div>' : ''}
  `;

  document.getElementById('t-type').value   = existing?.type || 'Test';
  document.getElementById('t-date').value   = existing?.test_date || MaTest.today();
  document.getElementById('t-start').value  = existing?.start_time || '';
  document.getElementById('t-end').value    = existing?.end_time || '';
  document.getElementById('t-result').value = existing?.result || 'Pending';
  document.getElementById('t-ticket').value = existing?.refer_ticket || '';

  const bef = existing?.before_test || '-';
  const dur = existing?.during_test || '-';
  document.querySelectorAll('input[name="t-before"]').forEach(r => r.checked = (r.value === bef));
  document.querySelectorAll('input[name="t-during"]').forEach(r => r.checked = (r.value === dur));

  const isJenkins = (cat.tool || '').toLowerCase() === 'jenkins';
  document.querySelectorAll('.jenkins-only').forEach(el => el.style.display = isJenkins ? 'block' : 'none');
  document.getElementById('t-jup').value = isJenkins ? (existing?.jenkins_build_up_url || '') : '';
  document.getElementById('t-jdn').value = isJenkins ? (existing?.jenkins_build_down_url || '') : '';

  if (existing) {
    const contribs = existing.contributors?.length
      ? existing.contributors
      : [{id: existing.tested_by, name: existing.tested_by_name}];
    const alreadyIn = contribs.some(c => c.id === _u?.sub || c.id === _u?.id);
    const preview = alreadyIn ? contribs : [...contribs, {id: _u?.sub, name: _u?.name}];
    document.getElementById('t-owner').textContent = preview.map(c => c.name || c.id || '').filter(Boolean).join(', ');
  } else {
    document.getElementById('t-owner').textContent = _u?.name || '';
  }
  renderThumbs();
  document.getElementById('t-files').value = '';
  document.getElementById('modal-test').classList.add('active');
}

function renderThumbs() {
  const box = document.getElementById('t-thumbs');
  const esc = MaTest.escapeHtml;
  box.innerHTML = editing.screenshots.map((url, i) => `
    <div class="mt-thumb">
      <img src="${esc(url)}" alt="">
      <button class="rm" data-rm-thumb="${i}" title="Remove">×</button>
    </div>`).join('');
  box.querySelectorAll('[data-rm-thumb]').forEach(b => b.onclick = () => {
    editing.screenshots.splice(parseInt(b.dataset.rmThumb, 10), 1);
    renderThumbs();
  });
}

async function uploadScreenshotFiles(files) {
  const list = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'));
  if (!list.length) return 0;
  const month = document.getElementById('month').value;
  const zone = document.getElementById('t-paste-zone');
  const title = zone?.querySelector('.pz-title');
  const origHtml = title?.innerHTML;
  zone?.classList.add('is-busy');
  if (title) title.innerHTML = `<span class="pz-spin"></span>กำลังอัพโหลด ${list.length} รูป…`;
  let ok = 0;
  for (const f of list) {
    const r = await MaTest.api.uploadScreenshot(f, month);
    if (r?.success && r.data?.url) { editing.screenshots.push(r.data.url); ok++; }
    else Toast?.error?.(r?.message || 'Upload failed');
  }
  zone?.classList.remove('is-busy');
  if (title && origHtml != null) title.innerHTML = origHtml;
  renderThumbs();
  return ok;
}

async function onFilesChange(ev) {
  await uploadScreenshotFiles(ev.target.files);
  ev.target.value = '';
}

function onPasteScreenshots(ev) {
  const modal = document.getElementById('modal-test');
  if (!modal.classList.contains('active')) return;
  const t = ev.target;
  const tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
  const items = ev.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  ev.preventDefault();
  uploadScreenshotFiles(files);
}

async function saveTest() {
  const month = document.getElementById('month').value;
  const cat = editing.planItem?.catalog || null;
  const isJenkins = (cat?.tool || '').toLowerCase() === 'jenkins';
  const jup = document.getElementById('t-jup').value.trim();
  const jdn = document.getElementById('t-jdn').value.trim();

  if (!editing.screenshots.length) {
    Toast?.error?.('กรุณาแนบรูป Screenshot อย่างน้อย 1 รูป');
    document.getElementById('t-paste-zone')?.focus();
    return;
  }

  if (isJenkins) {
    if (!jup) {
      Toast?.error?.('Jenkins Build URL — MA Up is required');
      document.getElementById('t-jup').focus();
      return;
    }
    if (!jdn) {
      Toast?.error?.('Jenkins Build URL — MA Down is required');
      document.getElementById('t-jdn').focus();
      return;
    }
    const urlRe = /^https?:\/\//i;
    if (!urlRe.test(jup)) { Toast?.error?.('MA Up URL ต้องเริ่มด้วย http:// หรือ https://'); document.getElementById('t-jup').focus(); return; }
    if (!urlRe.test(jdn)) { Toast?.error?.('MA Down URL ต้องเริ่มด้วย http:// หรือ https://'); document.getElementById('t-jdn').focus(); return; }
  }

  const payload = {
    plan_id:     editing.planItem?.id || '',
    catalog_id:  editing.planItem?.catalog_id || editing.planItem?.catalog?.id || '',
    type:        document.getElementById('t-type').value,
    test_date:   document.getElementById('t-date').value,
    before_test: document.querySelector('input[name="t-before"]:checked')?.value || '-',
    during_test: document.querySelector('input[name="t-during"]:checked')?.value || '-',
    screenshots: editing.screenshots,
    start_time:  document.getElementById('t-start').value,
    end_time:    document.getElementById('t-end').value,
    result:      document.getElementById('t-result').value,
    refer_ticket:document.getElementById('t-ticket').value.trim(),
    jenkins_build_up_url:   jup,
    jenkins_build_down_url: jdn,
  };
  if (!payload.catalog_id) { Toast?.error?.('Missing catalog reference'); return; }
  const res = editing.resultId
    ? await MaTest.api.updateResult(month, editing.resultId, payload)
    : await MaTest.api.createResult(month, payload);
  if (!res?.success) { Toast?.error?.(res?.message || 'Save failed'); return; }
  Toast?.success?.(editing.resultId ? 'Updated' : 'Saved');
  closeAll();
  await load();
}

window.openLightbox = function(url) {
  document.getElementById('lb-img').src = url;
  document.getElementById('modal-lightbox').classList.add('active');
};

// ── Grafana popup (same pattern as monitoring.html / ma-services.html) ──
// Rewrites grafana-thanos URLs through the same-origin reverse proxy and
// attaches the JWT so the iframe doesn't bounce to Grafana login.
const _GRAFANA_UPSTREAM = 'https://grafana-thanos.truemoney.com';
function _rewriteGrafanaUrl(url) {
  if (!url || !url.startsWith(_GRAFANA_UPSTREAM)) return url;
  const tail = url.slice(_GRAFANA_UPSTREAM.length);
  const token = (typeof Auth !== 'undefined' && Auth.getToken) ? Auth.getToken() : null;
  const sep = tail.includes('?') ? '&' : '?';
  return tail + (token ? `${sep}token=${encodeURIComponent(token)}` : '');
}
window.openGrafanaPopup = function(url, title) {
  if (!url) return;
  const modal = document.getElementById('mt-grafana-modal');
  const frame = document.getElementById('mt-grafana-frame');
  document.getElementById('mt-grafana-title').textContent = title ? `Grafana — ${title}` : 'Grafana';
  document.getElementById('mt-grafana-tab').href = url;
  frame.src = _rewriteGrafanaUrl(url);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};
window.closeGrafanaPopup = function() {
  const modal = document.getElementById('mt-grafana-modal');
  const frame = document.getElementById('mt-grafana-frame');
  modal.classList.remove('active');
  if (frame) frame.src = 'about:blank';
  document.body.style.overflow = '';
};

async function deleteResult(resultId) {
  const r = results.find(x => x.id === resultId);
  const cat = r?.catalog || {};
  const contribs = r?.contributors?.length
    ? r.contributors
    : [{name: r?.tested_by_name || r?.tested_by}];
  const whoStr = contribs.map(c => c.name || c.id || '?').join(', ');
  const ok = await confirmDialog(
    `ลบ result ของ "${cat.name || resultId}"\nบันทึกโดย ${whoStr} · วันที่ ${r?.test_date || '—'}`,
    'ยืนยันการลบ Result',
    { confirmText: 'ลบ', cancelText: 'ยกเลิก', variant: 'danger' }
  );
  if (!ok) return;
  const month = document.getElementById('month').value;
  const res = await MaTest.api.deleteResult(month, resultId);
  if (!res?.success) { Toast?.error?.(res?.message || 'ลบไม่สำเร็จ'); return; }
  Toast?.success?.('ลบ result แล้ว');
  await load();
}

function closeAll() {
  document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
}
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal-overlay')) closeAll();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const gm = document.getElementById('mt-grafana-modal');
  if (gm && gm.classList.contains('active')) { closeGrafanaPopup(); return; }
  closeAll();
});

document.getElementById('t-save').onclick   = saveTest;
document.getElementById('t-files').onchange = onFilesChange;
document.getElementById('month').onchange   = load;
document.getElementById('f-service').onchange = renderPlan;
document.getElementById('f-status').onchange  = renderPlan;

(function bindPasteZone() {
  const zone = document.getElementById('t-paste-zone');
  const input = document.getElementById('t-files');
  if (!zone || !input) return;
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('is-drag');
  }));
  ['dragleave', 'dragend', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('is-drag');
  }));
  zone.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files && files.length) uploadScreenshotFiles(files);
  });
  document.addEventListener('paste', onPasteScreenshots);
})();

// ── Templates: แจ้งเริ่ม / แจ้งเสร็จ ────────────────────────
// Selected service names — set by the picker inside the template modal.
let _tplSelected = new Set();

function planUniqueNames() {
  const names = [];
  const seen = new Set();
  for (const p of plan) {
    const n = (p.catalog?.name || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names;
}

// "To do" = plan items with no Successed result yet — same rule as the
// left column in renderPlan().
function planTodoNames() {
  const names = [];
  const seen = new Set();
  for (const p of plan) {
    const done = resultsForCatalog(p.catalog_id).some(r => r.result === 'Successed');
    if (done) continue;
    const n = (p.catalog?.name || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names;
}

function planServiceLines() {
  const picked = planUniqueNames().filter(n => _tplSelected.has(n));
  return picked.length
    ? picked.map(n => '- ' + n).join('\n')
    : '- (ยังไม่ได้เลือก service — ติ๊กจากรายการด้านบน)';
}

function responsibleLine() {
  const name = (_u?.name || _u?.username || '').trim();
  return name ? `👤 ผู้รับผิดชอบ: ${name}\n` : '';
}

function buildStartTemplate() {
  return `📢 **[แจ้งให้ทราบการทดสอบ Test MA Pages]**

เรียนทีมงานทุกท่าน
ขณะนี้กำลังดำเนินการ **Test MA Pages** เพื่อทดสอบการทำงานของระบบภายใน

⏱️ ช่วงเวลา: [01:00 – 05:00]
${responsibleLine()}🔧 รายละเอียด: เป็นการทดสอบระบบ อาจมีผลกระทบต่อการใช้งานบางส่วน ช่วงเวลาสั้นๆ
Service ที่ทดสอบ ตามนี้
${planServiceLines()}

ขอบคุณครับ`;
}

function buildEndTemplate() {
  return `✅ **[สิ้นสุดการทดสอบ Test MA Pages]**

ขณะนี้การทดสอบ Test MA Pages เสร็จสิ้นเรียบร้อยแล้ว
ระบบกลับมาใช้งานได้ตามปกติ
${responsibleLine()}Service ที่ทดสอบ ตามนี้
${planServiceLines()}

ขอบคุณครับ 🙏`;
}

// Webhook list is loaded once per page-open of the template modal; cached so
// switching between แจ้งเริ่ม/แจ้งเสร็จ doesn't re-fetch.
let _tplWebhooks = null;
let _tplKind = '';  // 'start' | 'end' — remembered so Send can thread the reply
async function ensureWebhooks() {
  if (_tplWebhooks) return _tplWebhooks;
  const r = await MaTest.api.listWebhooks();
  _tplWebhooks = r?.success ? (r.data?.webhooks || []) : [];
  return _tplWebhooks;
}

function renderWebhookOptions(hooks) {
  const sel = document.getElementById('tpl-webhook');
  const esc = MaTest.escapeHtml;
  sel.innerHTML = hooks.length
    ? '<option value="">— pick Google Chat room —</option>' +
      hooks.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')
    : '<option value="">— ยังไม่มี webhook (ให้ admin ตั้งที่ MA Test Plan) —</option>';
  // Auto-select if there's exactly one — most common case.
  if (hooks.length === 1) sel.value = hooks[0].id;
  document.getElementById('tpl-send').disabled = !sel.value;
}

function renderTplPicker() {
  // Show only the "To do" services — the whole-month list was too noisy.
  const names = planTodoNames();
  const esc = MaTest.escapeHtml;
  const list = document.getElementById('tpl-pick-list');
  if (!names.length) {
    list.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:4px">ไม่มี service ในรายการ To do — ทุกอันของเดือนนี้เทสสำเร็จหมดแล้ว</div>';
  } else {
    list.innerHTML = names.map(n => {
      const checked = _tplSelected.has(n) ? 'checked' : '';
      return `<label style="display:flex; align-items:center; gap:6px; padding:3px 4px; font-size:12px; cursor:pointer">
        <input type="checkbox" class="tpl-pick-item" value="${esc(n)}" ${checked}>
        <span>${esc(n)}</span>
      </label>`;
    }).join('');
    list.querySelectorAll('.tpl-pick-item').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) _tplSelected.add(cb.value);
        else _tplSelected.delete(cb.value);
        refreshTplText();
      });
    });
  }
  document.getElementById('tpl-pick-count').textContent = `${_tplSelected.size} selected`;
}

function refreshTplText() {
  const isEnd = _tplKind === 'end';
  document.getElementById('tpl-txt').value = isEnd ? buildEndTemplate() : buildStartTemplate();
  document.getElementById('tpl-pick-count').textContent = `${_tplSelected.size} selected`;
}

async function openTemplate(kind) {
  const isEnd = kind === 'end';
  _tplKind = isEnd ? 'end' : 'start';
  // Pre-select every service still in the "To do" column — that's what this
  // session is about to test. User can uncheck any they don't want in the
  // announcement.
  _tplSelected = new Set(planTodoNames());
  document.getElementById('tpl-title').textContent = isEnd
    ? '✅ Template — แจ้งเสร็จ Test MA'
    : '📢 Template — แจ้งเริ่ม Test MA';
  renderTplPicker();
  refreshTplText();
  document.getElementById('tpl-info').textContent = isEnd
    ? `Auto จากรายการ To do (${_tplSelected.size} services) · uncheck ที่ไม่ต้องการได้`
    : `Auto จากรายการ To do (${_tplSelected.size} services) · แก้ไข [01:00 – 05:00] ตามจริง`;
  document.getElementById('modal-tpl').classList.add('active');
  renderWebhookOptions(await ensureWebhooks());
}

async function copyTemplate() {
  const txt = document.getElementById('tpl-txt').value;
  try {
    await navigator.clipboard.writeText(txt);
    Toast?.success?.('Copied to clipboard');
  } catch {
    const el = document.getElementById('tpl-txt');
    el.select();
    try { document.execCommand('copy'); Toast?.success?.('Copied'); }
    catch { Toast?.error?.('Copy failed — กรุณาเลือกและ copy ด้วยตัวเอง'); }
  }
}

async function sendTemplate() {
  const btn = document.getElementById('tpl-send');
  const webhookId = document.getElementById('tpl-webhook').value;
  const msg = document.getElementById('tpl-txt').value.trim();
  if (!webhookId) { Toast?.error?.('เลือกห้อง Google Chat ก่อน'); return; }
  if (!msg) { Toast?.error?.('ข้อความว่าง'); return; }
  const roomName = document.getElementById('tpl-webhook').selectedOptions[0]?.textContent || '';
  const ok = await confirmDialog(
    `ส่งข้อความนี้ไปที่ห้อง "${roomName}" ?`,
    'ยืนยันการส่งข้อความ',
    { confirmText: '<i data-icon="rocket"></i> Send', cancelText: 'Cancel', variant: 'primary' }
  );
  if (!ok) return;
  btn.disabled = true;
  const origLabel = btn.textContent;
  btn.textContent = 'Sending…';
  const r = await MaTest.api.notify(webhookId, msg, _tplKind);
  btn.textContent = origLabel;
  btn.disabled = false;
  if (!r?.success) { Toast?.error?.(r?.message || 'Send failed'); return; }
  const suffix = r.data?.threaded
    ? (_tplKind === 'end' ? ' (thread ต่อจากแจ้งเริ่ม)' : ' (เปิด thread ใหม่)')
    : '';
  Toast?.success?.(`ส่งไปที่ "${r.data?.webhook_name || roomName}" แล้ว${suffix}`);
  closeAll();
}

document.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => openTemplate(b.dataset.tpl));
document.getElementById('tpl-copy').onclick   = copyTemplate;
document.getElementById('tpl-send').onclick   = sendTemplate;
document.getElementById('tpl-pick-all').onclick  = () => {
  _tplSelected = new Set(planTodoNames());
  renderTplPicker();
  refreshTplText();
};
document.getElementById('tpl-pick-none').onclick = () => {
  _tplSelected = new Set();
  renderTplPicker();
  refreshTplText();
};
document.getElementById('tpl-webhook').onchange = (e) => {
  document.getElementById('tpl-send').disabled = !e.target.value;
};

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_fetchMonthOnce", { configurable: true, get: () => _fetchMonthOnce, set: (v) => { _fetchMonthOnce = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_mtShowState", { configurable: true, get: () => _mtShowState, set: (v) => { _mtShowState = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_rewriteGrafanaUrl", { configurable: true, get: () => _rewriteGrafanaUrl, set: (v) => { _rewriteGrafanaUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildEndTemplate", { configurable: true, get: () => buildEndTemplate, set: (v) => { buildEndTemplate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildStartTemplate", { configurable: true, get: () => buildStartTemplate, set: (v) => { buildStartTemplate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeAll", { configurable: true, get: () => closeAll, set: (v) => { closeAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyTemplate", { configurable: true, get: () => copyTemplate, set: (v) => { copyTemplate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteResult", { configurable: true, get: () => deleteResult, set: (v) => { deleteResult = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "ensureWebhooks", { configurable: true, get: () => ensureWebhooks, set: (v) => { ensureWebhooks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onFilesChange", { configurable: true, get: () => onFilesChange, set: (v) => { onFilesChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onPasteScreenshots", { configurable: true, get: () => onPasteScreenshots, set: (v) => { onPasteScreenshots = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openTemplate", { configurable: true, get: () => openTemplate, set: (v) => { openTemplate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openTest", { configurable: true, get: () => openTest, set: (v) => { openTest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "planServiceLines", { configurable: true, get: () => planServiceLines, set: (v) => { planServiceLines = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "planTodoNames", { configurable: true, get: () => planTodoNames, set: (v) => { planTodoNames = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "planUniqueNames", { configurable: true, get: () => planUniqueNames, set: (v) => { planUniqueNames = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshTplText", { configurable: true, get: () => refreshTplText, set: (v) => { refreshTplText = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPlan", { configurable: true, get: () => renderPlan, set: (v) => { renderPlan = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderThumbs", { configurable: true, get: () => renderThumbs, set: (v) => { renderThumbs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTplPicker", { configurable: true, get: () => renderTplPicker, set: (v) => { renderTplPicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderWebhookOptions", { configurable: true, get: () => renderWebhookOptions, set: (v) => { renderWebhookOptions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "responsibleLine", { configurable: true, get: () => responsibleLine, set: (v) => { responsibleLine = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resultsForCatalog", { configurable: true, get: () => resultsForCatalog, set: (v) => { resultsForCatalog = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveTest", { configurable: true, get: () => saveTest, set: (v) => { saveTest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendTemplate", { configurable: true, get: () => sendTemplate, set: (v) => { sendTemplate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "uploadScreenshotFiles", { configurable: true, get: () => uploadScreenshotFiles, set: (v) => { uploadScreenshotFiles = v; } }); } catch (e) {}
})();
