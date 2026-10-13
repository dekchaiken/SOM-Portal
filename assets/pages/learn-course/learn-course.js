// learn-course — page script, extracted from learn-course.html.
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
  Layout.render('learn');

  // Force fresh fetch when the user navigates back from another page
  // (browser bfcache would otherwise show stale progress).
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) location.reload(); });

  const courseId = new URLSearchParams(location.search).get('id');
  if (!courseId) { location.href = 'learn.html'; }
  if (courseId) trackCourseView(courseId);

  function hexAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  function applyAccent(color) {
    if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    const root = document.documentElement;
    root.style.setProperty('--accent',      color);
    root.style.setProperty('--accent-soft', hexAlpha(color, .10));
    root.style.setProperty('--accent-line', hexAlpha(color, .35));
    root.style.setProperty('--accent-glow', hexAlpha(color, .18));
  }

  (async () => {
    const [courseRes, phasesRes] = await Promise.all([
      API.courses.getCourse(courseId),
      API.courses.listPhases(courseId),
    ]);

    if (!courseRes?.ok) { Toast.error('ไม่พบคอร์ส'); location.href = 'learn.html'; return; }
    const course = courseRes.data.data;

    // Course-level lock check (prerequisite not met)
    if (course.my_locked) {
      const titles = (course.unmet_prereqs || []).map(u => u.title).join(', ');
      Toast.warning('ต้องเรียน "' + titles + '" ให้จบก่อนถึงจะเข้าคอร์สนี้ได้');
      setTimeout(() => { location.href = 'learn.html'; }, 1200);
      return;
    }

    applyAccent(course.cover_color);

    const phases = phasesRes?.ok ? (phasesRes.data.data || []) : [];

    renderHero(course, phases);
    renderPhases(phases);
  })();

  function renderHero(course, phases) {
    document.getElementById('hero').style.display = '';
    document.getElementById('top-title').textContent = course.title;
    document.getElementById('top-sub').textContent   = course.subtitle || '';

    document.getElementById('hero-icon').innerHTML  = course.icon || '<i data-icon="book"></i>';
    document.getElementById('hero-title').textContent = course.title;
    document.getElementById('hero-desc').textContent  = course.description || course.subtitle || '';

    const passed = phases.filter(p => p.my_status === 'passed').length;
    const total  = phases.length;
    const pct    = total ? Math.round(passed / total * 100) : 0;
    document.getElementById('stat-pct').textContent    = pct + '%';
    document.getElementById('stat-passed').textContent = `${passed} / ${total}`;
    document.getElementById('hero-progress').style.width = pct + '%';

    // Shimmer if course in progress (some but not all passed)
    if (passed > 0 && passed < total) {
      document.getElementById('hero-bar-wrap').classList.add('shimmer');
    }

    document.getElementById('phase-count').textContent = `${total} phases`;
  }

  function renderPhases(phases) {
    const wrap = document.getElementById('path');
    if (!phases.length) {
      wrap.innerHTML = `
        <div class="lc-empty">
          <div class="icon"><i data-icon="inbox"></i></div>
          <div>คอร์สนี้ยังไม่มี phase</div>
        </div>`;
      return;
    }

    wrap.innerHTML = phases.map(p => {
      const st = p.my_status || 'locked';
      const locked = st === 'locked';
      const href = locked ? '#' : `learn-phase.html?id=${encodeURIComponent(p.id)}`;
      const cleanTitle = p.title.replace(/^Phase\s*\d+\s*[—–-]\s*/i, '');

      const pillLabel = {
        locked:      '<i data-icon="lock"></i> ล็อก',
        unlocked:    '<i data-icon="play"></i> เริ่มได้',
        in_progress: 'กำลังเรียน',
        passed:      '<i data-icon="check"></i> ผ่านแล้ว',
      }[st] || st;

      const pillHtml = st === 'in_progress'
        ? `<span class="lc-pill ${st}"><span class="dotmark"></span> ${pillLabel}</span>`
        : `<span class="lc-pill ${st}">${pillLabel}</span>`;

      const iconChar = locked ? '<i data-icon="lock"></i>' : (st === 'passed' ? '<i data-icon="check-circle"></i>' : renderIcon(p.icon));

      const scoreChip = p.my_score != null
        ? `<span class="lc-score-chip"><i data-icon="target"></i> ดีสุด ${p.my_score}%</span>`
        : '';
      const attemptLine = p.my_attempts
        ? `<span><i data-icon="refresh-cw"></i> ลอง <b>${p.my_attempts}</b> ครั้ง</span>`
        : '';

      return `
        <a href="${href}" class="lc-node ${st}" ${locked ? 'tabindex="-1" aria-disabled="true"' : ''}>
          <div class="lc-node-row">
            <div class="lc-node-mark">${iconChar}</div>
            <div class="lc-node-body">
              <div class="lc-node-head">
                <span class="lc-node-order">Phase ${p.order}</span>
                <h3>${escHtml(cleanTitle)}</h3>
                ${pillHtml}
                ${scoreChip}
              </div>
              <div class="lc-node-sub">${escHtml(p.subtitle || p.description || '')}</div>
              <div class="lc-node-meta">
                <span>⏱ <b>${p.estimated_minutes || 0}</b> นาที</span>
                <span>เกณฑ์ผ่าน <b>${p.pass_score || 70}%</b></span>
                ${attemptLine}
              </div>
            </div>
            <div class="lc-node-chev">→</div>
          </div>
        </a>
      `;
    }).join('');
  }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyAccent", { configurable: true, get: () => applyAccent, set: (v) => { applyAccent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexAlpha", { configurable: true, get: () => hexAlpha, set: (v) => { hexAlpha = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHero", { configurable: true, get: () => renderHero, set: (v) => { renderHero = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPhases", { configurable: true, get: () => renderPhases, set: (v) => { renderPhases = v; } }); } catch (e) {}
})();
