// admin/about-page — page script, extracted from admin/about-page.html.
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
Layout.render('admin');

const ICON_OPTIONS = ['monitor','bell','server','git-merge','bar-chart','shield','database','cpu','zap','activity','layers','eye','phone','mail','message-circle','calendar','users','settings','star','bookmark'];

// ── Render service rows ──────────────────────────────────────────────────────
function renderServices(services) {
  document.getElementById('services-list').innerHTML = (services||[]).map((s,i)=>`
    <div class="ap-item" id="svc-${i}">
      <select class="form-control" style="max-width:120px" id="svc-icon-${i}">
        ${ICON_OPTIONS.map(ic=>`<option value="${ic}"${s.icon===ic?' selected':''}>${ic}</option>`).join('')}
      </select>
      <input class="form-control" placeholder="ชื่อ Service" value="${escHtml(s.title||'')}" id="svc-title-${i}">
      <input class="form-control" placeholder="รายละเอียด" value="${escHtml(s.desc||'')}" id="svc-desc-${i}">
      <button class="ap-item-del" onclick="delService(${i})">×</button>
    </div>`).join('');
}
function addService() {
  const svcs = collectServices();
  svcs.push({icon:'star',title:'',desc:''});
  renderServices(svcs);
}
function delService(i) { const s=collectServices(); s.splice(i,1); renderServices(s); }
function collectServices() {
  return [...document.querySelectorAll('[id^="svc-icon-"]')].map((_,i)=>({
    icon:  document.getElementById(`svc-icon-${i}`)?.value  || 'star',
    title: document.getElementById(`svc-title-${i}`)?.value.trim() || '',
    desc:  document.getElementById(`svc-desc-${i}`)?.value.trim()  || '',
  }));
}

// ── Render contact rows ──────────────────────────────────────────────────────
function renderContacts(contacts) {
  document.getElementById('contacts-list').innerHTML = (contacts||[]).map((c,i)=>`
    <div class="ap-item" id="con-${i}">
      <select class="form-control" style="max-width:130px" id="con-icon-${i}">
        ${ICON_OPTIONS.map(ic=>`<option value="${ic}"${c.icon===ic?' selected':''}>${ic}</option>`).join('')}
      </select>
      <input class="form-control" placeholder="Label เช่น Google Chat" value="${escHtml(c.label||'')}" id="con-label-${i}">
      <input class="form-control" placeholder="Value เช่น som-team@…" value="${escHtml(c.value||'')}" id="con-value-${i}">
      <button class="ap-item-del" onclick="delContact(${i})">×</button>
    </div>`).join('');
}
function addContact() { const c=collectContacts(); c.push({icon:'phone',label:'',value:''}); renderContacts(c); }
function delContact(i) { const c=collectContacts(); c.splice(i,1); renderContacts(c); }
function collectContacts() {
  return [...document.querySelectorAll('[id^="con-icon-"]')].map((_,i)=>({
    icon:  document.getElementById(`con-icon-${i}`)?.value  || 'phone',
    label: document.getElementById(`con-label-${i}`)?.value.trim() || '',
    value: document.getElementById(`con-value-${i}`)?.value.trim() || '',
  }));
}

// ── Org team checkboxes ──────────────────────────────────────────────────────
let _allTeamSlugs = [];
function renderOrgChecks(orgTeams, allTeams) {
  _allTeamSlugs = allTeams.map(t=>t.slug);
  const checked = new Set(orgTeams);
  document.getElementById('org-team-checks').innerHTML = allTeams.map(t=>
    `<label class="ap-team-chip">
      <input type="checkbox" value="${t.slug}" ${checked.has(t.slug)?'checked':''}>
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color||'#6366f1'}"></span>
      ${escHtml(t.name)} <span style="font-size:9px;color:var(--text-muted);font-family:monospace">/${t.slug}</span>
    </label>`
  ).join('');
}
function collectOrgTeams() {
  return [...document.querySelectorAll('#org-team-checks input[type=checkbox]:checked')].map(el=>el.value);
}

