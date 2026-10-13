// inbox — page script, extracted from inbox.html.
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
// super_viewer has no access to team inbox — bounce to dashboard silently.
// (Sidebar already hides the item; this catches direct-URL access.)
if (Auth.getUser?.()?.role === 'super_viewer') {
  window.location.replace('./dashboard.html');
  throw new Error('super_viewer blocked from inbox');
}
Layout.render('inbox');

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
let _folder  = 'INBOX';
let _filter  = 'all';
let _search  = '';
let _offset  = 0;
const PAGE   = 30;
let _emails  = [];         // current list
let _total   = 0;
let _uid     = null;       // currently open email
let _openMsg = null;       // full message data
let _folders = [];         // folder list from API
let _searchTimer = null;

/* ══════════════════════════════════════════════════════════
   FOLDERS
══════════════════════════════════════════════════════════ */
const FOLDER_ICONS = {
  inbox: '<i data-icon="inbox"></i>', starred: '<i data-icon="star"></i>', sent: '<i data-icon="upload"></i>', drafts: '<i data-icon="edit"></i>',
  spam: '<i data-icon="ban"></i>', trash: '<i data-icon="trash"></i>', all: '<i data-icon="folder-open"></i>', important: '🔖',
};

// Gmail เสมอมี special folders เหล่านี้ — render ทันทีโดยไม่รอ API
const STATIC_FOLDERS = [
  { name: 'INBOX',              display: 'Inbox',    special: 'inbox'     },
  { name: '[Gmail]/Starred',    display: 'Starred',  special: 'starred'   },
  { name: '[Gmail]/Sent Mail',  display: 'Sent',     special: 'sent'      },
  { name: '[Gmail]/Drafts',     display: 'Drafts',   special: 'drafts'    },
  { name: '[Gmail]/Spam',       display: 'Spam',     special: 'spam'      },
  { name: '[Gmail]/Trash',      display: 'Trash',    special: 'trash'     },
  { name: '[Gmail]/All Mail',   display: 'All Mail', special: 'all'       },
  { name: '[Gmail]/Important',  display: 'Important',special: 'important' },
];

async function loadFolders() {
  // 1. แสดง folder structure ทันที (ไม่มี counts ก่อน)
  if (!_folders.length) {
    _folders = STATIC_FOLDERS.map(f => ({ ...f, unread: 0, total: 0 }));
    renderFolders();
  }
  // 2. โหลด counts จาก API (async — อาจช้า แต่ UI ไม่ block)
  const res = await API.inbox.folders();
  if (!res?.ok) return;
  _folders = res.data.data || [];
  renderFolders(); // อัพเดต counts เมื่อมาถึง
}

function renderFolders() {
  const el = document.getElementById('folder-list');
  const specials = _folders.filter(f => f.special);
  const custom   = _folders.filter(f => !f.special && f.name !== '[Gmail]');

  let html = '';
  specials.forEach(f => {
    const icon    = FOLDER_ICONS[f.special] || '<i data-icon="folder"></i>';
    const active  = f.name === _folder ? 'active' : '';
    const unread  = f.unread > 0 ? `<span class="fi-count">${f.unread}</span>` : '';
    html += `<div class="folder-item ${active}" onclick="selectFolder('${escHtml(f.name)}')">
      <span class="fi-icon">${icon}</span>
      <span class="fi-name">${escHtml(f.display)}</span>
      ${unread}
    </div>`;
  });
  if (custom.length) {
    html += '<hr><div class="folder-section-label">Labels</div>';
    custom.forEach(f => {
      const active = f.name === _folder ? 'active' : '';
      const unread = f.unread > 0 ? `<span class="fi-count">${f.unread}</span>` : '';
      html += `<div class="folder-item ${active}" onclick="selectFolder('${escHtml(f.name)}')">
        <span class="fi-icon"><i data-icon="tag"></i></span>
        <span class="fi-name">${escHtml(f.display)}</span>
        ${unread}
      </div>`;
    });
  }
  el.innerHTML = html;
}

function selectFolder(name) {
  _folder = name; _offset = 0; _uid = null;
  renderFolders();
  showEmpty();
  loadList(true);
}

/* ══════════════════════════════════════════════════════════
   EMAIL LIST
══════════════════════════════════════════════════════════ */
async function loadList(reset = true) {
  if (reset) { _offset = 0; _emails = []; }
  const listEl = document.getElementById('email-list');
  if (reset) listEl.innerHTML = `<div class="list-empty"><span class="spin">⏳</span> โหลด email…</div>`;

  const res = await API.inbox.list({ folder: _folder, filter: _filter, limit: PAGE, offset: _offset });
  if (!res?.ok) {
    listEl.innerHTML = `<div class="list-empty" style="color:#ef4444"><i data-icon="alert-triangle"></i> ${escHtml(res?.data?.message || 'โหลดไม่สำเร็จ')}</div>`;
    return;
  }
  const d = res.data.data;
  _total  = d.total || 0;
  _emails = reset ? (d.items || []) : [..._emails, ...(d.items || [])];

  // Update sub-title
  const folderDisp = _folders.find(f => f.name === _folder)?.display || _folder;
  document.getElementById('inbox-sub').textContent = `${folderDisp} — ${d.unread || 0} ยังไม่อ่าน · ${_total} ทั้งหมด`;

  renderList();
}

