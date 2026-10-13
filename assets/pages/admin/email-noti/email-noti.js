// admin/email-noti — page script, extracted from admin/email-noti.html.
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

const State = {
  mode:        'course',
  recipients:  [],   // [{id, name, username, email, role}]
  selectedIds: new Set(),
  courses:     [],
  exams:       [],
  defaultChatWebhooks: [],  // resolved once at bootstrap from system-settings
  // Subject auto-fill bookkeeping:
  //   _lastAutoSubject — the most recent value we auto-filled into #email-subject
  //   _subjectDirty    — true if admin edited the subject AFTER auto-fill
  //                       (we won't overwrite their edit without explicit reset)
  _lastAutoSubject: '',
  _subjectDirty:    false,
};

// ── Initial data load ───────────────────────────────────────
async function bootstrap() {
  const [r, c, e, w] = await Promise.all([
    API.get('/email-noti/?action=recipients'),
    API.get('/email-noti/?action=courses'),
    API.get('/email-noti/?action=exams'),
    API.get('/email-noti/?action=chat_webhooks'),
  ]);
  State.recipients = r?.data?.data || [];
  State.courses    = c?.data?.data || [];
  State.exams      = e?.data?.data || [];
  State.defaultChatWebhooks = (w?.data?.data?.webhooks) || [];
  updateChatHint();

  // Default: all recipients selected
  State.selectedIds = new Set(State.recipients.map(u => u.id));

  // Populate course/exam dropdowns (both Course mode + Course+Exam mode)
  const cSel  = document.getElementById('course-select');
  const ceCSel = document.getElementById('ce-course-select');
  State.courses.forEach(c => {
    const label = c.mandatory
      ? `${c.icon} ${c.title}  <i data-icon="star"></i> บังคับเรียน`
      : `${c.icon} ${c.title}`;
    const opt = `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
    cSel.insertAdjacentHTML('beforeend', opt);
    ceCSel.insertAdjacentHTML('beforeend', opt);
  });
  const eSel  = document.getElementById('exam-select');
  const ceESel = document.getElementById('ce-exam-select');
  State.exams.forEach(e => {
    const opt = `<option value="${e.id}">${escapeHtml(e.icon)} ${escapeHtml(e.title)}${e.status === 'draft' ? ' (draft)' : ''}</option>`;
    eSel.insertAdjacentHTML('beforeend', opt);
    ceESel.insertAdjacentHTML('beforeend', opt);
  });

  renderRecipients();
  updatePreview();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// ── Mode switch ─────────────────────────────────────────────
function setMode(m) {
  State.mode = m;
  document.querySelectorAll('.mode-card').forEach(el => el.classList.toggle('active', el.dataset.mode === m));
  ['course', 'exam', 'course_exam', 'custom'].forEach(k => {
    document.getElementById('mode-' + k).style.display = (k === m) ? '' : 'none';
  });
  document.getElementById('content-sub').textContent = ({
    course:      'เลือกคอร์สและเขียนข้อความเพิ่มเติม (ถ้าต้องการ)',
    exam:        'เลือกข้อสอบและเขียนข้อความเพิ่มเติม (ถ้าต้องการ)',
    course_exam: 'เลือกคอร์ส + ข้อสอบจบคอร์ส — อีเมลฉบับเดียวประกาศทั้งสองเลย',
    custom:      'พิมพ์เนื้อหาเอง — เหมาะกับประกาศทั่วไป (กรอกหัวข้ออีเมลด้านบน)',
  })[m];
  // Mode switch → clear dirty flag and reset to default for the new mode
  State._subjectDirty = false;
  applyAutoSubject();
  updatePreview();
}

// ── Subject auto-fill ───────────────────────────────────────
function computeDefaultSubject() {
  if (State.mode === 'course') {
    const id = document.getElementById('course-select').value;
    const c  = State.courses.find(x => x.id === id);
    if (!c) return '';
    if (c.id === '__onboarding__') {
      return '<i data-icon=\"rocket\"></i> [SM - Action Required] Mandatory Training: Team Onboarding Platform';
    }
    return `<i data-icon=\"rocket\"></i> [SM - Action Required] Mandatory Training: ${c.title}`;
  }
  if (State.mode === 'exam') {
    const id = document.getElementById('exam-select').value;
    const e  = State.exams.find(x => x.id === id);
    return e ? `<i data-icon=\"rocket\"></i> [SM - Action Required] Mandatory Exam: ${e.title}` : '';
  }
  if (State.mode === 'course_exam') {
    const cid = document.getElementById('ce-course-select').value;
    const c   = State.courses.find(x => x.id === cid);
    if (!c) return '';
    return `<i data-icon=\"rocket\"></i> [SM - Action Required] Mandatory Training + Exam: ${c.title}`;
  }
  return ''; // custom — admin types their own
}

// Auto-fill the subject input — unless admin has manually edited it
function applyAutoSubject() {
  const inp = document.getElementById('email-subject');
  const def = computeDefaultSubject();
  if (State._subjectDirty) return;       // respect admin's edit
  inp.value = def;
  State._lastAutoSubject = def;
}

// Fired when admin types in the subject field
function onSubjectEdit() {
  const inp = document.getElementById('email-subject');
  // Only mark dirty if value differs from what we auto-filled
  State._subjectDirty = (inp.value !== State._lastAutoSubject);
  updatePreview();
}

// Force-reset to computed default (clears dirty flag)
function resetSubjectToDefault() {
  State._subjectDirty = false;
  applyAutoSubject();
  updatePreview();
}

// Fired when course/exam selection changes
function onContentChange() {
  // In "Course + Exam" mode, when admin picks a course, try to auto-select
  // the exam whose course_prerequisites includes that course. We only
  // auto-fill when the exam field is still empty — never overwrite a manual pick.
  if (State.mode === 'course_exam') {
    const ceCourseSel = document.getElementById('ce-course-select');
    const ceExamSel   = document.getElementById('ce-exam-select');
    const hintEl      = document.getElementById('ce-exam-hint');
    const cid = ceCourseSel.value;
    if (cid && !ceExamSel.value) {
      const matched = State.exams.find(e =>
        Array.isArray(e.course_prerequisites) && e.course_prerequisites.includes(cid)
      );
      if (matched) {
        ceExamSel.value = matched.id;
        hintEl.innerHTML = `<i data-icon=\"check\"></i> แนะนำ <strong>${escapeHtml(matched.icon)} ${escapeHtml(matched.title)}</strong> โดยอัตโนมัติ (course_prerequisites ตรงกัน) — เปลี่ยนได้ตามต้องการ`;
      } else {
        hintEl.textContent = 'ไม่พบข้อสอบที่ตั้ง prerequisite เป็นคอร์สนี้ — กรุณาเลือกเอง';
      }
    }
  }
  applyAutoSubject();
  updatePreview();
}

// ── Recipient picker ────────────────────────────────────────
function renderRecipients() {
  const q = (document.getElementById('rcpt-search').value || '').trim().toLowerCase();
  const list = document.getElementById('rcpt-list');
  const filtered = State.recipients.filter(u => {
    if (!q) return true;
    return [u.name, u.username, u.email].some(v => (v||'').toLowerCase().includes(q));
  });

  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:12px">ไม่พบผู้รับที่ตรงกับคำค้น</div>';
    return;
  }

  filtered.forEach(u => {
    const initial = (u.name || u.username || '?').charAt(0).toUpperCase();
    const checked = State.selectedIds.has(u.id);
    const roleClass = ({sm_admin:'admin', dev_sm:'admin', sm_lead:'lead', sm_user:'user', external:'ext'})[u.role] || 'user';
    const roleLabel = ({sm_admin:'Admin', dev_sm:'Dev', sm_lead:'Lead', sm_user:'User', external:'Ext'})[u.role] || u.role;
    const row = document.createElement('label');
    row.className = 'rcpt-row';
    row.innerHTML = `
      <input type="checkbox" data-id="${escapeHtml(u.id)}" ${checked ? 'checked' : ''}>
      <div class="rcpt-avatar">${escapeHtml(initial)}</div>
      <div class="rcpt-name">${escapeHtml(u.name)}</div>
      <div class="rcpt-email">${escapeHtml(u.email)}</div>
      <span class="rcpt-role-badge ${roleClass}">${escapeHtml(roleLabel)}</span>
    `;
    row.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) State.selectedIds.add(u.id);
      else                   State.selectedIds.delete(u.id);
      updateRecipientStats();
      updatePreview();
    });
    list.appendChild(row);
  });
  updateRecipientStats();
}

