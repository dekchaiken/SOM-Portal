// exam — page script, extracted from exam.html.
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

// Force a clean reload if browser restored the page from bfcache —
// otherwise the exam screen would resume with stale attempt state.
window.addEventListener('pageshow', (ev) => { if (ev.persisted) location.reload(); });

// ═══════════════ State ═══════════════
const examId = new URLSearchParams(location.search).get('id');
if (!examId) { Toast.error('Missing exam id'); setTimeout(() => location.replace('learn.html#exams'), 800); }

// Exam is always opened in a separate popup window from learn.html.
// Close this popup — never navigate the popup to another page, because
// the user wants the original tab back, not a second copy of learn.html.
function closeOrBack() {
  try { window.close(); } catch (_) {}
  // If close was blocked (rare — direct-URL access without an opener),
  // hint the user instead of navigating. Navigating would just leave the
  // popup open showing learn.html, which is exactly what we want to avoid.
  setTimeout(() => {
    if (!window.closed) {
      try { Toast?.warning?.('ปิดหน้าต่างนี้ได้เลยครับ (Cmd/Ctrl+W)'); } catch(_) {}
    }
  }, 300);
}
window.closeOrBack = closeOrBack;
const backBtnLabel = '<i data-icon="x"></i> ปิดหน้านี้';

let examMeta   = null;
let attempt    = null;
let answers    = {};
let curIdx     = 0;
let visited    = new Set([0]);   // track which question indices the user has reached
let flagged    = new Set();
let cfg        = {};
let timerInt   = null;
let hbInt      = null;
let deadline   = null;
let submitted  = false;
// Per-question tab-switch feature: how many times the user has tab-switched
// on each question, and which question indices got locked out (skipped) after
// exceeding the per-question quota. Locked questions can't be navigated back to.
let perQSwitches = new Map();   // qIndex → count
let skipped      = new Set();   // qIndex

// ═══════════════ Accent color ═══════════════
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

// ═══════════════ Init ═══════════════
(async () => {
  const res = await API.exams.get(examId);
  if (!res?.ok) { Toast.error('โหลดข้อสอบไม่สำเร็จ'); setTimeout(()=>location.replace('learn.html#exams'),800); return; }
  examMeta = res.data?.data || {};
  applyAccent(examMeta.cover_color);

  // Course prerequisite gate — must finish required courses first
  if (examMeta.my_course_locked) {
    const titles = (examMeta.unmet_course_prereqs || []).map(u => u.title).join(', ');
    Toast.warning('ต้องเรียนคอร์ส "' + titles + '" ให้จบก่อน');
    setTimeout(() => location.replace('learn.html#exams'), 1200);
    return;
  }

  // Onboarding gate — SM regular members only. Admin roles bypass; other
  // teams have no onboarding programme; the per-exam bypass_onboarding flag
  // also skips this check.
  const bypass       = !!examMeta.flags?.bypass_onboarding;
  const _me          = Auth.getUser?.() || {};
  const _viewAs      = Auth._getViewAsTeam?.() || null;
  const _isAdminRole = ['super_admin','sm_admin','dev_sm'].includes(_me.role);
  const _scopeTeam   = _me.role === 'super_admin' ? (_viewAs?.slug || null) : (_me.team || null);
  const gateOn       = !bypass && !_isAdminRole && _scopeTeam === 'sm';
  if (gateOn) {
    const ob = await API.onboarding.myProgress();
    if (ob?.ok && !ob.data?.data?.finished_at) {
      Toast.warning('ต้องผ่าน onboarding ก่อนทำข้อสอบจริง');
      setTimeout(() => location.replace('onboarding.html'), 800);
      return;
    }
  }

  renderStart();
})();