// ── Head of Ops (manual freeform) ────────────────────────────────────────────
function loadHeadOfOps(hop) {
  if (!hop) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('hop-name',     hop.name);
  set('hop-nickname', hop.nickname);
  set('hop-position', hop.position);
  set('hop-email',    hop.email);
  set('hop-avatar',   hop.avatar_url);
  updateHopPreview();
}
function collectHeadOfOps() {
  const g = id => document.getElementById(id)?.value.trim() || '';
  return { name: g('hop-name'), nickname: g('hop-nickname'), position: g('hop-position'), email: g('hop-email'), avatar_url: g('hop-avatar') };
}
function updateHopPreview() {
  const url  = document.getElementById('hop-avatar')?.value.trim();
  const name = document.getElementById('hop-name')?.value.trim() || '?';
  const ini  = name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const prev = document.getElementById('hop-preview');
  if (!prev) return;
  prev.innerHTML = url
    ? `<img src="${escHtml(url)}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--border)" onerror="this.style.display='none'">`
    : `<div style="width:44px;height:44px;border-radius:50%;background:color-mix(in srgb,var(--orange) 12%,var(--bg));border:2px solid color-mix(in srgb,var(--orange) 30%,var(--border));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:var(--orange)">${escHtml(ini)}</div>`;
}
// live avatar preview
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hop-avatar')?.addEventListener('input', updateHopPreview);
});

// ── Head manager checkboxes ───────────────────────────────────────────────────
function renderHeadManagerChecks(allManagers, headManagerIds) {
  const checkedSet = new Set(headManagerIds || []);
  const el = document.getElementById('head-manager-checks');
  if (!el) return;
  el.innerHTML = allManagers.length
    ? allManagers.map(m => {
        const ini = (m.name||'?').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
        const av = m.avatar_url
          ? `<img src="${escHtml(m.avatar_url)}" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1.5px solid var(--border)">`
          : `<span style="width:24px;height:24px;border-radius:50%;background:var(--bg);border:1.5px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:var(--text-muted);flex-shrink:0">${escHtml(ini)}</span>`;
        return `<label class="ap-team-chip" style="gap:8px">
          <input type="checkbox" name="head-mgr" value="${escHtml(m.id)}" ${checkedSet.has(m.id) ? 'checked' : ''}>
          ${av}
          <span style="font-size:12px;font-weight:600">${escHtml(m.name)}</span>
          ${m.nickname ? `<span style="font-size:9.5px;color:var(--text-muted)">(${escHtml(m.nickname)})</span>` : ''}
        </label>`;
      }).join('')
    : '<div style="color:var(--text-muted);font-size:12px">ยังไม่มีผู้ใช้ที่มี role super_viewer</div>';
}
function collectHeadManagerIds() {
  return [...document.querySelectorAll('#head-manager-checks input[type=checkbox]:checked')].map(el => el.value);
}

// ── Manager checkboxes ───────────────────────────────────────────────────────
function renderManagerChecks(allManagers, managerIds) {
  const checkedSet = new Set(managerIds || []);
  document.getElementById('manager-checks').innerHTML = allManagers.length
    ? allManagers.map(m => {
        const initials = (m.name||'?').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
        const av = m.avatar_url
          ? `<img src="${escHtml(m.avatar_url)}" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1.5px solid var(--border)">`
          : `<span style="width:24px;height:24px;border-radius:50%;background:var(--bg);border:1.5px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:var(--text-muted);flex-shrink:0">${escHtml(initials)}</span>`;
        return `<label class="ap-team-chip" style="gap:8px">
          <input type="checkbox" value="${escHtml(m.id)}" ${(checkedSet.size === 0 || checkedSet.has(m.id)) ? 'checked' : ''}>
          ${av}
          <span style="font-size:12px;font-weight:600">${escHtml(m.name)}</span>
          ${m.nickname ? `<span style="font-size:9.5px;color:var(--text-muted)">(${escHtml(m.nickname)})</span>` : ''}
        </label>`;
      }).join('')
    : '<div style="color:var(--text-muted);font-size:12px">ยังไม่มีผู้ใช้ที่มี role super_viewer</div>';
}
function collectManagerIds() {
  return [...document.querySelectorAll('#manager-checks input[type=checkbox]:checked')].map(el => el.value);
}

