// dashboard — page script, extracted from dashboard.html.
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
// dev_user has no access to the SOM dashboard — redirect to their own hub
if (Auth.getUser()?.role === 'dev_user') { window.location.replace('./dev-hub.html'); }
Layout.render('dashboard');
Announcements.init('view-dash');

// Update team roster label dynamically
const _rosterLbl = document.getElementById('team-roster-label');
if (_rosterLbl) {
  const _rUser = Auth.getUser();
  _rosterLbl.textContent = (_rUser?.team || 'sm').toUpperCase();
}

/* ══════════════════════════════════════════════════
   DASHBOARD — clock & greeting
══════════════════════════════════════════════════ */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'สวัสดีตอนเช้า <i data-icon="sun"></i>';
  if (h < 17) return 'สวัสดีตอนบ่าย 🌤️';
  return 'สวัสดีตอนเย็น <i data-icon="moon"></i>';
}

function updateClock() {
  const now  = new Date();
  const date = now.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const el = document.getElementById('date-display');
  if (el) el.innerHTML =
    `${date}<span style="margin:0 6px;opacity:.35">·</span><span style="font-variant-numeric:tabular-nums">${time}</span>`;
}

updateClock();
setInterval(updateClock, 1000);

/* ══════════════════════════════════════════════════
   📥 TEAM INBOX WIDGET
   ══════════════════════════════════════════════════ */
let _ibFilter = 'all';
let _ibSearch = '';
let _ibItems  = [];
let _ibActiveUid = null;
let _ibSearchTimer = null;

function renderDashEmailBody(container, rawHtml, uid, folder) {
  const token = Auth.getToken() || '';
  const base  = API_BASE;

  // Replace cid:xxx with proxy URL (browsers block cid: via CSP; proxy is 'self' → allowed)
  let html = rawHtml.replace(/\bcid:([^\s"'>\)]+)/gi, (match, cid) => {
    cid = cid.replace(/[;.,]+$/, '');
    return `${base}/inbox/cid.php?uid=${encodeURIComponent(uid)}&folder=${encodeURIComponent(folder || 'INBOX')}&cid=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}`;
  });

  // Sanitize
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  container.innerHTML = html;
}

function _ibSkeletonHTML(n = 5) {
  const widths = [
    ['42%','68%','55%'], ['35%','80%','48%'], ['50%','60%','72%'],
    ['38%','74%','50%'], ['44%','58%','65%'],
  ];
  return Array.from({ length: n }, (_, i) => {
    const [a, b, c] = widths[i % widths.length];
    return `<div class="ib-skel-row">
      <div class="ib-skel-top">
        <div class="skel-bone" style="height:10px;width:${a}"></div>
        <div class="skel-bone" style="height:9px;width:32px;animation-delay:.2s"></div>
      </div>
      <div class="skel-bone" style="height:10px;width:${b};animation-delay:.1s"></div>
      <div class="skel-bone" style="height:9px;width:${c};animation-delay:.25s"></div>
    </div>`;
  }).join('');
}

async function loadInbox() {
  const list = document.getElementById('ib-list');
  if (!list) return;
  list.innerHTML = _ibSkeletonHTML();

  const res = await API.inbox.list({ folder: 'INBOX', filter: _ibFilter, limit: 50 });
  if (!res?.ok) {
    list.innerHTML = `<div class="ib-empty" style="color:#ef4444"><i data-icon="alert-triangle"></i> ${escHtml(res?.data?.message || 'โหลดไม่สำเร็จ')}<br><br><span style="font-size:10px;font-style:normal">ตรวจสอบ: Mail credentials ใน Admin → Mail Config + เปิดใช้ Gmail IMAP + App Password</span></div>`;
    return;
  }

  _ibItems = res.data.data?.items || [];
  const unread = res.data.data?.unread || 0;
  const pill = document.getElementById('ib-unread-pill');
  if (unread > 0) {
    pill.textContent = `${unread} NEW`;
    pill.style.display = '';
  } else {
    pill.style.display = 'none';
  }
  renderInboxList();
}

function renderInboxList() {
  const list = document.getElementById('ib-list');
  const q = _ibSearch.toLowerCase().trim();
  const items = q
    ? _ibItems.filter(m =>
        (m.subject || '').toLowerCase().includes(q) ||
        (m.from?.name || '').toLowerCase().includes(q) ||
        (m.from?.email || '').toLowerCase().includes(q))
    : _ibItems;

  if (!items.length) {
    list.innerHTML = `<div class="ib-empty">${q ? 'ไม่พบ email ที่ตรงกับการค้นหา' : 'ไม่มี email ใน folder นี้'}</div>`;
    return;
  }

  list.innerHTML = items.map(m => {
    const time = m.date ? formatInboxTime(m.date) : '';
    const sender = m.from?.name || m.from?.email || '(unknown)';
    // Auto-detect [SMC-XXX] in subject and highlight
    const subjectHtml = escHtml(m.subject || '(no subject)')
      .replace(/\[(SMC-\d+)\]/g, '<span class="smc-link">[$1]</span>');
    const flags = [];
    if (m.flags?.flagged) flags.push('<span class="star">⭐</span>');
    return `
      <div class="ib-row ${m.flags?.seen ? '' : 'unread'} ${_ibActiveUid === m.uid ? 'active' : ''}"
           onclick="openMessage(${m.uid})">
        <div class="ib-row-top">
          <span class="ib-row-from">${escHtml(sender)}</span>
          <span class="ib-row-flags">${flags.join('')}</span>
          <span class="ib-row-time">${escHtml(time)}</span>
        </div>
        <div class="ib-row-subject">${subjectHtml}</div>
      </div>`;
  }).join('');
}

function formatInboxTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (diffMs < 7 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
}

function setInboxFilter(filter, btn) {
  _ibFilter = filter;
  document.querySelectorAll('.ib-filter').forEach(b => b.classList.toggle('active', b === btn));
  loadInbox();
}

document.getElementById('ib-search')?.addEventListener('input', e => {
  clearTimeout(_ibSearchTimer);
  _ibSearchTimer = setTimeout(() => {
    _ibSearch = e.target.value;
    renderInboxList();
  }, 200);
});

/* ── Slide-out Reader ── */
let _openMsg     = null;    // full opened message (for reply / forward)
let _composeMode = null;    // 'reply' | 'replyAll' | 'forward' | null

async function openMessage(uid) {
  // If user is in the middle of composing, ask before switching to a different email
  const reader = document.getElementById('ib-reader');
  if (reader.dataset.mode === 'compose') {
    const ok = await _confirmDiscardIfDirty();
    if (!ok) return;
    _switchToReadMode();
  }

  _ibActiveUid = uid;
  renderInboxList();   // re-render to show 'active' class

  reader.classList.add('show');
  document.getElementById('ib-reader-subj').textContent = 'Loading…';
  document.getElementById('ib-reader-from').textContent = '—';
  document.getElementById('ib-reader-to').textContent   = '—';
  document.getElementById('ib-reader-date').textContent = '—';
  document.getElementById('ib-reader-body').innerHTML   = '<div style="text-align:center;color:var(--text-muted);padding:40px">⏳ กำลังโหลดเนื้อหา…</div>';

  const res = await API.inbox.message('INBOX', uid);
  if (!res?.ok) {
    document.getElementById('ib-reader-body').innerHTML = `<div style="color:#ef4444;padding:20px"><i data-icon="alert-triangle"></i> ${escHtml(res?.data?.message || 'load failed')}</div>`;
    return;
  }
  const m = res.data.data;
  _openMsg = m;

  document.getElementById('ib-reader-subj').textContent = m.subject;
  const from = m.from?.name ? `${m.from.name} <${m.from.email}>` : (m.from?.email || '—');
  document.getElementById('ib-reader-from').textContent = from;
  document.getElementById('ib-reader-to').textContent   = (m.to || []).map(a => a.email).join(', ') || '—';
  document.getElementById('ib-reader-date').textContent = m.date ? new Date(m.date).toLocaleString('th-TH', { hour12: false }) : '—';

  // Replace cid: inline images + sanitize + render
  renderDashEmailBody(document.getElementById('ib-reader-body'), m.body || '<i>(empty)</i>', m.uid, m.folder || 'INBOX');

  // Mark this message as read in our local list
  const local = _ibItems.find(x => x.uid === uid);
  if (local) { local.flags.seen = true; renderInboxList(); }
}

async function closeReader() {
  const reader = document.getElementById('ib-reader');
  if (reader.dataset.mode === 'compose') {
    const ok = await _confirmDiscardIfDirty();
    if (!ok) return;
  }
  reader.classList.remove('show');
  _switchToReadMode();
  _openMsg = null;
  _ibActiveUid = null;
  renderInboxList();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const reader = document.getElementById('ib-reader');
  if (!reader?.classList.contains('show')) return;
  // Skip Escape when typing (avoid triggering discard confirm on every Esc keystroke)
  const t = e.target;
  if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
  closeReader();
});

/* ══════════════════════════════════════════════════
   COMPOSE (Reply / Reply All / Forward) — Mode A
   ══════════════════════════════════════════════════ */