function toggleAll(check) {
  if (check) {
    State.recipients.forEach(u => State.selectedIds.add(u.id));
  } else {
    State.selectedIds.clear();
  }
  renderRecipients();
}

function updateRecipientStats() {
  document.getElementById('rcpt-sel-count').textContent   = State.selectedIds.size;
  document.getElementById('rcpt-total-count').textContent = State.recipients.length;
  // Sync "select all" checkbox state
  const all = document.getElementById('rcpt-all');
  all.checked = State.selectedIds.size === State.recipients.length;
  all.indeterminate = State.selectedIds.size > 0 && State.selectedIds.size < State.recipients.length;
}

// ── Preview ────────────────────────────────────────────────
function updatePreview() {
  const typeLabel = ({
    course:      '<i data-icon=\"book-open\"></i> New Course',
    exam:        '<i data-icon=\"edit\"></i> New Exam',
    course_exam: '<i data-icon=\"book-open\"></i><i data-icon=\"edit\"></i> Course + Exam',
    custom:      '<i data-icon=\"megaphone\"></i> Custom Announcement',
  })[State.mode];
  document.getElementById('prev-type').textContent = typeLabel;

  const subject = document.getElementById('email-subject').value.trim();
  let body = '';
  if (State.mode === 'course') {
    const id = document.getElementById('course-select').value;
    const c  = State.courses.find(x => x.id === id);
    body = c ? (c.description || c.subtitle || '') : '';
    const extra = document.getElementById('course-extra').value.trim();
    if (extra) body += '\n\n--- ข้อความจากแอดมิน ---\n' + extra;
  } else if (State.mode === 'exam') {
    const id = document.getElementById('exam-select').value;
    const e  = State.exams.find(x => x.id === id);
    body = e ? `${e.description || e.subtitle || ''}\n\nเกณฑ์ผ่าน: ${e.pass_score}%` : '';
    const extra = document.getElementById('exam-extra').value.trim();
    if (extra) body += '\n\n--- ข้อความจากแอดมิน ---\n' + extra;
  } else if (State.mode === 'course_exam') {
    const cid = document.getElementById('ce-course-select').value;
    const eid = document.getElementById('ce-exam-select').value;
    const c   = State.courses.find(x => x.id === cid);
    const e   = State.exams.find(x => x.id === eid);
    if (c) {
      body += `<i data-icon=\"book-open\"></i> ${c.title}\n${c.description || c.subtitle || ''}`;
    }
    if (e) {
      if (body) body += '\n\n';
      body += `<i data-icon=\"edit\"></i> ${e.title}\n${e.description || e.subtitle || ''}\nเกณฑ์ผ่าน: ${e.pass_score}%`;
    }
    const extra = document.getElementById('ce-extra').value.trim();
    if (extra) body += '\n\n--- ข้อความจากแอดมิน ---\n' + extra;
  } else {
    body = document.getElementById('custom-body').value.trim();
  }

  const subEl = document.getElementById('prev-subject');
  subEl.textContent = subject || '(ยังไม่ได้กรอกหัวข้อ)';
  subEl.classList.toggle('empty', !subject);

  const bodyEl = document.getElementById('prev-body');
  bodyEl.textContent = body || '—';

  document.getElementById('prev-recipients').textContent = `${State.selectedIds.size} คน`;

  updateChatPreview();

  const excluded = State.recipients.filter(u => !State.selectedIds.has(u.id));
  const exEl = document.getElementById('prev-excluded');
  if (!excluded.length) {
    exEl.textContent = '(ส่งให้ทุกคน)';
    exEl.classList.add('empty');
  } else {
    exEl.textContent = excluded.map(u => u.name).join(', ');
    exEl.classList.remove('empty');
  }
}

