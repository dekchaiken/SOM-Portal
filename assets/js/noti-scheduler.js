/* ══════════════════════════════════════════════════
   noti-scheduler.js  |  Scheduled Notification Popup
   ══════════════════════════════════════════════════
   - Fetches enabled schedules from API every 5 min
   - Checks every 30s if current time matches a schedule
   - Shows a styled modal popup (one at a time)
   - Uses sessionStorage to avoid showing same noti twice/day
   ══════════════════════════════════════════════════ */

const NotiScheduler = (() => {
  const POLL_MS  = 5 * 60 * 1000;  // re-fetch config every 5 min
  const CHECK_MS = 30 * 1000;       // check time match every 30s
  const DAYS_MAP = ['sun','mon','tue','wed','thu','fri','sat'];

  let _schedules = [];
  let _overlay   = null;
  let _queue     = [];   // schedules waiting to show (if multiple fire at once)
  let _showing   = false;

  // ── Fetch schedules from server ────────────────────────────────
  async function _fetch() {
    try {
      const res = await API.scheduledNoti.list();
      if (res?.ok && Array.isArray(res.data?.data)) {
        _schedules = res.data.data;
      }
    } catch { /* silent — don't break the app */ }
  }

  // ── Check current time against all schedules ───────────────────
  function _check() {
    const now     = new Date();
    const hhmm    = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    const dayKey  = DAYS_MAP[now.getDay()];
    const dayOfMo = now.getDate();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    for (const sch of _schedules) {
      if (!sch.enabled) continue;
      if (sch.time !== hhmm) continue;

      if (sch.day_mode === 'monthly') {
        const dates = Array.isArray(sch.dates) ? sch.dates : [];
        if (!dates.includes(dayOfMo)) continue;
      } else {
        const days = Array.isArray(sch.days) ? sch.days : ['mon','tue','wed','thu','fri'];
        if (!days.includes('all') && !days.includes(dayKey)) continue;
      }

      const excludeDates = Array.isArray(sch.exclude_dates) ? sch.exclude_dates : [];
      if (excludeDates.includes(dayOfMo)) continue;

      const seenKey = `snoti_${dateStr}_${sch.id}`;
      if (sessionStorage.getItem(seenKey)) continue;

      sessionStorage.setItem(seenKey, '1');

      // shift_summary: only fires Google Chat — no popup
      if (sch.type === 'shift_summary') {
        if (sch.has_chat_webhook) {
          API.scheduledNoti.sendShiftSummary(sch.id).catch(() => {/* silent */});
        }
        continue;
      }

      // grafana_paused: Grafana paused-alerts digest — Google Chat only, no popup.
      // Content is fetched live server-side; dedup is one send per schedule per day.
      if (sch.type === 'grafana_paused') {
        if (sch.has_chat_webhook) {
          API.scheduledNoti.sendGrafanaPaused(sch.id).catch(() => {/* silent */});
        }
        continue;
      }

      _queue.push(sch);

      // Fire-and-forget Google Chat send (deduplicated server-side)
      if (sch.has_chat_webhook) {
        API.scheduledNoti.sendChat(sch.id).catch(() => {/* silent */});
      }
    }

    if (_queue.length && !_showing) _dequeue();
  }

  function _dequeue() {
    if (!_queue.length) { _showing = false; return; }
    _showing = true;
    _showModal(_queue.shift());
  }

  // ── Build overlay (once) ───────────────────────────────────────
  function _ensureOverlay() {
    if (_overlay) return;

    _injectCSS();

    _overlay = document.createElement('div');
    _overlay.id = 'snoti-overlay';
    _overlay.innerHTML = `
      <div class="snoti-card" id="snoti-card">
        <div class="snoti-bell" id="snoti-bell"><i data-icon="bell"></i></div>
        <div class="snoti-label">แจ้งเตือนจากระบบ</div>
        <div class="snoti-msg" id="snoti-msg"></div>
        <div class="snoti-btns">
          <button class="snoti-btn-go"  id="snoti-btn-go"  style="display:none"></button>
          <button class="snoti-btn-ok"  id="snoti-btn-ok">รับทราบ</button>
        </div>
        <div class="snoti-foot" id="snoti-foot"></div>
      </div>`;
    document.body.appendChild(_overlay);

    document.getElementById('snoti-btn-ok').addEventListener('click', _closeModal);
  }

  function _showModal(sch) {
    _ensureOverlay();

    document.getElementById('snoti-msg').textContent  = sch.message;
    document.getElementById('snoti-foot').textContent = `⏰ ${sch.time} น.`;

    const btnGo = document.getElementById('snoti-btn-go');
    if (sch.action_label && sch.action_url) {
      btnGo.textContent = sch.action_label;
      btnGo.style.display = '';
      btnGo.onclick = () => {
        _closeModal();
        const raw = sch.action_url.trim();
        const isAbsolute = /^https?:\/\//i.test(raw);

        if (isAbsolute) {
          // Same origin → navigate in same tab; different origin → new tab
          try {
            const sameOrigin = new URL(raw).origin === window.location.origin;
            if (sameOrigin) { window.location.href = raw; }
            else            { window.open(raw, '_blank', 'noopener noreferrer'); }
          } catch { window.location.href = raw; }
        } else {
          // Relative path — resolve from site root
          const inAdmin = /\/admin\//.test(window.location.pathname);
          const prefix  = inAdmin ? '../' : './';
          window.location.href = prefix + raw.replace(/^\.?\//, '');
        }
      };
    } else {
      btnGo.style.display = 'none';
    }

    _overlay.classList.add('open');

    // Bell ring animation
    const bell = document.getElementById('snoti-bell');
    bell.classList.remove('ring');
    void bell.offsetWidth;
    bell.classList.add('ring');
  }

  function _closeModal() {
    _overlay?.classList.remove('open');
    // Small delay then show next in queue
    setTimeout(_dequeue, 300);
  }

  // ── CSS ────────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('snoti-styles')) return;
    const s = document.createElement('style');
    s.id = 'snoti-styles';
    s.textContent = `
      #snoti-overlay {
        display:none;position:fixed;inset:0;z-index:9500;
        background:rgba(0,0,0,.48);backdrop-filter:blur(6px);
        align-items:center;justify-content:center;padding:16px;
      }
      #snoti-overlay.open { display:flex; }

      .snoti-card {
        background:var(--bg-card,#fff);border-radius:22px;
        box-shadow:0 24px 64px rgba(0,0,0,.22);
        border:1px solid var(--border,#e2e8f0);
        padding:40px 32px 28px;max-width:440px;width:100%;
        text-align:center;position:relative;
        animation:snoti-in .28s cubic-bezier(.22,1,.36,1);
      }
      @keyframes snoti-in {
        from { opacity:0;transform:scale(.9) translateY(16px); }
        to   { opacity:1;transform:scale(1) translateY(0); }
      }

      .snoti-bell {
        font-size:44px;margin-bottom:12px;display:inline-block;
        line-height:1;
      }
      .snoti-bell.ring { animation:snoti-ring .65s ease; }
      @keyframes snoti-ring {
        0%,100% { transform:rotate(0); }
        15%  { transform:rotate(22deg); }
        30%  { transform:rotate(-18deg); }
        45%  { transform:rotate(14deg); }
        60%  { transform:rotate(-8deg); }
        75%  { transform:rotate(5deg); }
      }

      .snoti-label {
        font-size:10px;font-weight:800;letter-spacing:.1em;
        text-transform:uppercase;color:var(--orange,#f26419);
        margin-bottom:14px;
      }

      .snoti-msg {
        font-size:14px;line-height:1.7;
        color:var(--text,#1e293b);margin-bottom:26px;
        white-space:pre-wrap;word-break:break-word;
      }

      .snoti-btns {
        display:flex;flex-direction:column;gap:8px;
      }

      .snoti-btn-go {
        padding:11px 20px;border-radius:11px;border:none;cursor:pointer;
        background:var(--orange,#f26419);color:#fff;
        font-size:13px;font-weight:700;
        transition:filter .15s;
      }
      .snoti-btn-go:hover { filter:brightness(1.1); }

      .snoti-btn-ok {
        padding:10px 20px;border-radius:11px;cursor:pointer;
        background:transparent;border:1px solid var(--border,#e2e8f0);
        color:var(--text-muted,#64748b);font-size:13px;
        transition:background .15s;
      }
      .snoti-btn-ok:hover { background:var(--bg,#f8fafc); }

      .snoti-foot {
        margin-top:18px;font-size:10px;
        color:var(--text-muted,#94a3b8);
      }
    `;
    document.head.appendChild(s);
  }

  // ── Public: init (called from layout.js) ──────────────────────
  async function init() {
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    if (typeof API  === 'undefined') return;

    await _fetch();
    _check();

    setInterval(_fetch, POLL_MS);
    setInterval(_check, CHECK_MS);
  }

  return { init, ensureOverlay: _ensureOverlay };
})();

