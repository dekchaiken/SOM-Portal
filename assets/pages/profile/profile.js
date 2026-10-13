// profile — page script, extracted from profile.html.
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
Layout.render('profile');

let pendingAvatar64 = null;
let rmAvatarFlag    = false;

// ── Team theming (Option B: team-tinted hero) ──────
// Applies the team's color to hero-banner gradient/dots/glow, avatar ring,
// hero-tag, and the eyebrow prompt slug. Handles three cases:
//   1. own profile      → user's team from JWT
//   2. other's profile  → team from profile API response
//   3. super_admin      → view-as team (sessionStorage) or SM/global fallback
function applyTeamTheme(team) {
  const root  = document.documentElement;
  const slug  = (team?.slug || 'sm').toLowerCase();
  const color = team?.color || '#F26419';                 // fallback = orange
  const name  = (team?.name || slug).toUpperCase().replace(/\s*TEAM\s*$/i, '');

  // Convert hex → rgb tuple so we can build rgba() variants
  const hex = color.replace('#', '');
  const n   = parseInt(hex.length === 3
    ? hex.split('').map(c => c + c).join('')
    : hex, 16);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;

  root.style.setProperty('--team-color', color);
  root.style.setProperty('--team-soft',  `rgba(${rgb},.10)`);
  root.style.setProperty('--team-line',  `rgba(${rgb},.35)`);
  root.style.setProperty('--team-glow',  `rgba(${rgb},.20)`);

  const tag = document.getElementById('pf-hero-tag');
  const eb  = document.getElementById('pf-team-slug');
  if (tag) tag.textContent = `${name}·HUB / profile`;
  if (eb)  eb.textContent  = slug;
}

// Fetch the current user's team (or view-as team) with color, cached in
// sessionStorage for the tab lifetime so we don't re-hit the API on every
// profile visit.
async function _loadOwnTeam() {
  const viewAs = Auth._getViewAsTeam?.();
  if (viewAs) return viewAs;                              // super_admin previewing a team

  const slug = Auth.getTeam();
  if (!slug) return null;                                 // super_admin with no view-as

  try {
    const cached = sessionStorage.getItem('_pf_own_team');
    if (cached) {
      const t = JSON.parse(cached);
      if (t?.slug === slug) return t;
    }
    const res = await API.teams.list();
    const teams = res?.data?.data || res?.data || [];
    const t = teams.find(x => x.slug === slug) || teams[0] || null;
    if (t) sessionStorage.setItem('_pf_own_team', JSON.stringify(t));
    return t;
  } catch { return null; }
}

// ── Multi-user profile support ─────────────────────
const urlParams = new URLSearchParams(window.location.search);
const targetUserId = urlParams.get('user');
let isOwnProfile = true;
let currentUser = Auth.getUser();

// Check access permissions
if (targetUserId && targetUserId !== currentUser?.id) {
  isOwnProfile = false;
}
// super_admin can edit any user's profile
const canEditOtherProfile = !isOwnProfile && Auth.isSuperAdmin();

/* ── INIT ─────────────────────────────────────────── */
function initPage() {
  if (isOwnProfile) {
    // Tint hero with the user's own team color (or view-as team for super_admin)
    _loadOwnTeam().then(applyTeamTheme);

    // Show own profile with all fields editable
    document.getElementById('page-title').textContent = '◈ My Profile';
    document.getElementById('page-subtitle').textContent = 'จัดการบัญชีและดูกิจกรรมของคุณ';
    const u = Auth.getUser();
    if (!u) return;
    document.getElementById('input-name').value     = u.name     || '';
    document.getElementById('input-name').disabled  = false;
    document.getElementById('input-username').value = u.username || '';
    document.getElementById('input-email').value    = u.email    || '';
    // Contact + identity fields (not in JWT — fetch from server)
    API.auth.getProfile().then(res => {
      if (!res?.ok) return;
      const d = res.data?.data || {};
      document.getElementById('input-name-th').value    = d.name_th    || '';
      document.getElementById('input-emp-id').value     = d.emp_id     || '';
      document.getElementById('input-phone').value      = d.phone      || '';
      document.getElementById('input-tmn-id').value     = d.tmn_id     || '';
      document.getElementById('input-net-home').value   = d.net_home   || '';
      document.getElementById('input-net-mobile').value = d.net_mobile || '';
    });
    document.getElementById('pf-name').textContent     = u.name || '—';
    const pfRole1 = document.getElementById('pf-role');
    pfRole1.textContent = Roles.label(u.role || '');
    pfRole1.className = Roles.badgeClass(u.role || '');
    document.getElementById('pf-username').textContent = u.username || '—';
    setAvatar(u.avatar_url || '', u.name || '?');
    loadAchievements();
    document.querySelector('.form-actions').style.display = '';
    document.getElementById('avatar-file').addEventListener('change', handleAvatarChange);
  } else {
    document.getElementById('page-title').textContent = '◈ User Profile';
    loadOtherUserProfile();
    loadOtherUserAchievements();

    if (canEditOtherProfile) {
      // Super admin edit mode — full edit access
      document.getElementById('page-subtitle').textContent = 'แก้ไขข้อมูลสมาชิก (Super Admin)';
      document.querySelector('.form-actions').style.display = '';
      const saveBtn = document.getElementById('save-btn');
      saveBtn.innerHTML = '<i data-icon="save"></i> บันทึก (Admin)';
      saveBtn.onclick = saveOtherProfile;
      document.getElementById('change-pw-link').style.display = 'none';
      document.querySelector('.av-btns').style.display = '';
      document.getElementById('avatar-file').disabled = false;
      document.querySelector('.av').style.cursor = 'pointer';
      document.querySelector('.av').onclick = () => document.getElementById('avatar-file').click();
      document.getElementById('row-avatar-url').style.display = '';
    } else {
      // Read-only view for non-admin
      document.getElementById('page-subtitle').textContent = 'ดูข้อมูลและกิจกรรมของสมาชิกทีม';
      document.querySelector('.form-actions').style.display = 'none';
      document.querySelector('.av-btns').style.display = 'none';
      document.getElementById('avatar-file').disabled = true;
      document.getElementById('input-name').disabled = true;
      document.querySelector('.av').style.cursor = 'default';
      document.querySelector('.av').onclick = null;
    }
  }
}

