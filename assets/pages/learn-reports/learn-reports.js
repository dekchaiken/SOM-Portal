// learn-reports — page script, extracted from learn-reports.html.
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

  (() => {
    const u = Auth.getUser();
    if (!['super_viewer', 'super_admin'].includes(u?.role)) {
      location.replace('./dashboard.html');
    }
  })();

  Layout.render('learn-reports');

  let _courses = [];
  let _progReport = null;
  let _teamsById = {};
  (() => {
    try {
      const raw = sessionStorage.getItem('_sa_teams_data');
      (JSON.parse(raw || '[]') || []).forEach(t => {
        if (t?.slug) _teamsById[t.slug] = t;
      });
    } catch {}
  })();
  function teamPill(slug) {
    if (!slug) return '<span class="pill pill-gray">—</span>';
    const t = _teamsById[slug] || {};
    const label = (t.name || slug).toUpperCase();
    const color = t.color || '#6366F1';
    return `<span class="team-pill" title="${escHtml(t.name || slug)}"
      style="--tp-color:${color}">${escHtml(label)}</span>`;
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });

  async function loadCourses() {
    const res = await API.courses.listCourses();
    if (!res?.ok) return;
    _courses = res.data.data || [];
    const sel = document.getElementById('prog-course-filter');
    _courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.icon || '📘'} ${c.title}`;
      sel.appendChild(opt);
    });
  }

  async function loadProgress() {
    const cid = document.getElementById('prog-course-filter').value || '';
    const wrap = document.getElementById('progress-table');
    wrap.innerHTML = '<div data-skel="text" data-rows="6"></div>';

    const res = await API.courses.allProgress(cid);
    if (!res?.ok) {
      Toast.error('โหลด progress ไม่สำเร็จ');
      wrap.innerHTML = '<div class="empty-state"><p>โหลดข้อมูลไม่สำเร็จ</p></div>';
      return;
    }
    _progReport = res.data.data || {};
    const stats = _progReport.stats || {};
    document.getElementById('st-total').textContent  = stats.users_total       || 0;
    document.getElementById('st-done').textContent   = stats.users_completed   || 0;
    document.getElementById('st-inprog').textContent = stats.users_in_progress || 0;
    document.getElementById('st-none').textContent   = stats.users_not_started || 0;
    document.getElementById('st-avg').textContent    = (stats.avg_percent      || 0) + '%';

    const users = _progReport.users || [];
    if (!users.length) {
      wrap.innerHTML = '<div class="empty-state"><p>ยังไม่มีข้อมูล</p></div>';
      return;
    }

    wrap.innerHTML = `<div class="table-wrap"><table>
      <thead><tr>
        <th>ชื่อ</th><th>Team</th><th>Role</th><th>ความคืบหน้า</th><th>ผ่าน / ทั้งหมด</th><th>รอบที่ลอง</th><th>สถานะ</th><th>Active ล่าสุด</th><th></th>
      </tr></thead>
      <tbody>
        ${users.map(r => `<tr>
          <td style="font-weight:600">${escHtml(r.name)}<div style="font-size:10px; color:var(--text-muted)">${escHtml(r.username)}</div></td>
          <td>${teamPill(r.team)}</td>
          <td><span class="pill pill-gray">${escHtml(r.role)}</span></td>
          <td>
            <div class="pbar"><div style="width:${r.percent}%"></div></div>
            <span style="font-weight:600">${r.percent}%</span>
          </td>
          <td>${r.phases_passed} / ${r.phases_total}</td>
          <td>${r.total_attempts}</td>
          <td>${statusPill(r.status_bucket)}</td>
          <td style="color:var(--text-muted); font-size:11px">${r.last_active ? DateTime.formatDate(r.last_active) : '—'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick='openUserDetail(${JSON.stringify(r.user_id)}, ${JSON.stringify(r.name)})'>รายละเอียด</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  function statusPill(b) {
    return {
      completed:   '<span class="pill pill-green"><i data-icon="check"></i> เรียนจบ</span>',
      in_progress: '<span class="pill pill-orange">● กำลังเรียน</span>',
      not_started: '<span class="pill pill-gray">— ยังไม่เริ่ม</span>',
      no_course:   '<span class="pill pill-gray">—</span>',
    }[b] || '—';
  }

  async function openUserDetail(userId, name) {
    document.getElementById('um-title').textContent = 'รายละเอียดของ ' + name;
    document.getElementById('m-user').classList.add('active');
    const body = document.getElementById('um-body');
    body.innerHTML = '<div data-skel="text" data-rows="6"></div>';

    const res = await API.courses.userProgress(userId);
    if (!res?.ok) {
      body.innerHTML = '<div style="color:var(--text-muted)">โหลดไม่สำเร็จ</div>';
      return;
    }
    const d = res.data.data;
    const u = d.user;
    body.innerHTML = `
      <div style="margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border)">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:3px">
          <div style="font-size:14px; font-weight:700">${escHtml(u.name)}</div>
          ${teamPill(u.team)}
        </div>
        <div style="font-size:11px; color:var(--text-muted)">
          @${escHtml(u.username)} · ${escHtml(u.role)} · ${escHtml(u.email || '')}
        </div>
      </div>
      ${(d.courses || []).map(c => `
        <div class="user-drill">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px">
            <div style="font-size:22px">${escHtml(c.course_icon)}</div>
            <div style="flex:1">
              <h4>${escHtml(c.course_title)}</h4>
              <div style="font-size:11px; color:var(--text-muted)">
                ${c.phases_passed} / ${c.phases_total} phases · ${c.percent}%
              </div>
            </div>
            <div>
              <div class="pbar" style="width:160px"><div style="width:${c.percent}%"></div></div>
            </div>
          </div>
          <div>
            ${(c.phases || []).map(p => `
              <span class="phase-pill ${p.status}" title="${p.status}">
                ${renderIcon(p.icon)} P${p.order}
                ${p.score != null ? `<strong>${p.score}%</strong>` : ''}
                ${p.attempts ? `<span style="opacity:.6">· ${p.attempts}×</span>` : ''}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;
  }

  function exportCsv() {
    const users = _progReport?.users || [];
    if (!users.length) { Toast.warning('ไม่มีข้อมูล'); return; }
    const head = ['name','username','team','role','percent','phases_passed','phases_total','attempts','status','last_active'];
    const rows = users.map(r => [
      r.name, r.username, r.team || '', r.role, r.percent, r.phases_passed, r.phases_total,
      r.total_attempts, r.status_bucket, r.last_active || ''
    ]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'course_progress_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  }

  window.openUserDetail = openUserDetail;
  window.exportCsv = exportCsv;
  window.closeAllModals = closeAllModals;

  document.getElementById('prog-course-filter').addEventListener('change', loadProgress);

  (async () => {
    await loadCourses();
    await loadProgress();
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "closeAllModals", { configurable: true, get: () => closeAllModals, set: (v) => { closeAllModals = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportCsv", { configurable: true, get: () => exportCsv, set: (v) => { exportCsv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadCourses", { configurable: true, get: () => loadCourses, set: (v) => { loadCourses = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadProgress", { configurable: true, get: () => loadProgress, set: (v) => { loadProgress = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openUserDetail", { configurable: true, get: () => openUserDetail, set: (v) => { openUserDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "statusPill", { configurable: true, get: () => statusPill, set: (v) => { statusPill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "teamPill", { configurable: true, get: () => teamPill, set: (v) => { teamPill = v; } }); } catch (e) {}
})();