function renderList() {
  const q     = _search.toLowerCase().trim();
  const items = q ? _emails.filter(m =>
    (m.subject || '').toLowerCase().includes(q) ||
    (m.from?.name || '').toLowerCase().includes(q) ||
    (m.from?.email || '').toLowerCase().includes(q)
  ) : _emails;

  const listEl = document.getElementById('email-list');
  if (!items.length) {
    listEl.innerHTML = `<div class="list-empty">${q ? '🔍 ไม่พบ email ที่ตรงกัน' : '📭 ไม่มี email'}</div>`;
    return;
  }

  let html = items.map(m => {
    const sender  = escHtml(m.from?.name || m.from?.email || '(unknown)');
    const time    = fmtTime(m.date);
    const subject = escHtml(m.subject || '(no subject)')
      .replace(/\[(SMC-\d+)\]/g, '<span class="smc-tag">[$1]</span>');
    const starred = m.flags?.flagged;
    const read    = m.flags?.seen;
    return `<div class="email-row ${read ? '' : 'unread'} ${_uid === m.uid ? 'active' : ''}"
               onclick="openEmail(${m.uid})">
      <div class="er-check"><input type="checkbox" onclick="event.stopPropagation()" title="เลือก"></div>
      <div class="er-star ${starred ? 'on' : ''}" onclick="event.stopPropagation();quickStar(${m.uid},${starred})" title="${starred ? 'ยกเลิก star' : 'Star'}">
        ${starred ? '⭐' : '☆'}
      </div>
      <div class="er-meta">
        <div class="er-top">
          <span class="er-from">${sender}</span>
          <span class="er-date">${escHtml(time)}</span>
        </div>
        <div class="er-subject">${subject}</div>
      </div>
      <div class="er-actions">
        <button class="er-act-btn" onclick="event.stopPropagation();quickArchive(${m.uid})" title="Archive"><i data-icon="folder"></i></button>
        <button class="er-act-btn" onclick="event.stopPropagation();quickDelete(${m.uid})" title="ลบ"><i data-icon="trash"></i></button>
      </div>
    </div>`;
  }).join('');

  if (_emails.length < _total) {
    html += `<div class="list-load-more"><button onclick="loadMore()">โหลดเพิ่ม (${_total - _emails.length} รายการ)</button></div>`;
  }
  listEl.innerHTML = html;
}

async function loadMore() {
  _offset += PAGE;
  await loadList(false);
}

function setFilter(f, btn) {
  _filter = f;
  document.querySelectorAll('.lf-btn').forEach(b => b.classList.toggle('active', b === btn));
  loadList(true);
}

function refreshList() { loadList(true); loadFolders(); }

/* ══════════════════════════════════════════════════════════
   EMAIL READER
══════════════════════════════════════════════════════════ */
function showEmpty() {
  document.getElementById('reader-empty').style.display = '';
  document.getElementById('reader-content').style.display = 'none';
}

function showReader() {
  document.getElementById('reader-empty').style.display = 'none';
  const rc = document.getElementById('reader-content');
  rc.style.display = 'flex';
  rc.style.flexDirection = 'column';
  rc.style.overflow = 'hidden';
  rc.style.flex = '1';
  rc.style.minHeight = '0';
}

async function openEmail(uid) {
  _uid = uid;
  renderList(); // highlight active row

  showReader();
  document.getElementById('r-subject').textContent = '⏳ กำลังโหลด…';
  document.getElementById('r-body').innerHTML = '<div style="color:var(--text-muted);padding:30px;text-align:center">⏳ กำลังโหลดเนื้อหา…</div>';
  document.getElementById('r-from').textContent = '';
  document.getElementById('r-to').textContent = '';
  document.getElementById('r-date').textContent = '';
  document.getElementById('r-atts').style.display = 'none';

  trackInboxRead();
  const res = await API.inbox.message(_folder, uid);
  if (!res?.ok) {
    document.getElementById('r-body').innerHTML = `<div style="color:#ef4444;padding:20px"><i data-icon="alert-triangle"></i> ${escHtml(res?.data?.message || 'โหลดไม่สำเร็จ')}</div>`;
    return;
  }
  _openMsg = res.data.data;
  const m = _openMsg;

  // Header
  document.getElementById('r-subject').textContent = m.subject || '(no subject)';
  const fromStr = m.from?.name ? `${m.from.name} <${m.from.email}>` : (m.from?.email || '—');
  document.getElementById('r-from').textContent = fromStr;
  document.getElementById('r-to').textContent   = (m.to || []).map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ') || '—';
  if (m.cc?.length) {
    document.getElementById('r-cc-row').style.display = '';
    document.getElementById('r-cc').textContent = m.cc.map(a => a.email).join(', ');
  } else {
    document.getElementById('r-cc-row').style.display = 'none';
  }
  document.getElementById('r-date').textContent = m.date ? new Date(m.date).toLocaleString('th-TH', { hour12: false }) : '—';

  // Star/read buttons
  updateReaderButtons(m);

  // Body
  const bodyEl = document.getElementById('r-body');
  if (m.is_html && m.body) {
    renderEmailBody(bodyEl, m.body, m.uid, m.folder || currentFolder, m.cid_map || {});
  } else {
    bodyEl.innerHTML = `<div class="reader-body-plain">${escHtml(m.plain || m.body || '(ไม่มีเนื้อหา)')}</div>`;
  }

  // Attachments
  if (m.attachments?.length) {
    document.getElementById('r-atts').style.display = '';
    document.getElementById('r-att-list').innerHTML = m.attachments.map(a => {
      const icon = a.mime?.startsWith('image/') ? '<i data-icon="image"></i>' : a.mime?.includes('pdf') ? '<i data-icon="file"></i>' : '<i data-icon="paperclip"></i>';
      const size = a.size > 1024*1024 ? (a.size/1024/1024).toFixed(1)+'MB' : a.size > 1024 ? (a.size/1024).toFixed(0)+'KB' : a.size+'B';
      return `<div class="att-item"><span class="att-icon">${icon}</span>${escHtml(a.filename)} <span style="opacity:.5">${size}</span></div>`;
    }).join('');
  }

  // Mark as read in local list
  const local = _emails.find(x => x.uid === uid);
  if (local && !local.flags.seen) { local.flags.seen = true; renderList(); }
}

