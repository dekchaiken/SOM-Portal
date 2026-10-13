// send-email — page script, extracted from send-email.html.
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
Layout.render('send-email');

// ─── Date picker init: today (Bangkok time UTC+7) ───
const _todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
document.getElementById('se-date').value = _todayStr;
document.getElementById('se-date').addEventListener('change', loadCases);

// ─── State ──────────────────────────────────────────
let _allCases    = [];
let _currentCase = null;
let _mailCfg     = {};
let _serviceTypes= [];
let _toEmails    = [];
let _ccEmails    = [];
let _autoToEmails = [];   // emails added by service auto-fill (tracked for removal on re-select)
let _autoCcEmails = [];

// ═══════════════════════════════════════════════════
//   LOAD CASES
// ═══════════════════════════════════════════════════
function caseSkeleton(n = 4) {
  return Array(n).fill(0).map(() => `
    <div class="se-skel">
      <div class="se-skel-line short"></div>
      <div class="se-skel-line"></div>
      <div class="se-skel-line" style="width:80%"></div>
    </div>`).join('');
}

let _loadGen = 0; // cancelled stale retries when user changes date or refreshes

async function loadCases() {
  const gen  = ++_loadGen;
  const list = document.getElementById('se-cases-list');
  const sub  = document.getElementById('se-cases-sub');
  const date = document.getElementById('se-date').value || _todayStr;

  list.innerHTML = caseSkeleton();
  sub.textContent = `กำลังโหลด ${date}…`;
  document.getElementById('se-refresh').disabled = true;

  const MAX_RETRIES = 2;
  const RETRY_DELAY = 1500;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (gen !== _loadGen) return; // newer load triggered — abort this one

    if (attempt > 0) {
      sub.textContent = `กำลัง retry (${attempt}/${MAX_RETRIES})…`;
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      if (gen !== _loadGen) return;
    }

    const res = await API.get(`/jira/smc-cases.php?date=${encodeURIComponent(date)}`);
    if (gen !== _loadGen) return;

    if (res?.ok) {
      document.getElementById('se-refresh').disabled = false;
      _allCases = res.data.data?.cases || [];
      sub.textContent = `${_allCases.length} เคส · วันที่ ${date}`;
      renderCases(_allCases);
      return;
    }

    if (attempt < MAX_RETRIES) continue; // will retry

    document.getElementById('se-refresh').disabled = false;
    list.innerHTML = `<div class="se-empty">
      <div class="icon"><i data-icon="alert-triangle"></i></div>
      <div class="msg">โหลดไม่สำเร็จ</div>
      <div class="sub">${escHtml(res?.data?.message || 'unknown')}</div>
    </div>`;
    sub.textContent = 'Error';
  }
}

