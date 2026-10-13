// pw-schedule — page script, extracted from pw-schedule.html.
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
Layout.render('pw-schedule');

// Reveal manage CTAs (add/sync/notify/etc) only for SM members or raw super_admin.
// pw_schedule.json is SM-shared — non-SM teams granted `pw-schedule` can view
// the same rounds SM curates, but not mutate them. View-as aware: super_admin
// previewing team X gets the X experience (buttons hidden).
(function () {
  const u = Auth.getUser?.();
  if (!u) return;
  const viewAs = Auth._getViewAsTeam?.() || null;
  const effectiveTeam = viewAs?.slug || u.team;
  const isRawSuper    = u.role === 'super_admin' && !viewAs;
  if (effectiveTeam === 'sm' || isRawSuper) {
    document.querySelectorAll('.pw-manage').forEach(b => b.style.display = '');
  }
})();
trackScheduleView('pw_schedule');
PW.init();

// ── Cron Builder modal ───────────────────────────────
(function() {
  const btn      = document.getElementById('pw-btn-cron');
  const backdrop = document.getElementById('cron-modal-backdrop');
  const frame    = document.getElementById('cron-modal-frame');
  const close    = document.getElementById('cron-modal-close');

  btn.addEventListener('click', () => {
    if (!frame.getAttribute('src')) {
      frame.src = 'cron-builder.html?embed';
    }
    backdrop.classList.add('open');
  });

  close.addEventListener('click', () => backdrop.classList.remove('open'));

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) {
      backdrop.classList.remove('open');
    }
  });
})();

// ── Template modal (📢 แจ้งเพื่อทราบ) ───────────────
(function() {
  const wrap    = document.getElementById('pw-tpl-wrap');
  const btnOpen = document.getElementById('pw-btn-template');
  const btnX    = document.getElementById('pw-tpl-cancel');
  const btnCopy = document.getElementById('pw-tpl-copy');
  const btnSend = document.getElementById('pw-tpl-send');
  const pick    = document.getElementById('pw-tpl-pick');
  const txt     = document.getElementById('pw-tpl-text');
  const status  = document.getElementById('pw-tpl-status');
  const whInfo  = document.getElementById('pw-tpl-webhook-info');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const setStatus = (msg, kind = 'info') => {
    const color = kind === 'err' ? '#dc2626'
                : kind === 'ok'  ? '#16a34a'
                : 'var(--text-muted)';
    status.style.color = color;
    status.textContent = msg || '';
  };

  const closeModal = () => {
    wrap.classList.remove('open');
  };

  const open = async () => {
    // Populate PW picker from the current round in PW state.
    // (Uses the read-only view of PW.state via a small accessor.)
    const roundData = (PW && PW.__peekRoundData && PW.__peekRoundData()) || null;
    const items = roundData?.items || [];
    pick.innerHTML = '<option value="">— เลือก PW —</option>' +
      items.map(i => `<option value="${esc(i.id)}">${esc(i.pw_name || '(untitled)')}</option>`).join('');
    txt.value = '';
    btnSend.disabled = true;
    setStatus(items.length ? 'เลือก PW ก่อน แล้วระบบจะร่างข้อความให้' : 'ไม่มี PW ในรอบนี้');
    whInfo.textContent = 'ยิงเข้าห้อง Google Chat ที่ตั้งไว้ใน admin/pw-schedule.html';
    wrap.classList.add('open');
  };

  const build = async (itemId) => {
    if (!itemId) { txt.value = ''; btnSend.disabled = true; setStatus(''); return; }
    setStatus('กำลังสร้าง Template…');
    btnSend.disabled = true;
    const r = await API.pwSchedule.buildTemplate(itemId);
    if (!r?.ok) {
      setStatus(r?.data?.message || 'สร้าง Template ไม่สำเร็จ', 'err');
      return;
    }
    const d = r.data?.data || {};
    txt.value = d.message || '';
    btnSend.disabled = !d.message;
    if ((d.ma_lines || []).length) {
      setStatus(`ดึงรายการ MA จาก ${d.ticket?.key || 'ticket'} สำเร็จ (${d.ma_lines.length} รายการ) — แก้ได้ก่อน Send`, 'ok');
    } else if (d.jira_note === 'no-ticket') {
      setStatus('PW นี้ยังไม่มี ticket reference — โปรดแก้รายการ MA ในกล่องด้านล่างเอง', 'info');
    } else if (d.jira_note === 'no-creds') {
      setStatus('Jira credentials ยังไม่ตั้งค่า (.env) — โปรดแก้รายการ MA เอง', 'info');
    } else if (d.jira_note === 'fetch-failed') {
      setStatus(`ดึง ${d.ticket?.key || 'ticket'} ไม่ได้ — โปรดแก้รายการ MA เอง`, 'err');
    } else {
      setStatus(`หา section "รายการ MA" ใน ${d.ticket?.key || 'ticket'} ไม่พบ — โปรดแก้เอง`, 'info');
    }
  };

  const copy = async () => {
    if (!txt.value) return;
    try {
      await navigator.clipboard.writeText(txt.value);
      if ((typeof Toast !== 'undefined') && Toast?.success) Toast.success('Copied');
    } catch {
      txt.select();
      try { document.execCommand('copy'); if ((typeof Toast !== 'undefined') && Toast?.success) Toast.success('Copied'); }
      catch { if ((typeof Toast !== 'undefined') && Toast?.error) Toast.error('Copy failed'); }
    }
  };

  const send = async () => {
    const itemId = pick.value;
    const message = (txt.value || '').trim();
    if (!message) { setStatus('ข้อความว่าง', 'err'); return; }
    const ok = await confirmDialog(
      `ส่งข้อความนี้ไปยังห้อง Google Chat ที่ตั้งไว้ใน admin/pw-schedule.html?`,
      { title: 'ยืนยันการส่ง', confirmText: '<i data-icon=\"rocket\"></i> Send', cancelText: 'ยกเลิก' }
    );
    if (!ok) return;
    btnSend.disabled = true;
    const orig = btnSend.textContent;
    btnSend.textContent = 'Sending…';
    const r = await API.pwSchedule.notifyText(message, itemId);
    btnSend.textContent = orig;
    btnSend.disabled = false;
    if (!r?.ok) {
      setStatus(r?.data?.message || 'Send failed', 'err');
      return;
    }
    if ((typeof Toast !== 'undefined') && Toast?.success) Toast.success('ส่งไปยัง Google Chat แล้ว');
    closeModal();
  };

  btnOpen.addEventListener('click', open);
  btnX.addEventListener('click', closeModal);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrap.classList.contains('open')) closeModal();
  });
  pick.addEventListener('change', (e) => build(e.target.value));
  btnCopy.addEventListener('click', copy);
  btnSend.addEventListener('click', send);
})();