// ── Google Chat toggle ──────────────────────────────────────
function onChatToggle() {
  const on = document.getElementById('chat-toggle').checked;
  document.getElementById('chat-body').style.display = on ? '' : 'none';
  updateChatPreview();
}
function updateChatHint() {
  const n = State.defaultChatWebhooks.length;
  const el = document.getElementById('chat-webhook-hint');
  if (!el) return;
  if (n > 0) {
    el.innerHTML = `พบ default ใน System Settings แล้ว <strong>${n}</strong> URL — จะใช้ค่านั้นถ้าเว้นว่าง (<a href="./system-settings.html" style="color:var(--orange)">แก้ที่ System Settings</a>)`;
  } else {
    el.innerHTML = `ยังไม่มี default — โปรดกรอก URL ที่นี่ หรือตั้งที่ <a href="./system-settings.html" style="color:var(--orange)">System Settings</a>`;
  }
}
function getChatWebhooks() {
  const raw = (document.getElementById('chat-webhooks')?.value || '').trim();
  if (!raw) return { source: 'default', urls: State.defaultChatWebhooks };
  const urls = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return { source: 'override', urls };
}
function updateChatPreview() {
  const on = document.getElementById('chat-toggle').checked;
  const el = document.getElementById('prev-chat');
  if (!on) {
    el.textContent = 'ปิด — ส่งเฉพาะเมล';
    el.classList.add('empty');
    return;
  }
  const {source, urls} = getChatWebhooks();
  el.classList.remove('empty');
  if (!urls.length) {
    el.innerHTML = '<span style="color:#ef4444"><i data-icon=\"alert-triangle\"></i> ยังไม่มี webhook — จะข้ามการส่ง Chat</span>';
  } else {
    const label = source === 'default' ? 'default' : 'override';
    el.innerHTML = `เปิด — ยิง <strong>${urls.length}</strong> webhook (${label})`;
  }
}
// Watch the webhook textarea to update the preview live
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'chat-webhooks') updateChatPreview();
});