function renderCases(cases) {
  const list = document.getElementById('se-cases-list');
  if (!cases.length) {
    list.innerHTML = `<div class="se-empty">
      <div class="icon"><i data-icon="inbox"></i></div>
      <div class="msg">ไม่มีเคสในวันนี้</div>
      <div class="sub">ลองเปลี่ยนวันที่หรือกด refresh</div>
    </div>`;
    return;
  }
  list.innerHTML = cases.map(c => {
    const time = c.created ? new Date(c.created).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="se-case-card" data-key="${escHtml(c.key)}" onclick="selectCase('${escHtml(c.key)}')">
        <div class="se-case-top">
          <span class="se-case-key">${escHtml(c.key)}</span>
          <span class="se-case-type ${escHtml(c.issuetype)}">${escHtml(c.issuetype)}</span>
          <span class="se-case-status ${escHtml(c.statusCat)}">${escHtml(c.status)}</span>
        </div>
        <div class="se-case-summary">${escHtml(c.summary)}</div>
        <div class="se-case-meta">
          <span class="t"><i data-icon="clock"></i> ${escHtml(time)}</span>
          <span class="t"><i data-icon="user"></i> ${escHtml(c.assignee)}</span>
          <button class="se-case-view" title="ดูรายละเอียด"
                  onclick="event.stopPropagation();openDetailModal('${escHtml(c.key)}')">details →</button>
        </div>
      </div>`;
  }).join('');
}

// ─── Search ─────────────────────────────────────────
document.getElementById('se-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) return renderCases(_allCases);
  const filtered = _allCases.filter(c =>
    c.key.toLowerCase().includes(q) ||
    (c.summary || '').toLowerCase().includes(q)
  );
  renderCases(filtered);
});

// ═══════════════════════════════════════════════════
//   SELECT CASE → OPEN FORM
// ═══════════════════════════════════════════════════
async function selectCase(key) {
  const c = _allCases.find(x => x.key === key);
  if (!c) return;
  _currentCase = c;

  // Highlight active card
  document.querySelectorAll('.se-case-card').forEach(el =>
    el.classList.toggle('active', el.dataset.key === key));

  // Slide in form
  document.getElementById('se-page').classList.add('has-form');

  // Header
  document.getElementById('se-form-key').textContent = c.key;
  document.getElementById('se-form-sum').textContent = c.summary || '';
  document.getElementById('se-form-sum').title       = c.summary || '';

  // Subject pre-fill
  document.getElementById('se-subject').value = `[${c.key}] - ${c.summary || ''}`;

  // Reset email body
  document.getElementById('se-body').innerHTML = `<p><br></p>`;

  // Load mail config (once) for global CC
  if (!_mailCfg.smtp_host) {
    const r = await API.mailConfig.get();
    _mailCfg = r?.ok ? (r.data.data || {}) : {};
  }
  // Reset email state
  _toEmails     = [];
  _ccEmails     = Array.isArray(_mailCfg.global_cc) ? [..._mailCfg.global_cc] : [];
  _autoToEmails = [];
  _autoCcEmails = [];
  renderChips();

  // Load service subtypes (once) — grouped by service type, filtered to those with services
  if (!_serviceTypes.length) {
    const r = await API.serviceTypes.list();
    _serviceTypes = r?.ok ? (r.data.data || []) : [];
    const sel = document.getElementById('se-subtype');
    _serviceTypes.forEach(t => {
      const subtypes = (t.subtypes || []).filter(s =>
        (s.services || []).length > 0 || (s.emails || []).length > 0
      );
      if (!subtypes.length) return;
      const grp = document.createElement('optgroup');
      grp.label = t.name;
      subtypes.forEach(st => {
        const o = document.createElement('option');
        o.value = st.id;
        const svcCount = (st.services || []).length;
        o.textContent = st.name + (svcCount ? ` (${svcCount} services)` : '');
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
  }
  document.getElementById('se-subtype').value = '';
  document.getElementById('se-service').innerHTML = '<option value="">— ไม่เลือก —</option>';
  document.getElementById('se-service-row').style.display = 'none';
}

function closeForm() {
  document.getElementById('se-page').classList.remove('has-form');
  document.querySelectorAll('.se-case-card.active').forEach(el => el.classList.remove('active'));
  _currentCase = null;
  _autoToEmails = [];
  _autoCcEmails = [];
  document.getElementById('se-subtype').value = '';
  document.getElementById('se-service').innerHTML = '<option value="">— ไม่เลือก —</option>';
  document.getElementById('se-service-row').style.display = 'none';
}

// Close drawer with Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('se-page').classList.contains('has-form')) {
    closeForm();
  }
});

// ═══════════════════════════════════════════════════
//   CHIPS (To / CC)
// ═══════════════════════════════════════════════════
function renderChips() {
  renderChipField('se-to-field', 'se-to-input', _toEmails);
  renderChipField('se-cc-field', 'se-cc-input', _ccEmails);
}
function renderChipField(fieldId, inputId, list) {
  const field = document.getElementById(fieldId);
  field.querySelectorAll('.se-chip').forEach(c => c.remove());
  const input = document.getElementById(inputId);
  list.forEach(em => {
    const chip = document.createElement('span');
    chip.className = 'se-chip';
    chip.innerHTML = `${escHtml(em)}<button class="se-chip-x" data-em="${escHtml(em)}" data-list="${fieldId}">×</button>`;
    field.insertBefore(chip, input);
  });
}
// parseEmailList() is provided by utils.js

function addChip(fieldId, inputId, list) {
  const input  = document.getElementById(inputId);
  const raw    = input.value.trim().replace(/,\s*$/, '');
  if (!raw) return;
  const emails = parseEmailList(raw);
  if (!emails.length && raw.includes('@')) emails.push(raw);
  let added = 0;
  emails.forEach(em => { if (!list.includes(em)) { list.push(em); added++; } });
  if (added) renderChips();
  input.value = '';
}

['se-to', 'se-cc'].forEach(prefix => {
  const fieldId = prefix + '-field';
  const inputId = prefix + '-input';
  const arr     = () => prefix === 'se-to' ? _toEmails : _ccEmails;

  document.getElementById(fieldId).addEventListener('click', e => {
    const btn = e.target.closest('.se-chip-x');
    if (!btn) return;
    const list = btn.dataset.list === 'se-to-field' ? _toEmails : _ccEmails;
    const i = list.indexOf(btn.dataset.em);
    if (i > -1) list.splice(i, 1);
    renderChips();
  });
  document.getElementById(inputId).addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(fieldId, inputId, arr()); }
    if (e.key === 'Backspace' && !e.target.value && arr().length) {
      arr().pop(); renderChips();
    }
  });
  document.getElementById(inputId).addEventListener('blur', () => addChip(fieldId, inputId, arr()));

  // Paste handler — intercept and parse all emails at once
  document.getElementById(inputId).addEventListener('paste', e => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if (!pasted) return;
    const emails = parseEmailList(pasted);
    if (!emails.length) {
      // Fallback: just put raw text into input and let normal flow handle it
      document.getElementById(inputId).value = pasted;
      return;
    }
    let added = 0;
    emails.forEach(em => { if (!arr().includes(em)) { arr().push(em); added++; } });
    if (added) { renderChips(); Toast.success(`เพิ่ม ${added} email แล้ว`); }
  });
});

// Remove previously auto-filled emails from To/CC lists
function clearAutoEmails() {
  _toEmails    = _toEmails.filter(em => !_autoToEmails.includes(em));
  _ccEmails    = _ccEmails.filter(em => !_autoCcEmails.includes(em));
  _autoToEmails = [];
  _autoCcEmails = [];
}

// Subtype change → clear old auto-emails, reset service dropdown
document.getElementById('se-subtype').addEventListener('change', e => {
  const id  = e.target.value;
  const sel = document.getElementById('se-service');

  // Clear previous auto-fills
  clearAutoEmails();
  renderChips();

  sel.innerHTML = '<option value="">— ไม่เลือก —</option>';
  document.getElementById('se-service-row').style.display = 'none';
  if (!id) return;

  for (const t of _serviceTypes) {
    const st = (t.subtypes || []).find(s => s.id === id);
    if (!st) continue;

    if ((st.services || []).length > 0) {
      // Has services → show service dropdown
      st.services.forEach(svc => {
        const o = document.createElement('option');
        o.value               = svc.id;
        o.textContent         = svc.name
          + (svc.email_to?.length ? ` (To:${svc.email_to.length})` : '')
          + (svc.email_cc?.length ? ` (CC:${svc.email_cc.length})` : '');
        o.dataset.to          = JSON.stringify(svc.email_to || []);
        o.dataset.cc          = JSON.stringify(svc.email_cc || []);
        o.dataset.body        = svc.text_to_email || '';
        o.dataset.subject     = svc.subject || '';
        sel.appendChild(o);
      });
      document.getElementById('se-service-row').style.display = '';
    } else if ((st.emails || []).length > 0) {
      // Legacy: emails[] → add to CC (tracked for removal)
      st.emails.forEach(em => {
        if (!_ccEmails.includes(em)) {
          _ccEmails.push(em);
          _autoCcEmails.push(em);
        }
      });
      renderChips();
      Toast.success(`เพิ่ม ${st.emails.length} CC จาก ${st.name}`);
    }
    return;
  }
});

// Service change → clear old auto-emails, fill CC + body only (keep original subject from SMC case)
document.getElementById('se-service').addEventListener('change', e => {
  const opt = e.target.selectedOptions[0];

  // Clear previous auto-fills first
  clearAutoEmails();

  if (!opt?.value) { renderChips(); return; }

  let emailTo = [];
  let emailCc = [];
  try { emailTo = JSON.parse(opt.dataset.to || '[]'); } catch {}
  try { emailCc = JSON.parse(opt.dataset.cc || '[]'); } catch {}

  // Add to To list (track for removal)
  emailTo.forEach(em => {
    if (!_toEmails.includes(em)) { _toEmails.push(em); _autoToEmails.push(em); }
  });
  // Add to CC list (track for removal)
  emailCc.forEach(em => {
    if (!_ccEmails.includes(em)) { _ccEmails.push(em); _autoCcEmails.push(em); }
  });
  renderChips();

  // Auto-fill body
  const bodyText = opt.dataset.body || '';
  if (bodyText) {
    const html = bodyText
      .split('\n')
      .map(line => line.trim() ? `<p>${escHtml(line)}</p>` : '<p><br></p>')
      .join('');
    document.getElementById('se-body').innerHTML = html;
  }

  const msgs = [];
  if (emailTo.length) msgs.push(`To ${emailTo.length}`);
  if (emailCc.length) msgs.push(`CC ${emailCc.length}`);
  if (bodyText)       msgs.push('เนื้อหา');
  if (msgs.length)    Toast.success(`เติม ${msgs.join(', ')} อัตโนมัติแล้ว`);
});

// ═══════════════════════════════════════════════════
//   RICH EDITOR (toolbar + paste image + resize)
// ═══════════════════════════════════════════════════
const _editor = document.getElementById('se-body');

document.querySelectorAll('.se-editor-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    document.execCommand(btn.dataset.cmd, false, null);
    _editor.focus();
  });
});

// Font size dropdown — applies to current selection (or next typed text)
const _fontSizeSel = document.getElementById('se-font-size');
_fontSizeSel.addEventListener('change', () => {
  _editor.focus();
  document.execCommand('fontSize', false, _fontSizeSel.value);
  // Reset dropdown back to neutral label after applying
  // (so it reflects "current" state rather than last picked)
});

// Update font-size dropdown to reflect cursor position
_editor.addEventListener('keyup',   syncFontSizeDropdown);
_editor.addEventListener('mouseup', syncFontSizeDropdown);
_editor.addEventListener('focus',   syncFontSizeDropdown);

function syncFontSizeDropdown() {
  const el = document.getSelection()?.anchorNode?.parentElement;
  if (!el) return;
  // Walk up to find a <font size="N"> ancestor
  const font = el.closest('font[size]') || el.querySelector?.('font[size]');
  if (font) {
    const sz = font.getAttribute('size');
    if (sz && _fontSizeSel.value !== sz) _fontSizeSel.value = sz;
  }
}

document.getElementById('se-img-btn').addEventListener('click', () => {
  document.getElementById('se-img-input').click();
});
document.getElementById('se-img-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    document.execCommand('insertHTML', false,
      `<img src="${ev.target.result}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0">`);
    _editor.focus();
  };
  r.readAsDataURL(file);
  e.target.value = '';
});

_editor.addEventListener('paste', e => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const r = new FileReader();
      r.onload = ev => {
        document.execCommand('insertHTML', false,
          `<img src="${ev.target.result}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0">`);
      };
      r.readAsDataURL(file);
      return;
    }
  }
  const text = e.clipboardData?.getData('text/plain');
  if (text && !e.clipboardData.types.includes('text/html')) {
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }
});

try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
setupImageResize(_editor);

// ═══════════════════════════════════════════════════
//   SEND EMAIL
// ═══════════════════════════════════════════════════
async function sendEmail() {
  // Flush pending chip inputs
  addChip('se-to-field', 'se-to-input', _toEmails);
  addChip('se-cc-field', 'se-cc-input', _ccEmails);

  if (!_toEmails.length) { Toast.warning('ระบุผู้รับ (To) อย่างน้อย 1 ที่อยู่'); return; }

  const subject = document.getElementById('se-subject').value.trim();
  const body    = _editor.innerHTML.trim();
  if (!subject) { Toast.warning('กรุณาใส่หัวเรื่อง'); return; }
  if (!body || body === '<p><br></p>') { Toast.warning('กรุณาใส่เนื้อหา'); return; }

  const btn = document.getElementById('se-send');
  btn.disabled = true; btn.textContent = '⏳ กำลังส่ง…';

  const res = await API.mail.send({
    to:     _toEmails,
    cc:     _ccEmails,
    subject,
    body,
    isHtml: true,
  });

  btn.disabled = false; btn.innerHTML = '<i data-icon="mail"></i> ส่ง Email';

  if (res?.ok) {
    Toast.success(`ส่งสำเร็จ <i data-icon="sparkles"></i> (${_toEmails.length} ผู้รับ)`);
    closeForm();
  } else {
    Toast.error(res?.data?.message || 'ส่งไม่สำเร็จ');
  }
}

// ═══════════════════════════════════════════════════
//   CREATE TICKET MODAL
// ═══════════════════════════════════════════════════
// Map logical key → Jira field id
const CT_FID = {
  bu:       'customfield_17066',
  svc:      'customfield_17024',
  chn:      'customfield_17023',
  detected: 'customfield_17016',
  '3rd':    'customfield_17238',
};

let _ctOptions   = null;          // {fieldId: {options: [...]}}
let _ctBatchOpts = null;          // {sm_priority, batch_issue, batch_file_type}
let _ctMulti     = { bu: [], svc: [], chn: [] };
let _ctSingle    = { detected: '', '3rd': '' };

function openCreateModal() {
  document.getElementById('ct-overlay').classList.add('show');
  onWorkTypeChange();   // sync field visibility to current select value
  ensureCreateOptionsLoaded();
}
function closeCreateModal() {
  document.getElementById('ct-overlay').classList.remove('show');
  closeAllDropdowns();
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('ct-overlay').classList.contains('show')) {
    closeCreateModal();
  }
});

function onFaultModeChange() {
  const mode = document.getElementById('ct-fault-mode').value;
  const dt   = document.getElementById('ct-fault-dt');
  if (mode === 'manual') {
    dt.disabled = false;
    if (!dt.value) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      dt.value = now.toISOString().slice(0, 16);
    }
  } else {
    dt.disabled = true;
    dt.value = '';
  }
}

// ─── Work Type toggle ────────────────────────────────
function onWorkTypeChange() {
  const isBatch = document.getElementById('ct-issuetype').value === 'Batchfile';
  document.getElementById('ct-monitoring-fields').style.display = isBatch ? 'none' : '';
  document.getElementById('ct-batchfile-fields').style.display  = isBatch ? '' : 'none';
  document.getElementById('ct-detected-cell').style.display     = isBatch ? 'none' : '';
  if (isBatch) ensureBatchOptionsLoaded();
}

async function ensureBatchOptionsLoaded() {
  if (_ctBatchOpts) return;
  document.getElementById('ct-bf-priority').innerHTML = '<option value="">กำลังโหลด…</option>';
  document.getElementById('ct-bf-issue').innerHTML    = '<option value="">กำลังโหลด…</option>';
  document.getElementById('ct-bf-filetype').innerHTML = '<option value="">กำลังโหลด…</option>';

  const res = await API.jira.batchFields();
  if (!res?.ok) {
    Toast.error('โหลด Batch field options ไม่ได้: ' + (res?.data?.message || ''));
    return;
  }
  _ctBatchOpts = res.data.data || {};

  const smOpts = _ctBatchOpts.sm_priority?.options || [];
  document.getElementById('ct-bf-priority').innerHTML =
    `<option value="">— เลือก SM Priority —</option>` +
    smOpts.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');

  const biOpts = _ctBatchOpts.batch_issue?.options || [];
  document.getElementById('ct-bf-issue').innerHTML =
    `<option value="">— เลือก Batch Issue —</option>` +
    biOpts.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');

  const ftOpts = _ctBatchOpts.batch_file_type?.options || [];
  document.getElementById('ct-bf-filetype').innerHTML =
    `<option value="">— เลือก Batch File Type —</option>` +
    ftOpts.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.value)}</option>`).join('');
}

function onBfFileTypeChange() {
  const selected = document.getElementById('ct-bf-filetype').value;
  const ftOpts   = _ctBatchOpts?.batch_file_type?.options || [];
  const found    = ftOpts.find(o => o.value === selected);
  const subGroup = document.getElementById('ct-bf-subtype-group');
  const subSel   = document.getElementById('ct-bf-subtype');

  if (found?.children?.length) {
    subSel.innerHTML = `<option value="">— เลือก Sub Type —</option>` +
      found.children.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    subGroup.style.display = '';
  } else {
    subSel.innerHTML = '<option value="">— เลือก Sub Type —</option>';
    subGroup.style.display = 'none';
  }
}

async function ensureCreateOptionsLoaded() {
  if (_ctOptions) return;
  const res = await API.get('/jira/field-options.php');
  if (!res?.ok) {
    Toast.error('โหลด field options ไม่ได้: ' + (res?.data?.message || ''));
    return;
  }
  _ctOptions = res.data.data || {};
  initTypeaheads();
}

// ─── Typeahead engine (multi + single) ──────────────
function getOptionsFor(key) {
  return _ctOptions?.[CT_FID[key]]?.options || [];
}

function highlight(text, q) {
  if (!q) return escHtml(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return escHtml(text);
  return escHtml(text.slice(0, i)) + '<mark>' + escHtml(text.slice(i, i + q.length)) + '</mark>' + escHtml(text.slice(i + q.length));
}

function renderDropdown(wrap, key, query) {
  const dd      = wrap.querySelector('.ct-dropdown');
  const isMulti = wrap.dataset.typeahead === 'multi';
  const opts    = getOptionsFor(key);
  const taken   = isMulti ? new Set(_ctMulti[key]) : new Set();
  const q       = (query || '').toLowerCase().trim();
  const filtered = opts.filter(o => !q || o.toLowerCase().includes(q));

  if (!filtered.length) {
    dd.innerHTML = `<div class="ct-opt-empty">ไม่พบตัวเลือกที่ตรงกับ "${escHtml(query)}"</div>`;
  } else {
    dd.innerHTML = filtered.map(o => {
      const dis = taken.has(o) ? ' disabled' : '';
      return `<div class="ct-opt${dis}" data-val="${escHtml(o)}">${highlight(o, query)}${taken.has(o) ? ' ✓' : ''}</div>`;
    }).join('');
  }
}

function openDropdown(wrap, key) {
  closeAllDropdowns();
  const input = wrap.querySelector('.ct-typeahead');
  renderDropdown(wrap, key, input.value);
  wrap.querySelector('.ct-dropdown').classList.add('open');
}
function closeAllDropdowns() {
  document.querySelectorAll('.ct-dropdown.open').forEach(d => d.classList.remove('open'));
}

// Click outside → close
document.addEventListener('mousedown', e => {
  if (!e.target.closest('[data-typeahead]')) closeAllDropdowns();
});

function renderMulti(key) {
  const wrap = document.querySelector(`[data-typeahead="multi"][data-key="${key}"]`);
  if (!wrap) return;
  // Remove old chips
  wrap.querySelectorAll('.se-chip').forEach(c => c.remove());
  const input = wrap.querySelector('.ct-typeahead');
  // Insert chips before input
  _ctMulti[key].forEach(v => {
    const chip = document.createElement('span');
    chip.className = 'se-chip';
    chip.innerHTML = `${escHtml(v)}<button class="se-chip-x" type="button">×</button>`;
    chip.querySelector('.se-chip-x').addEventListener('click', () => {
      _ctMulti[key] = _ctMulti[key].filter(x => x !== v);
      renderMulti(key);
    });
    wrap.insertBefore(chip, input);
  });
}

function setSingle(key, val) {
  _ctSingle[key] = val;
  const wrap  = document.querySelector(`[data-typeahead="single"][data-key="${key}"]`);
  const input = wrap.querySelector('.ct-typeahead');
  input.value = val;
  wrap.classList.toggle('has-value', !!val);
}

function initTypeaheads() {
  document.querySelectorAll('[data-typeahead]').forEach(wrap => {
    const key     = wrap.dataset.key;
    const isMulti = wrap.dataset.typeahead === 'multi';
    const input   = wrap.querySelector('.ct-typeahead');
    const dd      = wrap.querySelector('.ct-dropdown');
    if (input.dataset.taReady) return;
    input.dataset.taReady = '1';

    input.addEventListener('focus', () => openDropdown(wrap, key));
    input.addEventListener('input', () => {
      renderDropdown(wrap, key, input.value);
      dd.classList.add('open');
      // Single field: clear selection while typing fresh
      if (!isMulti && _ctSingle[key]) {
        _ctSingle[key] = '';
        wrap.classList.remove('has-value');
      }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && isMulti && !input.value && _ctMulti[key].length) {
        _ctMulti[key].pop(); renderMulti(key);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = dd.querySelector('.ct-opt:not(.disabled)');
        if (first) first.click();
      }
    });

    // Option click via delegation
    dd.addEventListener('mousedown', e => {
      e.preventDefault(); // keep focus on input
      const opt = e.target.closest('.ct-opt');
      if (!opt || opt.classList.contains('disabled')) return;
      const val = opt.dataset.val;
      if (isMulti) {
        if (!_ctMulti[key].includes(val)) {
          _ctMulti[key].push(val);
          renderMulti(key);
        }
        input.value = '';
        renderDropdown(wrap, key, '');
      } else {
        setSingle(key, val);
        dd.classList.remove('open');
      }
    });

    // Single: click ✕ icon to clear
    if (!isMulti) {
      wrap.addEventListener('click', e => {
        const r = wrap.getBoundingClientRect();
        if (wrap.classList.contains('has-value') && e.clientX > r.right - 28 && e.clientX < r.right - 4) {
          setSingle(key, '');
          input.focus();
        }
      });
    }
  });
}

async function submitCreate() {
  const issuetype = document.getElementById('ct-issuetype').value;
  const summary   = document.getElementById('ct-summary').value.trim();
  const action    = document.getElementById('ct-action').value.trim();
  const faultMode = document.getElementById('ct-fault-mode').value;
  const faultDt   = document.getElementById('ct-fault-dt').value;

  if (!summary) return Toast.warning('กรอก Summary');
  if (!action)  return Toast.warning('กรอก Action / Solution');

  // Build fields payload (matches /api/jira/create.php expectations)
  const fields = { issuetype };

  if (faultMode === 'manual' && faultDt) {
    fields['customfield_17026'] = new Date(faultDt).toISOString().replace('Z', '+0000');
  } else {
    fields['customfield_17026'] = 'auto';
  }

  if (issuetype === 'Batchfile') {
    const priority   = document.getElementById('ct-bf-priority').value;
    const batchIssue = document.getElementById('ct-bf-issue').value;
    const fileType   = document.getElementById('ct-bf-filetype').value;
    const subType    = document.getElementById('ct-bf-subtype').value;
    const hasSub     = document.getElementById('ct-bf-subtype-group').style.display !== 'none';

    if (!priority)                   return Toast.warning('เลือก SM Priority');
    if (!batchIssue)                 return Toast.warning('เลือก Batch Issue');
    if (!fileType)                   return Toast.warning('เลือก Batch File Type');
    if (hasSub && !subType)          return Toast.warning('เลือก Sub Type');

    fields['customfield_17019'] = priority;
    fields['customfield_17030'] = batchIssue;
    fields['customfield_17058'] = subType
      ? { value: fileType, child: { value: subType } }
      : { value: fileType };

  } else {
    // Monitoring
    const detected = _ctSingle.detected;
    const thirdP   = _ctSingle['3rd'];

    if (!detected)            return Toast.warning('เลือก Detected by');
    if (!_ctMulti.bu.length)  return Toast.warning('เลือก Business Unit Impacted อย่างน้อย 1');
    if (!_ctMulti.svc.length) return Toast.warning('เลือก TH Service Impacted อย่างน้อย 1');
    if (!_ctMulti.chn.length) return Toast.warning('เลือก TH Channel / Component อย่างน้อย 1');

    fields[CT_FID.detected] = detected;
    fields[CT_FID.bu]       = _ctMulti.bu.join(',');
    fields[CT_FID.svc]      = _ctMulti.svc.join(',');
    fields[CT_FID.chn]      = _ctMulti.chn.join(',');
    if (thirdP) fields[CT_FID['3rd']] = thirdP;
  }

  const btn = document.getElementById('ct-submit');
  btn.disabled = true; btn.textContent = '⏳ Creating…';

  const res = await API.post('/jira/create.php', {
    summary,
    description: action,   // Action/Solution → Jira description
    fields,
  });

  btn.disabled = false; btn.innerHTML = '<i data-icon="rocket"></i> Create Ticket';

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'Create ไม่สำเร็จ');
    return;
  }

  const issueKey = res.data.data?.issue_key || '';
  Toast.success(`สร้างสำเร็จ: ${issueKey} — กำลังรอ Jira index…`);
  closeCreateModal();
  resetCreateForm();

  // Jira takes 1-3 seconds to index a new issue before it appears in JQL search.
  // Retry up to 5 times with backoff until the new key shows up.
  await pollUntilCaseAppears(issueKey, 5);
}

