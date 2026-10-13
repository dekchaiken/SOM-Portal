// grafana-alerts — page script, extracted from grafana-alerts.html.
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
  Layout.render('grafana-alerts');

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ── lucide-style inline icons (blocks.so aesthetic) ──
  const ICO = {
    pause:    '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    play:     '<polygon points="6 3 20 12 6 21 6 3"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    check:    '<path d="M20 6 9 17l-5-5"/>',
    alert:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    refresh:  '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    spinner:  '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
  };
  const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICO[n] || ''}</svg>`;

  // Grafana newStateDate → "2 days ago" (+ absolute in title)
  function relSince(iso) {
    if (!iso) return { rel: '—', abs: '' };
    const t = new Date(iso);
    if (isNaN(t)) return { rel: '—', abs: '' };
    const now = Date.now();
    const diff = Math.max(0, now - t.getTime());
    const min = Math.floor(diff / 60000);
    const hr  = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    let rel;
    if (day >= 1)      rel = day + (day === 1 ? ' day ago' : ' days ago');
    else if (hr >= 1)  rel = hr + (hr === 1 ? ' hr ago' : ' hrs ago');
    else if (min >= 1) rel = min + ' min ago';
    else               rel = 'just now';
    const abs = t.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    return { rel, abs };
  }

  function fmtClock(iso) {
    const t = iso ? new Date(iso) : new Date();
    if (isNaN(t)) return '–';
    return t.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
  }

  function badgeHtml(slug, n, kind) {
    // kind: 'paused' | 'zero' | 'err'
    if (kind === 'err') return `<span class="ga-count-badge err" id="badge-${esc(slug)}">${icon('alert')} error</span>`;
    if (kind === 'zero') return `<span class="ga-count-badge zero" id="badge-${esc(slug)}">${icon('check')} 0 paused</span>`;
    return `<span class="ga-count-badge" id="badge-${esc(slug)}">${icon('pause')} ${n} paused</span>`;
  }

  function sourceCard(s) {
    const org = s.orgId ? `org ${s.orgId}` : '';
    const head = (badge) => `
      <div class="ga-source-head">
        <span class="ga-dot" style="background:${esc(s.color || '#71717a')}"></span>
        <div>
          <div class="ga-source-name">${esc(s.name)}</div>
          <div class="ga-source-org">${esc(org)}</div>
        </div>
        ${badge}
      </div>`;

    if (s.error) {
      return `<div class="ga-source" data-slug="${esc(s.slug)}">
        ${head(badgeHtml(s.slug, 0, 'err'))}
        <div class="ga-state ga-err"><span class="ga-state-ico">${icon('alert')}</span><span>${esc(s.error)}</span></div>
      </div>`;
    }

    if (!s.alerts || s.alerts.length === 0) {
      return `<div class="ga-source" data-slug="${esc(s.slug)}">
        ${head(badgeHtml(s.slug, 0, 'zero'))}
        <div class="ga-state ga-empty"><span class="ga-state-ico">${icon('check')}</span><span>ไม่มี alert ที่ถูก paused ไว้</span></div>
      </div>`;
    }

    const rows = s.alerts.map(a => {
      const since = relSince(a.newStateDate);
      const link = a.url
        ? `<a class="ga-btn" href="${esc(a.url)}" target="_blank" rel="noopener">${icon('external')} Grafana</a>`
        : '';
      const resumeBtn = `<button class="ga-btn resume" data-action="write" data-name="${esc(a.name)}" onclick="resumeAlert('${esc(s.slug)}', ${a.id}, this)">${icon('play')} Resume</button>`;
      return `<tr id="al-${esc(s.slug)}-${a.id}">
        <td><span class="ga-alert-name">${esc(a.name)}</span></td>
        <td><span class="ga-tag"><span class="pd"></span>PAUSED</span></td>
        <td><span class="ga-since" title="${esc(since.abs)}">${esc(since.rel)}</span></td>
        <td class="right" style="white-space:nowrap">${resumeBtn}${link}</td>
      </tr>`;
    }).join('');

    return `<div class="ga-source" data-slug="${esc(s.slug)}">
      ${head(badgeHtml(s.slug, s.alerts.length, 'paused'))}
      <table class="ga-table">
        <thead><tr>
          <th>Alert rule</th><th>State</th><th>Paused since</th><th class="right">Action</th>
        </tr></thead>
        <tbody id="tbody-${esc(s.slug)}">${rows}</tbody>
      </table>
    </div>`;
  }

  // Resume (un-pause) a single alert. Writes to production Grafana — confirm first.
  async function resumeAlert(slug, id, btn) {
    const name = btn.dataset.name || 'this alert';
    const ok = await confirmDialog(
      `"${name}" — ถ้าเงื่อนไข alert กำลัง breach อยู่ จะยิง notification ทันที (อาจเข้า on-call / Google Chat) ยืนยัน resume?`,
      'Resume alert',
      { confirmText: '<i data-icon=\"play\"></i> Resume', cancelText: 'ยกเลิก', variant: 'primary' }
    );
    if (!ok) return;

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = icon('spinner', 'spin') + ' …';

    const res = await API.grafanaAlerts.resume(slug, id);
    if (!res || !res.ok) {
      btn.disabled = false;
      btn.innerHTML = original;
      const msg = 'Resume ไม่สำเร็จ: ' + (res?.data?.message || `HTTP ${res?.status || '?'}`);
      if (window.Toast) Toast.error(msg); else console.error(msg);
      return;
    }

    // Remove the row and update counts inline.
    const row = document.getElementById(`al-${slug}-${id}`);
    if (row) row.remove();

    const totalEl = $('ga-total');
    const newTotal = Math.max(0, (parseInt(totalEl.textContent, 10) || 0) - 1);
    totalEl.textContent = newTotal;
    $('ga-total-sub').textContent = newTotal === 0 ? 'ทุก alert ทำงานปกติ' : $('ga-total-sub').textContent;

    const badge = document.getElementById(`badge-${slug}`);
    const tbody = document.getElementById(`tbody-${slug}`);
    const remaining = tbody ? tbody.querySelectorAll('tr').length : 0;
    if (badge) {
      badge.innerHTML = remaining === 0 ? icon('check') + ' 0 paused' : icon('pause') + ` ${remaining} paused`;
      if (remaining === 0) badge.classList.add('zero');
    }
    if (remaining === 0) {
      const card = document.querySelector(`.ga-source[data-slug="${CSS.escape(slug)}"]`);
      const table = card?.querySelector('.ga-table');
      if (table) {
        const empty = document.createElement('div');
        empty.className = 'ga-state ga-empty';
        empty.innerHTML = `<span class="ga-state-ico">${icon('check')}</span><span>resume ครบแล้ว — ไม่มี alert ที่ paused</span>`;
        table.replaceWith(empty);
      }
    }

    if (window.Toast) Toast.success(`Resumed · ${name}`);
  }

  async function loadPaused() {
    // Always fetch fresh: show loading, hide content/error.
    $('ga-loading').classList.remove('ga-hidden');
    $('ga-content').classList.add('ga-hidden');
    $('ga-error').classList.add('ga-hidden');
    $('ga-last-updated').textContent = '';

    const res = await API.get('/grafana-alerts/paused.php');
    if (!res) return; // auth flow handled by api.js

    if (!res.ok) {
      $('ga-loading').classList.add('ga-hidden');
      $('ga-error').classList.remove('ga-hidden');
      $('ga-error').innerHTML = `<div class="ga-state ga-err"><span class="ga-state-ico">${icon('alert')}</span><span>${esc(res.data?.message || `HTTP ${res.status}`)}</span></div>`;
      return;
    }

    const p = res.data?.data || {};
    const sources = p.sources || [];
    const total = p.total || 0;
    const okSources = sources.filter(s => !s.error).length;
    const errSources = sources.length - okSources;

    $('ga-total').textContent = total;
    $('ga-total-sub').textContent = total === 0 ? 'ทุก alert ทำงานปกติ' : 'across ' + okSources + ' sources';
    $('ga-sources').textContent = sources.length;
    $('ga-sources-sub').textContent = errSources > 0 ? (errSources + ' source มีปัญหาในการดึง') : 'ดึงสำเร็จทั้งหมด';
    $('ga-fetched').textContent = fmtClock(p.fetched_at);

    // Sort: sources with paused alerts first (desc), then errors, then clean.
    const ordered = [...sources].sort((a, b) => {
      const av = a.error ? -1 : (a.count || 0);
      const bv = b.error ? -1 : (b.count || 0);
      return bv - av;
    });

    $('ga-sources-list').innerHTML = ordered.map(sourceCard).join('');

    $('ga-loading').classList.add('ga-hidden');
    $('ga-content').classList.remove('ga-hidden');
    $('ga-last-updated').textContent = 'อัปเดต ' + fmtClock(p.fetched_at) + ' น.';
  }

  // Static KPI icons
  $('ga-ico-total').innerHTML = icon('pause');
  $('ga-ico-src').innerHTML   = icon('database');
  $('ga-ico-clock').innerHTML = icon('clock');

  // Fetch fresh on every page load.
  loadPaused();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "badgeHtml", { configurable: true, get: () => badgeHtml, set: (v) => { badgeHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtClock", { configurable: true, get: () => fmtClock, set: (v) => { fmtClock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPaused", { configurable: true, get: () => loadPaused, set: (v) => { loadPaused = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "relSince", { configurable: true, get: () => relSince, set: (v) => { relSince = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resumeAlert", { configurable: true, get: () => resumeAlert, set: (v) => { resumeAlert = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sourceCard", { configurable: true, get: () => sourceCard, set: (v) => { sourceCard = v; } }); } catch (e) {}
})();
