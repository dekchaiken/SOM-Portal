// my-team — page script, extracted from my-team.html.
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
Layout.render('my-team');

// Role labels are team-agnostic (roles apply the same to SM, TS, or any team).
// Uses Roles.label() from utils.js so labels stay consistent across the app.
const ROLE_CLASS = {
  sm_admin:     'rb-admin',
  sm_lead:      'rb-lead',
  sm_user:      'rb-user',
  dev_sm:       'rb-dev',
  external:     'rb-user',
  super_admin:  'rb-admin',
  super_viewer: 'rb-lead',
};
// Per-team accent color for team badges when viewing "All teams"
const TEAM_COLORS = {
  sm: '#F26419', ts: '#6366F1', ns: '#0891B2', ps: '#7E22CE',
  tc: '#B91C1C', ma: '#15803D', vc: '#A16207', on: '#DB2777',
};
function teamColor(slug) { return TEAM_COLORS[slug] || '#525252'; }
const BG_PALETTE = ['#F26419','#6366F1','#0891B2','#7E22CE','#B91C1C','#15803D','#A16207','#DB2777','#059669','#EA580C'];

const State = {
  me: null,
  myRole: '',
  team: '',
  allTeams: false,       // true when super_admin is viewing All-teams
  members: [],
  filterRole: 'all',
  filterTeam: 'all',     // only meaningful when allTeams=true
  search: '',
  editingId: null,
  pendingAvatar: null,   // data URL or null
  rmAvatar: false,       // flag to clear avatar
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function initials(name, nick) {
  const src = (nick || name || '?').trim();
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
}
function colorFor(id) {
  let h = 0;
  for (let i = 0; i < (id||'').length; i++) h = ((h << 5) - h) + id.charCodeAt(i);
  return BG_PALETTE[Math.abs(h) % BG_PALETTE.length];
}
function isAdmin() {
  // super_viewer is read-only — NOT an admin here.
  return ['sm_admin', 'dev_sm', 'super_admin'].includes(State.myRole);
}
function isReadOnly() {
  return State.myRole === 'super_viewer';
}
function canEdit(memberId) {
  if (isReadOnly()) return false;
  return memberId === State.me || isAdmin();
}

async function load() {
  const res = await API.myTeam.list();
  const grid = document.getElementById('mt-grid');
  if (!res?.ok) {
    grid.innerHTML = `<div class="mt-empty">
      <div class="ic"><i data-icon=\"alert-triangle\"></i></div>
      <h3>โหลดรายชื่อทีมไม่สำเร็จ</h3>
      <p>${esc(res?.data?.message || 'Unknown error')}</p>
    </div>`;
    return;
  }
  const d = res.data.data || res.data || {};
  State.team     = d.team     || '';
  State.allTeams = !!d.all_teams;
  State.me       = d.me       || '';
  State.myRole   = d.my_role  || '';
  State.members  = d.members  || [];

  const badge = document.getElementById('mt-team-badge');
  if (State.allTeams) {
    badge.textContent = 'ALL TEAMS';
    // Build unique team chips for filtering
    buildTeamChips();
  } else {
    badge.textContent = (State.team || 'team').toUpperCase();
  }

  const sub = isReadOnly() ? 'อ่านอย่างเดียว (super_viewer)'
            : isAdmin()    ? 'admin แก้ไขได้ทุกคน'
                           : 'แก้ไขได้เฉพาะโปรไฟล์ของตัวเอง';
  const scope = State.allTeams
    ? `ทุกทีมที่มีอยู่ในตารางเวร · ${State.members.length} คน`
    : `ทีม ${State.team.toUpperCase()} ที่มีอยู่ในตารางเวร · ${State.members.length} คน`;
  document.getElementById('mt-sub').textContent = `${scope} · ${sub}`;
  render();
}

function buildTeamChips() {
  // Insert team chips before the count pill in the toolbar.
  const bar = document.querySelector('.mt-toolbar');
  if (!bar || document.getElementById('mt-team-chips')) return;
  const wrap = document.createElement('div');
  wrap.id = 'mt-team-chips';
  wrap.style.display = 'flex';
  wrap.style.gap = '6px';
  wrap.style.flexWrap = 'wrap';
  wrap.style.paddingLeft = '10px';
  wrap.style.borderLeft = '1px solid var(--border)';
  wrap.style.marginLeft = '2px';
  const teams = Array.from(new Set(State.members.map(m => m.team).filter(Boolean))).sort();
  const mk = (slug, label, on) => {
    const clr = slug === 'all' ? 'var(--accent)' : teamColor(slug);
    return `<div class="mt-chip${on ? ' on' : ''}" data-team="${slug}"
              style="${on ? `background:${clr};border-color:${clr}` : `color:${clr};border-color:${clr}55`}">${label}</div>`;
  };
  wrap.innerHTML = mk('all','All teams', true) + teams.map(t => mk(t, t.toUpperCase(), false)).join('');
  bar.querySelector('.mt-count-pill').insertAdjacentElement('beforebegin', wrap);
  wrap.querySelectorAll('.mt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      wrap.querySelectorAll('.mt-chip').forEach(c => {
        c.classList.remove('on');
        const cs = c.dataset.team;
        const clr = cs === 'all' ? 'var(--accent)' : teamColor(cs);
        c.setAttribute('style', `color:${clr};border-color:${clr}55`);
      });
      chip.classList.add('on');
      const cs = chip.dataset.team;
      const clr = cs === 'all' ? 'var(--accent)' : teamColor(cs);
      chip.setAttribute('style', `background:${clr};border-color:${clr};color:#fff`);
      State.filterTeam = cs;
      render();
    });
  });
}