async function pollUntilCaseAppears(key, maxTries) {
  for (let i = 0; i < maxTries; i++) {
    await new Promise(r => setTimeout(r, 1200 + i * 400)); // 1.2s, 1.6s, 2.0s, ...
    await loadCases();
    if (_allCases.find(c => c.key === key)) {
      selectCase(key);
      Toast.success(`เลือก ${key} แล้ว — เริ่มเขียน email ได้เลย`);
      return;
    }
  }
  // Gave up — at least the user can refresh manually
  Toast.warning(`${key} ยังไม่ปรากฏ — กดปุ่ม ↺ refresh สักครู่`);
}

function resetCreateForm() {
  document.getElementById('ct-summary').value    = '';
  document.getElementById('ct-action').value     = '';
  document.getElementById('ct-fault-mode').value = 'auto';
  document.getElementById('ct-fault-dt').value   = '';
  document.getElementById('ct-fault-dt').disabled = true;
  // Reset issuetype to default (Monitoring) and sync fields visibility
  document.getElementById('ct-issuetype').value  = 'Monitoring';
  onWorkTypeChange();
  // Reset Monitoring fields
  _ctMulti  = { bu: [], svc: [], chn: [] };
  _ctSingle = { detected: '', '3rd': '' };
  renderMulti('bu'); renderMulti('svc'); renderMulti('chn');
  setSingle('detected', '');
  setSingle('3rd', '');
  // Reset Batchfile fields
  document.getElementById('ct-bf-priority').value  = '';
  document.getElementById('ct-bf-issue').value     = '';
  document.getElementById('ct-bf-filetype').value  = '';
  document.getElementById('ct-bf-subtype').value   = '';
  document.getElementById('ct-bf-subtype-group').style.display = 'none';
}