async function loadOtherUserProfile() {
  try {
    const res = await fetch(`./api/users/profile.php?user_id=${targetUserId}`, {
      headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
    });
    
    if (!res.ok) {
      const text = await res.text();
      console.error('API Error:', res.status, text);
      document.body.innerHTML = `<div style="padding:40px;text-align:center"><h2><i data-icon="alert-triangle"></i> Error ${res.status}</h2><p>${text || 'Failed to load profile'}</p><button class="btn btn-primary" onclick="history.back()">← Go Back</button></div>`;
      return;
    }
    
    const json = await res.json();
    console.log('Profile data:', json);
    
    if (!json.success) {
      document.body.innerHTML = `<div style="padding:40px;text-align:center"><h2><i data-icon="alert-triangle"></i> ${json.message || 'Profile not found'}</h2><p style="color:var(--text-muted)">${json.error || ''}</p><button class="btn btn-primary" onclick="history.back()">← Go Back</button></div>`;
      return;
    }
    
    const profile = json.data.profile;
    const heatmapData = json.data.heatmap;
    const recentPosts = json.data.recent_posts;
    const activityFeed = json.data.activity_feed;
    const stats = json.data.stats;
    
    // Tint hero using this user's team (look up color from the teams list)
    if (profile.team) {
      try {
        const tr = await API.teams.list();
        const teams = tr?.data?.data || tr?.data || [];
        const t = teams.find(x => x.slug === profile.team) || { slug: profile.team };
        applyTeamTheme(t);
      } catch {
        applyTeamTheme({ slug: profile.team });            // slug-only fallback (no color)
      }
    }

    // Update UI with profile
    document.getElementById('input-name').value        = profile.name       || '';
    document.getElementById('input-username').value    = profile.username   || '';
    document.getElementById('input-email').value       = profile.email      || '';
    document.getElementById('input-name-th').value     = profile.name_th    || '';
    document.getElementById('input-emp-id').value      = profile.emp_id     || '';
    document.getElementById('input-phone').value       = profile.phone      || '';
    document.getElementById('input-tmn-id').value      = profile.tmn_id     || '';
    document.getElementById('input-net-home').value    = profile.net_home   || '';
    document.getElementById('input-net-mobile').value  = profile.net_mobile || '';
    // username & email: always locked on profile page (use admin panel for those)
    document.getElementById('input-username').disabled = true;
    document.getElementById('input-email').disabled    = true;
    if (!canEditOtherProfile) {
      // Read-only for non-admin viewers
      document.getElementById('input-name').disabled = true;
      ['input-name-th','input-emp-id','input-phone','input-tmn-id','input-net-home','input-net-mobile'].forEach(id => {
        document.getElementById(id).disabled = true;
      });
    }
    document.getElementById('pf-name').textContent = profile.name || '—';
    const pfRole2 = document.getElementById('pf-role');
    pfRole2.textContent = Roles.label(profile.role || '');
    pfRole2.className = Roles.badgeClass(profile.role || '');
    document.getElementById('pf-username').textContent = profile.username || '—';
    setAvatar(profile.avatar_url || '', profile.name || '?');
    
    // Update stats
    document.getElementById('s-total').textContent = stats.total_actions || 0;
    document.getElementById('s-posts').textContent = recentPosts.length || 0;
    document.getElementById('s-cmt').textContent = activityFeed.filter(a => a.action === 'board_comment').length || 0;
    document.getElementById('s-login').textContent = activityFeed.filter(a => a.action === 'login').length || 0;
    
    // Build heatmap from API data
    buildHeatmapFromAPI(heatmapData);
    
    // Load recent posts
    displayRecentPosts(recentPosts);
    
    // Load activity feed
    displayActivityFeed(activityFeed);
    
  } catch (err) {
    console.error('Failed to load profile:', err);
    document.getElementById('act-list').innerHTML = '<div class="act-empty"><i data-icon="alert-triangle"></i> โหลดไม่ได้</div>';
  }
}

function displayRecentPosts(posts) {
  const el = document.getElementById('posts-list');
  if (!posts.length) { 
    el.innerHTML = '<div class="posts-empty">ยังไม่มีโพสต์</div>'; 
    return; 
  }
  el.innerHTML = '';
  posts.forEach(p => {
    const a = document.createElement('a');
    a.className = 'pi'; 
    a.href = `./board.html#${p.detail?.post_id || p.id}`;
    const actionLabel = p.action === 'board_create' ? 'สร้าง' : 'แก้ไข';
    const title = p.detail?.title || 'Post';
    a.innerHTML = `
      <div class="pi-dot" style="background:#22c55e"></div>
      <div class="pi-body">
        <div class="pi-title">${escHtml(title)}</div>
        <div class="pi-meta">
          <span class="pi-type">${actionLabel}</span>
        </div>
      </div>
      <div class="pi-time">${fmtRel(p.ts)}</div>`;
    el.appendChild(a);
  });
}