function updateReaderButtons(m) {
  const starBtn = document.getElementById('r-star-btn');
  const readBtn = document.getElementById('r-read-btn');
  if (m.flags?.flagged) { starBtn.innerHTML = '<i data-icon="star"></i> Starred'; starBtn.className = 'rh-btn star-on'; }
  else { starBtn.innerHTML = '<i data-icon="star"></i> Star'; starBtn.className = 'rh-btn'; }
  if (m.flags?.seen) { readBtn.textContent = '● Mark Unread'; }
  else { readBtn.innerHTML = '<i data-icon="check"></i> Mark Read'; }
}

/* ══════════════════════════════════════════════════════════
   ACTIONS — Star / Read / Archive / Delete
══════════════════════════════════════════════════════════ */
async function toggleStar() {
  if (!_openMsg) return;
  const set = !_openMsg.flags.flagged;
  const res = await API.inbox.flag({ uid: _uid, folder: _folder, flag: '\\Flagged', set });
  if (!res?.ok) { showToast('ไม่สำเร็จ', 'error'); return; }
  _openMsg.flags.flagged = set;
  updateReaderButtons(_openMsg);
  const local = _emails.find(x => x.uid === _uid);
  if (local) { local.flags.flagged = set; renderList(); }
  showToast(set ? '<i data-icon="star"></i> เพิ่ม Star แล้ว' : 'ยกเลิก Star แล้ว', 'success');
}

async function toggleRead() {
  if (!_openMsg) return;
  const set = !_openMsg.flags.seen;
  const res = await API.inbox.flag({ uid: _uid, folder: _folder, flag: '\\Seen', set });
  if (!res?.ok) { showToast('ไม่สำเร็จ', 'error'); return; }
  _openMsg.flags.seen = set;
  updateReaderButtons(_openMsg);
  const local = _emails.find(x => x.uid === _uid);
  if (local) { local.flags.seen = set; renderList(); }
}

async function archiveEmail() {
  if (!_uid) return;
  const res = await API.inbox.move({ uid: _uid, from: _folder, to: '[Gmail]/All Mail' });
  if (!res?.ok) { showToast('Archive ไม่สำเร็จ: ' + (res?.data?.message || ''), 'error'); return; }
  showToast('<i data-icon="folder"></i> Archive แล้ว', 'success');
  _emails = _emails.filter(x => x.uid !== _uid); _uid = null; _openMsg = null;
  renderList(); showEmpty(); loadFolders();
}

async function deleteEmail() {
  if (!_uid) return;
  const res = await API.inbox.move({ uid: _uid, from: _folder, to: '[Gmail]/Trash' });
  if (!res?.ok) { showToast('ลบไม่สำเร็จ: ' + (res?.data?.message || ''), 'error'); return; }
  showToast('<i data-icon="trash"></i> ย้ายไป Trash แล้ว', 'success');
  _emails = _emails.filter(x => x.uid !== _uid); _uid = null; _openMsg = null;
  renderList(); showEmpty(); loadFolders();
}

// Quick actions from list row
async function quickStar(uid, currentState) {
  const set = !currentState;
  await API.inbox.flag({ uid, folder: _folder, flag: '\\Flagged', set });
  const local = _emails.find(x => x.uid === uid);
  if (local) { local.flags.flagged = set; renderList(); }
  if (_uid === uid && _openMsg) { _openMsg.flags.flagged = set; updateReaderButtons(_openMsg); }
}
async function quickArchive(uid) {
  await API.inbox.move({ uid, from: _folder, to: '[Gmail]/All Mail' });
  _emails = _emails.filter(x => x.uid !== uid);
  if (_uid === uid) { _uid = null; _openMsg = null; showEmpty(); }
  renderList(); loadFolders(); showToast('<i data-icon="folder"></i> Archive แล้ว', 'success');
}
async function quickDelete(uid) {
  await API.inbox.move({ uid, from: _folder, to: '[Gmail]/Trash' });
  _emails = _emails.filter(x => x.uid !== uid);
  if (_uid === uid) { _uid = null; _openMsg = null; showEmpty(); }
  renderList(); loadFolders(); showToast('<i data-icon="trash"></i> ลบแล้ว', 'success');
}