// ═══════════════════════════════════════════════════
//   DETAIL MODAL + STATUS TRANSITION
// ═══════════════════════════════════════════════════
let _detailKey  = null;
let _detailData = null;

function openDetailModal(key) {
  _detailKey = key;
  document.getElementById('dt-overlay').classList.add('show');
  document.getElementById('dt-key').textContent     = key;
  document.getElementById('dt-summary').textContent = 'Loading…';
  document.getElementById('dt-meta').textContent    = '—';
  document.getElementById('dt-ext').href            = '#';
  document.getElementById('dt-body').innerHTML      = '<div class="dt-loading">⏳ กำลังโหลดรายละเอียด…</div>';
  loadDetail(key);
}

function closeDetailModal() {
  document.getElementById('dt-overlay').classList.remove('show');
  _detailKey = null;
  _detailData = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('dt-overlay').classList.contains('show')) {
    closeDetailModal();
  }
});

async function loadDetail(key) {
  const res = await API.get(`/jira/issue-detail.php?key=${encodeURIComponent(key)}`);
  if (!res?.ok) {
    document.getElementById('dt-body').innerHTML =
      `<div class="dt-loading" style="color:#ef4444"><i data-icon="alert-triangle"></i> ${escHtml(res?.data?.message || 'โหลดไม่สำเร็จ')}</div>`;
    return;
  }
  _detailData = res.data.data;
  renderDetail(_detailData);
}

