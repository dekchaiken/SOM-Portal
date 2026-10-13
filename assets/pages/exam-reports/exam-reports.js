// exam-reports — page script, extracted from exam-reports.html.
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

  Layout.render('exam-reports');

  let _exams = [];
  let _report = null;
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
    if (!slug) return '';
    const t = _teamsById[slug] || {};
    const label = (t.name || slug).toUpperCase();
    const color = t.color || '#6366F1';
    return `<span class="team-pill" title="${escHtml(t.name || slug)}"
      style="--tp-color:${color}">${escHtml(label)}</span>`;
  }

  function fmtDate(s) {
    try { return new Date(s).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }); }
    catch { return s; }
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + ' วินาที';
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return `${m} น. ${s} วิ`;
    const h = Math.floor(m / 60), mm = m % 60;
    return `${h} ชม. ${mm} น.`;
  }
  function fmtDateOnly(s) {
    try { return new Date(s).toLocaleDateString('th-TH', { month:'short', day:'numeric' }); }
    catch { return s; }
  }
  function repInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  }

  function closeReportModal() {
    document.getElementById('rep-modal').classList.remove('active');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReportModal(); });
  document.getElementById('rep-modal').addEventListener('click', e => {
    if (e.target.id === 'rep-modal') closeReportModal();
  });

  // ═══════════════ Exam catalog ═══════════════
  async function loadExams() {
    const res = await API.exams.list();
    if (!res?.ok) {
      document.getElementById('exam-grid').innerHTML =
        '<div class="empty-state"><p>โหลด exam ไม่สำเร็จ</p></div>';
      return;
    }
    _exams = res.data.data || [];
    renderExams();
  }

  function renderExams() {
    const q = (document.getElementById('exam-search').value || '').trim().toLowerCase();
    const grid = document.getElementById('exam-grid');
    const list = q
      ? _exams.filter(e => (e.title || '').toLowerCase().includes(q)
                       || (e.subtitle || '').toLowerCase().includes(q))
      : _exams;

    if (!list.length) {
      grid.innerHTML = '<div class="empty-state"><p>ไม่มี exam</p></div>';
      return;
    }

    grid.innerHTML = list.map(e => {
      const sub = e.attempts_submitted ?? 0;
      const ip  = e.attempts_in_progress ?? 0;
      return `
        <div class="exam-card">
          <div class="exam-card-head">
            <div class="exam-card-ico" style="background:${escHtml(e.cover_color || '#6366F1')}22; color:${escHtml(e.cover_color || '#6366F1')}">${renderIcon(e.icon, '<i data-icon="edit"></i>')}</div>
            <div style="flex:1; min-width:0">
              <h3 class="exam-card-title">${escHtml(e.title)}</h3>
              ${e.subtitle ? `<p class="exam-card-sub">${escHtml(e.subtitle)}</p>` : ''}
            </div>
            <span class="status-chip ${escHtml(e.status || 'draft')}">${escHtml(e.status || 'draft')}</span>
          </div>
          <div class="exam-card-meta">
            ${e.owner_team ? `<span>👥 ${teamPill(e.owner_team)}</span>` : ''}
            <span><i data-icon="file"></i> <b>${e.questions_count || 0}</b> ข้อ</span>
            <span><i data-icon="target"></i> ผ่าน <b>${e.pass_score || 0}%</b></span>
            <span><i data-icon="check-circle"></i> <b>${sub}</b> submitted</span>
            ${ip > 0 ? `<span>⏳ <b>${ip}</b> in progress</span>` : ''}
          </div>
          <div class="exam-card-foot">
            <button class="btn btn-primary btn-sm" style="flex:1"
              onclick='openReport(${JSON.stringify(e.id)}, ${JSON.stringify(e.title)})'>
              <i data-icon="trending-up"></i> View Report
            </button>
          </div>
        </div>`;
    }).join('');
  }

  document.getElementById('exam-search').addEventListener('input', renderExams);

  // ═══════════════ Report (ported from admin/exams.html — read-only) ═══════════════
  async function openReport(examId, title) {
    document.getElementById('rep-title').innerHTML = '<i data-icon="trending-up"></i> Report — ' + title;
    document.getElementById('rep-body').innerHTML = '<div data-skel="list" data-rows="3"></div>';
    document.getElementById('rep-modal').classList.add('active');

    const res = await API.exams.report(examId);
    if (!res?.ok) {
      document.getElementById('rep-body').innerHTML =
        '<div class="rep-empty"><div class="icon"><i data-icon="alert-triangle"></i></div><div>โหลด report ไม่สำเร็จ</div></div>';
      return;
    }
    _report = res.data?.data || null;
    renderReport();
  }

  function renderReport() {
    const r = _report;
    if (!r) return;
    const body = document.getElementById('rep-body');
    const ex   = r.exam;
    const ov   = r.overview;
    const accent = ex.cover_color || '#6366F1';

    if (ov.total_attempts === 0) {
      body.innerHTML = `
        <div class="rep-hero" style="--rep-accent:${escHtml(accent)}">
          <div class="rep-hero-ico">${renderIcon(ex.icon, '<i data-icon="trending-up"></i>')}</div>
          <div class="rep-hero-body">
            <div class="rep-hero-eyebrow">Report · Snapshot · ${escHtml(new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'}))}</div>
            <h2>${escHtml(ex.title)}</h2>
            <p>${ex.questions_count} ข้อ · ${ex.pass_score > 0 ? `เกณฑ์ผ่าน ${ex.pass_score}%` : 'ไม่มีเกณฑ์ผ่าน'}</p>
          </div>
        </div>
        <div class="rep-empty">
          <div class="icon"><i data-icon="inbox"></i></div>
          <div>ยังไม่มีคนทำข้อสอบนี้</div>
        </div>`;
      return;
    }

    const heroHtml = `
      <div class="rep-hero" style="--rep-accent:${escHtml(accent)}">
        <div class="rep-hero-ico">${renderIcon(ex.icon, '<i data-icon="trending-up"></i>')}</div>
        <div class="rep-hero-body">
          <div class="rep-hero-eyebrow">Report · Snapshot · ${escHtml(new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'}))}</div>
          <h2>${escHtml(ex.title)}</h2>
          <p>${ex.questions_count} ข้อ · ${ex.pass_score > 0 ? `เกณฑ์ผ่าน <b>${ex.pass_score}%</b>` : '<b>ไม่มีเกณฑ์ผ่าน</b>'}</p>
          <div class="rep-hero-meta">
            ${ov.first_attempt_at ? `<span>📅 เริ่มมีคนทำ <b>${escHtml(fmtDate(ov.first_attempt_at))}</b></span>` : ''}
            ${ov.last_attempt_at  ? `<span>·</span><span>🕒 ล่าสุด <b>${escHtml(fmtDate(ov.last_attempt_at))}</b></span>` : ''}
          </div>
        </div>
      </div>`;

    const kpisHtml = `
      <div class="rep-kpis">
        <div class="rep-kpi accent">
          <div class="n">${ov.unique_users}</div>
          <div class="l">ผู้เข้าสอบ</div>
          <div class="sub">${ov.total_attempts} ครั้งทั้งหมด</div>
        </div>
        <div class="rep-kpi green">
          <div class="n">${ov.passed}</div>
          <div class="l">ผ่าน</div>
          <div class="sub">${ov.pass_rate}% pass rate</div>
        </div>
        <div class="rep-kpi red">
          <div class="n">${ov.failed}</div>
          <div class="l">ไม่ผ่าน</div>
          <div class="sub">${ov.submitted} ส่งทั้งหมด</div>
        </div>
        <div class="rep-kpi blue">
          <div class="n">${ov.avg_score}<span class="u">%</span></div>
          <div class="l">เฉลี่ย</div>
          <div class="sub">median ${ov.median_score}% · ดีสุด ${ov.max_score}%</div>
        </div>
        <div class="rep-kpi amber">
          <div class="n">${fmtDur(ov.avg_duration_sec).replace(/\s.+$/,'')}<span class="u">${fmtDur(ov.avg_duration_sec).split(' ').slice(1).join(' ')}</span></div>
          <div class="l">เวลาเฉลี่ย</div>
          <div class="sub">ต่อ attempt</div>
        </div>
        ${ov.in_progress > 0 ? `
          <div class="rep-kpi amber">
            <div class="n">${ov.in_progress}</div>
            <div class="l">กำลังทำ</div>
            <div class="sub">ยังไม่ส่ง</div>
          </div>` : ''}
        ${ov.total_violations > 0 ? `
          <div class="rep-kpi red">
            <div class="n">${ov.total_violations}</div>
            <div class="l">Violations</div>
            <div class="sub">รวมทุกประเภท</div>
          </div>` : ''}
      </div>`;

    const maxBucket = Math.max(1, ...r.distribution.map(b => b.count));
    const bucketColor = ['#ef4444','#f97316','#eab308','#3b82f6','#10b981'];
    const distHtml = `
      <div class="rep-card">
        <div class="rep-card-head"><i data-icon="bar-chart"></i> Score Distribution <span class="sub">${ov.submitted} attempts ที่ส่งแล้ว</span></div>
        <div class="rep-bars">
          ${r.distribution.map((b, i) => `
            <div class="rep-bar-row">
              <div class="rep-bar-label">${b.label}</div>
              <div class="rep-bar-track">
                <div class="rep-bar-fill" style="--bar-color:${bucketColor[i]}; width:${(b.count / maxBucket * 100).toFixed(1)}%"></div>
              </div>
              <div class="rep-bar-count">${b.count}</div>
            </div>
          `).join('')}
        </div>
      </div>`;

    const tl = r.timeline;
    const tlMax = Math.max(1, ...tl.map(d => d.count));
    const tlTotal = tl.reduce((s, d) => s + d.count, 0);
    const tlHtml = `
      <div class="rep-card">
        <div class="rep-card-head"><i data-icon="clock"></i> Activity — 30 วันหลัง <span class="sub">${tlTotal} submissions</span></div>
        <div class="rep-spark">
          ${tl.map(d => `
            <div class="rep-spark-bar ${d.count === 0 ? 'zero' : ''}"
                 style="height:${d.count === 0 ? 4 : Math.max(4, d.count / tlMax * 100)}%"
                 title="${d.date} — ${d.count} attempts"></div>
          `).join('')}
        </div>
        <div class="rep-spark-meta">
          <span>${fmtDateOnly(tl[0]?.date)}</span>
          <span>${fmtDateOnly(tl[tl.length-1]?.date)}</span>
        </div>
      </div>`;

    const lbRows = r.leaderboard.map((u, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const statusLabel = ({passed:'PASSED', failed:'FAILED', in_progress:'IN PROGRESS', never:'NEVER'})[u.status] || u.status;
      const bestScoreCell = u.best_score === null
        ? `<span class="rep-score-pill idle">—</span>`
        : `<span class="rep-score-pill ${u.best_passed ? 'pass' : 'fail'}">${u.best_score}%</span>`;
      const latestScoreCell = u.latest_score === null
        ? `<span style="color:var(--text-muted)">—</span>`
        : `${u.latest_score}%`;
      const avatarHtml = u.avatar_url
        ? `<img class="rep-avatar rep-avatar-img" src="${escHtml(u.avatar_url)}" alt=""
            onerror="this.outerHTML='<div class=\\'rep-avatar\\'>${escHtml(repInitials(u.user_name))}</div>'">`
        : `<div class="rep-avatar">${escHtml(repInitials(u.user_name))}</div>`;
      return `
        <tr>
          <td><span class="rep-rank ${rankClass}">${i+1}</span></td>
          <td>
            <div class="rep-user">
              ${avatarHtml}
              <div>
                <div class="rep-user-name">${escHtml(u.user_name)}</div>
                <div style="font-size:10.5px; color:var(--text-muted)">${u.last_attempted_at ? 'ทำล่าสุด ' + fmtDate(u.last_attempted_at) : '—'}</div>
              </div>
            </div>
          </td>
          <td>${teamPill(u.team)}</td>
          <td class="right">${u.attempts}</td>
          <td class="right">${bestScoreCell}</td>
          <td class="right">${latestScoreCell}</td>
          <td class="right">${u.total_duration_sec > 0 ? fmtDur(u.total_duration_sec) : '—'}</td>
          <td class="right">${u.violations_total > 0 ? `<span style="color:#ef4444">${u.violations_total}</span>` : '0'}</td>
          <td class="right"><span class="rep-status-pill ${u.status}">${statusLabel}</span></td>
        </tr>`;
    }).join('');

    const lbHtml = `
      <div class="rep-section-label">
        <i data-icon="trophy"></i> Leaderboard
        <span class="ct">${r.leaderboard.length} คน</span>
      </div>
      <div class="rep-table-wrap">
        <table class="rep-table">
          <thead>
            <tr>
              <th style="width:50px">#</th>
              <th>ผู้สอบ</th>
              <th>Team</th>
              <th class="right">Attempts</th>
              <th class="right">Best</th>
              <th class="right">Latest</th>
              <th class="right">Time</th>
              <th class="right">Violations</th>
              <th class="right">Status</th>
            </tr>
          </thead>
          <tbody>${lbRows}</tbody>
        </table>
      </div>`;

    const qHtml = r.questions.length ? `
      <div class="rep-section-label">
        <i data-icon="target"></i> Question Analytics
        <span class="ct">เรียงข้อยากที่สุดก่อน</span>
      </div>
      <div class="rep-table-wrap">
        ${r.questions.map(q => {
          const rate = q.correct_rate;
          const color = q.asked === 0 ? '#94a3b8'
                      : rate < 40 ? '#ef4444'
                      : rate < 70 ? '#f59e0b'
                      : '#10b981';
          return `
            <div class="rep-qrow">
              <div class="rep-q-prompt">
                ${q.category ? `<span class="cat">${escHtml(q.category)}</span>` : ''}
                ${escHtml(q.prompt || '(ไม่มี prompt)')}
              </div>
              <div>
                <div class="rep-q-rate">
                  <div class="rep-q-rate-fill" style="--q-color:${color}; width:${rate}%"></div>
                </div>
                <div class="rep-q-rate-label" style="--q-color:${color}; margin-top:4px">
                  ${q.asked === 0 ? 'ไม่ได้สุ่ม' : rate + '%'}
                </div>
              </div>
              <div class="rep-q-asked">${q.asked > 0 ? `${q.correct}/${q.asked}` : '—'}</div>
            </div>`;
        }).join('')}
      </div>` : '';

    const na = r.not_attempted || [];
    const naHtml = na.length ? `
      <div class="rep-section-label" style="margin-top:20px">
        <i data-icon="ban"></i> ยังไม่ได้ทำข้อสอบ
        <span class="ct" style="background:rgba(239,68,68,.12);color:#ef4444">${na.length} คน</span>
      </div>
      <div class="rep-table-wrap" style="padding:10px">
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${na.map(u => {
            const initial = escHtml((u.name || '?').charAt(0).toUpperCase());
            const fallback = `<div style=\\'width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700\\'>${initial}</div>`;
            const av = u.avatar_url
              ? `<img src="${escHtml(u.avatar_url)}" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover;background:var(--bg)" onerror="this.outerHTML='${fallback}'">`
              : `<div style="width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${initial}</div>`;
            return `
            <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg);border:1px solid var(--border);border-radius:20px;font-size:12px">
              ${av}
              <span>${escHtml(u.name)}</span>
              ${u.team ? teamPill(u.team) : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : (r.overview.eligible_users > 0 ? `
      <div class="rep-section-label" style="margin-top:20px">
        <i data-icon="sparkles"></i> ทุกคนทำข้อสอบครบแล้ว
        <span class="ct" style="background:rgba(16,185,129,.12);color:#10b981">${r.overview.eligible_users}/${r.overview.eligible_users}</span>
      </div>` : '');

    body.innerHTML = heroHtml + kpisHtml +
      `<div class="rep-grid-2">${distHtml}${tlHtml}</div>` +
      naHtml + lbHtml + qHtml;
  }

  function reportExportCsv() {
    const r = _report;
    if (!r) return;
    const rows = [
      ['Rank','Name','Team','Attempts','Best Score','Latest Score','Time (sec)','Violations','Status','Last Attempt']
    ];
    r.leaderboard.forEach((u, i) => {
      rows.push([
        i + 1, u.user_name, u.team || '', u.attempts, u.best_score ?? '', u.latest_score ?? '',
        u.total_duration_sec, u.violations_total, u.status, u.last_attempted_at || '',
      ]);
    });
    const csv = rows.map(r => r.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeTitle = (r.exam.title || 'exam').replace(/[^\w\-]+/g, '_');
    a.download = `report_${safeTitle}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    Toast.success('ดาวน์โหลด CSV แล้ว');
  }

  function reportPrint() { window.print(); }

  async function reportCopySummary() {
    const r = _report;
    if (!r) return;
    const ov = r.overview;
    const md = [
      `# ${r.exam.title}`,
      ``,
      `📅 _${new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'})}_`,
      ``,
      `## ภาพรวม`,
      `- ผู้สอบ: **${ov.unique_users}** คน (${ov.total_attempts} attempts)`,
      `- ผ่าน: **${ov.passed}** / ไม่ผ่าน: **${ov.failed}** — pass rate **${ov.pass_rate}%**`,
      `- คะแนนเฉลี่ย: **${ov.avg_score}%** (median ${ov.median_score}%, min ${ov.min_score}%, max ${ov.max_score}%)`,
      `- เวลาเฉลี่ยต่อ attempt: **${fmtDur(ov.avg_duration_sec)}**`,
      ov.total_violations > 0 ? `- Violations: **${ov.total_violations}**` : '',
      ``,
      `## Leaderboard`,
      `| # | ผู้สอบ | Best | Latest | Status |`,
      `|---|---|---|---|---|`,
      ...r.leaderboard.map((u, i) => `| ${i+1} | ${u.user_name} | ${u.best_score ?? '—'}% | ${u.latest_score ?? '—'}% | ${u.status} |`),
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(md);
      Toast.success('คัดลอกสรุป (markdown) แล้ว');
    } catch (e) {
      Toast.error('คัดลอกไม่สำเร็จ');
    }
  }

  window.openReport = openReport;
  window.closeReportModal = closeReportModal;
  window.reportExportCsv = reportExportCsv;
  window.reportPrint = reportPrint;
  window.reportCopySummary = reportCopySummary;

  loadExams();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "reportCopySummary", { configurable: true, get: () => reportCopySummary, set: (v) => { reportCopySummary = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reportPrint", { configurable: true, get: () => reportPrint, set: (v) => { reportPrint = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeReportModal", { configurable: true, get: () => closeReportModal, set: (v) => { closeReportModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateOnly", { configurable: true, get: () => fmtDateOnly, set: (v) => { fmtDateOnly = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDur", { configurable: true, get: () => fmtDur, set: (v) => { fmtDur = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadExams", { configurable: true, get: () => loadExams, set: (v) => { loadExams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openReport", { configurable: true, get: () => openReport, set: (v) => { openReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderExams", { configurable: true, get: () => renderExams, set: (v) => { renderExams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderReport", { configurable: true, get: () => renderReport, set: (v) => { renderReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "repInitials", { configurable: true, get: () => repInitials, set: (v) => { repInitials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reportExportCsv", { configurable: true, get: () => reportExportCsv, set: (v) => { reportExportCsv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "teamPill", { configurable: true, get: () => teamPill, set: (v) => { teamPill = v; } }); } catch (e) {}
})();
