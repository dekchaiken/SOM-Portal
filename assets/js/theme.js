/* theme.js — Dark mode + UI theme. Load FIRST in <head> (no defer/async) to prevent flash.
   Two orthogonal preferences (except Console — see rule below):
     data-theme = "light" | "dark"                     (color mode)
     data-ui    = "glass" | "enterprise" | "console" | "warm"  (shell visual style)

   Rule: Console theme is inherently dark. Picking Console auto-switches to dark
   and locks Theme.toggle() while Console is active.
*/
(function () {
  const KEY    = 'som_theme';
  const UI_KEY = 'som_ui';
  // Phase 1 redesign: Liquid Glass is the only shell style. Other UI variants are retired.
  const UI_ALLOWED  = ['glass'];
  const UI_GENZONLY = [];
  const UI_DARK_ONLY = [];
  const UI_DEFAULT  = 'glass';
  const LIQUID_CSS  = 'assets/css/liquid/liquid.css?v=20261013';

  function _isGenzUser() {
    try {
      var raw = localStorage.getItem('som_user');
      if (raw) {
        var u = JSON.parse(raw);
        var flagged = !!(u && (u.is_genz === true || u.is_genz === 1 || u.is_genz === '1'));
        // Cache flag independently so it survives logout (som_user gets cleared)
        try {
          if (flagged) localStorage.setItem('som_genz', '1');
          else localStorage.removeItem('som_genz');
        } catch (_) {}
        return flagged;
      }
      // No user object (logged out / auth pages) → trust cached flag
      return localStorage.getItem('som_genz') === '1';
    } catch (_) {}
    return false;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.title = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }

  function _ensureGenzFonts() {
    if (document.querySelector('link[data-genz-fonts]')) return;
    var pre = document.createElement('link');
    pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = '';
    document.head.appendChild(pre);
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700;800&display=swap';
    link.setAttribute('data-genz-fonts', '1');
    document.head.appendChild(link);
  }

  function applyUI(ui) {
    if (!UI_ALLOWED.includes(ui)) ui = UI_DEFAULT;
    // GenZ-only themes: silently downgrade if user lost the flag
    if (UI_GENZONLY.indexOf(ui) !== -1 && !_isGenzUser()) ui = UI_DEFAULT;
    document.documentElement.setAttribute('data-ui', ui);
    document.documentElement.setAttribute('data-liquid', '1');
    if (UI_GENZONLY.indexOf(ui) !== -1) _ensureGenzFonts();
  }

  // Liquid Glass design system (assets/css/liquid/liquid.css). Loaded after the page's own
  // stylesheets so it wins the cascade; re-appended on DOMContentLoaded to keep it last.
  function _liquidHref() {
    var cs = document.currentScript;
    var src = cs && cs.src ? cs.src : '';
    return src ? src.replace(/assets\/js\/theme\.js.*$/, LIQUID_CSS) : LIQUID_CSS;
  }
  var _liquidHrefResolved = _liquidHref();
  function _mountLiquid() {
    var link = document.querySelector('link[data-liquid-css]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = _liquidHrefResolved;
      link.setAttribute('data-liquid-css', '1');
    }
    document.head.appendChild(link);
  }
  _mountLiquid();
  document.addEventListener('DOMContentLoaded', _mountLiquid);

  // Apply nav style immediately (before DOM paint) so sidebar CSS hides before restore
  // Default is 'horizon' — sidebar only shows if user explicitly cleared the pref
  (function() {
    try {
      var ns = localStorage.getItem('som_nav_style') || 'horizon';
      if (ns && ns !== 'sidebar' && ns !== '') {
        document.documentElement.setAttribute('data-nav-style', ns);
      }
    } catch (_) {}
  })();

  // Apply immediately on script parse (before DOM paint) — no FOUC
  const savedTheme = localStorage.getItem(KEY);
  const savedUI    = localStorage.getItem(UI_KEY) || UI_DEFAULT;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Dark-only themes (console / cyber / aura) force dark regardless of saved preference.
  const initialTheme = (UI_DARK_ONLY.indexOf(savedUI) !== -1)
    ? 'dark'
    : (savedTheme || (prefersDark ? 'dark' : 'light'));

  applyTheme(initialTheme);
  applyUI(savedUI);

  // Persist the forced dark for dark-only themes
  if (UI_DARK_ONLY.indexOf(savedUI) !== -1 && savedTheme !== 'dark') {
    try { localStorage.setItem(KEY, 'dark'); } catch (_) {}
  }

  // Mark page as "entering" so CSS hides main-content until Layout.render() triggers the transition.
  // Safety fallback: reveal after 2500ms in case layout.js never clears it.
  document.documentElement.setAttribute('data-entering', '');
  setTimeout(function() {
    document.documentElement.removeAttribute('data-entering');
    if (window.PageLoader && window.PageLoader.hide) window.PageLoader.hide();
  }, 2500);

  // ── Global page loader (unified: cold load + nav transitions) ──────────
  // Injected as soon as <body> exists so every page shows the branded
  // orange-bot loader immediately. Layout._hidePageLoader() fades it out
  // once render() completes. Pages that need to wait for data can call
  // Layout.holdLoader() + Layout.ready().
  // Opt out with <html data-no-global-loader> or <body data-no-global-loader>.

  function _escH(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _mascotSvg() {
    return '<svg width="88" height="100" viewBox="0 0 80 92" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="37" y="0" width="6" height="14" rx="3" fill="#5aad3f"/>' +
        '<path d="M38 9 Q24 3 22 11 Q28 18 38 13Z" fill="#4a9a30"/>' +
        '<circle cx="40" cy="56" r="34" fill="#F26419"/>' +
        '<circle cx="28" cy="42" r="8" fill="rgba(255,255,255,.15)"/>' +
        '<path d="M40 22 Q56 38 40 90" stroke="rgba(255,255,255,.15)" stroke-width="2" fill="none"/>' +
        '<path d="M40 22 Q24 38 40 90" stroke="rgba(255,255,255,.15)" stroke-width="2" fill="none"/>' +
        '<circle cx="29" cy="52" r="6" fill="white"/><circle cx="51" cy="52" r="6" fill="white"/>' +
        '<circle cx="30.5" cy="53" r="3" fill="#2a1005"/><circle cx="52.5" cy="53" r="3" fill="#2a1005"/>' +
        '<circle cx="31.5" cy="51.8" r="1.2" fill="white"/><circle cx="53.5" cy="51.8" r="1.2" fill="white"/>' +
        '<circle cx="20" cy="60" r="6" fill="rgba(255,180,80,.35)"/><circle cx="60" cy="60" r="6" fill="rgba(255,180,80,.35)"/>' +
        '<path d="M28 63 Q40 73 52 63" stroke="#2a1005" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
      '</svg>';
  }

  function _labelLine(label) {
    return 'กำลังโหลด<span id="loader-label">' + _escH(label) + '</span>' +
      '<span class="pl-dots"><i></i><i></i><i></i></span>';
  }

  function _teamBadge() {
    try {
      var raw = localStorage.getItem('som_user');
      if (raw) {
        var u = JSON.parse(raw);
        if (u && u.team) return String(u.team).toUpperCase().slice(0, 4);
      }
      var tok = localStorage.getItem('som_token');
      if (tok && tok.split('.').length === 3) {
        var payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        if (payload && payload.team) return String(payload.team).toUpperCase().slice(0, 4);
      }
    } catch (_) {}
    return 'SM';
  }

  function _buildLoaderHtml(label) {
    var ui = document.documentElement.getAttribute('data-ui') || 'glass';
    var lbl = _labelLine(label);

    if (ui === 'enterprise') {
      return '<div class="pl-variant pl-enterprise">' +
        '<div class="pl-ent-card">' +
          '<div class="pl-ent-row"><div class="pl-ent-title">' + lbl + '</div><div class="pl-ent-pct">Preparing…</div></div>' +
          '<div class="pl-ent-track"><div class="pl-ent-bar"></div></div>' +
          '<div class="pl-ent-sk"><div></div><div></div><div></div></div>' +
          '<div class="pl-ent-status"><span class="pl-ent-dot"></span>Fetching data · rendering UI</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'console') {
      return '<div class="pl-variant pl-console">' +
        '<div class="pl-con-card">' +
          '<div class="pl-con-hd"><span class="d r"></span><span class="d y"></span><span class="d g"></span>' +
            '<span class="pl-con-path">~/som-portal</span></div>' +
          '<div class="pl-con-body">' +
            '<div class="pl-con-scan"></div>' +
            '<div class="pl-con-line"><span class="a">$</span> <span class="k">load</span> <span class="s">"' + _escH(label || 'page') + '"</span> <span class="a">--</span>trace</div>' +
            '<div class="pl-con-line">→ fetching <span class="k">modules</span></div>' +
            '<div class="pl-con-line">→ hydrating <span class="k">state</span></div>' +
            '<div class="pl-con-line">→ mounting <span class="k">ui</span><span class="pl-con-caret"></span></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'warm') {
      return '<div class="pl-variant pl-warm">' +
        '<div class="pl-warm-blob b1"></div><div class="pl-warm-blob b2"></div><div class="pl-warm-blob b3"></div>' +
        '<div class="pl-warm-card">' +
          '<div class="pl-warm-mascot">' + _mascotSvg() + '<div class="pl-warm-shadow"></div></div>' +
          '<div class="pl-warm-title">' + lbl + '</div>' +
          '<div class="pl-warm-sub">กำลังเตรียมข้อมูลทุกอย่างให้คุณครับ</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'y2k') {
      return '<div class="pl-variant pl-y2k">' +
        '<div class="pl-y2k-card">' +
          '<div class="pl-y2k-disc"></div>' +
          '<div class="pl-y2k-title">' + lbl + '</div>' +
          '<div class="pl-y2k-sub">✦ MAKING IT AESTHETIC ✦</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'kawaii') {
      return '<div class="pl-variant pl-kawaii">' +
        '<span class="pl-kw-star s1">✦</span>' +
        '<span class="pl-kw-star s2">✦</span>' +
        '<span class="pl-kw-star s3">✦</span>' +
        '<div class="pl-kw-card">' +
          '<div class="pl-kw-face"><span class="pl-kw-cheek l"></span><span class="pl-kw-cheek r"></span><span class="pl-kw-mouth"></span></div>' +
          '<div class="pl-kw-title">' + lbl + ' ♡</div>' +
          '<div class="pl-kw-sub">รอสักครู่นะจ๊ะ~</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'brutalist') {
      return '<div class="pl-variant pl-brut">' +
        '<div class="pl-brut-card">' +
          '<div class="pl-brut-row"><div class="pl-brut-badge">LOADING</div><div class="pl-brut-pct">∞%</div></div>' +
          '<div class="pl-brut-track"><div class="pl-brut-bar"></div></div>' +
          '<div class="pl-brut-title">' + lbl + '</div>' +
          '<div class="pl-brut-sub">HANG TIGHT.</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'cyber') {
      return '<div class="pl-variant pl-cyber">' +
        '<div class="pl-cyber-grid"></div>' +
        '<div class="pl-cyber-card">' +
          '<div class="pl-cyber-corner tl"></div><div class="pl-cyber-corner tr"></div>' +
          '<div class="pl-cyber-corner bl"></div><div class="pl-cyber-corner br"></div>' +
          '<div class="pl-cyber-disc"></div>' +
          '<div class="pl-cyber-title">' + lbl + '</div>' +
          '<div class="pl-cyber-sub">✦ INITIALIZING ✦</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'bento') {
      return '<div class="pl-variant pl-bento">' +
        '<div class="pl-bento-card">' +
          '<div class="pl-bento-star">✦</div>' +
          '<div class="pl-bento-title">' + lbl + '</div>' +
          '<div class="pl-bento-sub">preparing…</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'aura') {
      return '<div class="pl-variant pl-aura">' +
        '<div class="pl-aura-blob b1"></div>' +
        '<div class="pl-aura-blob b2"></div>' +
        '<div class="pl-aura-blob b3"></div>' +
        '<div class="pl-aura-card">' +
          '<div class="pl-aura-ring"></div>' +
          '<div class="pl-aura-title">' + lbl + '</div>' +
          '<div class="pl-aura-sub">loading…</div>' +
        '</div>' +
      '</div>';
    }

    if (ui === 'zine') {
      return '<div class="pl-variant pl-zine">' +
        '<div class="pl-zine-card">' +
          '<div class="pl-zine-vol">SOM Portal · Loading</div>' +
          '<div class="pl-zine-title">' + lbl + '</div>' +
          '<div class="pl-zine-rule"></div>' +
          '<div class="pl-zine-sub">กำลังโหลด<span class="pl-dots"><i></i><i></i><i></i></span></div>' +
        '</div>' +
      '</div>';
    }

    // default: glass
    return '<div class="pl-variant pl-glass">' +
      '<div class="pl-glass-card">' +
        (function(){ var t=_teamBadge(); var fs = t.length>=4?11:t.length===3?12:14;
          return '<div class="pl-glass-ring"><div class="pl-glass-core" style="font-size:'+fs+'px">' + _escH(t) + '</div></div>'; })() +
        '<div class="pl-glass-title">' + lbl + '</div>' +
        '<div class="pl-glass-sub">เตรียมข้อมูลของคุณ…</div>' +
      '</div>' +
    '</div>';
  }

  window.PageLoader = {
    build: _buildLoaderHtml,
    inject: function (label) {
      if (document.documentElement.hasAttribute('data-no-global-loader')) return null;
      if (document.body && document.body.hasAttribute('data-no-global-loader')) return null;
      if (!document.body) return null;
      var el = document.getElementById('page-loader');
      if (el) {
        el.classList.remove('loader-hiding');
        if (label) {
          var lb = document.getElementById('loader-label');
          if (lb) lb.textContent = label;
        }
        return el;
      }
      el = document.createElement('div');
      el.id = 'page-loader';
      el.innerHTML = _buildLoaderHtml(label || '');
      document.body.insertBefore(el, document.body.firstChild);
      return el;
    },
    hide: function () {
      var el = document.getElementById('page-loader');
      if (!el || el.classList.contains('loader-hiding')) return;
      el.classList.add('loader-hiding');
      setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 420);
      try { sessionStorage.removeItem('_sm_sb_next_label'); } catch (_) {}
    }
  };

  function autoInjectLoader() {
    if (document.getElementById('page-loader')) return;
    // Prefer next-label from prior nav click; else derive from page
    var lbl = '';
    try { lbl = sessionStorage.getItem('_sm_sb_next_label') || ''; } catch (_) {}
    if (!lbl && document.body && document.body.dataset && document.body.dataset.pageLabel) {
      lbl = document.body.dataset.pageLabel;
    }
    if (!lbl && document.title) {
      lbl = document.title.split(/[-—·]/)[0].trim();
    }
    window.PageLoader.inject(lbl);
  }

  if (document.body) {
    autoInjectLoader();
  } else {
    var _bodyObs = new MutationObserver(function () {
      if (document.body) {
        _bodyObs.disconnect();
        autoInjectLoader();
      }
    });
    _bodyObs.observe(document.documentElement, { childList: true });
  }

  // ── Auto-load skeletons.js on every page ─────────────────────────────
  // So any page can drop <div data-skel="cards" data-count="6"></div> in
  // its markup and get skeleton loading with zero per-page script tags.
  // Deferred to DOMContentLoaded so pages that already have their own
  // <script src="skeletons.js"> tag in <body> get skipped (skeletons.js
  // has an idempotent guard anyway, but this avoids a wasted request).
  function autoLoadSkeletons() {
    if (window.Skeleton) return;
    if (document.querySelector('script[src*="skeletons.js"]')) return;
    var me = null;
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && /\/assets\/js\/theme\.js(\?|$)/.test(scripts[i].src)) {
        me = scripts[i];
        break;
      }
    }
    if (!me) return;
    var base = me.src.replace(/theme\.js.*$/, '');
    var s = document.createElement('script');
    s.src = base + 'skeletons.js';
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoLoadSkeletons);
  } else {
    autoLoadSkeletons();
  }

  // ── Topnav restore (mirrors sidebar sb-restore, but injected via theme.js) ──
  // When nav-style is active and _sm_tn_html is cached, restore the topnav
  // before Layout.render() runs so there's zero flash of missing navbar.
  (function () {
    try {
      var navStyle = localStorage.getItem('som_nav_style') || '';
      if (!navStyle) return;                    // sidebar mode: no topnav to restore
      var h = sessionStorage.getItem('_sm_tn_html');
      if (!h) return;

      var restored = false;
      function _doRestore() {
        if (restored || document.getElementById('topnav-wrap')) return;
        var mc = document.querySelector('.main-content');
        if (!mc || !mc.parentNode) return;
        restored = true;
        var d = document.createElement('div');
        d.innerHTML = h;
        var tn = d.querySelector('#topnav-wrap');
        if (!tn) return;
        mc.parentNode.insertBefore(tn, mc);
      }

      // Try immediately (DOMContentLoaded or already parsed)
      if (document.readyState !== 'loading') {
        _doRestore();
      } else {
        // Use MutationObserver to catch the moment .main-content enters DOM
        var _obs = new MutationObserver(function () {
          _doRestore();
          if (restored) _obs.disconnect();
        });
        _obs.observe(document.documentElement, { childList: true, subtree: true });
        // Fallback: also try at DOMContentLoaded
        document.addEventListener('DOMContentLoaded', function () {
          _doRestore();
          _obs.disconnect();
        }, { once: true });
      }
    } catch (_) {}
  })();

  window.Theme = {
    toggle() {
      // Dark-only themes lock dark mode — silently keep dark
      if (UI_DARK_ONLY.indexOf(document.documentElement.getAttribute('data-ui')) !== -1) {
        applyTheme('dark');
        return false;
      }
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem(KEY, next);
      applyTheme(next);
      return true;
    },
    set(theme) {
      // Dark-only themes lock dark mode — refuse light
      if (UI_DARK_ONLY.indexOf(document.documentElement.getAttribute('data-ui')) !== -1 && theme !== 'dark') {
        return false;
      }
      if (theme !== 'light' && theme !== 'dark') return false;
      localStorage.setItem(KEY, theme);
      applyTheme(theme);
      return true;
    },
    current() {
      return document.documentElement.getAttribute('data-theme') || 'light';
    },
    isLocked() {
      return UI_DARK_ONLY.indexOf(document.documentElement.getAttribute('data-ui')) !== -1;
    }
  };

  window.UITheme = {
    ALLOWED: UI_ALLOWED.slice(),
    GENZ_ONLY: UI_GENZONLY.slice(),
    DEFAULT: UI_DEFAULT,
    isGenz: _isGenzUser,
    isGenzOnly(ui) { return UI_GENZONLY.indexOf(ui) !== -1; },
    set(ui) {
      if (!UI_ALLOWED.includes(ui)) return false;
      if (UI_GENZONLY.indexOf(ui) !== -1 && !_isGenzUser()) return false;
      localStorage.setItem(UI_KEY, ui);
      applyUI(ui);
      // Dark-only themes → force dark
      if (UI_DARK_ONLY.indexOf(ui) !== -1 && document.documentElement.getAttribute('data-theme') !== 'dark') {
        localStorage.setItem(KEY, 'dark');
        applyTheme('dark');
      }
      // Notify any live listeners (e.g. theme picker button, sidebar rebuild)
      try { window.dispatchEvent(new CustomEvent('ui-theme-changed', { detail: { ui } })); } catch (_) {}
      return true;
    },
    current() {
      return document.documentElement.getAttribute('data-ui') || UI_DEFAULT;
    }
  };
})();