/* ══════════════════════════════════════════════════════════
   COMPOSE / REPLY / FORWARD
══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════
   EMAIL CHIP INPUT
══════════════════════════════════════════════════════════ */
function createChipInput(wrapId, textInputId) {
  const wrap  = document.getElementById(wrapId);
  const input = document.getElementById(textInputId);
  const _list = []; // email strings

  function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  // Parse "Name <email>, Name2 <email2>" or plain "a@x.com, b@x.com"
  function parseEmails(str) {
    const results = [], seen = new Set();
    const rx = /(?:"[^"]*"|[^<,;]*?)\s*<([^>]+)>/g;
    let m;
    while ((m = rx.exec(str)) !== null) {
      const e = m[1].trim().toLowerCase();
      if (isEmail(e) && !seen.has(e)) { seen.add(e); results.push(e); }
    }
    // Remaining plain addresses after stripping Name <email> pairs
    str.replace(/(?:"[^"]*"|[^<,;]*?)\s*<[^>]+>/g, '').split(/[,;\s]+/).forEach(p => {
      p = p.trim().replace(/^["']+|["']+$/g, '');
      if (isEmail(p) && !seen.has(p)) { seen.add(p); results.push(p); }
    });
    return results;
  }

  function addChip(email) {
    email = email.trim().toLowerCase();
    if (!isEmail(email) || _list.includes(email)) return;
    _list.push(email);
    const chip = document.createElement('span');
    chip.className = 'email-chip';
    chip.title = email;
    chip.innerHTML = `<span>${escHtml(email)}</span><button class="email-chip-del" type="button"><i data-icon="x"></i></button>`;
    chip.querySelector('.email-chip-del').onclick = () => {
      _list.splice(_list.indexOf(email), 1);
      chip.remove();
    };
    wrap.insertBefore(chip, input);
  }

  function commit() {
    const v = input.value.trim();
    if (!v) return;
    parseEmails(v).forEach(addChip);
    input.value = '';
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      e.preventDefault(); commit();
    } else if (e.key === 'Backspace' && !input.value && _list.length) {
      const last = wrap.querySelector('.email-chip:last-of-type');
      if (last) { _list.pop(); last.remove(); }
    }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('paste', e => {
    e.preventDefault();
    parseEmails(e.clipboardData.getData('text')).forEach(addChip);
  });
  wrap.addEventListener('click', e => { if (!e.target.closest('.email-chip')) input.focus(); });

  return {
    getEmails() { return _list.join(','); },
    setEmails(str) {
      _list.length = 0;
      wrap.querySelectorAll('.email-chip').forEach(c => c.remove());
      parseEmails(str || '').forEach(addChip);
    },
    addEmails(arr) {
      (arr || []).forEach(e => addChip(e.trim().toLowerCase()));
    },
    removeEmails(arr) {
      (arr || []).forEach(email => {
        email = email.trim().toLowerCase();
        const idx = _list.indexOf(email);
        if (idx === -1) return;
        _list.splice(idx, 1);
        wrap.querySelectorAll('.email-chip').forEach(chip => {
          if (chip.title === email) chip.remove();
        });
      });
    },
    focus() { input.focus(); },
  };
}

let _chipTo, _chipCc;

/* ══════════════════════════════════════════════════════════
   SERVICE TYPE AUTO-FILL FOR COMPOSE
══════════════════════════════════════════════════════════ */
let _cmpServiceTypes = [];
let _cmpAutoToEmails = [];
let _cmpAutoCcEmails = [];

async function loadServiceTypesForCompose() {
  if (_cmpServiceTypes.length) return;
  const r = await API.serviceTypes.list();
  _cmpServiceTypes = r?.ok ? (r.data.data || []) : [];
  const sel = document.getElementById('cx-subtype');
  // Clear any optgroups added previously (guard for double-call)
  sel.querySelectorAll('optgroup').forEach(g => g.remove());
  _cmpServiceTypes.forEach(t => {
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

function _clearCmpAutoEmails() {
  _chipTo.removeEmails(_cmpAutoToEmails);
  _chipCc.removeEmails(_cmpAutoCcEmails);
  _cmpAutoToEmails = [];
  _cmpAutoCcEmails = [];
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cx-subtype').addEventListener('change', e => {
    const id  = e.target.value;
    const sel = document.getElementById('cx-service');
    _clearCmpAutoEmails();
    sel.innerHTML = '<option value="">— เลือก Service เพื่อเพิ่ม To / CC —</option>';
    document.getElementById('cx-service-row').style.display = 'none';
    if (!id) return;

    for (const t of _cmpServiceTypes) {
      const st = (t.subtypes || []).find(s => s.id === id);
      if (!st) continue;
      if ((st.services || []).length > 0) {
        st.services.forEach(svc => {
          const o = document.createElement('option');
          o.value       = svc.id;
          o.textContent = svc.name
            + (svc.email_to?.length ? ` (To:${svc.email_to.length})` : '')
            + (svc.email_cc?.length ? ` (CC:${svc.email_cc.length})` : '');
          o.dataset.to  = JSON.stringify(svc.email_to || []);
          o.dataset.cc  = JSON.stringify(svc.email_cc || []);
          sel.appendChild(o);
        });
        document.getElementById('cx-service-row').style.display = '';
      } else if ((st.emails || []).length > 0) {
        st.emails.forEach(em => {
          _chipCc.addEmails([em]);
          _cmpAutoCcEmails.push(em.trim().toLowerCase());
        });
        Toast.success(`เพิ่ม ${st.emails.length} CC จาก ${st.name}`);
      }
      return;
    }
  });

  document.getElementById('cx-service').addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    _clearCmpAutoEmails();
    if (!opt?.value) return;

    let emailTo = [], emailCc = [];
    try { emailTo = JSON.parse(opt.dataset.to || '[]'); } catch {}
    try { emailCc = JSON.parse(opt.dataset.cc || '[]'); } catch {}

    emailTo.forEach(em => {
      _chipTo.addEmails([em]);
      _cmpAutoToEmails.push(em.trim().toLowerCase());
    });
    emailCc.forEach(em => {
      _chipCc.addEmails([em]);
      _cmpAutoCcEmails.push(em.trim().toLowerCase());
    });

    if (emailTo.length || emailCc.length) {
      const name = opt.textContent.split(' (')[0].trim();
      Toast.success(`เพิ่ม ${emailTo.length} To + ${emailCc.length} CC จาก ${name}`);
    }
  });
});

/* ══════════════════════════════════════════════════════════
   COMPOSE
══════════════════════════════════════════════════════════ */
let _composeMode = 'new';