function displayActivityFeed(items) {
  const list = document.getElementById('act-list');
  if (!items.length) {
    list.innerHTML = '<div class="act-empty">ยังไม่มีกิจกรรม</div>';
    return;
  }
  list.innerHTML = '';
  items.slice(0, 50).forEach(item => {
    const m = getMeta(item.action);
    const d = item.detail || {};
    let dt = '';
    switch (item.action) {
      case 'login':
        dt = d.username ? `${d.username}${item.ip ? ' · ' + item.ip : ''}` : (item.ip || ''); break;
      case 'jira_create_ticket':
        dt = d.issue_key ? `${d.issue_key}${d.summary ? ': ' + d.summary.substring(0,60) : ''}` : (d.summary || ''); break;
      case 'email_sent':
        dt = d.subject || (d.to ? `→ ${d.to}` : ''); break;
      case 'health_check':
        dt = `Jira: ${d.jira_status || '?'}${d.jenkins_errors > 0 ? ` · Jenkins: ${d.jenkins_errors} err` : ''}`; break;
      default:
        dt = d.title || d.summary || d.name || d.display || d.query || d.key || d.subject || d.filename || d.file || '';
    }
    const el = document.createElement('div');
    el.className = 'act-item';
    el.innerHTML = `
      <div class="act-dot" style="background:${m.color}">${m.icon}</div>
      <div class="act-body">
        <div class="act-lbl">${escHtml(m.label)}</div>
        ${dt ? `<div class="act-detail">${escHtml(dt)}</div>` : ''}
      </div>
      <div class="act-time">${fmtRel(item.ts)}</div>`;
    list.appendChild(el);
  });
}

function setAvatar(url, name) {
  const wrap  = document.getElementById('av-initials');
  const rmBtn = document.getElementById('rm-av-btn');
  if (url) {
    // Store initials as fallback in data attr — safe to reference from onerror attribute
    wrap.dataset.initials = getInitials(name);
    wrap.innerHTML = `<img src="${escHtml(url)}" alt="avatar"
      style="width:100%;height:100%;object-fit:cover;display:block"
      onerror="var w=this.parentElement;w.textContent=w.dataset.initials||'?';this.remove()">`;
    rmBtn.style.display = '';
  } else {
    wrap.textContent = getInitials(name);
    rmBtn.style.display = 'none';
  }
}

// Local YYYY-MM-DD formatter — avoids the UTC drift that .toISOString() introduces
// when the user's timezone is ahead of UTC (e.g., Bangkok +07).
const fmtLocalDateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

/* ── HEATMAP FROM API ──────────────────────────────── */
function buildHeatmapFromAPI(heatmapData) {
  const container = document.getElementById('hm-container');
  if (!heatmapData || !heatmapData.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:6px 0">ไม่มีข้อมูลกิจกรรม</div>';
    return;
  }

  // Build a daily heatmap from the API's date+hours data
  const dailyData = {};
  let totalActivities = 0;
  let activeDays = 0;

  heatmapData.forEach(item => {
    dailyData[item.date] = item.total;
    totalActivities += item.total;
    if (item.total > 0) activeDays++;
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const k = fmtLocalDateKey(d);
    days.push({ d, k, c: dailyData[k] || 0 });
  }

  const max = Math.max(...Object.values(dailyData), 1);
  const lv = c => {
    if (!c) return 0;
    if (c <= max*.25) return 1;
    if (c <= max*.50) return 2;
    if (c <= max*.75) return 3;
    return 4;
  };

  const startDow = days[0].d.getDay();
  const padded = Array(startDow).fill(null).concat(days);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i+7));

  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthPos = {};
  days.forEach((d, idx) => {
    const wk = Math.floor((idx + startDow) / 7);
    const mo = MO[d.d.getMonth()];
    if (!Object.values(monthPos).includes(mo)) monthPos[wk] = mo;
  });

  const GAP = 2;
  const LABEL_W = 22;
  const MIN_CW = 11;
  const MAX_CW = 15;
  const contW = container.clientWidth || 700;
  const numWeeks = weeks.length;
  const CW = Math.max(MIN_CW, Math.min(MAX_CW, Math.floor((contW - LABEL_W) / numWeeks)));
  container.style.setProperty('--hm-cell', (CW - GAP) + 'px');

  let html = '<div class="hm-month-row">';
  weeks.forEach((_, wi) => {
    html += `<div class="hm-ml" style="width:${CW}px;min-width:${CW}px">${monthPos[wi]||''}</div>`;
  });
  html += '</div>';

  const DS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let dow = 0; dow < 7; dow++) {
    html += `<div class="hm-row"><div class="hm-dl">${[1,3,5].includes(dow)?DS[dow]:''}</div><div class="hm-cols">`;
    weeks.forEach(wk => {
      const d = wk[dow];
      if (!d) html += `<div class="hm-cell" style="visibility:hidden"></div>`;
      else html += `<div class="hm-cell" data-v="${lv(d.c)}" title="${d.k}: ${d.c} กิจกรรม"></div>`;
    });
    html += '</div></div>';
  }

  container.innerHTML = html;
  document.getElementById('hm-total').textContent = `${totalActivities} กิจกรรม · ${activeDays} วัน`;
}

/* ── AVATAR ───────────────────────────────────────── */
function handleAvatarChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5*1024*1024) { Toast.show('ไฟล์ใหญ่เกินไป (max 5 MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const cv = document.getElementById('avatar-canvas');
      cv.width = cv.height = 200;
      const ctx = cv.getContext('2d');
      const min = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width-min)/2, (img.height-min)/2, min, min, 0, 0, 200, 200);
      pendingAvatar64 = cv.toDataURL('image/jpeg', 0.82);
      rmAvatarFlag    = false;
      const _avName = isOwnProfile ? (Auth.getUser()?.name || '?') : (document.getElementById('pf-name').textContent || '?');
      setAvatar(pendingAvatar64, _avName);
      document.getElementById('rm-av-btn').style.display = '';
      Toast.show('เลือกรูปแล้ว — กด "บันทึก" เพื่อยืนยัน', 'info');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

document.getElementById('avatar-file').addEventListener('change', handleAvatarChange);

function removeAvatar() {
  pendingAvatar64 = null; rmAvatarFlag = true;
  const displayName = isOwnProfile ? (Auth.getUser()?.name || '?') : (document.getElementById('pf-name').textContent || '?');
  setAvatar('', displayName);
  Toast.show('รูปจะถูกลบเมื่อกด "บันทึก"', 'info');
}

