/* ══════════════════════════════════════════════════════════════════
   pw-schedule.js | SOM-Portal — Planned Work overview (user side)
   ══════════════════════════════════════════════════════════════════ */

const PW = (() => {
  const state = {
    rounds: [],            // [{round, total, completed, all_done}]
    currentRound: null,    // "YYYY-MM-DD"
    roundData: null,       // {round, items: [...]}
    config: { lead_minutes: [10, 5], sound_enabled: true, has_webhook: false },
    notified: {},          // { itemId: Set([10,5]) }
    tickHandle: null,
    pollHandle: null,      // realtime poll
    pollPaused: false,     // paused while modal is open
    lastSig: '',           // signature for change detection
    ntrack: null,          // Web Notification permission state
    editingId: null,       // id of item being edited in modal
    formAttachments: [],   // [{url, caption, ...}] in the open form
    userPickedRound: false, // true after user manually changes the round dropdown
  };

  // ─── Utilities ─────────────────────────────────────────────
  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const pad = (n) => String(n).padStart(2,'0');
  const fmtTime = (iso) => {
    const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtDateShort = (iso) => {
    const d = new Date(iso);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${pad(d.getDate())} ${months[d.getMonth()]}`;
  };
  const fmtRange = (sIso, eIso) => {
    const s = new Date(sIso), e = new Date(eIso);
    const same = s.toDateString() === e.toDateString();
    return same
      ? `${fmtDateShort(sIso)} · ${fmtTime(sIso)} – ${fmtTime(eIso)}`
      : `${fmtDateShort(sIso)} ${fmtTime(sIso)} → ${fmtDateShort(eIso)} ${fmtTime(eIso)}`;
  };
  const fmtDuration = (ms) => {
    if (ms <= 0) return '0m';
    const total = Math.floor(ms / 60000);
    const h = Math.floor(total / 60), m = total % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  };
  const fmtRoundRange = (roundKey) => {
    if (!roundKey) return '—';
    const [y,mo,da] = roundKey.split('-').map(Number);
    const d0 = new Date(y, mo - 1, da);
    const d1 = new Date(d0.getTime() + 86400000);
    return `${pad(d0.getDate())} ${d0.toLocaleString('en', {month:'short'})} → ${pad(d1.getDate())} ${d1.toLocaleString('en', {month:'short'})} ${d1.getFullYear()}`;
  };

  // toast fallback (use utils toast if available).
  // Note: `Toast` in utils.js is declared with `const` at script top-level, which
  // does NOT attach to `window` — so we have to reference `Toast` directly. The
  // old `window.Toast?.show` check silently fell through to console.log, which
  // is why nothing appeared bottom-right on screen for auto-sync results.
  const toast = (msg, type='info') => {
    if (typeof Toast !== 'undefined' && Toast?.show) return Toast.show(msg, type);
    if (typeof showToast !== 'undefined')            return showToast(msg, type);
    console.log(`[toast/${type}]`, msg);
  };

  // ─── Sound (beep via WebAudio, no external asset needed) ──────
  // Audio + browser notifications are SM-only. Other teams that get PW schedule
  // view access via admin/super-team-permissions.html see everything silently.
  // super_admin / super_viewer follow their _getViewAsTeam() preview.
  const isSoundAllowed = () => {
    try {
      const u = (typeof Auth !== 'undefined' && Auth?.getUser) ? Auth.getUser() : null;
      if (!u) return false;
      if (u.role === 'super_admin' || u.role === 'super_viewer') {
        const t = Auth._getViewAsTeam ? Auth._getViewAsTeam() : null;
        return t ? t.slug === 'sm' : true;
      }
      return u.team === 'sm';
    } catch { return false; }
  };

  let audioCtx = null;
  let audioUnlocked = false;

  const ensureAudio = async () => {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioUnlocked = audioCtx.state === 'running';
    } catch { audioUnlocked = false; }
    return audioUnlocked;
  };

  const beep = (force = false) => {
    if (!isSoundAllowed()) return;
    if (!force && !state.config.sound_enabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      if (ctx.state === 'suspended') {
        // Try to resume — browsers may still block without a user gesture
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      [0, 0.18].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(i === 0 ? 880 : 660, now + offset);
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + offset + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.34);
      });
    } catch (e) { /* no-op */ }
  };

  // First user gesture anywhere on the page → unlock audio
  const installAudioUnlock = () => {
    if (!isSoundAllowed()) return;
    const handler = async () => {
      await ensureAudio();
      if (audioUnlocked) {
        document.removeEventListener('click', handler, true);
        document.removeEventListener('keydown', handler, true);
        document.removeEventListener('touchend', handler, true);
        updateSoundBadge();
      }
    };
    document.addEventListener('click',   handler, true);
    document.addEventListener('keydown', handler, true);
    document.addEventListener('touchend', handler, true);
  };

  const updateSoundBadge = () => {
    const btn = $('pw-btn-test-sound');
    if (!btn) return;
    if (!isSoundAllowed()) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    if (!state.config.sound_enabled) {
      btn.textContent = 'Sound off';
      btn.title = 'Sound disabled in admin settings';
      btn.classList.add('off');
      return;
    }
    btn.classList.remove('off');
    btn.textContent = audioUnlocked ? 'Test sound' : 'Enable sound';
    btn.title = audioUnlocked
      ? 'Click to play test beep'
      : 'Browser is blocking audio — click to unlock';
  };

  // ─── Web Notifications ────────────────────────────────────────
  const notify = (title, body) => {
    if (!isSoundAllowed()) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body, icon: 'favicon.ico' });
      setTimeout(() => n.close(), 8000);
    } catch {}
  };
  const askNotifPerm = async () => {
    if (!isSoundAllowed()) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    renderSoundHint();
  };
  const renderSoundHint = () => {
    const el = $('pw-sound-hint');
    if (!el) return;
    if (!isSoundAllowed()) { el.style.display = 'none'; return; }
    if (!('Notification' in window)) { el.style.display = 'none'; return; }
    if (Notification.permission === 'granted') { el.style.display = 'none'; return; }
    el.style.display = '';
  };

  // ─── Custom in-app dialogs (replace native confirm/alert) ─────
  const ensureDialogHost = () => {
    let host = document.getElementById('pw-dialog-host');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'pw-dialog-host';
    document.body.appendChild(host);
    return host;
  };

  const dialog = ({ title, body, html, confirmText = 'OK', cancelText = 'Cancel', danger = false, hideCancel = false }) => {
    return new Promise(resolve => {
      const host = ensureDialogHost();
      const wrap = document.createElement('div');
      wrap.className = 'pw-dialog-wrap';
      wrap.innerHTML = `
        <div class="pw-dialog" role="dialog" aria-modal="true">
          ${title ? `<h3 class="pw-dialog-title">${esc(title)}</h3>` : ''}
          <div class="pw-dialog-body">${html ? html : esc(body || '')}</div>
          <div class="pw-dialog-foot">
            ${hideCancel ? '' : `<button class="pw-btn-ghost" data-act="cancel">${esc(cancelText)}</button>`}
            <button class="${danger ? 'pw-btn-danger' : 'pw-btn-primary'}" data-act="ok">${esc(confirmText)}</button>
          </div>
        </div>
      `;
      host.appendChild(wrap);
      requestAnimationFrame(() => wrap.classList.add('open'));

      const close = (val) => {
        wrap.classList.remove('open');
        setTimeout(() => wrap.remove(), 180);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter')  close(true);
      };
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', (e) => {
        if (e.target === wrap) return close(false);
        const act = e.target.dataset?.act;
        if (act === 'ok')     close(true);
        if (act === 'cancel') close(false);
      });
    });
  };

  // Loading dialog — non-blocking spinner shown during long ops
  const showLoading = ({ title = 'Loading…', body = '' } = {}) => {
    const host = ensureDialogHost();
    const wrap = document.createElement('div');
    wrap.className = 'pw-dialog-wrap';
    wrap.innerHTML = `
      <div class="pw-dialog pw-dialog-loading" role="alert">
        <div class="pw-spinner" aria-hidden="true"></div>
        <div class="pw-loading-text">
          <div class="pw-loading-title">${esc(title)}</div>
          ${body ? `<div class="pw-loading-body">${esc(body)}</div>` : ''}
        </div>
      </div>
    `;
    host.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    return {
      update: (newBody) => {
        const el = wrap.querySelector('.pw-loading-body');
        if (el) el.textContent = newBody;
      },
      close: () => {
        wrap.classList.remove('open');
        setTimeout(() => wrap.remove(), 180);
      }
    };
  };

  const confirmDialog = (msg, opts = {}) => dialog({ body: msg, ...opts });
  const alertDialog   = (msg, opts = {}) => dialog({ body: msg, hideCancel: true, ...opts });

  // ─── Data load ────────────────────────────────────────────────
  const loadRoundsList = async () => {
    const r = await API.pwSchedule.listRounds();
    state.rounds = r?.data?.data || [];
    return state.rounds;
  };

  const loadConfig = async () => {
    const r = await API.pwSchedule.getConfig();
    state.config = Object.assign({ lead_minutes: [10, 5], sound_enabled: true, has_webhook: false }, r?.data?.data || {});
    return state.config;
  };

  const loadActiveRound = async () => {
    const r = await API.pwSchedule.active();
    const data = r?.data?.data;
    if (data?.round) state.currentRound = data.round;
    state.roundData = data || { round: state.currentRound, items: [] };
  };

  const loadRound = async (roundKey) => {
    const r = await API.pwSchedule.round(roundKey);
    state.currentRound = roundKey;
    state.roundData = r?.data?.data || { round: roundKey, items: [] };
  };

  // ─── Renderers ────────────────────────────────────────────────
  const renderRoundBar = () => {
    $('pw-round-title').textContent = fmtRoundRange(state.currentRound);
    const items = state.roundData?.items || [];
    const done = items.filter(i => i.completed).length;
    $('pw-round-sub').textContent =
      items.length === 0
        ? 'ยังไม่มี PW ในรอบนี้'
        : `${items.length} tasks · ${done} completed`;

    // Round selector
    const sel = $('pw-round-select');
    const existing = new Set(state.rounds.map(r => r.round));
    if (!existing.has(state.currentRound)) {
      // Include an "ad-hoc" entry so user sees the current empty round
      state.rounds.unshift({ round: state.currentRound, total: 0, completed: 0, all_done: false });
    }
    sel.innerHTML = state.rounds.map(r => {
      const flag = r.all_done ? ' <i data-icon=\"check\"></i>' : '';
      return `<option value="${esc(r.round)}">${fmtRoundRange(r.round)} · ${r.completed}/${r.total}${flag}</option>`;
    }).join('');
    sel.value = state.currentRound;
  };

  const renderStats = () => {
    const items = state.roundData?.items || [];
    const internal = items.filter(i => i.type === 'INTERNAL').length;
    const external = items.filter(i => i.type === 'EXTERNAL').length;
    const done     = items.filter(i => i.completed).length;
    $('pw-stat-total').textContent    = items.length;
    $('pw-stat-internal').textContent = internal;
    $('pw-stat-external').textContent = external;
    $('pw-stat-done').textContent     = done;
    $('pw-progress-text').textContent = `${done} / ${items.length} done`;
  };

  const renderNextUp = () => {
    const host = $('pw-next-list');
    const doneBanner = $('pw-done-banner');
    const items = state.roundData?.items || [];
    if (!items.length) { host.innerHTML = ''; doneBanner.style.display = 'none'; return; }

    const allDone = items.every(i => i.completed);
    if (allDone) {
      host.innerHTML = '';
      doneBanner.style.display = '';
      $('pw-done-msg').textContent = 'All tasks completed for this round. รอบถัดไปจะขึ้นมาเมื่อมี PW ใหม่';
      return;
    }
    doneBanner.style.display = 'none';

    const now = Date.now();
    const sorted = [...items].sort((a,b) => new Date(a.start) - new Date(b.start));

    // All PWs currently live (started, not ended, not completed)
    const actives = sorted.filter(t => {
      const s = new Date(t.start).getTime(), e = new Date(t.end).getTime();
      return now >= s && now <= e && !t.completed;
    });

    const banners = [];
    actives.forEach(t => {
      const remain = new Date(t.end).getTime() - now;
      banners.push(`
        <div class="pw-next">
          <div class="pw-next-pulse"></div>
          <div class="pw-next-info">
            <div class="pw-next-eyebrow">● Live now</div>
            <div class="pw-next-title">${esc(t.pw_name)}</div>
          </div>
          <div class="pw-next-cd"><span class="lbl">เหลือ</span><strong>${fmtDuration(remain)}</strong></div>
        </div>
      `);
    });

    // Next upcoming (only one — the one that starts soonest)
    const upcoming = sorted.find(t => new Date(t.start).getTime() > now && !t.completed);
    if (upcoming) {
      const diff = new Date(upcoming.start).getTime() - now;
      banners.push(`
        <div class="pw-next" style="${actives.length ? 'background:var(--bg-card);border-color:var(--border)' : ''}">
          <div class="pw-next-pulse" ${actives.length ? 'style="background:#9a9a9a;animation:none;box-shadow:none"' : ''}></div>
          <div class="pw-next-info">
            <div class="pw-next-eyebrow" ${actives.length ? 'style="color:var(--text-muted)"' : ''}>Next up</div>
            <div class="pw-next-title">${esc(upcoming.pw_name)}</div>
          </div>
          <div class="pw-next-cd"><span class="lbl">อีก</span><strong>${fmtDuration(diff)}</strong></div>
        </div>
      `);
    }

    if (!banners.length) {
      banners.push(`
        <div class="pw-next" style="background:var(--bg-card);border-color:var(--border)">
          <div class="pw-next-pulse" style="background:#9a9a9a;animation:none;box-shadow:none"></div>
          <div class="pw-next-info">
            <div class="pw-next-eyebrow" style="color:var(--text-muted)">All clear</div>
            <div class="pw-next-title">ไม่มี PW ที่ยังไม่เริ่ม</div>
          </div>
          <div class="pw-next-cd">—</div>
        </div>
      `);
    }

    host.innerHTML = banners.join('');
  };

  const renderList = () => {
    const list = $('pw-list');
    const empty = $('pw-empty');
    const items = state.roundData?.items || [];
    if (!items.length) {
      list.innerHTML = ''; empty.style.display = ''; return;
    }
    empty.style.display = 'none';

    const now = Date.now();
    const sorted = [...items].sort((a,b) => new Date(a.start) - new Date(b.start));

    list.innerHTML = sorted.map(t => {
      const startMs = new Date(t.start).getTime();
      const endMs   = new Date(t.end).getTime();
      const diff    = startMs - now;

      let cls = '';
      if (t.completed) cls = 'done';
      else if (now >= startMs && now <= endMs) cls = 'active';
      else if (diff > 0 && diff <= 60*60*1000) cls = 'imminent';

      const mopLink   = (t.mop  && /^https?:\/\//i.test(t.mop))  ? `<a href="${esc(t.mop)}"  target="_blank" rel="noopener">MOP ↗</a>` : '';
      const meetLink  = (t.meet && /^https?:\/\//i.test(t.meet)) ? `<a href="${esc(t.meet)}" target="_blank" rel="noopener">Meet ↗</a>` : '';

      const extras = [];
      if (t.task)    extras.push(`<div class="pw-task-extra-row"><div class="k">Task</div><div class="v">${esc(t.task)}</div></div>`);
      if (t.impact)  extras.push(`<div class="pw-task-extra-row"><div class="k">Impact</div><div class="v">${esc(t.impact)}</div></div>`);
      if (t.owner)   extras.push(`<div class="pw-task-extra-row"><div class="k">Owner</div><div class="v">${esc(t.owner)}</div></div>`);
      if (t.ticket)  extras.push(`<div class="pw-task-extra-row"><div class="k">Ticket</div><div class="v">${esc(t.ticket)}</div></div>`);
      if (mopLink || meetLink) extras.push(`<div class="pw-task-extra-row"><div class="k">Links</div><div class="v">${mopLink} ${meetLink}</div></div>`);
      if (t.remark)  extras.push(`<div class="pw-task-extra-row"><div class="k">Remark</div><div class="v">${esc(t.remark)}</div></div>`);

      const atts = Array.isArray(t.attachments) ? t.attachments : [];
      const images = atts.filter(a => a.url);
      const notes  = atts.filter(a => !a.url && a.caption);
      const imgHtml = images.length ? `
        <div class="pw-task-atts">
          ${images.map(a => `
            <a class="pw-task-att" data-lb="${esc(a.url)}" style="background-image:url('${esc(a.url)}')" title="${esc(a.caption || '')}">
              ${a.caption ? `<span class="pw-task-att-cap">${esc(a.caption)}</span>` : ''}
            </a>
          `).join('')}
        </div>` : '';
      const noteHtml = notes.length ? `
        <div class="pw-task-notes">
          ${notes.map(a => `<div class="pw-task-note">${esc(a.caption)}</div>`).join('')}
        </div>` : '';

      const attCount = images.length + notes.length;
      const attLabel = images.length && notes.length
        ? `${images.length} รูป · ${notes.length} note`
        : images.length ? `${images.length} รูป`
        : notes.length  ? `${notes.length} note` : '';

      return `
        <div class="pw-task ${cls}" data-id="${esc(t.id)}">
          <div class="pw-check ${t.completed ? 'checked' : ''}" data-action="toggle" data-id="${esc(t.id)}" title="Mark complete"></div>
          <div class="pw-time">
            <div class="pw-time-h">${fmtTime(t.start)}</div>
            <div class="pw-time-d">${fmtDateShort(t.start)}</div>
          </div>
          <div class="pw-task-body">
            <div class="pw-task-name">${esc(t.pw_name)}</div>
            <div class="pw-task-meta">
              <span>${fmtRange(t.start, t.end)}</span>
              <span class="dot">·</span>
              <span>${fmtDuration(new Date(t.end) - new Date(t.start))}</span>
              ${attCount ? `<span class="dot">·</span><span>${attLabel}</span>` : ''}
            </div>
            <div class="pw-task-tags">
              <span class="pw-tag ${t.type === 'INTERNAL' ? 'int' : 'ext'}">${esc(t.type || 'INTERNAL')}</span>
              ${t.completed ? '<span class="pw-tag" style="background:rgba(34,197,94,.12);color:#16a34a">Done</span>' : ''}
            </div>
            ${extras.length ? `<div class="pw-task-extra">${extras.join('')}</div>` : ''}
            ${imgHtml}
            ${noteHtml}
          </div>
          <div class="pw-task-actions">
            <button class="pw-icon-btn" data-action="edit" data-id="${esc(t.id)}" title="Edit"><i data-icon=\"pencil\"></i></button>
            <button class="pw-icon-btn danger" data-action="delete" data-id="${esc(t.id)}" title="Delete">×</button>
          </div>
        </div>
      `;
    }).join('');
  };

  const renderAll = () => {
    renderRoundBar();
    renderStats();
    renderNextUp();
    renderList();
    renderSoundHint();
  };

  // ─── Lead-time notifications / ticker ─────────────────────────
  const tick = () => {
    const items = state.roundData?.items || [];
    if (!items.length) return;
    const now = Date.now();
    const leads = state.config.lead_minutes || [10, 5];

    items.forEach(t => {
      if (t.completed) return;
      const startMs = new Date(t.start).getTime();
      const diffMin = Math.round((startMs - now) / 60000);
      if (!state.notified[t.id]) state.notified[t.id] = new Set();
      leads.forEach(lead => {
        // fire once when we enter the window [lead - 1, lead]
        if (diffMin === lead && !state.notified[t.id].has(lead)) {
          state.notified[t.id].add(lead);
          notify(`PW ใกล้เริ่มแล้ว (${lead} นาที)`, t.pw_name);
          beep();
        }
      });
    });

    // also re-render Next Up countdown
    renderNextUp();
  };

  // ─── Modal form ───────────────────────────────────────────────
  const openModal = (item) => {
    state.editingId = item?.id || null;
    state.pollPaused = true;
    state.formAttachments = item?.attachments ? item.attachments.map(a => ({ ...a })) : [];

    $('pw-modal-title').textContent = item ? 'Edit Planwork' : 'Add Planwork';
    $('pw-f-delete').style.display = item ? '' : 'none';

    const setType = (val) => {
      document.querySelectorAll('#pw-radio-type .pw-radio').forEach(r => {
        r.classList.toggle('active', r.dataset.val === val);
      });
    };
    setType(item?.type || 'INTERNAL');
    $('pw-f-name').value    = item?.pw_name || '';
    $('pw-f-mop').value     = item?.mop || '';
    $('pw-f-meet').value    = item?.meet || '';
    $('pw-f-task').value    = item?.task || '';
    $('pw-f-impact').value  = item?.impact || '';
    $('pw-f-owner').value   = item?.owner || '';
    $('pw-f-ticket').value  = item?.ticket || '';
    $('pw-f-remark').value  = item?.remark || '';

    const toLocalInputVal = (iso) => {
      if (!iso) {
        const d = new Date();
        d.setHours(22, 0, 0, 0);
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
      const d = new Date(iso);
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    $('pw-f-start').value = toLocalInputVal(item?.start);
    $('pw-f-end').value   = toLocalInputVal(item?.end || (() => {
      const d = new Date(); d.setHours(d.getHours() + 4, 0, 0, 0);
      return d.toISOString();
    })());

    renderFormAttachments();
    $('pw-f-att-file').value = '';
    $('pw-modal-wrap').classList.add('open');
  };

  const closeModal = () => {
    state.editingId = null;
    state.formAttachments = [];
    state.pollPaused = false;
    $('pw-modal-wrap').classList.remove('open');
  };

  const renderFormAttachments = () => {
    const host = $('pw-f-atts');
    if (!state.formAttachments.length) {
      host.innerHTML = '<div class="pw-att-hint" style="margin:2px 0">ยังไม่มีอะไร — แนบรูปหรือเพิ่มข้อความได้ด้านล่าง (วางรูปด้วย Ctrl/Cmd+V ก็ได้)</div>';
      return;
    }
    host.innerHTML = state.formAttachments.map((a, i) => {
      const isNote = !a.url && !a._uploading;
      if (isNote) {
        return `
          <div class="pw-att note" data-idx="${i}">
            <textarea class="pw-att-caption" data-att-cap="${i}" placeholder="ข้อความที่จะไปเป็น reply ใน thread">${esc(a.caption || '')}</textarea>
            <button class="pw-att-rm" data-att-rm="${i}" title="Remove">×</button>
          </div>`;
      }
      const thumb = a._uploading
        ? '<div class="pw-att-thumb">กำลัง…</div>'
        : `<div class="pw-att-thumb" style="background-image:url('${esc(a.url || '')}')"></div>`;
      return `
        <div class="pw-att ${a._uploading ? 'pw-att-uploading' : ''}" data-idx="${i}">
          ${thumb}
          <input class="pw-att-caption" data-att-cap="${i}" placeholder="คำอธิบายรูป (ไม่ระบุก็ได้)" value="${esc(a.caption || '')}" ${a._uploading ? 'disabled' : ''}>
          <button class="pw-att-rm" data-att-rm="${i}" title="Remove" ${a._uploading ? 'disabled' : ''}>×</button>
        </div>`;
    }).join('');
  };

  const uploadFile = async (file) => {
    // Read CSRF token from cookie
    const fd = new FormData();
    fd.append('image', file);
    const res = await API.upload('/upload.php', fd);
    if (!res?.ok) throw new Error(res?.data?.message || 'Upload failed');
    const url = res.data?.data?.url || res.data?.url;
    if (!url) throw new Error('No URL returned from upload');
    return url;
  };

  const handleAttachFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    for (const f of list) {
      if (!f.type.startsWith('image/')) {
        toast(`ข้าม ${f.name || 'ไฟล์'} (ไม่ใช่รูป)`, 'error');
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast(`${f.name || 'ไฟล์'} เกิน 5MB`, 'error');
        continue;
      }
      const placeholder = { url: '', caption: '', _uploading: true };
      state.formAttachments.push(placeholder);
      renderFormAttachments();
      try {
        const url = await uploadFile(f);
        placeholder.url = url;
        placeholder._uploading = false;
        renderFormAttachments();
      } catch (e) {
        const idx = state.formAttachments.indexOf(placeholder);
        if (idx >= 0) state.formAttachments.splice(idx, 1);
        renderFormAttachments();
        toast(`อัปโหลด ${f.name || 'ไฟล์'} ไม่สำเร็จ: ${e.message}`, 'error');
      }
    }
  };

  const addNote = () => {
    state.formAttachments.push({ url: '', caption: '' });
    renderFormAttachments();
    // focus the new textarea
    setTimeout(() => {
      const els = document.querySelectorAll('[data-att-cap]');
      const last = els[els.length - 1];
      if (last) last.focus();
    }, 10);
  };

  const readForm = () => {
    const type = document.querySelector('#pw-radio-type .pw-radio.active')?.dataset.val || 'INTERNAL';
    const toIso = (local) => {
      if (!local) return '';
      const d = new Date(local);
      if (isNaN(d.getTime())) return '';
      return d.toISOString();
    };
    // refresh captions from inputs
    document.querySelectorAll('[data-att-cap]').forEach(inp => {
      const i = Number(inp.dataset.attCap);
      if (state.formAttachments[i]) state.formAttachments[i].caption = inp.value.trim();
    });
    return {
      type,
      pw_name: $('pw-f-name').value.trim(),
      start:   toIso($('pw-f-start').value),
      end:     toIso($('pw-f-end').value),
      mop:     $('pw-f-mop').value.trim(),
      meet:    $('pw-f-meet').value.trim(),
      task:    $('pw-f-task').value.trim(),
      impact:  $('pw-f-impact').value.trim(),
      owner:   $('pw-f-owner').value.trim(),
      ticket:  $('pw-f-ticket').value.trim(),
      remark:  $('pw-f-remark').value.trim(),
      attachments: state.formAttachments
        .filter(a => !a._uploading)
        .filter(a => a.url || a.caption)
        .map(a => ({ url: a.url || '', caption: a.caption || '' })),
    };
  };

  const saveForm = async () => {
    const data = readForm();
    if (!data.pw_name) return toast('กรุณากรอก PW Name', 'error');
    if (!data.start || !data.end) return toast('กรุณาเลือกเวลา Start และ End', 'error');
    if (new Date(data.end) <= new Date(data.start)) return toast('End ต้องอยู่หลัง Start', 'error');

    $('pw-f-save').disabled = true;
    try {
      const res = state.editingId
        ? await API.pwSchedule.update(state.editingId, data)
        : await API.pwSchedule.create(data);
      if (!res?.ok) throw new Error(res?.data?.message || 'Save failed');
      toast(state.editingId ? 'อัปเดตแล้ว' : 'เพิ่ม PW แล้ว', 'success');
      closeModal();
      await refresh();
    } catch (e) {
      toast(e.message || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      $('pw-f-save').disabled = false;
    }
  };

  const deleteItem = async (id) => {
    const ok = await confirmDialog('ลบ PW นี้?', { confirmText: 'ลบ', cancelText: 'ยกเลิก', danger: true, title: 'ยืนยันการลบ' });
    if (!ok) return;
    const res = await API.pwSchedule.delete(id);
    if (!res?.ok) return toast(res?.data?.message || 'ลบไม่สำเร็จ', 'error');
    toast('ลบแล้ว', 'success');
    closeModal();
    await refresh();
  };

  const toggleItem = async (id) => {
    const res = await API.pwSchedule.toggle(id);
    if (!res?.ok) return toast(res?.data?.message || 'อัปเดตไม่สำเร็จ', 'error');
    // update in-place for responsiveness
    const updated = res.data.data?.item;
    if (updated) {
      const items = state.roundData?.items || [];
      const idx = items.findIndex(i => i.id === updated.id);
      if (idx >= 0) items[idx] = updated;
    }
    renderAll();
    // reload rounds summary so selector flag updates
    loadRoundsList().then(renderRoundBar).catch(()=>{});
  };

  const sendNoti = async () => {
    if (!state.roundData?.items?.length) return toast('ไม่มี PW ในรอบนี้', 'error');
    if (!state.config.has_webhook) {
      return toast('Admin ยังไม่ได้ตั้งค่า Google Chat webhook', 'error');
    }
    const ok = await confirmDialog(`ส่งสรุป PW ของรอบ ${fmtRoundRange(state.currentRound)} ไปยัง Google Chat?`, {
      title: 'ส่งแจ้งเตือน',
      confirmText: 'ส่ง',
      cancelText: 'ยกเลิก',
    });
    if (!ok) return;
    const btn = $('pw-btn-notify');
    btn.disabled = true;
    try {
      const res = await API.pwSchedule.notify(state.currentRound);
      if (!res?.ok) throw new Error(res?.data?.message || 'ส่งไม่สำเร็จ');
      toast('ส่งแจ้งเตือนแล้ว', 'success');
    } catch (e) {
      toast(e.message || 'ส่งไม่สำเร็จ', 'error');
    } finally {
      btn.disabled = false;
    }
  };

  // auto=true → skip confirm dialog + loading modal + summary modal (used by
  // the page-load auto-sync so the flow is quiet unless something actually
  // changed).
  const syncFromSheet = async ({ auto = false } = {}) => {
    if (!state.config.has_n8n_sync) {
      if (!auto) toast('Admin ยังไม่ได้ตั้งค่า n8n sync webhook', 'error');
      return;
    }
    if (!auto) {
      const ok = await confirmDialog(
        `Sync PW จาก Google Sheet?\n\nระบบจะดึงงานทั้งหมดจาก sheet แล้วกระจายลงรอบที่เหมาะสมตามวันเริ่ม\nรายการที่มีอยู่แล้ว (อ้างอิงจาก ticket reference) จะถูก skip ไม่ทับของเดิม`,
        { title: 'Sync จาก Sheet', confirmText: 'Sync', cancelText: 'ยกเลิก' }
      );
      if (!ok) return;
    }
    const btn = $('pw-btn-sync');
    btn.disabled = true;
    btn.textContent = auto ? '↻ Auto-syncing…' : '↻ กำลัง sync…';
    const loader = auto ? null : showLoading({ title: 'กำลัง sync จาก Google Sheet', body: 'อ่านข้อมูลและกระจายลงแต่ละรอบ…' });
    try {
      const res = await API.pwSchedule.sync(state.currentRound);
      if (!res?.ok) throw new Error(res?.data?.message || 'sync ไม่สำเร็จ');
      const d = res.data?.data || {};
      const importedList = d.imported || [];
      const skp = (d.skipped  || []).length;
      const rej = (d.rejected || []).length;
      const imp = importedList.length;

      // Group imports by round so the user can see where things landed
      const byRound = {};
      importedList.forEach(it => {
        const k = it.round || '?';
        (byRound[k] = byRound[k] || []).push(it);
      });
      const groups = Object.keys(byRound).sort().map(k => {
        const list = byRound[k];
        const lines = list.map(i => `<li class="pw-sync-item">${esc(i.pw_name || i.ref || '')}</li>`).join('');
        return `
          <section class="pw-sync-roundgrp">
            <header class="pw-sync-roundgrp-h">
              <span class="r-label">${esc(fmtRoundRange(k))}</span>
              <span class="r-count">${list.length}</span>
            </header>
            <ul class="pw-sync-list">${lines}</ul>
          </section>`;
      }).join('');

      const summary = `
        <div class="pw-sync-stats">
          <div class="pw-sync-stat">
            <div class="num ${imp ? 'good' : ''}">${imp}</div>
            <div class="lbl">เพิ่มใหม่</div>
          </div>
          <div class="pw-sync-stat">
            <div class="num">${skp}</div>
            <div class="lbl">มีอยู่แล้ว</div>
          </div>
          <div class="pw-sync-stat">
            <div class="num">${rej}</div>
            <div class="lbl">ข้อมูลไม่ครบ</div>
          </div>
        </div>
        ${imp ? `<div class="pw-sync-groups">${groups}</div>` : ''}
      `;

      loader?.close();
      if (auto) {
        // Quiet path: always confirm auto-sync ran (user has been asking why
        // it "wasn't syncing" when in fact it was — silent success looks
        // identical to nothing happening). Different message when something
        // was actually imported vs. no-op.
        toast(
          imp ? `Auto-synced · เพิ่ม ${imp} รายการใหม่จาก Sheet`
              : 'Auto-synced · Sheet ไม่มีข้อมูลใหม่',
          imp ? 'success' : 'info'
        );
      } else {
        await alertDialog('', {
          title: imp ? 'Sync เสร็จเรียบร้อย' : 'ไม่มีข้อมูลใหม่',
          html: summary,
          confirmText: 'ปิด',
        });
      }

      if (imp) {
        let target = null;
        if (byRound[state.currentRound]) {
          target = state.currentRound;
        } else {
          const sorted = Object.keys(byRound).sort();
          target = sorted.find(k => k >= state.currentRound) || sorted[0];
        }
        // Don't yank the user off the round they're looking at during an
        // auto-sync — only jump on manual sync.
        if (!auto && target && target !== state.currentRound) {
          state.currentRound = target;
          state.userPickedRound = true;
        }
        await refresh();
      }
    } catch (e) {
      loader?.close();
      if (auto) {
        // Auto-sync failure is non-fatal — a toast is enough, don't block
        // the whole page with a modal. Log the full error to console so an
        // n8n workflow issue can be traced without opening the network tab.
        console.warn('[pw-schedule] auto-sync failed:', e?.message || e);
        toast('Auto-sync ไม่สำเร็จ: ' + (e.message || 'unknown'), 'error');
      } else {
        await alertDialog(e.message || 'sync ไม่สำเร็จ', { title: 'Sync ผิดพลาด', confirmText: 'ปิด' });
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Sync Sheet';
    }
  };

  // ─── Refresh orchestrator ─────────────────────────────────────
  const roundSignature = (d) => {
    const items = d?.items || [];
    return items.map(i => {
      const atts = Array.isArray(i.attachments) ? i.attachments : [];
      const attSig = atts.length + ':' + atts.map(a => (a.url || '') + '|' + (a.caption || '')).join(',');
      return [i.id, i.completed ? 1 : 0, i.updated_at || '', attSig].join('|');
    }).join(';');
  };

  const refresh = async (opts = {}) => {
    await Promise.all([loadConfig(), loadRoundsList()]);
    if (state.currentRound) {
      await loadRound(state.currentRound);
    } else {
      await loadActiveRound();
    }
    await maybeAdvanceRound();
    state.lastSig = roundSignature(state.roundData);
    renderAll();
    updateSoundBadge();
  };

  // Compute "today's" round key the same way the backend does — a shift that
  // starts at/after 12:00 belongs to that calendar date; before 12:00 belongs
  // to the previous date.
  const todaysRoundKey = () => {
    const d = new Date();
    if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };

  const maybeAdvanceRound = async () => {
    if (state.userPickedRound) return false;
    const items = state.roundData?.items || [];
    if (!items.length) return false;
    const allDone = items.every(i => i.completed);
    if (!allDone) return false;

    // Don't auto-advance past the present — if the user is already on today's
    // round and finished everything, just stay (the "All clear" banner shows).
    const today = todaysRoundKey();
    if (state.currentRound >= today) return false;

    // Pick the next round chronologically that has at least one open item.
    const nextRound = [...state.rounds]
      .sort((a, b) => strcmpKey(a.round, b.round))
      .find(r => r.round > state.currentRound && r.total > r.completed);
    if (nextRound) {
      state.currentRound = nextRound.round;
      await loadRound(nextRound.round);
      return true;
    }
    // Fallback: jump to today's round if it exists in the list
    const todayRound = state.rounds.find(r => r.round === today);
    if (todayRound) {
      state.currentRound = today;
      await loadRound(today);
      return true;
    }
    return false;
  };

  const strcmpKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // Silent realtime poll — no full re-render unless data actually changed
  const poll = async () => {
    if (state.pollPaused) return;
    if (document.hidden) return;
    if (!state.currentRound) return;
    try {
      const r = await API.pwSchedule.round(state.currentRound);
      const data = r?.data?.data;
      if (!data) return;
      const sig = roundSignature(data);
      if (sig === state.lastSig) {
        markLive();
        return;
      }
      state.roundData = data;
      state.lastSig = sig;

      // After applying the polled data, refresh rounds summary so the dropdown
      // and counts stay in sync — and decide whether to auto-advance to the
      // next round if everything just got completed.
      try {
        await loadRoundsList();
        const advanced = await maybeAdvanceRound();
        if (advanced) state.lastSig = roundSignature(state.roundData);
      } catch {}

      renderAll();
      markLive();
    } catch { /* silent */ }
  };

  const markLive = () => {
    const el = $('pw-live-dot');
    if (!el) return;
    el.classList.remove('stale');
    el.textContent = 'Live';
    clearTimeout(markLive._t);
    markLive._t = setTimeout(() => {
      el.classList.add('stale');
      el.textContent = 'Reconnecting…';
    }, 30000);
  };

  // ─── Lightbox ─────────────────────────────────────────────────
  const openLightbox = (url) => {
    $('pw-lb-img').src = url;
    $('pw-lb-wrap').classList.add('open');
  };
  const closeLightbox = () => {
    $('pw-lb-wrap').classList.remove('open');
    $('pw-lb-img').src = '';
  };

  // ─── Wiring ───────────────────────────────────────────────────
  const bindEvents = () => {
    $('pw-btn-add').addEventListener('click', () => openModal(null));
    $('pw-btn-notify').addEventListener('click', sendNoti);
    $('pw-btn-sync').addEventListener('click', syncFromSheet);
    $('pw-f-cancel').addEventListener('click', closeModal);
    $('pw-f-save').addEventListener('click', saveForm);
    $('pw-f-delete').addEventListener('click', () => state.editingId && deleteItem(state.editingId));
    $('pw-btn-enable-noti').addEventListener('click', askNotifPerm);
    $('pw-btn-test-sound').addEventListener('click', async () => {
      if (!state.config.sound_enabled) {
        toast('Admin ปิดเสียงไว้ ปรับได้ที่ admin/pw-schedule.html', 'info');
        return;
      }
      await ensureAudio();
      updateSoundBadge();
      if (!audioUnlocked) {
        toast('Browser ยังบล็อกเสียง — ลองคลิกที่อื่นบนหน้าก่อน', 'error');
        return;
      }
      beep(true);
    });

    // attachments
    $('pw-f-att-file').addEventListener('change', (e) => {
      handleAttachFiles(e.target.files);
      e.target.value = '';
    });
    $('pw-f-att-note').addEventListener('click', addNote);
    $('pw-f-atts').addEventListener('click', (e) => {
      const rm = e.target.dataset?.attRm;
      if (rm == null) return;
      const i = Number(rm);
      if (state.formAttachments[i]) {
        state.formAttachments.splice(i, 1);
        renderFormAttachments();
      }
    });
    $('pw-f-atts').addEventListener('input', (e) => {
      const cap = e.target.dataset?.attCap;
      if (cap == null) return;
      const i = Number(cap);
      if (state.formAttachments[i]) state.formAttachments[i].caption = e.target.value;
    });

    // Paste image from clipboard while modal is open (Ctrl/Cmd+V)
    $('pw-modal-wrap').addEventListener('paste', (e) => {
      // Only handle when modal is open
      if (!$('pw-modal-wrap').classList.contains('open')) return;
      const items = (e.clipboardData || window.clipboardData)?.items || [];
      const files = [];
      for (const it of items) {
        if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        handleAttachFiles(files);
      }
    });

    // radio group
    document.querySelectorAll('#pw-radio-type .pw-radio').forEach(r => {
      r.addEventListener('click', () => {
        document.querySelectorAll('#pw-radio-type .pw-radio').forEach(x => x.classList.remove('active'));
        r.classList.add('active');
      });
    });

    // round select
    $('pw-round-select').addEventListener('change', async (e) => {
      state.userPickedRound = true;
      await loadRound(e.target.value);
      state.lastSig = roundSignature(state.roundData);
      renderAll();
    });

    // backdrop close
    $('pw-modal-wrap').addEventListener('click', (e) => {
      if (e.target.id === 'pw-modal-wrap') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if ($('pw-lb-wrap').classList.contains('open')) closeLightbox();
        else if ($('pw-modal-wrap').classList.contains('open')) closeModal();
      }
    });

    // Lightbox
    $('pw-lb-close').addEventListener('click', closeLightbox);
    $('pw-lb-wrap').addEventListener('click', (e) => {
      if (e.target.id === 'pw-lb-wrap') closeLightbox();
    });

    // delegated task-list clicks
    $('pw-list').addEventListener('click', (e) => {
      const lb = e.target.closest('[data-lb]');
      if (lb) { e.preventDefault(); openLightbox(lb.dataset.lb); return; }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'toggle')  toggleItem(id);
      if (action === 'delete')  deleteItem(id);
      if (action === 'edit') {
        const item = (state.roundData?.items || []).find(i => i.id === id);
        if (item) openModal(item);
      }
    });

    // visibility — pause/resume polling
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll();
    });
  };

  const init = async () => {
    bindEvents();
    installAudioUnlock();
    await refresh();
    updateSoundBadge();
    // tick every 20s for countdown + lead-time noti
    state.tickHandle = setInterval(tick, 20000);
    tick();
    // realtime polling — every 10s
    state.pollHandle = setInterval(poll, 10000);
    markLive();
    // Auto-sync from Google Sheet once on page open. Runs after `refresh()`
    // so state.config.has_n8n_sync is populated; silent if admin hasn't
    // configured an n8n webhook yet.
    if (state.config.has_n8n_sync) {
      // Log so it's obvious in devtools that the auto-sync fired.
      console.info('[pw-schedule] Auto-syncing from Google Sheet…');
      // Fire-and-forget; syncFromSheet already surfaces errors via toast.
      syncFromSheet({ auto: true });
    } else {
      console.info('[pw-schedule] Skipping auto-sync — n8n sync webhook not configured (admin/pw-schedule.html).');
    }
  };

  // Read-only accessor used by inline scripts (e.g. the Template modal in
  // pw-schedule.html needs to enumerate PWs in the currently-loaded round).
  const __peekRoundData = () => state.roundData;

  return { init, refresh, __peekRoundData };
})();