function openCompose(mode) {
  // If a previous compose is still active (e.g. user hit Reply on a new email
  // while another compose was open), flush its pending draft under the OLD
  // slot before we overwrite the DOM with fresh content.
  if (_currentDraftSlot) {
    clearTimeout(_draftSaveTimer);
    _draftSaveTimer = null;
    _saveDraftNow();
  }

  _composeMode = mode;
  const m = _openMsg;
  const titles = { new: 'เขียน Email ใหม่', reply: `Reply: ${m?.subject||''}`, replyAll: `Reply All: ${m?.subject||''}`, forward: `Fwd: ${m?.subject||''}` };
  document.getElementById('compose-title').textContent = titles[mode] || 'เขียน Email';

  const subjEl = document.getElementById('compose-subject');
  const bodyEl = document.getElementById('compose-body');

  // 1. Fresh state — quote for reply, forwarded block for forward, empty for new
  _chipTo.setEmails('');
  _chipCc.setEmails('');
  subjEl.value = '';
  bodyEl.innerHTML = '';

  // Reset service-type dropdowns + clear any auto-filled emails from last compose
  _cmpAutoToEmails = [];
  _cmpAutoCcEmails = [];
  document.getElementById('cx-subtype').value = '';
  document.getElementById('cx-service').innerHTML = '<option value="">— เลือก Service เพื่อเพิ่ม To / CC —</option>';
  document.getElementById('cx-service-row').style.display = 'none';
  loadServiceTypesForCompose();

  if (mode === 'reply' && m) {
    _chipTo.setEmails(m.from?.email || '');
    subjEl.value = m.subject?.startsWith('Re:') ? m.subject : `Re: ${m.subject}`;
    bodyEl.innerHTML = buildQuote(m);
  } else if (mode === 'replyAll' && m) {
    const replyTo = m.reply_to?.[0]?.email || m.from?.email || '';
    const others  = (m.to||[]).map(a=>a.email).filter(e => e !== Auth.getUser?.()?.email);
    _chipTo.setEmails([replyTo, ...others].join(','));
    _chipCc.setEmails((m.cc||[]).map(a=>a.email).join(','));
    subjEl.value = m.subject?.startsWith('Re:') ? m.subject : `Re: ${m.subject}`;
    bodyEl.innerHTML = buildQuote(m);
  } else if (mode === 'forward' && m) {
    subjEl.value = m.subject?.startsWith('Fwd:') ? m.subject : `Fwd: ${m.subject}`;
    bodyEl.innerHTML = buildForwardBody(m);
  }

  // 2. Draft restore — check for a saved draft in this slot and overlay
  _currentDraftSlot = _draftSlot(mode, m?.uid);
  const draft = _loadDraft(_currentDraftSlot);
  const ind   = document.getElementById('compose-save-ind');
  if (draft && (draft.body?.trim() || draft.to || draft.subject)) {
    _chipTo.setEmails(draft.to || '');
    _chipCc.setEmails(draft.cc || '');
    subjEl.value    = draft.subject || '';
    bodyEl.innerHTML = draft.body    || '';
    ind.dataset.state = 'saved';
    document.getElementById('compose-save-time').textContent =
      'กู้คืน draft · ' + new Date(draft.savedAt).toLocaleTimeString('th-TH', { hour12: false });
    Toast.info(`<i data-icon="edit"></i> กู้คืน draft ที่บันทึกไว้เมื่อ ${new Date(draft.savedAt).toLocaleString('th-TH', { hour12: false })}`, 4000);
  } else {
    ind.dataset.state = 'idle';
    document.getElementById('compose-save-time').textContent = '—';
  }

  // 3. Show + focus + wire the image-resize helper
  document.getElementById('compose-overlay').classList.add('show');
  document.getElementById('compose-status').textContent = '';
  _cxUpdatePlaceholder();
  setupImageResize(bodyEl);
  if (mode === 'new' && !draft?.to) _chipTo.focus(); else bodyEl.focus();
}

