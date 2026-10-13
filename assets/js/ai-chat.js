/* ════════════════════════════════════════
   ai-chat.js  |  ตุ้มเม้ง — AI Chat Bubble
   ════════════════════════════════════════ */

const TummengAI = (() => {
  let _open    = false;
  let _loading = false;

  // ── Build DOM ─────────────────────────────────────────────
  // New layout: topbar icon + slide-in drawer from right (Option B).
  // Button lives inside .topbar-actions (like the notification bell).
  // Panel + backdrop are body-appended fixed elements.
  function _build() {
    if (document.getElementById('tm-btn')) return;

    _css();

    // 1. Trigger button — injected into .topbar-actions
    const btn = document.createElement('button');
    btn.id = 'tm-btn';
    btn.className = 'tb-icon-btn tm-topbar-btn';
    btn.title = 'ถามตุ้มเม้ง';
    btn.setAttribute('aria-label', 'Open AI chat');
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"
           width="16" height="16">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M9 9h.01M15 9h.01M9 13h6"/>
      </svg>
      <span class="tm-online-dot"></span>
      <span id="tm-badge" class="tm-badge" style="display:none"></span>
    `;

    const actions = document.querySelector('.topbar-actions');
    if (actions) {
      // Insert before the "+ New" button etc so it sits with the bell/search icons
      const notifWrap = document.getElementById('_tb-notif-wrap');
      if (notifWrap && notifWrap.nextSibling) {
        actions.insertBefore(btn, notifWrap.nextSibling);
      } else {
        actions.insertBefore(btn, actions.firstChild);
      }
    } else {
      // Fallback for pages without .topbar-actions — attach to body as small pill
      btn.classList.add('tm-btn-fallback');
      document.body.appendChild(btn);
    }

    // 2. Backdrop (body-appended)
    const backdrop = document.createElement('div');
    backdrop.id = 'tm-backdrop';
    document.body.appendChild(backdrop);

    // 3. Drawer (body-appended)
    const drawer = document.createElement('div');
    drawer.id = 'tm-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'ตุ้มเม้ง AI');
    drawer.innerHTML = `
      <!-- Header -->
      <div id="tm-hdr">
        <div class="tm-hdr-left">
          <div class="tm-avatar">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M9 9h.01M15 9h.01M9 13h6"/>
            </svg>
          </div>
          <div>
            <div class="tm-hdr-name">ตุ้มเม้ง</div>
            <div class="tm-hdr-sub">
              <span class="tm-dot-online"></span>Service Monitoring AI
            </div>
          </div>
        </div>
        <button id="tm-close" aria-label="Close chat">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Messages -->
      <div id="tm-msgs">
        <div class="tm-row tm-row-ai">
          <div class="tm-bubble tm-bubble-ai">
            สวัสดีครับ! ผมตุ้มเม้ง ทีม Service Monitoring <i data-icon="hand"></i><br>
            ถามได้เลยนะครับ หรือเลือกหัวข้อด้านล่างได้เลย
          </div>
        </div>
        <div id="tm-chips">
          <button class="tm-chip" data-q="โพส open มีกี่อันครับ?"><i data-icon="clipboard"></i> โพส Open</button>
          <button class="tm-chip" data-q="มี admin กี่คนครับ?"><i data-icon="user"></i> Admin ในระบบ</button>
          <button class="tm-chip" data-q="Jenkins server มีอะไรบ้างครับ?"><i data-icon="settings"></i> Jenkins Servers</button>
          <button class="tm-chip" data-q="Jira template มีอะไรบ้างครับ?"><i data-icon="ticket"></i> Jira Templates</button>
          <button class="tm-chip" data-q="ตอนนี้มีประกาศอะไรบ้างครับ?"><i data-icon="megaphone"></i> ประกาศล่าสุด</button>
          <button class="tm-chip" data-q="ใครโพสเยอะสุดในระบบครับ?"><i data-icon="trophy"></i> Top Poster</button>
        </div>
      </div>

      <!-- Thinking -->
      <div id="tm-think" style="display:none">
        <div class="tm-think-dots">
          <span></span><span></span><span></span>
        </div>
        <span class="tm-think-lbl">ตุ้มเม้งกำลังคิด...</span>
      </div>

      <!-- Footer / Input -->
      <div id="tm-foot">
        <div id="tm-input-wrap">
          <textarea id="tm-inp" rows="1" maxlength="2000"
            placeholder="ถามตุ้มเม้ง... (Enter ส่ง)"></textarea>
          <button id="tm-send" aria-label="Send message">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div class="tm-disclaimer">ข้อมูลจากระบบ SOM เท่านั้น · ไม่เชื่อมอินเทอร์เน็ต</div>
      </div>
    `;
    document.body.appendChild(drawer);

    _bind();
  }

  // ── Events ────────────────────────────────────────────────
  function _bind() {
    document.getElementById('tm-btn').addEventListener('click', toggle);
    document.getElementById('tm-close').addEventListener('click', close);
    document.getElementById('tm-send').addEventListener('click', _send);
    document.getElementById('tm-backdrop').addEventListener('click', close);

    // Quick chips
    document.getElementById('tm-chips')?.addEventListener('click', e => {
      const chip = e.target.closest('.tm-chip');
      if (!chip) return;
      document.getElementById('tm-inp').value = chip.dataset.q;
      document.getElementById('tm-chips').style.display = 'none';
      _send();
    });

    const inp = document.getElementById('tm-inp');
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
    });
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 110) + 'px';
    });

    // Escape closes drawer
    document.addEventListener('keydown', e => {
      if (_open && e.key === 'Escape') close();
    });
  }

  // ── Send ──────────────────────────────────────────────────
  async function _send() {
    if (_loading) return;
    const inp  = document.getElementById('tm-inp');
    const text = inp.value.trim();
    if (!text) return;

    inp.value = '';
    inp.style.height = 'auto';

    _appendMsg('user', text);
    _setLoading(true);

    try {
      const res = await API.ai.chat(text);
      _setLoading(false);

      const answer = res?.data?.data?.answer;
      if (res?.ok && answer) {
        _appendMsg('ai', answer);
      } else {
        _appendMsg('ai', res?.data?.message || res?.data?.data?.message || 'เกิดข้อผิดพลาดครับ กรุณาลองใหม่');
      }
    } catch (_) {
      _setLoading(false);
      _appendMsg('ai', 'เชื่อมต่อ AI ไม่ได้ครับ กรุณาตรวจสอบว่า Ollama รันอยู่');
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  function _appendMsg(role, text) {
    const box = document.getElementById('tm-msgs');
    const row = document.createElement('div');
    row.className = `tm-row tm-row-${role}`;

    const bub = document.createElement('div');
    bub.className = `tm-bubble tm-bubble-${role}`;
    bub.innerHTML  = _fmt(text);

    row.appendChild(bub);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;

    if (!_open) _showBadge();
  }

  function _fmt(text) {
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/\n/g,'<br>');
  }

  function _setLoading(on) {
    _loading = on;
    document.getElementById('tm-think').style.display = on ? 'flex' : 'none';
    document.getElementById('tm-send').disabled = on;
    if (!on) {
      const b = document.getElementById('tm-msgs');
      b.scrollTop = b.scrollHeight;
    }
  }

  function _showBadge() {
    const b = document.getElementById('tm-badge');
    if (b) b.style.display = 'flex';
  }

  // ── Public ────────────────────────────────────────────────
  function open() {
    _open = true;
    document.body.classList.add('tm-drawer-open');
    document.getElementById('tm-drawer')?.classList.add('open');
    document.getElementById('tm-backdrop')?.classList.add('open');
    document.getElementById('tm-btn')?.classList.add('active');
    const badge = document.getElementById('tm-badge');
    if (badge) badge.style.display = 'none';
    const msgs = document.getElementById('tm-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    setTimeout(() => document.getElementById('tm-inp')?.focus(), 240);
  }

  function close() {
    _open = false;
    document.body.classList.remove('tm-drawer-open');
    document.getElementById('tm-drawer')?.classList.remove('open');
    document.getElementById('tm-backdrop')?.classList.remove('open');
    document.getElementById('tm-btn')?.classList.remove('active');
  }

  function toggle() { _open ? close() : open(); }

  // ── CSS ───────────────────────────────────────────────────
  function _css() {
    if (document.getElementById('tm-css')) return;
    const s = document.createElement('style');
    s.id = 'tm-css';
    s.textContent = `
/* ── Topbar trigger button (Option B — no floating wrap) ── */
#tm-btn.tm-topbar-btn {
  position: relative;
  color: var(--text-muted, #767676);
  transition: color .12s, background .12s, border-color .12s;
}
#tm-btn.tm-topbar-btn:hover {
  color: var(--orange, #F26419);
  border-color: var(--orange, #F26419);
  background: color-mix(in srgb, var(--orange, #F26419) 8%, transparent);
}
#tm-btn.tm-topbar-btn.active {
  color: #fff;
  background: #1A1A1A;
  border-color: #1A1A1A;
}
/* Online indicator dot (top-right of button) */
.tm-online-dot {
  position: absolute;
  top: 4px; right: 4px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--success, #22C55E);
  border: 1.5px solid var(--bg-card, #fff);
  box-shadow: 0 0 4px rgba(34,197,94,.6);
  animation: tm-pulse 2.4s infinite;
}
@keyframes tm-pulse {
  0%,100% { opacity: 1; }
  50%     { opacity: .45; }
}

/* Fallback for pages without .topbar-actions — floats bottom-right */
#tm-btn.tm-btn-fallback {
  position: fixed;
  bottom: 22px; right: 22px;
  width: 44px; height: 44px;
  border-radius: 50%;
  background: #1A1A1A;
  color: var(--orange, #F26419);
  border: 1px solid rgba(242,100,25,.4);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 9989;
  box-shadow: 0 4px 16px rgba(0,0,0,.3);
}

.tm-badge {
  position: absolute;
  top: -5px; right: -5px;
  min-width: 16px; height: 16px;
  border-radius: 99px;
  background: var(--orange, #F26419);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border: 2px solid var(--bg-card, #fff);
  line-height: 1;
}

/* ── Backdrop ────────────────────────────────────────── */
#tm-backdrop {
  position: fixed; inset: 0;
  background: rgba(15,23,42,.25);
  backdrop-filter: blur(2px);
  opacity: 0; pointer-events: none;
  transition: opacity .22s;
  z-index: 9994;
}
#tm-backdrop.open { opacity: 1; pointer-events: auto; }

/* ── Drawer (slides in from right) ───────────────────── */
#tm-drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 400px; max-width: 100vw;
  background: var(--bg-card, #fff);
  border-left: 1px solid var(--border, #E5E5E5);
  box-shadow: -12px 0 40px rgba(0,0,0,.14);
  display: flex; flex-direction: column;
  overflow: hidden;
  transform: translateX(100%);
  transition: transform .28s cubic-bezier(.4, 0, .2, 1);
  z-index: 9995;
  font-family: var(--font, 'JetBrains Mono', monospace);
}
#tm-drawer.open { transform: translateX(0); }

@media (max-width: 640px) {
  #tm-drawer { width: 100vw; }
}

/* ── Header ──────────────────────────────────────────── */
#tm-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 14px;
  background: #1A1A1A;
  flex-shrink: 0;
  border-bottom: 2px solid var(--orange, #F26419);
  position: relative;
  overflow: hidden;
}
#tm-hdr::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(ellipse 70% 120% at 0% 50%, rgba(242,100,25,.18) 0%, transparent 70%);
  pointer-events: none;
}
.tm-hdr-left {
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
}
.tm-avatar {
  width: 36px; height: 36px;
  border-radius: var(--radius, 8px);
  background: rgba(242,100,25,.15);
  border: 1px solid rgba(242,100,25,.3);
  color: var(--orange, #F26419);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tm-hdr-name {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  letter-spacing: .02em;
}
.tm-hdr-sub {
  font-size: 10px;
  color: rgba(255,255,255,.45);
  margin-top: 1px;
  display: flex;
  align-items: center;
  gap: 5px;
  letter-spacing: .01em;
}
.tm-dot-online {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--success, #22C55E);
  box-shadow: 0 0 4px rgba(34,197,94,.6);
  flex-shrink: 0;
}
#tm-close {
  background: none;
  border: none;
  color: rgba(255,255,255,.35);
  cursor: pointer;
  width: 28px; height: 28px;
  border-radius: var(--radius-sm, 4px);
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s;
  position: relative;
}
#tm-close:hover {
  background: rgba(255,255,255,.08);
  color: rgba(255,255,255,.8);
}

/* ── Messages ────────────────────────────────────────── */
#tm-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scroll-behavior: smooth;
}
#tm-msgs::-webkit-scrollbar { width: 4px; }
#tm-msgs::-webkit-scrollbar-track { background: transparent; }
#tm-msgs::-webkit-scrollbar-thumb {
  background: var(--border, #E5E5E5);
  border-radius: 99px;
}

.tm-row { display: flex; }
.tm-row-user { justify-content: flex-end; }
.tm-row-ai   { justify-content: flex-start; }

.tm-bubble {
  max-width: 82%;
  padding: 9px 13px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
  border-radius: var(--radius-lg, 12px);
}
.tm-bubble-user {
  background: var(--orange, #F26419);
  color: #fff;
  border-bottom-right-radius: var(--radius-sm, 4px);
}
.tm-bubble-ai {
  background: var(--bg-input, #F9F9F9);
  color: var(--text, #1C1C1E);
  border: 1px solid var(--border, #E5E5E5);
  border-bottom-left-radius: var(--radius-sm, 4px);
}
.tm-bubble code {
  background: rgba(0,0,0,.08);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 11px;
  font-family: var(--font, monospace);
}
.tm-bubble-user code { background: rgba(255,255,255,.2); }

/* ── Thinking ────────────────────────────────────────── */
#tm-think {
  align-items: center;
  gap: 6px;
  padding: 4px 12px 8px;
  flex-shrink: 0;
}
.tm-think-dots {
  display: flex;
  gap: 3px;
}
.tm-think-dots span {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--orange, #F26419);
  animation: tm-bounce .8s infinite ease-in-out;
}
.tm-think-dots span:nth-child(2) { animation-delay: .14s; }
.tm-think-dots span:nth-child(3) { animation-delay: .28s; }
@keyframes tm-bounce {
  0%,80%,100% { transform: scale(.55); opacity:.4; }
  40%          { transform: scale(1);   opacity:1; }
}
.tm-think-lbl {
  font-size: 11px;
  color: var(--text-muted, #767676);
}

/* ── Footer ──────────────────────────────────────────── */
#tm-foot {
  border-top: 1px solid var(--border, #E5E5E5);
  padding: 10px 10px 8px;
  flex-shrink: 0;
  background: var(--bg-card, #fff);
}
#tm-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 7px;
}
#tm-inp {
  flex: 1;
  resize: none;
  border: 1px solid var(--border, #E5E5E5);
  border-radius: var(--radius, 8px);
  padding: 7px 10px;
  font-size: 12px;
  font-family: var(--font, 'JetBrains Mono', monospace);
  background: var(--bg-input, #F9F9F9);
  color: var(--text, #1C1C1E);
  line-height: 1.5;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
  min-height: 34px;
  max-height: 110px;
  overflow-y: auto;
}
#tm-inp:focus {
  border-color: var(--border-focus, #F26419);
  box-shadow: 0 0 0 3px rgba(242,100,25,.1);
}
#tm-inp::placeholder { color: var(--text-muted, #767676); }
#tm-send {
  width: 34px; height: 34px;
  border-radius: var(--radius, 8px);
  background: var(--orange, #F26419);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background .15s, transform .1s;
}
#tm-send:hover:not(:disabled) { background: var(--orange-hover, #E05510); }
#tm-send:active:not(:disabled) { transform: scale(.93); }
#tm-send:disabled { opacity: .4; cursor: not-allowed; }

.tm-disclaimer {
  margin-top: 6px;
  font-size: 9px;
  color: var(--text-muted, #767676);
  text-align: center;
  letter-spacing: .02em;
  opacity: .7;
}

/* ── Dark mode ───────────────────────────────────────── */
html[data-theme="dark"] #tm-btn {
  background: #0d0f14;
  border-color: rgba(242,100,25,.2);
}
html[data-theme="dark"] #tm-btn:hover {
  border-color: rgba(242,100,25,.5);
}
html[data-theme="dark"] .tm-badge {
  border-color: var(--bg, #0f1117);
}
html[data-theme="dark"] #tm-drawer {
  background: var(--bg-card, #1c1f26);
  border-left-color: var(--border, #2d3748);
  box-shadow: -12px 0 40px rgba(0,0,0,.5);
}
html[data-theme="dark"] #tm-hdr { background: #0d0f14; }
html[data-theme="dark"] .tm-bubble-ai {
  background: var(--bg-input, #161a21);
  color: var(--text, #e2e8f0);
  border-color: var(--border, #2d3748);
}
html[data-theme="dark"] .tm-bubble code { background: rgba(255,255,255,.06); }
html[data-theme="dark"] #tm-foot { background: var(--bg-card, #1c1f26); border-color: var(--border, #2d3748); }
html[data-theme="dark"] #tm-inp {
  background: var(--bg-input, #161a21);
  color: var(--text, #e2e8f0);
  border-color: var(--border, #2d3748);
}
html[data-theme="dark"] #tm-inp::placeholder { color: var(--text-muted, #94a3b8); }
html[data-theme="dark"] #tm-msgs::-webkit-scrollbar-thumb { background: #2d3748; }

/* ── Quick chips ─────────────────────────────────────── */
#tm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 2px 8px;
}
.tm-chip {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #E5E5E5);
  border-radius: 99px;
  padding: 5px 11px;
  font-size: 11px;
  font-family: var(--font, 'JetBrains Mono', monospace);
  color: var(--text, #1C1C1E);
  cursor: pointer;
  transition: border-color .12s, background .12s, color .12s;
  white-space: nowrap;
}
.tm-chip:hover {
  border-color: var(--orange, #F26419);
  color: var(--orange, #F26419);
  background: var(--orange-bg, #FFF4EE);
}
html[data-theme="dark"] .tm-chip {
  background: var(--bg-input, #161a21);
  border-color: var(--border, #2d3748);
  color: var(--text, #e2e8f0);
}
html[data-theme="dark"] .tm-chip:hover {
  border-color: var(--orange, #F26419);
  color: var(--orange, #F26419);
  background: var(--orange-dim, rgba(242,100,25,.1));
}

/* ── Mobile ──────────────────────────────────────────── */
@media (max-width: 520px) {
  #tm-btn.tm-btn-fallback { bottom: 14px; right: 14px; }
}
    `;
    document.head.appendChild(s);
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _build);
    } else {
      _build();
    }
  }

  return { init, open, close, toggle };
})();

TummengAI.init();