// ── Build the payload from current form state ───────────────
function buildPayload() {
  const subject = document.getElementById('email-subject').value.trim();
  const chatOn  = document.getElementById('chat-toggle').checked;
  const chat    = chatOn ? getChatWebhooks() : null;
  const payload = {
    type:          State.mode,
    subject:       subject, // server uses as override for course/exam, required for custom
    recipient_ids: Array.from(State.selectedIds),
    also_chat:         chatOn,
    // Only send override URLs when the admin typed something; else server uses default
    chat_webhook_urls: chat && chat.source === 'override' ? chat.urls : [],
  };
  if (State.mode === 'course') {
    payload.ref_id  = document.getElementById('course-select').value;
    payload.message = document.getElementById('course-extra').value.trim();
  } else if (State.mode === 'exam') {
    payload.ref_id  = document.getElementById('exam-select').value;
    payload.message = document.getElementById('exam-extra').value.trim();
  } else if (State.mode === 'course_exam') {
    payload.ref_id      = document.getElementById('ce-course-select').value;
    payload.exam_ref_id = document.getElementById('ce-exam-select').value;
    payload.message     = document.getElementById('ce-extra').value.trim();
  } else {
    payload.message = document.getElementById('custom-body').value.trim();
  }
  return payload;
}

// ── Validate inputs before opening preview ──────────────────
function validateForm() {
  const errs = [];
  if (State.selectedIds.size === 0) errs.push('กรุณาเลือกผู้รับอย่างน้อย 1 คน');
  if (!document.getElementById('email-subject').value.trim()) errs.push('กรุณากรอกหัวข้ออีเมล');
  if (State.mode === 'course' && !document.getElementById('course-select').value) errs.push('กรุณาเลือกคอร์ส');
  if (State.mode === 'exam'   && !document.getElementById('exam-select').value)   errs.push('กรุณาเลือกข้อสอบ');
  if (State.mode === 'course_exam') {
    if (!document.getElementById('ce-course-select').value) errs.push('กรุณาเลือกคอร์ส');
    if (!document.getElementById('ce-exam-select').value)   errs.push('กรุณาเลือกข้อสอบ');
  }
  if (State.mode === 'custom' && !document.getElementById('custom-body').value.trim()) errs.push('กรุณากรอกเนื้อหา');
  return errs;
}