/* ── SAVE ─────────────────────────────────────────── */
async function saveProfile() {
  const btn  = document.getElementById('save-btn');
  const name = document.getElementById('input-name').value.trim();
  if (!name) { Toast.show('กรุณาใส่ชื่อแสดงผล', 'error'); return; }

  const payload = {
    name,
    name_th:    document.getElementById('input-name-th').value.trim(),
    emp_id:     document.getElementById('input-emp-id').value.trim(),
    phone:      document.getElementById('input-phone').value.trim(),
    tmn_id:     document.getElementById('input-tmn-id').value.trim(),
    net_home:   document.getElementById('input-net-home').value.trim(),
    net_mobile: document.getElementById('input-net-mobile').value.trim(),
  };
  if (pendingAvatar64) payload.avatar_url = pendingAvatar64;
  if (rmAvatarFlag)    payload.avatar_url = '';

  btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก…';
  const res = await API.auth.updateProfile(payload);
  btn.disabled = false; btn.innerHTML = '<i data-icon="save"></i> บันทึก';

  if (!res?.ok) { Toast.show(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error'); return; }

  // Preserve email locally — don't overwrite from server (may return '' if unset in DB)
  const currentEmail = Auth.getUser()?.email || '';
  const updated = Auth.updateUser({
    name:       res.data.data.name,
    avatar_url: res.data.data.avatar_url,
    email:      currentEmail,
  });

  document.getElementById('input-email').value = updated.email || '';
  document.getElementById('pf-name').textContent = updated.name;
  setAvatar(updated.avatar_url || '', updated.name);
  pendingAvatar64 = null; rmAvatarFlag = false;

  Layout.updateUserInfo();
  Layout._pingPresence(Layout.currentPage);
  Toast.show('บันทึกโปรไฟล์แล้ว <i data-icon="check"></i>', 'success');
}

/* ── ACHIEVEMENTS ─────────────────────────────────── */
async function loadAchievements() {
  const res = await API.achievements.me();
  return _renderAchievements(res);
}

async function loadOtherUserAchievements() {
  const res = await API.achievements.user(targetUserId);
  return _renderAchievements(res);
}

async function _renderAchievements(res) {
  if (!res?.ok) {
    document.getElementById('ach-stats').innerHTML =
      '<div class="ach-empty">โหลด achievements ไม่สำเร็จ</div>';
    return;
  }
  const d = res.data?.data || {};
  const s = d.stats || {};

  // Header points pill
  document.getElementById('ach-points').innerHTML =
    `<span class="ach-points-pill"><i data-icon="star"></i> ${s.total_points || 0} pts</span>`;

  // Stats row
  document.getElementById('ach-stats').innerHTML = `
    <div class="ach-stat orange">
      <div class="n">${s.courses_completed || 0}<span style="font-size:11px; color:var(--text-muted); font-weight:600">/${s.courses_total || 0}</span></div>
      <div class="l"><i data-icon="book-open"></i> Courses</div>
    </div>
    <div class="ach-stat green">
      <div class="n">${s.exams_passed || 0}<span style="font-size:11px; color:var(--text-muted); font-weight:600">/${s.exams_taken || 0}</span></div>
      <div class="l"><i data-icon="edit"></i> Exams</div>
    </div>
    <div class="ach-stat ${d.onboarding?.finished ? 'gold' : 'silver'}">
      <div class="n">${d.onboarding?.percent || 0}%</div>
      <div class="l"><i data-icon="compass"></i> Onboarding</div>
    </div>
    <div class="ach-stat orange">
      <div class="n">${s.total_points || 0}</div>
      <div class="l"><i data-icon="star"></i> Points</div>
    </div>
  `;

  // List section
  const list = document.getElementById('ach-list');
  let html = '';

  // Onboarding badge
  if (d.onboarding?.finished) {
    html += `
      <div class="ach-section-label"><i data-icon="award"></i> Milestones</div>
      <div class="ach-row" style="--ach-color:#10b981">
        <div class="ico"><i data-icon="compass"></i></div>
        <div class="body">
          <div class="ti">Team Onboarding completed</div>
          <div class="meta">
            <span><i data-icon="check"></i> <b>${d.onboarding.done}</b> / ${d.onboarding.total} tasks</span>
            ${d.onboarding.finished_at ? `<span>· ${fmtDate(d.onboarding.finished_at)}</span>` : ''}
          </div>
        </div>
        <div class="badge"><i data-icon="award"></i></div>
      </div>`;
  }

  // Courses
  if (d.courses?.length) {
    html += `<div class="ach-section-label"><i data-icon="book-open"></i> Courses</div>`;
    html += d.courses.map(c => {
      const cls = c.completed ? '' : 'locked';
      const badge = c.badge === 'gold'   ? '<i data-icon="award"></i>'
                  : c.badge === 'silver' ? '<i data-icon="award"></i>'
                  : c.badge === 'bronze' ? '<i data-icon="award"></i>'
                  : '<i data-icon="lock"></i>';
      return `
        <div class="ach-row ${cls}" style="--ach-color:${escHtml(c.cover_color)}">
          <div class="ico">${renderIcon(c.icon)}</div>
          <div class="body">
            <div class="ti">${escHtml(c.title)}</div>
            <div class="meta">
              <span><b>${c.phases_passed}</b> / ${c.phases_total} phases</span>
              <span>· ${c.percent}%</span>
              ${c.avg_score ? `<span>· avg <b>${c.avg_score}%</b></span>` : ''}
              ${c.completed_at ? `<span>· ${fmtDate(c.completed_at)}</span>` : ''}
            </div>
          </div>
          <div class="badge">${badge}</div>
        </div>`;
    }).join('');
  }

  // Exams
  if (d.exams?.length) {
    html += `<div class="ach-section-label"><i data-icon="edit"></i> Exams</div>`;
    html += d.exams.map(e => {
      const cls = e.passed ? '' : 'locked';
      const badge = e.badge === 'gold'   ? '<i data-icon="award"></i>'
                  : e.badge === 'silver' ? '<i data-icon="award"></i>'
                  : e.badge === 'bronze' ? '<i data-icon="award"></i>'
                  : '<i data-icon="x-circle"></i>';
      return `
        <div class="ach-row ${cls}" style="--ach-color:${escHtml(e.cover_color)}">
          <div class="ico">${renderIcon(e.icon, '<i data-icon="edit"></i>')}</div>
          <div class="body">
            <div class="ti">${escHtml(e.title)}</div>
            <div class="meta">
              <span>Best: <b>${e.best_score}%</b></span>
              <span>· pass ${e.pass_score}%</span>
              <span>· ${e.attempts} attempt${e.attempts > 1 ? 's' : ''}</span>
              ${e.passed_at ? `<span>· ${fmtDate(e.passed_at)}</span>` : ''}
            </div>
          </div>
          <div class="badge">${badge}</div>
        </div>`;
    }).join('');
  }

  if (!html) {
    html = `<div class="ach-empty">ยังไม่มี achievement — เริ่มเรียนคอร์สหรือทำข้อสอบเพื่อสะสมรางวัล</div>`;
  }

  list.innerHTML = html;
}

/* ── HEATMAP ──────────────────────────────────────── */
function buildHeatmap(items) {
  const container = document.getElementById('hm-container');
  const counts = {};
  items.forEach(it => {
    const ts = it.created_at || it.ts;
    if (!ts) return;
    // Parse the timestamp so we get the LOCAL date (timestamps include +07:00 offset,
    // which would otherwise get truncated incorrectly by a plain substring).
    const dt = new Date(ts);
    if (isNaN(dt)) return;
    const d = fmtLocalDateKey(dt);
    counts[d] = (counts[d] || 0) + 1;
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const days  = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const k = fmtLocalDateKey(d);
    days.push({ d, k, c: counts[k] || 0 });
  }

  const max = Math.max(...Object.values(counts), 1);
  const lv = c => {
    if (!c) return 0;
    if (c <= max*.25) return 1;
    if (c <= max*.50) return 2;
    if (c <= max*.75) return 3;
    return 4;
  };

  const startDow = days[0].d.getDay();
  const padded   = Array(startDow).fill(null).concat(days);
  const weeks    = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i+7));

  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthPos = {};
  days.forEach((d, idx) => {
    const wk = Math.floor((idx + startDow) / 7);
    const mo = MO[d.d.getMonth()];
    if (!Object.values(monthPos).includes(mo)) monthPos[wk] = mo;
  });

  // Compute responsive cell width from actual container width
  const GAP      = 2;
  const LABEL_W  = 22;
  const MIN_CW   = 11;   // min col width (9px cell + 2px gap)
  const MAX_CW   = 15;   // max col width (13px cell + 2px gap)
  const contW    = container.clientWidth || 700;
  const numWeeks = weeks.length;
  const CW       = Math.max(MIN_CW, Math.min(MAX_CW, Math.floor((contW - LABEL_W) / numWeeks)));
  container.style.setProperty('--hm-cell', (CW - GAP) + 'px');

  let html = '<div class="hm-month-row">';
  weeks.forEach((_, wi) => {
    html += `<div class="hm-ml" style="width:${CW}px;min-width:${CW}px">${monthPos[wi]||''}</div>`;
  });
  html += '</div>';

  const DS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let dow = 0; dow < 7; dow++) {
    html += `<div class="hm-row"><div class="hm-dl">${[1,3,5].includes(dow)?DS[dow]:''}</div><div class="hm-cols">`;
    weeks.forEach(wk => {
      const d = wk[dow];
      if (!d) html += `<div class="hm-cell" style="visibility:hidden"></div>`;
      else     html += `<div class="hm-cell" data-v="${lv(d.c)}" title="${d.k}: ${d.c} กิจกรรม"></div>`;
    });
    html += '</div></div>';
  }

  container.innerHTML = html;
  const totalAct   = Object.values(counts).reduce((a,b)=>a+b,0);
  const activeDays = Object.keys(counts).length;
  document.getElementById('hm-total').textContent = `${totalAct} กิจกรรม · ${activeDays} วัน`;
}