// ═══════════════ Start screen ═══════════════
function renderStart() {
  const e = examMeta;
  const c = e.config || {};
  const tl = c.time_limit || {};
  const att = c.attempts || {};
  const win = c.exam_window || {};
  const myA = e.my_attempts || 0;
  const maxA = e.max_attempts || 0;
  const remain = maxA > 0 ? Math.max(0, maxA - myA) : null;
  const isTest = !!e.flags?.bypass_onboarding;

  // Rules listing
  const rules = [];
  if (c.one_at_a_time?.enabled) {
    rules.push(c.one_at_a_time.allow_back
      ? 'ทำ <b>ทีละข้อ</b> — ย้อนกลับได้'
      : 'ทำ <b>ทีละข้อ</b> — ย้อนกลับ<b>ไม่ได้</b>');
  }
  if (c.tab_detection?.enabled) {
    const lim = c.tab_detection.max_violations || 0;
    const perQ = c.tab_detection.per_question_max || 0;
    const actionMap = { log:'บันทึก', warn:'แสดงคำเตือน', penalty:`หักคะแนน ${c.tab_detection.penalty_pct||10}%`, force_submit:'บังคับส่งทันที' };
    rules.push(`ระบบตรวจการสลับแท็บ/ออกจากหน้า${lim ? ` (เกินรวม <b>${lim}</b> ครั้งจะ${actionMap[c.tab_detection.action]||'บันทึก'})` : ''}`);
    if (perQ > 0 && c.one_at_a_time?.enabled) {
      rules.push(`สลับแท็บใน<b>ข้อเดียว</b>เกิน <b>${perQ}</b> ครั้ง → <b>ข้อนั้นจะถูกล็อก</b> ทำต่อไม่ได้และกลับมาแก้ไม่ได้`);
    }
  }
  if (c.fullscreen_lock?.enabled) rules.push('ต้องทำในโหมด <b>fullscreen</b> ตลอด — ออกแล้วระบบจะดึงกลับ');
  if (c.disable_copy_paste?.enabled) rules.push('ปิดการ <b>copy / paste / right-click</b>');
  if (c.watermark?.enabled) rules.push('แสดง <b>ลายน้ำชื่อผู้สอบ</b>บนหน้าจอ — ภาพถ่ายแชร์จะติดชื่อ');
  if (c.lazy_fetch?.enabled) rules.push('โหลดคำถามทีละข้อ — ไม่สามารถดูคำถามอื่นล่วงหน้า');
  if (c.shuffle_questions?.enabled || c.shuffle_choices?.enabled) {
    const what = [];
    if (c.shuffle_questions?.enabled) what.push('ลำดับคำถาม');
    if (c.shuffle_choices?.enabled) what.push('ลำดับตัวเลือก');
    rules.push(`สลับ${what.join(' + ')} — แต่ละคนไม่เหมือนกัน`);
  }
  const showResMode = (c.show_results?.mode || 'after_submit');
  if (showResMode === 'after_window') rules.push('ผลคะแนนจะแจ้งหลังหมดเวลาสอบ');
  if (showResMode === 'never')        rules.push('ระบบจะแจ้งเฉพาะว่าส่งแล้ว — ไม่โชว์คะแนน');

  const rulesHtml = rules.length ? `
    <div class="ex-callout rules">
      <div class="ic"><i data-icon="alert-triangle"></i></div>
      <div class="body">
        <h4>กติกาการสอบ</h4>
        <ul>${rules.map(r => `<li>${r}</li>`).join('')}</ul>
      </div>
    </div>` : '';

  // Window banner
  let windowMsg = '';
  let windowOk = true;
  if (win.enabled) {
    const now = Date.now();
    const s  = win.start ? new Date(win.start).getTime() : 0;
    const en = win.end   ? new Date(win.end).getTime()   : 0;
    if (s && now < s) {
      windowMsg = `<div class="ex-callout info"><div class="ic"><i data-icon="clock"></i></div><div class="body"><b>จะเปิดสอบ</b> — ${fmtDate(win.start)}</div></div>`;
      windowOk = false;
    } else if (en && now > en) {
      windowMsg = `<div class="ex-callout closed"><div class="ic"><i data-icon="clock"></i></div><div class="body"><b>ปิดสอบแล้ว</b> — สิ้นสุด ${fmtDate(win.end)}</div></div>`;
      windowOk = false;
    } else {
      windowMsg = `<div class="ex-callout open"><div class="ic"><i data-icon="circle"></i></div><div class="body"><b>เปิดสอบอยู่</b> — ปิด ${fmtDate(win.end)}</div></div>`;
    }
  }

  const canStart = windowOk && !(maxA > 0 && remain === 0 && !e.my_passed);
  const ctaLabel = e.my_passed
    ? '<i data-icon="refresh-cw"></i> ทำใหม่อีกครั้ง'
    : (myA > 0 ? '<i data-icon="refresh-cw"></i> ทำใหม่' : '<i data-icon="play"></i> เริ่มทำข้อสอบ');

  // ─── Policy / Consent card ────────────────────────
  const policy = c.policy || {};
  const policyEnabled = !!policy.enabled;
  const requireConsent = policyEnabled && policy.require_consent !== false;
  const policyHtml = policyEnabled ? `
    <div class="ex-policy">
      <div class="ex-policy-head">
        <div class="ex-policy-icon"><i data-icon="shield"></i></div>
        <h4>${escHtml(policy.title || 'ข้อตกลงและคำยินยอม')}${requireConsent ? '<span class="ex-policy-required">ต้องยอมรับ</span>' : ''}</h4>
      </div>
      <div class="ex-policy-content">${policy.content || ''}</div>
      ${requireConsent ? `
        <label class="ex-policy-consent">
          <input type="checkbox" id="consent-check">
          <span>${escHtml(policy.consent_label || 'ฉันรับทราบและยินยอมตามเงื่อนไขข้างต้น')}</span>
        </label>
      ` : ''}
    </div>` : '';

  // Tier chips
  const tier = [];
  if (isTest) tier.push('<span class="ex-tier-chip test"><i data-icon="test-tube"></i> TEST EXAM</span>');
  if (c.one_at_a_time?.enabled || c.tab_detection?.enabled || c.watermark?.enabled || c.lazy_fetch?.enabled) {
    tier.push('<span class="ex-tier-chip"><i data-icon="shield"></i> Anti-cheat</span>');
  }
  if (c.fullscreen_lock?.enabled || c.disable_copy_paste?.enabled || c.anomaly_detection?.enabled) {
    tier.push('<span class="ex-tier-chip"><i data-icon="lock"></i> Strict</span>');
  }
  if (tl.enabled) {
    tier.push(`<span class="ex-tier-chip"><i data-icon="clock"></i> ${tl.total_minutes || 0} นาที</span>`);
  }

  document.getElementById('screen-start').innerHTML = `
    <div class="ex-hero">
      <div class="ex-hero-top">
        <div class="ex-hero-mark">${renderIcon(e.icon, '<i data-icon="edit"></i>')}</div>
        <div style="flex:1; min-width:0">
          <div class="ex-hero-eyebrow"><i data-icon="edit"></i> Exam</div>
          <h1>${escHtml(e.title)}</h1>
          <p>${escHtml(e.subtitle || e.description || '')}</p>
        </div>
      </div>

      ${tier.length ? `<div class="ex-tier-row">${tier.join('')}</div>` : ''}

      <div class="ex-stats">
        <div class="ex-stat-tile"><div class="l">จำนวนข้อ</div><div class="v accent">${(e.pool_enabled && e.pool_total_show > 0 && e.pool_total_show < (e.questions_count || 0)) ? `${e.pool_total_show}<span style="font-size:.5em;opacity:.6"> / ${e.questions_count}</span>` : (e.questions_count || 0)}</div></div>
        <div class="ex-stat-tile"><div class="l">เกณฑ์ผ่าน</div><div class="v">${e.pass_score > 0 ? `${e.pass_score}%` : '—'}</div></div>
        ${tl.enabled
          ? `<div class="ex-stat-tile"><div class="l">เวลา</div><div class="v">${tl.total_minutes || '–'} นาที</div></div>`
          : `<div class="ex-stat-tile"><div class="l">เวลา</div><div class="v">ไม่จำกัด</div></div>`}
        ${maxA > 0
          ? `<div class="ex-stat-tile"><div class="l">โควต้า</div><div class="v">${remain} / ${maxA}</div></div>`
          : `<div class="ex-stat-tile"><div class="l">โควต้า</div><div class="v">∞</div></div>`}
        ${myA > 0
          ? `<div class="ex-stat-tile"><div class="l">ดีสุด</div><div class="v green">${e.my_best_score || 0}%</div></div>`
          : ''}
      </div>
    </div>

    ${windowMsg}
    ${rulesHtml}
    ${policyHtml}

    <div class="ex-actions">
      <button class="ex-btn primary" id="btn-start" ${canStart ? '' : 'disabled'} ${requireConsent ? 'data-needs-consent="1"' : ''}>
        ${ctaLabel}
      </button>
      <button class="ex-btn ghost" onclick="closeOrBack()"><i data-icon="x"></i> ปิด</button>
    </div>
  `;

  const startBtn = document.getElementById('btn-start');
  startBtn?.addEventListener('click', startAttempt);

  // Consent gate — disable start until checkbox is ticked
  if (requireConsent && canStart) {
    startBtn.disabled = true;
    startBtn.title = 'กรุณายอมรับเงื่อนไขก่อนเริ่มสอบ';
    document.getElementById('consent-check')?.addEventListener('change', (ev) => {
      startBtn.disabled = !ev.target.checked;
      startBtn.title = ev.target.checked ? '' : 'กรุณายอมรับเงื่อนไขก่อนเริ่มสอบ';
    });
  }
}

