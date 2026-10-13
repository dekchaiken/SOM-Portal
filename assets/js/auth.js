/* ══════════════════════════════════════════════════
   auth.js  |  Auth state management
   ══════════════════════════════════════════════════ */

// App root URL — derived from the current page URL so it works with any
// deploy folder (centralize-som, SOM-Portal, root install, subfolder, etc.).
// Strips /admin/... /assets/... and any *.html tail to reach the app root.
function _authAppRoot() {
  const u = new URL(window.location.href);
  const root = u.pathname
    .replace(/\/(?:admin|assets)\/.*$/i, '')
    .replace(/\/[^\/]*\.html?$/i, '')
    .replace(/\/+$/, '');
  return u.origin + root;
}

const Auth = {
  TOKEN_KEY: 'som_token',
  USER_KEY:  'som_user',
  _expiryTimer: null,
  _expiryWarningShown: false,

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null');
    } catch { return null; }
  },

  setSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    // Wipe sessionStorage so nothing leaks across users (sidebar html,
    // tools cache, menu-perms, view-as team ctx — all are per-user).
    // Per-tab only, so we're not clobbering anything the new session needs.
    try { sessionStorage.clear(); } catch { /* ignore */ }
  },

  logout() {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(15,15,15,.55);backdrop-filter:blur(3px)',
      'display:flex;align-items:center;justify-content:center',
      'z-index:9999;font-family:\'JetBrains Mono\',monospace',
      'animation:_loFadeIn .18s ease both'
    ].join(';');

    const style = document.createElement('style');
    style.textContent = `
      @keyframes _loFadeIn { from{opacity:0} to{opacity:1} }
      @keyframes _loCardIn { from{opacity:0;transform:translateY(12px) scale(.96)} to{opacity:1;transform:none} }
      ._lo-card { animation: _loCardIn .22s cubic-bezier(.22,.68,0,1.2) both; }
      ._lo-btn  { transition: background .15s, transform .1s; }
      ._lo-btn:hover { filter: brightness(.92); }
      ._lo-btn:active { transform: scale(.97); }
    `;
    document.head.appendChild(style);

    overlay.innerHTML = `
      <div class="_lo-card" style="
        background:#fff;border-radius:18px;padding:32px 28px 24px;
        max-width:300px;width:90%;text-align:center;
        box-shadow:0 24px 64px rgba(0,0,0,.22)">
        <div style="font-size:32px;margin-bottom:14px;line-height:1">⏻</div>
        <div style="font-size:14px;font-weight:700;color:#1c1c1e;margin-bottom:6px">Sign out?</div>
        <div style="font-size:11px;color:#999;margin-bottom:24px;line-height:1.5">คุณต้องการออกจากระบบใช่มั้ย</div>
        <div style="display:flex;gap:8px">
          <button id="_lo-cancel" class="_lo-btn" style="
            flex:1;padding:9px;border:1.5px solid #e8e8e8;border-radius:9px;
            background:#fff;font-family:inherit;font-size:11.5px;font-weight:600;
            cursor:pointer;color:#555">Cancel</button>
          <button id="_lo-confirm" class="_lo-btn" style="
            flex:1;padding:9px;border:none;border-radius:9px;
            background:#F26419;color:#fff;font-family:inherit;
            font-size:11.5px;font-weight:700;cursor:pointer">Sign Out</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#_lo-cancel').onclick  = () => { overlay.remove(); style.remove(); };
    overlay.querySelector('#_lo-confirm').onclick = () => {
      overlay.remove(); style.remove();
      this._doLogout();
    };
  },

  _doLogout() {
    // Diagnostic: persist the call stack in localStorage so it survives the redirect
    try {
      localStorage.setItem('som_debug_logout', JSON.stringify({
        time:  new Date().toISOString(),
        stack: new Error().stack,
        token_exp: (() => { try { const t=this.getToken(); return t ? this.decodeToken(t)?.exp : null; } catch(e){return null;} })(),
        now_sec: Math.floor(Date.now()/1000),
      }));
    } catch(e) {}
    console.warn('[Auth] _doLogout triggered. Stack:', new Error().stack);
    // Log logout event (fire-and-forget)
    try {
      const token = this.getToken();
      if (token) {
        const base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
        fetch(base + '/auth/logout.php', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        }).catch(() => {});
      }
    } catch(e) {}

    const fade = document.createElement('div');
    fade.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;z-index:9998;transition:opacity .35s ease;pointer-events:all';
    document.body.appendChild(fade);
    requestAnimationFrame(() => { requestAnimationFrame(() => { fade.style.opacity = '1'; }); });

    setTimeout(() => {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
      localStorage.removeItem('csrf_token');
      // Drop per-tab caches so the next user's login starts clean
      // (sidebar html, tools cache, menu-perms, view-as team ctx).
      try { sessionStorage.clear(); } catch {}
      window.location.href = _authAppRoot() + '/index.html';
    }, 380);
  },

  // Decode JWT payload (no verification — server handles that)
  decodeToken(token) {
    try {
      const payload = token.split('.')[1];
      return JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
    } catch { return null; }
  },

  isTokenExpired(token) {
    const decoded = this.decodeToken(token);
    if (!decoded) return true;
    return decoded.exp < Math.floor(Date.now() / 1000);
  },

  // Guard: redirect to login if not authenticated
  requireAuth() {
    const token = this.getToken();
    if (!token || this.isTokenExpired(token)) {
      try {
        const dec = token ? this.decodeToken(token) : null;
        localStorage.setItem('som_debug_logout', JSON.stringify({
          source: 'requireAuth',
          time: new Date().toISOString(),
          has_token: !!token,
          token_exp: dec?.exp ?? null,
          now_sec: Math.floor(Date.now()/1000),
          url: window.location.href,
        }));
      } catch(e) {}
      // Silent redirect — no confirm dialog for expired/missing sessions
      this._doLogout();
      return false;
    }
    const user = this.getUser();
    const decoded = this.decodeToken(token);
    // first_login: force change password
    if (user?.first_login) {
      if (!window.location.pathname.includes('change-password')) {
        window.location.href = './change-password.html';
      }
      return false;
    }
    // password_expired: check stored flag OR dynamic pw_expires_at from JWT
    const pwExpiredByTime = decoded?.pw_expires_at > 0
      && Math.floor(Date.now() / 1000) > decoded.pw_expires_at;
    if (user?.password_expired || pwExpiredByTime) {
      if (!window.location.pathname.includes('change-password')) {
        window.location.href = './change-password.html?reason=expired';
      }
      return false;
    }
    // must_reset_password: admin-forced reset
    if (user?.must_reset_password) {
      if (!window.location.pathname.includes('change-password')) {
        window.location.href = './change-password.html?reason=admin_reset';
      }
      return false;
    }
    // external user: check page permission
    if (user?.role === 'external') {
      const perms = user.permissions || [];
      const slug  = this._getPageSlug();
      const always = ['profile', 'change-password', 'index', 'about-som', ''];
      if (!always.includes(slug) && !perms.includes(slug)) {
        this._showNoAccessOverlay();
        return false;
      }
    }
    return true;
  },

  _showNoAccessOverlay() {
    // Clear all page content immediately — removing the overlay will show nothing
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:0;min-height:100vh;background:#f5f5f7';

    const style = document.createElement('style');
    style.textContent = `
      @keyframes _naIn { from{opacity:0;transform:translateY(12px) scale(.96)} to{opacity:1;transform:none} }
      ._na-card { animation:_naIn .22s cubic-bezier(.22,.68,0,1.2) both; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = '_no-access-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9999',
      'display:flex;align-items:center;justify-content:center',
      "font-family:var(--font,'JetBrains Mono',monospace)"
    ].join(';');

    const root = _authAppRoot();
    const isAdmin = /\/admin\//.test(window.location.pathname);
    const profileHref = isAdmin ? '../profile.html' : root + '/profile.html';

    overlay.innerHTML = `
      <div class="_na-card" style="
        background:#fff;border-radius:20px;padding:40px 32px;
        text-align:center;max-width:340px;width:90%;
        box-shadow:0 24px 64px rgba(0,0,0,.25)">
        <div style="font-size:44px;margin-bottom:14px;line-height:1">🔒</div>
        <div style="font-size:16px;font-weight:800;color:#1c1c1e;margin-bottom:8px">No Access</div>
        <div style="font-size:12px;color:#888;line-height:1.7;margin-bottom:28px">
          คุณไม่มีสิทธิ์เข้าถึงหน้านี้<br>
          กรุณาติดต่อ Admin เพื่อขอสิทธิ์เพิ่มเติม
        </div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button onclick="history.back()" style="
            padding:10px 18px;border-radius:10px;border:1.5px solid #e8e8e8;
            background:#fff;font-family:inherit;font-size:12px;font-weight:600;
            cursor:pointer;color:#555;transition:all .12s"
            onmouseover="this.style.borderColor='#ccc'" onmouseout="this.style.borderColor='#e8e8e8'">
            ← ย้อนกลับ
          </button>
          <a href="${profileHref}" style="
            padding:10px 18px;border-radius:10px;border:none;
            background:#F26419;color:#fff;font-family:inherit;font-size:12px;font-weight:700;
            cursor:pointer;text-decoration:none;display:inline-flex;align-items:center">
            หน้าโปรไฟล์
          </a>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  },

  // Extract page slug from current URL (filename without .html)
  _getPageSlug() {
    const path  = window.location.pathname;
    const parts = path.split('/');
    const file  = parts.pop() || 'index';
    return file.replace('.html', '') || 'index';
  },

  // Guard: redirect if not admin
  requireAdmin() {
    if (!this.requireAuth()) return false;
    const user = this.getUser();
    if (!user || !['super_admin', 'sm_admin', 'dev_sm'].includes(user.role)) {
      // Redirect to root-level home, not relative (avoids admin/dashboard.html from admin/ pages)
      const prefix = window.location.pathname.includes('/admin/') ? '../' : './';
      window.location.href = prefix + (user?.role === 'dev_user' ? 'dev-hub.html' : 'dashboard.html');
      return false;
    }
    return true;
  },

  // ── New team-aware helpers ──────────────────────────────
  isSuperAdmin() {
    return this.getUser()?.role === 'super_admin';
  },

  // Roles that can view any team globally (view-as via X-Admin-Team header).
  // super_admin has full write access; super_viewer is read-only.
  isGlobalReader() {
    return ['super_admin', 'super_viewer'].includes(this.getUser()?.role);
  },

  isAdmin() {
    return ['super_admin', 'sm_admin', 'dev_sm'].includes(this.getUser()?.role);
  },

  getTeam() {
    return this.decodeToken(this.getToken())?.team ?? null;
  },

  // ── Home / landing page after login ─────────────────────────────────────
  // Internal team users land on the dashboard. External users land on their
  // FIRST granted tool page (e.g. Jenkins Build) so they don't hit a
  // dashboard they can't see. Used by index.html + change-password.html.
  homePath() {
    const user = this.getUser();
    if (!user) return './dashboard.html';
    if (user.role === 'dev_user') return './dev-hub.html';
    if (user.role !== 'external') return './dashboard.html';

    const perms = user.permissions || [];
    // Priority order of page grants an external user might hold.
    const PREFERRED = [
      'jenkins-build', 'jenkins-portal', 'so-jenkins', 'batch-monitor', 'batch-file-search', 'monitoring',
      'test-service', 'alert-monitor', 'uptime', 'restart-monitor',
      'grafana-alerts', 'inbox', 'sheets', 'sabai', 'schedule', 'learn',
      'ma-services', 'analytics', 'weekly-report', 'board', 'dashboard',
    ];
    for (const p of PREFERRED) {
      if (perms.includes(p)) return './' + p + '.html';
    }
    return './profile.html';
  },

  // ── View-as team helper (super_admin / super_viewer) ─────────────────────
  // When a global-read role picks a team in the .sa-team-ctx switcher, we
  // look up that team from the sessionStorage cache written by admin-nav.js
  // and return it — so UI gates (sidebar, admin cards, nav groups) can
  // preview exactly what a member of that team would see.
  _getViewAsTeam() {
    try {
      const slug = sessionStorage.getItem('_admin_team_ctx');
      if (!slug) return null;
      const raw = sessionStorage.getItem('_sa_teams_data');
      if (!raw) return null;
      const teams = JSON.parse(raw);
      return teams.find(t => t.slug === slug) || null;
    } catch { return null; }
  },

  getTeamFeatures() {
    const user = this.getUser();
    if (!user) return [];
    if (this.isGlobalReader()) {
      // View-as team → preview that team's feature scope.
      // No team selected → keep global access (null = see everything).
      const t = this._getViewAsTeam();
      return t ? (t.features || []) : null;
    }
    return user.team_features || [];
  },

  // Returns per-feature page grants: { 'batch-monitor': { user_pages:[...], admin_pages:[...] } }
  // Only populated when super_admin did a custom (non-default) page selection during approval.
  getTeamFeaturePages() {
    const user = this.getUser();
    if (!user) return {};
    if (this.isGlobalReader()) {
      const t = this._getViewAsTeam();
      return t ? (t.feature_pages || {}) : {};
    }
    return user.team_feature_pages || {};
  },

  // ── Page Access Mode ────────────────────────────────────────────────────────
  // Returns 'full' | 'read' for a given page.
  // • super_viewer is always 'read' (globally read-only oversight role).
  // • super_admin is 'full' unless view-as'ing a team with a stricter mode.
  // • Regular users get their team's per-page mode.
  getPageMode(pageId) {
    const user = this.getUser();
    if (!user) return 'full';
    if (user.role === 'super_viewer') return 'read';
    if (user.role === 'super_admin') {
      const t = this._getViewAsTeam();
      if (!t) return 'full';
      return (t.page_modes || {})[pageId] || 'full';
    }
    return (user.team_page_modes || {})[pageId] || 'full';
  },

  // Apply page mode to <body data-page-mode="read|full">.
  // CSS rules in style.css hide [data-action="add/edit/delete"] buttons when read.
  applyPageMode(pageId) {
    const mode = this.getPageMode(pageId);
    document.body.dataset.pageMode = mode;
    if (mode === 'read' && !document.getElementById('_read-only-pill')) {
      // Minimal floating pill — non-intrusive, matches app theme (blocks.so style).
      // Sits just below the topbar in the corner so it doesn't fight for layout space.
      if (!document.getElementById('_read-only-pill-css')) {
        const s = document.createElement('style');
        s.id = '_read-only-pill-css';
        s.textContent = `
          .ro-pill {
            position: fixed;
            top: calc(var(--topbar-h, 56px) + 10px);
            right: 16px;
            z-index: 950;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 10px 5px 8px;
            border-radius: 999px;
            background: color-mix(in srgb, var(--bg-card, #fff) 88%, transparent);
            border: 1px solid var(--border, rgba(0,0,0,.08));
            backdrop-filter: saturate(1.2) blur(8px);
            -webkit-backdrop-filter: saturate(1.2) blur(8px);
            box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.05);
            color: var(--text-muted, #64748b);
            font-family: var(--font, 'JetBrains Mono', ui-monospace, monospace);
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: .02em;
            user-select: none;
            transition: opacity .18s ease, transform .18s ease;
          }
          .ro-pill:hover { opacity: .6; }
          .ro-pill .ro-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: #6366f1; flex-shrink: 0;
          }
          .ro-pill .ro-label { line-height: 1; }
          @media (max-width: 640px) {
            .ro-pill { top: auto; bottom: 12px; right: 12px; }
          }
        `;
        document.head.appendChild(s);
      }
      const pill = document.createElement('div');
      pill.id = '_read-only-pill';
      pill.className = 'ro-pill';
      pill.title = 'ทีมของคุณสามารถดูข้อมูลได้แต่ไม่สามารถเพิ่ม / แก้ไขได้';
      pill.innerHTML = '<span class="ro-dot"></span><span class="ro-label">View only</span>';
      document.body.appendChild(pill);
    }
  },

  // ── Refresh team features from server ─────────────────────────────────────
  // Called as a background task after sidebar renders. If features changed
  // (e.g. super_admin approved a request), updates localStorage and reloads.
  // Global-read roles (super_admin, super_viewer) have no team of their own
  // so there's nothing to refresh — their view-as scope is client-side only.
  async refreshTeamFeatures() {
    const user = this.getUser();
    if (!user || this.isGlobalReader()) return false;
    try {
      const [teamsRes, meRes] = await Promise.all([
        typeof API !== 'undefined' ? API.teams.list()  : Promise.resolve(null),
        typeof API !== 'undefined' ? API.auth.me()     : Promise.resolve(null),
      ]);

      let changed = false;
      const updates = {};

      if (teamsRes?.ok) {
        const teams  = teamsRes.data?.data || teamsRes.data || [];
        const myTeam = teams.find(t => t.slug === user.team);
        if (myTeam) {
          const newFeatures = (myTeam.features || []).slice().sort().join(',');
          const oldFeatures = (user.team_features || []).slice().sort().join(',');
          const newPages    = JSON.stringify(myTeam.feature_pages || {});
          const oldPages    = JSON.stringify(user.team_feature_pages || {});
          const newModes    = JSON.stringify(myTeam.page_modes || {});
          const oldModes    = JSON.stringify(user.team_page_modes || {});
          if (newFeatures !== oldFeatures || newPages !== oldPages || newModes !== oldModes) {
            Object.assign(updates, {
              team_features:      myTeam.features,
              team_feature_pages: myTeam.feature_pages || {},
              team_page_modes:    myTeam.page_modes    || {},
            });
            changed = true;
          }
        }
      }

      if (meRes?.ok) {
        const fresh    = meRes.data?.data?.extra_pages || [];
        const old      = user.extra_pages || [];
        const freshStr = JSON.stringify(fresh.map(ep => ep.page + ':' + ep.source_team).sort());
        const oldStr   = JSON.stringify(old.map(ep => ep.page  + ':' + ep.source_team).sort());
        if (freshStr !== oldStr) {
          updates.extra_pages = fresh;
          changed = true;
        }
      }

      if (!changed) return false;
      this.updateUser(updates);
      try { sessionStorage.clear(); } catch {}
      return true; // signal caller to reload
    } catch { return false; }
  },

  // Update stored user session (e.g. after profile save)
  updateUser(updates) {
    const user = this.getUser();
    if (!user) return null;
    const updated = { ...user, ...updates };
    localStorage.setItem(this.USER_KEY, JSON.stringify(updated));
    return updated;
  },

  // ── Session expiry watcher ──────────────────────────────
  startExpiryWatcher() {
    if (this._expiryTimer) return;
    const WARN_BEFORE_SEC = 15 * 60; // warn 15 min before expiry
    const CHECK_MS = 15 * 1000;      // check every 15s (catches expiry before background 401 can fire)

    const check = () => {
      const token = this.getToken();
      if (!token) return;
      const decoded = this.decodeToken(token);
      if (!decoded) return;
      const now      = Math.floor(Date.now() / 1000);
      const secsLeft = decoded.exp - now;
      const totalSec = decoded.exp - (decoded.iat || 0);

      if (secsLeft <= 0) {
        try {
          localStorage.setItem('som_debug_logout', JSON.stringify({
            source: 'expiryWatcher',
            time: new Date().toISOString(),
            token_exp: decoded.exp,
            now_sec: now,
            secs_late: Math.abs(secsLeft),
          }));
        } catch(e) {}
        this._doLogout(); return;
      }

      // Only warn if the total session is long enough that 15 min is meaningful
      if (secsLeft <= WARN_BEFORE_SEC && totalSec > WARN_BEFORE_SEC && !this._expiryWarningShown) {
        this._expiryWarningShown = true;
        this._showExpiryBanner(secsLeft);
      }
    };

    check();
    this._expiryTimer = setInterval(check, CHECK_MS);
  },

  _showExpiryBanner(secsLeft) {
    const existing = document.getElementById('_session-expiry-banner');
    if (existing) existing.remove();

    const minsLeft = Math.ceil(secsLeft / 60);
    const style = document.createElement('style');
    style.textContent = `@keyframes _bannerIn { from{transform:translateY(-100%)} to{transform:none} }`;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = '_session-expiry-banner';
    banner.style.cssText = [
      'position:fixed;top:0;left:0;right:0;z-index:9990',
      'background:#fff7ed;border-bottom:2px solid #f97316',
      'padding:10px 20px;display:flex;align-items:center;gap:12px',
      "font-family:var(--font,'JetBrains Mono',monospace);font-size:12px",
      'animation:_bannerIn .25s ease both;box-shadow:0 4px 16px rgba(249,115,22,.2)'
    ].join(';');

    banner.innerHTML = `
      <span style="font-size:18px;flex-shrink:0">⏳</span>
      <span style="flex:1;color:#9a3412;font-weight:600">
        Session หมดอายุใน <strong>${minsLeft} นาที</strong> — กรุณา Login ใหม่เพื่อต่อ session
      </span>
      <button id="_session-extend-btn" style="
        padding:6px 14px;border-radius:7px;border:1.5px solid #f97316;
        background:#f97316;color:#fff;font-family:inherit;font-size:11.5px;
        font-weight:700;cursor:pointer;flex-shrink:0">
        ต่อ Session
      </button>
      <button id="_session-dismiss-btn" style="
        padding:6px 10px;border-radius:7px;border:1.5px solid #fed7aa;
        background:transparent;color:#9a3412;font-family:inherit;
        font-size:11px;cursor:pointer;flex-shrink:0">
        ✕
      </button>`;

    document.body.prepend(banner);

    document.getElementById('_session-extend-btn').onclick = () => {
      banner.remove();
      const returnPath = encodeURIComponent(window.location.href);
      window.location.href = `${_authAppRoot()}/index.html?return=${returnPath}&reason=extend`;
    };
    document.getElementById('_session-dismiss-btn').onclick = () => banner.remove();
  },

  // Initialize sidebar user info
  initUserUI() {
    const user = this.getUser();
    if (!user) return;
    const nameEl   = document.getElementById('user-name');
    const roleEl   = document.getElementById('user-role');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl)   nameEl.textContent   = user.name;
    if (roleEl)   roleEl.textContent   = Roles.label(user.role);
    if (avatarEl) avatarEl.textContent = getInitials(user.name);

    // Team badge — show which team this user belongs to
    const teamEl = document.getElementById('user-team-badge');
    if (teamEl) {
      if (user.role === 'super_admin') {
        teamEl.textContent = '⚡ SUPER';
        teamEl.style.display = '';
      } else if (user.role === 'super_viewer') {
        teamEl.textContent = '👁 VIEWER';
        teamEl.style.display = '';
      } else if (user.team) {
        teamEl.textContent = user.team.toUpperCase();
        teamEl.style.display = '';
      }
    }

    // Hide admin nav items for non-admins. super_viewer is intentionally
    // excluded from admin — they see everything except /admin/*.
    const isAdmin = ['super_admin', 'sm_admin', 'dev_sm'].includes(user.role);
    if (!isAdmin) {
      document.querySelectorAll('[data-admin-only]').forEach(el => el.classList.add('hidden'));
    }

    // Super-admin-only nav items (e.g. super-admin panel link)
    if (user.role !== 'super_admin') {
      document.querySelectorAll('[data-superadmin-only]').forEach(el => el.classList.add('hidden'));
    }
  }
};