/* ── MY POSTS ─────────────────────────────────────── */
const ST_DOT   = { open:'#22c55e', in_progress:'#f59e0b', resolved:'#9ca3af' };
const ST_LABEL = { open:'Open', in_progress:'In Progress', resolved:'Resolved' };

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
}

async function loadMyPosts() {
  const u = Auth.getUser();
  if (!u) return;
  const el = document.getElementById('posts-list');
  el.innerHTML = '<div class="posts-empty">⏳</div>';

  const res = await API.board.myPosts(u.id || u.sub, 5);
  if (!res?.ok) { el.innerHTML = '<div class="posts-empty"><i data-icon="alert-triangle"></i> โหลดไม่ได้</div>'; return; }

  const items = res.data?.data?.items || [];
  if (!items.length) { el.innerHTML = '<div class="posts-empty">ยังไม่มีโพสต์</div>'; return; }

  el.innerHTML = '';
  items.forEach(p => {
    const st  = p.status || 'open';
    const dot = ST_DOT[st] || '#9ca3af';
    const a   = document.createElement('a');
    a.className = 'pi'; a.href = `./board.html#${p.id}`;
    a.innerHTML = `
      <div class="pi-dot" style="background:${dot}"></div>
      <div class="pi-body">
        <div class="pi-title">${escHtml(p.title)}</div>
        <div class="pi-meta">
          <span class="pi-badge ${st}">${ST_LABEL[st]||st}</span>
          ${p.board_type_name ? `<span class="pi-type">${escHtml(p.board_type_name)}</span>` : ''}
          ${p.service_type_name ? `<span class="pi-type">${escHtml(p.service_type_name)}</span>` : ''}
        </div>
      </div>
      <div class="pi-time">${fmtDate(p.created_at)}</div>`;
    el.appendChild(a);
  });
}

