// admin/super-feature-requests — page script, extracted from admin/super-feature-requests.html.
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
if (Auth.getUser()?.role !== 'super_admin') window.location.href = './index.html';
Layout.render('super-feature-requests');
Auth.initUserUI();

let _reqStatus = 'pending'; // pending | approved | denied | '' (all)

document.addEventListener('DOMContentLoaded', () => loadFeatureRequests());

function switchReqTab(status) {
  _reqStatus = status;
  document.querySelectorAll('.req-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.status === status);
  });
  loadFeatureRequests();
}

async function loadFeatureRequests() {
  const res = await API.featureRequests.list(_reqStatus || null);
  const list  = document.getElementById('requests-list');
  const badge = document.getElementById('requests-count-badge');
  if (!res?.ok) { list.innerHTML = '<div class="fr-empty">Failed to load requests</div>'; return; }
  const requests = res.data?.data?.requests || res.data?.requests || [];
  badge.textContent = requests.length;

  if (!requests.length) {
    const emptyMsg = _reqStatus ? `No ${_reqStatus} requests` : 'No requests yet';
    list.innerHTML = `<div class="fr-empty">${emptyMsg}</div>`;
    return;
  }

  list.innerHTML = requests.map(r => {
    const meta   = r.feature_meta || {};
    const when   = new Date(r.requested_at).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' });
    const status = r.status || 'pending';
    const isPending = status === 'pending';

    const rightBlock = isPending
      ? `<div class="req-actions">
           <button class="req-btn approve"
                   onclick='resolveRequest("${r.id}","approve","${r.feature_key}",${JSON.stringify(r.feature_meta||{})})'>Approve</button>
           <button class="req-btn deny"
                   onclick='resolveRequest("${r.id}","deny","${r.feature_key}",${JSON.stringify(r.feature_meta||{})})'>Deny</button>
         </div>`
      : `<span class="req-resolved-badge ${status}">${status === 'approved' ? '✓ Approved' : '✗ Denied'}</span>`;

    let resolvedLine = '';
    if (!isPending) {
      const reviewedWhen = r.reviewed_at
        ? new Date(r.reviewed_at).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' })
        : '—';
      resolvedLine = `
        <div class="req-resolved-info">
          By ${escHtml(r.reviewer_name || '?')} · ${reviewedWhen}
          ${r.review_note ? ` · <em>"${escHtml(r.review_note)}"</em>` : ''}
        </div>`;
    }

    return `
      <div class="req-row ${status}" id="req-${r.id}">
        <div class="req-icon">${meta.icon || '⚡'}</div>
        <div class="req-body">
          <div class="req-title">
            ${escHtml(meta.label || r.feature_key)}
            <span class="req-team-chip">${escHtml(r.team_slug)}</span>
          </div>
          ${r.reason ? `<div class="req-reason">"${escHtml(r.reason)}"</div>` : ''}
          <div class="req-meta">By ${escHtml(r.requester_name)} · ${when}</div>
          ${resolvedLine}
        </div>
        ${rightBlock}
      </div>`;
  }).join('');
}

async function resolveRequest(id, action, featureKey, featureMeta) {
  if (action === 'deny') {
    const note = window.prompt(`Reason for denying "${featureMeta?.label || featureKey}" (optional):`);
    if (note === null) return;
    const res = await API.featureRequests.resolve(id, 'deny', note || '');
    if (res?.ok) { Toast.success('<i data-icon="x-circle"></i> Denied.'); await loadFeatureRequests(); }
    else Toast.error(res?.data?.message || 'Failed');
    return;
  }

  // ── Approve: show page-selection modal ──────────────────────────────────
  const userPages  = featureMeta?.user_pages  || [];
  const adminPages = featureMeta?.admin_pages || [];
  const allPages   = [...userPages.map(p => ({id:p, type:'user'})),
                      ...adminPages.map(p => ({id:p, type:'admin'}))];

  const listHtml = allPages.length === 0
    ? '<p style="font-size:12px;color:var(--text-muted);">No specific pages for this feature.</p>'
    : `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
        ${allPages.map(p => `
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
            <input type="checkbox" class="pg-cb" data-id="${p.id}" data-type="${p.type}" checked
              style="accent-color:var(--orange);width:14px;height:14px;">
            <span>${p.type === 'admin' ? '⚙ admin/' : '📄 '}${p.id}.html</span>
            <span style="font-size:10px;color:var(--text-muted);">${p.type === 'admin' ? 'Config' : 'Page'}</span>
          </label>`).join('')}
       </div>`;

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg-card);border-radius:16px;padding:28px;width:90%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <h3 style="font-size:16px;font-weight:800;margin-bottom:6px;">
        <i data-icon="check-circle"></i> Approve: ${featureMeta?.icon||'⚡'} ${featureMeta?.label||featureKey}
      </h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:16px;">
        เลือกหน้าที่ทีมนี้จะเข้าถึงได้ — uncheck หน้าที่ยังไม่ต้องการให้
      </p>
      ${listHtml}
      <div class="form-group" style="margin-bottom:20px;">
        <label class="form-label" style="font-size:11px;">Note (optional)</label>
        <input type="text" id="approve-note" class="form-control" placeholder="ข้อความถึง team admin..." style="font-size:12px;">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" onclick="this.closest('[style*=fixed]').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="confirm-approve-btn"><i data-icon="check-circle"></i> Confirm Approve</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('confirm-approve-btn').onclick = async () => {
    const note   = document.getElementById('approve-note').value.trim();
    const cbs    = modal.querySelectorAll('.pg-cb');
    const uPages = [], aPages = [];
    cbs.forEach(cb => {
      if (cb.checked) {
        if (cb.dataset.type === 'user')  uPages.push(cb.dataset.id);
        else                             aPages.push(cb.dataset.id);
      }
    });
    const grantedPages = allPages.length > 0
      ? { user_pages: uPages, admin_pages: aPages }
      : null;

    modal.remove();
    const res = await API.featureRequests.resolve(id, 'approve', note, grantedPages);
    if (res?.ok) { Toast.success('<i data-icon="check-circle"></i> Approved! Feature provisioned.'); await loadFeatureRequests(); }
    else Toast.error(res?.data?.message || 'Failed');
  };
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                       .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFeatureRequests", { configurable: true, get: () => loadFeatureRequests, set: (v) => { loadFeatureRequests = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resolveRequest", { configurable: true, get: () => resolveRequest, set: (v) => { resolveRequest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchReqTab", { configurable: true, get: () => switchReqTab, set: (v) => { switchReqTab = v; } }); } catch (e) {}
})();