// ── Open preview modal: validate → fetch render → display ──
async function confirmSend() {
  const errs = validateForm();
  if (errs.length) { Toast.warning(errs.join('\n')); return; }

  const overlay = document.getElementById('pv-overlay');
  const iframe  = document.getElementById('pv-iframe');
  const loading = document.getElementById('pv-loading');
  const subjEl  = document.getElementById('pv-subject');
  const metaEl  = document.getElementById('pv-meta');
  const btn     = document.getElementById('pv-btn-send');

  // Show modal in loading state
  iframe.style.display  = 'none';
  loading.style.display = '';
  subjEl.textContent    = '...';
  metaEl.innerHTML      = '';
  btn.disabled          = true;
  overlay.classList.add('show');

  const typeLabel = ({
    course:      '<i data-icon=\"book-open\"></i> New Course',
    exam:        '<i data-icon=\"edit\"></i> New Exam',
    course_exam: '<i data-icon=\"book-open\"></i><i data-icon=\"edit\"></i> Course + Exam',
    custom:      '<i data-icon=\"megaphone\"></i> Custom',
  })[State.mode];
  const n         = State.selectedIds.size;
  const excluded  = State.recipients.length - n;
  metaEl.innerHTML = `
    <span class="pv-meta-item">ประเภท: <strong>${typeLabel}</strong></span>
    <span class="pv-meta-item"><i data-icon=\"mail\"></i> ผู้รับ: <strong>${n} คน</strong></span>
    ${excluded > 0 ? `<span class="pv-meta-item">⊘ ติ๊กออก: <strong>${excluded} คน</strong></span>` : ''}
  `;

  // Fetch server-rendered email HTML
  const res = await API.post('/email-noti/?action=preview', buildPayload());
  loading.style.display = 'none';
  btn.disabled          = false;

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'ไม่สามารถสร้าง preview ได้');
    closePreview();
    return;
  }

  const data = res.data?.data || {};
  subjEl.textContent = data.subject || '(no subject)';
  iframe.srcdoc      = data.html    || '';
  iframe.style.display = '';
}

function closePreview() {
  document.getElementById('pv-overlay').classList.remove('show');
}

// Close on backdrop click
document.getElementById('pv-overlay').addEventListener('click', e => {
  if (e.target.id === 'pv-overlay') closePreview();
});
// Close on Esc
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('pv-overlay').classList.contains('show')) closePreview();
});