function renderDetail(d) {
  const f = d.fields || {};
  document.getElementById('dt-summary').textContent = f.summary || '—';
  document.getElementById('dt-ext').href = d.url;

  const status   = f.status?.name || 'Unknown';
  const statCat  = f.status?.statusCategory?.key || 'new';
  const created  = f.created ? new Date(f.created).toLocaleString('th-TH', {hour12:false}) : '—';
  const reporter = f.reporter?.displayName  || '—';
  const assignee = f.assignee?.displayName  || 'Unassigned';
  const itype    = f.issuetype?.name        || '';
  const priority = f.priority?.name         || '—';

  document.getElementById('dt-meta').textContent = `${itype} · เปิดโดย ${reporter} · ${created}`;

  // Status transition row
  const transHtml = (d.transitions || []).map(t => `
    <button class="dt-trans-btn" onclick="doTransition('${escHtml(t.id)}','${escHtml(t.name)}')">
      → ${escHtml(t.to_name)}
    </button>`).join('');

  // Custom fields display
  const cfRender = (label, val) => {
    if (val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length)) return '';
    let display;
    if (Array.isArray(val)) {
      display = val.map(v => `<span class="dt-multi-chip">${escHtml(typeof v === 'object' ? (v.value || v.name || JSON.stringify(v)) : v)}</span>`).join('');
    } else if (typeof val === 'object') {
      display = escHtml(val.value || val.name || JSON.stringify(val));
    } else {
      display = escHtml(String(val));
    }
    return `<dt>${escHtml(label)}</dt><dd>${display}</dd>`;
  };

  // Description (rendered HTML from Jira ADF if available)
  const descHtml = d.rendered?.description || '';

  // Map known custom fields
  const cfRows =
    cfRender('Business Unit',     f['customfield_17066']) +
    cfRender('TH Service',        f['customfield_17024']) +
    cfRender('TH Channel/Comp',   f['customfield_17023']) +
    cfRender('Detected by',       f['customfield_17016']) +
    cfRender('Caused by 3rd',     f['customfield_17238']) +
    cfRender('Fault Start',       f['customfield_17026'] ? new Date(f['customfield_17026']).toLocaleString('th-TH') : '');

  // Comment count
  const commentCount = (d.comments || []).length;
  const attachCount  = (d.attachments || []).length;

  // Comments timeline
  const cmtItems = (d.comments || []).map(c => {
    const t = c.created ? new Date(c.created).toLocaleString('th-TH', { hour12: false }) : '';
    const initials = (c.author || '?').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
    return `
      <div class="cmt-item">
        <div class="cmt-avatar">${c.avatar ? `<img src="${escHtml(c.avatar)}" alt="">` : escHtml(initials)}</div>
        <div class="cmt-content">
          <div class="cmt-head">
            <span class="name">${escHtml(c.author)}</span>
            <span class="time">${escHtml(t)}</span>
          </div>
          <div class="cmt-body">${c.body_html || ''}</div>
        </div>
      </div>`;
  }).join('');

  // Attachments grid
  const attHtml = (d.attachments || []).map(a => {
    const isImg = (a.mime || '').startsWith('image/');
    const sizeKb = a.size ? (a.size / 1024).toFixed(1) + ' KB' : '';
    return `
      <a class="att-card" href="${escHtml(a.url)}" target="_blank" title="${escHtml(a.filename)}">
        <div class="att-thumb">${isImg && a.thumb ? `<img src="${escHtml(a.thumb)}">` : (isImg ? '🖼' : '📎')}</div>
        <div class="att-name">${escHtml(a.filename)}</div>
        <div class="att-size">${escHtml(sizeKb)}</div>
      </a>`;
  }).join('');

  document.getElementById('dt-body').innerHTML = `
    <!-- LEFT: main info -->
    <div>
      <div class="dt-status-row">
        <span class="dt-status-current ${statCat}">${escHtml(status)}</span>
        ${transHtml ? '<span class="dt-trans-arrow">→</span>' + transHtml : '<span style="color:var(--text-muted);font-size:11px">ไม่มี transition ที่ใช้ได้</span>'}
      </div>

      <div class="dt-section-title"><i data-icon="clipboard"></i> Custom Fields</div>
      <dl class="dt-field-grid">
        ${cfRows || '<dd style="grid-column:1/-1;color:var(--text-muted);font-style:italic;font-size:11px">— ไม่มีข้อมูล —</dd>'}
      </dl>

      <div class="dt-section-title"><i data-icon="edit"></i> Description / Action</div>
      <div class="dt-desc">${descHtml || ''}</div>

      <div class="dt-section-title"><i data-icon="message-circle"></i> Comments (${commentCount})</div>
      <div class="cmt-list" id="cmt-list">
        ${cmtItems || '<div class="cmt-empty">ยังไม่มี comment — เพิ่มได้ด้านล่าง</div>'}
      </div>

      <!-- Composer -->
      <div class="cmt-composer">
        <div class="cmt-toolbar">
          <button type="button" class="cmt-btn" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" class="cmt-btn" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" class="cmt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
          <button type="button" class="cmt-btn" id="cmt-img-btn" title="แทรกรูป"><i data-icon="image"></i></button>
          <input type="file" id="cmt-img-input" accept="image/*" style="display:none">
        </div>
        <div class="cmt-editor" id="cmt-editor" contenteditable="true"
             data-placeholder="พิมพ์ comment ที่นี่… วางรูปด้วย Cmd+V ได้"></div>
        <div class="cmt-foot">
          <span class="cmt-hint">รูปจะถูก upload เป็น attachment + แทรกชื่อในเนื้อหา</span>
          <button class="se-btn primary" onclick="submitComment()" id="cmt-submit" style="font-size:11px;padding:6px 12px"><i data-icon="mail"></i> Send</button>
        </div>
      </div>
    </div>

    <!-- RIGHT: meta sidebar -->
    <div>
      <div class="dt-section-title"><i data-icon="user"></i> People</div>
      <dl class="dt-field-grid">
        <dt>Assignee</dt>
        <dd>
          <span class="as-trigger" onclick="openAssigneePicker(event)" title="คลิกเพื่อเปลี่ยน assignee">
            <span>${escHtml(assignee)}</span>
            <span class="edit-ico"><i data-icon="pencil"></i></span>
          </span>
        </dd>
        <dt>Reporter</dt><dd>${escHtml(reporter)}</dd>
        <dt>Priority</dt><dd>${escHtml(priority)}</dd>
      </dl>

      <div class="dt-section-title"><i data-icon="bar-chart"></i> Activity</div>
      <dl class="dt-field-grid">
        <dt>Created</dt><dd style="font-size:11px">${escHtml(created)}</dd>
        <dt>Comments</dt><dd>${commentCount}</dd>
        <dt>Attachments</dt><dd>${attachCount}</dd>
      </dl>

      ${attachCount ? `
        <div class="dt-section-title">📎 Attachments</div>
        <div class="att-grid">${attHtml}</div>
      ` : ''}
    </div>
  `;

  // Wire up composer
  initCommentComposer();
}

