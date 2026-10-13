// admin/achievements — page script, extracted from admin/achievements.html.
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
Layout.render('achievements');

let _rows = [];

async function loadAll() {
  document.getElementById('ach-tbody').innerHTML =
    `<tr class="loading-row"><td colspan="8">กำลังโหลด leaderboard...</td></tr>`;

  const usersRes = await API.users.list();
  if (!usersRes?.ok) { Toast.error('โหลด users ไม่ได้'); return; }
  const users = (usersRes.data.data || []).filter(u => u.status !== 'inactive');

  // Parallel fetch achievements for all users
  const results = await Promise.allSettled(
    users.map(u => API.achievements.user(u.id).then(r => ({ user: u, data: r?.data?.data || null })))
  );

  _rows = results
    .filter(r => r.status === 'fulfilled' && r.value.data)
    .map(r => ({ user: r.value.user, ach: r.value.data }))
    .sort((a, b) => (b.ach.stats.total_points || 0) - (a.ach.stats.total_points || 0));

  updateStats();
  renderTable(_rows);
}

function updateStats() {
  let totalPts = 0, gold = 0, silver = 0, bronze = 0;
  _rows.forEach(({ ach }) => {
    totalPts += ach.stats.total_points || 0;
    [...(ach.courses || []), ...(ach.exams || [])].forEach(item => {
      if (item.badge === 'gold')   gold++;
      if (item.badge === 'silver') silver++;
      if (item.badge === 'bronze') bronze++;
    });
  });
  document.getElementById('stat-users').textContent  = _rows.length;
  document.getElementById('stat-pts').textContent    = totalPts.toLocaleString();
  document.getElementById('stat-gold').textContent   = gold;
  document.getElementById('stat-silver').textContent = silver;
  document.getElementById('stat-bronze').textContent = bronze;
}

function filterTable() {
  const q    = document.getElementById('f-search').value.toLowerCase();
  const role = document.getElementById('f-role').value;
  const filtered = _rows.filter(r => {
    const nameOk = !q    || (r.user.name || '').toLowerCase().includes(q);
    const roleOk = !role || r.user.role === role;
    return nameOk && roleOk;
  });
  renderTable(filtered);
}