// ── Actual send (only called from preview modal confirmation) ──
async function doSend() {
  const btn        = document.getElementById('pv-btn-send');
  const pageSendBtn= document.getElementById('send-btn');
  const pageText   = document.getElementById('send-btn-text');

  btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...';
  pageSendBtn.disabled = true; pageText.textContent = '⏳ กำลังส่ง...';

  const res = await API.post('/email-noti/?action=send', buildPayload());

  btn.disabled = false; btn.innerHTML = '<i data-icon=\"upload\"></i> ยืนยันส่งอีเมล';
  pageSendBtn.disabled = false; pageText.innerHTML = '<i data-icon=\"upload\"></i> ส่งอีเมลเลย';
  closePreview();

  const box = document.getElementById('send-result');
  if (res?.ok) {
    const d = res.data?.data || {};
    const emailFailed = d.failed > 0;
    const chatFailed  = d.chat && !d.chat.success;
    const cls = (emailFailed || chatFailed) ? 'warn' : 'ok';
    let html = `<h4>${cls === 'ok' ? '<i data-icon=\"check\"></i>' : '<i data-icon=\"alert-triangle\"></i>'} ส่งเมลสำเร็จ ${d.sent} / ${d.total} ฉบับ</h4>`;
    if (emailFailed) {
      html += `<div>ส่งเมลไม่สำเร็จ: ${d.failed} ฉบับ</div><ul>`;
      (d.details || []).filter(x => x.status !== 'sent').forEach(x => {
        html += `<li>${escapeHtml(x.email || x.user_id)} — ${escapeHtml(x.error || x.status)}</li>`;
      });
      html += '</ul>';
    }
    if (d.chat) {
      if (d.chat.skipped_reason === 'no_webhook') {
        html += `<div style="margin-top:8px"><i data-icon=\"message-circle\"></i> Google Chat: ข้ามการส่ง — ${escapeHtml((d.chat.errors||[])[0]||'no webhook')}</div>`;
      } else {
        const chatIcon = d.chat.success ? '<i data-icon=\"check\"></i>' : '<i data-icon=\"alert-triangle\"></i>';
        html += `<div style="margin-top:8px"><i data-icon=\"message-circle\"></i> Google Chat: ${chatIcon} ยิงสำเร็จ ${d.chat.sent} / ${d.chat.sent + d.chat.failed} webhook</div>`;
        if ((d.chat.errors || []).length) {
          html += '<ul>';
          d.chat.errors.forEach(er => { html += `<li>${escapeHtml(er)}</li>`; });
          html += '</ul>';
        }
      }
    }
    box.className = 'send-result ' + cls;
    box.innerHTML = html;
    const summary = d.chat && d.chat.success
      ? `ส่งเมล ${d.sent}/${d.total} + Chat ${d.chat.sent} webhook <i data-icon=\"check\"></i>`
      : `ส่งเมล ${d.sent}/${d.total} ฉบับสำเร็จ`;
    Toast.success(summary);
  } else {
    box.className = 'send-result err';
    box.innerHTML = `<h4><i data-icon=\"x\"></i> ส่งไม่สำเร็จ</h4><div>${escapeHtml(res?.data?.message || 'Unknown error')}</div>`;
    Toast.error(res?.data?.message || 'ส่งไม่สำเร็จ');
  }
}

bootstrap();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyAutoSubject", { configurable: true, get: () => applyAutoSubject, set: (v) => { applyAutoSubject = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "bootstrap", { configurable: true, get: () => bootstrap, set: (v) => { bootstrap = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildPayload", { configurable: true, get: () => buildPayload, set: (v) => { buildPayload = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closePreview", { configurable: true, get: () => closePreview, set: (v) => { closePreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "computeDefaultSubject", { configurable: true, get: () => computeDefaultSubject, set: (v) => { computeDefaultSubject = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmSend", { configurable: true, get: () => confirmSend, set: (v) => { confirmSend = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doSend", { configurable: true, get: () => doSend, set: (v) => { doSend = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escapeHtml", { configurable: true, get: () => escapeHtml, set: (v) => { escapeHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getChatWebhooks", { configurable: true, get: () => getChatWebhooks, set: (v) => { getChatWebhooks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onChatToggle", { configurable: true, get: () => onChatToggle, set: (v) => { onChatToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onContentChange", { configurable: true, get: () => onContentChange, set: (v) => { onContentChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onSubjectEdit", { configurable: true, get: () => onSubjectEdit, set: (v) => { onSubjectEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRecipients", { configurable: true, get: () => renderRecipients, set: (v) => { renderRecipients = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetSubjectToDefault", { configurable: true, get: () => resetSubjectToDefault, set: (v) => { resetSubjectToDefault = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setMode", { configurable: true, get: () => setMode, set: (v) => { setMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleAll", { configurable: true, get: () => toggleAll, set: (v) => { toggleAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateChatHint", { configurable: true, get: () => updateChatHint, set: (v) => { updateChatHint = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateChatPreview", { configurable: true, get: () => updateChatPreview, set: (v) => { updateChatPreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updatePreview", { configurable: true, get: () => updatePreview, set: (v) => { updatePreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateRecipientStats", { configurable: true, get: () => updateRecipientStats, set: (v) => { updateRecipientStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "validateForm", { configurable: true, get: () => validateForm, set: (v) => { validateForm = v; } }); } catch (e) {}
})();