/* ══════════════════════════════════════════════════
   PWAlert  |  Planned Work countdown modal + sound
   ══════════════════════════════════════════════════
   - Polls active PW items every 2 min
   - Checks every 30s if any item start is within lead_minutes
   - Shows full-screen modal with looping beep until Ack'd
   ══════════════════════════════════════════════════ */

const PWAlert = (() => {
  const CHECK_MS = 30 * 1000;
  const POLL_MS  =  2 * 60 * 1000;
  const SOUND_MS =  5 * 1000;

  let _cfg      = { lead_minutes: [10, 5], sound_enabled: true };
  let _items    = [];
  let _overlay  = null;
  let _queue    = [];
  let _showing  = false;
  let _soundTmr = null;
  let _actx     = null;

  // Create / resume AudioContext on any user gesture so it's ready when needed
  function _ensureAudio() {
    try {
      if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
      if (_actx.state === 'suspended') _actx.resume().catch(() => {});
    } catch { /* silent */ }
  }
  ['click', 'keydown', 'pointerdown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, _ensureAudio, { passive: true })
  );

  // ── Data fetch ──────────────────────────────────────────────────
  async function _fetchConfig() {
    try {
      const res = await API.pwSchedule.getConfig();
      if (res?.ok) {
        const d = res.data?.data ?? res.data ?? {};
        if (Array.isArray(d.lead_minutes)) _cfg.lead_minutes = d.lead_minutes;
        if (typeof d.sound_enabled === 'boolean') _cfg.sound_enabled = d.sound_enabled;
      }
    } catch { /* silent */ }
  }

  async function _fetchItems() {
    try {
      const res = await API.pwSchedule.active();
      if (res?.ok) _items = res.data?.data?.items ?? [];
    } catch { /* silent */ }
  }

  async function _fetchAll() {
    await _fetchConfig();
    await _fetchItems();
  }

  // ── Time check ──────────────────────────────────────────────────
  function _check() {
    const now   = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    for (const item of _items) {
      if (item.completed) continue;
      const startTs = new Date(item.start).getTime();
      if (isNaN(startTs) || startTs <= now) continue;
      const diffMin = (startTs - now) / 60000;

      for (const lead of _cfg.lead_minutes) {
        if (diffMin <= lead) {
          const key = `pwa_${today}_${item.id}_${lead}`;
          if (sessionStorage.getItem(key)) continue;
          sessionStorage.setItem(key, '1');
          _queue.push({ item, lead });
        }
      }
    }

    if (_queue.length && !_showing) _dequeue();
  }

  function _dequeue() {
    if (!_queue.length) { _showing = false; return; }
    _showing = true;
    _showModal(_queue.shift());
  }

  // ── Sound ───────────────────────────────────────────────────────
  function _beep() {
    if (!_cfg.sound_enabled) return;
    if (!_actx || _actx.state !== 'running') return;
    try {
      const ctx = _actx;
      [880, 1046, 1318].forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + i * 0.13;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.35, t0 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
        osc.start(t0); osc.stop(t0 + 0.27);
      });
    } catch { /* silent */ }
  }

  function _startBeeping() {
    _stopBeeping();
    _beep();
    _soundTmr = setInterval(_beep, SOUND_MS);

    // If AudioContext isn't unlocked yet, arm a one-shot gesture listener
    // so the user hears a beep the moment they interact with the modal
    if (!_actx || _actx.state !== 'running') {
      const _gestureUnlock = () => {
        _ensureAudio();
        // Small delay so resume() has time to complete
        setTimeout(() => { if (_soundTmr) _beep(); }, 80);
      };
      document.addEventListener('pointerdown', _gestureUnlock, { once: true, passive: true });
    }
  }
  function _stopBeeping()  { if (_soundTmr) { clearInterval(_soundTmr); _soundTmr = null; } }

  // ── Modal ───────────────────────────────────────────────────────
  function _ensureOverlay() {
    if (_overlay) return;
    _injectCSS();
    _overlay = document.createElement('div');
    _overlay.id = 'pwa-overlay';
    _overlay.innerHTML = `
      <div class="pwa-card">
        <div class="pwa-icon"><i data-icon="alert-triangle"></i></div>
        <div class="pwa-badge">Planned Work Alert</div>
        <div class="pwa-lead" id="pwa-lead"></div>
        <div class="pwa-name" id="pwa-name"></div>
        <div class="pwa-time" id="pwa-time"></div>
        <div class="pwa-btns">
          <button class="pwa-btn-go" id="pwa-btn-go">ไปหน้า PW Schedule →</button>
          <button class="pwa-btn-ok" id="pwa-btn-ok">รับทราบ</button>
        </div>
      </div>`;
    document.body.appendChild(_overlay);

    document.getElementById('pwa-btn-ok').addEventListener('click', _close);
    document.getElementById('pwa-btn-go').addEventListener('click', () => {
      _close();
      const inAdmin = /\/admin\//.test(window.location.pathname);
      window.location.href = (inAdmin ? '../' : './') + 'pw-schedule.html';
    });
  }

  function _showModal({ item, lead }) {
    _ensureOverlay();

    document.getElementById('pwa-lead').textContent = `อีก ${lead} นาที`;
    document.getElementById('pwa-name').textContent = item.pw_name || '(ไม่มีชื่อ)';

    const fmt = { hour: '2-digit', minute: '2-digit', hour12: false };
    const s = item.start ? new Date(item.start).toLocaleTimeString('th-TH', fmt) : '';
    const e = item.end   ? new Date(item.end).toLocaleTimeString('th-TH', fmt) : '';
    document.getElementById('pwa-time').textContent = s && e ? `${s} – ${e} น.` : s || '';

    _overlay.classList.add('open');
    _startBeeping();
  }

  function _close() {
    _stopBeeping();
    _overlay?.classList.remove('open');
    setTimeout(_dequeue, 300);
  }

  // ── CSS ─────────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('pwa-styles')) return;
    const s = document.createElement('style');
    s.id = 'pwa-styles';
    s.textContent = `
      #pwa-overlay {
        display:none;position:fixed;inset:0;z-index:9600;
        background:rgba(0,0,0,.58);backdrop-filter:blur(8px);
        align-items:center;justify-content:center;padding:16px;
      }
      #pwa-overlay.open { display:flex; }
      .pwa-card {
        background:var(--bg-card,#fff);border-radius:22px;
        box-shadow:0 28px 72px rgba(0,0,0,.3);
        border:2px solid #f26419;
        padding:40px 32px 28px;max-width:440px;width:100%;
        text-align:center;
        animation:pwa-in .28s cubic-bezier(.22,1,.36,1);
      }
      @keyframes pwa-in {
        from { opacity:0;transform:scale(.88) translateY(20px); }
        to   { opacity:1;transform:scale(1) translateY(0); }
      }
      .pwa-icon {
        font-size:52px;margin-bottom:10px;display:inline-block;
        animation:pwa-pulse .9s ease-in-out infinite alternate;
      }
      @keyframes pwa-pulse {
        from { transform:scale(1); }
        to   { transform:scale(1.18); }
      }
      .pwa-badge {
        display:inline-block;padding:3px 12px;border-radius:99px;
        background:#fef3c7;color:#92400e;
        font-size:10px;font-weight:800;letter-spacing:.08em;
        text-transform:uppercase;margin-bottom:16px;
      }
      .pwa-lead {
        font-size:34px;font-weight:900;color:#f26419;
        line-height:1;margin-bottom:8px;
      }
      .pwa-name {
        font-size:18px;font-weight:700;color:var(--text,#1e293b);
        margin-bottom:6px;word-break:break-word;line-height:1.4;
      }
      .pwa-time {
        font-size:13px;color:var(--text-muted,#64748b);margin-bottom:28px;
      }
      .pwa-btns { display:flex;flex-direction:column;gap:10px; }
      .pwa-btn-go {
        padding:12px 20px;border-radius:11px;border:none;cursor:pointer;
        background:#f26419;color:#fff;font-size:14px;font-weight:700;
        transition:filter .15s;
      }
      .pwa-btn-go:hover { filter:brightness(1.1); }
      .pwa-btn-ok {
        padding:10px 20px;border-radius:11px;cursor:pointer;
        background:transparent;border:1px solid var(--border,#e2e8f0);
        color:var(--text-muted,#64748b);font-size:13px;
        transition:background .15s;
      }
      .pwa-btn-ok:hover { background:var(--bg,#f8fafc); }

      #pwa-sound-bar {
        position:fixed;bottom:0;left:0;right:0;z-index:9550;
        background:#1e293b;color:#fff;
        display:flex;align-items:center;justify-content:center;gap:14px;
        padding:11px 20px;font-size:13px;cursor:pointer;
        animation:pwa-bar-in .3s ease;
      }
      @keyframes pwa-bar-in {
        from { transform:translateY(100%); }
        to   { transform:translateY(0); }
      }
      #pwa-sound-bar span { opacity:.85; }
      #pwa-sound-bar button {
        padding:5px 14px;border-radius:8px;border:none;cursor:pointer;
        background:#f26419;color:#fff;font-size:12px;font-weight:700;
        white-space:nowrap;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Sound permission banner ──────────────────────────────────────
  function _showSoundBar() {
    if (!_cfg.sound_enabled) return;
    if (localStorage.getItem('pwa_snd_ok')) { _ensureAudio(); return; }
    if (document.getElementById('pwa-sound-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'pwa-sound-bar';
    bar.innerHTML = `<span><i data-icon="bell"></i> คลิกเพื่อเปิดใช้งานเสียงแจ้งเตือน Planned Work</span><button>เปิดเสียง</button>`;
    document.body.appendChild(bar);

    bar.addEventListener('click', () => {
      _ensureAudio();
      localStorage.setItem('pwa_snd_ok', '1');
      bar.style.animation = 'none';
      bar.style.transition = 'transform .25s ease';
      bar.style.transform = 'translateY(100%)';
      setTimeout(() => bar.remove(), 260);
    }, { once: true });
  }

  // ── Public ──────────────────────────────────────────────────────
  async function init() {
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    if (typeof API  === 'undefined') return;

    await _fetchAll();
    _check();
    _showSoundBar();

    setInterval(_fetchAll, POLL_MS);
    setInterval(_check, CHECK_MS);
  }

  return { init };
})();

/* ══════════════════════════════════════════════════
   SyncupScheduler  |  Daily Sync-up popup + notify
   ══════════════════════════════════════════════════
   - Fetches syncup config every 5 min
   - Checks every 30s if 8:45 or 20:45 matches
   - Calls /api/syncup/notify.php (dedup server-side)
   - Shows popup with link to syncup.html
   ══════════════════════════════════════════════════ */

const SyncupScheduler = (() => {
  const POLL_MS  = 5 * 60 * 1000;
  const CHECK_MS = 30 * 1000;
  const DAYS_MAP = ['sun','mon','tue','wed','thu','fri','sat'];

  let _cfg     = null;   // { morning: {...}, evening: {...} }
  let _overlay = null;
  let _stopped = false;  // stop polling after 401 (session expired)

  // ── Fetch config ───────────────────────────────────────────────
  async function _fetch() {
    if (_stopped) return;
    try {
      const res = await API.syncup.getConfig();
      if (res === null) { _stopped = true; return; } // 401 → session expired, stop
      if (res?.ok && res.data?.data) _cfg = res.data.data;
    } catch { /* silent */ }
  }

  // ── Check time ─────────────────────────────────────────────────
  async function _check() {
    if (!_cfg) return;
    const now    = new Date();
    const hhmm   = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    const dayKey = DAYS_MAP[now.getDay()];
    const today  = now.toISOString().slice(0, 10);

    for (const shift of ['morning','evening']) {
      const s = _cfg[shift];
      if (!s?.enabled) continue;
      if (s.time !== hhmm) continue;

      const days = Array.isArray(s.days) ? s.days : ['mon','tue','wed','thu','fri'];
      if (!days.includes('all') && !days.includes(dayKey)) continue;

      const seenKey = `syncup_noti_${today}_${shift}`;
      if (sessionStorage.getItem(seenKey)) continue;
      sessionStorage.setItem(seenKey, '1');

      // Call server: sends Google Chat announcement + dedup
      try {
        const res = await API.syncup.notify(shift);
        if (res?.ok && res.data?.data?.popup) {
          _showPopup(shift, res.data.data.message, today);
        }
      } catch { /* silent */ }
    }
  }

  // ── Popup UI ───────────────────────────────────────────────────
  function _ensureOverlay() {
    if (_overlay) return;
    _injectCSS();

    _overlay = document.createElement('div');
    _overlay.id = 'syncup-overlay';
    _overlay.innerHTML = `
      <div class="su-card" id="su-card">
        <div class="su-icon" id="su-icon"><i data-icon="camera"></i></div>
        <div class="su-badge" id="su-badge">Daily Sync-up</div>
        <div class="su-msg"  id="su-msg"></div>
        <div class="su-btns">
          <button class="su-btn-go" id="su-btn-go"><i data-icon="upload"></i> อัปโหลดรูป</button>
          <button class="su-btn-ok" id="su-btn-ok">ภายหลัง</button>
        </div>
      </div>`;
    document.body.appendChild(_overlay);

    document.getElementById('su-btn-ok').addEventListener('click', _close);
  }

  function _showPopup(shift, message, today) {
    _ensureOverlay();

    const icon  = shift === 'morning' ? '<i data-icon="sunrise"></i>' : '<i data-icon="moon"></i>';
    const label = shift === 'morning' ? 'Sync-up เช้า' : 'Sync-up เย็น';

    document.getElementById('su-icon').textContent  = icon;
    document.getElementById('su-badge').textContent = label;
    document.getElementById('su-msg').textContent   = message;

    const btnGo = document.getElementById('su-btn-go');
    const inAdmin = /\/admin\//.test(window.location.pathname);
    const prefix  = inAdmin ? '../' : './';
    btnGo.onclick = () => {
      _close();
      window.location.href = prefix + `syncup.html?shift=${shift}`;
    };

    _overlay.classList.add('open');

    // Bell icon bounce
    const iconEl = document.getElementById('su-icon');
    iconEl.classList.remove('bounce');
    void iconEl.offsetWidth;
    iconEl.classList.add('bounce');
  }

  function _close() {
    _overlay?.classList.remove('open');
  }

  // ── CSS ────────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('syncup-styles')) return;
    const s = document.createElement('style');
    s.id = 'syncup-styles';
    s.textContent = `
      #syncup-overlay {
        display:none;position:fixed;inset:0;z-index:9400;
        background:rgba(0,0,0,.48);backdrop-filter:blur(6px);
        align-items:center;justify-content:center;padding:16px;
      }
      #syncup-overlay.open { display:flex; }

      .su-card {
        background:var(--bg-card,#fff);border-radius:22px;
        box-shadow:0 24px 64px rgba(0,0,0,.22);
        border:1px solid var(--border,#e2e8f0);
        padding:40px 32px 28px;max-width:420px;width:100%;
        text-align:center;
        animation:su-in .28s cubic-bezier(.22,1,.36,1);
      }
      @keyframes su-in {
        from { opacity:0;transform:scale(.9) translateY(16px); }
        to   { opacity:1;transform:scale(1) translateY(0); }
      }

      .su-icon {
        font-size:48px;margin-bottom:10px;display:inline-block;line-height:1;
      }
      .su-icon.bounce { animation:su-bounce .55s ease; }
      @keyframes su-bounce {
        0%,100% { transform:translateY(0); }
        35%  { transform:translateY(-10px); }
        65%  { transform:translateY(-5px); }
      }

      .su-badge {
        display:inline-block;padding:3px 12px;border-radius:99px;
        background:rgba(242,100,25,.1);color:var(--orange,#f26419);
        font-size:10px;font-weight:800;letter-spacing:.08em;
        text-transform:uppercase;margin-bottom:14px;
      }

      .su-msg {
        font-size:13px;line-height:1.7;color:var(--text,#1e293b);
        margin-bottom:24px;white-space:pre-wrap;word-break:break-word;
      }

      .su-btns { display:flex;flex-direction:column;gap:8px; }

      .su-btn-go {
        padding:11px 20px;border-radius:11px;border:none;cursor:pointer;
        background:var(--orange,#f26419);color:#fff;
        font-size:13px;font-weight:700;transition:filter .15s;
      }
      .su-btn-go:hover { filter:brightness(1.1); }

      .su-btn-ok {
        padding:9px 20px;border-radius:11px;cursor:pointer;
        background:transparent;border:1px solid var(--border,#e2e8f0);
        color:var(--text-muted,#64748b);font-size:12px;
        transition:background .15s;
      }
      .su-btn-ok:hover { background:var(--bg,#f8fafc); }
    `;
    document.head.appendChild(s);
  }

  // ── Public ─────────────────────────────────────────────────────
  async function init() {
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    if (typeof API  === 'undefined') return;
    // super_viewer is read-only oversight — skip sync-up config polling
    // (endpoint requires ADMIN_ROLES → would 403).
    if (Auth.getUser?.()?.role === 'super_viewer') return;

    await _fetch();
    _check();

    setInterval(_fetch, POLL_MS);
    setInterval(_check, CHECK_MS);
  }

  return { init };
})();

/* ══════════════════════════════════════════════════
   RestartFetchScheduler  |  Daily restart raw fetch (per-runway parallel)
   ══════════════════════════════════════════════════
   Fires N parallel POSTs to /api/restart-monitor/fetch.php?runway=<name> at
   09:00 ICT — one HTTP request per runway from data/grafana-runways.json.
   Never uses the no-runway-param form.

   Why parallel-per-runway (vs. one sequential call):
   The old scheduler fired ONE initial POST with no runway param, and fetch.php
   iterated TMN → NANO → OCP inside a single PHP process. Whenever that process
   was killed mid-loop (PHP-FPM request_terminate_timeout / upstream 504 /
   process reaper), the loop died after TMN and NANO/OCP silently never ran.
   Worse, the browser tracked only runways that returned results, so it treated
   {EKS TMN: done} as "all done" and never retried the missing runways.
   Firing per-runway from the start puts each runway in its own PHP process,
   so a slow/dead one can't take out the others, and the scheduler learns the
   full runway roster from _runwayList (fetched once via API.restartMonitor
   .runways()) regardless of which requests actually respond.

   fetch.php still handles idempotency itself: per-runway file lock +
   already_done short-circuit when raw/<slug>/<date>.json exists.

   Robustness:
   - localStorage (persists across tabs/sessions)
   - catch-up: if today >= 09:00 and not fetched yet, fire on page load
   - polling check every 30s — retries any runway still pending
   ══════════════════════════════════════════════════ */

const RestartFetchScheduler = (() => {
  const CHECK_MS       = 30 * 1000;
  const FETCH_TIME     = '09:00';                 // earliest time we'll fire
  // v2 key: the old scheduler could mark the day done with only EKS TMN in
  // results (see comment block above). Bumping the key forces a re-arm on
  // rollout so today's fire proceeds even if the v1 flag was set at 09:00.
  const STORE_KEY      = 'rm_fetch_last_date_v2'; // whole-day done marker
  const PROGRESS_KEY   = 'rm_fetch_progress';     // per-runway progress per day
  const ROSTER_KEY     = 'rm_runway_roster';      // { date, runways: ['EKS TMN', ...] }
  let   _inFlight      = false;                   // guard: don't stack concurrent calls
  let   _runwayList    = null;                    // in-memory copy of the roster

  function _todayLocal() {
    const d = new Date();
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  function _alreadyFiredToday() {
    return localStorage.getItem(STORE_KEY) === _todayLocal();
  }

  function _markFired() {
    localStorage.setItem(STORE_KEY, _todayLocal());
  }

  // Runway roster: fetched once per day, cached in localStorage.
  // Same-day sessions reuse it without hitting the API. Also survives page
  // reloads mid-morning so we don't lose the roster if the API is briefly down.
  function _loadRoster() {
    if (Array.isArray(_runwayList) && _runwayList.length) return _runwayList;
    try {
      const raw = localStorage.getItem(ROSTER_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.date !== _todayLocal() || !Array.isArray(s.runways)) return null;
      _runwayList = s.runways;
      return _runwayList;
    } catch { return null; }
  }

  async function _ensureRoster() {
    const cached = _loadRoster();
    if (cached && cached.length) return cached;
    try {
      const res = await API.restartMonitor.runways();
      const list = (res?.data?.data?.runways || res?.data?.runways || [])
        .map(r => r?.name).filter(Boolean);
      if (!list.length) return null;
      _runwayList = list;
      localStorage.setItem(ROSTER_KEY, JSON.stringify({ date: _todayLocal(), runways: list }));
      return list;
    } catch (err) {
      console.warn('[RestartFetchScheduler] roster fetch failed:', err);
      return null;
    }
  }

  // Per-runway progress: { date: 'YYYY-MM-DD', runways: { 'EKS TMN': 'done'|'pending' } }
  // Auto-resets when the date rolls over.
  function _loadProgress() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return { date: _todayLocal(), runways: {} };
      const s = JSON.parse(raw);
      if (!s || s.date !== _todayLocal()) return { date: _todayLocal(), runways: {} };
      return { date: s.date, runways: s.runways || {} };
    } catch { return { date: _todayLocal(), runways: {} }; }
  }

  function _saveProgress(p) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* quota */ }
  }

  function _extractResults(res) {
    return res?.data?.data?.results || res?.data?.results || [];
  }

  // Merge server results into per-runway progress. Terminal statuses that need
  // no retry: done, already_done, skip (e.g. token env missing). Everything
  // else (error, locked, missing) becomes 'pending' so the next poll retries.
  function _applyResults(results) {
    const p = _loadProgress();
    for (const r of results || []) {
      if (!r || !r.runway) continue;
      if (r.status === 'done' || r.status === 'already_done' || r.status === 'skip') {
        p.runways[r.runway] = 'done';
      } else if (p.runways[r.runway] !== 'done') {
        p.runways[r.runway] = 'pending';
      }
    }
    _saveProgress(p);
    return p;
  }

  async function _fire() {
    if (_inFlight || _alreadyFiredToday()) return;
    _inFlight = true;

    try {
      const roster = await _ensureRoster();
      if (!roster || !roster.length) {
        console.warn('[RestartFetchScheduler] no roster available — will retry next poll');
        return;
      }

      // Prime progress with every runway in the roster as pending, so a
      // request that never comes back doesn't get lost — next tick still
      // knows it needs to retry that runway.
      const p0 = _loadProgress();
      for (const name of roster) {
        if (p0.runways[name] !== 'done') p0.runways[name] = 'pending';
      }
      _saveProgress(p0);

      const pending = roster.filter(n => p0.runways[n] !== 'done');
      if (pending.length === 0) { _markFired(); return; }

      console.info('[RestartFetchScheduler] firing parallel:', pending);
      const outcomes = await Promise.all(pending.map(name =>
        API.restartMonitor.fetch(name)
          .then(res => ({ res, name }))
          .catch(err => ({ err, name }))
      ));

      const results = [];
      for (const o of outcomes) {
        if (o.err || !o.res?.ok) {
          results.push({ runway: o.name, status: 'error', reason: 'request failed' });
          continue;
        }
        const rr = _extractResults(o.res);
        if (rr.length) results.push(...rr);
        else results.push({ runway: o.name, status: 'error', reason: 'no result returned' });
      }

      const p       = _applyResults(results);
      const allDone = roster.every(n => p.runways[n] === 'done');

      if (allDone) {
        _markFired();
        console.info('[RestartFetchScheduler] all runways done — marked fired for today', p.runways);
      } else {
        const stillPending = roster.filter(n => p.runways[n] !== 'done');
        console.warn(`[RestartFetchScheduler] pending — retry in ${CHECK_MS / 1000}s:`, stillPending, results);
      }
    } catch (err) {
      console.warn('[RestartFetchScheduler] failed — will retry next poll:', err);
    } finally {
      _inFlight = false;
    }
  }

  function _check() {
    if (_alreadyFiredToday()) return;
    const now  = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':'
               + String(now.getMinutes()).padStart(2, '0');
    // Fire any time on or after FETCH_TIME (catch-up if user opens page late)
    if (hhmm >= FETCH_TIME) _fire();
  }

  async function init() {
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    if (typeof API  === 'undefined') return;

    // Restart Monitor data is SM-shared — fetch.php now enforces requireSmForShared()
    // so non-SM browsers hitting the endpoint would 403. Skip silently to keep the
    // console clean. Global-read roles (super_admin/super_viewer) viewing-as another
    // team are treated as that team.
    const _u = Auth.getUser && Auth.getUser();
    // super_viewer is read-only — cannot fire the write side of restart fetch.
    if (_u && _u.role === 'super_viewer') {
      console.info('[RestartFetchScheduler] skipped · super_viewer is read-only');
      return;
    }
    const _isGlobalReader = _u && ['super_admin', 'super_viewer'].includes(_u.role);
    const _ctxTeam = _isGlobalReader
      ? ((API.getAdminTeam && API.getAdminTeam()) || 'sm')
      : (_u && _u.team);
    if (_ctxTeam && _ctxTeam !== 'sm') {
      console.info('[RestartFetchScheduler] skipped · non-SM team (' + _ctxTeam + ') — SM-owned fetch');
      return;
    }

    // Visible status log so we can verify in DevTools that the scheduler is alive
    const today = _todayLocal();
    const hhmm  = String(new Date().getHours()).padStart(2, '0') + ':'
                + String(new Date().getMinutes()).padStart(2, '0');
    const last  = localStorage.getItem(STORE_KEY) || '(never)';
    if (_alreadyFiredToday()) {
      console.info(`[RestartFetchScheduler] armed · today already fetched (${today}) — next fire 09:00 tomorrow`);
    } else if (hhmm >= FETCH_TIME) {
      console.info(`[RestartFetchScheduler] armed · now=${hhmm} ≥ ${FETCH_TIME} → firing now (last=${last})`);
    } else {
      console.info(`[RestartFetchScheduler] armed · now=${hhmm} < ${FETCH_TIME} — waiting (last=${last})`);
    }

    // Warm the roster cache in the background so the first _fire has it ready.
    _ensureRoster();

    // 1. Immediate check (catch-up): if today not fired yet AND time ≥ 09:00 → fire now
    _check();
    // 2. Poll every 30s — covers the case where user is on page through 09:00,
    //    and drives per-runway retry when NANO/OCP Thanos ingestion is lagging.
    setInterval(_check, CHECK_MS);
  }

  return { init };
})();

/* ══════════════════════════════════════════════════
   BatchMonitorWatcher  |  Jenkins state-transition alerts
   ══════════════════════════════════════════════════
   Polls /api/batch-monitor-noti/tick.php every 30s from any page a user
   has open. Server-side dedup (throttle + per-build log + state file)
   ensures that N concurrent tabs still produce at most one card per
   build state change.

   Silent by design: failures are logged to console only; the poll must
   never block the UI or spam the user.
   ══════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════
   AlertsWatcher  |  Custom threshold alerts (Google Chat)
   ══════════════════════════════════════════════════
   Polls /api/alerts/tick.php every 30s from every open browser tab.
   Server enforces a global file lock + 25s throttle so N concurrent
   tabs still trigger at most one evaluation cycle per window. Rules
   themselves are user-defined via the "🔔 My Alerts" drawer on the
   service-performance page (stored in data/<team>/alerts/rules.json).
   State transitions (ok→firing, firing→ok) POST a Google Chat cardV2
   to the webhook URL configured per channel in notify-config.json.

   Silent by design — failures logged to console, never blocks UI.
   ══════════════════════════════════════════════════ */
const AlertsWatcher = (() => {
  const CHECK_MS = 30 * 1000;
  let _timer = null;

  function _stop(reason) {
    if (_timer) { clearInterval(_timer); _timer = null; }
    console.warn('[AlertsWatcher] stopped —', reason);
  }

  async function _tick() {
    try {
      const res = await API.alerts.tick();
      if (res && res.ok === false && res.status === 401) return _stop('401 (session)');
      if (res && res.ok === false && res.status === 403) return _stop('403 (not permitted)');
      // Only log when work actually happened — throttled ticks are quiet.
      if (res?.ok && res.data?.data?.sent > 0) {
        console.info('[AlertsWatcher]', res.data.data);
      }
    } catch (_) { /* silent */ }
  }

  function init() {
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    if (typeof API  === 'undefined') return;
    if (Auth.isTokenExpired && Auth.isTokenExpired(Auth.getToken())) return;
    // Same guard as BatchMonitorWatcher — read-only viewers can't drive
    // side-effects (sending Chat notifications counts as write).
    if (Auth.getUser?.()?.role === 'super_viewer') {
      console.info('[AlertsWatcher] skipped · super_viewer is read-only');
      return;
    }
    if (_timer) { clearInterval(_timer); _timer = null; }
    _tick();
    _timer = setInterval(_tick, CHECK_MS);
    console.info('[AlertsWatcher] armed · 30s poll');
  }

  return { init };
})();

const BatchMonitorWatcher = (() => {
  const CHECK_MS = 30 * 1000;
  let _timer = null;

  function _stop(reason) {
    if (_timer) { clearInterval(_timer); _timer = null; }
    console.warn('[BatchMonitorWatcher] stopped —', reason);
  }

  async function _tick() {
    try {
      const res = await API.batchMonitorNoti.tick();
      // Auth broke → don't hammer the server. Next page-load's init() will re-arm.
      if (res && res.ok === false && res.status === 401) return _stop('401 (session)');
      if (res && res.ok === false && res.status === 403) return _stop('403 (not permitted)');
      if (res?.ok && res.data?.data?.sent > 0) {
        console.info('[BatchMonitorWatcher]', res.data.data);
      }
    } catch (_) { /* silent */ }
  }

  function init() {
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    if (typeof API  === 'undefined') return;
    if (Auth.isTokenExpired && Auth.isTokenExpired(Auth.getToken())) return;
    // super_viewer is read-only — tick.php sends real Google Chat notifications
    // when it detects state changes, which is a write side-effect. Skip silently.
    if (Auth.getUser?.()?.role === 'super_viewer') {
      console.info('[BatchMonitorWatcher] skipped · super_viewer is read-only');
      return;
    }
    if (_timer) { clearInterval(_timer); _timer = null; }
    _tick();                              // fire once on page load
    _timer = setInterval(_tick, CHECK_MS);
    console.info('[BatchMonitorWatcher] armed · 30s poll');
  }

  return { init };
})();