function _switchToReadMode() {
  const reader = document.getElementById('ib-reader');
  reader.dataset.mode = 'read';
  document.getElementById('ib-mode-read').hidden    = false;
  document.getElementById('ib-mode-compose').hidden = true;
  _composeMode = null;
  if (_openMsg) document.getElementById('ib-reader-subj').textContent = _openMsg.subject || '—';
}

function _switchToComposeMode() {
  const reader = document.getElementById('ib-reader');
  reader.dataset.mode = 'compose';
  document.getElementById('ib-mode-read').hidden    = true;
  document.getElementById('ib-mode-compose').hidden = false;
}

function startCompose(mode) {
  if (!_openMsg) { Toast.warning('เปิด email ก่อนครับ'); return; }
  _composeMode = mode;

  const m = _openMsg;
  const label = { reply: 'Reply', replyAll: 'Reply All', forward: 'Forward' }[mode] || 'Compose';
  document.getElementById('ib-reader-subj').textContent = `${label}: ${m.subject || ''}`;

  const toEl   = document.getElementById('cx-to');
  const ccEl   = document.getElementById('cx-cc');
  const subjEl = document.getElementById('cx-subject');
  const bodyEl = document.getElementById('cx-body');

  toEl.value = ccEl.value = subjEl.value = '';
  bodyEl.innerHTML = '';

  const myEmail = (Auth.getUser?.() || {}).email || '';

  if (mode === 'reply') {
    toEl.value = m.reply_to?.[0]?.email || m.from?.email || '';
    subjEl.value = /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`;
    bodyEl.innerHTML = _buildQuote(m);
  } else if (mode === 'replyAll') {
    const replyTo = m.reply_to?.[0]?.email || m.from?.email || '';
    const others = (m.to || []).map(a => a.email).filter(e => e && e !== myEmail && e !== replyTo);
    toEl.value = [replyTo, ...others].filter(Boolean).join(', ');
    ccEl.value = (m.cc || []).map(a => a.email).filter(e => e && e !== myEmail).join(', ');
    subjEl.value = /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`;
    bodyEl.innerHTML = _buildQuote(m);
  } else if (mode === 'forward') {
    subjEl.value = /^fwd:/i.test(m.subject || '') ? m.subject : `Fwd: ${m.subject || ''}`;
    bodyEl.innerHTML = _buildForwardBody(m);
  }

  _switchToComposeMode();
  _cxUpdatePlaceholder();
  setupImageResize(bodyEl);      // shared helper from utils.js
  document.getElementById('cx-status').textContent = '';
  document.getElementById('cx-send-btn').disabled = false;

  if (mode === 'forward') toEl.focus(); else bodyEl.focus();
}

async function cancelCompose() {
  const ok = await _confirmDiscardIfDirty();
  if (!ok) return;
  _switchToReadMode();
}

async function _confirmDiscardIfDirty() {
  const bodyEl = document.getElementById('cx-body');
  const dirty = (
    (document.getElementById('cx-to')?.value || '').trim() ||
    (document.getElementById('cx-cc')?.value || '').trim() ||
    (bodyEl?.textContent || '').trim() ||
    bodyEl?.querySelector('img')
  );
  if (!dirty) return true;
  return confirmDialog(
    'ข้อความที่พิมพ์จะหายไป ยืนยันยกเลิก draft?',
    'ยกเลิก draft?',
    { confirmText: 'ยกเลิก draft', cancelText: 'เขียนต่อ', variant: 'danger' }
  );
}

async function sendCompose() {
  const to      = document.getElementById('cx-to').value.trim();
  const cc      = document.getElementById('cx-cc').value.trim();
  const subject = document.getElementById('cx-subject').value.trim();
  const bodyEl  = document.getElementById('cx-body');
  let   body    = bodyEl.innerHTML.trim();

  if (!to)      { Toast.warning('ใส่ To ก่อนครับ'); return; }
  if (!subject) { Toast.warning('ใส่ Subject ก่อนครับ'); return; }
  if (!bodyEl.textContent.trim() && !bodyEl.querySelector('img')) {
    Toast.warning('ใส่เนื้อหาก่อนครับ'); return;
  }

  const btn    = document.getElementById('cx-send-btn');
  const status = document.getElementById('cx-status');
  btn.disabled = true;
  status.textContent = '⏳ กำลังส่ง…';
  status.style.color = '';

  // Convert proxy/blob image URLs → data URIs so PHP embeds them as CID attachments
  body = await _normalizeImagesForSend(body);

  const payload = { to, cc, subject, body, is_html: true };
  if (_openMsg && (_composeMode === 'reply' || _composeMode === 'replyAll') && _openMsg.message_id) {
    payload.in_reply_to = _openMsg.message_id;
    payload.references  = _openMsg.message_id;
  }

  const res = await API.inbox.send(payload);
  btn.disabled = false;

  if (!res?.ok) {
    status.textContent = '⚠ ส่งไม่สำเร็จ: ' + (res?.data?.message || 'unknown error');
    status.style.color = '#ef4444';
    return;
  }
  status.textContent = '';
  Toast.success('📤 ส่ง Email สำเร็จ!');
  _switchToReadMode();
}

/* ══════════════════════════════════════════════════
   SMC BRIDGE (Phase 2.2) — email → Jira SMC ticket
   ══════════════════════════════════════════════════ */
const _SMC_FID = {
  detected: 'customfield_17016',
  bu:       'customfield_17066',
  svc:      'customfield_17024',
  chn:      'customfield_17023',
  thirdp:   'customfield_17238',
  fault:    'customfield_17026',
};
let _smcOptions = null;   // cached options from /jira/field-options.php

async function openSmcModal() {
  if (!_openMsg) { Toast.warning('เปิด email ก่อนครับ'); return; }

  const modal  = document.getElementById('smc-modal');
  const body   = document.getElementById('smc-body');
  const status = document.getElementById('smc-status');
  const submit = document.getElementById('smc-submit');
  status.textContent = '';
  status.style.color = '';
  submit.disabled = false;
  submit.textContent = '🚀 สร้าง Ticket';

  // Pre-fill Summary + Description from the open email
  const m = _openMsg;
  const cleanSubject = (m.subject || '').replace(/\s*\[SMC-\d+\]\s*/gi, '').trim();
  document.getElementById('smc-summary').value = cleanSubject;

  const from = m.from?.name ? `${m.from.name} <${m.from.email || ''}>` : (m.from?.email || '');
  const dt   = m.date ? new Date(m.date).toLocaleString('th-TH', { hour12: false }) : '';
  const bodyText = (m.plain || m.subject || '').trim();
  const desc = `${bodyText}\n\n─── จาก email ───\nจาก: ${from}\nวันที่: ${dt}\nเรื่อง: ${m.subject || ''}`;
  document.getElementById('smc-description').value = desc.slice(0, 4000);

  modal.classList.add('active');

  // Load options once, cache for subsequent opens
  if (!_smcOptions) {
    body.classList.add('loading');
    status.textContent = '⏳ โหลด field options จาก Jira…';
    const res = await API.jira.fieldOptions();
    body.classList.remove('loading');
    if (!res?.ok) {
      status.textContent = '⚠ โหลด options ไม่สำเร็จ: ' + (res?.data?.message || 'unknown');
      status.style.color = '#ef4444';
      return;
    }
    _smcOptions = res.data.data || {};
    status.textContent = '';
    populateSmcSelects();
  } else {
    populateSmcSelects();
  }
}

function populateSmcSelects() {
  const fill = (id, fid, includeEmpty = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    const opts = _smcOptions?.[fid]?.options || [];
    const emptyOpt = includeEmpty
      ? '<option value="">— ไม่ระบุ —</option>'
      : '<option value="">— เลือก —</option>';
    el.innerHTML = emptyOpt +
      opts.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');
    // Sensible default: pre-select "Email" or "SM" for Detected by if present
    if (id === 'smc-detected') {
      const pref = opts.find(o => /email/i.test(o)) || opts.find(o => /\bsm\b|service\s*monitoring/i.test(o));
      if (pref) el.value = pref;
    }
  };
  fill('smc-detected', _SMC_FID.detected);
  fill('smc-bu',       _SMC_FID.bu);
  fill('smc-svc',      _SMC_FID.svc);
  fill('smc-chn',      _SMC_FID.chn);
  fill('smc-thirdp',   _SMC_FID.thirdp, true);
}

function closeSmcModal() {
  document.getElementById('smc-modal').classList.remove('active');
}

