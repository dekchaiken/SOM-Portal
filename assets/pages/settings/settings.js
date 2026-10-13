// settings — page script, extracted from settings.html.
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
Layout.render('settings');

(function() {
  const THEMES = {
    glass:      'Glass',
    enterprise: 'Enterprise',
    console:    'Console',
    warm:       'Warm',
    y2k:        'Y2K Holographic',
    kawaii:     'Bubblegum Kawaii',
    brutalist:  'Neo-Brutalist'
  };

  const allCards    = () => document.querySelectorAll('.theme-card[data-ui-key]');
  const banner      = document.getElementById('preview-banner');
  const appliedName = document.getElementById('applied-name');
  const genzHintLine = document.getElementById('genz-hint-line');
  const isGenz      = !!(window.UITheme?.isGenz?.());
  let bannerTimer = null;

  // Lock GenZ-only cards for non-GenZ users
  if (!isGenz) {
    document.querySelectorAll('.theme-card[data-genz-only="1"]').forEach(c => c.classList.add('locked'));
  } else {
    if (genzHintLine) genzHintLine.innerHTML = '✨ คุณเป็นสมาชิก <b>GenZ Team</b> — ปลดล็อกครบ 3 ธีม';
  }

  function refreshActive() {
    const cur = (window.UITheme?.current?.()) || 'glass';
    allCards().forEach(card => {
      card.classList.toggle('active', card.getAttribute('data-ui-key') === cur);
    });
  }

  function apply(key, card) {
    if (!window.UITheme) return;
    // Locked → nudge card (shake) instead of applying
    if (card && card.classList.contains('locked')) {
      card.animate(
        [{transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],
        {duration:280, easing:'ease-in-out'}
      );
      return;
    }
    if (!window.UITheme.set(key)) return;
    refreshActive();
    appliedName.textContent = THEMES[key] || key;
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 2400);
  }

  allCards().forEach(card => {
    const key = card.getAttribute('data-ui-key');
    card.addEventListener('click', (e) => {
      if (e.target.closest('.theme-select')) return;
      apply(key, card);
    });
    card.querySelector('.theme-select').addEventListener('click', (e) => {
      e.stopPropagation();
      apply(key, card);
    });
  });

  refreshActive();

  // ─── Color mode toggle wiring (respects Console lock) ───
  const modeLight = document.getElementById('btn-light');
  const modeDark  = document.getElementById('btn-dark');
  const modeHint  = document.getElementById('mode-lock-hint');
  function refreshModeUI() {
    const cur    = (window.Theme?.current?.()) || 'light';
    const locked = !!(window.Theme?.isLocked?.());
    modeLight.classList.toggle('active', cur === 'light');
    modeDark.classList.toggle('active',  cur === 'dark');
    modeLight.disabled = locked;                 // Light disabled when Console locks dark
    modeHint.classList.toggle('show', locked);   // Show lock hint
  }
  modeLight.addEventListener('click', () => {
    if (window.Theme?.isLocked?.()) return;       // Console locks — ignore
    if ((window.Theme?.current?.()) !== 'light') window.Theme.set('light');
    refreshModeUI();
  });
  modeDark.addEventListener('click', () => {
    if ((window.Theme?.current?.()) !== 'dark') window.Theme.set('dark');
    refreshModeUI();
  });
  refreshModeUI();

  // Also refresh mode UI whenever UI theme changes (Console picked → dark forced)
  window.addEventListener('ui-theme-changed', refreshModeUI);
})();

// ─── Nav Style picker ─────────────────────────────────────
(function() {
  const KEY = 'som_nav_style';
  const NAMES = {
    horizon: 'Horizon',
    capsule: 'Capsule',
    vision:  'Vision'
  };
  // Migrate legacy 'command' to 'horizon'
  (function() { try { if (localStorage.getItem(KEY) === 'command') localStorage.setItem(KEY, 'horizon'); } catch {} })();

  const nsCards    = () => document.querySelectorAll('.ns-card[data-nav-key]');
  const banner     = document.getElementById('preview-banner');
  const appliedEl  = document.getElementById('applied-name');
  let bannerTimer  = null;

  function getCurrent() {
    try { return localStorage.getItem(KEY) || 'horizon'; } catch { return 'horizon'; }
  }

  function refreshActive() {
    const cur = getCurrent();
    nsCards().forEach(c => c.classList.toggle('active', c.dataset.navKey === cur));
  }

  function apply(key) {
    try { localStorage.setItem(KEY, key); } catch {}
    refreshActive();

    // ── Apply immediately (no reload needed) ──
    const html = document.documentElement;
    if (key && key !== 'sidebar' && key !== '') {
      html.setAttribute('data-nav-style', key);
      // Remove old topnav and rebuild
      document.getElementById('topnav-wrap')?.remove();
      if (typeof Layout !== 'undefined' && Layout._buildTopNav) {
        try {
          const tn = Layout._buildTopNav(key);
          const appShell = document.querySelector('.app-shell') || document.body;
          const mainContent = appShell.querySelector('.main-content');
          if (mainContent) appShell.insertBefore(tn, mainContent);
          else appShell.prepend(tn);
          Layout._initTopNavDropdowns?.();
        } catch(e) { console.warn('[NavStyle] rebuild failed:', e); }
      }
    } else {
      html.removeAttribute('data-nav-style');
      document.getElementById('topnav-wrap')?.remove();
    }

    if (appliedEl) appliedEl.textContent = NAMES[key] || key;
    if (banner) {
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('show'), 2400);
    }
  }

  nsCards().forEach(card => {
    const key = card.dataset.navKey;
    card.addEventListener('click', e => {
      if (e.target.closest('.ns-select')) return;
      apply(key);
    });
    const btn = card.querySelector('.ns-select');
    if (btn) btn.addEventListener('click', e => { e.stopPropagation(); apply(key); });
  });

  refreshActive();
})();