function initCommentComposer() {
  const editor = document.getElementById('cmt-editor');
  if (!editor) return;

  // Toolbar buttons
  document.querySelectorAll('.cmt-btn[data-cmd]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      document.execCommand(btn.dataset.cmd, false, null);
      editor.focus();
    });
  });

  // Image picker
  const imgBtn   = document.getElementById('cmt-img-btn');
  const imgInput = document.getElementById('cmt-img-input');
  imgBtn?.addEventListener('click', () => imgInput?.click());
  imgInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    insertImageFromFile(file);
    e.target.value = '';
  });

  // Paste images (Cmd+V)
  editor.addEventListener('paste', e => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type?.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) insertImageFromFile(file);
        return;
      }
    }
    // Plain text paste — strip rich formatting from external sources
    const text = e.clipboardData?.getData('text/plain');
    if (text && !e.clipboardData.types.includes('text/html')) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
  });

  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
  setupImageResize(editor);
}

function insertImageFromFile(file) {
  const r = new FileReader();
  r.onload = ev => {
    document.execCommand('insertHTML', false,
      `<img src="${ev.target.result}" data-pending-upload="1" data-name="${escHtml(file.name || 'paste.png')}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0">`);
  };
  r.readAsDataURL(file);
}

// Convert data: URL → Blob
function dataURLtoBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const bin  = atob(base64);
  const u8   = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

async function submitComment() {
  if (!_detailKey) return;
  const editor = document.getElementById('cmt-editor');
  const btn    = document.getElementById('cmt-submit');

  // Snapshot HTML, find pasted/inserted images
  const tmp = document.createElement('div');
  tmp.innerHTML = editor.innerHTML;
  const imgs = tmp.querySelectorAll('img[src^="data:image"]');

  const text = tmp.innerText.trim();
  if (!text && !imgs.length) {
    Toast.warning('พิมพ์ comment หรือแนบรูปก่อนส่ง');
    return;
  }

  btn.disabled = true; btn.textContent = '⏳ กำลังส่ง…';

  // 1. Upload all pasted images first
  const uploadedNames = [];
  let uploadFailed = false;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    const blob = dataURLtoBlob(img.src);
    const ext = (blob.type.split('/')[1] || 'png').split('+')[0];
    const fname = (img.dataset.name && img.dataset.name !== 'paste.png')
      ? img.dataset.name
      : `paste-${Date.now()}-${i+1}.${ext}`;

    btn.textContent = `⏳ Upload ${i+1}/${imgs.length}…`;

    const form = new FormData();
    form.append('key', _detailKey);
    form.append('file', blob, fname);

    const token = Auth.getToken();
    // Reuse api.js's already-resolved root — works with any deploy folder name.
    const apiBase = API_BASE;
    let json;
    try {
      const r = await fetch(`${apiBase}/jira/attach.php`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: form,
      });
      json = await r.json();
    } catch (e) {
      uploadFailed = true; break;
    }
    if (!json?.success) { uploadFailed = true; break; }
    uploadedNames.push(json.data.filename);
  }

  if (uploadFailed) {
    Toast.error('Upload รูปไม่สำเร็จ');
    btn.disabled = false; btn.innerHTML = '<i data-icon="mail"></i> Send';
    return;
  }

  // 2. Build final comment text — append attached file names
  let finalText = text;
  if (uploadedNames.length) {
    finalText = (finalText ? finalText + '\n\n' : '') + '<i data-icon="paperclip"></i> แนบไฟล์: ' + uploadedNames.join(', ');
  }

  // 3. Add comment
  btn.textContent = '⏳ Sending…';
  const res = await API.post('/jira/add-comment.php', {
    key:  _detailKey,
    body: finalText,
  });

  btn.disabled = false; btn.innerHTML = '<i data-icon="mail"></i> Send';

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'ส่ง comment ไม่สำเร็จ');
    return;
  }

  Toast.success(uploadedNames.length
    ? `เพิ่ม comment + ${uploadedNames.length} attachment แล้ว`
    : 'เพิ่ม comment แล้ว');

  // 4. Clear editor + reload detail
  editor.innerHTML = '';
  await loadDetail(_detailKey);
}

// ─── Themed confirm dialog (replaces window.confirm) ──
function confirmAction({ title = 'ยืนยัน', message = '', icon = '?', confirmLabel = 'ตกลง', cancelLabel = 'ยกเลิก' } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('cf-overlay');
    document.getElementById('cf-icon').textContent  = icon;
    document.getElementById('cf-title').textContent = title;
    document.getElementById('cf-msg').innerHTML     = message; // allow <b> for emphasis
    const btnOk = document.getElementById('cf-confirm');
    const btnNo = document.getElementById('cf-cancel');
    btnOk.textContent = confirmLabel;
    btnNo.textContent = cancelLabel;

    function done(val) {
      overlay.classList.remove('show');
      btnOk.removeEventListener('click', onOk);
      btnNo.removeEventListener('click', onNo);
      overlay.removeEventListener('click', onBack);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    }
    const onOk   = () => done(true);
    const onNo   = () => done(false);
    const onBack = e => { if (e.target === overlay) done(false); };
    const onKey  = e => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter')  done(true);
    };

    btnOk.addEventListener('click', onOk);
    btnNo.addEventListener('click', onNo);
    overlay.addEventListener('click', onBack);
    document.addEventListener('keydown', onKey);

    overlay.classList.add('show');
    setTimeout(() => btnOk.focus(), 100);
  });
}

