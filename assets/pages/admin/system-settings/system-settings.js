// admin/system-settings — page script, extracted from admin/system-settings.html.
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

if (!Auth.requireAdmin()) {}
  Layout.render('admin');

  let _dirty = false;
  let _current = {};

  // ── Load ───────────────────────────────────────────────
  async function loadSettings() {
    document.getElementById('settings-loading').style.display = 'block';
    document.getElementById('settings-content').style.display = 'none';

    const res = await API.systemSettings.get();
    if (!res?.ok) { Toast.error('Failed to load settings'); return; }

    _current = res.data.data || {};
    applyToForm(_current);

    document.getElementById('settings-loading').style.display = 'none';
    document.getElementById('settings-content').style.display = 'block';
    setDirty(false);
    updateSessionBadge();
    renderSummary();
  }

  function applyToForm(s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    set('s-site_name',                      s.site_name);
    set('s-site_tagline',                   s.site_tagline);
    set('s-session_timeout_hours',          s.session_timeout_hours);
    set('s-remember_me_days',               s.remember_me_days ?? 30);
    set('s-password_expiry_days',           s.password_expiry_days);
    set('s-password_history_count',         s.password_history_count);
    set('s-max_login_attempts',             s.max_login_attempts);
    set('s-lockout_minutes',                s.lockout_minutes);
    set('s-api_rate_limit_requests',        s.api_rate_limit_requests);
    set('s-api_rate_limit_window_seconds',  s.api_rate_limit_window_seconds);
    set('s-trash_retention_days',           s.trash_retention_days);
    chk('s-enable_markdown',               s.enable_markdown);
    // Webhook URL arrays — one per line
    const asLines = a => Array.isArray(a) ? a.join('\n') : '';
    set('s-email_noti_chat_webhooks',       asLines(s.email_noti_chat_webhooks));
    set('s-exam_reminder_chat_webhooks',    asLines(s.exam_reminder_chat_webhooks));
  }

  function collectForm() {
    const n = id => parseInt(document.getElementById(id)?.value) || 0;
    const s = id => (document.getElementById(id)?.value || '').trim();
    const b = id => !!(document.getElementById(id)?.checked);
    return {
      site_name:                      s('s-site_name'),
      site_tagline:                   s('s-site_tagline'),
      session_timeout_hours:          n('s-session_timeout_hours'),
      remember_me_days:               n('s-remember_me_days') || 30,
      password_expiry_days:           n('s-password_expiry_days'),
      password_history_count:         n('s-password_history_count'),
      max_login_attempts:             n('s-max_login_attempts'),
      lockout_minutes:                n('s-lockout_minutes'),
      api_rate_limit_requests:        n('s-api_rate_limit_requests'),
      api_rate_limit_window_seconds:  n('s-api_rate_limit_window_seconds'),
      trash_retention_days:           n('s-trash_retention_days'),
      enable_markdown:                b('s-enable_markdown'),
      email_noti_chat_webhooks:       linesOf('s-email_noti_chat_webhooks'),
      exam_reminder_chat_webhooks:    linesOf('s-exam_reminder_chat_webhooks'),
    };
  }

  // Split a textarea by newlines, trim, drop empties
  function linesOf(id) {
    const raw = (document.getElementById(id)?.value || '');
    return raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  }

  // ── Save ───────────────────────────────────────────────
  async function saveSettings() {
    const data = collectForm();
    if (!data.site_name) { Toast.warning('Site name cannot be empty'); return; }

    ['save-btn','save-btn2'].forEach(id => document.getElementById(id).disabled = true);
    ['save-spin','save-spin2'].forEach(id => document.getElementById(id).classList.remove('hidden'));
    ['save-text','save-text2'].forEach(id => document.getElementById(id).textContent = 'Saving...');

    const res = await API.systemSettings.save(data);

    ['save-btn','save-btn2'].forEach(id => document.getElementById(id).disabled = false);
    ['save-spin','save-spin2'].forEach(id => document.getElementById(id).classList.add('hidden'));
    ['save-text','save-text2'].forEach(id => document.getElementById(id).textContent = 'Save Changes');

    if (res?.ok) {
      _current = res.data.data || data;
      Toast.success('Settings saved successfully');
      setDirty(false);
      updateSessionBadge();
      renderSummary();
    } else {
      Toast.error(res?.data?.message || 'Failed to save');
    }
  }

  // ── Dirty state ────────────────────────────────────────
  function markDirty() { setDirty(true); renderSummary(); }

  function setDirty(val) {
    _dirty = val;
    const dot = document.getElementById('dirty-dot');
    const lbl = document.getElementById('dirty-label');
    if (dot)  { dot.classList.toggle('saved', !val); }
    if (lbl)  lbl.textContent = val ? 'You have unsaved changes' : 'All changes saved';
  }

  // ── Nudge +/− ──────────────────────────────────────────
  function nudge(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    const min = parseInt(el.min) || 1;
    const max = parseInt(el.max) || 9999;
    el.value = Math.max(min, Math.min(max, (parseInt(el.value) || 0) + delta));
    markDirty();
    updateSessionBadge();
  }

  // ── Session badge ──────────────────────────────────────
  function updateSessionBadge() {
    const hrs = parseInt(document.getElementById('s-session_timeout_hours')?.value) || 0;
    const badge = document.getElementById('session-live-badge');
    if (!badge) return;
    const label = hrs >= 24 ? `${(hrs/24).toFixed(hrs % 24 === 0 ? 0 : 1)}d` : `${hrs}h`;
    badge.textContent = '⏱ ' + label;
  }

  // ── Policy summary cards ───────────────────────────────
  function renderSummary() {
    const el = document.getElementById('policy-summary');
    if (!el) return;
    const d = collectForm();
    const rows = [
      { icon:'<i data-icon="lock"></i>', label:'Session',         val: d.session_timeout_hours >= 24
          ? `${(d.session_timeout_hours/24).toFixed(1)} days` : `${d.session_timeout_hours} hours`,
        color:'#7c3aed' },
      { icon:'<i data-icon="refresh-cw"></i>', label:'Remember Me',     val: `${d.remember_me_days || 30} days`, color:'#0891b2' },
      { icon:'<i data-icon="key"></i>', label:'PW Expires',      val: `Every ${d.password_expiry_days} days`,  color:'#ef4444' },
      { icon:'<i data-icon="ban"></i>', label:'PW Reuse Block',  val: `Last ${d.password_history_count} passwords`, color:'#f59e0b' },
      { icon:'<i data-icon="shield"></i>',  label:'Lockout After',  val: `${d.max_login_attempts} attempts → ${d.lockout_minutes}min`, color:'#059669' },
      { icon:'<i data-icon="circle"></i>', label:'API Rate Limit',  val: `${d.api_rate_limit_requests} req / ${d.api_rate_limit_window_seconds}s`, color:'#3b82f6' },
      { icon:'<i data-icon="trash"></i>', label:'Trash Retention', val: `${d.trash_retention_days} days`, color:'#a855f7' },
      { icon:'<i data-icon="edit"></i>', label:'Markdown',        val: d.enable_markdown ? 'Enabled' : 'Disabled', color: d.enable_markdown ? '#059669' : '#9ca3af' },
    ];
    el.innerHTML = rows.map(r => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border)">
        <div style="width:28px;height:28px;border-radius:7px;background:${r.color}18;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${r.icon}</div>
        <div style="flex:1">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">${r.label}</div>
          <div style="font-size:12.5px;font-weight:800;color:var(--text)">${r.val}</div>
        </div>
      </div>`).join('');
  }

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', e => {
    if (_dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  loadSettings();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyToForm", { configurable: true, get: () => applyToForm, set: (v) => { applyToForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectForm", { configurable: true, get: () => collectForm, set: (v) => { collectForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "linesOf", { configurable: true, get: () => linesOf, set: (v) => { linesOf = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSettings", { configurable: true, get: () => loadSettings, set: (v) => { loadSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "markDirty", { configurable: true, get: () => markDirty, set: (v) => { markDirty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "nudge", { configurable: true, get: () => nudge, set: (v) => { nudge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSummary", { configurable: true, get: () => renderSummary, set: (v) => { renderSummary = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveSettings", { configurable: true, get: () => saveSettings, set: (v) => { saveSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setDirty", { configurable: true, get: () => setDirty, set: (v) => { setDirty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateSessionBadge", { configurable: true, get: () => updateSessionBadge, set: (v) => { updateSessionBadge = v; } }); } catch (e) {}
})();