async function submitSmcTicket() {
  const summary  = document.getElementById('smc-summary').value.trim();
  const desc     = document.getElementById('smc-description').value.trim();
  const it       = document.getElementById('smc-issuetype').value || 'Task';
  const detected = document.getElementById('smc-detected').value;
  const bu       = document.getElementById('smc-bu').value;
  const svc      = document.getElementById('smc-svc').value;
  const chn      = document.getElementById('smc-chn').value;
  const thirdp   = document.getElementById('smc-thirdp').value;

  if (!summary)  { Toast.warning('กรอก Summary'); return; }
  if (!detected) { Toast.warning('เลือก Detected by'); return; }
  if (!bu)       { Toast.warning('เลือก Business Unit'); return; }
  if (!svc)      { Toast.warning('เลือก TH Service'); return; }
  if (!chn)      { Toast.warning('เลือก TH Channel / Component'); return; }

  const fields = {
    issuetype: it,
    [_SMC_FID.detected]: detected,
    [_SMC_FID.bu]:       bu,
    [_SMC_FID.svc]:      svc,
    [_SMC_FID.chn]:      chn,
    [_SMC_FID.fault]:    'auto',
  };
  if (thirdp) fields[_SMC_FID.thirdp] = thirdp;

  const submit = document.getElementById('smc-submit');
  const status = document.getElementById('smc-status');
  submit.disabled = true;
  const origLabel = submit.textContent;
  submit.textContent = '⏳ Creating…';
  status.textContent = '';
  status.style.color = '';

  const res = await API.jira.createTicket({ summary, description: desc, fields });

  submit.disabled = false;
  submit.textContent = origLabel;

  if (!res?.ok) {
    status.textContent = '⚠ สร้างไม่สำเร็จ: ' + (res?.data?.message || 'unknown error');
    status.style.color = '#ef4444';
    return;
  }

  const key = res.data.data?.issue_key || res.data.data?.key || '';
  const url = res.data.data?.issue_url || (key ? `https://truemoney.atlassian.net/browse/${key}` : '');
  if (key && url) {
    // Rich toast: clickable ticket key (Toast.show accepts HTML in the message)
    Toast.success(
      `<i data-icon="check-circle"></i> สร้างสำเร็จ: <a href="${escHtml(url)}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;font-weight:800">${escHtml(key)}</a> — คลิกเพื่อเปิด Jira`,
      6000
    );
  } else {
    Toast.success('✅ สร้าง SMC ticket สำเร็จ');
  }
  closeSmcModal();
}

// Wire button in reader action bar
function smcBridgePlaceholder() { openSmcModal(); }

// Esc closes SMC modal (but not while typing in a field)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('smc-modal');
  if (!modal?.classList.contains('active')) return;
  const t = e.target;
  if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT') return;
  closeSmcModal();
});

/* ── Rich-text editor commands ── */
function cxExec(command, value = null) {
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(command, false, value);
  const b = document.getElementById('cx-body');
  b?.focus();
  _cxUpdatePlaceholder();
}
function cxInsertLink() {
  const sel = window.getSelection();
  const selectedText = sel && !sel.isCollapsed ? sel.toString() : '';
  const url = window.prompt('URL:', 'https://');
  if (!url) return;
  if (selectedText) {
    cxExec('createLink', url);
  } else {
    document.execCommand('insertHTML', false,
      `<a href="${url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener">${escHtml(url)}</a>`);
    _cxUpdatePlaceholder();
  }
}
function cxInsertImageFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    document.execCommand('insertHTML', false, `<img src="${r.result}" style="max-width:60%">`);
    _cxUpdatePlaceholder();
    setupImageResize(document.getElementById('cx-body'));
  };
  r.readAsDataURL(file);
}
function _cxUpdatePlaceholder() {
  const el = document.getElementById('cx-body');
  if (!el) return;
  const empty = !el.textContent.trim() && !el.querySelector('img');
  el.dataset.empty = empty ? 'true' : 'false';
}

/* ── Paste / Drop image handlers (attached once) ── */
(function bindComposeInputHandlers() {
  const body = document.getElementById('cx-body');
  if (!body) return;
  body.addEventListener('input', _cxUpdatePlaceholder);
  body.addEventListener('paste', e => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        cxInsertImageFile(item.getAsFile());
        return;
      }
    }
    // otherwise let browser paste text/html normally
    setTimeout(_cxUpdatePlaceholder, 0);
  });
  body.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) {
      e.preventDefault();
      cxInsertImageFile(f);
    }
  });
  body.addEventListener('dragover', e => e.preventDefault());
})();