/* ══════════════════════════════════════════════════════════
   TRANSITION FIELDS MODAL
══════════════════════════════════════════════════════════ */
function showTransitionFieldsModal(transitionName, fields) {
  return new Promise(resolve => {
    document.getElementById('tf-title').textContent   = `เปลี่ยนเป็น "${transitionName}"`;
    document.getElementById('tf-subtitle').textContent = `${_detailKey} — กรอกข้อมูลที่จำเป็นก่อนเปลี่ยนสถานะ`;

    const body = document.getElementById('tf-body');
    body.innerHTML = '';

    const userSelections = {}; // fieldId → accountId

    fields.forEach(f => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      lbl.className = 'tf-field-label';
      lbl.innerHTML = escHtml(f.name) + (f.required ? ' <span class="req">*</span>' : '');
      wrap.appendChild(lbl);

      const allowed = f.allowedValues || [];
      const isUser  = f.type === 'user' || f.fieldId === 'assignee';

      if (isUser) {
        // User search with autocomplete
        const sw  = document.createElement('div');  sw.className = 'tf-search-wrap';
        const inp = document.createElement('input'); inp.className = 'tf-input'; inp.type = 'text';
        inp.placeholder = 'พิมพ์ชื่อเพื่อค้นหา…'; inp.dataset.fieldId = f.fieldId;
        const res = document.createElement('div');  res.className = 'tf-search-results';
        let t;
        inp.addEventListener('input', () => {
          clearTimeout(t); delete userSelections[f.fieldId];
          const q = inp.value.trim();
          if (q.length < 2) { res.classList.remove('open'); return; }
          t = setTimeout(async () => {
            const r = await API.get(`/jira/users-search.php?q=${encodeURIComponent(q)}`);
            const users = r?.data?.users || [];
            res.innerHTML = users.length
              ? users.map(u => `<div class="tf-search-item" data-account="${escHtml(u.accountId)}" data-name="${escHtml(u.displayName)}">
                  ${escHtml(u.displayName)} <span style="color:var(--text-muted);font-size:10px">${escHtml(u.emailAddress||'')}</span>
                </div>`).join('')
              : '<div class="tf-search-item" style="color:var(--text-muted)">ไม่พบผู้ใช้</div>';
            res.classList.add('open');
          }, 300);
        });
        res.addEventListener('mousedown', e => {
          const item = e.target.closest('[data-account]');
          if (!item) return;
          inp.value = item.dataset.name;
          userSelections[f.fieldId] = item.dataset.account;
          res.classList.remove('open');
        });
        document.addEventListener('click', e => { if (!sw.contains?.(e.target)) res?.classList.remove('open'); });
        sw.append(inp, res); wrap.appendChild(sw);

      } else if (allowed.length > 0 && f.type !== 'array') {
        // Select dropdown
        const sel = document.createElement('select'); sel.className = 'tf-select'; sel.dataset.fieldId = f.fieldId;
        if (!f.required) sel.innerHTML = '<option value="">— ไม่ระบุ —</option>';
        allowed.forEach(av => {
          const opt = document.createElement('option');
          opt.value = av.value || av.id || '';
          opt.textContent = av.displayName || av.value || av.id || '';
          sel.appendChild(opt);
        });
        wrap.appendChild(sel);

      } else if (f.type === 'array' && allowed.length > 0) {
        // Checkbox list
        const list = document.createElement('div'); list.className = 'tf-checkbox-list';
        allowed.forEach(av => {
          const lbl2 = document.createElement('label'); lbl2.className = 'tf-checkbox-item';
          const cb   = document.createElement('input'); cb.type = 'checkbox';
          cb.value = av.value || av.id || ''; cb.dataset.fieldId = f.fieldId;
          lbl2.append(cb, document.createTextNode(' ' + (av.displayName || av.value || '')));
          list.appendChild(lbl2);
        });
        wrap.appendChild(list);

      } else if (f.type === 'date') {
        const inp = document.createElement('input'); inp.className = 'tf-input'; inp.type = 'date';
        inp.dataset.fieldId = f.fieldId;
        inp.value = new Date().toISOString().slice(0, 10);
        wrap.appendChild(inp);

      } else {
        const inp = document.createElement('input'); inp.className = 'tf-input'; inp.type = 'text';
        inp.dataset.fieldId = f.fieldId; inp.placeholder = f.name;
        wrap.appendChild(inp);
      }

      body.appendChild(wrap);
    });

    const overlay = document.getElementById('tf-overlay');
    const btnOk   = document.getElementById('tf-confirm');
    const btnNo   = document.getElementById('tf-cancel');

    function done(ok) {
      overlay.classList.remove('show');
      btnOk.removeEventListener('click', onOk);
      btnNo.removeEventListener('click', onNo);
      overlay.removeEventListener('click', onBack);
      document.removeEventListener('keydown', onKey);
      if (!ok) { resolve(null); return; }

      // Collect values in Jira format
      const vals = {};
      fields.forEach(f => {
        const allowed = f.allowedValues || [];
        if (f.type === 'user' || f.fieldId === 'assignee') {
          const aid = userSelections[f.fieldId];
          if (aid) vals[f.fieldId] = { accountId: aid };
        } else if (allowed.length > 0 && f.type !== 'array') {
          const sel = body.querySelector(`select[data-field-id="${f.fieldId}"]`);
          if (sel?.value) {
            const av = allowed.find(a => (a.value || a.id) === sel.value);
            vals[f.fieldId] = av?.id ? { id: av.id } : { value: sel.value };
          }
        } else if (f.type === 'array' && allowed.length > 0) {
          const checked = [...body.querySelectorAll(`input[type=checkbox][data-field-id="${f.fieldId}"]:checked`)];
          if (checked.length) vals[f.fieldId] = checked.map(cb => {
            const av = allowed.find(a => (a.value || a.id) === cb.value);
            return av?.id ? { id: av.id } : { value: cb.value };
          });
        } else {
          const inp = body.querySelector(`input[data-field-id="${f.fieldId}"]`);
          if (inp?.value.trim()) vals[f.fieldId] = inp.value.trim();
        }
      });
      resolve(vals);
    }

    const onOk   = () => done(true);
    const onNo   = () => done(false);
    const onBack = e => { if (e.target === overlay) done(false); };
    const onKey  = e => { if (e.key === 'Escape') done(false); };

    btnOk.addEventListener('click', onOk);
    btnNo.addEventListener('click', onNo);
    overlay.addEventListener('click', onBack);
    document.addEventListener('keydown', onKey);

    overlay.classList.add('show');
    setTimeout(() => body.querySelector('input,select')?.focus(), 80);
  });
}

async function doTransition(transitionId, transitionName) {
  if (!_detailKey) return;

  // Fetch required fields for this transition from Jira
  const fieldsRes  = await API.get(`/jira/transition-fields.php?key=${encodeURIComponent(_detailKey)}&transitionId=${encodeURIComponent(transitionId)}`);
  const formFields = (fieldsRes?.data?.fields || []).filter(f => f.required || f.allowedValues?.length > 0);

  let fieldValues = {};
  if (formFields.length > 0) {
    const result = await showTransitionFieldsModal(transitionName, formFields);
    if (result === null) return; // cancelled
    fieldValues = result;
  } else {
    const ok = await confirmAction({
      title: 'เปลี่ยนสถานะ',
      message: `คุณกำลังจะเปลี่ยน <b>${escHtml(_detailKey)}</b><br>เป็นสถานะ <b>"${escHtml(transitionName)}"</b>`,
      icon: '<i data-icon="refresh-cw"></i>', confirmLabel: 'เปลี่ยนสถานะ', cancelLabel: 'ยกเลิก',
    });
    if (!ok) return;
  }

  document.querySelectorAll('.dt-trans-btn').forEach(b => b.disabled = true);

  const res = await API.post('/jira/transition.php', {
    key:          _detailKey,
    transitionId: transitionId,
    fields:       Object.keys(fieldValues).length ? fieldValues : undefined,
  });

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    document.querySelectorAll('.dt-trans-btn').forEach(b => b.disabled = false);
    return;
  }

  Toast.success(`เปลี่ยนเป็น "${transitionName}" แล้ว`);
  await loadDetail(_detailKey);
  loadCases();
}

function emailFromDetail() {
  if (!_detailKey) return;
  const c = _allCases.find(x => x.key === _detailKey);
  if (!c) {
    Toast.warning('ยังไม่มีเคสนี้ใน list — ลอง refresh ก่อน');
    return;
  }
  closeDetailModal();
  selectCase(_detailKey);
}

// ═══════════════════════════════════════════════════
//   ASSIGNEE PICKER
// ═══════════════════════════════════════════════════
let _asSearchTimer = null;
let _asTrigger     = null;

