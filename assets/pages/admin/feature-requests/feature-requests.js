// admin/feature-requests — page script, extracted from admin/feature-requests.html.
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
Layout.render('feature-requests');

let _catalogue    = {};
let _teamFeatures = [];
let _myRequests   = [];
let _pendingReqKeys = new Set(); // features with pending requests
let _currentFeatureKey = null;

document.addEventListener('DOMContentLoaded', () => {
  Auth.initUserUI();
  loadAll();
  // Start periodic refresh check — catches approvals even if user stays on this page
  setInterval(checkFeaturesUpdate, 30000); // every 30s
});

async function checkFeaturesUpdate() {
  const changed = await Auth.refreshTeamFeatures?.();
  if (changed) {
    // Show banner instead of instant reload so user knows why page is refreshing
    const banner = document.getElementById('update-banner');
    if (banner) banner.style.display = '';
    setTimeout(() => window.location.reload(), 2500);
  }
}

async function loadAll() {
  const res = await API.featureRequests.list();
  if (!res?.ok) { Toast.error('Failed to load data'); return; }

  const d = res.data?.data || res.data || {};
  _catalogue    = d.catalogue    || {};
  _teamFeatures = d.team_features || [];
  _myRequests   = d.requests     || [];

  // Count pending for badge
  const pending = _myRequests.filter(r => r.status === 'pending');
  const badge = document.getElementById('pending-badge');
  if (pending.length > 0) { badge.textContent = pending.length; badge.style.display = ''; }

  // Build pending request key set
  _pendingReqKeys = new Set(_myRequests.filter(r => r.status === 'pending').map(r => r.feature_key));

  renderCatalogue();
  renderHistory();
}

function renderCatalogue() {
  const grid = document.getElementById('catalogue-grid');
  const entries = Object.entries(_catalogue);
  if (!entries.length) { grid.innerHTML = '<div style="color:var(--text-muted);">No requestable features.</div>'; return; }

  grid.innerHTML = entries.map(([key, f]) => {
    const owned   = _teamFeatures.includes(key);
    const pending = _pendingReqKeys.has(key);
    const cardCls = owned ? 'feat-card has-feature' : pending ? 'feat-card pending-req' : 'feat-card';
    const statusEl = owned
      ? `<span class="feat-status owned"><i data-icon="check"></i> Active</span>`
      : pending
        ? `<span class="feat-status pending">⏳ Pending</span>`
        : '';
    const btn = (!owned && !pending)
      ? `<button class="btn btn-outline btn-sm" onclick="openModal('${key}')"><i data-icon="upload"></i> Request</button>`
      : '';
    return `
      <div class="${cardCls}">
        <div class="feat-header">
          <span class="feat-icon">${f.icon}</span>
          <span class="feat-name">${f.label}</span>
        </div>
        <div class="feat-desc">${f.desc}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          ${statusEl}
          ${btn}
        </div>
      </div>`;
  }).join('');
}

function renderHistory() {
  const list = document.getElementById('req-list');
  if (!_myRequests.length) {
    list.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;">ยังไม่มี request ครับ — ไปที่ Available Features เพื่อขอ feature ใหม่</div>';
    return;
  }
  list.innerHTML = [..._myRequests].reverse().map(r => {
    const meta = r.feature_meta || {};
    const statusCls = `status-${r.status}`;
    const statusLabel = r.status === 'pending' ? '⏳ รอ review' : r.status === 'approved' ? '<i data-icon="check-circle"></i> Approved' : '<i data-icon="x-circle"></i> Denied';
    const noteHtml = r.review_note ? `<div class="req-note"><i data-icon="message-circle"></i> Note: ${r.review_note}</div>` : '';
    const reviewedHtml = r.reviewed_at
      ? `<span>Reviewed ${new Date(r.reviewed_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}</span>`
      : '';
    return `
      <div class="req-card">
        <div class="req-icon">${meta.icon || '⚡'}</div>
        <div class="req-body">
          <div class="req-title">${meta.label || r.feature_key}</div>
          ${r.reason ? `<div class="req-reason">"${r.reason}"</div>` : ''}
          <div class="req-meta">
            <span>ยื่นเมื่อ ${new Date(r.requested_at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}</span>
            ${reviewedHtml ? ' · ' + reviewedHtml : ''}
          </div>
          ${noteHtml}
        </div>
        <span class="status-pill ${statusCls}">${statusLabel}</span>
      </div>`;
  }).join('');
}

// ── Modal ────────────────────────────────────────────────────────────────────
function openModal(key) {
  const f = _catalogue[key] || {};
  _currentFeatureKey = key;
  document.getElementById('modal-title').textContent = `${f.icon || '⚡'} ${f.label || key}`;
  document.getElementById('modal-desc').textContent = f.desc || '';
  document.getElementById('req-reason').value = '';
  document.getElementById('req-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('req-reason').focus(), 50);
}
function closeModal() {
  document.getElementById('req-modal').style.display = 'none';
  _currentFeatureKey = null;
}
document.getElementById('req-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

async function submitRequest() {
  const reason = document.getElementById('req-reason').value.trim();
  if (!reason) { Toast.warning('กรุณาระบุเหตุผลก่อนครับ'); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Submitting...';

  const res = await API.featureRequests.submit({
    feature_key: _currentFeatureKey,
    reason,
  });

  btn.disabled = false; btn.innerHTML = '<i data-icon="upload"></i> Submit Request';

  if (res?.ok) {
    Toast.success('ส่ง request แล้ว! รอ super admin approve ครับ');
    closeModal();
    await loadAll(); // refresh
  } else {
    Toast.error(res?.data?.message || 'Failed to submit request');
  }
}

// ── Tab switch ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tab-catalogue').style.display = tab === 'catalogue' ? '' : 'none';
  document.getElementById('tab-history').style.display   = tab === 'history'   ? '' : 'none';
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "checkFeaturesUpdate", { configurable: true, get: () => checkFeaturesUpdate, set: (v) => { checkFeaturesUpdate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCatalogue", { configurable: true, get: () => renderCatalogue, set: (v) => { renderCatalogue = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHistory", { configurable: true, get: () => renderHistory, set: (v) => { renderHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitRequest", { configurable: true, get: () => submitRequest, set: (v) => { submitRequest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
})();
