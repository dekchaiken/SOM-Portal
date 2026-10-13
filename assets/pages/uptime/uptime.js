// uptime — page script, extracted from uptime.html.
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

Auth.requireAuth();
  Layout.render('uptime');

  const user    = Auth.getUser();
  const isAdmin = ['super_admin', 'sm_admin', 'dev_sm'].includes(user?.role);

  let checkTimer   = null;
  let refreshTimer = null;
  let lastData     = [];

  // ── Formatting helpers ───────────────────────────────────────────────────────

  function fmtTime(unixTs) {
    if (!unixTs) return '—';
    return new Date(unixTs * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('th-TH', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch { return iso; }
  }

  function fmtPct(val) {
    if (val === null || val === undefined) return '—';
    const n = parseFloat(val);
    const cls = n >= 99 ? 'good' : n >= 95 ? '' : n >= 80 ? 'warn' : 'bad';
    return `<span class="uc-stat-val ${cls}">${n.toFixed(2)}%</span>`;
  }

  function fmtLatency(ms) {
    if (ms === null || ms === undefined) return '<span class="uc-stat-val">—</span>';
    const cls = ms < 1000 ? 'good' : ms < 3000 ? 'warn' : 'bad';
    return `<span class="uc-stat-val ${cls}">${ms.toLocaleString()} ms</span>`;
  }

  // ── Build bar chart ──────────────────────────────────────────────────────────

  function buildBars(history) {
    // Pad to 60 entries (newest on right)
    const padded = [];
    for (let i = 0; i < 60; i++) padded.push(null);
    const start = Math.max(0, history.length - 60);
    for (let i = start; i < history.length; i++) {
      padded[60 - history.length + i] = history[i];
    }

    return padded.map(h => {
      if (!h) return `<div class="uc-bar none" data-bar-tip="ไม่มีข้อมูล"></div>`;

      const time   = fmtTime(h.ts);
      const latMs  = h.latency;
      let cls, label;

      if (!h.up) {
        cls   = 'down';
        label = `ขัดข้อง`;
      } else if (latMs >= 3000) {
        cls   = 'slow';
        label = `ช้า (${latMs.toLocaleString()} ms)`;
      } else {
        cls   = 'up';
        label = `ปกติ (${latMs.toLocaleString()} ms)`;
      }

      const tip = `${time}\n${label}${h.code ? '\nHTTP ' + h.code : ''}`;
      return `<div class="uc-bar ${cls}" data-bar-tip="${tip}"></div>`;
    }).join('');
  }

  // ── Render axis times ────────────────────────────────────────────────────────

  function buildAxis(history) {
    const oldest = history.length > 0 ? history[Math.max(0, history.length - 60)] : null;
    const leftLabel  = oldest ? fmtTime(oldest.ts) : '—';
    const rightLabel = 'ตอนนี้';
    return `<span>${leftLabel}</span><span>${rightLabel}</span>`;
  }

  // ── Render all cards ─────────────────────────────────────────────────────────

  function renderAll(monitors) {
    lastData = monitors;
    const grid = document.getElementById('uptime-grid');

    if (!monitors.length) {
      grid.innerHTML = `<div class="uptime-empty"><div class="big"><i data-icon="satellite"></i></div><div>ยังไม่มี URL ที่ Monitor</div></div>`;
      return;
    }

    grid.className = `uptime-grid ${isAdmin ? 'is-admin' : ''}`;
    grid.innerHTML = monitors.map(m => renderCard(m)).join('');
  }

  function renderCard(m) {
    const isUp      = m.is_up;
    const dotCls    = isUp === null ? '' : isUp ? 'up' : 'down';
    const statusTxt = isUp === null ? 'กำลังตรวจสอบ...' : isUp ? 'ระบบทำงานปกติ' : 'ระบบขัดข้อง!';
    const statusCls = isUp === false ? 'down' : '';
    const cardCls   = isUp === false ? 'is-down' : '';

    return `
    <div class="uptime-card ${cardCls}" id="card-${m.id}">
      <div class="uc-header">
        <div class="uc-title">
          <div class="uc-dot ${dotCls}"></div>
          ${escHtml(m.name)}
        </div>
        <button class="uc-delete" title="ลบ Monitor" onclick="deleteMonitor('${m.id}','${escHtml(m.name)}')"><i data-icon="trash"></i></button>
      </div>
      <div class="uc-status-txt ${statusCls}">${statusTxt}</div>
      <div class="uc-updated">อัปเดตล่าสุด ${fmtDateTime(m.last_checked)}</div>

      <div class="uc-stats">
        <div class="uc-stat">
          <div class="uc-stat-label">UPTIME (7วัน)</div>
          ${fmtPct(m.uptime_7d)}
        </div>
        <div class="uc-stat">
          <div class="uc-stat-label">UPTIME (1ชม.)</div>
          ${fmtPct(m.uptime_1h)}
        </div>
        <div class="uc-stat">
          <div class="uc-stat-label">LATENCY เฉลี่ย</div>
          ${fmtLatency(m.latency_avg)}
        </div>
        <div class="uc-stat">
          <div class="uc-stat-label">LATENCY ล่าสุด</div>
          ${fmtLatency(m.latency_last)}
        </div>
      </div>

      <div class="uc-bars-header">
        <div>
          <span class="uc-bars-title">ประวัติ 60 นาทีล่าสุด</span>
          <span class="uc-bars-sub">แต่ละบาร์ = 1 นาที</span>
        </div>
        <div class="uc-legend">
          <span><span class="uc-legend-dot" style="background:#22c55e"></span>ปกติ</span>
          <span><span class="uc-legend-dot" style="background:#f59e0b"></span>ช้า</span>
          <span><span class="uc-legend-dot" style="background:#ef4444"></span>ขัดข้อง</span>
        </div>
      </div>

      <div class="uc-bars">${buildBars(m.history || [])}</div>
      <div class="uc-bars-axis">${buildAxis(m.history || [])}</div>

      <div class="uc-footer">
        <i data-icon="circle"></i> ตรวจสอบโดย n8n ทุก 1 นาที · หน้านี้รีเฟรชทุก 1 นาที
        ${m.url ? `· <a href="${escHtml(m.url)}" target="_blank" style="color:var(--text-muted);text-decoration:none">${escHtml(m.url)}</a>` : ''}
      </div>
    </div>`;
  }

  // ── API calls ────────────────────────────────────────────────────────────────

  async function loadData() {
    const res = await API.get('/uptime/index.php');
    if (res?.ok && Array.isArray(res.data?.data)) {
      renderAll(res.data.data);
    }
  }

  // Manual one-time check (fallback ถ้า n8n ยังไม่ได้ตั้งค่า)
  async function forceRefresh() {
    await API.get('/uptime/check.php');
    await loadData();
  }

  // Regular tick — check แล้วโหลด
  async function tick() {
    await API.get('/uptime/check.php');
    await loadData();
  }

  // ── n8n Config ──────────────────────────────────────────────────────────────

  async function openN8nConfig() {
    const res = await API.get('/uptime/config.php');
    if (!res?.ok) { Toast.error('ไม่สามารถโหลด config ได้'); return; }
    const key = res.data?.data?.push_key || '';
    const base = window.location.origin + window.location.pathname.replace(/\/[^/]+$/, '');
    document.getElementById('cfg-push-url').value = base + '/api/uptime/push.php';
    document.getElementById('cfg-push-key').value = key;
    document.getElementById('n8n-modal').style.display = 'flex';
  }

  function closeN8nModal() {
    document.getElementById('n8n-modal').style.display = 'none';
  }

  function copyVal(id) {
    const el = document.getElementById(id);
    el.select(); el.setSelectionRange(0, 99999);
    try {
      document.execCommand('copy');
      Toast.success('Copied!');
    } catch {
      Toast.error('Copy ไม่ได้ — กด Ctrl+C เอง');
    }
  }

  async function regenKey() {
    if (!await SOMDialog.confirm('Regenerate key?\n\nต้องอัปเดต n8n workflow ด้วยนะครับ', { title: 'ยืนยัน', okLabel: 'Regenerate', icon: 'warning', okColor: 'warning' })) return;
    const res = await API.post('/uptime/config.php', {});
    if (res?.ok) {
      document.getElementById('cfg-push-key').value = res.data?.data?.push_key || '';
      Toast.success('Key ใหม่ถูกสร้างแล้ว');
    }
  }

  // ── Add / Delete ─────────────────────────────────────────────────────────────

  function openModal() {
    document.getElementById('add-name').value = '';
    document.getElementById('add-url').value  = '';
    document.getElementById('add-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('add-name').focus(), 50);
  }

  function closeModal() {
    document.getElementById('add-modal').style.display = 'none';
  }

  async function addMonitor() {
    const name = document.getElementById('add-name').value.trim();
    const url  = document.getElementById('add-url').value.trim();
    if (!name || !url) { Toast.error('กรุณากรอกชื่อและ URL'); return; }

    const res = await API.post('/uptime/index.php', { name, url });
    if (res?.ok) {
      Toast.success('เพิ่ม Monitor เรียบร้อย');
      closeModal();
      await forceRefresh();
    } else {
      Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    }
  }

  async function deleteMonitor(id, name) {
    if (!await SOMDialog.confirm(`ลบ Monitor "${name}" ออกจากระบบ?\n\nประวัติ check ทั้งหมดจะถูกลบด้วย`, { title: 'ยืนยันการลบ', okLabel: 'ลบ', icon: 'danger', okColor: 'danger' })) return;
    const res = await API.delete(`/uptime/index.php?id=${id}`);
    if (res?.ok) {
      Toast.success('ลบเรียบร้อย');
      await loadData();
    } else {
      Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    }
  }

  // ── Keyboard shortcut ────────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && document.getElementById('add-modal').style.display !== 'none') addMonitor();
  });

  // ── Boot ─────────────────────────────────────────────────────────────────────

  (async function init() {
    if (isAdmin) {
      document.getElementById('add-monitor-btn').style.display = '';
      document.getElementById('n8n-config-btn').style.display = '';
    }

    await loadData();

    document.getElementById('live-badge').style.display = 'inline-flex';
    checkTimer = setInterval(tick, 60_000);
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addMonitor", { configurable: true, get: () => addMonitor, set: (v) => { addMonitor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildAxis", { configurable: true, get: () => buildAxis, set: (v) => { buildAxis = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildBars", { configurable: true, get: () => buildBars, set: (v) => { buildBars = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeN8nModal", { configurable: true, get: () => closeN8nModal, set: (v) => { closeN8nModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyVal", { configurable: true, get: () => copyVal, set: (v) => { copyVal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteMonitor", { configurable: true, get: () => deleteMonitor, set: (v) => { deleteMonitor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateTime", { configurable: true, get: () => fmtDateTime, set: (v) => { fmtDateTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtLatency", { configurable: true, get: () => fmtLatency, set: (v) => { fmtLatency = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtPct", { configurable: true, get: () => fmtPct, set: (v) => { fmtPct = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTime", { configurable: true, get: () => fmtTime, set: (v) => { fmtTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "forceRefresh", { configurable: true, get: () => forceRefresh, set: (v) => { forceRefresh = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadData", { configurable: true, get: () => loadData, set: (v) => { loadData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openN8nConfig", { configurable: true, get: () => openN8nConfig, set: (v) => { openN8nConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "regenKey", { configurable: true, get: () => regenKey, set: (v) => { regenKey = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAll", { configurable: true, get: () => renderAll, set: (v) => { renderAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCard", { configurable: true, get: () => renderCard, set: (v) => { renderCard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tick", { configurable: true, get: () => tick, set: (v) => { tick = v; } }); } catch (e) {}
})();
