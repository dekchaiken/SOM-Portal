// learn-phase — page script, extracted from learn-phase.html.
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

  // Force fresh fetch when navigating back via bfcache (avoid stale state)
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) location.reload(); });

  const phaseId = new URLSearchParams(location.search).get('id');
  if (!phaseId) { location.href = 'learn.html'; }
  if (phaseId) trackPhaseView(phaseId);

  let _phase = null;
  let _lessons = [];
  let _quiz = null;
  let _phasesAll = [];
  let _courseId = null;
  let _hasQuiz = true;   // default true — updated on init

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
    // Step 1: find phase to know course_id
    const allPhasesRes = await API.courses.listPhases();
    if (!allPhasesRes?.ok) { Toast.error('Load failed'); return; }
    const allPhases = allPhasesRes.data.data || [];
    _phase = allPhases.find(p => p.id === phaseId);
    if (!_phase) { Toast.error('ไม่เจอ phase นี้'); location.href = 'learn.html'; return; }
    _courseId = _phase.course_id;

    // Step 2: get all phases in this course + lessons + course (for accent color)
    // + quiz probe (to know if phase has quiz for CTA button)
    const [scopedRes, lessonsRes, courseRes, quizRes] = await Promise.all([
      API.courses.listPhases(_courseId),
      API.courses.listLessons(phaseId),
      API.courses.getCourse(_courseId),
      API.courses.getQuiz(phaseId),
    ]);
    _phasesAll = scopedRes?.ok ? (scopedRes.data.data || []) : [];
    _phase = _phasesAll.find(p => p.id === phaseId) || _phase;
    _hasQuiz = !!(quizRes?.ok && quizRes.data?.data?.questions?.length);

    // Apply course's accent color
    if (courseRes?.ok) applyAccent(courseRes.data.data?.cover_color);

    // Back links → course page
    document.getElementById('back-link').href = `learn-course.html?id=${encodeURIComponent(_courseId)}`;
    document.getElementById('r-back').href    = `learn-course.html?id=${encodeURIComponent(_courseId)}`;

    if (_phase.my_status === 'locked') {
      Toast.warning('Phase นี้ยังล็อกอยู่');
      location.href = `learn-course.html?id=${encodeURIComponent(_courseId)}`; return;
    }

    renderHeader();
    setupPhaseCta();
    if (lessonsRes?.ok) {
      _lessons = lessonsRes.data.data || [];
      renderLessons();
    }
  })();

  // Swap the sidebar CTA button based on whether phase has a quiz.
  // Quiz-less phases: user must click "จบเนื้อหา Phase นี้" to complete.
  function setupPhaseCta() {
    const btn = document.getElementById('phase-cta');
    const label = document.getElementById('phase-cta-label');
    if (!btn || !label) return;
    const alreadyPassed = _phase.my_status === 'passed';

    if (_hasQuiz) {
      label.textContent = alreadyPassed ? 'ทำแบบฝึกหัดอีกครั้ง' : 'ทำแบบฝึกหัด';
      btn.onclick = () => startQuiz();
    } else if (alreadyPassed) {
      label.innerHTML = '<i data-icon="check"></i> จบ Phase นี้แล้ว';
      btn.disabled = true;
      btn.style.opacity = '.6';
      btn.style.cursor  = 'default';
    } else {
      label.innerHTML = '<i data-icon="check-circle"></i> จบเนื้อหา Phase นี้';
      btn.onclick = () => completePhaseByButton();
    }
  }

  async function completePhaseByButton() {
    const btn = document.getElementById('phase-cta');
    if (!btn) return;
    const ok = await confirmDialog(
      'หลังจากนี้ระบบจะบันทึกว่า "ผ่าน" phase นี้แล้ว และปลด Phase ถัดไปให้',
      'จบเนื้อหา Phase นี้?',
      { confirmText: 'จบ Phase นี้', cancelText: 'ยกเลิก', variant: 'primary' }
    );
    if (!ok) return;
    btn.disabled = true;
    const res = await API.courses.completePhase(phaseId);
    if (!res?.ok) {
      Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
      btn.disabled = false;
      return;
    }
    Toast.success('บันทึกจบ Phase เรียบร้อย <i data-icon="sparkles"></i>');
    const next = nextPhase();
    setTimeout(() => {
      location.href = next
        ? `learn-phase.html?id=${encodeURIComponent(next.id)}`
        : `learn-course.html?id=${encodeURIComponent(_courseId)}`;
    }, 900);
  }

  function renderHeader() {
    const cleanTitle = _phase.title.replace(/^Phase\s*\d+\s*[—–-]\s*/i, '');
    document.getElementById('ph-title').textContent = `Phase ${_phase.order} — ${cleanTitle}`;
    document.getElementById('ph-sub').textContent   = _phase.subtitle || '';
    document.getElementById('ph-icon').innerHTML  = _phase.icon || '<i data-icon="book"></i>';
    document.getElementById('ph-eyebrow').textContent = `Phase ${_phase.order}`;
    document.getElementById('ph-h1').textContent    = cleanTitle;
    document.getElementById('ph-desc').textContent  = _phase.description || _phase.subtitle || '';

    const badges = {
      unlocked:    '<span class="pill pill-blue"><i data-icon="play"></i> เริ่มได้</span>',
      in_progress: '<span class="pill pill-orange"><span class="dotmark"></span> กำลังเรียน</span>',
      passed:      `<span class="pill pill-green"><i data-icon="check"></i> ผ่านแล้ว ${_phase.my_score || 0}%</span>`,
    };
    document.getElementById('ph-status-badge').innerHTML = badges[_phase.my_status] || '';
    document.getElementById('header-box').style.display = 'flex';
  }

  function renderLessons() {
    const navWrap = document.getElementById('lesson-nav-list');
    navWrap.innerHTML = _lessons.map((l, i) => `
      <a class="lp-nav-item" data-idx="${i}" onclick="scrollToLesson(${i})">
        <span class="lp-nav-num">${i+1}</span>
        <span>${escHtml(l.title)}</span>
      </a>
    `).join('');

    const container = document.getElementById('lesson-container');
    if (!_lessons.length) {
      container.innerHTML = `
        <div class="lp-lesson" style="text-align:center; padding:40px 20px">
          <div style="font-size:36px; margin-bottom:8px; opacity:.4"><i data-icon="file"></i></div>
          <p style="color:var(--text-muted); margin:0">Phase นี้ยังไม่มีเนื้อหา — ลองกดทำแบบฝึกหัดได้เลย</p>
        </div>`;
      return;
    }
    container.innerHTML = _lessons.map((l, i) => `
      <div class="lp-lesson" id="les-${i}">
        <div class="lp-lesson-eyebrow">บทเรียนที่ ${i+1}</div>
        <h2>${escHtml(l.title)}</h2>
        <div class="lp-lesson-body">${l.content_html || ''}</div>
      </div>
    `).join('');

    const first = navWrap.querySelector('.lp-nav-item');
    if (first) first.classList.add('active');

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const idx = +e.target.id.replace('les-', '');
          navWrap.querySelectorAll('.lp-nav-item').forEach(el => el.classList.remove('active'));
          const el = navWrap.querySelector(`[data-idx="${idx}"]`);
          if (el) el.classList.add('active');
        }
      });
    }, { threshold: 0.3, rootMargin: '-20% 0px -50% 0px' });
    _lessons.forEach((_, i) => {
      const el = document.getElementById('les-' + i);
      if (el) obs.observe(el);
    });
  }

  function scrollToLesson(i) {
    document.getElementById('les-' + i)?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  // ─── QUIZ ─────────────────────────────
  async function startQuiz() {
    const res = await API.courses.getQuiz(phaseId);
    if (!res?.ok) { Toast.warning('ยังไม่มีแบบฝึกหัดใน phase นี้'); return; }
    _quiz = res.data.data;
    if (!_quiz?.questions?.length) { Toast.warning('ยังไม่มีคำถาม'); return; }

    document.getElementById('view-lessons').style.display = 'none';
    document.getElementById('view-quiz').style.display    = 'block';
    document.getElementById('view-result').style.display  = 'none';

    document.getElementById('quiz-title').textContent = _quiz.title || 'แบบฝึกหัด';
    document.getElementById('quiz-desc').textContent  = (_quiz.description || '') + ` · ต้องได้ ${_phase.pass_score}% ขึ้นไปถึงผ่าน`;

    const wrap = document.getElementById('quiz-questions');
    wrap.innerHTML = _quiz.questions.map((q, i) => {
      const type = q.type || 'single';
      let optionsHtml = '';
      let typeHint = '';
      if (type === 'truefalse') {
        optionsHtml = ['true','false'].map(v => `
          <label class="q-option">
            <input type="radio" name="q_${q.id}" value="${v}">
            <span>${v === 'true' ? 'True (ถูก)' : 'False (ผิด)'}</span>
          </label>
        `).join('');
      } else if (type === 'multi') {
        typeHint = '<span class="q-hint">เลือกหลายข้อ</span>';
        optionsHtml = (q.choices || []).map((c, ci) => `
          <label class="q-option">
            <input type="checkbox" name="q_${q.id}" value="${ci}">
            <span>${escHtml(c)}</span>
          </label>
        `).join('');
      } else if (type === 'short') {
        typeHint = '<span class="q-hint">เขียนตอบ</span>';
        optionsHtml = `<div class="q-option" style="padding:0; border:none; background:none"><textarea name="q_${q.id}" rows="3" placeholder="เขียนคำตอบของคุณที่นี่..."></textarea></div>`;
      } else {
        optionsHtml = (q.choices || []).map((c, ci) => `
          <label class="q-option">
            <input type="radio" name="q_${q.id}" value="${ci}">
            <span>${escHtml(c)}</span>
          </label>
        `).join('');
      }
      return `<div class="q-block" id="qb_${q.id}" data-type="${type}" data-qid="${q.id}">
        <div class="q-question">
          <span class="q-num">${i+1}</span>
          <span class="q-text">${escHtml(q.question || '')}</span>
          ${typeHint}
        </div>
        ${optionsHtml}
      </div>`;
    }).join('');
  }

  function backToLessons() {
    document.getElementById('view-lessons').style.display = '';
    document.getElementById('view-quiz').style.display    = 'none';
    document.getElementById('view-result').style.display  = 'none';
  }

  async function submitQuiz() {
    const answers = {};
    let missing = 0;
    for (const q of _quiz.questions) {
      const type = q.type || 'single';
      if (type === 'short') {
        const ta = document.querySelector(`textarea[name="q_${q.id}"]`);
        const v = (ta?.value || '').trim();
        if (!v) { missing++; continue; }
        answers[q.id] = v;
        continue;
      }
      const inputs = document.querySelectorAll(`input[name="q_${q.id}"]`);
      if (type === 'truefalse') {
        const sel = [...inputs].find(i => i.checked);
        if (!sel) { missing++; continue; }
        answers[q.id] = sel.value === 'true';
      } else if (type === 'multi') {
        const vals = [...inputs].filter(i => i.checked).map(i => +i.value);
        if (!vals.length) { missing++; continue; }
        answers[q.id] = vals;
      } else {
        const sel = [...inputs].find(i => i.checked);
        if (!sel) { missing++; continue; }
        answers[q.id] = +sel.value;
      }
    }
    if (missing) {
      const ok = await confirmDialog(`ยังไม่ได้ตอบ ${missing} ข้อ ส่งต่อเลยไหม?`, 'ยืนยันการส่ง',
        { confirmText: 'ส่งคำตอบ', cancelText: 'ยกเลิก', variant: 'primary' });
      if (!ok) return;
    }

    document.getElementById('btn-submit').disabled = true;
    const res = await API.courses.submitQuiz({ phase_id: phaseId, answers });
    document.getElementById('btn-submit').disabled = false;
    if (!res?.ok) { Toast.error(res?.data?.message || 'ส่งล้มเหลว'); return; }

    showResult(res.data.data);
  }

  function showResult(data) {
    document.getElementById('view-quiz').style.display   = 'none';
    document.getElementById('view-result').style.display = 'block';

    const passed = !!data.passed;

    // Banner + ring color
    const banner = document.getElementById('r-banner');
    banner.classList.toggle('passed', passed);
    banner.classList.toggle('failed', !passed);
    const ringColor = passed ? '#10b981' : 'var(--accent)';
    banner.style.setProperty('--banner-soft',
      passed ? 'rgba(16,185,129,.10)' : 'var(--accent-soft)');

    const ring = document.getElementById('r-ring');
    ring.style.setProperty('--ring-pct', data.score);
    ring.style.setProperty('--ring-color', ringColor);
    document.getElementById('r-score').innerHTML = `${data.score}<span class="pct">%</span>`;

    // Status + detail
    const statusEl = document.getElementById('r-status');
    statusEl.className = 'lp-result-status ' + (passed ? 'passed' : 'failed');
    statusEl.innerHTML = passed
      ? '<i data-icon="sparkles"></i> ยินดีด้วย! ผ่านแล้ว'
      : '😔 ยังไม่ผ่านเกณฑ์';

    document.getElementById('r-detail').textContent = passed
      ? `คะแนนสูงสุดของคุณตอนนี้คือ ${data.best_score}% · ตอบถูก ${data.correct_count} จาก ${data.total_count} ข้อ`
      : `ต้องได้ ${data.pass_score}% ขึ้นไปถึงผ่าน · ขาดอีก ${Math.max(0, data.pass_score - data.score)}% เท่านั้นเอง`;

    // Stats
    document.getElementById('r-stat-score').textContent    = data.score + '%';
    document.getElementById('r-stat-best').textContent     = data.best_score + '%';
    document.getElementById('r-stat-correct').textContent  = `${data.correct_count}/${data.total_count}`;
    document.getElementById('r-stat-attempts').textContent = data.attempts;

    // Per-question summary
    const sumWrap = document.getElementById('r-summary');
    sumWrap.innerHTML = (data.summary || []).map((s, i) => {
      const q = _quiz.questions.find(x => x.id === s.q_id) || {};
      const qFull = q.question || '';
      const qText = escHtml(qFull.slice(0, 90));
      const more  = qFull.length > 90 ? '…' : '';
      return `<div class="lp-summary-row ${s.correct ? 'correct' : 'wrong'}">
        <div class="check">${s.correct ? '✓' : '✗'}</div>
        <div class="label">
          <span class="qnum">ข้อ ${i+1}</span>${qText}${more}
        </div>
        <div class="verdict">${s.correct ? 'ถูก' : 'ผิด'}</div>
      </div>`;
    }).join('');

    // Tip box for fail case
    document.getElementById('r-tip').innerHTML = passed ? '' : `
      <div class="lp-tip">
        <span class="lp-tip-icon"><i data-icon="lightbulb"></i></span>
        <div>
          ลองกลับไปอ่านบทเรียนอีกครั้ง แล้วกลับมาทำใหม่ได้เลย —
          <strong>คะแนนสูงสุดจะถูกบันทึกไว้</strong> ไม่หาย แม้คะแนนรอบใหม่จะน้อยกว่า
        </div>
      </div>`;

    // Action buttons
    const next = nextPhase();
    document.getElementById('r-next').style.display  = (passed && next) ? '' : 'none';
    document.getElementById('r-next').dataset.nextId = next?.id || '';
    document.getElementById('r-retry').style.display = passed ? 'none' : '';

    // Smooth scroll to top for celebration
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function nextPhase() {
    const sorted = [..._phasesAll].sort((a,b) => (a.order||0) - (b.order||0));
    const idx = sorted.findIndex(p => p.id === phaseId);
    return sorted[idx + 1] || null;
  }

  function retryQuiz() { startQuiz(); }
  function goNext() {
    const id = document.getElementById('r-next').dataset.nextId;
    if (id) location.href = `learn-phase.html?id=${encodeURIComponent(id)}`;
  }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyAccent", { configurable: true, get: () => applyAccent, set: (v) => { applyAccent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "backToLessons", { configurable: true, get: () => backToLessons, set: (v) => { backToLessons = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "completePhaseByButton", { configurable: true, get: () => completePhaseByButton, set: (v) => { completePhaseByButton = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "goNext", { configurable: true, get: () => goNext, set: (v) => { goNext = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexAlpha", { configurable: true, get: () => hexAlpha, set: (v) => { hexAlpha = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "nextPhase", { configurable: true, get: () => nextPhase, set: (v) => { nextPhase = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHeader", { configurable: true, get: () => renderHeader, set: (v) => { renderHeader = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderLessons", { configurable: true, get: () => renderLessons, set: (v) => { renderLessons = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "retryQuiz", { configurable: true, get: () => retryQuiz, set: (v) => { retryQuiz = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "scrollToLesson", { configurable: true, get: () => scrollToLesson, set: (v) => { scrollToLesson = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupPhaseCta", { configurable: true, get: () => setupPhaseCta, set: (v) => { setupPhaseCta = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showResult", { configurable: true, get: () => showResult, set: (v) => { showResult = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "startQuiz", { configurable: true, get: () => startQuiz, set: (v) => { startQuiz = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitQuiz", { configurable: true, get: () => submitQuiz, set: (v) => { submitQuiz = v; } }); } catch (e) {}
})();