/* ── ACTIVITY FEED ────────────────────────────────── */
const AMETA = {
  login:                    {icon:'<i data-icon="key"></i>',color:'rgba(59,130,246,.10)', label:'เข้าสู่ระบบ'},
  logout:                   {icon:'<i data-icon="log-out"></i>',color:'rgba(107,114,128,.10)',label:'ออกจากระบบ'},
  password_changed:         {icon:'<i data-icon="lock"></i>',color:'rgba(124,58,237,.10)', label:'เปลี่ยนรหัสผ่าน'},
  password_change:          {icon:'<i data-icon="lock"></i>',color:'rgba(124,58,237,.10)', label:'เปลี่ยนรหัสผ่าน'},
  profile_updated:          {icon:'<i data-icon="pencil"></i>',color:'rgba(242,100,25,.10)', label:'อัปเดตโปรไฟล์'},
  profile_update:           {icon:'<i data-icon="pencil"></i>',color:'rgba(242,100,25,.10)', label:'อัปเดตโปรไฟล์'},
  board_create:             {icon:'<i data-icon="edit"></i>',color:'rgba(34,197,94,.10)',  label:'สร้างโพสต์'},
  board_post_created:       {icon:'<i data-icon="edit"></i>',color:'rgba(34,197,94,.10)',  label:'สร้างโพสต์'},
  board_update:             {icon:'<i data-icon="edit"></i>',color:'rgba(245,158,11,.10)', label:'แก้ไขโพสต์'},
  board_delete:             {icon:'<i data-icon="trash"></i>',color:'rgba(239,68,68,.10)',  label:'ลบโพสต์'},
  board_post_deleted:       {icon:'<i data-icon="trash"></i>',color:'rgba(239,68,68,.10)',  label:'ลบโพสต์'},
  board_restore:            {icon:'<i data-icon="recycle"></i>',color:'rgba(34,197,94,.10)',  label:'กู้คืนโพสต์'},
  board_hard_delete:        {icon:'💀',color:'rgba(239,68,68,.15)',  label:'ลบถาวร'},
  board_comment:            {icon:'<i data-icon="message-circle"></i>',color:'rgba(34,197,94,.10)',  label:'แสดงความคิดเห็น'},
  board_comment_created:    {icon:'<i data-icon="message-circle"></i>',color:'rgba(34,197,94,.10)',  label:'แสดงความคิดเห็น'},
  board_comment_deleted:    {icon:'<i data-icon="message-circle"></i>',color:'rgba(239,68,68,.10)',  label:'ลบ comment'},
  board_star:               {icon:'<i data-icon="star"></i>',color:'rgba(245,158,11,.10)', label:'Starred โพสต์'},
  board_unstar:             {icon:'<i data-icon="star"></i>', color:'rgba(107,114,128,.10)',label:'Unstarred โพสต์'},
  board_search:             {icon:'<i data-icon="search"></i>',color:'rgba(107,114,128,.07)',label:'ค้นหา'},
  board_status_change:      {icon:'<i data-icon="refresh-cw"></i>',color:'rgba(59,130,246,.10)', label:'เปลี่ยนสถานะ'},
  avatar_upload:            {icon:'<i data-icon="camera"></i>',color:'rgba(242,100,25,.10)', label:'อัปโหลด Avatar'},
  file_upload:              {icon:'<i data-icon="paperclip"></i>',color:'rgba(242,100,25,.10)', label:'อัปโหลดไฟล์'},
  health_check:             {icon:'<i data-icon="building"></i>',color:'rgba(59,130,246,.07)', label:'Health Check'},
  user_update:              {icon:'<i data-icon="user"></i>',color:'rgba(124,58,237,.07)', label:'อัปเดต User'},
  user_create:              {icon:'<i data-icon="user"></i>',color:'rgba(34,197,94,.10)',  label:'สร้าง User'},
  user_delete:              {icon:'<i data-icon="user"></i>',color:'rgba(239,68,68,.10)',  label:'ลบ User'},
  jira_create_ticket:       {icon:'<i data-icon="ticket"></i>',color:'rgba(0,82,204,.10)',   label:'สร้าง Jira Ticket'},
  template_create:          {icon:'<i data-icon="clipboard"></i>',color:'rgba(34,197,94,.10)',  label:'สร้าง Template'},
  template_update:          {icon:'<i data-icon="clipboard"></i>',color:'rgba(245,158,11,.10)', label:'แก้ไข Template'},
  template_delete:          {icon:'<i data-icon="clipboard"></i>',color:'rgba(239,68,68,.10)',  label:'ลบ Template'},
  email_sent:               {icon:'<i data-icon="mail"></i>',color:'rgba(59,130,246,.10)', label:'ส่ง Email'},
  batch_report_submitted:   {icon:'<i data-icon="bar-chart"></i>',color:'rgba(107,114,128,.10)',label:'ส่ง Batch Report'},
  test_service_submitted:   {icon:'<i data-icon="test-tube"></i>',color:'rgba(107,114,128,.10)',label:'ทดสอบ Service'},
  noti_schedule_created:    {icon:'<i data-icon="bell"></i>',color:'rgba(34,197,94,.10)',  label:'สร้าง Notification'},
  noti_schedule_updated:    {icon:'<i data-icon="bell"></i>',color:'rgba(245,158,11,.10)', label:'แก้ไข Notification'},
  noti_schedule_deleted:    {icon:'<i data-icon="bell"></i>',color:'rgba(239,68,68,.10)',  label:'ลบ Notification'},
  noti_chat_sent:           {icon:'<i data-icon="message-circle"></i>',color:'rgba(59,130,246,.10)', label:'ส่ง Chat Notification'},
  jenkins_build_trigger:    {icon:'<i data-icon="settings"></i>',color:'rgba(107,114,128,.10)',label:'Trigger Jenkins Build'},
  settings_update:          {icon:'<i data-icon="settings"></i>',color:'rgba(124,58,237,.10)', label:'แก้ไข System Settings'},
  backup_created:           {icon:'<i data-icon="save"></i>',color:'rgba(34,197,94,.10)',  label:'สร้าง Backup'},
  backup_downloaded:        {icon:'<i data-icon="save"></i>',color:'rgba(59,130,246,.10)', label:'ดาวน์โหลด Backup'},
  link_create:              {icon:'<i data-icon="link"></i>',color:'rgba(34,197,94,.10)',  label:'เพิ่ม Quick Link'},
  link_update:              {icon:'<i data-icon="link"></i>',color:'rgba(245,158,11,.10)', label:'แก้ไข Quick Link'},
  link_delete:              {icon:'<i data-icon="link"></i>',color:'rgba(239,68,68,.10)',  label:'ลบ Quick Link'},
  doc_create:               {icon:'<i data-icon="file"></i>',color:'rgba(34,197,94,.10)',  label:'เพิ่ม Document'},
  doc_update:               {icon:'<i data-icon="file"></i>',color:'rgba(245,158,11,.10)', label:'แก้ไข Document'},
  doc_delete:               {icon:'<i data-icon="file"></i>',color:'rgba(239,68,68,.10)',  label:'ลบ Document'},
  mail_config_updated:      {icon:'<i data-icon="inbox"></i>',color:'rgba(124,58,237,.10)', label:'แก้ไข Mail Config'},
};
const getMeta = a => AMETA[a] || {icon:'<i data-icon="zap"></i>',color:'rgba(107,114,128,.08)',label:a.replace(/_/g,' ')};