// ─────────────────────────────────────────────────────────────────
// Reflect `pw-progress-text` (updated by pw-schedule.js) into the
// hero + section progress bars. This avoids touching the shared JS.
// ─────────────────────────────────────────────────────────────────
(() => {
  const src        = document.getElementById('pw-progress-text');
  const heroFill   = document.getElementById('pw-hero-progress-fill');
  const heroTxt    = document.getElementById('pw-hero-progress-txt');
  const sectFill   = document.getElementById('pw-section-progress-fill');
  if (!src) return;
  const apply = () => {
    const txt = (src.textContent || '').trim();
    if (heroTxt) heroTxt.textContent = txt || '0 / 0 done';
    const m = txt.match(/^(\d+)\s*\/\s*(\d+)/);
    let pct = 0;
    if (m) {
      const done = +m[1], total = +m[2];
      pct = total > 0 ? Math.round((done / total) * 100) : 0;
    }
    if (heroFill) heroFill.style.width = pct + '%';
    if (sectFill) sectFill.style.width = pct + '%';
  };
  apply();
  new MutationObserver(apply).observe(src, { childList: true, characterData: true, subtree: true });
})();

// ─────────────────────────────────────────────────────────────────
// Tab switching + Teamup Calendar view
// ─────────────────────────────────────────────────────────────────
(() => {
  const $  = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'data') Object.assign(n.dataset, v);
      else n.setAttribute(k, v);
    }
    for (const c of kids) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };
  const icon = (name) => el('i', { 'data-icon': name });

  const monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
  const dowShort   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Pastel palette · blocks.so-inspired. Each entry = {bg, border, text}.
  // Curated so ADJACENT entries jump across the hue wheel — this maximizes
  // visual distinction when a calendar has many subcalendars sorted by name.
  const PASTEL = [
    { bg:'#fecdd3', border:'#fb7185', text:'#9f1239' }, // 0 rose
    { bg:'#bbf7d0', border:'#4ade80', text:'#14532d' }, // 1 green
    { bg:'#bfdbfe', border:'#60a5fa', text:'#1e3a8a' }, // 2 blue
    { bg:'#fed7aa', border:'#fb923c', text:'#9a3412' }, // 3 orange
    { bg:'#ddd6fe', border:'#a78bfa', text:'#4c1d95' }, // 4 violet
    { bg:'#99f6e4', border:'#2dd4bf', text:'#115e59' }, // 5 teal
    { bg:'#f5d0fe', border:'#e879f9', text:'#701a75' }, // 6 pink
    { bg:'#fde68a', border:'#fbbf24', text:'#78350f' }, // 7 amber
    { bg:'#c7d2fe', border:'#818cf8', text:'#312e81' }, // 8 indigo
    { bg:'#e2e8f0', border:'#94a3b8', text:'#334155' }, // 9 slate (neutral)
  ];
  const FALLBACK = PASTEL[9];

  // Index-based lookup. `rebuildSubcalMap` sorts subcalendars alphabetically
  // and assigns paletteIndex = position mod PASTEL.length. This guarantees
  // that adjacent subcalendars in the legend get MAX hue distance instead of
  // whatever a hash function happened to collide on.
  const pastelByIndex = (idx) => PASTEL[((idx % PASTEL.length) + PASTEL.length) % PASTEL.length];

  const state = {
    view: new Date(),
    events: [],
    subcalendars: [],       // [{id, name, color_id}] from server
    subcalMap: new Map(),   // id → {name, color, palette}
    counts: new Map(),      // id → int (visible in current window)
    filter: new Set(),      // subcalendar ids to hide (empty = show all)
    lastFetch: null,
    loading: false,
    activated: false,
    error: null,
  };

  const rebuildSubcalMap = () => {
    state.subcalMap.clear();
    // Sort by name so palette index is stable per name (adding/removing a
    // subcalendar in the middle of the alphabet will shift things, which is
    // acceptable and matches how users read the legend).
    const sorted = [...state.subcalendars].sort((a, b) =>
      (a.name || '').localeCompare(b.name || ''));
    sorted.forEach((sc, idx) => {
      state.subcalMap.set(String(sc.id), {
        name:    sc.name,
        colorId: sc.color_id,
        palette: pastelByIndex(idx),
      });
    });
  };
  const paletteForEvent = (ev) => {
    const info = state.subcalMap.get(String(ev.subcalendar_id));
    if (info) return info.palette;
    // Event without a matching subcalendar entry — hash id → palette so it's
    // still stable across renders.
    const id = String(ev.subcalendar_id || '');
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return id ? pastelByIndex(h) : FALLBACK;
  };
  const nameForEvent = (ev) => {
    const info = state.subcalMap.get(String(ev.subcalendar_id));
    return info ? info.name : (ev.subcalendar_id ? 'Cal ' + ev.subcalendar_id : 'Uncategorized');
  };

  const refreshIcons = (root) => {
    if (window.Icons?.replaceAll) window.Icons.replaceAll(root || document);
  };

  // ── Tab switching ──────────────────────────────────────────────
  const roundBtn = $('pw-tab-btn-round');
  const calBtn   = $('pw-tab-btn-calendar');
  const roundPnl = $('pw-tab-round');
  const calPnl   = $('pw-tab-calendar');

  const setTab = (which) => {
    const isCal = which === 'calendar';
    roundBtn.classList.toggle('active', !isCal);
    calBtn.classList.toggle('active', isCal);
    roundPnl.style.display = isCal ? 'none' : '';
    calPnl.style.display   = isCal ? 'flex' : 'none';
    if (isCal && !state.activated) {
      state.activated = true;
      load();
    }
  };
  roundBtn.addEventListener('click', () => setTab('round'));
  calBtn.addEventListener('click',   () => setTab('calendar'));

  // ── Nav ────────────────────────────────────────────────────────
  $('pw-cal-prev').addEventListener('click', () => {
    state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1);
    load();
  });
  $('pw-cal-next').addEventListener('click', () => {
    state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1);
    load();
  });
  $('pw-cal-today').addEventListener('click', () => {
    state.view = new Date();
    load();
  });
  $('pw-cal-refresh').addEventListener('click', () => load(true));

  // ── Fetch + render ─────────────────────────────────────────────
  async function load(force = false) {
    if (state.loading) return;
    state.loading = true;
    state.error   = null;

    const y = state.view.getFullYear();
    const m = state.view.getMonth();
    const first = new Date(y, m, 1);
    const last  = new Date(y, m + 1, 0);
    const start = ymd(first);
    const end   = ymd(last);

    $('pw-cal-title').textContent = `${monthNames[m]} ${y}`;
    $('pw-cal-body').innerHTML = '';
    const loader = el('div', { class: 'pw-cal-empty', id: 'pw-cal-loading' },
      icon('calendar'),
      el('div', { class: 'pw-cal-empty-title' }, force ? 'Refreshing from Teamup…' : 'Loading…')
    );
    $('pw-cal-body').appendChild(loader);
    refreshIcons(loader);
    $('pw-cal-legend-mount').innerHTML = '';

    try {
      const res = await API.pwSchedule.teamup(start, end, force);
      if (!res?.ok) {
        const msg = res?.data?.message || `HTTP ${res?.status || '?'}`;
        throw new Error(msg);
      }
      const data = res.data?.data || {};
      state.events       = Array.isArray(data.events) ? data.events : [];
      state.subcalendars = Array.isArray(data.subcalendars) ? data.subcalendars : [];
      rebuildSubcalMap();
      state.lastFetch = {
        start, end,
        cached_at:  data.cached_at,
        from_cache: !!data.from_cache,
        stale:      !!data.stale,
        mode:       data.mode,
      };
      render();
    } catch (e) {
      state.error = e.message || String(e);
      renderError();
    } finally {
      state.loading = false;
    }
  }

  function renderError() {
    const body = $('pw-cal-body');
    body.innerHTML = '';
    $('pw-cal-legend-mount').innerHTML = '';
    const isConfig = /not configured|Invalid Teamup calendar key/i.test(state.error || '');
    const box = el('div', { class: 'pw-cal-empty' },
      icon('alert-triangle'),
      el('div', { class: 'pw-cal-empty-title' },
        isConfig ? 'Teamup ยังไม่ถูกตั้งค่า' : 'ดึงจาก Teamup ไม่สำเร็จ'),
      el('div', { style: 'font-size:12px;max-width:520px;margin:0 auto' }, state.error || ''),
      isConfig
        ? el('a', { href: 'admin/pw-schedule.html', class: 'pw-cal-btn primary', style: 'display:inline-flex;margin-top:14px;text-decoration:none' },
            el('span', {}, 'ตั้งค่าใน Admin'), icon('chevron-right'))
        : el('button', { class: 'pw-cal-btn', style: 'margin-top:14px', onclick: () => load(true) },
            icon('refresh-cw'), el('span', {}, 'Try again'))
    );
    body.appendChild(box);
    refreshIcons(box);
    $('pw-cal-meta-txt').textContent = '—';
  }

  function render() {
    const body = $('pw-cal-body');
    body.innerHTML = '';

    // Compute per-subcalendar counts for the current window (before filter)
    state.counts.clear();
    for (const ev of state.events) {
      const k = String(ev.subcalendar_id || '');
      state.counts.set(k, (state.counts.get(k) || 0) + 1);
    }

    // Meta line
    const meta = state.lastFetch || {};
    const stamp = meta.cached_at ? new Date(meta.cached_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const cacheTag = meta.from_cache ? (meta.stale ? ' · stale' : ' · cached') : ' · fresh';
    $('pw-cal-meta-txt').textContent =
      `${state.events.length} events${stamp ? ' · ' + stamp : ''}${cacheTag}`;

    renderLegend();

    // Grid header
    const grid = el('div', { class: 'pw-cal-grid' });
    for (const d of dowShort) {
      grid.appendChild(el('div', { class: 'pw-cal-dowhead' }, d));
    }

    // Bucket events by YYYY-MM-DD (using local date of start)
    const buckets = new Map();
    for (const ev of state.events) {
      const s = new Date(ev.start);
      if (isNaN(s)) continue;
      const e = new Date(ev.end || ev.start);
      const oneDay = 24 * 60 * 60 * 1000;
      let cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const endDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());
      const endsAtMidnight = !ev.all_day && e.getHours() === 0 && e.getMinutes() === 0 && e > s;
      const cap = endsAtMidnight ? new Date(endDay.getTime() - oneDay) : endDay;
      let guard = 0;
      while (cur <= cap && guard++ < 400) {
        const key = ymd(cur);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(ev);
        cur = new Date(cur.getTime() + oneDay);
      }
    }

    const y = state.view.getFullYear();
    const m = state.view.getMonth();
    const first = new Date(y, m, 1);
    const dow = (first.getDay() + 6) % 7; // Mon=0..Sun=6
    const gridStart = new Date(y, m, 1 - dow);
    const today = new Date();
    const todayKey = ymd(today);

    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getTime() + i * 86400000);
      const inMonth  = d.getMonth() === m;
      const isToday  = ymd(d) === todayKey;
      const dowIdx   = (d.getDay() + 6) % 7;
      const isWeekend = dowIdx >= 5;

      const cell = el('div', {
        class: 'pw-cal-cell'
             + (inMonth ? '' : ' other-month')
             + (isToday ? ' today' : '')
             + (isWeekend ? ' weekend' : ''),
      });
      cell.appendChild(el('div', { class: 'pw-cal-daynum' }, String(d.getDate())));

      const evs = buckets.get(ymd(d)) || [];
      const box = el('div', { class: 'pw-cal-events' });
      const MAX = 3;
      const shown = evs.slice(0, MAX);
      for (const ev of shown) {
        box.appendChild(makeChip(ev));
      }
      if (evs.length > MAX) {
        box.appendChild(el('div', {
          class: 'pw-cal-more',
          onclick: () => openDayList(d, evs),
        }, `+${evs.length - MAX} more`));
      }
      cell.appendChild(box);
      grid.appendChild(cell);
    }

    body.appendChild(grid);
    refreshIcons(body);
  }

  function makeChip(ev) {
    const p = paletteForEvent(ev);
    const isMuted = state.filter.size > 0 && state.filter.has(String(ev.subcalendar_id));
    const chip = el('div', {
      class: 'pw-cal-ev' + (isMuted ? ' dim' : ''),
      style: `background:${p.bg};color:${p.text};border-color:${p.border}`,
      title: ev.title + (state.subcalMap.get(String(ev.subcalendar_id))?.name
        ? ' · ' + state.subcalMap.get(String(ev.subcalendar_id)).name : ''),
      onclick: (e) => { e.stopPropagation(); openDetail(ev); },
    });
    if (!ev.all_day) {
      const sd = new Date(ev.start);
      chip.appendChild(el('span', { class: 'pw-cal-ev-time' },
        `${pad(sd.getHours())}:${pad(sd.getMinutes())}`));
    }
    chip.appendChild(el('span', { class: 'pw-cal-ev-title' }, ev.title));
    return chip;
  }

  function renderLegend() {
    const mount = $('pw-cal-legend-mount');
    mount.innerHTML = '';

    // Build list of subcalendars actually present in the current window,
    // sorted by name. If server didn't return subcalendars, derive from events.
    const used = new Set(Array.from(state.counts.keys()).filter(k => k));
    if (!used.size) return;

    const items = [];
    for (const id of used) {
      const info = state.subcalMap.get(id);
      items.push({
        id,
        name:  info ? info.name : ('Cal ' + id),
        palette: info ? info.palette : paletteForEvent({ subcalendar_id: id }),
        count: state.counts.get(id) || 0,
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));

    const bar = el('div', { class: 'pw-cal-legend' },
      el('div', { class: 'pw-cal-legend-head' }, icon('palette'), el('span', {}, 'Calendars'))
    );
    for (const it of items) {
      const isMuted = state.filter.has(it.id);
      const chip = el('button', {
        class: 'pw-cal-legend-chip' + (isMuted ? ' muted' : ''),
        style: `background:${it.palette.bg};color:${it.palette.text};border-color:${it.palette.border}`,
        title: isMuted ? 'Click to show' : 'Click to hide',
        onclick: () => {
          if (state.filter.has(it.id)) state.filter.delete(it.id);
          else                          state.filter.add(it.id);
          renderLegend();
          reapplyMute();
        },
      },
        el('span', { class: 'pw-cal-legend-dot', style: `background:${it.palette.border}` }),
        el('span', {}, it.name),
        el('span', { class: 'pw-cal-legend-count' }, String(it.count))
      );
      bar.appendChild(chip);
    }

    if (state.filter.size) {
      bar.appendChild(el('button', {
        class: 'pw-cal-btn',
        style: 'margin-left:auto;font-size:11px;padding:5px 10px',
        onclick: () => { state.filter.clear(); renderLegend(); reapplyMute(); },
      }, 'Show all'));
    }

    mount.appendChild(bar);
    refreshIcons(bar);
  }

  // Mute filtered chips in place without re-rendering the whole grid
  function reapplyMute() {
    document.querySelectorAll('.pw-cal-ev').forEach(chip => chip.remove());
    // Simpler + safer: full re-render is cheap for a month.
    render();
  }

  // ── Detail popover ─────────────────────────────────────────────
  const detailWrap  = $('pw-cal-detail-wrap');
  const detailBody  = $('pw-cal-detail-body');
  const detailTitle = $('pw-cal-detail-title');
  const detailBadge = $('pw-cal-detail-badge');
  const detailDot   = $('pw-cal-detail-dot');
  const detailCal   = $('pw-cal-detail-cal');

  const closeDetail = () => detailWrap.classList.remove('show');
  $('pw-cal-detail-close').addEventListener('click', closeDetail);
  detailWrap.addEventListener('click', (e) => { if (e.target === detailWrap) closeDetail(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailWrap.classList.contains('show')) closeDetail();
  });

  const fmtRange = (ev) => {
    const s = new Date(ev.start);
    const e = new Date(ev.end || ev.start);
    if (isNaN(s)) return '—';
    const sameDay = s.toDateString() === e.toDateString();
    const dOpt = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    const tOpt = { hour: '2-digit', minute: '2-digit' };
    if (ev.all_day) {
      return sameDay
        ? s.toLocaleDateString('en-GB', dOpt) + ' (all day)'
        : `${s.toLocaleDateString('en-GB', dOpt)} → ${e.toLocaleDateString('en-GB', dOpt)}`;
    }
    return sameDay
      ? `${s.toLocaleDateString('en-GB', dOpt)}, ${s.toLocaleTimeString('en-GB', tOpt)} → ${e.toLocaleTimeString('en-GB', tOpt)}`
      : `${s.toLocaleString('en-GB', {...dOpt, ...tOpt})} → ${e.toLocaleString('en-GB', {...dOpt, ...tOpt})}`;
  };

  function openDetail(ev) {
    const p = paletteForEvent(ev);
    detailBadge.style.background = p.bg;
    detailBadge.style.color      = p.text;
    detailDot.style.background   = p.border;
    detailCal.textContent        = nameForEvent(ev);
    detailTitle.textContent      = ev.title || '(untitled)';

    const rows = [];
    rows.push(['clock',      'When',     fmtRange(ev)]);
    if (ev.who)            rows.push(['user',      'Who',      ev.who]);
    if (ev.location)       rows.push(['map-pin',   'Location', ev.location]);
    if (ev.custom && typeof ev.custom === 'object' && !Array.isArray(ev.custom)) {
      for (const [k, v] of Object.entries(ev.custom)) {
        if (v == null || v === '') continue;
        const label = k.replace(/^ur_+/, '').replace(/_/g, ' ') || k;
        rows.push(['tag', label.charAt(0).toUpperCase() + label.slice(1), String(v)]);
      }
    }
    if (ev.notes)          rows.push(['info',      'Notes',    ev.notes]);

    detailBody.innerHTML = '';
    for (const [ic, label, value] of rows) {
      const row = el('div', { class: 'pw-cal-detail-row' },
        el('div', { class: 'pw-cal-detail-label' }, icon(ic), el('span', {}, label)),
        el('div', { class: 'pw-cal-detail-value' }, value)
      );
      detailBody.appendChild(row);
    }
    detailWrap.classList.add('show');
    refreshIcons(detailWrap);
  }

  function openDayList(date, evs) {
    detailBadge.style.background = 'var(--bg)';
    detailBadge.style.color      = 'var(--text-muted)';
    detailDot.style.background   = 'var(--text-muted)';
    detailCal.textContent        = `${evs.length} events`;
    detailTitle.textContent = date.toLocaleDateString('en-GB',
      { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    detailBody.innerHTML = '';
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    for (const ev of evs) {
      const p = paletteForEvent(ev);
      const row = el('button', {
        class: 'pw-cal-ev',
        style: `background:${p.bg};color:${p.text};border-color:${p.border};text-align:left;padding:8px 12px;font-size:12px`,
        onclick: () => openDetail(ev),
      });
      if (!ev.all_day) {
        const sd = new Date(ev.start);
        row.appendChild(el('span', { class: 'pw-cal-ev-time' },
          `${pad(sd.getHours())}:${pad(sd.getMinutes())} `));
      }
      row.appendChild(el('span', { class: 'pw-cal-ev-title' }, ev.title));
      list.appendChild(row);
    }
    detailBody.appendChild(list);
    detailWrap.classList.add('show');
  }
})();

})();