function openAssigneePicker(e) {
  e.stopPropagation();
  _asTrigger = e.currentTarget;
  const pop  = document.getElementById('as-popover');
  const r    = _asTrigger.getBoundingClientRect();

  // Position below trigger; if off-screen on the right, align right edge
  const popW = 280;
  let left   = r.left;
  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  pop.style.top  = (r.bottom + window.scrollY + 6) + 'px';
  pop.style.left = (left + window.scrollX) + 'px';
  pop.classList.add('show');

  const inp = document.getElementById('as-search');
  inp.value = '';
  document.getElementById('as-list').innerHTML = '<div class="as-empty">พิมพ์เพื่อค้นหา…</div>';
  searchUsers('');
  setTimeout(() => inp.focus(), 50);
}

function closeAssigneePicker() {
  document.getElementById('as-popover').classList.remove('show');
  _asTrigger = null;
}

document.addEventListener('mousedown', e => {
  const pop = document.getElementById('as-popover');
  if (!pop?.classList.contains('show')) return;
  if (pop.contains(e.target) || e.target.closest('.as-trigger')) return;
  closeAssigneePicker();
});

document.getElementById('as-search')?.addEventListener('input', e => {
  clearTimeout(_asSearchTimer);
  const q = e.target.value;
  _asSearchTimer = setTimeout(() => searchUsers(q), 250);
});

async function searchUsers(q) {
  const list = document.getElementById('as-list');
  list.innerHTML = '<div class="as-empty">⏳ กำลังค้นหา…</div>';
  const res = await API.get(`/jira/users-search.php?q=${encodeURIComponent(q)}`);
  if (!res?.ok) {
    list.innerHTML = `<div class="as-empty"><i data-icon="alert-triangle"></i> ${escHtml(res?.data?.message || 'load failed')}</div>`;
    return;
  }
  const users = res.data.data || [];
  if (!users.length) {
    list.innerHTML = `<div class="as-empty">ไม่พบผู้ใช้</div>`;
  } else {
    list.innerHTML = users.map(u => {
      const initials = (u.displayName || '?').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
      return `
        <div class="as-row" onclick="assignTo('${escHtml(u.accountId)}','${escHtml(u.displayName).replace(/'/g, '&#39;')}')">
          <div class="av">${u.avatar ? `<img src="${escHtml(u.avatar)}">` : escHtml(initials)}</div>
          <div class="info">
            <div class="name">${escHtml(u.displayName)}</div>
            <div class="email">${escHtml(u.email || '')}</div>
          </div>
        </div>`;
    }).join('');
  }
  // Always show "unassign" option at bottom
  list.innerHTML += `
    <div class="as-row unassign" onclick="assignTo('', 'Unassigned')">
      <div class="av">∅</div>
      <div class="info"><div class="name">Unassign</div><div class="email">เอา assignee ออก</div></div>
    </div>`;
}

async function assignTo(accountId, displayName) {
  if (!_detailKey) return;
  closeAssigneePicker();

  const res = await API.post('/jira/assign.php', {
    key:       _detailKey,
    accountId: accountId || null,
  });

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'Assign ไม่สำเร็จ');
    return;
  }

  Toast.success(accountId ? `Assign ให้ ${displayName} แล้ว` : 'Unassign แล้ว');
  await loadDetail(_detailKey);
  loadCases(); // refresh list so assignee shows in case card too
}

// ─── Init ────────────────────────────────────────────
loadCases();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addChip", { configurable: true, get: () => addChip, set: (v) => { addChip = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "assignTo", { configurable: true, get: () => assignTo, set: (v) => { assignTo = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "caseSkeleton", { configurable: true, get: () => caseSkeleton, set: (v) => { caseSkeleton = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearAutoEmails", { configurable: true, get: () => clearAutoEmails, set: (v) => { clearAutoEmails = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeAllDropdowns", { configurable: true, get: () => closeAllDropdowns, set: (v) => { closeAllDropdowns = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeAssigneePicker", { configurable: true, get: () => closeAssigneePicker, set: (v) => { closeAssigneePicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeCreateModal", { configurable: true, get: () => closeCreateModal, set: (v) => { closeCreateModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeDetailModal", { configurable: true, get: () => closeDetailModal, set: (v) => { closeDetailModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeForm", { configurable: true, get: () => closeForm, set: (v) => { closeForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmAction", { configurable: true, get: () => confirmAction, set: (v) => { confirmAction = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dataURLtoBlob", { configurable: true, get: () => dataURLtoBlob, set: (v) => { dataURLtoBlob = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doTransition", { configurable: true, get: () => doTransition, set: (v) => { doTransition = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "emailFromDetail", { configurable: true, get: () => emailFromDetail, set: (v) => { emailFromDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "ensureCreateOptionsLoaded", { configurable: true, get: () => ensureCreateOptionsLoaded, set: (v) => { ensureCreateOptionsLoaded = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getOptionsFor", { configurable: true, get: () => getOptionsFor, set: (v) => { getOptionsFor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "highlight", { configurable: true, get: () => highlight, set: (v) => { highlight = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initCommentComposer", { configurable: true, get: () => initCommentComposer, set: (v) => { initCommentComposer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initTypeaheads", { configurable: true, get: () => initTypeaheads, set: (v) => { initTypeaheads = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "insertImageFromFile", { configurable: true, get: () => insertImageFromFile, set: (v) => { insertImageFromFile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadCases", { configurable: true, get: () => loadCases, set: (v) => { loadCases = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadDetail", { configurable: true, get: () => loadDetail, set: (v) => { loadDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onBfFileTypeChange", { configurable: true, get: () => onBfFileTypeChange, set: (v) => { onBfFileTypeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onFaultModeChange", { configurable: true, get: () => onFaultModeChange, set: (v) => { onFaultModeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onWorkTypeChange", { configurable: true, get: () => onWorkTypeChange, set: (v) => { onWorkTypeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openAssigneePicker", { configurable: true, get: () => openAssigneePicker, set: (v) => { openAssigneePicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreateModal", { configurable: true, get: () => openCreateModal, set: (v) => { openCreateModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDetailModal", { configurable: true, get: () => openDetailModal, set: (v) => { openDetailModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDropdown", { configurable: true, get: () => openDropdown, set: (v) => { openDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pollUntilCaseAppears", { configurable: true, get: () => pollUntilCaseAppears, set: (v) => { pollUntilCaseAppears = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCases", { configurable: true, get: () => renderCases, set: (v) => { renderCases = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderChipField", { configurable: true, get: () => renderChipField, set: (v) => { renderChipField = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderChips", { configurable: true, get: () => renderChips, set: (v) => { renderChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDetail", { configurable: true, get: () => renderDetail, set: (v) => { renderDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDropdown", { configurable: true, get: () => renderDropdown, set: (v) => { renderDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMulti", { configurable: true, get: () => renderMulti, set: (v) => { renderMulti = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetCreateForm", { configurable: true, get: () => resetCreateForm, set: (v) => { resetCreateForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "searchUsers", { configurable: true, get: () => searchUsers, set: (v) => { searchUsers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectCase", { configurable: true, get: () => selectCase, set: (v) => { selectCase = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendEmail", { configurable: true, get: () => sendEmail, set: (v) => { sendEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setSingle", { configurable: true, get: () => setSingle, set: (v) => { setSingle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showTransitionFieldsModal", { configurable: true, get: () => showTransitionFieldsModal, set: (v) => { showTransitionFieldsModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitComment", { configurable: true, get: () => submitComment, set: (v) => { submitComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitCreate", { configurable: true, get: () => submitCreate, set: (v) => { submitCreate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncFontSizeDropdown", { configurable: true, get: () => syncFontSizeDropdown, set: (v) => { syncFontSizeDropdown = v; } }); } catch (e) {}
})();
