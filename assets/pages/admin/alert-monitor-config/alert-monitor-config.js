/* ══════════════════════════════════════════════════════════════════
   alert-monitor-config.js  |  Admin config controller
   Manages: JSM connection, sync behavior, categories, classification
   rules, sync history, and manual sync/backfill triggers.
   ══════════════════════════════════════════════════════════════════ */
const AlertMonitorConfig = (() => {
  const el   = (id) => document.getElementById(id);
  const fmt  = new Intl.NumberFormat('en-US');
  const LEAD = ['sm_admin', 'sm_lead', 'dev_sm'];

  const s = {
    config: null,   // full config as loaded / edited
    state:  null,   // sync state
  };

  async function init() {
    const u = Auth.getUser?.() || {};
    if (!LEAD.includes(u.role)) {
      document.querySelector('.amc-wrap').innerHTML =
        `<div style="padding:40px;text-align:center">
           <h2>ต้องเป็น Lead / Admin</h2>
           <p style="color:var(--text-muted)">หน้านี้เข้าได้เฉพาะ sm_lead / sm_admin / dev_sm</p>
           <a class="amc-btn" href="../alert-monitor.html">← กลับ Dashboard</a>
         </div>`;
      return;
    }
    _bind();
    await Promise.all([_loadConfig(), _loadState()]);
  }

  // ── Load / render ─────────────────────────────────────────────────
  async function _loadConfig() {
    const r = await API.alertMonitor.getConfig();
    if (!r.ok) return _toast('โหลด config ล้มเหลว', 'err');
    s.config = r.data.data || {};
    _renderConfig();
  }
  async function _loadState() {
    const r = await API.alertMonitor.state();
    if (!r.ok) return;
    s.state = r.data.data || {};
    _renderState();
    _renderHistory();
  }

  function _renderConfig() {
    const c = s.config;
    // JSM
    el('jsm-cloud-id').value          = c.jsm?.cloud_id          || '';
    el('jsm-team-name').value         = c.jsm?.team_name         || '';
    el('jsm-team-id').value           = c.jsm?.team_id           || '';
    el('jsm-responder-filter').value  = c.jsm?.responder_filter  || '';
    el('jsm-base-url').value          = c.jsm?.base_url          || 'https://api.atlassian.com/jsm/ops/api';
    el('jsm-ssl-verify').checked      = c.jsm?.ssl_verify        !== false;
    el('jsm-ssl-ca').value            = c.jsm?.ssl_ca_bundle     || '';
    // Sync
    el('sy-min').value             = c.sync?.min_interval_seconds     ?? 30;
    el('sy-page-size').value       = c.sync?.page_size                ?? 100;
    el('sy-max-pages').value       = c.sync?.max_pages_per_sync       ?? 10;
    el('sy-history-months').value  = c.sync?.history_months           ?? 12;
    el('sy-req-timeout').value     = c.sync?.request_timeout_seconds  ?? 25;
    // Categories
    _renderCats();
    // Rules
    _renderRules();
  }

  function _renderCats() {
    const cats = s.config.categories || [];
    el('cats-list').innerHTML = cats.map(c => `
      <span class="amc-cat-chip">
        <span class="swatch" style="background:${c.color || '#999'}"></span>
        <span>${_escape(c.label || c.id)}</span>
        <input type="color" value="${c.color || '#888888'}"
               data-cat="${c.id}"
               style="width:26px;height:22px;border:none;padding:0;background:transparent;cursor:pointer">
      </span>
    `).join('') || '<span style="color:var(--text-muted);font-size:11.5px">— ไม่มี categories —</span>';

    el('cats-list').querySelectorAll('input[type=color]').forEach(inp => {
      inp.addEventListener('change', () => {
        const id = inp.dataset.cat;
        const cat = s.config.categories.find(c => c.id === id);
        if (cat) cat.color = inp.value;
        // Update swatch preview immediately
        const sw = inp.parentElement.querySelector('.swatch');
        if (sw) sw.style.background = inp.value;
      });
    });
  }

  function _renderRules() {
    const rules = (s.config.classification_rules || []).slice()
                    .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    const cats  = (s.config.categories || []).map(c => c.id);
    const catOptions = cats.map(c => `<option value="${c}">${c}</option>`).join('');

    const rows = rules.map(r => `
      <tr class="${r.enabled === false ? 'disabled' : ''}" data-id="${_escape(r.id)}">
        <td class="drag-h">≡</td>
        <td><input type="number" value="${r.priority ?? 100}" data-k="priority" min="0" step="1"></td>
        <td>
          <select data-k="match_field">
            ${['message','tags','source','alias'].map(f =>
              `<option value="${f}" ${r.match_field===f?'selected':''}>${f}</option>`).join('')}
          </select>
        </td>
        <td>
          <select data-k="match_type">
            ${['contains','starts_with','equals','regex'].map(t =>
              `<option value="${t}" ${r.match_type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </td>
        <td><input type="text" value="${_escape(r.keyword || '')}" data-k="keyword" placeholder="keyword"></td>
        <td>
          <select data-k="category">
            ${cats.map(c => `<option value="${c}" ${r.category===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </td>
        <td>
          <label class="amc-toggle">
            <input type="checkbox" ${r.enabled !== false ? 'checked' : ''} data-k="enabled">
            <span class="amc-toggle-slider"></span>
          </label>
        </td>
        <td class="row-actions">
          <button class="icon-btn" title="ย้ายขึ้น" data-act="up">▲</button>
          <button class="icon-btn" title="ย้ายลง" data-act="down">▼</button>
          <button class="icon-btn del" title="ลบ" data-act="del"><i data-icon="x"></i></button>
        </td>
      </tr>
    `).join('');
    el('rules-tbody').innerHTML = rows || `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">— ยังไม่มี rules —</td></tr>`;

    // wire inputs
    el('rules-tbody').querySelectorAll('tr').forEach(tr => {
      const id = tr.dataset.id;
      const rule = (s.config.classification_rules || []).find(r => r.id === id);
      if (!rule) return;
      tr.querySelectorAll('input, select').forEach(inp => {
        inp.addEventListener('change', () => {
          const key = inp.dataset.k;
          if (!key) return;
          if (inp.type === 'checkbox') rule[key] = inp.checked;
          else if (inp.type === 'number') rule[key] = parseInt(inp.value, 10) || 0;
          else rule[key] = inp.value;
          tr.classList.toggle('disabled', rule.enabled === false);
        });
      });
      tr.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => _ruleAction(rule.id, btn.dataset.act));
      });
    });
  }

  function _ruleAction(id, act) {
    const arr = s.config.classification_rules || [];
    const idx = arr.findIndex(r => r.id === id);
    if (idx < 0) return;
    const rule = arr[idx];

    if (act === 'del') {
      if (!confirm('ลบ rule "' + (rule.keyword || rule.id) + '"?')) return;
      arr.splice(idx, 1);
    } else if (act === 'up' || act === 'down') {
      // Swap priorities with neighbor in sorted order
      const sorted = arr.slice().sort((a, b) => (a.priority || 0) - (b.priority || 0));
      const sIdx = sorted.findIndex(r => r.id === id);
      const nIdx = act === 'up' ? sIdx - 1 : sIdx + 1;
      if (nIdx < 0 || nIdx >= sorted.length) return;
      const other = sorted[nIdx];
      const tmp = rule.priority;
      rule.priority = other.priority;
      other.priority = tmp;
    }
    _renderRules();
  }

  // ── State card ────────────────────────────────────────────────────
  function _renderState() {
    const st = s.state || {};
    el('ss-total').textContent  = fmt.format(st.total_alerts ?? 0);
    el('ss-months').textContent = String((st.months_cached || []).length);
    const t = st.state?.last_sync_finished_at || 0;
    el('ss-last').textContent   = t ? _relTime(t * 1000) : '—';
    el('ss-last-sub').textContent = t ? new Date(t * 1000).toLocaleString('th-TH') : '';

    const bf = st.state?.backfill_in_progress;
    if (bf) {
      el('ss-backfill').innerHTML = '<span class="amc-status-dot warn"></span>in progress';
      el('ss-backfill-sub').textContent = `offset ${fmt.format(st.state.backfill_offset || 0)} · pages ${fmt.format(st.state.backfill_pages_done || 0)}`;
    } else if (st.state?.backfill_completed_at) {
      el('ss-backfill').innerHTML = '<span class="amc-status-dot ok"></span>complete';
      el('ss-backfill-sub').textContent = _relTime((st.state.backfill_completed_at) * 1000);
    } else {
      el('ss-backfill').innerHTML = '<span class="amc-status-dot idle"></span>not started';
      el('ss-backfill-sub').textContent = '';
    }

    const badge = el('sync-badge');
    const err = st.state?.last_error;
    if (err)     { badge.textContent = 'error';       badge.style.background = 'color-mix(in srgb, var(--amc-c-err) 12%, transparent)';  badge.style.color = 'var(--amc-c-err)'; }
    else if (bf) { badge.textContent = 'syncing';     badge.style.background = 'color-mix(in srgb, var(--amc-c-warn) 12%, transparent)'; badge.style.color = 'var(--amc-c-warn)'; }
    else if (t)  { badge.textContent = 'ok';          badge.style.background = 'color-mix(in srgb, var(--amc-c-ok) 12%, transparent)';   badge.style.color = 'var(--amc-c-ok)'; }
    else         { badge.textContent = 'idle'; }
  }

  function _renderHistory() {
    const hist = s.state?.state?.history || [];
    if (!hist.length) {
      el('hist-tbody').innerHTML =
        '<tr><td colspan="7" style="color:var(--text-muted);text-align:center;padding:24px">— ยังไม่มี history —</td></tr>';
      return;
    }
    el('hist-tbody').innerHTML = hist.map(h => `
      <tr>
        <td>${new Date((h.at||0)*1000).toLocaleString('th-TH', { hour12: false })}</td>
        <td><span class="mode ${h.mode || 'delta'}">${h.mode || 'delta'}</span></td>
        <td>${(h.duration || 0)}ms</td>
        <td style="text-align:right">${fmt.format(h.new || 0)}</td>
        <td style="text-align:right">${fmt.format(h.updated || 0)}</td>
        <td>${(h.months || []).join(', ') || '—'}</td>
        <td>${_escape(h.user || '')}</td>
      </tr>
    `).join('');
  }

  // ── Actions ───────────────────────────────────────────────────────
  function _bind() {
    el('btn-save-all').addEventListener('click', _saveAll);
    el('btn-force-sync').addEventListener('click', () => _runSync('?force=1', 'force'));
    el('btn-full-backfill').addEventListener('click', () => {
      if (!confirm('Reset cursor และ backfill history ใหม่?\n\nแบบเดิมยังอยู่ในไฟล์ — จะเป็นการ upsert ทับเฉยๆ ไม่ได้ลบข้อมูล')) return;
      _runSync('?full=1', 'full');
    });
    el('btn-test-jsm').addEventListener('click', _testJsm);
    el('btn-add-rule').addEventListener('click', _addRule);
    el('btn-resort').addEventListener('click', _renumberPriorities);
  }

  async function _saveAll() {
    const c = s.config;
    // Persist form values back to the object
    c.jsm = {
      cloud_id:         el('jsm-cloud-id').value.trim(),
      team_name:        el('jsm-team-name').value.trim(),
      team_id:          el('jsm-team-id').value.trim(),
      responder_filter: el('jsm-responder-filter').value.trim(),
      base_url:         el('jsm-base-url').value.trim(),
      ssl_verify:       el('jsm-ssl-verify').checked,
      ssl_ca_bundle:    el('jsm-ssl-ca').value.trim(),
    };
    c.sync = {
      min_interval_seconds:    parseInt(el('sy-min').value, 10) || 30,
      page_size:               parseInt(el('sy-page-size').value, 10) || 100,
      max_pages_per_sync:      parseInt(el('sy-max-pages').value, 10) || 10,
      history_months:          parseInt(el('sy-history-months').value, 10) || 12,
      request_timeout_seconds: parseInt(el('sy-req-timeout').value, 10) || 25,
    };
    const btn = el('btn-save-all'); btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> saving...';
    try {
      const r = await API.alertMonitor.saveConfig(c);
      // r can be null when api.js suppresses a 401 — treat that as failure so
      // the admin gets clear feedback instead of a silent no-op.
      if (!r) throw new Error('server rejected request (401/session) — refresh หน้าและ login ใหม่');
      if (!r.ok) throw new Error(r.data?.message || `HTTP ${r.status || '?'} — save failed`);
      s.config = r.data.data || c;
      _toast('<i data-icon="check"></i> บันทึกเรียบร้อย', 'ok');
      _renderRules();
    } catch (e) {
      _toast('<i data-icon="x"></i> บันทึกล้มเหลว: ' + e.message, 'err');
      // Backup: browser alert() so the admin cannot miss the failure even if
      // the toast is hidden behind other UI.
      alert('Save failed: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  async function _runSync(qs, kind) {
    const btn  = kind === 'full' ? el('btn-full-backfill') : el('btn-force-sync');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> syncing...';
    el('sync-msg').textContent = '';
    try {
      const r = await API.alertMonitor.sync(qs.replace(/^\?/, ''));
      if (!r.ok) throw new Error(r.data?.message || 'sync failed');
      const d = r.data.data || {};
      if (d.skipped) {
        el('sync-msg').textContent = `skipped: ${d.reason}`;
      } else {
        const msg = d.has_more
          ? `chunk done · new ${d.new}, updated ${d.updated}, pages ${d.pages_done} — more pending, กด อีกครั้งเพื่อ continue`
          : `sync done · new ${d.new}, updated ${d.updated}, pages ${d.pages_done}`;
        el('sync-msg').textContent = msg;
        _toast(d.has_more ? 'Chunk done · continue?' : 'Sync สำเร็จ', 'ok');
      }
      // If continued mode needed, offer to continue automatically
      if (d.has_more) {
        setTimeout(() => {
          if (confirm('มี alerts เพิ่มอีก ต้องการ continue อัตโนมัติจนจบมั้ย?')) {
            _autoContinue(btn, orig);
          } else {
            btn.disabled = false; btn.innerHTML = orig;
            _loadState();
          }
        }, 200);
        return;
      }
      await _loadState();
    } catch (e) {
      _toast('Sync ล้มเหลว: ' + e.message, 'err');
      el('sync-msg').textContent = 'error: ' + e.message;
    } finally {
      if (btn.disabled) { btn.disabled = false; btn.innerHTML = orig; }
    }
  }

  async function _autoContinue(btn, orig) {
    let chunk = 1;
    while (true) {
      btn.innerHTML = `<span class="spinner"></span> chunk ${chunk}...`;
      try {
        const r = await API.alertMonitor.sync('continue=1');
        if (!r.ok) throw new Error(r.data?.message);
        const d = r.data.data || {};
        el('sync-msg').textContent = `chunk ${chunk} · new ${d.new}, pages ${d.pages_done}, more=${d.has_more}`;
        chunk++;
        if (!d.has_more) {
          _toast('Backfill เสร็จสมบูรณ์', 'ok');
          break;
        }
        if (chunk > 200) { _toast('Safety stop at 200 chunks', 'err'); break; }
      } catch (e) {
        _toast('Continue ล้มเหลว: ' + e.message, 'err');
        break;
      }
    }
    btn.disabled = false; btn.innerHTML = orig;
    await _loadState();
  }

  async function _testJsm() {
    const btn = el('btn-test-jsm'); btn.disabled = true;
    el('jsm-test-status').textContent = 'testing…';
    const out = el('jsm-test-out');
    out.className = 'amc-test-out visible';
    out.textContent = '';
    try {
      const r = await API.alertMonitor.testJsm('raw=1&limit=3');
      if (!r.ok) throw new Error(r.data?.message);
      const d = r.data.data || {};
      const status = d.response?.http_status;
      const cnt    = d.response?.data_count;
      const first  = d.raw_first ? {
        id: d.raw_first.id, tinyId: d.raw_first.tinyId, message: d.raw_first.message,
        responders: d.raw_first.responders,
      } : null;
      out.className = 'amc-test-out visible ' + (status === 200 && cnt > 0 ? 'ok' : 'err');
      out.textContent =
`HTTP ${status}   items: ${cnt}
URL: ${d.request?.url}
auth: ${d.request?.auth_email}

first alert:
${first ? JSON.stringify(first, null, 2) : '(no alerts returned)'}`;
      el('jsm-test-status').innerHTML = status === 200 && cnt > 0
        ? '<span class="amc-status-dot ok"></span> ok'
        : '<span class="amc-status-dot err"></span> problem';
    } catch (e) {
      out.className = 'amc-test-out visible err';
      out.textContent = 'ERROR: ' + e.message;
      el('jsm-test-status').innerHTML = '<span class="amc-status-dot err"></span> failed';
    } finally { btn.disabled = false; }
  }

  function _addRule() {
    const cats = (s.config.categories || []).map(c => c.id);
    const rules = s.config.classification_rules || (s.config.classification_rules = []);
    const nextPri = rules.reduce((m, r) => Math.max(m, r.priority || 0), 0) + 10;
    rules.push({
      id: 'rule_' + Math.random().toString(36).slice(2, 8),
      priority: nextPri,
      match_field: 'message',
      match_type:  'contains',
      keyword:     '',
      category:    cats[0] || 'other',
      enabled:     true,
    });
    _renderRules();
  }

  function _renumberPriorities() {
    const rules = (s.config.classification_rules || []).slice()
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    rules.forEach((r, i) => { r.priority = (i + 1) * 10; });
    _renderRules();
    _toast('Priorities renumbered — กด Save changes เพื่อบันทึก', 'ok');
  }

  // ── Utilities ─────────────────────────────────────────────────────
  function _toast(msg, kind = '') {
    const t = el('toast');
    t.textContent = msg;
    t.className = 'amc-toast visible ' + kind;
    setTimeout(() => { t.className = 'amc-toast'; }, 3200);
  }
  function _relTime(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  }
  function _escape(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
  }

  return { init };
})();