// ═══════════════ Start attempt ═══════════════
async function startAttempt() {
  document.getElementById('btn-start').disabled = true;
  const res = await API.exams.start(examId);
  if (!res?.ok) {
    Toast.error(res?.data?.message || 'เริ่มสอบไม่ได้');
    document.getElementById('btn-start').disabled = false;
    return;
  }
  attempt = res.data?.data || {};
  cfg = attempt.config || {};
  answers = Object.assign({}, attempt.answers || {});

  document.getElementById('screen-start').style.display = 'none';
  document.getElementById('screen-exam').style.display = '';

  setupWatermark();
  setupTabDetection();
  setupFullscreen();
  setupCopyPasteBlock();
  setupOneAtATime();
  setupTimer();
  setupHeartbeat();
  window.addEventListener('beforeunload', warnUnload);

  document.getElementById('exam-title').textContent = attempt.exam_title || examMeta.title;
  curIdx = 0;
  renderQuestions();
  renderNav();
  goTo(0);
}

// ═══════════════ Render questions ═══════════════
// Resolve an asset URL that was stored relative to the app root (e.g.
// "uploads/courses/7eleven/page-02.png"). Prepending the detected app base
// avoids the sub-directory bug: on /admin/exams.html, a plain relative URL
// resolves to /admin/uploads/... — wrong. Absolute URLs and full http(s)
// URLs pass through unchanged.
function resolveAssetUrl(path) {
  if (!path) return '';
  if (/^(https?:)?\/\//i.test(path)) return path;   // full URL
  if (path.startsWith('/'))          return path;   // already absolute
  // App root = API_BASE without the trailing "/api". Works with any folder name.
  const base = API_BASE.replace(/\/api$/, '');
  return base + '/' + path.replace(/^\.?\/*/, '');
}

function renderQuestions() {
  const body = document.getElementById('exam-body');
  const qs = attempt.questions || [];
  body.innerHTML = qs.map((q, i) => qHtml(q, i)).join('');
}

function qHtml(q, i) {
  const typeLabel = ({
    single: 'เลือก 1 ข้อ',
    multi: 'เลือกได้หลายข้อ',
    truefalse: 'True / False',
    short: 'พิมพ์คำตอบ',
  })[q.type] || q.type;
  const cat = q.category ? `<span class="qcategory-pill">${escHtml(q.category)}</span>` : '';

  let body = '';
  if (q.type === 'single') {
    body = `<div class="choices">${(q.choices || []).map((ch, j) => `
      <label class="choice" data-choice="${j}">
        <input type="radio" name="q_${q.id}" value="${j}" ${answers[q.id] === j ? 'checked' : ''}>
        <span class="choice-text">${escHtml(ch)}</span>
      </label>`).join('')}</div>`;
  } else if (q.type === 'multi') {
    const sel = new Set(Array.isArray(answers[q.id]) ? answers[q.id] : []);
    body = `<div class="choices">${(q.choices || []).map((ch, j) => `
      <label class="choice" data-choice="${j}">
        <input type="checkbox" name="q_${q.id}" value="${j}" ${sel.has(j) ? 'checked' : ''}>
        <span class="choice-text">${escHtml(ch)}</span>
      </label>`).join('')}</div>`;
  } else if (q.type === 'truefalse') {
    body = `<div class="choices">
      <label class="choice"><input type="radio" name="q_${q.id}" value="true" ${answers[q.id] === true ? 'checked':''}><span class="choice-text"><i data-icon="check" style="color:#10b981"></i> True (ถูก)</span></label>
      <label class="choice"><input type="radio" name="q_${q.id}" value="false" ${answers[q.id] === false ? 'checked':''}><span class="choice-text"><i data-icon="x" style="color:#ef4444"></i> False (ผิด)</span></label>
    </div>`;
  } else if (q.type === 'short') {
    body = `<textarea class="short-input" id="short_${q.id}" placeholder="พิมพ์คำตอบของคุณที่นี่…">${escHtml(answers[q.id] || '')}</textarea>`;
  }

  const imageUrl = resolveAssetUrl(q.image);
  const imageHtml = q.image ? `
    <div class="qimage-wrap">
      <img class="qimage" src="${escHtml(imageUrl)}" alt="Question diagram"
           onclick="openImageZoom('${escHtml(imageUrl)}')"
           oncontextmenu="return false"
           draggable="false">
      <div class="qimage-hint"><i data-icon="maximize"></i> คลิกเพื่อขยายรูป</div>
    </div>` : '';

  return `
    <div class="qcard" data-idx="${i}" data-qid="${q.id}">
      <div class="qhead">
        <span class="qnum">ข้อ ${i + 1}</span>
        <span class="qtype-pill">${typeLabel}</span>
        ${cat}
        <button class="qflag-btn" data-flag="${q.id}"><i data-icon="flag"></i> Flag</button>
      </div>
      <div class="qprompt">${escHtml(q.prompt || '')}</div>
      ${imageHtml}
      ${body}
    </div>`;
}

// ═══════════════ Question image zoom ═══════════════
// Simple fullscreen viewer — reuses the same watermark overlay above it, so
// screenshots of the enlarged diagram still carry the user's name/email.
function openImageZoom(url) {
  let modal = document.getElementById('qimage-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qimage-modal';
    modal.className = 'qimage-modal';
    modal.innerHTML = `
      <button class="qimage-modal-close" title="ปิด (Esc)">×</button>
      <img alt="Zoom" oncontextmenu="return false" draggable="false">
    `;
    modal.addEventListener('click', (e) => {
      // Any click on backdrop OR the close button closes; clicks on the img
      // itself close too (matches cursor:zoom-out on the whole overlay).
      closeImageZoom();
    });
    document.body.appendChild(modal);
  }
  modal.querySelector('img').src = url;
  modal.classList.add('show');
}
function closeImageZoom() {
  document.getElementById('qimage-modal')?.classList.remove('show');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImageZoom();
});

// ═══════════════ Answer capture ═══════════════
document.addEventListener('change', (e) => {
  if (!attempt) return;
  const t = e.target;
  if (!t.name?.startsWith('q_')) return;
  const qid = t.name.slice(2);
  const q = (attempt.questions || []).find(x => x.id === qid);
  if (!q) return;
  const prev = answers[qid];
  if (q.type === 'single') answers[qid] = Number(t.value);
  else if (q.type === 'truefalse') answers[qid] = t.value === 'true';
  else if (q.type === 'multi') {
    const arr = [...document.querySelectorAll(`input[name="q_${qid}"]:checked`)].map(x => Number(x.value));
    answers[qid] = arr.sort((a,b)=>a-b);
  }
  syncSelectedClass(qid);
  renderNav();
  // Audit — log answer change (best-effort, fire-and-forget)
  sendEvent('answer_change', {
    q_id: qid,
    q_index: (attempt.questions || []).findIndex(x => x.id === qid) + 1,
    changed: true,
    was_blank: prev === undefined || prev === null,
  });
});
// Short answer — debounce so we don't flood server with one event per keystroke
let _shortDebounce = {};
document.addEventListener('input', (e) => {
  if (!attempt) return;
  if (e.target.id?.startsWith('short_')) {
    const qid = e.target.id.slice(6);
    const prev = answers[qid];
    answers[qid] = e.target.value;
    renderNav();
    clearTimeout(_shortDebounce[qid]);
    _shortDebounce[qid] = setTimeout(() => {
      sendEvent('answer_change', {
        q_id: qid,
        q_index: (attempt.questions || []).findIndex(x => x.id === qid) + 1,
        was_blank: !prev,
        length: e.target.value.length,
      });
    }, 1500);
  }
});
document.addEventListener('click', (e) => {
  const fl = e.target.closest('[data-flag]');
  if (fl) {
    const qid = fl.dataset.flag;
    const wasFlagged = flagged.has(qid);
    if (wasFlagged) flagged.delete(qid); else flagged.add(qid);
    document.querySelector(`.qcard[data-qid="${qid}"]`)?.classList.toggle('flagged', flagged.has(qid));
    renderNav();
    sendEvent(wasFlagged ? 'unflag' : 'flag', {
      q_id: qid,
      q_index: (attempt.questions || []).findIndex(x => x.id === qid) + 1,
    });
  }
});
function syncSelectedClass(qid) {
  document.querySelectorAll(`.qcard[data-qid="${qid}"] .choice`).forEach(c => {
    const inp = c.querySelector('input');
    c.classList.toggle('selected', inp && inp.checked);
  });
}

// ═══════════════ One-at-a-time nav ═══════════════
function setupOneAtATime() {
  if (cfg.one_at_a_time?.enabled) {
    document.body.classList.add('lazy');
    if (!cfg.one_at_a_time.allow_back) {
      document.getElementById('btn-prev').style.display = 'none';
    }
  } else {
    document.getElementById('btn-prev').style.display = 'none';
    document.getElementById('btn-next').style.display = 'none';
  }
}

function goTo(idx) {
  const qs = attempt.questions || [];
  if (idx < 0 || idx >= qs.length) return;
  // Locked (skipped) questions are non-navigable — the skipping function
  // itself passes an unblocked idx, so this only blocks manual attempts.
  if (skipped.has(idx) && idx !== curIdx) {
    Toast.warning('ข้อนี้ถูกล็อกไปแล้ว — กลับมาทำไม่ได้');
    return;
  }
  curIdx = idx;
  visited.add(idx);
  document.querySelectorAll('.qcard').forEach((el, i) => el.classList.toggle('current', i === idx));
  if (cfg.one_at_a_time?.enabled) {
    document.querySelector(`.qcard[data-idx="${idx}"]`)?.scrollIntoView({ behavior:'smooth', block:'start' });
  }
  document.getElementById('progress').innerHTML = `<b>${idx + 1}</b> / ${qs.length}`;
  document.getElementById('btn-prev').disabled = idx === 0;
  document.getElementById('btn-next').disabled = idx === qs.length - 1;
  // Show adjacent question numbers on the nav cards
  const prevLabel = document.getElementById('btn-prev-label');
  const nextLabel = document.getElementById('btn-next-label');
  if (prevLabel) prevLabel.textContent = idx === 0 ? '—' : `ข้อ ${idx}`;
  if (nextLabel) nextLabel.textContent = idx === qs.length - 1 ? '—' : `ข้อ ${idx + 2}`;
  renderNav();
}
document.getElementById('btn-prev').addEventListener('click', () => goTo(curIdx - 1));
document.getElementById('btn-next').addEventListener('click', () => goTo(curIdx + 1));

function renderNav() {
  const qs = attempt.questions || [];
  const oneAtATime = !!cfg.one_at_a_time?.enabled;
  const allowBack  = cfg.one_at_a_time?.allow_back !== false;

  const map = qs.map((q, i) => {
    // Skipped (locked due to tab-switch overflow) always wins visually — it's
    // an irreversible state, more informative than "not visited yet".
    if (skipped.has(i)) {
      return `<span class="nav-dot skipped" title="ถูกล็อก — สลับแท็บเกินโควตาต่อข้อ" data-idx="${i}"><i data-icon="ban"></i></span>`;
    }
    // In one-at-a-time mode: never reveal questions the user hasn't reached yet.
    if (oneAtATime && !visited.has(i)) {
      return `<span class="nav-dot locked" title="ยังไม่ถึงข้อนี้">·</span>`;
    }
    const cls = ['nav-dot'];
    if (i === curIdx) cls.push('current');
    if (isAnswered(q.id)) cls.push('answered');
    if (flagged.has(q.id)) cls.push('flagged');
    // When back is disabled, past dots become non-clickable
    if (oneAtATime && !allowBack && i < curIdx) cls.push('locked');
    return `<span class="${cls.join(' ')}" data-idx="${i}">${i + 1}</span>`;
  }).join('');
  document.getElementById('nav-map').innerHTML = map;
}
function isAnswered(qid) {
  const v = answers[qid];
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}
document.getElementById('nav-map').addEventListener('click', (e) => {
  const d = e.target.closest('[data-idx]');
  if (!d) return;
  const idx = Number(d.dataset.idx);
  if (skipped.has(idx)) {
    Toast.warning('ข้อนี้ถูกล็อกแล้ว — สลับแท็บเกินโควตา ทำต่อไม่ได้');
    return;
  }
  const oneAtATime = !!cfg.one_at_a_time?.enabled;
  // Can't jump to a question you haven't reached yet
  if (oneAtATime && !visited.has(idx)) {
    Toast.warning('ต้องไปทีละข้อ — กดถัดไปก่อน');
    return;
  }
  if (oneAtATime && cfg.one_at_a_time.allow_back === false && idx < curIdx) {
    Toast.warning('ข้อสอบไม่อนุญาตให้ย้อนกลับ');
    return;
  }
  goTo(idx);
});

// ═══════════════ Timer ═══════════════
function setupTimer() {
  if (!cfg.time_limit?.enabled) return;
  if (!['total','both'].includes(cfg.time_limit.mode)) return;
  const remaining = Number(attempt.remaining_sec || 0);
  if (remaining <= 0) return;
  deadline = Date.now() + remaining * 1000;
  document.getElementById('timer').style.display = '';
  const tick = () => {
    const sec = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const mm = Math.floor(sec / 60).toString().padStart(2, '0');
    const ss = (sec % 60).toString().padStart(2, '0');
    const t = document.getElementById('timer');
    t.textContent = `${mm}:${ss}`;
    t.classList.toggle('warn',   sec <= 300 && sec > 60);
    t.classList.toggle('danger', sec <= 60);
    if (sec === 0) {
      clearInterval(timerInt);
      Toast.warning('หมดเวลา — กำลังส่งข้อสอบ…');
      submit(true);
    }
  };
  tick();
  timerInt = setInterval(tick, 1000);
}

function setupHeartbeat() {
  hbInt = setInterval(async () => {
    if (submitted) return;
    const r = await API.exams.heartbeat(attempt.id);
    if (r?.ok && r.data?.data?.expired) submit(true);
  }, 30 * 1000);
}

// ═══════════════ Watermark ═══════════════
function setupWatermark() {
  if (!cfg.watermark?.enabled) return;
  const u = Auth.getUser() || {};
  const text = (cfg.watermark.text || '{username} • {email}')
    .replaceAll('{username}', u.name || u.username || '')
    .replaceAll('{email}',    u.email || '')
    .replaceAll('{id}',       u.id || '');
  const opacity = Math.min(1, Math.max(0, Number(cfg.watermark.opacity || 0.15)));

  const wm = document.createElement('div');
  wm.className = 'watermark';
  wm.style.opacity = opacity;
  wm.innerHTML = Array.from({ length: 18 }).map(() => `<span>${escHtml(text)}</span>`).join('');
  document.body.appendChild(wm);
}

// ═══════════════ Tab detection ═══════════════
// Two bugs the previous version had:
//   1. It called sendEvent(type) AND API.exams.event() for the same event —
//      the server incremented the counter twice per user action.
//   2. Desktop browsers fire BOTH `visibilitychange`(hidden) and `blur` when
//      the user switches to another window/tab — so one physical switch
//      already produced two handle() calls, on top of the double POST.
//      Result: one switch counted as 3–4 violations.
// Fix: single API call per handle(), plus a short debounce shared across
// both listeners so paired visibility+blur events collapse into one count.
function setupTabDetection() {
  if (!cfg.tab_detection?.enabled) return;

  let lastEventAt = 0;
  const DEBOUNCE_MS = 800;

  const handle = (type) => async () => {
    if (submitted) return;
    const now = Date.now();
    if (now - lastEventAt < DEBOUNCE_MS) return;   // paired listener fires within ~50ms — collapse
    lastEventAt = now;

    // ── Per-question quota — evaluated BEFORE the total counter so a locked
    //    question's tab-switch still counts toward the exam-wide total for
    //    audit purposes, but the skip action fires as soon as this question
    //    exceeds its own limit. Only makes sense in one-at-a-time mode.
    const perQMax = Number(cfg.tab_detection.per_question_max || 0);
    const oneAtATime = !!cfg.one_at_a_time?.enabled;
    if (perQMax > 0 && oneAtATime && !skipped.has(curIdx)) {
      const c = (perQSwitches.get(curIdx) || 0) + 1;
      perQSwitches.set(curIdx, c);
      if (c > perQMax) {
        skipQuestion(curIdx, 'tab_switch_limit');
        // Fall through — we still POST the total-count event below so the
        // exam-wide violation counter stays accurate.
      }
    }

    const r = await API.exams.event({ attempt_id: attempt.id, type });
    if (!r?.ok) return;

    const total = (r.data?.data?.violations?.tab_switch || 0) + (r.data?.data?.violations?.blur || 0);
    document.getElementById('violations').classList.add('show');
    document.getElementById('violations').textContent = `⚠️ ${total} violation${total>1?'s':''}`;

    const action = cfg.tab_detection.action || 'log';
    const max = Number(cfg.tab_detection.max_violations || 0);
    if (action === 'warn') showWarn(`⚠️ ห้ามสลับหน้า/แท็บ — ${total} ครั้ง`);
    if (action === 'force_submit' && max > 0 && total > max) {
      Toast.warning('สลับแท็บเกินกำหนด — บังคับส่งข้อสอบ');
      submit(true);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') handle('tab_switch')();
  });
  window.addEventListener('blur', handle('blur'));
}

async function sendEvent(type, meta) {
  try { await API.exams.event({ attempt_id: attempt.id, type, meta: meta || {} }); }
  catch (e) {}
}

function showWarn(msg) {
  const old = document.querySelector('.ts-warn'); if (old) old.remove();
  const div = document.createElement('div');
  div.className = 'ts-warn'; div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// Lock a question — mark it skipped, clear any partial answer, advance to
// next unblocked question. `reason` goes into the audit log so admin can
// distinguish tab-switch-triggered skips from any future manual skips.
function skipQuestion(idx, reason) {
  const qs = attempt.questions || [];
  if (idx < 0 || idx >= qs.length || skipped.has(idx)) return;
  const q = qs[idx];
  skipped.add(idx);
  // Wipe partial answer so it grades as unanswered (0 pts)
  if (q && answers[q.id] !== undefined) delete answers[q.id];

  sendEvent('question_skipped', {
    q_index: idx + 1,
    q_id: q?.id || '',
    reason: reason || 'unknown',
    tab_switches_on_q: perQSwitches.get(idx) || 0,
  });
  Toast.warning(`ข้อ ${idx + 1} ถูกล็อก — สลับแท็บเกินกำหนด (ไม่สามารถกลับมาทำได้)`);

  // Visually mark and disable inputs of the skipped question
  const card = document.querySelector(`.qcard[data-idx="${idx}"]`);
  if (card) {
    card.classList.add('skipped');
    card.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });
  }

  // Advance to the next non-skipped question; if none, we stay put and let
  // the user submit whatever remains.
  let nextIdx = idx + 1;
  while (nextIdx < qs.length && skipped.has(nextIdx)) nextIdx++;
  if (nextIdx < qs.length) goTo(nextIdx);
  else                     renderNav();  // just re-paint locks
}

// ═══════════════ Fullscreen ═══════════════
function setupFullscreen() {
  if (!cfg.fullscreen_lock?.enabled) return;
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(()=>{});
  document.addEventListener('fullscreenchange', async () => {
    if (submitted) return;
    if (!document.fullscreenElement) {
      await sendEvent('fullscreen_exit');
      const action = cfg.fullscreen_lock.action || 'log';
      if (action === 'warn') showWarn('⚠️ ออกจาก fullscreen — กลับเข้าทันที');
      setTimeout(() => { if (!document.fullscreenElement && !submitted) document.documentElement.requestFullscreen?.().catch(()=>{}); }, 500);
    }
  });
}

// ═══════════════ Copy/paste block ═══════════════
function setupCopyPasteBlock() {
  if (!cfg.disable_copy_paste?.enabled) return;
  document.body.classList.add('no-select');
  ['copy','paste','cut','contextmenu'].forEach(ev => {
    document.addEventListener(ev, (e) => {
      if (submitted) return;
      // Allow paste in short-answer to keep ux usable
      if (ev === 'paste' && e.target?.classList?.contains('short-input')) return;
      e.preventDefault();
      sendEvent(ev === 'contextmenu' ? 'copy' : ev);
    });
  });
}

// ═══════════════ Submit ═══════════════
function warnUnload(e) {
  if (submitted) return;
  e.preventDefault();
  e.returnValue = '';
}

document.getElementById('btn-submit').addEventListener('click', () => {
  const qs = attempt.questions || [];
  const unanswered = qs.filter(q => !isAnswered(q.id)).length;
  const msg = unanswered
    ? `ยังไม่ได้ตอบอีก ${unanswered} ข้อ — ส่งเลยมั้ย?`
    : `ส่งคำตอบทั้งหมด ${qs.length} ข้อ?`;
  confirmDialog(msg, 'ยืนยันส่งข้อสอบ', { confirmText: 'ส่งคำตอบ', cancelText: 'ยกเลิก', variant: 'primary' })
    .then(ok => { if (ok) submit(false); });
});

async function submit(auto) {
  if (submitted) return;
  submitted = true;
  clearInterval(timerInt); clearInterval(hbInt);
  window.removeEventListener('beforeunload', warnUnload);
  const res = await API.exams.submit({ attempt_id: attempt.id, answers, auto });
  if (!res?.ok) {
    Toast.error(res?.data?.message || 'ส่งคำตอบไม่สำเร็จ');
    submitted = false;
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(()=>{});
  showResult(res.data?.data || {}, auto);
}

// ═══════════════ Result screen ═══════════════
function showResult(r, auto) {
  document.getElementById('screen-exam').style.display = 'none';
  document.getElementById('screen-result').style.display = '';
  document.querySelector('.watermark')?.remove();
  document.body.classList.remove('lazy','no-select');

  const wrap = document.getElementById('screen-result');

  // Result hidden (admin disabled showing score)
  if (r.hidden) {
    wrap.innerHTML = `
      <div class="ex-result-wrap">
        <div class="ex-result">
          <div class="ex-result-banner" style="--banner-soft:rgba(59,130,246,.10)">
            <div style="font-size:54px; margin-bottom:14px">📤</div>
            <div class="ex-result-status" style="color:#3b82f6">ส่งข้อสอบเรียบร้อย</div>
            <div class="ex-result-detail">ผลคะแนนจะแจ้งให้ทราบภายหลัง — ขอบคุณที่ทำข้อสอบจนเสร็จ</div>
          </div>
          <div class="ex-result-actions">
            <button class="ex-btn ghost" onclick="closeOrBack()">${backBtnLabel}</button>
          </div>
        </div>
      </div>`;
    return;
  }

  const passed = !!r.passed;
  const ringColor = passed ? '#10b981' : 'var(--accent)';
  const bannerSoft = passed ? 'rgba(16,185,129,.10)' : 'var(--accent-soft)';

  const summaryHtml = (r.summary || []).map((s, i) => `
    <div class="lp-summary-row ${s.correct ? 'correct' : 'wrong'}">
      <div class="check"><i data-icon="${s.correct ? 'check' : 'x'}"></i></div>
      <div class="label"><span class="qnum" style="background:none; color:inherit; min-width:auto; padding:0">ข้อ ${i+1}</span></div>
      <div class="verdict">${s.correct ? 'ถูก' : 'ผิด'}</div>
    </div>`).join('');

  const penaltyTile = r.penalty > 0
    ? `<div class="ex-stat-cell"><div class="n fail">-${r.penalty}%</div><div class="l">หักคะแนน</div></div>`
    : '';
  const rawTile = (r.raw_score !== undefined && r.penalty > 0)
    ? `<div class="ex-stat-cell"><div class="n">${r.raw_score}%</div><div class="l">คะแนนดิบ</div></div>`
    : '';

  wrap.innerHTML = `
    <div class="ex-result-wrap">
      <div class="ex-result">
        <div class="ex-result-banner ${passed ? 'passed' : 'failed'}" style="--banner-soft:${bannerSoft}">
          <div class="ex-ring" style="--ring-pct:${r.score}; --ring-color:${ringColor}">
            <span>${r.score}<span class="pct">%</span></span>
          </div>
          <div class="ex-result-status ${r.pass_score > 0 ? (passed ? 'passed' : 'failed') : 'passed'}">
            ${r.pass_score > 0
              ? (passed ? '<i data-icon="trophy"></i> ยินดีด้วย! ผ่านแล้ว' : '<i data-icon="alert-circle"></i> ยังไม่ผ่านเกณฑ์')
              : '<i data-icon="check-circle"></i> ทำข้อสอบเสร็จเรียบร้อย'}
          </div>
          <div class="ex-result-detail">
            ${r.pass_score > 0
              ? (passed
                  ? `ตอบถูก ${r.correct_count || 0} จาก ${r.total_count || 0} ข้อ · เกณฑ์ผ่าน ${r.pass_score}%${auto ? ' · ส่งอัตโนมัติ' : ''}`
                  : `เกณฑ์ผ่าน ${r.pass_score}% · ขาดอีก ${Math.max(0, r.pass_score - r.score)}% เท่านั้นเอง${auto ? ' · ส่งอัตโนมัติ' : ''}`)
              : `ตอบถูก ${r.correct_count || 0} จาก ${r.total_count || 0} ข้อ${auto ? ' · ส่งอัตโนมัติ' : ''}`}
          </div>
        </div>

        <div class="ex-result-stats">
          <div class="ex-stat-cell"><div class="n">${r.score}%</div><div class="l">คะแนนรอบนี้</div></div>
          ${r.correct_count !== undefined
            ? `<div class="ex-stat-cell"><div class="n">${r.correct_count}/${r.total_count}</div><div class="l">ตอบถูก</div></div>`
            : ''}
          ${penaltyTile}
          ${rawTile}
        </div>

        ${(r.summary || []).length ? `
          <div class="ex-result-body">
            <div class="ex-section-label">รายข้อ</div>
            ${summaryHtml}
          </div>
        ` : ''}

        <div class="ex-result-actions">
          <button class="ex-btn ghost" onclick="closeOrBack()">${backBtnLabel}</button>
        </div>
      </div>
    </div>`;

  window.scrollTo({ top:0, behavior:'smooth' });
}

// ═══════════════ Helpers ═══════════════
function fmtDate(s) {
  try { return new Date(s).toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'short' }); }
  catch { return s; }
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyAccent", { configurable: true, get: () => applyAccent, set: (v) => { applyAccent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeImageZoom", { configurable: true, get: () => closeImageZoom, set: (v) => { closeImageZoom = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeOrBack", { configurable: true, get: () => closeOrBack, set: (v) => { closeOrBack = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "goTo", { configurable: true, get: () => goTo, set: (v) => { goTo = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexAlpha", { configurable: true, get: () => hexAlpha, set: (v) => { hexAlpha = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isAnswered", { configurable: true, get: () => isAnswered, set: (v) => { isAnswered = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openImageZoom", { configurable: true, get: () => openImageZoom, set: (v) => { openImageZoom = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "qHtml", { configurable: true, get: () => qHtml, set: (v) => { qHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderNav", { configurable: true, get: () => renderNav, set: (v) => { renderNav = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderQuestions", { configurable: true, get: () => renderQuestions, set: (v) => { renderQuestions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStart", { configurable: true, get: () => renderStart, set: (v) => { renderStart = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resolveAssetUrl", { configurable: true, get: () => resolveAssetUrl, set: (v) => { resolveAssetUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendEvent", { configurable: true, get: () => sendEvent, set: (v) => { sendEvent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupCopyPasteBlock", { configurable: true, get: () => setupCopyPasteBlock, set: (v) => { setupCopyPasteBlock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupFullscreen", { configurable: true, get: () => setupFullscreen, set: (v) => { setupFullscreen = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupHeartbeat", { configurable: true, get: () => setupHeartbeat, set: (v) => { setupHeartbeat = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupOneAtATime", { configurable: true, get: () => setupOneAtATime, set: (v) => { setupOneAtATime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupTabDetection", { configurable: true, get: () => setupTabDetection, set: (v) => { setupTabDetection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupTimer", { configurable: true, get: () => setupTimer, set: (v) => { setupTimer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupWatermark", { configurable: true, get: () => setupWatermark, set: (v) => { setupWatermark = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showResult", { configurable: true, get: () => showResult, set: (v) => { showResult = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showWarn", { configurable: true, get: () => showWarn, set: (v) => { showWarn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "skipQuestion", { configurable: true, get: () => skipQuestion, set: (v) => { skipQuestion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "startAttempt", { configurable: true, get: () => startAttempt, set: (v) => { startAttempt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submit", { configurable: true, get: () => submit, set: (v) => { submit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncSelectedClass", { configurable: true, get: () => syncSelectedClass, set: (v) => { syncSelectedClass = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "warnUnload", { configurable: true, get: () => warnUnload, set: (v) => { warnUnload = v; } }); } catch (e) {}
})();