function renderTeamDescs(descs, allTeams, teamLeaders, orgTeams) {
  document.getElementById('team-descs-list').innerHTML = allTeams.map(t => {
    // Find members for this team from orgTeams (may be undefined if team not in org chart)
    const ot = (orgTeams || []).find(o => o.slug === t.slug);
    const members = ot?.members || [];
    const currentLeaders = new Set((teamLeaders || {})[t.slug] || []);
    const leaderSelect = members.length ? `
      <div style="margin-top:8px">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px">
          <i data-icon="crown" style="width:12px;height:12px;color:#f59e0b;flex-shrink:0"></i>
          <span style="font-size:10.5px;font-weight:700;color:var(--text-muted)">Team Leader <span style="font-weight:400">(เลือกได้หลายคน)</span></span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${members.map(m => {
            const initials = (m.name||'?').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
            const av = m.avatar_url
              ? `<img src="${escHtml(m.avatar_url)}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0">`
              : `<span style="width:20px;height:20px;border-radius:50%;background:var(--bg-card);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:7px;font-weight:800;color:var(--text-muted);flex-shrink:0">${escHtml(initials)}</span>`;
            return `<label class="ap-team-chip" style="gap:6px;padding:3px 10px 3px 6px">
              <input type="checkbox" class="leader-cb-${t.slug}" value="${escHtml(m.id)}" ${currentLeaders.has(m.id) ? 'checked' : ''}>
              ${av}
              <span style="font-size:11px">${escHtml(m.name)}${m.nickname ? ` <span style="color:var(--text-muted);font-size:9.5px">(${escHtml(m.nickname)})</span>` : ''}</span>
            </label>`;
          }).join('')}
        </div>
      </div>` : '';
    return `
    <div class="ap-item" style="flex-direction:column;align-items:flex-start;gap:6px;padding:12px">
      <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--text)">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color||'#6366f1'}"></span>
        ${escHtml(t.name)} <span style="font-size:9.5px;color:var(--text-muted);font-family:monospace">/${t.slug}</span>
      </div>
      <textarea id="td-${t.slug}" class="form-control" rows="2" placeholder="อธิบายว่าทีมนี้ทำอะไรบ้าง…" style="resize:vertical;font-size:12px">${escHtml(descs[t.slug]||'')}</textarea>
      ${leaderSelect}
    </div>`;
  }).join('');
  if (typeof window.Icons !== 'undefined') window.Icons.replace?.();
}
function collectTeamDescs() {
  const out = {};
  document.querySelectorAll('[id^="td-"]').forEach(el => {
    const slug = el.id.slice(3);
    const val = el.value.trim();
    if (val) out[slug] = val;
  });
  return out;
}
function collectTeamLeaders() {
  const out = {};
  // Find all unique team slugs that have leader checkboxes
  document.querySelectorAll('[class^="leader-cb-"]').forEach(cb => {
    const cls = [...cb.classList].find(c => c.startsWith('leader-cb-'));
    if (!cls) return;
    const slug = cls.slice('leader-cb-'.length);
    if (!out[slug]) out[slug] = [];
    if (cb.checked) out[slug].push(cb.value);
  });
  return out;
}

// ── Team Info accordion ──────────────────────────────────────────────────────
const ICON_LIST = ['monitor','headphones','search','bar-chart-2','alert-triangle','git-branch','landmark','users','bell','server','shield','activity','cpu','zap','layers','eye','database','star','bookmark','tool'];