/* ── Quote / Forward body builders (adapted from inbox.html) ── */
function _renderCidsForQuote(html, cidMap, uid, folder) {
  const token = Auth.getToken() || '';
  const base  = API_BASE;
  return (html || '').replace(/\bcid:([^\s"'>\)]+)/gi, (_m, cid) => {
    cid = cid.replace(/[;.,]+$/, '');
    if (cidMap && cidMap[cid])  return cidMap[cid];
    const bare = cid.replace(/@.*$/, '');
    if (cidMap && cidMap[bare]) return cidMap[bare];
    return `${base}/inbox/cid.php?uid=${encodeURIComponent(uid)}&folder=${encodeURIComponent(folder || 'INBOX')}&cid=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}`;
  });
}
function _buildQuote(m) {
  const dt   = m.date ? new Date(m.date).toLocaleString('th-TH', { hour12: false }) : '';
  const from = m.from?.name ? `${escHtml(m.from.name)} &lt;${escHtml(m.from.email || '')}&gt;` : escHtml(m.from?.email || '');
  const raw  = m.is_html ? (m.body || '') : `<pre style="white-space:pre-wrap">${escHtml(m.plain || m.body || '')}</pre>`;
  const body = m.is_html ? _renderCidsForQuote(raw, m.cid_map, m.uid, m.folder || 'INBOX') : raw;
  return `<br><br><blockquote>
    <p style="font-size:12px;margin:0 0 4px">On ${escHtml(dt)}, ${from} wrote:</p>
    ${body}
  </blockquote>`;
}
function _buildForwardBody(m) {
  const dt   = m.date ? new Date(m.date).toLocaleString('th-TH', { hour12: false }) : '';
  const from = m.from?.name ? `${escHtml(m.from.name)} &lt;${escHtml(m.from.email || '')}&gt;` : escHtml(m.from?.email || '');
  const raw  = m.is_html ? (m.body || '') : `<pre style="white-space:pre-wrap">${escHtml(m.plain || m.body || '')}</pre>`;
  const body = m.is_html ? _renderCidsForQuote(raw, m.cid_map, m.uid, m.folder || 'INBOX') : raw;
  return `<br><br><hr>
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 6px">
      <b>---------- Forwarded message ---------</b><br>
      From: ${from}<br>
      Date: ${escHtml(dt)}<br>
      Subject: ${escHtml(m.subject || '')}<br>
      To: ${(m.to || []).map(a => escHtml(a.email || '')).join(', ')}
    </p>
    ${body}`;
}
async function _normalizeImagesForSend(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const imgs = tmp.querySelectorAll('img[src]');
  if (!imgs.length) return html;
  await Promise.all([...imgs].map(async img => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    try {
      const resp = await fetch(src);
      if (!resp.ok) return;
      const blob    = await resp.blob();
      const dataUri = await new Promise(r => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
      img.setAttribute('src', dataUri);
    } catch (_) { /* leave as-is on failure */ }
  }));
  return tmp.innerHTML;
}

loadInbox();
// Auto-refresh every 60s when tab is visible
setInterval(() => { if (!document.hidden && document.getElementById('ib-list')) loadInbox(); }, 60_000);

/* ── Stats + mixed activity feed ── */
const _dashIsAdmin = ['super_admin', 'sm_admin', 'dev_sm'].includes(Auth.getUser?.()?.role);

async function loadStats() {
  // Fetch board posts and activity logs for the feed
  const boardRes  = await API.board.list('', '', '', 500, 0);
  const logRes    = await API.get('/log/feed.php?limit=30');

  // Render activity feed
  if (boardRes?.ok) {
    const _bd   = boardRes.data.data;
    const posts = Array.isArray(_bd) ? _bd : (_bd?.items || []);
    renderMixedFeed(posts, logRes?.data?.data?.items || []);
  } else {
    renderFeedError(boardRes?.data?.message || 'ไม่สามารถโหลดข้อมูลได้');
  }

  const ts = new Date().toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'});
  document.getElementById('feed-refreshed').textContent = ts;
}

/* ── Mixed activity feed ── */
// Actions from activity log we want to show in feed
const FEED_LOG_ACTIONS = new Set([
  'jira_create_ticket', 'email_sent', 'inbox_sent', 'noti_chat_sent',
  'board_create', 'board_pin', 'test_service_submitted', 'batch_report_submitted',
  // Learning — celebrate phase passes (failed attempts hidden on purpose)
  'course_phase_passed',
  'course_create', 'course_phase_create', 'course_lesson_create', 'course_quiz_save',
]);

function renderMixedFeed(boardPosts, logItems) {
  const feedEl = document.getElementById('recent-feed');
  if (!feedEl) return;
  const items  = [];

  // Board posts → feed entries
  boardPosts.slice(0, 20).forEach(p => {
    items.push({
      ts:    p.created_at,
      dot:   p.pinned ? 'fd-pinned' : 'fd-board',
      tag:   p.pinned ? ['ft-pinned','Board · Pinned'] : ['ft-board','Board'],
      title: p.title,
      meta:  escHtml(p.author_name),
      link:  './board.html',
      cat:   p.board_type_name || '',
    });
  });

  // Activity log entries (admin only)
  // Pre-filter: for 'course_phase_passed', keep only latest per user_id
  // (so if someone passes multiple phases in a row, we only show the most recent one)
  const seenPassUsers = new Set();
  const passFiltered = logItems.filter(e => {
    if (e.action !== 'course_phase_passed') return true;
    const uid = e.user_id || e.user_name || '';
    if (seenPassUsers.has(uid)) return false;
    seenPassUsers.add(uid);
    return true;
  });

  passFiltered.filter(e => FEED_LOG_ACTIONS.has(e.action)).forEach(e => {
    const d = e.detail || {};
    let dot, tag, title, cat = '';
    switch (e.action) {
      case 'jira_create_ticket':
        dot   = 'fd-jira'; tag = ['ft-jira','Jira'];
        title = `${d.issue_key ? '[' + d.issue_key + '] ' : ''}${d.summary || 'Ticket created'}`;
        break;
      case 'email_sent':
        dot   = 'fd-email'; tag = ['ft-email','Email'];
        title = `ส่ง Email: ${d.subject || '—'}`;
        cat   = d.to ? `ถึง ${d.to.split(',')[0]}${d.to.includes(',') ? ' +' + (d.to.split(',').length - 1) : ''}` : '';
        break;
      case 'noti_chat_sent':
        dot   = 'fd-chat'; tag = ['ft-chat','Chat'];
        title = `Noti ส่งแล้ว: ${d.title || d.name || 'Scheduled notification'}`;
        break;
      case 'board_pin':
        dot   = 'fd-pinned'; tag = ['ft-pinned','Pinned'];
        title = d.title || 'Post pinned';
        break;
      case 'inbox_sent':
        dot   = 'fd-inbox'; tag = ['ft-inbox','Team Inbox'];
        title = `ส่งเมล์: ${d.subject || '—'}`;
        cat   = d.to ? `ถึง ${d.to.split(',')[0]}${d.to.includes(',') ? ' +' + (d.to.split(',').length - 1) : ''}` : '';
        break;
      case 'test_service_submitted':
        dot   = 'fd-test'; tag = ['ft-test','Test Service'];
        title = `ทดสอบ: ${d.service || d.name || 'Service test'}`;
        cat   = d.env ? d.env : '';
        break;
      case 'batch_report_submitted':
        dot   = 'fd-batch'; tag = ['ft-batch','Batch'];
        title = `Batch report: ${d.name || d.batch_name || 'Batch submitted'}`;
        cat   = d.date || '';
        break;
      case 'course_phase_passed': {
        dot = 'fd-pass'; tag = ['ft-pass','Learning'];
        // Build title: "🎉 ผ่าน P3 <phase title>" + course in cat
        const cleanPhase = (d.phase_title || '').replace(/^Phase\s*\d+\s*[—-]\s*/i, '');
        const phaseLbl = d.phase_order ? `P${d.phase_order}` : 'Phase';
        title = `🎉 ผ่าน ${phaseLbl}${cleanPhase ? ' · ' + cleanPhase : ''}${d.score != null ? ' (' + d.score + '%)' : ''}`;
        cat   = d.course_title || '';
        break;
      }
      case 'course_create':
        dot   = 'fd-course'; tag = ['ft-course','Course'];
        title = `สร้างคอร์สใหม่: ${d.title || ''}`;
        break;
      case 'course_phase_create':
        dot   = 'fd-course'; tag = ['ft-course','Course'];
        title = `เพิ่ม Phase: ${d.title || ''}`;
        break;
      case 'course_lesson_create':
        dot   = 'fd-course'; tag = ['ft-course','Course'];
        title = `เพิ่มบทเรียนใหม่`;
        break;
      case 'course_quiz_save':
        dot   = 'fd-course'; tag = ['ft-course','Course'];
        title = `บันทึก Quiz${d.count != null ? ' (' + d.count + ' ข้อ)' : ''}`;
        break;
      default:
        return;
    }
    items.push({ ts: e.ts, dot, tag, title, meta: escHtml(e.user_name || ''), link: null, cat });
  });

  if (!items.length) {
    feedEl.innerHTML = `<div class="feed-empty">ยังไม่มีกิจกรรม — <a href="./board.html">สร้างโพสต์แรก</a></div>`;
    return;
  }

  // Sort newest first, deduplicate by title+ts window
  items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  const seen = new Set();
  const deduped = items.filter(x => {
    const key = x.title.slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  feedEl.innerHTML = deduped.slice(0, 15).map(x => `
    <div class="feed-item"${x.link ? ` onclick="location.href='${x.link}'" style="cursor:pointer"` : ''}>
      <div class="feed-type-dot ${x.dot}"></div>
      <div style="flex:1;min-width:0">
        <div class="feed-title">${escHtml(x.title)}</div>
        <div class="feed-meta">
          ${x.meta ? escHtml(x.meta) + ' · ' : ''}
          ${x.ts ? DateTime.timeAgo(x.ts) : ''}
          ${x.cat ? ` · <span style="color:var(--orange)">${escHtml(x.cat)}</span>` : ''}
          ${x.tag ? `<span class="feed-type-tag ${x.tag[0]}">${x.tag[1]}</span>` : ''}
        </div>
      </div>
    </div>`).join('');
}

function renderFeedError(msg) {
  const feedEl = document.getElementById('recent-feed');
  if (!feedEl) return;
  feedEl.innerHTML = `
    <div class="err-state">
      <div class="err-state-icon">⚠️</div>
      <div class="err-state-msg">โหลดข้อมูลไม่สำเร็จ<br><span style="font-size:10px;opacity:.7">${escHtml(msg)}</span></div>
      <button class="err-state-retry" onclick="retryFeed()">↺ ลองอีกครั้ง</button>
    </div>`;
}

function retryFeed() {
  document.getElementById('recent-feed').innerHTML = Skeleton.feed(7);
  loadStats();
}

/* ── Online Now panel ── */
const _ON_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
function _onAvaColor(uid) {
  let h = 0;
  for (const c of String(uid)) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return _ON_PALETTE[Math.abs(h) % _ON_PALETTE.length];
}
function _onInitials(n) {
  if (!n) return '?';
  const w = n.trim().split(/\s+/);
  return (w[0][0] + (w[1]?.[0] || '')).toUpperCase();
}
const ROOM_LABELS = {
  lobby:'🏠 Lobby', board:'📋 Board', sheets:'📄 Team Docs',
  admin:'⚙️ Admin', break_room:'☕ Break Room',
};

loadStats();
setInterval(() => { if (!document.hidden) loadStats(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStats(); });


/* ══════════════════════════════════════════════════
   LEARNING HERO (น้องส้ม)
══════════════════════════════════════════════════ */
async function loadLearningHero() {
  const hero = document.getElementById('learn-hero');
  if (!hero) return;

  // Skip entirely for external users
  const _u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
  if (_u && _u.role === 'external') return;

  let res;
  try {
    res = await API.get('/dashboard/learning-status.php');
  } catch (e) { return; }
  if (!res?.ok) return;
  const d = res.data?.data || res.data;
  if (!d || d.enabled === false) return;

  const act = d.next_action || {};
  const onb = d.onboarding   || {};
  const courses = Array.isArray(d.courses) ? d.courses : [];

  hero.dataset.mood = act.mascot_mood || 'wave';

  // ── Title (highlight Chapter N / percent / N/N tokens in orange) ──
  const rawTitle = act.title || 'Learning Sprint';
  const highlighted = escHtml(rawTitle)
    .replace(/(Chapter\s+\d+|Ch\.?\s*\d+|บทที่\s*\d+|\d+%|\d+\/\d+)/i, '<b>$1</b>');
  document.getElementById('lh-title').innerHTML = highlighted;
  document.getElementById('lh-msg').textContent = act.message || '';

  // ── CTA ──
  const cta = document.getElementById('lh-cta');
  cta.href = act.target_url || './learn.html';
  document.getElementById('lh-cta-label').textContent = act.cta_label || 'ไปต่อ';

  // ── Bucketise courses into 3 Kanban columns ──
  const todo = [], wip = [], done = [];

  // If onboarding is not yet done, drop a synthetic "onboarding" ticket in WIP
  if (!onb.is_done && (onb.total_tasks || 0) > 0) {
    wip.push({
      title: `Onboarding · ${onb.done_tasks || 0}/${onb.total_tasks || 0} tasks`,
      icon: '<i data-icon="check-circle"></i>',
      badge: 'ONB', badgeCls: 'med',
      pct: onb.percent || 0,
      locked: false, active: true,
    });
  }

  let ticketIdx = 0;
  courses.forEach(c => {
    const isSoon = c.status === 'coming_soon';
    const card = {
      title: c.title || 'Untitled',
      icon:  c.icon || '<i data-icon="book"></i>',
      badge: isSoon ? 'SOON' : ('#' + String(++ticketIdx).padStart(2, '0')),
      badgeCls: isSoon ? 'soon' : '',
      pct: c.percent || 0,
      locked: !!c.locked,
      soon:   isSoon,
      active: false,
    };
    if (c.status === 'completed') done.push(card);
    else if (c.status === 'in_progress' || (c.percent > 0 && c.percent < 100 && !isSoon)) {
      card.active = true; wip.push(card);
    } else {
      // not_started | locked | coming_soon → all live in "To Learn"
      todo.push(card);
    }
  });

  // Sidebar tag + big percent (exclude "coming soon" from the total so 100% still
  // means "100% of published courses done", not diluted by draft cards).
  const realTodo = todo.filter(c => !c.soon).length;
  const totalC   = realTodo + wip.length + done.length;
  const doneC    = done.length;
  const coursePct = totalC ? Math.round((doneC / totalC) * 100) : 0;
  const showOnb = !onb.is_done && (onb.total_tasks || 0) > 0;
  const bigPct   = showOnb ? (onb.percent || 0) : coursePct;
  document.getElementById('lh-pct-n').textContent = bigPct;
  document.getElementById('lh-pct-label').textContent = showOnb ? 'onboarding' : 'courses done';
  document.getElementById('lh-tag').textContent = showOnb ? 'Sprint · Onboarding' : 'Sprint · Learning';

  // Render one card row
  const renderCard = (c, variant) => {
    // variant: 'active' | 'done' | 'locked' | ''
    const extraCls = c.soon ? ' soon'
                   : (c.locked && variant !== 'done' ? ' locked' : '');
    const cls = 'lh-card' + (variant ? ' ' + variant : '') + extraCls;
    let metaRight = '';
    if (c.soon) {
      metaRight = '<span class="lock-ic"><i data-icon="clock"></i></span>';
    } else if (c.locked) {
      metaRight = '<span class="lock-ic"><i data-icon="lock"></i></span>';
    } else if (variant !== 'done' && c.pct > 0 && c.pct < 100) {
      metaRight = `<span class="pct">${c.pct}%</span>`;
    }
    const badgeCls = c.soon ? ' soon'
                   : c.locked ? ' lock'
                   : variant === 'done' ? ' easy'
                   : variant === 'active' ? ' med'
                   : (c.badgeCls ? ' ' + c.badgeCls : '');
    const badgeText = c.soon ? 'SOON' : c.locked ? 'LOCK' : c.badge;
    return `<div class="${cls}">
      <div class="lh-card-title"><span class="ic">${renderIcon(c.icon)}</span><span class="tx">${escHtml(c.title)}</span></div>
      <div class="lh-card-meta"><span class="lh-badge${badgeCls}">${escHtml(badgeText)}</span>${metaRight}</div>
    </div>`;
  };

  // Render one column (cap at 3 visible, tail "+N more")
  const CAP = 3;
  const renderCol = (arr, bodyId, cntId, variant) => {
    document.getElementById(cntId).textContent = arr.length;
    const body = document.getElementById(bodyId);
    if (!arr.length) { body.innerHTML = '<div class="lh-col-empty">— empty —</div>'; return; }
    const html = arr.slice(0, CAP).map(c => renderCard(c, c.active ? 'active' : variant)).join('');
    const more = arr.length > CAP ? `<div class="lh-col-empty">+${arr.length - CAP} more</div>` : '';
    body.innerHTML = html + more;
  };
  renderCol(todo, 'lh-col-todo', 'lh-col-todo-n', '');
  renderCol(wip,  'lh-col-wip',  'lh-col-wip-n',  'active');
  renderCol(done, 'lh-col-done', 'lh-col-done-n', 'done');

  // Ask icon system to swap fresh <i data-icon> tags → SVG (MutationObserver may lag)
  if (window.Icons && typeof window.Icons.replaceAll === 'function') window.Icons.replaceAll(hero);

  hero.hidden = false;
}

/* ══════════════════════════════════════════════════
   PROMO CAROUSEL — rotates learning hero + feature promos
══════════════════════════════════════════════════ */
const PROMO_TYPE_ICON = { info: '💡', notice: '📢', success: '🎉', warn: '⚠️', alert: '🚨' };

const PromoCarousel = {
  idx: 0, timer: null, slides: [],

  async init() {
    const promo = document.getElementById('promo');
    const track = document.getElementById('promo-track');
    if (!promo || !track) return;

    // Drop the learning slide if the hero didn't load (external / dismissed / no data)
    const hero = document.getElementById('learn-hero');
    const learnSlide = track.querySelector('[data-slide="learn"]');
    if (learnSlide && (!hero || hero.hidden)) learnSlide.remove();

    // Feature promos are managed in the announcements system (display = "promo" or "all")
    let promos = [];
    try {
      const r = await API.get('/announcements/index.php');
      if (r?.ok) {
        const items = r.data?.data || r.data || [];
        promos = items.filter(a => a.display === 'promo' || a.display === 'all');
      }
    } catch (e) { /* keep the learning slide even if promos fail to load */ }

    promos.forEach(a => {
      const icon  = a.icon || PROMO_TYPE_ICON[a.type] || '📢';
      const badge = a.badge || '';
      const cta   = a.popup_cta_label || 'เปิด';
      const href  = a.popup_cta_url || '#';
      track.insertAdjacentHTML('beforeend',
        `<div class="promo-slide"><div class="promo-card">
          <div class="pc-icon">${escHtml(icon)}</div>
          <div class="pc-body">
            ${badge ? `<span class="pc-badge">${escHtml(badge)}</span>` : ''}
            <div class="pc-title">${escHtml(a.title || '')}</div>
            <div class="pc-msg">${escHtml(a.message || '')}</div>
          </div>
          <a class="pc-cta" href="${escHtml(href)}">${escHtml(cta)} <span class="arr">→</span></a>
        </div></div>`);
    });

    this.slides = Array.from(track.querySelectorAll('.promo-slide'));
    if (this.slides.length === 0) { promo.hidden = true; return; }
    promo.hidden = false;
    promo.classList.toggle('single', this.slides.length <= 1);

    this.buildDots();
    this.go(0, true);
    if (this.slides.length > 1) {
      this.start();
      promo.addEventListener('mouseenter', () => this.stop());
      promo.addEventListener('mouseleave', () => this.start());
      document.getElementById('promo-prev').addEventListener('click', () => { this.go(this.idx - 1); this.restart(); });
      document.getElementById('promo-next').addEventListener('click', () => { this.go(this.idx + 1); this.restart(); });
    }
  },

  buildDots() {
    const dots = document.getElementById('promo-dots');
    if (!dots) return;
    dots.innerHTML = this.slides.map((_, i) =>
      `<button class="promo-dot${i === this.idx ? ' active' : ''}" data-i="${i}" type="button" aria-label="สไลด์ ${i + 1}"></button>`).join('');
    dots.querySelectorAll('.promo-dot').forEach(d =>
      d.addEventListener('click', () => { this.go(+d.dataset.i); this.restart(); }));
  },

  go(i, instant) {
    const n = this.slides.length;
    if (!n) return;
    this.idx = (i % n + n) % n;
    const track = document.getElementById('promo-track');
    if (instant) track.style.transition = 'none';
    track.style.transform = `translateX(${-this.idx * 100}%)`;
    if (instant) requestAnimationFrame(() => { track.style.transition = ''; });
    document.querySelectorAll('#promo-dots .promo-dot')
      .forEach((d, k) => d.classList.toggle('active', k === this.idx));
  },

  start() { this.stop(); if (this.slides.length > 1) this.timer = setInterval(() => this.go(this.idx + 1), 6500); },
  stop()  { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  restart() { this.stop(); this.start(); },
};

// Orchestrate: populate the learning hero, then start the carousel
(async function initPromoArea() {
  try { await loadLearningHero(); } catch (e) { /* keep promos even if hero fails */ }
  PromoCarousel.init();
})();

/* ══════════════════════════════════════════════════
   ANALYTICS OVERVIEW — compact YTD summary → analytics.html
══════════════════════════════════════════════════ */
(async function loadDashAnalytics() {
  const el = document.getElementById('dash-anl');
  if (!el) return;
  const setV = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  const pct = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(0) + '%' : '—'; };
  try {
    const y = new Date().getFullYear();
    const from = `${y}-01-01`, to = new Date().toISOString().slice(0, 10);
    const r = await API.get(`/jira/incidents-analytics.php?fromDate=${from}&toDate=${to}`);
    if (!r?.ok) return;                              // stays hidden on error
    const d = r.data?.data || r.data || {};
    const ov = d.overall || {};
    const monthly = d.monthly || [];

    setV('dash-anl-sub', `ภาพรวมปี ${y}`);
    setV('danl-total', ov.total ?? 0);
    setV('danl-all', Number.isFinite(+ov.smPct) ? (+ov.smPct).toFixed(1) : '—');
    setV('danl-int', pct(ov.internal?.smPct));
    setV('danl-ext', pct(ov.external?.smPct));

    // Delta vs OKR 90%
    const dl = document.getElementById('danl-all-delta');
    if (dl && Number.isFinite(+ov.smPct)) {
      const diff = +ov.smPct - 90;
      dl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(1);
      dl.className = 'danl-delta ' + (diff >= 0 ? 'ok' : 'bad');
    }

    // 12-month tracker — green (0 miss) / red (X miss) / future (grey dashed)
    const sp = document.getElementById('danl-spark');
    if (sp) {
      const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const byKey = {};
      monthly.forEach(m => { byKey[m.month] = m; });
      const now = new Date();
      const curKey = now.toISOString().slice(0, 7);
      sp.innerHTML = MON.map((name, i) => {
        const mm  = String(i + 1).padStart(2, '0');
        const key = `${y}-${mm}`;
        const m   = byKey[key];
        if (!m) {
          if (key > curKey) return `<span class="danl-mon future" title="${key}: future"><span class="mon-lbl">${name.charAt(0)}</span><span class="mon-val">—</span></span>`;
          return `<span class="danl-mon clean" title="${key}: no data"><span class="mon-lbl">${name.charAt(0)}</span><span class="mon-val">✓</span></span>`;
        }
        const miss = Math.max(0, (m.total || 0) - (m.detectedSM || 0));
        if (miss > 0) {
          return `<span class="danl-mon miss" title="${key}: ${miss} miss / ${m.total} total"><span class="mon-lbl">${name.charAt(0)}</span><span class="mon-val">${miss}</span></span>`;
        }
        return `<span class="danl-mon clean" title="${key}: clean (${m.total} incident${m.total === 1 ? '' : 's'})"><span class="mon-lbl">${name.charAt(0)}</span><span class="mon-val">✓</span></span>`;
      }).join('');
    }

    el.hidden = false;                              // reveal only when data is in
  } catch (e) { /* leave hidden */ }
})();


/* ══════════════════════════════════════════════════
   TODAY ROSTER STRIP
══════════════════════════════════════════════════ */
(async function loadTodaySchedule() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const today = `${year}-${String(month).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // Update combined date label (shared with external on-call)
  const dateEl = document.getElementById('combined-date');
  if (dateEl) {
    const TH_MONTHS = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const TH_DAYS   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
    dateEl.textContent = `${TH_DAYS[now.getDay()]} ${now.getDate()} ${TH_MONTHS[month]} ${year + 543}`;
  }

  const [schedRes, usersRes, leaveRes] = await Promise.all([
    API.schedule.get(year, month).catch(() => null),
    API.users.list().catch(() => null),
    API.leave.list({ status: 'approved' }).catch(() => null),
  ]);

  const slotsEl = document.getElementById('ts-slots');
  if (!slotsEl) return;

  const schedData = schedRes?.ok ? (schedRes.data.data || {}) : {};
  const usersData = usersRes?.ok ? (usersRes.data.data || []) : [];
  const allLeaves = leaveRes?.ok  ? (leaveRes.data.data  || []) : [];
  const entry     = schedData[today] || {};

  // Filter approved leaves covering today
  const todayLeaves = allLeaves.filter(l => {
    if (l.status !== 'approved') return false;
    return l.start_date <= today && l.end_date >= today;
  });

  // Color palette (deterministic from uid)
  const PALETTE = [
    ['#f26419','rgba(242,100,25,.15)'],['#3b82f6','rgba(59,130,246,.15)'],
    ['#8b5cf6','rgba(139,92,246,.15)'],['#22c55e','rgba(34,197,94,.15)'],
    ['#ec4899','rgba(236,72,153,.15)'],['#14b8a6','rgba(20,184,166,.15)'],
    ['#f59e0b','rgba(245,158,11,.15)'],['#6366f1','rgba(99,102,241,.15)'],
  ];
  function ucolor(uid) {
    let h = 0; for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function uname(uid) {
    const u = usersData.find(x => x.id === uid);
    if (!u) return uid;
    return u.nickname || u.name.split(' ')[0] || u.name;
  }
  function chipHtml(uid) {
    const [fc, bg] = ucolor(uid);
    return `<span class="ts-chip" style="color:${fc};background:${bg};border-color:${fc}40"><span class="ts-chip-dot" style="background:${fc}"></span>${uname(uid)}</span>`;
  }
  function normIds(arr) {
    return (arr || []).map(e => typeof e === 'object' ? e.user_id : e).filter(Boolean);
  }

  const WORK_SLOTS = [
    { key: 'shift1_tdpk', label: 'S1 TDPK' },
    { key: 'shift1_wah',  label: 'S1 W@H'  },
    { key: 'shift2_wah',  label: 'S2 W@H'  },
  ];
  const OC_SLOTS = [
    { key: 'shift1_oncall', label: 'OC S1' },
    { key: 'shift2_oncall', label: 'OC S2' },
  ];

  const sections = [];

  /* ── Working section ── */
  const workParts = [];
  WORK_SLOTS.forEach(s => {
    const ids = normIds(entry[s.key]);
    if (!ids.length) return;
    workParts.push(`<span class="ts-slot-lbl">${s.label}</span>${ids.map(chipHtml).join('')}`);
  });
  if (workParts.length) {
    sections.push(`<div class="ts-group">
      <span class="ts-group-lbl work">🟢 ทำงาน</span>
      ${workParts.map(p => `<div class="ts-slot">${p}</div>`).join('<div class="ts-sep"></div>')}
    </div>`);
  }

  /* ── On-Call section ── */
  const ocParts = [];
  OC_SLOTS.forEach(s => {
    const rawVal = entry[s.key] || '';
    const uid = typeof rawVal === 'object' ? rawVal.user_id : rawVal;
    if (!uid) return;
    const [fc, bg] = ucolor(uid);
    ocParts.push(`<span class="ts-slot-lbl">${s.label}</span><span class="ts-oc" style="color:${fc};background:${bg};border-color:${fc}40">⚡ ${uname(uid)}</span>`);
  });
  if (ocParts.length) {
    if (sections.length) sections.push('<div class="ts-sep"></div>');
    sections.push(`<div class="ts-group">
      <span class="ts-group-lbl oncall">⚡ On-Call</span>
      ${ocParts.map(p => `<div class="ts-slot">${p}</div>`).join('<div class="ts-sep"></div>')}
    </div>`);
  }

  /* ── Leave section — combine schedule leaves + approved leave requests ── */
  const leaveChips = [];

  // From schedule data (vacation / sick / half-day)
  normIds(entry.vacation).forEach(uid => {
    leaveChips.push({ uid, type: 'vacation', label: '🏖', title: 'ลาพักร้อน' });
  });
  normIds(entry.sick).forEach(uid => {
    leaveChips.push({ uid, type: 'sick', label: '🤒', title: 'ลาป่วย' });
  });
  // Half-day from schedule
  (entry.vacation || []).filter(e => typeof e === 'object' && e.days === 0.5).forEach(e => {
    if (!leaveChips.find(c => c.uid === e.user_id)) {
      leaveChips.push({ uid: e.user_id, type: 'half', label: '🌓', title: 'ลาครึ่งวัน' });
    }
  });

  // From leave API (approved leaves covering today, de-duplicate)
  todayLeaves.forEach(l => {
    const uid = l.user_id;
    if (!uid) return;
    const alreadyIn = leaveChips.some(c => c.uid === uid);
    if (!alreadyIn) {
      const isHalf = l.duration === 'half';
      leaveChips.push({
        uid,
        type: isHalf ? 'half' : (l.type === 'sick' ? 'sick' : 'vacation'),
        label: isHalf ? '🌓' : (l.type === 'sick' ? '🤒' : '🏖'),
        title: isHalf ? `ลาครึ่งวัน (${l.period === 'afternoon' ? 'บ่าย' : 'เช้า'})` : (l.type === 'sick' ? 'ลาป่วย' : 'ลาพักร้อน'),
      });
    }
  });

  if (leaveChips.length) {
    if (sections.length) sections.push('<div class="ts-sep"></div>');
    sections.push(`<div class="ts-group">
      <span class="ts-group-lbl leave">🔴 ลา</span>
      ${leaveChips.map(c => `<span class="ts-leave-chip ${c.type}" title="${c.title}">${c.label} ${uname(c.uid)}</span>`).join('')}
    </div>`);
  }

  slotsEl.innerHTML = sections.length
    ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${sections.join('')}</div>`
    : '<span class="ts-empty">ไม่มีข้อมูลตารางเวรวันนี้</span>';
})();

/* ══════════════════════════════════════════════════
   EXTERNAL ON-CALL STRIP
══════════════════════════════════════════════════ */
(async function loadExternalOncall() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const today = `${year}-${String(month).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const slotsEl = document.getElementById('ext-oc-slots');
  if (!slotsEl) return;

  try {
    const res = await API.get(`/n8n-oncall.php?date=${today}`);

    if (!res?.ok) {
      const reason = res?.data?.message || 'ไม่ทราบสาเหตุ';
      slotsEl.innerHTML = `<span class="ts-empty" style="color:#f59e0b">⚠️ External On-call ไม่พร้อมใช้งาน — ${escHtml(reason)}</span>`;
      return;
    }

    const oncall = res?.data?.data?.oncall || [];
    
    if (oncall.length === 0) {
      slotsEl.innerHTML = '<span class="ts-empty">ไม่มีข้อมูล External On-call วันนี้</span>';
      return;
    }
    
    // Team colors
    const TEAM_COLORS = {
      'TMN':       ['#3b82f6', 'rgba(59,130,246,.15)'],
      'NNO':       ['#22c55e', 'rgba(34,197,94,.15)'],
      'IM':        ['#8b5cf6', 'rgba(139,92,246,.15)'],
      'CloudTech': ['#f59e0b', 'rgba(245,158,11,.15)'],
      'DBA':       ['#ec4899', 'rgba(236,72,153,.15)'],
      'SD':        ['#14b8a6', 'rgba(20,184,166,.15)'],
      'SRE':       ['#f26419', 'rgba(242,100,25,.15)'],
      'System':    ['#6366f1', 'rgba(99,102,241,.15)'],
      'Network':   ['#10b981', 'rgba(16,185,129,.15)'],
    };

    const chips = oncall.map(person => {
      const [fc, bg] = TEAM_COLORS[person.team] || ['#888', 'rgba(136,136,136,.15)'];
      const phone = person.phone || 'ไม่มีข้อมูล';
      return `
        <span class="ts-chip ext-oc-chip" style="color:${fc};background:${bg};border-color:${fc}40" data-tooltip="${person.name}&#10;📞 ${phone}">
          <span class="ts-chip-dot" style="background:${fc}"></span>
          <strong>${person.team}</strong>
        </span>
      `;
    }).join('');

    slotsEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="ts-group">
          <span class="ts-group-lbl oncall">⚡ External Teams</span>
          ${chips}
        </div>
      </div>
    `;

  } catch (err) {
    console.error('Failed to load external on-call:', err);
    slotsEl.innerHTML = `<span class="ts-empty" style="color:#ef4444">⚠️ ไม่สามารถโหลดข้อมูล External On-call ได้ (${err.message})</span>`;
  }
})();



/* ── next inline block ── */


let currentTab = 'new';
let myRequests = [];
let _nextTicket = 'SMHUB-…';

function _setNextTicket(val) {
  if (!val) return;
  _nextTicket = val;
  // topbar label
  const lbl = document.getElementById('tb-next-ticket');
  if (lbl) lbl.textContent = val;
  // modal banner
  const num = document.getElementById('req-next-ticket-num');
  if (num) num.textContent = val;
  // submit button chip
  const chip = document.getElementById('req-submit-ticket');
  if (chip) chip.textContent = val;
}

function updateTicketBannerType(type) {
  // (reserved for future type-specific banner changes)
}

function switchRequestTab(tab) {
  currentTab = tab;
  
  // Update tab buttons
  document.getElementById('tab-new').classList.toggle('active', tab === 'new');
  document.getElementById('tab-history').classList.toggle('active', tab === 'history');
  
  // Update tab content
  document.getElementById('tab-content-new').style.display = tab === 'new' ? 'block' : 'none';
  document.getElementById('tab-content-history').style.display = tab === 'history' ? 'block' : 'none';
  
  // Update footer button
  document.getElementById('submit-request-btn').style.display = tab === 'new' ? 'inline-flex' : 'none';
  
  // Load history if switching to history tab
  if (tab === 'history') {
    loadMyRequests();
  }
}

async function loadMyRequests() {
  const listEl = document.getElementById('my-requests-list');
  listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">กำลังโหลด...</div>';

  try {
    const res = await API.get('/requests/index.php');
    if (!res?.ok) {
      listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">โหลดไม่สำเร็จ</div>';
      return;
    }

    const data = res.data;
    if (data?.next_ticket) _setNextTicket(data.next_ticket);
    myRequests = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    
    if (!myRequests.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">ยังไม่มีคำขอ</div>';
      return;
    }
    
    const statusIcons = {
      pending: '⏳',
      in_progress: '<i data-icon="refresh-cw"></i>',
      completed: '<i data-icon="check-circle"></i>',
      rejected: '<i data-icon="x-circle"></i>'
    };
    const statusLabels = {
      pending: 'รอดำเนินการ',
      in_progress: 'กำลังดำเนินการ',
      completed: 'เสร็จสิ้น',
      rejected: 'ปฏิเสธ'
    };
    const statusColors = {
      pending: '#f59e0b',
      in_progress: '#3b82f6',
      completed: '#22c55e',
      rejected: '#6b7280'
    };
    
    const myUserId = Auth.getUser?.()?.id || Auth.getUser?.()?.sub || '';

    listEl.innerHTML = myRequests.map(r => {
      const typeIcon = r.type === 'feature' ? '<i data-icon="sparkles"></i>' : '<i data-icon="bug"></i>';
      const typeLabel = r.type === 'feature' ? 'Feature' : 'Bug';
      const statusIcon = statusIcons[r.status] || '⏳';
      const statusLabel = statusLabels[r.status] || r.status;
      const statusColor = statusColors[r.status] || '#888';
      const createdDate = new Date(r.created_at).toLocaleDateString('th-TH', {
        day: '2-digit', month: 'short', year: 'numeric'
      });

      const ticketSpan = r.ticket_number
        ? `<span style="padding:2px 7px;border-radius:5px;font-size:10px;font-weight:800;font-family:monospace;background:rgba(242,100,25,.1);color:var(--orange,#f26419);border:1px solid rgba(242,100,25,.3)">${escHtml(r.ticket_number)}</span>`
        : '';

      const comments = r.comments || [];
      const cmtCount = comments.length;
      const hasAdminComment = comments.some(c => ['super_admin','sm_admin','dev_sm'].includes(c.author_role));

      // Render compact comment bubbles
      const cmtHtml = comments.map(c => {
        const isAdmin = ['super_admin','sm_admin','dev_sm'].includes(c.author_role);
        const isMine  = c.author_id === myUserId && !isAdmin;
        const initials = (c.author_name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const time = new Date(c.created_at).toLocaleString('th-TH', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
        return `<div class="req-cmt-bubble ${isMine ? 'mine' : ''}">
          <div class="req-cmt-av ${isAdmin ? 'admin-av' : 'user-av'}">${initials}</div>
          <div style="max-width:80%">
            <div style="font-size:9px;color:var(--text-muted);margin-bottom:2px;${isMine ? 'text-align:right' : ''}">${escHtml(c.author_name)}${isAdmin ? ' <span style="color:var(--orange,#f26419);font-weight:700">Admin</span>' : ''} · ${time}</div>
            <div class="req-cmt-text">${escHtml(c.text)}</div>
          </div>
        </div>`;
      }).join('');

      return `<div class="my-req-item" id="req-card-${r.id}">
        <div class="my-req-header">
          <span style="font-size:16px">${typeIcon}</span>
          ${ticketSpan}
          <span class="my-req-title">${escHtml(r.title)}</span>
          <span style="padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40">
            ${statusIcon} ${statusLabel}
          </span>
        </div>
        <div class="my-req-desc">${escHtml(r.description)}</div>
        <div class="my-req-footer">
          <span>${typeLabel}</span>
          <span><i data-icon="circle"></i></span>
          <span>${createdDate}</span>
          ${cmtCount ? `<span>•</span><span style="color:var(--orange,#f26419);font-weight:700;cursor:pointer" onclick="toggleReqComments('${r.id}')"><i data-icon="message-square"></i> ${cmtCount} comment${cmtCount > 1 ? 's' : ''}${hasAdminComment ? ' (Admin replied)' : ''}</span>` : ''}
        </div>
        <!-- comment thread (collapsed if no admin reply, expanded if admin replied) -->
        <div class="req-comments-panel" id="req-cmt-${r.id}" style="${hasAdminComment ? '' : 'display:none'}">
          <div class="cmt-thread" id="req-cmt-thread-${r.id}">${cmtHtml}</div>
          <div class="req-reply-row">
            <textarea class="req-reply-input" id="req-reply-${r.id}" rows="1" placeholder="Reply…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendUserReply('${r.id}')}"></textarea>
            <button class="btn btn-primary btn-sm" onclick="sendUserReply('${r.id}')" style="align-self:flex-end;flex-shrink:0"><i data-icon="send"></i></button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">เกิดข้อผิดพลาด</div>';
  }
}

function toggleReqComments(reqId) {
  const panel = document.getElementById(`req-cmt-${reqId}`);
  if (!panel) return;
  const hidden = panel.style.display === 'none';
  panel.style.display = hidden ? 'flex' : 'none';
  if (hidden) {
    panel.style.flexDirection = 'column';
    panel.style.gap = '8px';
    document.getElementById(`req-reply-${reqId}`)?.focus();
  }
}

async function sendUserReply(reqId) {
  const input = document.getElementById(`req-reply-${reqId}`);
  const text = input?.value.trim();
  if (!text) return;

  const btn = input?.nextElementSibling;
  if (btn) btn.disabled = true;
  if (input) input.disabled = true;

  try {
    const res = await API.patch('/requests/index.php', { id: reqId, comment: text });
    if (res?.ok) {
      const newCmt = res.data?.data;
      if (!newCmt) return;
      // Append bubble to thread
      const thread = document.getElementById(`req-cmt-thread-${reqId}`);
      if (thread) {
        const time = new Date(newCmt.created_at).toLocaleString('th-TH', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
        const initials = (newCmt.author_name || '?').split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase();
        thread.insertAdjacentHTML('beforeend', `
          <div class="req-cmt-bubble mine">
            <div class="req-cmt-av user-av">${initials}</div>
            <div style="max-width:80%">
              <div style="font-size:9px;color:var(--text-muted);margin-bottom:2px;text-align:right">${escHtml(newCmt.author_name)} · ${time}</div>
              <div class="req-cmt-text">${escHtml(newCmt.text)}</div>
            </div>
          </div>`);
        thread.scrollTop = thread.scrollHeight;
      }
      if (input) input.value = '';
      // update myRequests cache
      const r = myRequests.find(x => x.id === reqId);
      if (r) { if (!r.comments) r.comments = []; r.comments.push(newCmt); }
    } else {
      Toast.error(res?.data?.message || 'Reply ไม่สำเร็จ');
    }
  } catch (err) {
    Toast.error('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (input) { input.disabled = false; input.focus(); }
  }
}

/* ── Requests topbar button ─────────────────────────────── */
const _isAdmin = ['super_admin', 'sm_admin', 'dev_sm'].includes(Auth.getUser?.()?.role);

async function loadRequestsBadge() {
  try {
    const res = await API.get('/requests/index.php');
    if (!res?.ok) return;
    const data = res.data;
    if (data?.next_ticket) _setNextTicket(data.next_ticket);
    if (!_isAdmin) return;
    const list = Array.isArray(data?.data) ? data.data : [];
    const pending = list.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('tb-requests-badge');
    if (!badge) return;
    if (pending > 0) {
      badge.textContent = pending > 99 ? '99+' : pending;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch {}
}

function openRequestsFromTopbar() {
  openRequestModal();
}

loadRequestsBadge();
setInterval(() => { if (!document.hidden) loadRequestsBadge(); }, 60000);

function openRequestModal() {
  Modal.open('request-modal');
  switchRequestTab('new');
  document.getElementById('request-form').reset();
  // Fill reporter name from JWT
  const user = Auth.getUser?.();
  const nameEl = document.getElementById('req-reporter-name');
  if (nameEl && user?.name) nameEl.textContent = user.name;
  // Refresh next ticket number display (may have been updated since page load)
  _setNextTicket(_nextTicket);
}

function closeRequestModal() {
  Modal.close('request-modal');
}

async function submitRequest() {
  const type = document.getElementById('req-type').value;
  const title = document.getElementById('req-title').value.trim();
  const description = document.getElementById('req-description').value.trim();
  const priority = document.getElementById('req-priority').value;

  if (!type || !title || !description) {
    Toast.error('กรุณากรอกข้อมูลให้ครบถ้วน');
    return;
  }

  const btn = document.querySelector('#submit-request-btn');
  const icon = document.getElementById('req-submit-icon');
  const text = document.getElementById('req-submit-text');
  
  const chip = document.getElementById('req-submit-ticket');
  btn.disabled = true;
  icon.innerHTML = '<i data-icon="loader"></i>';
  text.textContent = 'กำลังเปิด…';
  if (chip) chip.style.opacity = '0.4';

  try {
    const res = await API.post('/requests/index.php', {
      type,
      title,
      description,
      priority
    });

    if (res?.ok) {
      const ticket = res.data?.data?.ticket_number || res.data?.ticket_number || _nextTicket;
      Toast.success(`เปิด Ticket สำเร็จ! ${ticket} — Admin จะตรวจสอบและดำเนินการ`);
      document.getElementById('request-form').reset();
      // Refresh badge + next ticket number after successful submission
      loadRequestsBadge();
      switchRequestTab('history');
    } else {
      Toast.error(res?.data?.message || 'ส่งคำขอไม่สำเร็จ');
    }
  } catch (err) {
    Toast.error('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    btn.disabled = false;
    icon.innerHTML = '<i data-icon="ticket"></i>';
    text.textContent = 'Open Ticket';
    if (chip) chip.style.opacity = '1';
  }
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_buildForwardBody", { configurable: true, get: () => _buildForwardBody, set: (v) => { _buildForwardBody = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_buildQuote", { configurable: true, get: () => _buildQuote, set: (v) => { _buildQuote = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_confirmDiscardIfDirty", { configurable: true, get: () => _confirmDiscardIfDirty, set: (v) => { _confirmDiscardIfDirty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_cxUpdatePlaceholder", { configurable: true, get: () => _cxUpdatePlaceholder, set: (v) => { _cxUpdatePlaceholder = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_ibSkeletonHTML", { configurable: true, get: () => _ibSkeletonHTML, set: (v) => { _ibSkeletonHTML = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_normalizeImagesForSend", { configurable: true, get: () => _normalizeImagesForSend, set: (v) => { _normalizeImagesForSend = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_onAvaColor", { configurable: true, get: () => _onAvaColor, set: (v) => { _onAvaColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_onInitials", { configurable: true, get: () => _onInitials, set: (v) => { _onInitials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_renderCidsForQuote", { configurable: true, get: () => _renderCidsForQuote, set: (v) => { _renderCidsForQuote = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setNextTicket", { configurable: true, get: () => _setNextTicket, set: (v) => { _setNextTicket = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_switchToComposeMode", { configurable: true, get: () => _switchToComposeMode, set: (v) => { _switchToComposeMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_switchToReadMode", { configurable: true, get: () => _switchToReadMode, set: (v) => { _switchToReadMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cancelCompose", { configurable: true, get: () => cancelCompose, set: (v) => { cancelCompose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeReader", { configurable: true, get: () => closeReader, set: (v) => { closeReader = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeRequestModal", { configurable: true, get: () => closeRequestModal, set: (v) => { closeRequestModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeSmcModal", { configurable: true, get: () => closeSmcModal, set: (v) => { closeSmcModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cxExec", { configurable: true, get: () => cxExec, set: (v) => { cxExec = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cxInsertImageFile", { configurable: true, get: () => cxInsertImageFile, set: (v) => { cxInsertImageFile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cxInsertLink", { configurable: true, get: () => cxInsertLink, set: (v) => { cxInsertLink = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatInboxTime", { configurable: true, get: () => formatInboxTime, set: (v) => { formatInboxTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getGreeting", { configurable: true, get: () => getGreeting, set: (v) => { getGreeting = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadInbox", { configurable: true, get: () => loadInbox, set: (v) => { loadInbox = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLearningHero", { configurable: true, get: () => loadLearningHero, set: (v) => { loadLearningHero = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMyRequests", { configurable: true, get: () => loadMyRequests, set: (v) => { loadMyRequests = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadRequestsBadge", { configurable: true, get: () => loadRequestsBadge, set: (v) => { loadRequestsBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadStats", { configurable: true, get: () => loadStats, set: (v) => { loadStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openMessage", { configurable: true, get: () => openMessage, set: (v) => { openMessage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openRequestModal", { configurable: true, get: () => openRequestModal, set: (v) => { openRequestModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openRequestsFromTopbar", { configurable: true, get: () => openRequestsFromTopbar, set: (v) => { openRequestsFromTopbar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openSmcModal", { configurable: true, get: () => openSmcModal, set: (v) => { openSmcModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateSmcSelects", { configurable: true, get: () => populateSmcSelects, set: (v) => { populateSmcSelects = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDashEmailBody", { configurable: true, get: () => renderDashEmailBody, set: (v) => { renderDashEmailBody = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderFeedError", { configurable: true, get: () => renderFeedError, set: (v) => { renderFeedError = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderInboxList", { configurable: true, get: () => renderInboxList, set: (v) => { renderInboxList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMixedFeed", { configurable: true, get: () => renderMixedFeed, set: (v) => { renderMixedFeed = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "retryFeed", { configurable: true, get: () => retryFeed, set: (v) => { retryFeed = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendCompose", { configurable: true, get: () => sendCompose, set: (v) => { sendCompose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendUserReply", { configurable: true, get: () => sendUserReply, set: (v) => { sendUserReply = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setInboxFilter", { configurable: true, get: () => setInboxFilter, set: (v) => { setInboxFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "smcBridgePlaceholder", { configurable: true, get: () => smcBridgePlaceholder, set: (v) => { smcBridgePlaceholder = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "startCompose", { configurable: true, get: () => startCompose, set: (v) => { startCompose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitRequest", { configurable: true, get: () => submitRequest, set: (v) => { submitRequest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitSmcTicket", { configurable: true, get: () => submitSmcTicket, set: (v) => { submitSmcTicket = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchRequestTab", { configurable: true, get: () => switchRequestTab, set: (v) => { switchRequestTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleReqComments", { configurable: true, get: () => toggleReqComments, set: (v) => { toggleReqComments = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateClock", { configurable: true, get: () => updateClock, set: (v) => { updateClock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateTicketBannerType", { configurable: true, get: () => updateTicketBannerType, set: (v) => { updateTicketBannerType = v; } }); } catch (e) {}
})();