function renderTable(rows) {
  const tbody = document.getElementById('ach-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr class="loading-row"><td colspan="8">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  const maxPts = rows[0]?.ach.stats.total_points || 1;

  tbody.innerHTML = rows.map((r, i) => {
    const { user, ach } = r;
    const { stats, courses, exams, onboarding } = ach;

    const rankCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const rankLabel = i === 0 ? '<i data-icon="award"></i>' : i === 1 ? '<i data-icon="award"></i>' : i === 2 ? '<i data-icon="award"></i>' : `${i + 1}`;

    const pct = maxPts ? Math.round((stats.total_points / maxPts) * 100) : 0;

    const badgeHtml = buildBadgeSummary(courses || [], exams || []);

    const av = user.avatar_url
      ? `<img src="${escHtml(user.avatar_url)}" alt="">`
      : getInitials(user.name || '?');

    return `
      <tr data-user-id="${escHtml(user.id)}" data-name="${escHtml((user.name||'').toLowerCase())}" data-role="${escHtml(user.role||'')}">
        <td><div class="rank-num ${rankCls}">${rankLabel}</div></td>
        <td>
          <div class="user-cell">
            <div class="user-av">${av}</div>
            <div class="user-name">${escHtml(user.name || user.username || '—')}</div>
          </div>
        </td>
        <td>
          <div class="points-val">${stats.total_points}</div>
          <div class="prog-bar-wrap" style="margin-top:4px">
            <div class="prog-bar"><div class="prog-bar-fill" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td>${stats.courses_completed}/${stats.courses_total}</td>
        <td>${stats.exams_passed}/${stats.exams_taken}</td>
        <td>${onboarding?.finished ? '<span class="ob-done">✓ Done</span>' : `<span class="ob-pend">${onboarding?.percent || 0}%</span>`}</td>
        <td><div class="badge-row">${badgeHtml}</div></td>
        <td>
          <button class="expand-btn" onclick="toggleDetail('${escHtml(user.id)}')" id="xbtn-${escHtml(user.id)}">▸</button>
        </td>
      </tr>
      <tr class="detail-row hidden" id="detail-${escHtml(user.id)}">
        <td colspan="8">${buildDetailPanel(ach)}</td>
      </tr>`;
  }).join('');
}

function buildBadgeSummary(courses, exams) {
  const all = [...courses, ...exams].filter(x => x.badge);
  const g = all.filter(x => x.badge === 'gold').length;
  const s = all.filter(x => x.badge === 'silver').length;
  const b = all.filter(x => x.badge === 'bronze').length;
  let html = '';
  if (g) html += `<span class="badge-chip gold"><i data-icon="award"></i> ${g}</span>`;
  if (s) html += `<span class="badge-chip silver"><i data-icon="award"></i> ${s}</span>`;
  if (b) html += `<span class="badge-chip bronze"><i data-icon="award"></i> ${b}</span>`;
  return html || '<span style="color:var(--text-muted);font-size:10px">—</span>';
}

function buildDetailPanel(ach) {
  const { courses, exams, onboarding } = ach;
  const badgeIcon = { gold: '<i data-icon="award"></i>', silver: '<i data-icon="award"></i>', bronze: '<i data-icon="award"></i>' };

  const courseHtml = (courses || []).map(c => `
    <div class="detail-item">
      <div class="detail-item-icon">${renderIcon(c.icon)}</div>
      <div>
        <div class="detail-item-title">${escHtml(c.title)}</div>
        <div class="detail-item-meta">${c.phases_passed}/${c.phases_total} phases · ${c.percent}%</div>
      </div>
      ${c.badge ? `<div class="detail-item-badge">${badgeIcon[c.badge]}</div>` : ''}
    </div>`).join('') || '<div style="font-size:11px;color:var(--text-muted)">ไม่มีข้อมูล</div>';

  const examHtml = (exams || []).map(e => `
    <div class="detail-item">
      <div class="detail-item-icon">${renderIcon(e.icon, '<i data-icon="edit"></i>')}</div>
      <div>
        <div class="detail-item-title">${escHtml(e.title)}</div>
        <div class="detail-item-meta">Best ${e.best_score}% · pass ${e.pass_score}% · ${e.attempts} attempt${e.attempts !== 1 ? 's' : ''}</div>
      </div>
      ${e.badge ? `<div class="detail-item-badge">${badgeIcon[e.badge]}</div>` : ''}
    </div>`).join('') || '<div style="font-size:11px;color:var(--text-muted)">ยังไม่ได้สอบ</div>';

  return `<div class="detail-panel">
    <div class="detail-section-lbl"><i data-icon="graduation-cap"></i> Courses</div>
    <div class="detail-items">${courseHtml}</div>
    <div class="detail-section-lbl"><i data-icon="edit"></i> Exams</div>
    <div class="detail-items">${examHtml}</div>
  </div>`;
}

function toggleDetail(userId) {
  const row = document.getElementById(`detail-${userId}`);
  const btn = document.getElementById(`xbtn-${userId}`);
  if (!row) return;
  const open = row.classList.toggle('hidden');
  btn.textContent = open ? '▸' : '▾';
}

loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "buildBadgeSummary", { configurable: true, get: () => buildBadgeSummary, set: (v) => { buildBadgeSummary = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildDetailPanel", { configurable: true, get: () => buildDetailPanel, set: (v) => { buildDetailPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterTable", { configurable: true, get: () => filterTable, set: (v) => { filterTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleDetail", { configurable: true, get: () => toggleDetail, set: (v) => { toggleDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStats", { configurable: true, get: () => updateStats, set: (v) => { updateStats = v; } }); } catch (e) {}
})();