function fmtRel(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)      return 'เมื่อกี้';
  if (s < 3600)    return `${Math.floor(s/60)} นาทีที่แล้ว`;
  if (s < 86400)   return `${Math.floor(s/3600)} ชม.ที่แล้ว`;
  if (s < 86400*7) return `${Math.floor(s/86400)} วันที่แล้ว`;
  return new Date(ts).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
}

const ACT_LIMIT = 5;
let _off = 0, _total = 0, _all = [], _first = true;

async function loadActivity(reset = false) {
  if (reset) { _off = 0; _total = 0; _all = []; _first = true; }
  const list = document.getElementById('act-list');
  if (reset) list.innerHTML = '<div class="act-empty">⏳ กำลังโหลด...</div>';

  const limit = (_first && reset) ? 500 : ACT_LIMIT;
  const res   = await API.auth.myActivity({ limit, offset: _off });
  if (!res?.ok) { list.innerHTML = '<div class="act-empty"><i data-icon="alert-triangle"></i> โหลดไม่ได้</div>'; return; }

  const { items = [], total = 0 } = res.data?.data || {};
  _total = total; _all = _all.concat(items);

  if (_first && reset) {
    _first = false;
    buildHeatmap(_all);
    document.getElementById('s-total').textContent = total || 0;
    document.getElementById('s-posts').textContent = _all.filter(i=>i.action==='board_post_created').length;
    document.getElementById('s-cmt').textContent   = _all.filter(i=>i.action==='board_comment_created').length;
    document.getElementById('s-login').textContent = _all.filter(i=>i.action==='login').length;
  }

  if (reset) list.innerHTML = '';
  if (!items.length && reset) { list.innerHTML = '<div class="act-empty">ยังไม่มีกิจกรรม</div>'; return; }

  (reset ? items.slice(0, ACT_LIMIT) : items).forEach(item => {
    const m  = getMeta(item.action);
    const d  = item.detail || {};
    let dt = '';
    switch (item.action) {
      case 'login':
        dt = d.username ? `${d.username}${item.ip ? ' · ' + item.ip : ''}` : (item.ip || ''); break;
      case 'jira_create_ticket':
        dt = d.issue_key ? `${d.issue_key}${d.summary ? ': ' + d.summary.substring(0,60) : ''}` : (d.summary || ''); break;
      case 'email_sent':
        dt = d.subject || (d.to ? `→ ${d.to}` : ''); break;
      case 'batch_report_submitted': case 'test_service_submitted':
        dt = d.server || d.reporter || ''; break;
      case 'health_check':
        dt = `Jira: ${d.jira_status || '?'}${d.jenkins_errors > 0 ? ` · Jenkins: ${d.jenkins_errors} err` : ''}`; break;
      case 'noti_schedule_updated': case 'noti_schedule_created':
        dt = d.fields ? `แก้ไข: ${d.fields}` : ''; break;
      case 'profile_update': case 'profile_updated':
        dt = Array.isArray(d.changed) && d.changed.length ? `แก้ไข: ${d.changed.join(', ')}` : ''; break;
      case 'settings_update':
        dt = Array.isArray(d) && d.length ? `แก้ไข: ${d.slice(0,4).join(', ')}${d.length>4?' …':''}` : ''; break;
      case 'jenkins_build_trigger':
        dt = d.job ? d.job.split('/').pop() : (d.server || ''); break;
      case 'file_upload':
        dt = d.filename || ''; break;
      case 'backup_created': case 'backup_downloaded': case 'backup_deleted':
        dt = d.file || ''; break;
      case 'board_status_change':
        dt = d.title ? `${d.title} → ${d.new_status || ''}` : (d.new_status || ''); break;
      default:
        dt = d.title || d.summary || d.name || d.display || d.query || d.key || d.subject || d.filename || d.file || '';
    }
    const el = document.createElement('div');
    el.className = 'act-item';
    el.innerHTML = `
      <div class="act-dot" style="background:${m.color}">${m.icon}</div>
      <div class="act-body">
        <div class="act-lbl">${escHtml(m.label)}</div>
        ${dt ? `<div class="act-detail">${escHtml(dt)}</div>` : ''}
      </div>
      <div class="act-time">${fmtRel(item.created_at)}</div>`;
    list.appendChild(el);
  });

  _off += reset ? Math.min(items.length, ACT_LIMIT) : items.length;
  const mw = document.getElementById('act-more-wrap');
  const mb = document.getElementById('act-more-btn');
  if (_off < _total) {
    mw.style.display = ''; mb.textContent = `โหลดเพิ่ม (${_total - _off} รายการ)`;
  } else {
    mw.style.display = 'none';
  }
}