function resolveCids(html, cidMap, uid, folder) {
  const token = Auth.getToken() || '';
  const base  = API_BASE;
  return html.replace(/\bcid:([^\s"'>\)]+)/gi, (match, cid) => {
    cid = cid.replace(/[;.,]+$/, '');
    if (cidMap[cid]) return cidMap[cid];
    const bare = cid.replace(/@.*$/, '');
    if (cidMap[bare]) return cidMap[bare];
    return `${base}/inbox/cid.php?uid=${encodeURIComponent(uid)}&folder=${encodeURIComponent(folder || 'INBOX')}&cid=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}`;
  });
}

function buildQuote(m) {
  const dt     = m.date ? new Date(m.date).toLocaleString('th-TH', { hour12: false }) : '';
  const from   = m.from?.name ? `${m.from.name} &lt;${m.from.email}&gt;` : (m.from?.email || '');
  const rawBody = m.is_html ? m.body : `<pre style="white-space:pre-wrap">${escHtml(m.plain || m.body || '')}</pre>`;
  const body   = m.is_html ? resolveCids(rawBody, m.cid_map || {}, m.uid, m.folder || currentFolder) : rawBody;
  return `<br><br><div style="border-left:3px solid #ccc;padding-left:12px;color:#666;margin-top:8px">
    <p style="margin:0 0 4px;font-size:12px">On ${dt}, ${from} wrote:</p>
    ${body}
  </div>`;
}

function buildForwardBody(m) {
  const dt     = m.date ? new Date(m.date).toLocaleString('th-TH', { hour12: false }) : '';
  const from   = m.from?.name ? `${m.from.name} &lt;${m.from.email}&gt;` : (m.from?.email || '');
  const rawBody = m.is_html ? m.body : `<pre style="white-space:pre-wrap">${escHtml(m.plain || m.body || '')}</pre>`;
  const body   = m.is_html ? resolveCids(rawBody, m.cid_map || {}, m.uid, m.folder || currentFolder) : rawBody;
  return `<br><br><hr style="border:none;border-top:1px solid #ccc;margin:12px 0">
    <p style="font-size:12px;color:#666;margin:0 0 6px">
      <strong>---------- Forwarded message ---------</strong><br>
      From: ${from}<br>
      Date: ${dt}<br>
      Subject: ${escHtml(m.subject || '')}<br>
      To: ${(m.to||[]).map(a=>escHtml(a.email)).join(', ')}
    </p>
    ${body}`;
}

// Close = keep draft (auto-save). To wipe the draft, user must click "ทิ้ง Draft".
function closeCompose() {
  if (_currentDraftSlot) _saveDraftNow(); // flush pending debounced save
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = null;
  document.getElementById('compose-overlay').classList.remove('show');
}

// Close without saving (used after send-success or after discard).
function _closeComposeSilent() {
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = null;
  _currentDraftSlot = null;
  document.getElementById('compose-overlay').classList.remove('show');
}

// Convert all <img> srcs to data URIs so PHP can embed them as CID attachments.
// Handles both proxy URLs (cid.php) and any blob: URLs the browser may have created.
async function normalizeImagesForSend(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const imgs = tmp.querySelectorAll('img[src]');
  if (!imgs.length) return html;

  await Promise.all([...imgs].map(async img => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return; // already a data URI — leave as-is
    try {
      const resp = await fetch(src);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const dataUri = await new Promise(resolve => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
      img.setAttribute('src', dataUri);
    } catch (_) { /* leave src unchanged on failure */ }
  }));

  return tmp.innerHTML;
}

async function sendCompose() {
  const to      = _chipTo.getEmails();
  const cc      = _chipCc.getEmails();
  const subject = document.getElementById('compose-subject').value.trim();
  let   body    = document.getElementById('compose-body').innerHTML.trim();

  if (!to || !subject || !body) { Toast.warn('กรอก To, Subject, Body ให้ครบก่อน'); return; }

  const btn = document.getElementById('compose-send-btn');
  const st  = document.getElementById('compose-status');
  btn.disabled = true; st.textContent = '⏳ กำลังส่ง…';

  // Convert proxy/blob image URLs → data URIs so PHP can embed them as CID attachments
  body = await normalizeImagesForSend(body);

  const payload = { to, cc, subject, body, is_html: true };
  if (_openMsg && (_composeMode === 'reply' || _composeMode === 'replyAll')) {
    payload.in_reply_to = _openMsg.message_id;
    payload.references  = _openMsg.message_id;
  }

  const res = await API.inbox.send(payload);
  btn.disabled = false;
  st.textContent = '';

  if (!res?.ok) {
    st.innerHTML = '<i data-icon="alert-triangle"></i> ส่งไม่สำเร็จ: ' + (res?.data?.message || 'unknown error');
    st.style.color = '#ef4444';
    return;
  }
  trackInboxSend(_composeMode || 'new');
  Toast.success('<i data-icon="upload"></i> ส่ง Email สำเร็จ!');
  // Send succeeded — wipe the draft slot so it doesn't linger.
  if (_currentDraftSlot) { _clearDraft(_currentDraftSlot); }
  _closeComposeSilent();
}

/* ══════════════════════════════════════════════════════════
   RICH-TEXT COMMANDS (toolbar buttons)
══════════════════════════════════════════════════════════ */
function cxExec(command, value = null) {
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(command, false, value);
  document.getElementById('compose-body')?.focus();
  _cxUpdatePlaceholder();
  _scheduleDraftSave();
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
    _scheduleDraftSave();
  }
}
function cxInsertImageFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    document.execCommand('insertHTML', false, `<img src="${r.result}" style="max-width:60%">`);
    _cxUpdatePlaceholder();
    setupImageResize(document.getElementById('compose-body'));
    _scheduleDraftSave();
  };
  r.readAsDataURL(file);
}
function _cxUpdatePlaceholder() {
  const el = document.getElementById('compose-body');
  if (!el) return;
  const empty = !el.textContent.trim() && !el.querySelector('img');
  el.dataset.empty = empty ? 'true' : 'false';
}

/* ══════════════════════════════════════════════════════════
   DRAFT AUTO-SAVE (team-scoped, per-message slots)

   Key:   som_inbox_drafts_{team}_{userId}
   Value: { "new": {...}, "reply_1234": {...}, "forward_5678": {...} }
   Slot:  "new" for compose-new; else "{mode}_{msgUid}"
══════════════════════════════════════════════════════════ */
const _DRAFT_TTL_DAYS = 30;
let _currentDraftSlot = null;
let _draftSaveTimer   = null;

function _draftStorageKey() {
  const u    = Auth.getUser?.() || {};
  const team = u.team || 'default';
  const uid  = u.id || u.sub || 'anon';
  return `som_inbox_drafts_${team}_${uid}`;
}
function _draftSlot(mode, msgUid) {
  return mode === 'new' ? 'new' : `${mode}_${msgUid || 'none'}`;
}
function _getDraftStore() {
  try {
    const raw   = localStorage.getItem(_draftStorageKey());
    const store = raw ? JSON.parse(raw) : {};
    // Prune stale drafts (> 30 days)
    const cutoff = Date.now() - _DRAFT_TTL_DAYS * 86400_000;
    let mutated = false;
    for (const k of Object.keys(store)) {
      const t = store[k]?.savedAt ? new Date(store[k].savedAt).getTime() : 0;
      if (t && t < cutoff) { delete store[k]; mutated = true; }
    }
    if (mutated) _setDraftStore(store);
    return store;
  } catch (_) { return {}; }
}
function _setDraftStore(store) {
  try { localStorage.setItem(_draftStorageKey(), JSON.stringify(store)); }
  catch (_) { /* quota exceeded — ignore */ }
}
function _loadDraft(slot) {
  return _getDraftStore()[slot] || null;
}
function _clearDraft(slot) {
  const store = _getDraftStore();
  delete store[slot];
  _setDraftStore(store);
}

function _scheduleDraftSave() {
  if (!_currentDraftSlot) return;
  const ind = document.getElementById('compose-save-ind');
  if (ind) {
    ind.dataset.state = 'saving';
    document.getElementById('compose-save-time').textContent = 'กำลังบันทึก…';
  }
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(_saveDraftNow, 1500);
}

