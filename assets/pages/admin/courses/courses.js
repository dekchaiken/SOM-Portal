// admin/courses — page script, extracted from admin/courses.html.
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

  // Global state
  let _courses = [];
  let _phases  = [];
  let _lessons = [];
  let _currentQuiz = null;
  let _progReport = null;

  // ─── TABS ──────────────────────────────
  document.querySelectorAll('.c-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.c-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.c-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'phases')   loadPhases();
      if (tab.dataset.tab === 'lessons')  loadLessonContext();
      if (tab.dataset.tab === 'quiz')     loadQuizContext();
      if (tab.dataset.tab === 'progress') loadProgress();
      if (tab.dataset.tab === 'pagecfg')  loadPageCfg();
    });
  });

  function closeAllModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });

  // ─── COURSES ───────────────────────────
  async function loadCourses() {
    const res = await API.courses.listCourses();
    if (!res?.ok) { Toast.error('โหลด courses ไม่สำเร็จ'); return; }
    _courses = res.data.data || [];
    renderCourses();
    fillCourseSelects();
  }

  function renderCourses() {
    const grid = document.getElementById('course-grid');
    if (!_courses.length) {
      grid.innerHTML = '<div style="grid-column:1/-1" class="empty-state"><p>ยังไม่มี course — กด + สร้าง Course</p></div>';
      return;
    }
    const myTeam = Auth.getTeam();
    grid.innerHTML = _courses.map(c => {
      const isShared    = !!c.shared;
      const owner       = c.owner_team || '';
      const iOwn        = !isShared || owner === myTeam;
      const readOnly    = isShared && !iOwn;
      const sharedPill  = isShared
        ? (iOwn
            ? '<span class="pill pill-blue" style="font-size:10px; padding:3px 9px" title="ทีมของคุณเป็นเจ้าของ shared course นี้"><i data-icon="globe"></i> Shared</span>'
            : `<span class="pill pill-gray" style="font-size:10px; padding:3px 9px" title="Shared จากทีม ${escHtml(owner)}"><i data-icon="globe"></i> จาก ${escHtml(owner)}</span>`)
        : '';
      const editBtn = readOnly
        ? `<button class="btn btn-ghost btn-sm" disabled title="แก้ไขได้เฉพาะทีมเจ้าของ (${escHtml(owner)})" style="opacity:.5"><i data-icon="eye"></i> ดู</button>`
        : `<button class="btn btn-ghost btn-sm" onclick='openCourseModal(${JSON.stringify(c.id)})'><i data-icon="pencil"></i> แก้ไข</button>`;
      const delBtn = readOnly
        ? ''
        : `<button class="btn btn-ghost btn-sm" onclick='deleteCourse(${JSON.stringify(c.id)}, ${JSON.stringify(c.title)})' style="color:#ef4444; margin-left:auto"><i data-icon="trash"></i> ลบ</button>`;
      return `
      <div class="c-card" style="--c-accent:${escHtml(c.cover_color || '#f26419')}">
        <div class="c-card-head">
          <div class="c-card-icon">${renderIcon(c.icon)}</div>
          <div style="flex:1; min-width:0">
            <div class="c-card-title">${escHtml(c.title)}</div>
            <div class="c-card-sub">${escHtml(c.subtitle || '')}</div>
          </div>
        </div>
        <div class="c-card-stats">
          ${c.published
            ? '<span class="pill pill-green" style="font-size:10px; padding:3px 9px">● Published</span>'
            : '<span class="pill pill-gray"  style="font-size:10px; padding:3px 9px">○ Draft</span>'}
          ${sharedPill}
          <span><i data-icon="book-open"></i> <b>${c.phases_count || 0}</b> phases</span>
          <span>#<b>${c.order}</b></span>
        </div>
        <div class="c-card-meta">
          <div class="c-card-actions">
            ${editBtn}
            ${delBtn}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function fillCourseSelects() {
    // Shared courses owned by other teams show up in the merged list but the
    // API rejects mutations on them — mark those as disabled in the picker
    // used for phase creation (`pm-course`) so admins don't pick a course
    // they'll get 403 back from. Filter dropdowns and progress filter keep
    // them enabled since read-only browsing across shared courses is useful.
    const myTeam = Auth.getTeam();
    const optsAll = _courses.map(c => {
      const foreign = !!c.shared && c.owner_team && c.owner_team !== myTeam;
      return { c, foreign };
    });
    ['ph-course-filter','les-course','qz-course','pm-course','prog-course-filter'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      const prefix = id === 'prog-course-filter' ? '<option value="">ทั้งหมด (ทุก course)</option>' : '';
      const isCreatePicker = (id === 'pm-course');
      sel.innerHTML = prefix + optsAll.map(({ c, foreign }) => {
        const disabled = isCreatePicker && foreign ? ' disabled' : '';
        const suffix   = foreign ? ` (<i data-icon="globe"></i> ${escHtml(c.owner_team)})` : '';
        return `<option value="${c.id}"${disabled}>${escHtml(c.title)}${suffix}</option>`;
      }).join('');
      if (current) sel.value = current;
      else if (_courses[0] && id !== 'prog-course-filter') {
        // For the create picker, prefer the first owned course
        const preferOwned = isCreatePicker
          ? (optsAll.find(o => !o.foreign)?.c ?? _courses[0])
          : _courses[0];
        sel.value = preferOwned.id;
      }
    });
  }

  function openCourseModal(id = null) {
    const c = id ? _courses.find(x => x.id === id) : null;
    document.getElementById('m-course-title').textContent = c ? 'แก้ไข Course' : 'สร้าง Course ใหม่';
    document.getElementById('cm-id').value       = c?.id || '';
    document.getElementById('cm-icon').value     = c?.icon || '<i data-icon="book"></i>';
    document.getElementById('cm-order').value    = c?.order || (_courses.length + 1);
    document.getElementById('cm-title').value    = c?.title || '';
    document.getElementById('cm-subtitle').value = c?.subtitle || '';
    document.getElementById('cm-desc').value     = c?.description || '';
    document.getElementById('cm-color').value    = c?.cover_color || '#f26419';
    document.getElementById('cm-pub').value      = c ? (c.published ? '1' : '0') : '1';
    document.getElementById('cm-popular').checked = !!(c?.is_popular);

    // Shared toggle — the API rejects PUTs from non-owner teams, so we mirror
    // that here: only enable when the current team owns the course (or when
    // creating a new one, since the current team becomes the owner).
    const myTeam = Auth.getTeam();
    const chk    = document.getElementById('cm-shared');
    const row    = document.getElementById('cm-shared-row');
    const note   = document.getElementById('cm-shared-note');
    chk.checked  = !!(c?.shared);
    const isNew  = !c;
    const owner  = c?.owner_team || myTeam;
    const iOwn   = !c?.shared || owner === myTeam;
    chk.disabled = !isNew && !iOwn;
    row.style.opacity = chk.disabled ? '.55' : '1';
    if (!isNew && c?.shared && owner !== myTeam) {
      note.textContent = `Shared course นี้เป็นของทีม "${owner}" — ทีมของคุณเข้าเรียนได้แต่แก้ไขไม่ได้`;
    } else if (!isNew && c?.shared) {
      note.textContent = 'Untick ถ้าต้องการยกเลิกการแชร์ — ทีมอื่นจะเห็นคอร์สนี้ทันทีเมื่อกดบันทึก';
    } else {
      note.textContent = 'เมื่อ tick แล้วบันทึก คอร์สจะขึ้นในลิสต์ของทุกทีม';
    }

    renderPrereqPicker(c);
    document.getElementById('m-course').classList.add('active');
  }

  function renderPrereqPicker(editingCourse = null) {
    const wrap = document.getElementById('cm-prereqs');
    const selfId = editingCourse?.id || '';
    const selected = new Set(editingCourse?.prerequisites || []);
    // Exclude self
    const options = _courses.filter(x => x.id !== selfId);
    if (!options.length) {
      wrap.innerHTML = '<div style="font-size:11px; color:var(--text-muted)">ยังไม่มีคอร์สอื่นให้เลือกเป็น prerequisite</div>';
      return;
    }
    wrap.innerHTML = options.map(o => `
      <label style="display:flex; gap:8px; align-items:center; font-size:12px; cursor:pointer; padding:4px 6px; border-radius:4px">
        <input type="checkbox" value="${escHtml(o.id)}" ${selected.has(o.id) ? 'checked' : ''}>
        <span style="font-size:16px">${renderIcon(o.icon)}</span>
        <span>${escHtml(o.title)}</span>
      </label>
    `).join('');
  }

  async function saveCourse() {
    const id = document.getElementById('cm-id').value;
    const prereqs = [...document.querySelectorAll('#cm-prereqs input[type=checkbox]:checked')].map(i => i.value);
    const data = {
      icon:          document.getElementById('cm-icon').value.trim(),
      order:         +document.getElementById('cm-order').value || 1,
      title:         document.getElementById('cm-title').value.trim(),
      subtitle:      document.getElementById('cm-subtitle').value.trim(),
      description:   document.getElementById('cm-desc').value.trim(),
      cover_color:   document.getElementById('cm-color').value,
      published:     document.getElementById('cm-pub').value === '1',
      is_popular:    document.getElementById('cm-popular').checked,
      shared:        document.getElementById('cm-shared').checked,
      prerequisites: prereqs,
    };
    if (!data.title) { Toast.warning('กรอกชื่อ course'); return; }
    const res = id ? await API.courses.updateCourse(id, data) : await API.courses.createCourse(data);
    if (res?.ok) { Toast.success('บันทึกแล้ว'); closeAllModals(); loadCourses(); }
    else Toast.error(res?.data?.message || 'บันทึกล้มเหลว');
  }

  async function deleteCourse(id, title) {
    const ok = await confirmDialog(`ลบ course "${title}" พร้อม phases/lessons/quizzes/progress ทั้งหมด?`, 'ลบ Course');
    if (!ok) return;
    const res = await API.courses.deleteCourse(id);
    if (res?.ok) { Toast.success('ลบแล้ว'); loadCourses(); }
    else Toast.error(res?.data?.message || 'ลบล้มเหลว');
  }

  // ─── PHASES ────────────────────────────
  async function loadPhases() {
    const cid = document.getElementById('ph-course-filter').value;
    if (!cid) { document.getElementById('phase-list').innerHTML = '<div class="empty-state"><p>เลือก course ก่อน</p></div>'; return; }
    const res = await API.courses.listPhases(cid);
    if (!res?.ok) { Toast.error('โหลด phases ไม่สำเร็จ'); return; }
    _phases = res.data.data || [];
    const wrap = document.getElementById('phase-list');
    if (!_phases.length) {
      wrap.innerHTML = '<div class="empty-state"><p>ยังไม่มี phase — กด + เพิ่ม Phase</p></div>';
      return;
    }
    wrap.innerHTML = _phases.map(p => `
      <div class="c-row">
        <div class="c-row-icon">${renderIcon(p.icon)}</div>
        <div class="c-row-body">
          <div class="c-row-title">${p.order}. ${escHtml(p.title)}</div>
          <div class="c-row-sub">${escHtml(p.subtitle || '')} · ⏱ ${p.estimated_minutes||0} นาที · เกณฑ์ผ่าน ${p.pass_score||70}%</div>
        </div>
        <div class="c-row-actions">
          <button class="btn btn-ghost btn-sm" onclick='openPhaseModal(${JSON.stringify(p.id)})'>แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick='deletePhase(${JSON.stringify(p.id)}, ${JSON.stringify(p.title)})'>ลบ</button>
        </div>
      </div>
    `).join('');
  }
  document.getElementById('ph-course-filter').addEventListener('change', loadPhases);

  function openPhaseModal(id = null) {
    const p = id ? _phases.find(x => x.id === id) : null;
    document.getElementById('m-phase-title').textContent = p ? 'แก้ไข Phase' : 'เพิ่ม Phase ใหม่';
    document.getElementById('pm-id').value       = p?.id || '';
    document.getElementById('pm-course').value   = p?.course_id || document.getElementById('ph-course-filter').value;
    document.getElementById('pm-icon').value     = p?.icon || '<i data-icon="book"></i>';
    document.getElementById('pm-order').value    = p?.order || (_phases.length + 1);
    document.getElementById('pm-title').value    = p?.title || '';
    document.getElementById('pm-subtitle').value = p?.subtitle || '';
    document.getElementById('pm-desc').value     = p?.description || '';
    document.getElementById('pm-pass').value     = p?.pass_score || 70;
    document.getElementById('pm-minutes').value  = p?.estimated_minutes || 20;
    document.getElementById('m-phase').classList.add('active');
  }

  async function savePhase() {
    const id = document.getElementById('pm-id').value;
    const data = {
      course_id:         document.getElementById('pm-course').value,
      icon:              document.getElementById('pm-icon').value.trim(),
      order:             +document.getElementById('pm-order').value || 1,
      title:             document.getElementById('pm-title').value.trim(),
      subtitle:          document.getElementById('pm-subtitle').value.trim(),
      description:       document.getElementById('pm-desc').value.trim(),
      pass_score:        +document.getElementById('pm-pass').value || 70,
      estimated_minutes: +document.getElementById('pm-minutes').value || 20,
    };
    if (!data.course_id) { Toast.warning('เลือก course'); return; }
    if (!data.title)     { Toast.warning('กรอก title'); return; }
    const res = id ? await API.courses.updatePhase(id, data) : await API.courses.createPhase(data);
    if (res?.ok) { Toast.success('บันทึกแล้ว'); closeAllModals(); loadPhases(); }
    else Toast.error(res?.data?.message || 'บันทึกล้มเหลว');
  }

  async function deletePhase(id, title) {
    const ok = await confirmDialog(`ลบ phase "${title}" พร้อม lessons/quiz/progress ที่ผูกอยู่?`, 'ลบ Phase');
    if (!ok) return;
    const res = await API.courses.deletePhase(id);
    if (res?.ok) { Toast.success('ลบแล้ว'); loadPhases(); }
    else Toast.error(res?.data?.message || 'ลบล้มเหลว');
  }

  // ─── LESSONS ───────────────────────────
  async function loadLessonContext() {
    const cid = document.getElementById('les-course').value;
    if (!cid) { document.getElementById('lesson-list').innerHTML = '<div class="empty-state"><p>เลือก course</p></div>'; return; }
    const res = await API.courses.listPhases(cid);
    const phases = res?.ok ? (res.data.data || []) : [];
    const phSel = document.getElementById('les-phase');
    const cur = phSel.value;
    phSel.innerHTML = phases.map(p => `<option value="${p.id}">${p.order}. ${escHtml(p.title)}</option>`).join('');
    if (cur && phases.find(p => p.id === cur)) phSel.value = cur;
    _phases = phases;
    loadLessons();
  }
  document.getElementById('les-course').addEventListener('change', loadLessonContext);
  document.getElementById('les-phase').addEventListener('change', loadLessons);

  async function loadLessons() {
    const pid = document.getElementById('les-phase').value;
    if (!pid) { document.getElementById('lesson-list').innerHTML = '<div class="empty-state"><p>เลือก phase</p></div>'; return; }
    const res = await API.courses.listLessons(pid);
    if (!res?.ok) { Toast.error('โหลด lessons ไม่สำเร็จ'); return; }
    _lessons = res.data.data || [];
    const wrap = document.getElementById('lesson-list');
    if (!_lessons.length) { wrap.innerHTML = '<div class="empty-state"><p>ยังไม่มี lesson — กด + เพิ่ม Lesson</p></div>'; return; }
    wrap.innerHTML = _lessons.map(l => `
      <div class="c-row">
        <div class="c-row-icon" style="font-size:14px; color:var(--text-muted); font-weight:700">${l.order}</div>
        <div class="c-row-body">
          <div class="c-row-title">${escHtml(l.title)}</div>
          <div class="c-row-sub">${escHtml((l.content_html || '').replace(/<[^>]+>/g, ' ').slice(0, 110))}...</div>
        </div>
        <div class="c-row-actions">
          <button class="btn btn-ghost btn-sm" onclick='openLessonModal(${JSON.stringify(l.id)})'>แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick='deleteLesson(${JSON.stringify(l.id)}, ${JSON.stringify(l.title)})'>ลบ</button>
        </div>
      </div>
    `).join('');
  }

  // ─── RICH TEXT EDITOR ──────────────────
  function rteCmd(cmd) {
    document.getElementById('lm-editor').focus();
    document.execCommand(cmd, false, null);
    syncLessonEditor();
  }
  function rteBlock(tag) {
    document.getElementById('lm-editor').focus();
    document.execCommand('formatBlock', false, tag);
    syncLessonEditor();
  }
  function rteTable() {
    const html = `<table><thead><tr><th>หัวข้อ 1</th><th>หัวข้อ 2</th><th>หัวข้อ 3</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>`;
    document.getElementById('lm-editor').focus();
    document.execCommand('insertHTML', false, html);
    syncLessonEditor();
  }
  function rteCode() {
    document.getElementById('lm-editor').focus();
    document.execCommand('insertHTML', false, `<pre><code>// พิมพ์โค้ดที่นี่</code></pre><p><br></p>`);
    syncLessonEditor();
  }
  function rteLink() {
    const url = prompt('URL ที่ต้องการลิงก์:');
    if (!url) return;
    document.getElementById('lm-editor').focus();
    document.execCommand('createLink', false, url);
    // Make links open in new tab
    document.getElementById('lm-editor').querySelectorAll('a:not([target])').forEach(a => {
      a.target = '_blank'; a.rel = 'noopener';
    });
  }
  const _calloutMeta = {
    tip:     { icon: '<i data-icon="lightbulb"></i>', label: 'Tip' },
    warning: { icon: '<i data-icon="alert-triangle"></i>', label: 'Warning' },
    danger:  { icon: '<i data-icon="x-circle"></i>', label: 'Danger' },
    success: { icon: '<i data-icon="check-circle"></i>', label: 'Success' },
    note:    { icon: '<i data-icon="pin"></i>', label: 'Note' },
  };
  function rteCallout(type) {
    if (!type) return;
    const m = _calloutMeta[type];
    const html = `<div class="callout callout-${type}"><span class="callout-icon">${m.icon}</span><div class="callout-body"><strong>${m.label}:</strong> พิมพ์ข้อความที่นี่</div></div><p><br></p>`;
    document.getElementById('lm-editor').focus();
    document.execCommand('insertHTML', false, html);
  }
  function rtePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    syncLessonEditor();
  }
  function syncLessonEditor() {}

  async function openLessonModal(id = null) {
    const phSel = document.getElementById('lm-phase');
    const cid = document.getElementById('les-course').value;
    if (cid) {
      const res = await API.courses.listPhases(cid);
      const ph = res?.ok ? (res.data.data || []) : [];
      phSel.innerHTML = ph.map(p => `<option value="${p.id}">${p.order}. ${escHtml(p.title)}</option>`).join('');
    }
    const l = id ? _lessons.find(x => x.id === id) : null;
    document.getElementById('m-lesson-title').textContent = l ? 'แก้ไข Lesson' : 'เพิ่ม Lesson ใหม่';
    document.getElementById('lm-id').value    = l?.id || '';
    document.getElementById('lm-phase').value = l?.phase_id || document.getElementById('les-phase').value;
    document.getElementById('lm-order').value = l?.order || ((_lessons[_lessons.length-1]?.order || 0) + 1);
    document.getElementById('lm-title').value = l?.title || '';
    document.getElementById('lm-editor').innerHTML = l?.content_html || '';
    syncLessonEditor();
    document.getElementById('m-lesson').classList.add('active');
  }

  async function saveLesson() {
    const id = document.getElementById('lm-id').value;
    const data = {
      phase_id:     document.getElementById('lm-phase').value,
      order:        +document.getElementById('lm-order').value || 1,
      title:        document.getElementById('lm-title').value.trim(),
      content_html: document.getElementById('lm-editor').innerHTML,
    };
    if (!data.title) { Toast.warning('กรอก title'); return; }
    const res = id ? await API.courses.updateLesson(id, data) : await API.courses.createLesson(data);
    if (res?.ok) { Toast.success('บันทึกแล้ว'); closeAllModals(); loadLessons(); }
    else Toast.error(res?.data?.message || 'บันทึกล้มเหลว');
  }

  async function deleteLesson(id, title) {
    const ok = await confirmDialog(`ลบ lesson "${title}"?`, 'ลบ Lesson');
    if (!ok) return;
    const res = await API.courses.deleteLesson(id);
    if (res?.ok) { Toast.success('ลบแล้ว'); loadLessons(); }
    else Toast.error(res?.data?.message || 'ลบล้มเหลว');
  }

  // ─── QUIZ ──────────────────────────────
  async function loadQuizContext() {
    const cid = document.getElementById('qz-course').value;
    if (!cid) return;
    const res = await API.courses.listPhases(cid);
    const ph = res?.ok ? (res.data.data || []) : [];
    const phSel = document.getElementById('qz-phase');
    const cur = phSel.value;
    phSel.innerHTML = ph.map(p => `<option value="${p.id}">${p.order}. ${escHtml(p.title)}</option>`).join('');
    if (cur && ph.find(p => p.id === cur)) phSel.value = cur;
    loadQuiz();
  }
  document.getElementById('qz-course').addEventListener('change', loadQuizContext);
  document.getElementById('qz-phase').addEventListener('change', loadQuiz);

  async function loadQuiz() {
    const pid = document.getElementById('qz-phase').value;
    if (!pid) { return; }
    const res = await API.courses.getQuiz(pid);
    _currentQuiz = res?.ok ? res.data.data : { phase_id: pid, title: 'Quiz', description: '', questions: [] };
    document.getElementById('qz-title').value = _currentQuiz.title || 'Quiz';
    document.getElementById('qz-desc').value  = _currentQuiz.description || '';
    renderQuestions();
  }

  function renderQuestions() {
    const wrap = document.getElementById('qz-questions');
    const qs = _currentQuiz?.questions || [];
    if (!qs.length) { wrap.innerHTML = '<div style="color:var(--text-muted); padding:12px 0; font-size:12px">ยังไม่มีคำถาม — กด + เพิ่มคำถาม</div>'; return; }
    wrap.innerHTML = qs.map((q, i) => renderQuestion(q, i)).join('');
  }

  function renderQuestion(q, idx) {
    const type = q.type || 'single';
    let choicesHtml = '';
    if (type === 'truefalse') {
      choicesHtml = `
        <div class="qb-choice">
          <select class="form-control" onchange="updateQAnswer(${idx}, this.value === 'true')">
            <option value="true"${q.answer===true?' selected':''}>True (ถูก)</option>
            <option value="false"${q.answer===false?' selected':''}>False (ผิด)</option>
          </select>
        </div>`;
    } else if (type === 'short') {
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer || ''];
      const mode = q.match_mode || 'exact';
      const cs = !!q.case_sensitive;
      const answerRows = answers.map((a, ai) => `
        <div class="qb-choice">
          <input type="text" class="form-control" placeholder="คำตอบที่ถูก (เพิ่มได้หลายคำตอบ)" value="${escHtml(a)}" oninput="updateShortAnswer(${idx}, ${ai}, this.value)">
          <button class="btn btn-ghost btn-sm" onclick="removeShortAnswer(${idx}, ${ai})"${answers.length<=1?' disabled':''}><i data-icon="x"></i></button>
        </div>
      `).join('');
      choicesHtml = `
        ${answerRows}
        <button class="btn btn-ghost btn-sm" onclick="addShortAnswer(${idx})">+ เพิ่มคำตอบที่ยอมรับ</button>
        <div style="display:flex; gap:10px; margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); flex-wrap:wrap">
          <label style="font-size:11px; display:flex; align-items:center; gap:6px">
            โหมด
            <select class="form-control" style="width:140px" onchange="updateShortOpt(${idx}, 'match_mode', this.value)">
              <option value="exact"${mode==='exact'?' selected':''}>Exact (ตรงเป๊ะ)</option>
              <option value="contains"${mode==='contains'?' selected':''}>Contains (มีคำนี้)</option>
              <option value="regex"${mode==='regex'?' selected':''}>Regex</option>
            </select>
          </label>
          <label style="font-size:11px; display:flex; align-items:center; gap:6px">
            <input type="checkbox" ${cs?'checked':''} onchange="updateShortOpt(${idx}, 'case_sensitive', this.checked)">
            แยกตัวพิมพ์ใหญ่-เล็ก
          </label>
        </div>
        <div style="font-size:10.5px; color:var(--text-muted); margin-top:6px">
          <i data-icon="lightbulb"></i> ใช้ <strong>Contains</strong> เมื่ออยากยอมรับคำตอบที่มีคำสำคัญอยู่ เช่น ตอบยาวๆ / ใช้ <strong>Regex</strong> เมื่อต้องการ pattern ซับซ้อน
        </div>`;
    } else {
      const choices = q.choices || [];
      choicesHtml = choices.map((c, ci) => {
        const checked = type==='single' ? (q.answer===ci) : (Array.isArray(q.answer) && q.answer.includes(ci));
        const inputType = type==='single' ? 'radio' : 'checkbox';
        return `<div class="qb-choice">
          <input type="${inputType}" name="q${idx}_ans" ${checked?'checked':''} onchange="updateChoiceAnswer(${idx}, ${ci}, this.checked)">
          <input type="text" class="form-control" value="${escHtml(c)}" oninput="updateChoice(${idx}, ${ci}, this.value)">
          <button class="btn btn-ghost btn-sm" onclick="removeChoice(${idx}, ${ci})"><i data-icon="x"></i></button>
        </div>`;
      }).join('');
      choicesHtml += `<button class="btn btn-ghost btn-sm" onclick="addChoice(${idx})">+ ตัวเลือก</button>`;
    }

    return `<div class="qb">
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px">
        <strong>Q${idx+1}</strong>
        <select class="form-control" style="width:170px" onchange="updateQType(${idx}, this.value)">
          <option value="single"${type==='single'?' selected':''}>Single choice</option>
          <option value="multi"${type==='multi'?' selected':''}>Multi choice</option>
          <option value="truefalse"${type==='truefalse'?' selected':''}>True / False</option>
          <option value="short"${type==='short'?' selected':''}>Short answer (เขียนตอบ)</option>
        </select>
        <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="removeQuestion(${idx})">ลบคำถาม</button>
      </div>
      <div class="form-field"><label>คำถาม</label><input type="text" class="form-control" value="${escHtml(q.question || '')}" oninput="updateQText(${idx}, this.value)"></div>
      <div class="form-field"><label>${type==='short' ? 'คำตอบที่ยอมรับ' : 'ตัวเลือก / คำตอบ'}</label>${choicesHtml}</div>
      <div class="form-field" style="margin-bottom:0"><label>คำอธิบาย (จะไม่โชว์ให้ผู้ใช้หลังส่ง)</label><input type="text" class="form-control" value="${escHtml(q.explain || '')}" oninput="updateQExplain(${idx}, this.value)"></div>
    </div>`;
  }

  function ensureQuiz() {
    if (!_currentQuiz) _currentQuiz = { phase_id: document.getElementById('qz-phase').value, title:'Quiz', description:'', questions: [] };
    if (!Array.isArray(_currentQuiz.questions)) _currentQuiz.questions = [];
  }
  function addQuestion() {
    ensureQuiz();
    _currentQuiz.questions.push({ id: 'q_' + Math.random().toString(36).slice(2, 8), type: 'single', question: '', choices: ['', ''], answer: 0, explain: '' });
    renderQuestions();
  }
  function removeQuestion(i) { _currentQuiz.questions.splice(i, 1); renderQuestions(); }
  function updateQText(i, v)    { _currentQuiz.questions[i].question = v; }
  function updateQExplain(i, v) { _currentQuiz.questions[i].explain  = v; }
  function updateQType(i, t) {
    const q = _currentQuiz.questions[i]; q.type = t;
    if (t === 'truefalse') { q.choices = []; q.answer = true; }
    else if (t === 'short') { q.choices = []; q.answer = ['']; q.match_mode = q.match_mode || 'exact'; q.case_sensitive = !!q.case_sensitive; }
    else { q.choices = q.choices?.length ? q.choices : ['', '']; q.answer = (t === 'multi') ? [] : 0; }
    renderQuestions();
  }
  function addChoice(i)        { _currentQuiz.questions[i].choices.push(''); renderQuestions(); }
  function removeChoice(i, ci) { _currentQuiz.questions[i].choices.splice(ci, 1); renderQuestions(); }
  function updateChoice(i, ci, v) { _currentQuiz.questions[i].choices[ci] = v; }
  function updateQAnswer(i, v)    { _currentQuiz.questions[i].answer = v; }
  function updateChoiceAnswer(i, ci, checked) {
    const q = _currentQuiz.questions[i];
    if (q.type === 'single') q.answer = ci;
    else { const set = new Set(Array.isArray(q.answer) ? q.answer : []); checked ? set.add(ci) : set.delete(ci); q.answer = [...set].sort(); }
  }
  // Short-answer helpers
  function addShortAnswer(i) {
    const q = _currentQuiz.questions[i];
    if (!Array.isArray(q.answer)) q.answer = [q.answer || ''];
    q.answer.push('');
    renderQuestions();
  }
  function removeShortAnswer(i, ai) {
    const q = _currentQuiz.questions[i];
    if (Array.isArray(q.answer) && q.answer.length > 1) q.answer.splice(ai, 1);
    renderQuestions();
  }
  function updateShortAnswer(i, ai, v) {
    const q = _currentQuiz.questions[i];
    if (!Array.isArray(q.answer)) q.answer = [q.answer || ''];
    q.answer[ai] = v;
  }
  function updateShortOpt(i, key, v) {
    _currentQuiz.questions[i][key] = v;
  }
  async function saveQuiz() {
    ensureQuiz();
    const data = {
      phase_id:    document.getElementById('qz-phase').value,
      title:       document.getElementById('qz-title').value.trim() || 'Quiz',
      description: document.getElementById('qz-desc').value.trim(),
      questions:   _currentQuiz.questions,
    };
    if (!data.phase_id) { Toast.warning('เลือก phase'); return; }
    const res = await API.courses.saveQuiz(data);
    if (res?.ok) Toast.success('บันทึก quiz แล้ว');
    else Toast.error(res?.data?.message || 'บันทึกล้มเหลว');
  }

  // ─── PROGRESS ─────────────────────────
  async function loadProgress() {
    const cid = document.getElementById('prog-course-filter').value || '';
    const res = await API.courses.allProgress(cid);
    if (!res?.ok) { Toast.error('โหลด progress ไม่สำเร็จ'); return; }
    _progReport = res.data.data || {};
    const stats = _progReport.stats || {};
    document.getElementById('st-total').textContent  = stats.users_total || 0;
    document.getElementById('st-done').textContent   = stats.users_completed || 0;
    document.getElementById('st-inprog').textContent = stats.users_in_progress || 0;
    document.getElementById('st-none').textContent   = stats.users_not_started || 0;
    document.getElementById('st-avg').textContent    = (stats.avg_percent || 0) + '%';

    const users = _progReport.users || [];
    const wrap = document.getElementById('progress-table');
    if (!users.length) { wrap.innerHTML = '<div class="empty-state"><p>ยังไม่มีข้อมูล</p></div>'; return; }

    wrap.innerHTML = `<div class="table-wrap"><table>
      <thead><tr>
        <th>ชื่อ</th><th>Role</th><th>ความคืบหน้า</th><th>ผ่าน / ทั้งหมด</th><th>รอบที่ลอง</th><th>สถานะ</th><th>Active ล่าสุด</th><th></th>
      </tr></thead>
      <tbody>
        ${users.map(r => `<tr>
          <td style="font-weight:600">${escHtml(r.name)}<div style="font-size:10px; color:var(--text-muted)">${escHtml(r.username)}</div></td>
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
            <button class="btn btn-ghost btn-sm" onclick='resetUserProgress(${JSON.stringify(r.user_id)}, ${JSON.stringify(r.name)})' style="color:#ef4444" title="Reset progress">🗑</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }
  document.getElementById('prog-course-filter').addEventListener('change', loadProgress);

  async function resetUserProgress(userId, userName) {
    const cid = document.getElementById('prog-course-filter').value || '';
    const cName = cid
      ? (_courses.find(c => c.id === cid)?.title || cid)
      : 'ทุก course';
    const ok = await confirmDialog(
      `จะ reset progress ของ "${userName}" ใน "${cName}" — กู้คืนไม่ได้`,
      'Reset Progress'
    );
    if (!ok) return;
    const res = await API.courses.resetUser(userId, cid);
    if (!res?.ok) return Toast.error(res?.data?.message || 'Reset failed');
    Toast.success(`Reset แล้ว (${res.data?.data?.removed || 0} record)`);
    loadProgress();
  }

  async function resetAllProgress() {
    const cid = document.getElementById('prog-course-filter').value || '';
    const cName = cid
      ? (_courses.find(c => c.id === cid)?.title || cid)
      : '<i data-icon="alert-triangle"></i> ทุก course ของทุกคน';
    const ok = await confirmDialog(
      `จะ reset progress ของ ${cName} — ผู้ใช้ทุกคน กู้คืนไม่ได้`,
      'Reset ทั้งหมด'
    );
    if (!ok) return;
    const res = await API.courses.resetAll(cid);
    if (!res?.ok) return Toast.error(res?.data?.message || 'Reset failed');
    Toast.success(`Reset แล้ว (${res.data?.data?.removed || 0} record)`);
    loadProgress();
  }
  window.resetUserProgress = resetUserProgress;
  window.resetAllProgress = resetAllProgress;

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
    if (!res?.ok) { body.innerHTML = '<div style="color:var(--text-muted)">โหลดไม่สำเร็จ</div>'; return; }

    const d = res.data.data;
    const u = d.user;
    body.innerHTML = `
      <div style="margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border)">
        <div style="font-size:14px; font-weight:700">${escHtml(u.name)}</div>
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
    const head = ['name','username','role','percent','phases_passed','phases_total','attempts','status','last_active'];
    const rows = users.map(r => [
      r.name, r.username, r.role, r.percent, r.phases_passed, r.phases_total,
      r.total_attempts, r.status_bucket, r.last_active || ''
    ]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'course_progress_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  }

  // ─── PAGE SETTINGS (learn.html) ────────
  const PC_DEFAULTS = {
    hero_title:     '',
    hero_subtitle:  '',
    accent_color:   '#f26419',
    layout_density: 'comfortable',
    show_tab_badge: true,
  };
  const PC_FALLBACK_SUB = 'เลือกแท็บ Learns เพื่อเรียนคอร์ส หรือ Exams เพื่อเข้าทำข้อสอบประจำปี';
  let _pageCfgLoaded = false;

  async function loadPageCfg() {
    const res = await API.courses.getPageConfig();
    if (!res?.ok) { Toast.error('โหลด page config ไม่สำเร็จ'); return; }
    const cfg = { ...PC_DEFAULTS, ...(res.data?.data || {}) };
    document.getElementById('pc-hero-title').value = cfg.hero_title || '';
    document.getElementById('pc-hero-sub').value   = cfg.hero_subtitle || '';
    document.getElementById('pc-accent').value     = cfg.accent_color;
    document.getElementById('pc-accent-hex').value = cfg.accent_color;
    document.getElementById('pc-density').value    = cfg.layout_density;
    document.getElementById('pc-badge').checked    = !!cfg.show_tab_badge;
    if (!_pageCfgLoaded) bindPageCfgPreview();
    _pageCfgLoaded = true;
    renderPageCfgPreview();
  }

  function bindPageCfgPreview() {
    ['pc-hero-title','pc-hero-sub','pc-accent','pc-accent-hex','pc-density','pc-badge']
      .forEach(id => document.getElementById(id).addEventListener('input', () => {
        // Mirror color picker ↔ hex
        if (id === 'pc-accent') document.getElementById('pc-accent-hex').value = document.getElementById('pc-accent').value;
        if (id === 'pc-accent-hex') {
          const v = document.getElementById('pc-accent-hex').value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) document.getElementById('pc-accent').value = v;
        }
        renderPageCfgPreview();
      }));
    document.getElementById('pc-badge').addEventListener('change', renderPageCfgPreview);
    document.getElementById('pc-density').addEventListener('change', renderPageCfgPreview);
  }

  function pcResetAccent() {
    document.getElementById('pc-accent').value     = PC_DEFAULTS.accent_color;
    document.getElementById('pc-accent-hex').value = PC_DEFAULTS.accent_color;
    renderPageCfgPreview();
  }
  window.pcResetAccent = pcResetAccent;

  function hexAlpha(hex, a) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return `rgba(242,100,25,${a})`;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  }

  function renderPageCfgPreview() {
    const title   = document.getElementById('pc-hero-title').value.trim() || 'สวัสดี ผู้ใช้ 👋';
    const sub     = document.getElementById('pc-hero-sub').value.trim() || PC_FALLBACK_SUB;
    const accent  = document.getElementById('pc-accent').value;
    const density = document.getElementById('pc-density').value;
    const showBadge = document.getElementById('pc-badge').checked;

    document.getElementById('pc-prev-title').textContent = title;
    document.getElementById('pc-prev-sub').textContent   = sub;

    const soft = hexAlpha(accent, .12);
    const mark = document.getElementById('pc-prev-mark');
    mark.style.background = soft; mark.style.color = accent;

    const cmark = document.getElementById('pc-prev-cardmark');
    cmark.style.background = soft; cmark.style.color = accent;

    const tab = document.getElementById('pc-prev-tab');
    tab.style.color = accent; tab.style.borderBottomColor = accent;

    const badge = document.getElementById('pc-prev-badge');
    badge.style.background = soft; badge.style.color = accent;
    badge.style.display = showBadge ? '' : 'none';

    const status = document.getElementById('pc-prev-status');
    status.style.color = accent;
    document.getElementById('pc-prev-dot').style.background = accent;

    document.getElementById('pc-prev-pct').style.color = accent;
    document.getElementById('pc-prev-bar').style.background = accent;

    // Density preview — tweak hero/card padding
    const heroEl = document.getElementById('pc-prev-hero');
    const cardEl = document.getElementById('pc-prev-card');
    const pad = density === 'compact' ? '14px 16px' : density === 'spacious' ? '24px 26px' : '18px 20px';
    heroEl.style.padding = pad;
    cardEl.style.padding = pad;
  }

  async function savePageCfg() {
    const hex = document.getElementById('pc-accent-hex').value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { Toast.warning('Accent color ต้องเป็น hex #rrggbb'); return; }
    const data = {
      hero_title:     document.getElementById('pc-hero-title').value.trim(),
      hero_subtitle:  document.getElementById('pc-hero-sub').value.trim(),
      accent_color:   hex,
      layout_density: document.getElementById('pc-density').value,
      show_tab_badge: document.getElementById('pc-badge').checked,
    };
    const res = await API.courses.updatePageConfig(data);
    if (res?.ok) Toast.success('บันทึก page settings แล้ว');
    else Toast.error(res?.data?.message || 'บันทึกล้มเหลว');
  }
  window.savePageCfg = savePageCfg;

  // ─── INIT ──────────────────────────────
  (async () => { await loadCourses(); })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addChoice", { configurable: true, get: () => addChoice, set: (v) => { addChoice = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addQuestion", { configurable: true, get: () => addQuestion, set: (v) => { addQuestion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addShortAnswer", { configurable: true, get: () => addShortAnswer, set: (v) => { addShortAnswer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "bindPageCfgPreview", { configurable: true, get: () => bindPageCfgPreview, set: (v) => { bindPageCfgPreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeAllModals", { configurable: true, get: () => closeAllModals, set: (v) => { closeAllModals = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteCourse", { configurable: true, get: () => deleteCourse, set: (v) => { deleteCourse = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteLesson", { configurable: true, get: () => deleteLesson, set: (v) => { deleteLesson = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deletePhase", { configurable: true, get: () => deletePhase, set: (v) => { deletePhase = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "ensureQuiz", { configurable: true, get: () => ensureQuiz, set: (v) => { ensureQuiz = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportCsv", { configurable: true, get: () => exportCsv, set: (v) => { exportCsv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fillCourseSelects", { configurable: true, get: () => fillCourseSelects, set: (v) => { fillCourseSelects = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexAlpha", { configurable: true, get: () => hexAlpha, set: (v) => { hexAlpha = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadCourses", { configurable: true, get: () => loadCourses, set: (v) => { loadCourses = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLessonContext", { configurable: true, get: () => loadLessonContext, set: (v) => { loadLessonContext = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLessons", { configurable: true, get: () => loadLessons, set: (v) => { loadLessons = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPageCfg", { configurable: true, get: () => loadPageCfg, set: (v) => { loadPageCfg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPhases", { configurable: true, get: () => loadPhases, set: (v) => { loadPhases = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadProgress", { configurable: true, get: () => loadProgress, set: (v) => { loadProgress = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadQuiz", { configurable: true, get: () => loadQuiz, set: (v) => { loadQuiz = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadQuizContext", { configurable: true, get: () => loadQuizContext, set: (v) => { loadQuizContext = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCourseModal", { configurable: true, get: () => openCourseModal, set: (v) => { openCourseModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openLessonModal", { configurable: true, get: () => openLessonModal, set: (v) => { openLessonModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openPhaseModal", { configurable: true, get: () => openPhaseModal, set: (v) => { openPhaseModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openUserDetail", { configurable: true, get: () => openUserDetail, set: (v) => { openUserDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pcResetAccent", { configurable: true, get: () => pcResetAccent, set: (v) => { pcResetAccent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeChoice", { configurable: true, get: () => removeChoice, set: (v) => { removeChoice = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeQuestion", { configurable: true, get: () => removeQuestion, set: (v) => { removeQuestion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeShortAnswer", { configurable: true, get: () => removeShortAnswer, set: (v) => { removeShortAnswer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCourses", { configurable: true, get: () => renderCourses, set: (v) => { renderCourses = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPageCfgPreview", { configurable: true, get: () => renderPageCfgPreview, set: (v) => { renderPageCfgPreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPrereqPicker", { configurable: true, get: () => renderPrereqPicker, set: (v) => { renderPrereqPicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderQuestion", { configurable: true, get: () => renderQuestion, set: (v) => { renderQuestion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderQuestions", { configurable: true, get: () => renderQuestions, set: (v) => { renderQuestions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetAllProgress", { configurable: true, get: () => resetAllProgress, set: (v) => { resetAllProgress = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetUserProgress", { configurable: true, get: () => resetUserProgress, set: (v) => { resetUserProgress = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rteBlock", { configurable: true, get: () => rteBlock, set: (v) => { rteBlock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rteCallout", { configurable: true, get: () => rteCallout, set: (v) => { rteCallout = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rteCmd", { configurable: true, get: () => rteCmd, set: (v) => { rteCmd = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rteCode", { configurable: true, get: () => rteCode, set: (v) => { rteCode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rteLink", { configurable: true, get: () => rteLink, set: (v) => { rteLink = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rtePaste", { configurable: true, get: () => rtePaste, set: (v) => { rtePaste = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rteTable", { configurable: true, get: () => rteTable, set: (v) => { rteTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveCourse", { configurable: true, get: () => saveCourse, set: (v) => { saveCourse = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveLesson", { configurable: true, get: () => saveLesson, set: (v) => { saveLesson = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "savePageCfg", { configurable: true, get: () => savePageCfg, set: (v) => { savePageCfg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "savePhase", { configurable: true, get: () => savePhase, set: (v) => { savePhase = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveQuiz", { configurable: true, get: () => saveQuiz, set: (v) => { saveQuiz = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "statusPill", { configurable: true, get: () => statusPill, set: (v) => { statusPill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncLessonEditor", { configurable: true, get: () => syncLessonEditor, set: (v) => { syncLessonEditor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateChoice", { configurable: true, get: () => updateChoice, set: (v) => { updateChoice = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateChoiceAnswer", { configurable: true, get: () => updateChoiceAnswer, set: (v) => { updateChoiceAnswer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateQAnswer", { configurable: true, get: () => updateQAnswer, set: (v) => { updateQAnswer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateQExplain", { configurable: true, get: () => updateQExplain, set: (v) => { updateQExplain = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateQText", { configurable: true, get: () => updateQText, set: (v) => { updateQText = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateQType", { configurable: true, get: () => updateQType, set: (v) => { updateQType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateShortAnswer", { configurable: true, get: () => updateShortAnswer, set: (v) => { updateShortAnswer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateShortOpt", { configurable: true, get: () => updateShortOpt, set: (v) => { updateShortOpt = v; } }); } catch (e) {}
})();