function render() {
  const grid = document.getElementById('mt-grid');
  const q = State.search.toLowerCase();
  const rows = State.members.filter(m => {
    if (State.filterRole !== 'all' && m.role !== State.filterRole) return false;
    if (State.allTeams && State.filterTeam !== 'all' && m.team !== State.filterTeam) return false;
    if (!q) return true;
    return [m.name, m.name_th, m.nickname, m.emp_id, m.email, m.phone, m.tmn_id, m.net_home, m.net_mobile, m.team]
      .some(v => (v || '').toLowerCase().includes(q));
  });
  document.getElementById('mt-count').textContent = rows.length + ' คน';

  if (!rows.length) {
    grid.innerHTML = `<div class="mt-empty">
      <div class="ic"><i data-icon=\"users\"></i></div>
      <h3>ไม่พบรายชื่อ</h3>
      <p>ลองล้าง filter หรือเช็ค admin ว่าติ๊ก "รวมในตารางเวร" ให้สมาชิกทีมหรือยัง</p>
    </div>`;
    return;
  }

  grid.innerHTML = rows.map(m => {
    const rcls = ROLE_CLASS[m.role] || 'rb-user';
    const rlbl = (typeof Roles !== 'undefined' && Roles.label) ? Roles.label(m.role) : m.role;
    const bg = colorFor(m.id);
    const me = m.id === State.me;
    const editable = canEdit(m.id);
    const avContent = m.avatar_url
      ? `<img src="${esc(m.avatar_url)}" alt="${esc(m.name)}" onerror="this.replaceWith(Object.assign(document.createTextNode('${esc(initials(m.name,m.nickname))}'), {}))">`
      : esc(initials(m.name, m.nickname));
    const teamBadge = State.allTeams && m.team ? `
      <span class="mt-team-chip" style="background:${teamColor(m.team)}22;color:${teamColor(m.team)};border:1px solid ${teamColor(m.team)}55">${esc(m.team.toUpperCase())}</span>` : '';

    const row = (icon, val, placeholder) => {
      const has = !!(val && val.trim());
      return `<div class="mt-row">
        <span class="k">${icon}</span>
        <span class="v${has ? '' : ' muted'}">${has ? esc(val) : placeholder}</span>
      </div>`;
    };

    // abbr for banner watermark: use member's own team slug (all-teams mode) or current team
    const cardAbbr = (State.allTeams && m.team ? m.team : State.team).toUpperCase();

    return `
      <div class="mt-card" data-mid="${esc(m.id)}">
        <div class="banner" data-abbr="${esc(cardAbbr)}">
          ${me ? '<span class="self-mark">You</span>' : ''}
          <button class="copy-ic" title="คัดลอกข้อมูลติดต่อ"
                  onclick="event.stopPropagation(); copyMember('${esc(m.id)}', this)"><i data-icon=\"clipboard\"></i></button>
        </div>
        <div class="body">
          <div class="mt-av-wrap">
            <div class="mt-av" style="background:linear-gradient(135deg, ${bg}22, var(--bg-card)); color:${bg}">
              ${avContent}
            </div>
          </div>
          <div class="mt-name">${esc(m.name)}</div>
          <div class="mt-name-th${m.name_th ? '' : ' miss'}">
            ${m.name_th ? esc(m.name_th) : 'ยังไม่ระบุชื่อไทย'}
          </div>
          <div class="mt-nick${m.nickname ? '' : ' miss'}">
            <span class="p">"${esc(m.nickname || 'ยังไม่ระบุ nickname')}"</span>
          </div>
          <div class="mt-role-row">
            <span class="mt-role ${rcls}">${esc(rlbl)}</span>
            ${teamBadge}
            <span class="mt-emp-chip${m.emp_id ? '' : ' miss'}">
              <span class="k"><i data-icon=\"id-card\"></i></span>${m.emp_id ? esc(m.emp_id) : 'ยังไม่ระบุ'}
            </span>
          </div>
          <div class="mt-contact">
            ${row('<i data-icon=\"mail\"></i>', m.email,       'ยังไม่ระบุ email')}
            ${row('<i data-icon=\"smartphone\"></i>', m.phone,      'ยังไม่ระบุเบอร์')}
            ${row('<img src="./uploads/tmn.png" alt="TMN">', m.tmn_id ? 'TMN.ID ' + m.tmn_id : '', 'ยังไม่ระบุ TMN.ID')}
            ${row('<i data-icon=\"home\"></i>', m.net_home,   'ยังไม่ระบุเน็ตบ้าน')}
            ${row('<i data-icon=\"wifi\"></i>', m.net_mobile, 'ยังไม่ระบุมือถือ')}
          </div>
          <div class="mt-actions">
            <button class="mt-btn" onclick="viewProfile('${esc(m.id)}')">Profile</button>
            <button class="mt-btn primary" onclick="openEditModal('${esc(m.id)}')" ${editable ? '' : 'disabled'}>
              ${editable ? '<i data-icon=\"pencil\"></i> Edit' : '<i data-icon=\"lock\"></i> Locked'}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function viewProfile(id) { window.location.href = './profile.html?user=' + encodeURIComponent(id); }

document.getElementById('mt-search').addEventListener('input', (e) => {
  State.search = e.target.value.trim();
  render();
});
document.querySelectorAll('.mt-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.mt-chip').forEach(c => c.classList.remove('on'));
    chip.classList.add('on');
    State.filterRole = chip.dataset.role;
    render();
  });
});

/* ─── Edit Modal ─── */
function openEditModal(id) {
  const m = State.members.find(x => x.id === id);
  if (!m) return;
  State.editingId = id;
  State.pendingAvatar = null;
  State.rmAvatar = false;

  const bg = colorFor(m.id);
  const avEl = document.getElementById('mt-m-av');
  avEl.style.background = bg;
  const avInner = m.avatar_url
    ? `<img src="${esc(m.avatar_url)}" alt="">`
    : `<span>${esc(initials(m.name, m.nickname))}</span>`;
  avEl.innerHTML = avInner;

  document.getElementById('mt-m-title').textContent = m.name;
  const rlbl2 = (typeof Roles !== 'undefined' && Roles.label) ? Roles.label(m.role) : m.role;
  const teamSuffix = State.allTeams && m.team ? ` · ${m.team.toUpperCase()}` : '';
  document.getElementById('mt-m-sub').textContent = `"${m.nickname || '—'}" · ${rlbl2}${teamSuffix}`;
  document.getElementById('mt-in-name-th').value     = m.name_th    || '';
  document.getElementById('mt-in-nickname').value    = m.nickname   || '';
  document.getElementById('mt-in-emp-id').value      = m.emp_id     || '';
  document.getElementById('mt-in-phone').value       = m.phone      || '';
  document.getElementById('mt-in-tmn-id').value      = m.tmn_id     || '';
  document.getElementById('mt-in-net-home').value    = m.net_home   || '';
  document.getElementById('mt-in-net-mobile').value  = m.net_mobile || '';

  // Nickname: user can edit own via profile.php; admin can edit anyone via users PUT.
  // Both endpoints accept nickname, so always allow.
  document.getElementById('mt-fld-nickname').style.display = '';

  document.getElementById('mt-modal-overlay').classList.add('on');
}
function closeEditModal() {
  document.getElementById('mt-modal-overlay').classList.remove('on');
  State.editingId = null;
  State.pendingAvatar = null;
  State.rmAvatar = false;
  document.getElementById('mt-avatar-file').value = '';
}
document.getElementById('mt-modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'mt-modal-overlay') closeEditModal();
});

/* ─── Avatar upload — reuse compress logic pattern from profile.html ─── */
document.getElementById('mt-m-av-wrap').addEventListener('click', () => {
  document.getElementById('mt-avatar-file').click();
});
document.getElementById('mt-avatar-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { Toast.show('รูปใหญ่เกิน 5MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('mt-avatar-canvas');
      const size = 200;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Square-crop center
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      State.pendingAvatar = dataUrl;
      State.rmAvatar = false;
      const avEl = document.getElementById('mt-m-av');
      avEl.innerHTML = `<img src="${dataUrl}" alt="">`;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

/* ─── Save ─── */
async function saveEdit() {
  const id = State.editingId;
  if (!id) return;
  const btn = document.getElementById('mt-save-btn');
  btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก…';

  const isSelf = (id === State.me);
  const payload = {
    name_th:    document.getElementById('mt-in-name-th').value.trim(),
    nickname:   document.getElementById('mt-in-nickname').value.trim(),
    emp_id:     document.getElementById('mt-in-emp-id').value.trim(),
    phone:      document.getElementById('mt-in-phone').value.trim(),
    tmn_id:     document.getElementById('mt-in-tmn-id').value.trim(),
    net_home:   document.getElementById('mt-in-net-home').value.trim(),
    net_mobile: document.getElementById('mt-in-net-mobile').value.trim(),
  };
  if (State.pendingAvatar) payload.avatar_url = State.pendingAvatar;
  else if (State.rmAvatar) payload.avatar_url = '';

  let res;
  if (isSelf) {
    res = await API.auth.updateProfile(payload);
  } else {
    // admin editing another user — hits PUT /api/users/?id=xxx
    res = await API.users.update(id, payload);
  }
  btn.disabled = false; btn.innerHTML = '<i data-icon=\"save\"></i> Save';
  if (!res?.ok) {
    Toast.show(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error');
    return;
  }

  // Optimistic local update
  const m = State.members.find(x => x.id === id);
  if (m) {
    Object.assign(m, {
      name_th:    payload.name_th,
      nickname:   payload.nickname,
      emp_id:     payload.emp_id,
      phone:      payload.phone,
      tmn_id:     payload.tmn_id,
      net_home:   payload.net_home,
      net_mobile: payload.net_mobile,
    });
    if ('avatar_url' in payload) m.avatar_url = payload.avatar_url;
  }
  // If we updated our own record, refresh Auth cache so sidebar + other pages see it
  if (isSelf) {
    Auth.updateUser({
      nickname: payload.nickname,
      ...(('avatar_url' in payload) ? { avatar_url: payload.avatar_url } : {}),
    });
    if (typeof Layout.updateUserInfo === 'function') Layout.updateUserInfo();
  }

  closeEditModal();
  render();
  Toast.show('บันทึกโปรไฟล์แล้ว <i data-icon=\"check\"></i>', 'success');
}

/* ─── Copy helpers ─── */
function getFiltered() {
  const q = State.search.toLowerCase();
  return State.members.filter(m => {
    if (State.filterRole !== 'all' && m.role !== State.filterRole) return false;
    if (State.allTeams && State.filterTeam !== 'all' && m.team !== State.filterTeam) return false;
    if (!q) return true;
    return [m.name, m.name_th, m.nickname, m.emp_id, m.email, m.phone, m.tmn_id, m.net_home, m.net_mobile, m.team]
      .some(v => (v || '').toLowerCase().includes(q));
  });
}
function formatMemberText(m) {
  const rlbl = (typeof Roles !== 'undefined' && Roles.label) ? Roles.label(m.role) : m.role;
  const teamStr = m.team ? ` · ${m.team.toUpperCase()}` : '';
  const lines = [`${m.name} ("${m.nickname || '—'}") · ${rlbl}${teamStr}`];
  if (m.name_th)    lines.push(`🇹🇭 ${m.name_th}`);
  if (m.emp_id)     lines.push(`<i data-icon=\"id-card\"></i> EmpID ${m.emp_id}`);
  if (m.email)      lines.push(`<i data-icon=\"mail\"></i> ${m.email}`);
  if (m.phone)      lines.push(`<i data-icon=\"smartphone\"></i> ${m.phone}`);
  if (m.tmn_id)     lines.push(`₿ TMN.ID ${m.tmn_id}`);
  if (m.net_home)   lines.push(`<i data-icon=\"home\"></i> ${m.net_home}`);
  if (m.net_mobile) lines.push(`<i data-icon=\"wifi\"></i> ${m.net_mobile}`);
  return lines.join('\n');
}
function formatTeamText(rows) {
  const scope = State.allTeams
    ? (State.filterTeam === 'all' ? 'All teams' : State.filterTeam.toUpperCase())
    : (State.team || 'team').toUpperCase();
  const header = `═══ My Team · ${scope} · ${rows.length} members ═══`;
  const body = rows.map((m, i) => `\n[${String(i+1).padStart(2,'0')}] ${formatMemberText(m)}`).join('\n');
  return `${header}\n${body}\n\n— exported ${new Date().toLocaleString('th-TH')}`;
}
function formatTeamCSV(rows) {
  const cols = ['name','name_th','nickname','emp_id','role','team','email','phone','tmn_id','net_home','net_mobile'];
  const escc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(m => cols.map(c => escc(m[c])).join(','))].join('\n');
}
function formatTeamMD(rows) {
  const cols = ['Name','Name (TH)','Nickname','Emp ID','Role','Team','Email','Phone','TMN.ID','Home Net','Mobile Net'];
  const keys = ['name','name_th','nickname','emp_id','role','team','email','phone','tmn_id','net_home','net_mobile'];
  const escm = (v) => String(v ?? '').replace(/\|/g,'\\|').replace(/\n/g,' ');
  return [
    '| ' + cols.join(' | ') + ' |',
    '|' + cols.map(() => '---').join('|') + '|',
    ...rows.map(m => '| ' + keys.map(k => escm(m[k])).join(' | ') + ' |'),
  ].join('\n');
}
function formatTeamJSON(rows) {
  const stripped = rows.map(m => ({
    name: m.name, name_th: m.name_th, nickname: m.nickname, emp_id: m.emp_id,
    role: m.role, team: m.team,
    email: m.email, phone: m.phone, tmn_id: m.tmn_id,
    net_home: m.net_home, net_mobile: m.net_mobile,
  }));
  return JSON.stringify(stripped, null, 2);
}
async function copyToClipboard(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}
async function copyMember(id, btn) {
  const m = State.members.find(x => x.id === id);
  if (!m) return;
  const ok = await copyToClipboard(formatMemberText(m));
  if (ok) {
    if (btn) { btn.classList.add('pulse'); btn.textContent = '✓'; setTimeout(() => { btn.classList.remove('pulse'); btn.textContent = '📋'; }, 1200); }
    Toast.show(`คัดลอกข้อมูลของ ${m.name} แล้ว ✓`, 'success');
  } else {
    Toast.show('คัดลอกไม่สำเร็จ — ลอง Cmd/Ctrl+C แทน', 'error');
  }
}
async function copyTeam(fmt) {
  const rows = getFiltered();
  if (!rows.length) { Toast.show('ไม่มีข้อมูลให้ copy', 'warning'); return; }
  let txt, label;
  if      (fmt === 'csv')  { txt = formatTeamCSV(rows);  label = 'CSV'; }
  else if (fmt === 'md')   { txt = formatTeamMD(rows);   label = 'Markdown table'; }
  else if (fmt === 'json') { txt = formatTeamJSON(rows); label = 'JSON'; }
  else                     { txt = formatTeamText(rows); label = 'Text'; }
  const ok = await copyToClipboard(txt);
  if (ok) Toast.show(`คัดลอก ${label} · ${rows.length} คน (${txt.length.toLocaleString()} chars) ✓`, 'success');
  else    Toast.show('คัดลอกไม่สำเร็จ', 'error');
}
function toggleCopyMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('mt-copy-menu').classList.toggle('on');
}
function closeCopyMenu() { document.getElementById('mt-copy-menu')?.classList.remove('on'); }
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.mt-copy-wrap')) closeCopyMenu();
});

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "closeCopyMenu", { configurable: true, get: () => closeCopyMenu, set: (v) => { closeCopyMenu = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyMember", { configurable: true, get: () => copyMember, set: (v) => { copyMember = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyTeam", { configurable: true, get: () => copyTeam, set: (v) => { copyTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyToClipboard", { configurable: true, get: () => copyToClipboard, set: (v) => { copyToClipboard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatTeamJSON", { configurable: true, get: () => formatTeamJSON, set: (v) => { formatTeamJSON = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatTeamMD", { configurable: true, get: () => formatTeamMD, set: (v) => { formatTeamMD = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleCopyMenu", { configurable: true, get: () => toggleCopyMenu, set: (v) => { toggleCopyMenu = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildTeamChips", { configurable: true, get: () => buildTeamChips, set: (v) => { buildTeamChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "canEdit", { configurable: true, get: () => canEdit, set: (v) => { canEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeEditModal", { configurable: true, get: () => closeEditModal, set: (v) => { closeEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "colorFor", { configurable: true, get: () => colorFor, set: (v) => { colorFor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "esc", { configurable: true, get: () => esc, set: (v) => { esc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatMemberText", { configurable: true, get: () => formatMemberText, set: (v) => { formatMemberText = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatTeamCSV", { configurable: true, get: () => formatTeamCSV, set: (v) => { formatTeamCSV = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatTeamText", { configurable: true, get: () => formatTeamText, set: (v) => { formatTeamText = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getFiltered", { configurable: true, get: () => getFiltered, set: (v) => { getFiltered = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initials", { configurable: true, get: () => initials, set: (v) => { initials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isAdmin", { configurable: true, get: () => isAdmin, set: (v) => { isAdmin = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isReadOnly", { configurable: true, get: () => isReadOnly, set: (v) => { isReadOnly = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModal", { configurable: true, get: () => openEditModal, set: (v) => { openEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveEdit", { configurable: true, get: () => saveEdit, set: (v) => { saveEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "teamColor", { configurable: true, get: () => teamColor, set: (v) => { teamColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "viewProfile", { configurable: true, get: () => viewProfile, set: (v) => { viewProfile = v; } }); } catch (e) {}
})();