// ─── Inbox Notification prefs ─────────────────────────────
(function() {
  const KEY_DESKTOP = 'som_inbox_notify_desktop';
  const KEY_SOUND   = 'som_inbox_notify_sound';

  const desktopGroup = document.getElementById('noti-desktop-toggle');
  const soundGroup   = document.getElementById('noti-sound-toggle');
  const permHint     = document.getElementById('noti-perm-hint');
  const testBtn      = document.getElementById('btn-noti-test');
  const testHint     = document.getElementById('noti-test-hint');

  const getPref = k => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
  const setPref = (k, on) => { try { localStorage.setItem(k, on ? '1' : '0'); } catch {} };

  function paint(group, on) {
    group.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', (b.dataset.val === 'on') === on);
    });
  }

  function refreshPermHint() {
    if (typeof Notification === 'undefined') {
      permHint.innerHTML = '<span style="color:#ef4444">⚠ Browser นี้ไม่รองรับ Web Notifications</span>';
      return;
    }
    const p = Notification.permission;
    if (p === 'granted') {
      permHint.innerHTML = '<span style="color:#10b981">✓ ได้รับอนุญาตจาก browser แล้ว</span>';
    } else if (p === 'denied') {
      permHint.innerHTML = '<span style="color:#ef4444">⚠ ถูก block ที่ระดับ browser — เปิดใหม่ใน Site settings ของ browser (macOS: System Settings → Notifications → เช็คว่า browser ไม่ถูกปิด/Focus mode)</span>';
    } else {
      permHint.innerHTML = '<span style="color:var(--text-muted)">ยังไม่ขออนุญาต — กดปุ่ม <b>On</b> เพื่อขอ permission จาก browser</span>';
    }
  }

  // Initial paint
  paint(desktopGroup, getPref(KEY_DESKTOP));
  paint(soundGroup,   getPref(KEY_SOUND));
  refreshPermHint();

  // Desktop toggle — requests permission on first "On"
  desktopGroup.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const wantOn = btn.dataset.val === 'on';
      if (wantOn && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try {
          const p = await Notification.requestPermission();
          if (p !== 'granted') {
            paint(desktopGroup, false);
            setPref(KEY_DESKTOP, false);
            refreshPermHint();
            return;
          }
        } catch {}
      }
      setPref(KEY_DESKTOP, wantOn);
      paint(desktopGroup, wantOn);
      refreshPermHint();
    });
  });

  // Sound toggle — plain pref
  soundGroup.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const wantOn = btn.dataset.val === 'on';
      setPref(KEY_SOUND, wantOn);
      paint(soundGroup, wantOn);
      if (wantOn && (typeof Layout !== 'undefined' && Layout._playChime)) Layout._playChime();  // preview when turning on
    });
  });

  function fireTestNotification() {
    try {
      const n = new Notification('ทดสอบแจ้งเตือน SOM Portal', {
        body: 'ถ้าคุณเห็นข้อความนี้ = macOS ปล่อยผ่านแล้ว ✓',
        tag:  'som-inbox-test',
        icon: './assets/img/logo.png',
        silent: true
      });
      setTimeout(() => n.close(), 5000);
      testHint.textContent = 'ส่งแล้ว — ถ้าไม่เห็น: macOS System Settings → Notifications → browser ต้องเปิด + ปิด Focus/DND';
    } catch (e) {
      testHint.textContent = 'ล้มเหลว: ' + (e.message || e);
    }
  }

  // Test button — plays sound + tries to fire notification.
  // If permission is 'default', request it inline so user doesn't have to toggle On first.
  testBtn.addEventListener('click', async () => {
    testHint.textContent = '';
    if ((typeof Layout !== 'undefined' && Layout._playChime)) Layout._playChime();
    if (typeof Notification === 'undefined') {
      testHint.textContent = 'Browser นี้ไม่รองรับ Web Notifications (เสียงยังใช้ได้ปกติ)';
      return;
    }
    if (Notification.permission === 'denied') {
      testHint.textContent = 'Browser block noti อยู่ — เปิดใหม่ที่ URL bar (คลิกไอคอน 🔒 ทางซ้ายของ URL → Notifications → Allow)';
      refreshPermHint();
      return;
    }
    if (Notification.permission === 'default') {
      testHint.textContent = 'กำลังขออนุญาตจาก browser...';
      try {
        const p = await Notification.requestPermission();
        refreshPermHint();
        if (p !== 'granted') {
          testHint.textContent = 'ไม่ได้รับอนุญาต — ลองใหม่ได้จาก URL bar';
          return;
        }
      } catch (e) {
        testHint.textContent = 'ขอ permission ล้มเหลว: ' + (e.message || e);
        return;
      }
    }
    fireTestNotification();
  });
})();

})();