function renderTeamInfoAccordion(allTeams, teamInfo) {
  const wrap = document.getElementById('team-info-accordion');
  if (!wrap) return;
  wrap.innerHTML = allTeams.map(t => {
    const ti = teamInfo[t.slug] || {};
    const kpis    = (ti.kpis || []).join('\n');
    const resps   = (ti.responsibilities || []).join('\n');
    const tools   = (ti.tools || []).join('\n');
    const iconOpts = ICON_LIST.map(ic => `<option value="${ic}"${ti.icon===ic?' selected':''}>${ic}</option>`).join('');
    return `
    <div class="ti-accord" id="tia-${t.slug}">
      <button class="ti-accord-head" onclick="toggleAccord('${t.slug}')">
        <span class="ti-accord-dot" style="background:${t.color||'#6366f1'}"></span>
        <span class="ti-accord-label">${escHtml(t.name)}
          <span style="font-size:9.5px;color:var(--text-muted);font-family:monospace;font-weight:400"> /${t.slug}</span>
          ${ti.abbr ? `<span style="font-size:9.5px;background:color-mix(in srgb,${t.color||'#6366f1'} 12%,transparent);color:${t.color||'#6366f1'};border:1px solid color-mix(in srgb,${t.color||'#6366f1'} 25%,transparent);padding:1px 7px;border-radius:4px;margin-left:6px">${escHtml(ti.abbr)}</span>` : ''}
        </span>
        <svg class="ti-accord-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <div class="ti-accord-body">
        <div class="ti-row">
          <div class="form-group" style="margin:0">
            <label class="form-label">Abbreviation (เช่น SM, TS, IMPB)</label>
            <input class="form-control" id="ti-abbr-${t.slug}" value="${escHtml(ti.abbr||'')}" placeholder="SM">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Full Name (ชื่อทีมเต็ม)</label>
            <input class="form-control" id="ti-fullname-${t.slug}" value="${escHtml(ti.full_name||'')}" placeholder="Service Monitoring">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Icon</label>
            <select class="form-control" id="ti-icon-${t.slug}">${iconOpts}</select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Working Hours</label>
            <input class="form-control" id="ti-hours-${t.slug}" value="${escHtml(ti.hours||'')}" placeholder="9:00–18:00">
          </div>
          <div class="form-group ti-full" style="margin:0">
            <label class="form-label">KPI <span style="font-weight:400;color:var(--text-muted)">(แต่ละข้อ 1 บรรทัด)</span></label>
            <textarea class="form-control" id="ti-kpis-${t.slug}" rows="3" placeholder="Monitoring&#10;Incident Detection">${escHtml((ti.kpis||[]).join('\n'))}</textarea>
          </div>
          <div class="form-group ti-full" style="margin:0">
            <label class="form-label">Responsibilities / What We Do <span style="font-weight:400;color:var(--text-muted)">(แต่ละข้อ 1 บรรทัด)</span></label>
            <textarea class="form-control" id="ti-resp-${t.slug}" rows="5" placeholder="Real-time Monitoring 24/7&#10;Reporter &amp; Test service">${escHtml((ti.responsibilities||[]).join('\n'))}</textarea>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Contact Email</label>
            <input class="form-control" id="ti-email-${t.slug}" type="email" value="${escHtml(ti.contact_email||'')}" placeholder="team@ascendcorp.com">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Contact Tel</label>
            <input class="form-control" id="ti-tel-${t.slug}" value="${escHtml(ti.contact_tel||'')}" placeholder="091-xxx-xxxx">
          </div>
          <div class="form-group ti-full" style="margin:0">
            <label class="form-label">Tools <span style="font-weight:400;color:var(--text-muted)">(แต่ละ tool 1 บรรทัด)</span></label>
            <textarea class="form-control" id="ti-tools-${t.slug}" rows="3" placeholder="Grafana&#10;Jira&#10;LINE">${escHtml((ti.tools||[]).join('\n'))}</textarea>
          </div>
          <div class="form-group ti-full" style="margin:0">
            <label class="form-label">SLA (ถ้ามี เช่น "SLA Ticket ≤ 72 Hours")</label>
            <input class="form-control" id="ti-sla-${t.slug}" value="${escHtml(ti.sla||'')}" placeholder="SLA Ticket ≤ 72 Hours">
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  if (window.Icons) Icons.renderAll?.() || Icons.replace?.();
}

function toggleAccord(slug) {
  const el = document.getElementById(`tia-${slug}`);
  if (el) el.classList.toggle('open');
}

function collectTeamInfo() {
  const out = {};
  document.querySelectorAll('[id^="ti-abbr-"]').forEach(el => {
    const slug = el.id.slice('ti-abbr-'.length);
    const splitLines = id => (document.getElementById(id)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    out[slug] = {
      abbr:            document.getElementById(`ti-abbr-${slug}`)?.value.trim() || '',
      full_name:       document.getElementById(`ti-fullname-${slug}`)?.value.trim() || '',
      icon:            document.getElementById(`ti-icon-${slug}`)?.value || 'users',
      hours:           document.getElementById(`ti-hours-${slug}`)?.value.trim() || '',
      kpis:            splitLines(`ti-kpis-${slug}`),
      responsibilities: splitLines(`ti-resp-${slug}`),
      contact_email:   document.getElementById(`ti-email-${slug}`)?.value.trim() || '',
      contact_tel:     document.getElementById(`ti-tel-${slug}`)?.value.trim() || '',
      tools:           splitLines(`ti-tools-${slug}`),
      sla:             document.getElementById(`ti-sla-${slug}`)?.value.trim() || '',
    };
  });
  return out;
}

// ── Load ─────────────────────────────────────────────────────────────────────
async function loadPage() {
  const res = await API.aboutPage.get();
  if (!res?.ok) { Toast.error('โหลดไม่ได้'); return; }
  const d = res.data?.data || res.data;
  // Use all_teams from about-page API — guaranteed to have all org teams
  // regardless of the calling user's role (sm_admin sees only own team via teams API)
  const allTeams = d.all_teams || [];

  document.getElementById('ap-mission').value = d.mission || '';
  document.getElementById('ap-vision').value  = d.vision  || '';
  renderServices(d.services || []);
  renderContacts(d.contacts || []);
  loadHeadOfOps(d.head_of_ops || {});
  renderHeadManagerChecks(d.all_managers || [], d.head_manager_ids || []);
  renderManagerChecks(d.all_managers || [], d.manager_ids || []);
  renderOrgChecks((d.org_teams || []).map(t => t.slug || t), allTeams);
  renderTeamDescs(d.team_descs || {}, allTeams, d.team_leaders || {}, d.org_teams || []);
  renderTeamInfoAccordion(allTeams, d.team_info || {});
}

// ── Save ─────────────────────────────────────────────────────────────────────
async function savePage() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> Saving…';
  const body = {
    mission:      document.getElementById('ap-mission').value.trim(),
    vision:       document.getElementById('ap-vision').value.trim(),
    services:     collectServices(),
    contacts:     collectContacts(),
    head_of_ops:      collectHeadOfOps(),
    head_manager_ids: collectHeadManagerIds(),
    manager_ids:      collectManagerIds(),
    org_teams:    collectOrgTeams(),
    team_descs:   collectTeamDescs(),
    team_leaders: collectTeamLeaders(),
    team_info:    collectTeamInfo(),
  };
  const res = await API.aboutPage.update(body);
  btn.disabled = false; btn.innerHTML = '<i data-icon="save"></i> Save Changes';
  if (res?.ok) Toast.success('บันทึกเรียบร้อยแล้ว');
  else Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
  if (typeof window.Icons !== 'undefined') window.Icons.replace?.();
}

loadPage();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addContact", { configurable: true, get: () => addContact, set: (v) => { addContact = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addService", { configurable: true, get: () => addService, set: (v) => { addService = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectContacts", { configurable: true, get: () => collectContacts, set: (v) => { collectContacts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectHeadManagerIds", { configurable: true, get: () => collectHeadManagerIds, set: (v) => { collectHeadManagerIds = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectHeadOfOps", { configurable: true, get: () => collectHeadOfOps, set: (v) => { collectHeadOfOps = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectManagerIds", { configurable: true, get: () => collectManagerIds, set: (v) => { collectManagerIds = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectOrgTeams", { configurable: true, get: () => collectOrgTeams, set: (v) => { collectOrgTeams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectServices", { configurable: true, get: () => collectServices, set: (v) => { collectServices = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectTeamDescs", { configurable: true, get: () => collectTeamDescs, set: (v) => { collectTeamDescs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectTeamInfo", { configurable: true, get: () => collectTeamInfo, set: (v) => { collectTeamInfo = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectTeamLeaders", { configurable: true, get: () => collectTeamLeaders, set: (v) => { collectTeamLeaders = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "delContact", { configurable: true, get: () => delContact, set: (v) => { delContact = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "delService", { configurable: true, get: () => delService, set: (v) => { delService = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHeadOfOps", { configurable: true, get: () => loadHeadOfOps, set: (v) => { loadHeadOfOps = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPage", { configurable: true, get: () => loadPage, set: (v) => { loadPage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderContacts", { configurable: true, get: () => renderContacts, set: (v) => { renderContacts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHeadManagerChecks", { configurable: true, get: () => renderHeadManagerChecks, set: (v) => { renderHeadManagerChecks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderManagerChecks", { configurable: true, get: () => renderManagerChecks, set: (v) => { renderManagerChecks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderOrgChecks", { configurable: true, get: () => renderOrgChecks, set: (v) => { renderOrgChecks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderServices", { configurable: true, get: () => renderServices, set: (v) => { renderServices = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTeamDescs", { configurable: true, get: () => renderTeamDescs, set: (v) => { renderTeamDescs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTeamInfoAccordion", { configurable: true, get: () => renderTeamInfoAccordion, set: (v) => { renderTeamInfoAccordion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "savePage", { configurable: true, get: () => savePage, set: (v) => { savePage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleAccord", { configurable: true, get: () => toggleAccord, set: (v) => { toggleAccord = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateHopPreview", { configurable: true, get: () => updateHopPreview, set: (v) => { updateHopPreview = v; } }); } catch (e) {}
})();