function loadMoreActivity() { loadActivity(false); }

/* ── AVATAR URL PREVIEW ───────────────────────────── */
let _urlPreviewTimer;
function previewAvatarUrl(val) {
  clearTimeout(_urlPreviewTimer);
  if (!val.trim()) return;
  _urlPreviewTimer = setTimeout(() => {
    const name = document.getElementById('pf-name').textContent || '?';
    pendingAvatar64 = null; rmAvatarFlag = false;
    setAvatar(val.trim(), name);
    // If image fails onerror inside setAvatar will revert to initials automatically
  }, 500);
}

/* ── SAVE OTHER USER (super_admin only) ───────────── */
async function saveOtherProfile() {
  const btn  = document.getElementById('save-btn');
  const name = document.getElementById('input-name').value.trim();
  if (!name) { Toast.show('กรุณาใส่ชื่อแสดงผล', 'error'); return; }

  const payload = {
    name,
    name_th:    document.getElementById('input-name-th').value.trim(),
    emp_id:     document.getElementById('input-emp-id').value.trim(),
    phone:      document.getElementById('input-phone').value.trim(),
    tmn_id:     document.getElementById('input-tmn-id').value.trim(),
    net_home:   document.getElementById('input-net-home').value.trim(),
    net_mobile: document.getElementById('input-net-mobile').value.trim(),
  };

  // Avatar priority: file upload (base64) > URL field > remove flag
  // URL field previewed via previewAvatarUrl() — whatever is currently showing IS what gets saved
  const urlVal = document.getElementById('input-avatar-url').value.trim();
  if (pendingAvatar64) {
    payload.avatar_url = pendingAvatar64;          // file upload wins
  } else if (urlVal) {
    payload.avatar_url = urlVal;                   // URL input wins over existing
  } else if (rmAvatarFlag) {
    payload.avatar_url = '';                       // explicit remove
  }

  btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก…';
  const res = await API.users.update(targetUserId, payload);
  btn.disabled = false; btn.innerHTML = '<i data-icon="save"></i> บันทึก (Admin)';

  if (!res?.ok) { Toast.show(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error'); return; }

  // Update hero display
  document.getElementById('pf-name').textContent = name;
  if (payload.avatar_url !== undefined) {
    // If it was a URL input (not base64), avatar is already previewed — just clear the field
    // If it was a file upload (base64), re-render cleanly
    if (pendingAvatar64) setAvatar(payload.avatar_url, name);
    else if (payload.avatar_url === '') setAvatar('', name);
    document.getElementById('input-avatar-url').value = '';
  }
  pendingAvatar64 = null; rmAvatarFlag = false;
  Toast.show('บันทึกโปรไฟล์แล้ว <i data-icon="check"></i>', 'success');
}

/* ── BOOT ─────────────────────────────────────────── */
initPage();
if (isOwnProfile) {
  loadActivity(true);
  loadMyPosts();
  // Rebuild heatmap on resize so cells always fill the card width
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => { if (_all.length) buildHeatmap(_all); }, 200);
  });
} else {
  // For other user profiles, rebuild heatmap on resize too
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      // Heatmap will be rebuilt when profile loads
    }, 200);
  });
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_loadOwnTeam", { configurable: true, get: () => _loadOwnTeam, set: (v) => { _loadOwnTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_renderAchievements", { configurable: true, get: () => _renderAchievements, set: (v) => { _renderAchievements = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyTeamTheme", { configurable: true, get: () => applyTeamTheme, set: (v) => { applyTeamTheme = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildHeatmap", { configurable: true, get: () => buildHeatmap, set: (v) => { buildHeatmap = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildHeatmapFromAPI", { configurable: true, get: () => buildHeatmapFromAPI, set: (v) => { buildHeatmapFromAPI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "displayActivityFeed", { configurable: true, get: () => displayActivityFeed, set: (v) => { displayActivityFeed = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "displayRecentPosts", { configurable: true, get: () => displayRecentPosts, set: (v) => { displayRecentPosts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtRel", { configurable: true, get: () => fmtRel, set: (v) => { fmtRel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "handleAvatarChange", { configurable: true, get: () => handleAvatarChange, set: (v) => { handleAvatarChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initPage", { configurable: true, get: () => initPage, set: (v) => { initPage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAchievements", { configurable: true, get: () => loadAchievements, set: (v) => { loadAchievements = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadActivity", { configurable: true, get: () => loadActivity, set: (v) => { loadActivity = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMoreActivity", { configurable: true, get: () => loadMoreActivity, set: (v) => { loadMoreActivity = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMyPosts", { configurable: true, get: () => loadMyPosts, set: (v) => { loadMyPosts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadOtherUserAchievements", { configurable: true, get: () => loadOtherUserAchievements, set: (v) => { loadOtherUserAchievements = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadOtherUserProfile", { configurable: true, get: () => loadOtherUserProfile, set: (v) => { loadOtherUserProfile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "previewAvatarUrl", { configurable: true, get: () => previewAvatarUrl, set: (v) => { previewAvatarUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeAvatar", { configurable: true, get: () => removeAvatar, set: (v) => { removeAvatar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveOtherProfile", { configurable: true, get: () => saveOtherProfile, set: (v) => { saveOtherProfile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveProfile", { configurable: true, get: () => saveProfile, set: (v) => { saveProfile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setAvatar", { configurable: true, get: () => setAvatar, set: (v) => { setAvatar = v; } }); } catch (e) {}
})();