function _saveDraftNow() {
  if (!_currentDraftSlot) return;
  const to      = _chipTo?.getEmails() || '';
  const cc      = _chipCc?.getEmails() || '';
  const subject = document.getElementById('compose-subject')?.value || '';
  const bodyEl  = document.getElementById('compose-body');
  const body    = bodyEl?.innerHTML || '';
  const hasContent = to || cc || subject.trim() || bodyEl?.textContent?.trim() || bodyEl?.querySelector('img');

  const ind    = document.getElementById('compose-save-ind');
  const timeEl = document.getElementById('compose-save-time');

  if (!hasContent) {
    // Empty compose — no draft to keep
    _clearDraft(_currentDraftSlot);
    if (ind)    ind.dataset.state = 'idle';
    if (timeEl) timeEl.textContent = '—';
    return;
  }

  const store = _getDraftStore();
  store[_currentDraftSlot] = {
    mode: _composeMode, to, cc, subject, body,
    replyToUid: _openMsg?.uid || null,
    savedAt: new Date().toISOString(),
  };
  _setDraftStore(store);

  if (ind)    ind.dataset.state = 'saved';
  if (timeEl) timeEl.textContent = 'บันทึก ' + new Date().toLocaleTimeString('th-TH', { hour12: false });
}

async function discardDraft() {
  const bodyEl = document.getElementById('compose-body');
  const dirty = (
    _chipTo?.getEmails() ||
    _chipCc?.getEmails() ||
    (document.getElementById('compose-subject')?.value || '').trim() ||
    (bodyEl?.textContent || '').trim() ||
    bodyEl?.querySelector('img')
  );
  if (dirty) {
    const ok = await confirmDialog(
      'draft นี้จะถูกลบทิ้งและกู้คืนไม่ได้',
      'ทิ้ง Draft?',
      { confirmText: 'ทิ้ง Draft', cancelText: 'เขียนต่อ', variant: 'danger' }
    );
    if (!ok) return;
  }
  if (_currentDraftSlot) _clearDraft(_currentDraftSlot);
  _closeComposeSilent();
  Toast.info('🗑 ทิ้ง draft แล้ว');
}

// ── Wire up input / paste / drop on the editor (once at parse-time) ──
(function bindComposeEditorHandlers() {
  const bodyEl = document.getElementById('compose-body');
  if (!bodyEl) return;

  bodyEl.addEventListener('input', () => {
    _cxUpdatePlaceholder();
    _scheduleDraftSave();
  });
  bodyEl.addEventListener('paste', e => {
    // Handle image paste (Cmd/Ctrl+V a copied image) — otherwise fall through
    // and let the browser paste text/HTML normally.
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        cxInsertImageFile(item.getAsFile());
        return;
      }
    }
    setTimeout(() => { _cxUpdatePlaceholder(); _scheduleDraftSave(); }, 0);
  });
  bodyEl.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) {
      e.preventDefault();
      cxInsertImageFile(f);
    }
  });
  bodyEl.addEventListener('dragover', e => e.preventDefault());
  bodyEl.addEventListener('blur', () => {
    if (_currentDraftSlot) _saveDraftNow();
  });

  // Also trigger a draft save when the To/Cc/Subject fields change.
  ['compose-subject', 'chip-to-input', 'chip-cc-input'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', _scheduleDraftSave);
    el.addEventListener('blur',  () => { if (_currentDraftSlot) _saveDraftNow(); });
  });

  // Best-effort save before the tab closes / reloads.
  window.addEventListener('beforeunload', () => {
    if (_currentDraftSlot) _saveDraftNow();
  });
})();

/* ══════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════ */
function fmtTime(iso) {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (now - d < 7 * 86400000)
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
}

// Search
document.getElementById('list-search').addEventListener('input', e => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _search = e.target.value; renderList(); }, 200);
});

// Keyboard shortcuts
// Guard: skip when typing in ANY input/textarea, or inside a contenteditable
// (use isContentEditable — .contentEditable returns "inherit" for child nodes
// that Chrome wraps typed text in, breaking the old check). Also skip when a
// modifier key is held so Cmd/Ctrl+C/V/R/E work as normal clipboard/browser
// shortcuts inside the compose editor.
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT') return;
  if (t?.isContentEditable) return;
  if (e.key === 'Escape') closeCompose();
  else if (e.key === 'c' || e.key === 'C') openCompose('new');
  else if (e.key === 'r' || e.key === 'R') { if (_openMsg) openCompose('reply'); }
  else if (e.key === 'e' || e.key === 'E') { if (_uid) archiveEmail(); }
});

/* ══════════════════════════════════════════════════════════
   EMAIL BODY RENDERER — proxies cid: images through /api/inbox/cid.php
   (browsers block the cid: scheme via CSP; proxy URLs are 'self' → allowed)
══════════════════════════════════════════════════════════ */
function renderEmailBody(container, rawHtml, uid, folder, cidMap = {}) {
  const token  = Auth.getToken() || '';
  const base   = API_BASE; // e.g. "/centralize-som/api"

  // 1. Replace cid: references — use pre-built data URIs from cid_map first,
  //    fall back to cid.php proxy only for CIDs not already in the map.
  let html = rawHtml.replace(/\bcid:([^\s"'>\)]+)/gi, (match, cid) => {
    cid = cid.replace(/[;.,]+$/, ''); // strip trailing punctuation
    // Direct match
    if (cidMap[cid]) return cidMap[cid];
    // Bare match (strip domain suffix, e.g. "image1@mail.gmail.com" → "image1")
    const bare = cid.replace(/@.*$/, '');
    if (cidMap[bare]) return cidMap[bare];
    // Fallback: proxy through cid.php
    return `${base}/inbox/cid.php?uid=${encodeURIComponent(uid)}&folder=${encodeURIComponent(folder || 'INBOX')}&cid=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}`;
  });

  // 2. Sanitize: strip <script> and inline event handlers
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');

  // 3. Render in sandboxed iframe (isolates CSS + JS from parent page)
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%;border:none;min-height:200px;background:#fff;border-radius:6px;display:block;';
  // allow-same-origin: needed to read scrollHeight for auto-resize
  iframe.setAttribute('sandbox', 'allow-same-origin allow-popups');
  iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6;
             padding: 16px; margin: 0; word-break: break-word; color: #111; }
      img  { max-width: 100%; height: auto; }
      a    { color: #1a73e8; }
      pre  { white-space: pre-wrap; }
    </style>
  </head><body>${html}</body></html>`;
  container.innerHTML = '';
  container.appendChild(iframe);

  // 4. Auto-resize iframe height to fit content
  const resize = () => {
    try {
      const h = iframe.contentDocument?.body?.scrollHeight;
      if (h) iframe.style.height = h + 24 + 'px';
    } catch (e) {}
  };
  iframe.onload = resize;
  setTimeout(resize, 300); // fallback
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
_chipTo = createChipInput('chip-to-wrap', 'chip-to-input');
_chipCc = createChipInput('chip-cc-wrap', 'chip-cc-input');
loadFolders();
loadList(true);
// Auto-refresh every 60s
setInterval(() => { if (!document.hidden) { loadList(true); loadFolders(); } }, 60_000);

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_clearCmpAutoEmails", { configurable: true, get: () => _clearCmpAutoEmails, set: (v) => { _clearCmpAutoEmails = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_clearDraft", { configurable: true, get: () => _clearDraft, set: (v) => { _clearDraft = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_closeComposeSilent", { configurable: true, get: () => _closeComposeSilent, set: (v) => { _closeComposeSilent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_cxUpdatePlaceholder", { configurable: true, get: () => _cxUpdatePlaceholder, set: (v) => { _cxUpdatePlaceholder = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_draftSlot", { configurable: true, get: () => _draftSlot, set: (v) => { _draftSlot = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_draftStorageKey", { configurable: true, get: () => _draftStorageKey, set: (v) => { _draftStorageKey = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_getDraftStore", { configurable: true, get: () => _getDraftStore, set: (v) => { _getDraftStore = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_loadDraft", { configurable: true, get: () => _loadDraft, set: (v) => { _loadDraft = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_saveDraftNow", { configurable: true, get: () => _saveDraftNow, set: (v) => { _saveDraftNow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_scheduleDraftSave", { configurable: true, get: () => _scheduleDraftSave, set: (v) => { _scheduleDraftSave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setDraftStore", { configurable: true, get: () => _setDraftStore, set: (v) => { _setDraftStore = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "archiveEmail", { configurable: true, get: () => archiveEmail, set: (v) => { archiveEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildForwardBody", { configurable: true, get: () => buildForwardBody, set: (v) => { buildForwardBody = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildQuote", { configurable: true, get: () => buildQuote, set: (v) => { buildQuote = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeCompose", { configurable: true, get: () => closeCompose, set: (v) => { closeCompose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "createChipInput", { configurable: true, get: () => createChipInput, set: (v) => { createChipInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cxExec", { configurable: true, get: () => cxExec, set: (v) => { cxExec = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cxInsertImageFile", { configurable: true, get: () => cxInsertImageFile, set: (v) => { cxInsertImageFile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cxInsertLink", { configurable: true, get: () => cxInsertLink, set: (v) => { cxInsertLink = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteEmail", { configurable: true, get: () => deleteEmail, set: (v) => { deleteEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "discardDraft", { configurable: true, get: () => discardDraft, set: (v) => { discardDraft = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTime", { configurable: true, get: () => fmtTime, set: (v) => { fmtTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFolders", { configurable: true, get: () => loadFolders, set: (v) => { loadFolders = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadList", { configurable: true, get: () => loadList, set: (v) => { loadList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMore", { configurable: true, get: () => loadMore, set: (v) => { loadMore = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadServiceTypesForCompose", { configurable: true, get: () => loadServiceTypesForCompose, set: (v) => { loadServiceTypesForCompose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "normalizeImagesForSend", { configurable: true, get: () => normalizeImagesForSend, set: (v) => { normalizeImagesForSend = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCompose", { configurable: true, get: () => openCompose, set: (v) => { openCompose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEmail", { configurable: true, get: () => openEmail, set: (v) => { openEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickArchive", { configurable: true, get: () => quickArchive, set: (v) => { quickArchive = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickDelete", { configurable: true, get: () => quickDelete, set: (v) => { quickDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickStar", { configurable: true, get: () => quickStar, set: (v) => { quickStar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshList", { configurable: true, get: () => refreshList, set: (v) => { refreshList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderEmailBody", { configurable: true, get: () => renderEmailBody, set: (v) => { renderEmailBody = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderFolders", { configurable: true, get: () => renderFolders, set: (v) => { renderFolders = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderList", { configurable: true, get: () => renderList, set: (v) => { renderList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resolveCids", { configurable: true, get: () => resolveCids, set: (v) => { resolveCids = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectFolder", { configurable: true, get: () => selectFolder, set: (v) => { selectFolder = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendCompose", { configurable: true, get: () => sendCompose, set: (v) => { sendCompose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFilter", { configurable: true, get: () => setFilter, set: (v) => { setFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showEmpty", { configurable: true, get: () => showEmpty, set: (v) => { showEmpty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showReader", { configurable: true, get: () => showReader, set: (v) => { showReader = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleRead", { configurable: true, get: () => toggleRead, set: (v) => { toggleRead = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleStar", { configurable: true, get: () => toggleStar, set: (v) => { toggleStar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateReaderButtons", { configurable: true, get: () => updateReaderButtons, set: (v) => { updateReaderButtons = v; } }); } catch (e) {}
})();
