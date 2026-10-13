// log-explorer — page script, extracted from log-explorer.html.
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
Layout.render('log-explorer');

(function () {
  const $  = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Toast shim — utils.js declares `const Toast`, which lives in Script scope
  // (accessible as a bare identifier, NOT on window). Bridge to window.showToast.
  if (!window.showToast) {
    window.showToast = (msg, type = 'info') => {
      try { if (typeof Toast !== 'undefined' && Toast.show) { Toast.show(msg, type); return; } } catch {}
      console.log(`[toast:${type}] ${msg}`);
    };
  }

  window.LE = {
    endpoints:     [],
    defaults:      { size: 200, max_size: 1000, default_time_range_min: 15 },
    lastResult:    null,
    lastQuery:     null,
    traceCid:      '',
    _busy:         false,
    _statusFilter: null,
    _bucketRange:  null,
    _restFilter:   null,
    _excludedModules: new Set(),
    _mostFound:    [],
    _userCreds:    {},
    _credsLoaded:  false,
    _traceModules: [],
    _traceModFilter: null,
    _activeTab:    'search',

    async init() {
      const res = await API.opensearch.endpoints();
      if (!res?.ok || !res.data?.data?.endpoints?.length) {
        $('le-body').innerHTML = `<div class="lv-msg ${res?.ok ? '' : 'err'}">
          ${res?.ok
            ? 'No OpenSearch endpoints configured yet. <a href="admin/opensearch-config.html" style="color:#3b82f6">Add one</a> in the admin panel first.'
            : `Cannot load endpoints: ${esc(res?.data?.message || 'unknown')}`}
        </div>`;
        $('le-endpoint').innerHTML = '<option>—</option>';
        return;
      }
      this.endpoints = res.data.data.endpoints;
      this.defaults  = res.data.data.defaults || this.defaults;

      // Populate endpoint selectors (main + gate)
      const epOpts = this.endpoints.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
      $('le-endpoint').innerHTML = epOpts;
      $('le-gate-ep').innerHTML  = epOpts;

      await this._loadUserCreds();

      // Check if the first (or any) endpoint has credentials saved.
      // If NONE have credentials, show the login gate before the main UI.
      const firstEp  = this.endpoints[0];
      const hasCreds = firstEp && this._userCreds[firstEp.id]?.has_creds;
      if (!hasCreds) {
        this._showGate();
        return;
      }

      this._showMain();
      this.onEndpointChange();

      // Restore range default from admin config
      const mm = this.defaults.default_time_range_min || 15;
      const preset = mm <= 5 ? 'last_5m' : mm <= 15 ? 'last_15m' : mm <= 30 ? 'last_30m'
                   : mm <= 60 ? 'last_1h' : mm <= 240 ? 'last_4h' : 'last_24h';
      $('le-range').value = preset;

      // Shareable link: apply URL params (or ?saved=<id>) and auto-run
      const url = this._readUrl();
      if (url?.savedId) {
        // Wait a tick so the index list has time to populate before applying
        setTimeout(() => this.runSavedSearch(url.savedId), 0);
      } else if (url) {
        setTimeout(() => {
          this._applyParams(url);
          this.search();
        }, 0);
      }
    },

    _showGate() {
      $('le-gate').style.display = 'flex';
      $('le-main').style.display = 'none';
      setTimeout(() => $('le-gate-user')?.focus(), 80);
    },

    _showMain() {
      $('le-gate').style.display = 'none';
      $('le-main').style.display = '';
      this.onEndpointChange();
      const mm = this.defaults.default_time_range_min || 15;
      const preset = mm <= 5 ? 'last_5m' : mm <= 15 ? 'last_15m' : mm <= 30 ? 'last_30m'
                   : mm <= 60 ? 'last_1h' : mm <= 240 ? 'last_4h' : 'last_24h';
      $('le-range').value = preset;
    },

    async gateLogin() {
      const epId = $('le-gate-ep')?.value;
      const user = $('le-gate-user')?.value.trim();
      const pass = $('le-gate-pass')?.value;
      const errEl = $('le-gate-err');
      const btn   = $('le-gate-btn');
      errEl.style.display = 'none';
      if (!epId)  { errEl.textContent = 'กรุณาเลือก Endpoint'; errEl.style.display = 'block'; return; }
      if (!user)  { errEl.textContent = 'กรุณากรอก Username';   errEl.style.display = 'block'; return; }
      if (!pass)  { errEl.textContent = 'กรุณากรอก Password';   errEl.style.display = 'block'; return; }

      // Step 1: test credentials against OpenSearch before saving
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…';
      const testRes = await API.opensearch.testCreds({ endpoint_id: epId, username: user, password: pass });
      if (!testRes?.ok) {
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
        errEl.textContent = testRes?.data?.message || 'ไม่สามารถเชื่อมต่อได้ — กรุณาตรวจสอบ username / password';
        errEl.style.display = 'block';
        return;
      }

      // Step 2: credentials verified → save them
      btn.textContent = 'กำลังบันทึก…';
      const saveRes = await API.opensearch.userCreds.save({ endpoint_id: epId, username: user, password: pass });
      if (!saveRes?.ok) {
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
        errEl.textContent = saveRes?.data?.message || 'บันทึก credentials ไม่สำเร็จ';
        errEl.style.display = 'block';
        return;
      }

      this._userCreds[epId] = { has_creds: true, username: user };
      $('le-endpoint').value = epId;
      this._showMain();
      this._renderCredChip();
      if (window.showToast) showToast('Login สำเร็จ', 'success');
    },

    async _loadUserCreds() {
      const res = await API.opensearch.userCreds.list();
      if (res?.ok) {
        (res.data?.data?.endpoints || []).forEach(e => {
          this._userCreds[e.endpoint_id] = { has_creds: e.has_creds, username: e.username };
        });
      }
      this._credsLoaded = true;
      this._renderCredChip();
    },

    onEndpointChange() {
      const ep = this.endpoints.find(e => e.id === $('le-endpoint').value);
      if (!ep) return;
      const idxSel = $('le-index');
      const patterns = (ep.index_patterns?.length ? ep.index_patterns : [ep.default_index_pattern]).filter(Boolean);
      idxSel.innerHTML = patterns.map(p => `<option value="${esc(p)}" ${p === ep.default_index_pattern ? 'selected' : ''}>${esc(p)}</option>`).join('');
      this._renderCredChip();
    },

    switchTab(tab) {
      this._activeTab = tab;
      $('le-tab-search').classList.toggle('active', tab === 'search');
      $('le-tab-saves').classList.toggle('active', tab === 'saves');
      $('le-pane-search').classList.toggle('hidden', tab !== 'search');
      $('le-pane-saves').classList.toggle('hidden', tab !== 'saves');
      if (tab === 'saves') this.loadSavedSearches();
    },

    _renderCredChip() {
      const epId = $('le-endpoint')?.value;
      const cred = this._userCreds[epId];
      const chip = $('le-cred-chip');
      const btn  = $('le-cred-btn');
      if (cred?.has_creds) {
        chip.className = 'le-cred-chip ok';
        chip.innerHTML = `<span>Logged in as <b>${esc(cred.username)}</b></span>`;
        if (btn) btn.textContent = 'Change credentials';
      } else {
        chip.className = 'le-cred-chip warn';
        chip.innerHTML = '<span>No credentials</span>';
        if (btn) btn.textContent = 'Setup credentials';
      }
    },

    // ── Credential dialog ────────────────────────────────────────────────
    showCredDialog() {
      const epId = $('le-endpoint')?.value;
      const ep   = this.endpoints.find(e => e.id === epId);
      $('le-cred-ep-name').textContent = ep?.name || epId || '—';
      const cred = this._userCreds[epId];
      $('le-cred-user').value = cred?.username || '';
      $('le-cred-pass').value = '';
      $('le-cred-err').style.display = 'none';
      const removeBtn = $('le-cred-remove-btn');
      if (removeBtn) removeBtn.style.display = cred?.has_creds ? '' : 'none';
      $('le-cred-save-btn').disabled = false;
      $('le-cred-save-btn').textContent = 'Save & Connect';
      $('le-cred-ovl').style.display = 'flex';
      setTimeout(() => $('le-cred-user').focus(), 50);
    },

    hideCredDialog() { $('le-cred-ovl').style.display = 'none'; },

    async saveCredentials() {
      const epId = $('le-endpoint')?.value;
      const user = $('le-cred-user').value.trim();
      const pass = $('le-cred-pass').value;
      const errEl = $('le-cred-err');
      const btn   = $('le-cred-save-btn');
      errEl.style.display = 'none';
      if (!user || !pass) {
        errEl.textContent = 'Username and password are required';
        errEl.style.display = 'block';
        return;
      }
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…';
      const testRes = await API.opensearch.testCreds({ endpoint_id: epId, username: user, password: pass });
      if (!testRes?.ok) {
        btn.disabled = false; btn.textContent = 'Save & Connect';
        errEl.textContent = testRes?.data?.message || 'ไม่สามารถเชื่อมต่อได้ — กรุณาตรวจสอบ credentials';
        errEl.style.display = 'block';
        return;
      }
      btn.textContent = 'กำลังบันทึก…';
      const res = await API.opensearch.userCreds.save({ endpoint_id: epId, username: user, password: pass });
      if (!res?.ok) {
        btn.disabled = false; btn.textContent = 'Save & Connect';
        errEl.textContent = res?.data?.message || 'Failed to save credentials';
        errEl.style.display = 'block';
        return;
      }
      this._userCreds[epId] = { has_creds: true, username: user };
      this.hideCredDialog();
      this._renderCredChip();
      if (window.showToast) showToast('Credentials saved', 'success');
    },

    async removeCredentials() {
      const epId = $('le-endpoint')?.value;
      const ep   = this.endpoints.find(e => e.id === epId);
      const ok   = await this._confirm(
        `ลบ credentials ของคุณสำหรับ <b>${esc(ep?.name || epId)}</b>?<br><span style="font-size:12px">ครั้งถัดไปที่ค้นหาจะต้อง login ใหม่</span>`,
        { title: 'ลบ Credentials', okLabel: 'ลบ', okClass: 'danger', icon: 'danger' }
      );
      if (!ok) return;
      const res = await API.opensearch.userCreds.remove(epId);
      if (!res?.ok) {
        if (window.showToast) showToast(res?.data?.message || 'ลบ credentials ไม่สำเร็จ', 'error');
        return;
      }
      this._userCreds[epId] = { has_creds: false, username: null };
      this.hideCredDialog();
      this._renderCredChip();
      if (window.showToast) showToast('ลบ credentials แล้ว', 'success');
      const stillHasCreds = this.endpoints.some(e => this._userCreds[e.id]?.has_creds);
      if (!stillHasCreds) {
        $('le-gate-user').value = ''; $('le-gate-pass').value = '';
        $('le-gate-err').style.display = 'none';
        $('le-gate-btn').disabled = false; $('le-gate-btn').textContent = 'เข้าสู่ระบบ';
        this._showGate();
      }
    },

    // ── Search ───────────────────────────────────────────────────────────
    _params(extra = {}) {
      const p = {
        endpoint_id:    $('le-endpoint').value,
        index_pattern:  $('le-index').value,
        module:         $('le-module').value.trim() || undefined,
        log_level:      $('le-lvl').value || undefined,
        q:              $('le-q').value.trim() || undefined,
        correlation_id: $('le-cid').value.trim() || undefined,
        regexp_rest:    this._parseRegexpInput($('le-regexp').value) || undefined,
        size:           this.defaults.size,
      };
      if (this._bucketRange) {
        p.start = this._bucketRange.start;
        p.end   = this._bucketRange.end;
      } else if ($('le-range').value === 'custom') {
        const s = $('le-custom-start').value, e = $('le-custom-end').value;
        if (s && e) { p.start = new Date(s).toISOString(); p.end = new Date(e).toISOString(); }
        else        { p.range = 'last_15m'; }
      } else {
        p.range = $('le-range').value;
      }
      Object.assign(p, extra);
      Object.keys(p).forEach(k => p[k] === undefined && delete p[k]);
      return p;
    },

    // ── URL sync (shareable links) ─────────────────────────────────────
    // Short param names keep URLs readable; kept in sync with _readUrl().
    _urlKeyMap: {
      endpoint_id:'ep', index_pattern:'idx', module:'mod', log_level:'lvl',
      q:'q', correlation_id:'cid', regexp_rest:'rx',
      range:'range', start:'start', end:'end',
    },

    _writeUrl(p, extras = {}) {
      try {
        const qs = new URLSearchParams();
        Object.entries(this._urlKeyMap).forEach(([k, short]) => {
          const v = p?.[k];
          if (v !== undefined && v !== null && v !== '') qs.set(short, String(v));
        });
        // Preserve tab / saved flags supplied by caller
        Object.entries(extras).forEach(([k,v]) => { if (v) qs.set(k, String(v)); });
        const url = qs.toString()
          ? `${location.pathname}?${qs.toString()}${location.hash}`
          : `${location.pathname}${location.hash}`;
        history.replaceState(null, '', url);
      } catch {}
    },

    _readUrl() {
      const qs = new URLSearchParams(location.search);
      if (![...qs.keys()].length) return null;
      const savedId = qs.get('saved');
      if (savedId) return { savedId };
      const out = {};
      Object.entries(this._urlKeyMap).forEach(([k, short]) => {
        if (qs.has(short)) out[k] = qs.get(short);
      });
      return Object.keys(out).length ? out : null;
    },

    // Populate the form from a params object (used for URL + Saved Search apply)
    _applyParams(p) {
      if (!p) return;
      const epSel = $('le-endpoint');
      if (p.endpoint_id && [...epSel.options].some(o => o.value === p.endpoint_id)) {
        epSel.value = p.endpoint_id;
        this.onEndpointChange();
      }
      if (p.index_pattern) {
        const idxSel = $('le-index');
        [...idxSel.options].forEach(o => { if (o.value === p.index_pattern) o.selected = true; });
      }
      $('le-module').value  = p.module || '';
      $('le-lvl').value     = p.log_level || '';
      $('le-q').value       = p.q || '';
      $('le-cid').value     = p.correlation_id || '';
      $('le-regexp').value  = p.regexp_rest || '';

      this._bucketRange = null; this._statusFilter = null; this._restFilter = null;

      if (p.start && p.end) {
        $('le-range').value = 'custom';
        const toLocal = iso => {
          const d = new Date(iso);
          if (isNaN(d)) return '';
          const pad = n => String(n).padStart(2,'0');
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };
        $('le-custom-start').value = toLocal(p.start);
        $('le-custom-end').value   = toLocal(p.end);
        $('le-custom-start').style.display = '';
        $('le-custom-end').style.display   = '';
      } else if (p.range) {
        $('le-range').value = p.range;
        $('le-custom-start').style.display = 'none';
        $('le-custom-end').style.display   = 'none';
      }
    },

    // Copy text using clipboard API (HTTPS) with execCommand fallback (HTTP).
    // Returns true on success. Never opens a browser prompt.
    async _copyText(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {}
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0'; ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch { return false; }
    },

    // Shows the URL inside our own themed modal (used as ultimate fallback
    // when clipboard access is blocked, e.g. some HTTP contexts).
    _showShareLink(url, title = 'Shareable link') {
      $('le-share-title').textContent = title;
      const input = $('le-share-url');
      input.value = url;
      $('le-share-ovl').style.display = 'flex';
      setTimeout(() => { input.focus(); input.select(); }, 50);
    },
    hideShareDialog() { $('le-share-ovl').style.display = 'none'; },

    async _copyLinkFromShareDialog() {
      const url = $('le-share-url').value;
      const ok = await this._copyText(url);
      if (ok && window.showToast) showToast('คัดลอกลิงก์แล้ว', 'success');
      if (ok) this.hideShareDialog();
      else {
        // Keep dialog open — user can still Ctrl+C the highlighted text
        $('le-share-url').focus();
        $('le-share-url').select();
      }
    },

    async copyShareLink() {
      // Ensure URL reflects the current form even if user hasn't hit Search yet
      const p = this.lastQuery || this._params();
      this._writeUrl(p);
      const url = location.href;
      const ok = await this._copyText(url);
      if (ok) { if (window.showToast) showToast('คัดลอกลิงก์แล้ว', 'success'); }
      else    { this._showShareLink(url, 'Shareable link'); }
    },

    async copySavedLink(id) {
      const qs = new URLSearchParams({ saved: id });
      const url = `${location.origin}${location.pathname}?${qs.toString()}`;
      const ok = await this._copyText(url);
      if (ok) { if (window.showToast) showToast('คัดลอกลิงก์ saved search แล้ว', 'success'); }
      else    { this._showShareLink(url, 'Saved search link'); }
    },

    async search(opts = {}) {
      if (this._busy) return;
      this._busy = true;
      $('le-run').disabled = true;
      $('le-body').innerHTML = `<div class="lv-msg"><span class="lv-spinner"></span> Querying OpenSearch…</div>`;
      const params = opts.params || this._params();
      this.lastQuery = params;
      if (!opts.skipUrl) this._writeUrl(params);
      const res = await API.opensearch.search(params);
      this._busy = false;
      $('le-run').disabled = false;

      if (!res?.ok) {
        if (res?.data?.message === 'no_user_creds') {
          $('le-body').innerHTML = `<div class="lv-msg">
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">OpenSearch credentials required</div>
            <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:16px">
              You haven't set up credentials for this endpoint yet.
            </div>
            <button class="le-btn primary" onclick="LE.showCredDialog()">Setup credentials</button>
          </div>`;
          this._renderSummary(null);
          this._renderHistogram(null);
          return;
        }
        $('le-body').innerHTML = `<div class="lv-msg err">Search failed: ${esc(res?.data?.message || 'unknown')}</div>`;
        this._renderSummary(null);
        this._renderHistogram(null);
        return;
      }

      const d = res.data?.data || {};
      this.lastResult = d;
      this._restFilter = null;
      this._excludedModules = new Set();
      this._computeMostFound(d.hits || []);
      $('le-save-btn').disabled = false;
      this._renderSummary(d);
      this._renderHistogram(d);
      this._renderSide(d);
      this._renderTable(d);
      this._renderActiveFilters();
    },

    // ── Summary ──────────────────────────────────────────────────────────
    _renderSummary(d) {
      if (!d) {
        $('le-sum-total').textContent = '—'; $('le-sum-took').textContent = '—';
        $('le-sum-ok').textContent = '2xx · 0'; $('le-sum-warn').textContent = '4xx · 0';
        $('le-sum-err').textContent = '5xx · 0'; $('le-sum-unknown').textContent = 'no status · 0';
        $('le-sum-lat').textContent = 'latency —'; return;
      }
      const tr = d.total_relation === 'gte' ? '≥' : '';
      $('le-sum-total').innerHTML = `<b>${tr}${d.total.toLocaleString()}</b> hits · <span style="opacity:.7">${d.returned} shown</span>`;
      $('le-sum-took').textContent = `${d.took_ms} ms`;
      const s = d.summary?.status || {};
      $('le-sum-ok').textContent      = `2xx · ${s.ok || 0}`;
      $('le-sum-warn').textContent    = `4xx · ${s.warn || 0}`;
      $('le-sum-err').textContent     = `5xx · ${s.error || 0}`;
      $('le-sum-unknown').textContent = `no status · ${s.unknown || 0}`;
      const otherEl = $('le-sum-other');
      if (otherEl) { const n = s.other||0; otherEl.textContent=`3xx · ${n}`; otherEl.style.display=n>0?'':'none'; }
      const la = d.summary?.latency_avg, lm = d.summary?.latency_max;
      $('le-sum-lat').textContent = la != null ? `latency avg ${la}ms · max ${lm}ms (n=${d.summary.latency_n})` : 'latency —';
      ['ok','warn','err','other','unknown'].forEach(k => {
        const map = {ok:'le-sum-ok',warn:'le-sum-warn',err:'le-sum-err',other:'le-sum-other',unknown:'le-sum-unknown'};
        const el = $(map[k]); if (el) el.classList.toggle('active', this._statusFilter === k);
      });
    },

    _pickStatus(kind) {
      this._statusFilter = this._statusFilter === kind ? null : kind;
      this._renderSummary(this.lastResult); this._renderTable(this.lastResult); this._renderActiveFilters();
    },

    // ── Active filter strip ──────────────────────────────────────────────
    _renderActiveFilters() {
      const strip = $('le-active');
      const parts = [];
      const mod = $('le-module').value.trim();
      if (mod) parts.push(`<span class="chip">Module: ${esc(mod)}<button type="button" onclick="LE._clearFilter('module')">×</button></span>`);
      if (this._bucketRange) parts.push(`<span class="chip">Bucket: ${esc(this._bucketRange.label)}<button type="button" onclick="LE._clearBucket()">×</button></span>`);
      if (this._statusFilter) {
        const label = {ok:'2xx only',warn:'4xx only',err:'5xx only',other:'3xx/1xx only',unknown:'no status only'}[this._statusFilter];
        parts.push(`<span class="chip status-${esc(this._statusFilter)}">${esc(label)}<button type="button" onclick="LE._pickStatus('${esc(this._statusFilter)}')">×</button></span>`);
      }
      if (this._restFilter) {
        const short = this._restFilter.length>30 ? this._restFilter.slice(0,30)+'…' : this._restFilter;
        parts.push(`<span class="chip">Most repeated: ${esc(short)}<button type="button" onclick="LE._pickRestFilter('${esc(this._restFilter)}')">×</button></span>`);
      }
      const qVal = $('le-q').value.trim();
      if (qVal) parts.push(`<span class="chip">Text: ${esc(qVal.length > 32 ? qVal.slice(0,32)+'…' : qVal)}<button type="button" onclick="LE._clearFilter('q')">×</button></span>`);
      const rxVal = this._parseRegexpInput($('le-regexp').value);
      if (rxVal) parts.push(`<span class="chip">Regexp: <code style="font-family:ui-monospace,monospace;font-size:10.5px">${esc(rxVal.length>28?rxVal.slice(0,28)+'…':rxVal)}</code><button type="button" onclick="LE._clearFilter('regexp')">×</button></span>`);
      const cidVal = $('le-cid').value.trim();
      if (cidVal) parts.push(`<span class="chip">Correlation: ${esc(cidVal.slice(0,20))}${cidVal.length>20?'…':''}<button type="button" onclick="LE._clearFilter('cid')">×</button></span>`);
      const lvlVal = $('le-lvl').value;
      if (lvlVal) parts.push(`<span class="chip">Level: ${esc(lvlVal)}<button type="button" onclick="LE._clearFilter('lvl')">×</button></span>`);
      if (this._excludedModules?.size) {
        [...this._excludedModules].forEach(m => {
          const short = m.length > 24 ? m.slice(0, 24) + '…' : m;
          const jsMod = m.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          parts.push(`<span class="chip">Hide: ${esc(short)}<button type="button" onclick="LE._toggleModuleExclude('${esc(jsMod)}')">×</button></span>`);
        });
      }
      if (!parts.length) { strip.classList.remove('on'); strip.innerHTML = ''; return; }
      strip.innerHTML = `<span class="h">Active filters</span>${parts.join('')}<button class="clearall" onclick="LE._clearAllFilters()">Clear all</button>`;
      strip.classList.add('on');
    },

    _clearFilter(k) {
      if (k === 'module') $('le-module').value = '';
      if (k === 'q')      $('le-q').value = '';
      if (k === 'cid')    $('le-cid').value = '';
      if (k === 'lvl')    $('le-lvl').value = '';
      if (k === 'regexp') $('le-regexp').value = '';
      this.search();
    },
    _clearBucket() { this._bucketRange = null; this.search(); },
    _clearAllFilters() {
      this._statusFilter = null; this._bucketRange = null; this._restFilter = null;
      this._excludedModules = new Set();
      $('le-module').value = ''; $('le-q').value = ''; $('le-cid').value = '';
      $('le-lvl').value = ''; $('le-regexp').value = '';
      this.search();
    },

    // ── Histogram ────────────────────────────────────────────────────────
    _renderHistogram(d) {
      const hist = $('le-hist');
      const buckets = d?.histogram || [];
      if (!buckets.length) { hist.innerHTML = '<div class="lv-hist-empty">no data</div>'; return; }
      const LEVEL_COLOR = { ERROR:'#ef4444',WARN:'#f59e0b',INFO:'#3b82f6',DEBUG:'#8b5cf6' };
      const STACK_ORDER = ['INFO','DEBUG','WARN','ERROR'];
      const UNKNOWN_COLOR = '#9ca3af';
      const chartH = 80;
      const maxC = Math.max(1, ...buckets.map(b => b.count));
      const w = 100 / buckets.length;
      const barsSvg = buckets.map((b, i) => {
        const totalH = Math.max(1, (b.count / maxC) * chartH);
        const segs = []; const levels = b.levels || []; let drawn = 0;
        for (const lvl of STACK_ORDER) {
          const found = levels.find(l => l.key === lvl);
          if (!found || found.count === 0) continue;
          const h = (found.count / b.count) * totalH;
          const y = chartH - drawn - h;
          segs.push(`<rect class="lv-hist-bar" x="${(i*w).toFixed(3)}%" y="${y.toFixed(2)}" width="${Math.max(w-0.15,0.4)}%" height="${h.toFixed(2)}" fill="${LEVEL_COLOR[lvl]}" data-i="${i}"/>`);
          drawn += h;
        }
        const known = levels.filter(l => STACK_ORDER.includes(l.key)).reduce((s,l) => s+l.count, 0);
        const unknown = b.count - known;
        if (unknown > 0) {
          const h = (unknown / b.count) * totalH;
          const y = chartH - drawn - h;
          segs.push(`<rect class="lv-hist-bar" x="${(i*w).toFixed(3)}%" y="${y.toFixed(2)}" width="${Math.max(w-0.15,0.4)}%" height="${h.toFixed(2)}" fill="${UNKNOWN_COLOR}" opacity="0.7" data-i="${i}"/>`);
        }
        segs.push(`<rect class="lv-hist-hit" x="${(i*w).toFixed(3)}%" y="0" width="${w.toFixed(3)}%" height="${chartH}" data-i="${i}"/>`);
        return segs.join('');
      }).join('');
      const labelCount = Math.min(8, buckets.length);
      const labelStep = Math.max(1, Math.round((buckets.length - 1) / (labelCount - 1)));
      const xLabels = [];
      for (let i = 0; i < buckets.length; i += labelStep) {
        const t = new Date(buckets[i].time);
        const pct = (i * w + w / 2);
        xLabels.push(`<span style="left:${pct.toFixed(2)}%">${t.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>`);
      }
      const lastI = buckets.length - 1;
      if (lastI % labelStep !== 0) {
        const t = new Date(buckets[lastI].time);
        xLabels.push(`<span style="left:${(lastI*w+w/2).toFixed(2)}%">${t.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>`);
      }
      const t = d.time || {};
      const gtStr = t.gte ? new Date(t.gte).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      const ltStr = t.lte ? new Date(t.lte).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '';
      const rangeStr = gtStr && ltStr ? `${gtStr} → ${ltStr}` : '';
      const seen = new Set();
      buckets.forEach(b => (b.levels||[]).forEach(l => { if (l.count > 0) seen.add(l.key); }));
      const legendItems = STACK_ORDER.filter(l => seen.has(l))
        .map(l => `<span class="li"><span class="sw" style="background:${LEVEL_COLOR[l]}"></span>${l}</span>`).join('');
      hist.innerHTML = `
        <div class="lv-hist-yaxis"><span class="y-max">${maxC.toLocaleString()}</span><span class="y-lbl">max</span></div>
        <div class="lv-hist-wrap">
          <svg class="lv-hist-svg" viewBox="0 0 100 ${chartH}" preserveAspectRatio="none" id="le-hist-svg">${barsSvg}</svg>
        </div>
        <div class="lv-hist-xaxis">${xLabels.join('')}</div>
        <div class="lv-hist-meta">
          <span>${esc(rangeStr)}</span>
          <span class="lv-hist-legend">${legendItems}</span>
          <span>bucket: ${esc(t.interval||'?')}</span>
        </div>`;
      let tt = document.getElementById('le-hist-tt');
      if (!tt) { tt = document.createElement('div'); tt.id = 'le-hist-tt'; tt.className = 'lv-hist-tt'; document.body.appendChild(tt); }
      const intervalMs = this._parseIntervalMs(t.interval);
      const svg = document.getElementById('le-hist-svg');
      const onMove = ev => {
        const target = ev.target.closest('[data-i]');
        if (!target) { tt.classList.remove('on'); return; }
        const i = +target.dataset.i;
        const b = buckets[i];
        if (!b) { tt.classList.remove('on'); return; }
        const from = new Date(b.time), to = new Date(b.time + intervalMs);
        const fmt = dt => dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        const rows = STACK_ORDER.map(lvl => {
          const lb = (b.levels||[]).find(l => l.key === lvl);
          if (!lb || lb.count === 0) return '';
          return `<div class="lvl-row"><span class="lvl-dot" style="background:${LEVEL_COLOR[lvl]}"></span><span>${lvl}</span><span class="lvl-n">${lb.count.toLocaleString()}</span></div>`;
        }).join('');
        const known = (b.levels||[]).filter(l => STACK_ORDER.includes(l.key)).reduce((s,l)=>s+l.count, 0);
        const unknown = b.count - known;
        const unkRow = unknown > 0 ? `<div class="lvl-row"><span class="lvl-dot" style="background:${UNKNOWN_COLOR}"></span><span>OTHER</span><span class="lvl-n">${unknown.toLocaleString()}</span></div>` : '';
        tt.innerHTML = `<div class="head">${fmt(from)} → ${fmt(to)}</div><div class="total">Total: <b>${b.count.toLocaleString()}</b> hits</div>${rows}${unkRow}`;
        tt.classList.add('on');
        const pad = 14, ttRect = tt.getBoundingClientRect();
        let x = ev.clientX + pad, y = ev.clientY + pad;
        if (x + ttRect.width > window.innerWidth - 8) x = ev.clientX - ttRect.width - pad;
        if (y + ttRect.height > window.innerHeight - 8) y = ev.clientY - ttRect.height - pad;
        tt.style.left = Math.max(4, x) + 'px'; tt.style.top = Math.max(4, y) + 'px';
      };
      svg.addEventListener('mousemove', onMove);
      svg.addEventListener('mouseleave', () => tt.classList.remove('on'));
      svg.addEventListener('click', ev => {
        const target = ev.target.closest('[data-i]');
        if (!target) return;
        this._pickBucket(+target.dataset.i);
      });
    },

    _parseIntervalMs(s) {
      if (!s) return 60000;
      const m = /^(\d+)(ms|s|m|h|d)$/.exec(String(s));
      if (!m) return 60000;
      const unit = {ms:1,s:1000,m:60000,h:3600000,d:86400000}[m[2]];
      return +m[1] * unit;
    },

    _pickBucket(i) {
      const d = this.lastResult;
      const b = d?.histogram?.[i];
      if (!b) return;
      const intervalMs = this._parseIntervalMs(d?.time?.interval);
      const startIso = new Date(b.time).toISOString();
      const endIso   = new Date(b.time + intervalMs).toISOString();
      const f = ms => new Date(ms).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      this._bucketRange = { start: startIso, end: endIso, label: `${f(b.time)} → ${f(b.time+intervalMs)}` };
      this._statusFilter = null;
      const params = { ...this._params(), start: startIso, end: endIso };
      delete params.range;
      this.search({ params });
    },

    // ── Side (most found + correlations + pods) ──────────────────────────
    _renderSide(d) {
      const side = $('le-side');
      const parts = [];
      // Modules facet — click any chip to include/exclude that module from results
      const modules = this._computeModuleFacet(d?.hits || []);
      if (modules.length > 1) {
        parts.push(`<span class="h">Modules</span>`);
        const excluded = this._excludedModules;
        modules.slice(0, 20).forEach(m => {
          const isEx = excluded.has(m.module);
          const cls = isEx ? ' excluded' : '';
          const label = m.module.length > 32 ? m.module.slice(0, 32) + '…' : m.module;
          const jsMod = m.module.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          parts.push(`<span class="lv-chip${cls}" title="${esc(m.module)}${isEx ? ' — click to include' : ' — click to hide'}" onclick="LE._toggleModuleExclude('${esc(jsMod)}')">${esc(label)} <span class="n">${m.count}</span></span>`);
        });
        if (modules.length > 20) {
          parts.push(`<span style="font-size:10.5px;color:var(--text-muted)">+${modules.length - 20} more</span>`);
        }
        if (excluded.size) {
          parts.push(`<button class="le-btn" style="height:22px;padding:0 8px;font-size:10.5px" onclick="LE._clearModuleExcludes()">Include all</button>`);
        }
        parts.push(`<span style="opacity:.4">·</span>`);
      }
      if (this._mostFound?.length) {
        parts.push(`<span class="h">Most repeated</span>`);
        this._mostFound.forEach(m => {
          const on = this._restFilter === m.key ? ' active' : '';
          const label = m.key.length > 40 ? m.key.slice(0,40)+'…' : m.key;
          parts.push(`<span class="lv-chip${on}" title="${esc(m.key)}" onclick="LE._pickRestFilter('${esc(m.key)}')">${esc(label)} <span class="n">×${m.count}</span></span>`);
        });
      }
      if (d?.top_correlations?.length) {
        if (parts.length) parts.push(`<span style="opacity:.4">·</span>`);
        parts.push(`<span class="h">Top correlations</span>`);
        d.top_correlations.slice(0,5).forEach(c => {
          parts.push(`<span class="lv-chip" onclick="LE._pickCid('${esc(c.key)}')">${esc(c.key.slice(0,32))}${c.key.length>32?'…':''} <span class="n">${c.count}</span></span>`);
        });
      }
      if (d?.top_pods?.length) {
        if (parts.length) parts.push(`<span style="opacity:.4">·</span>`);
        parts.push(`<span class="h">Top pods</span>`);
        d.top_pods.slice(0,5).forEach(p => {
          const short = p.key.split('-').slice(-2).join('-');
          parts.push(`<span class="lv-chip" title="${esc(p.key)}">${esc(short)} <span class="n">${p.count}</span></span>`);
        });
      }
      side.innerHTML = parts.join('');
      side.classList.toggle('on', parts.length > 0);
    },

    // ── Custom dialogs (replaces browser confirm/alert) ───────────────────
    _dialogResolve: null,

    _confirm(msg, { title = 'ยืนยัน', okLabel = 'ยืนยัน', okClass = 'danger', icon = 'danger' } = {}) {
      return new Promise(resolve => {
        this._dialogResolve = resolve;
        $('le-dialog-title').textContent = title;
        $('le-dialog-msg').innerHTML = msg;
        const iconEl = $('le-dialog-icon');
        iconEl.className = `le-dialog-icon ${icon}`;
        // Swap icon SVG based on type
        if (icon === 'info') {
          iconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        } else {
          iconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        }
        const okBtn = $('le-dialog-ok');
        okBtn.textContent = okLabel;
        okBtn.className = `le-btn ${okClass}`;
        okBtn.onclick = () => { $('le-dialog-ovl').style.display = 'none'; resolve(true); };
        $('le-dialog-cancel').onclick = () => { $('le-dialog-ovl').style.display = 'none'; resolve(false); };
        $('le-dialog-ovl').style.display = 'flex';
      });
    },

    _alert(msg, { title = 'แจ้งเตือน', icon = 'info' } = {}) {
      return new Promise(resolve => {
        $('le-dialog-title').textContent = title;
        $('le-dialog-msg').innerHTML = msg;
        const iconEl = $('le-dialog-icon');
        iconEl.className = `le-dialog-icon ${icon}`;
        iconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        $('le-dialog-cancel').style.display = 'none';
        const okBtn = $('le-dialog-ok');
        okBtn.textContent = 'ตกลง'; okBtn.className = 'le-btn primary';
        okBtn.onclick = () => {
          $('le-dialog-ovl').style.display = 'none';
          $('le-dialog-cancel').style.display = '';
          resolve();
        };
        $('le-dialog-ovl').style.display = 'flex';
      });
    },

    _parseRegexpInput(raw) {
      const s = (raw || '').trim();
      if (!s) return '';
      if (s.startsWith('{')) {
        try {
          const obj = JSON.parse(s);
          const val = obj?.query?.regexp?.REST?.value ?? obj?.regexp?.REST?.value ?? obj?.value ?? null;
          if (val && typeof val === 'string') return val;
        } catch {}
        return '';
      }
      return s;
    },

    _highlightRest(text, q, rx) {
      if (!text) return '';
      const patterns = [];
      if (q) {
        const words = q.replace(/[():]/g, ' ').trim().split(/\s+/)
          .filter(w => w.length >= 2 && !/^(AND|OR|NOT)$/i.test(w))
          .map(w => w.replace(/\*/g, '').replace(/^["']|["']$/g, '').trim())
          .filter(w => w.length >= 2);
        words.forEach(w => { try { patterns.push(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } catch {} });
      }
      if (rx) { try { new RegExp(rx); patterns.push(rx); } catch {} }
      if (!patterns.length) return esc(text);
      try {
        const combined = new RegExp(`(${patterns.join('|')})`, 'gi');
        const parts = []; let last = 0; let m;
        while ((m = combined.exec(text)) !== null) {
          if (m.index > last) parts.push(esc(text.slice(last, m.index)));
          parts.push(`<mark style="background:color-mix(in srgb,#f59e0b 40%,transparent);color:inherit;border-radius:2px;padding:0 2px;font-weight:700">${esc(m[0])}</mark>`);
          last = m.index + m[0].length;
          if (m[0].length === 0) { last++; }
        }
        if (last < text.length) parts.push(esc(text.slice(last)));
        return parts.join('');
      } catch { return esc(text); }
    },

    // ── Log table ────────────────────────────────────────────────────────
    _renderTable(d) {
      const hits = d?.hits || [];
      const body = $('le-body');
      if (!hits.length) { body.innerHTML = `<div class="lv-msg">No log entries matched. Try widening the time range or removing filters.</div>`; return; }
      const visibleIndices = [];
      const rows = hits.map((h, i) => {
        if (!this._matches(h)) return '';
        visibleIndices.push(i);
        const t = h.timestamp ? new Date(h.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3}) : '—';
        const lvl = (h.log_level||'').toUpperCase();
        const statusBadge = h.status_code == null ? '' : `<span class="lv-status-badge ${h.status_code>=500?'err':h.status_code>=400?'warn':'ok'}">${h.status_code}</span>`;
        const lat = h.latency_ms != null ? `<span class="lv-lat">${h.latency_ms}ms</span>` : '';
        const cid = h.correlation_id
          ? `<a href="#" class="lv-cid" onclick="event.preventDefault();event.stopPropagation();LE._enterTrace('${esc(h.correlation_id)}')">${esc(h.correlation_id)}</a>`
          : '';
        const restKey = (h.rest||'').slice(0,120);
        const freq = this._mostFound.find(m => m.key === restKey);
        const freqBadge = freq ? `<span style="display:inline-flex;align-items:center;padding:0 5px;border-radius:3px;font-size:9.5px;font-weight:700;background:color-mix(in srgb,#f26419 18%,transparent);color:#f26419;margin-right:5px;font-family:inherit">×${freq.count}</span>` : '';
        const rowBg = freq ? ' style="background:color-mix(in srgb,#f26419 5%,transparent)"' : '';
        const qTerm = $('le-q').value.trim();
        const rxTerm = this._parseRegexpInput($('le-regexp').value);
        const restHtml = this._highlightRest(h.rest, qTerm, rxTerm);
        return `<tr data-i="${i}"${rowBg} onclick="LE._toggleRow(${i})">
          <td class="lv-time">${t}</td>
          <td><span class="lv-mod" title="${esc(h.module)}">${esc(h.module)}</span></td>
          <td><span class="lv-lvl ${lvl}">${esc(lvl||'—')}</span></td>
          <td class="lv-rest">${freqBadge}${statusBadge}${lat}<span style="color:var(--text)">${restHtml}</span></td>
          <td>${cid}</td>
        </tr>`;
      }).filter(Boolean).join('');
      if (!rows) {
        body.innerHTML = `<div class="lv-msg">No rows match the active client-side filters.
          <div style="margin-top:8px"><button class="le-btn" onclick="LE._clearAllFilters()">Clear all filters</button></div></div>`;
        return;
      }
      const anyClientFilter = this._statusFilter || this._restFilter || this._excludedModules?.size;
      const filterNote = anyClientFilter
        ? `<div style="padding:6px 12px;font-size:11.5px;color:var(--text-muted);background:color-mix(in srgb,var(--text-muted) 6%,transparent);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:3">
            Showing <b style="color:var(--text)">${visibleIndices.length}</b> of ${hits.length}
            ${this._excludedModules?.size ? ` · hiding <b>${this._excludedModules.size}</b> module${this._excludedModules.size!==1?'s':''}` : ''}
            ${this._statusFilter ? ` · status: <b>${esc(this._statusFilter)}</b>` : ''}
          </div>` : '';
      body.innerHTML = `${filterNote}<table class="lv-tbl">
        <thead><tr>
          <th style="width:110px">Time</th><th style="width:200px">Module</th>
          <th style="width:60px">Level</th><th>REST</th><th style="width:220px">Correlation</th>
        </tr></thead>
        <tbody id="le-tbody">${rows}</tbody></table>`;
    },

    _matches(h) {
      const sc = h.status_code;
      const sf = this._statusFilter;
      if (sf) {
        if (sf === 'ok'      && !(sc >= 200 && sc < 300)) return false;
        if (sf === 'warn'    && !(sc >= 400 && sc < 500)) return false;
        if (sf === 'err'     && !(sc >= 500))              return false;
        if (sf === 'other'   && !(sc != null && (sc < 200 || (sc >= 300 && sc < 400)))) return false;
        if (sf === 'unknown' && sc != null)                return false;
      }
      if (this._restFilter && !h.rest?.includes(this._restFilter)) return false;
      if (this._excludedModules?.size && this._excludedModules.has(h.module || '')) return false;
      return true;
    },

    _toggleModuleExclude(mod) {
      if (this._excludedModules.has(mod)) this._excludedModules.delete(mod);
      else this._excludedModules.add(mod);
      this._renderTable(this.lastResult);
      this._renderSide(this.lastResult);
      this._renderActiveFilters();
    },

    _clearModuleExcludes() {
      this._excludedModules.clear();
      this._renderTable(this.lastResult);
      this._renderSide(this.lastResult);
      this._renderActiveFilters();
    },

    _computeModuleFacet(hits) {
      const freq = new Map();
      (hits || []).forEach(h => {
        const m = h.module || '(unknown)';
        freq.set(m, (freq.get(m) || 0) + 1);
      });
      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([module, count]) => ({ module, count }));
    },

    _computeMostFound(hits) {
      const freq = new Map();
      hits.forEach(h => { const key = (h.rest||'').slice(0,120); if(key) freq.set(key,(freq.get(key)||0)+1); });
      this._mostFound = [...freq.entries()].filter(([,n])=>n>1).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([key,count])=>({key,count}));
    },

    _pickRestFilter(key) {
      this._restFilter = (this._restFilter === key) ? null : key;
      this._renderTable(this.lastResult); this._renderSide(this.lastResult); this._renderActiveFilters();
    },

    _toggleRow(i) {
      const tbody = $('le-tbody');
      const tr = tbody?.querySelector(`tr[data-i="${i}"]`);
      if (!tr) return;
      const next = tr.nextElementSibling;
      if (next?.classList.contains('detail')) { next.remove(); tr.classList.remove('expanded'); return; }
      const h = this.lastResult?.hits?.[i];
      if (!h) return;
      tr.classList.add('expanded');
      const dtl = document.createElement('tr');
      dtl.className = 'detail';
      dtl.innerHTML = `<td colspan="5"><pre class="lv-detail-pre">${esc(JSON.stringify(h.source,null,2))}</pre></td>`;
      tr.after(dtl);
    },

    _pickCid(cid) { $('le-cid').value = cid; this.search(); },

    // ── Trace mode ───────────────────────────────────────────────────────
    async _enterTrace(cid) {
      this.traceCid = cid;
      this._statusFilter = null;
      $('le-active').classList.remove('on');
      $('le-trace').style.display = '';
      $('le-trace-cid').textContent = cid;
      $('le-body').innerHTML = `<div class="lv-msg"><span class="lv-spinner"></span> Loading trace…</div>`;
      const res = await API.opensearch.trace({
        endpoint_id: $('le-endpoint').value, index_pattern: $('le-index').value,
        correlation_id: cid, range: $('le-range').value,
        size: Math.min(1000, this.defaults.max_size || 1000),
      });
      if (!res?.ok) { $('le-body').innerHTML = `<div class="lv-msg err">Trace failed: ${esc(res?.data?.message || 'unknown')}</div>`; return; }
      const d = res.data?.data || {};
      this.lastResult = { hits: d.hits, total: d.total, total_relation: d.total_relation||'eq', returned: d.returned, took_ms: d.took_ms, shards: d.shards||null, summary:{status:{ok:0,warn:0,error:0,unknown:0},latency_avg:null,latency_max:null,latency_n:0}, histogram:[], top_correlations:[], top_pods:[] };
      const s = {ok:0,warn:0,error:0,unknown:0};
      d.hits.forEach(h => { if(h.status_code==null)s.unknown++; else if(h.status_code>=500)s.error++; else if(h.status_code>=400)s.warn++; else s.ok++; });
      this.lastResult.summary.status = s;
      this._traceModules = d.modules || []; this._traceModFilter = null;
      this._renderSummary(this.lastResult);
      const hintParts = [`${d.modules.length} service${d.modules.length!==1?'s':''} touched this request`];
      if (d.total > d.returned) hintParts.push(`<span style="color:#f59e0b">returned ${d.returned} of ${d.total} — bump size to see more</span>`);
      $('le-hist').innerHTML = `<div class="lv-hist-empty">Trace mode · ${hintParts.join(' · ')}</div>`;
      this._renderTraceModules();
      this._renderTable(this.lastResult);
    },

    _renderTraceModules() {
      const mods = this._traceModules || [];
      if (!mods.length) { $('le-side').classList.remove('on'); return; }
      const total = mods.reduce((s,m) => s+m.count, 0);
      const cur = this._traceModFilter;
      const allChip = `<span class="lv-chip${cur?'':' active'}" onclick="LE._filterModuleInTrace(null)">All <span class="n">${total}</span></span>`;
      const modChips = mods.map(m => {
        const on = cur===m.module?' active':'';
        return `<span class="lv-chip${on}" onclick="LE._filterModuleInTrace('${esc(m.module)}')">${esc(m.module)} <span class="n">${m.count}</span></span>`;
      }).join('');
      $('le-side').innerHTML = `<span class="h">Modules in this trace</span>${allChip}${modChips}`;
      $('le-side').classList.add('on');
    },

    _filterModuleInTrace(mod) {
      if (!this.lastResult) return;
      const next = mod === this._traceModFilter ? null : mod;
      this._traceModFilter = next;
      this._renderTraceModules();
      const hits = next ? this.lastResult.hits.filter(h => h.module === next) : this.lastResult.hits;
      this._renderTable({ hits });
    },

    _exitTrace()    { this.traceCid = ''; $('le-trace').style.display = 'none'; this.search(); },
    _refreshTrace() { if (this.traceCid) this._enterTrace(this.traceCid); },

    // ── Export / deeplink ────────────────────────────────────────────────
    async exportCsv() {
      const hits = this.lastResult?.hits || [];
      if (!hits.length) { await this._alert('ไม่มีข้อมูลที่จะ export', { title: 'Export CSV', icon: 'info' }); return; }
      const rows = [['timestamp','module','log_level','status_code','latency_ms','correlation_id','pod','rest']];
      hits.forEach(h => rows.push([h.timestamp||'',h.module||'',h.log_level||'',h.status_code??'',h.latency_ms??'',h.correlation_id||'',h.pod||'',(h.rest||'').replace(/\r?\n/g,' ')]));
      const csv = rows.map(r => r.map(c => { const s=String(c); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `logs_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`; a.click();
      URL.revokeObjectURL(url);
    },

    async openInOpenSearch() {
      const res = await API.opensearch.deeplink(this._params());
      if (!res?.ok) { await this._alert(esc(res?.data?.message || 'ไม่สามารถสร้างลิงก์ได้'), { title: 'Open in OpenSearch', icon: 'warning' }); return; }
      window.open(res.data.data.url, '_blank', 'noopener');
    },

    // ── Save Search ──────────────────────────────────────────────────────
    async showSaveDialog() {
      if (!this.lastQuery) return;
      $('le-save-name').value = '';
      $('le-save-err').style.display = 'none';
      $('le-save-submit-btn').disabled = false;
      $('le-save-submit-btn').textContent = 'Save to team';
      // Ensure folder list is loaded so the picker is populated
      if (!this._allFolders?.length) await this._ensureFoldersLoaded();
      this._populateFolderSelect('le-save-folder', this._folderFilter && this._folderFilter !== 'all' && this._folderFilter !== '__none__' ? this._folderFilter : '');
      this._toggleNewFolder('save', false);
      $('le-save-preview').innerHTML = this._paramsPreviewHtml(this.lastQuery);
      $('le-save-ovl').style.display = 'flex';
      setTimeout(() => $('le-save-name').focus(), 50);
    },

    hideSaveDialog() { $('le-save-ovl').style.display = 'none'; },

    _paramsPreviewHtml(p) {
      p = p || {};
      const rows = [];
      if (p.endpoint_id) { const ep = this.endpoints.find(e=>e.id===p.endpoint_id); rows.push(`<span><span class="k">Endpoint:</span><span class="v">${esc(ep?.name||p.endpoint_id)}</span></span>`); }
      if (p.index_pattern) rows.push(`<span><span class="k">Index:</span><span class="v">${esc(p.index_pattern)}</span></span>`);
      if (p.module)        rows.push(`<span><span class="k">Module:</span><span class="v">${esc(p.module)}</span></span>`);
      if (p.log_level)     rows.push(`<span><span class="k">Level:</span><span class="v">${esc(p.log_level)}</span></span>`);
      if (p.q)             rows.push(`<span><span class="k">Text:</span><span class="v">${esc(p.q)}</span></span>`);
      if (p.regexp_rest)   rows.push(`<span><span class="k">Regexp:</span><span class="v" style="font-family:ui-monospace,monospace">${esc(p.regexp_rest)}</span></span>`);
      if (p.correlation_id)rows.push(`<span><span class="k">Correlation:</span><span class="v">${esc(p.correlation_id)}</span></span>`);
      if (p.range)         rows.push(`<span><span class="k">Range:</span><span class="v">${esc(p.range)}</span></span>`);
      if (p.start && p.end && !p.range) rows.push(`<span><span class="k">Range:</span><span class="v">${esc(p.start)} → ${esc(p.end)}</span></span>`);
      return rows.join('') || '<span style="opacity:.5">No filters set</span>';
    },

    _historySummaryHtml(s) {
      const hist = Array.isArray(s?.history) && s.history.length
        ? s.history
        : [{ action:'create', by_name: s?.created_by_name || s?.created_by || '—', at: s?.created_at || 0, changes: [] }];
      const latest = hist[hist.length - 1];
      const actionLabel = latest.action === 'edit' ? 'edited' : 'added';
      const who = esc(latest.by_name || latest.by || '—');
      const rel = this._relTime(latest.at);
      let changeHint = '';
      if (latest.action === 'edit' && Array.isArray(latest.changes) && latest.changes.length) {
        const fields = latest.changes.map(c => (c.field||'').replace(/^params\./,'')).slice(0,3).join(', ');
        const extra = latest.changes.length > 3 ? ` +${latest.changes.length - 3}` : '';
        changeHint = ` · <span style="color:var(--text)">${esc(fields)}${extra}</span>`;
      }
      const moreBtn = hist.length > 1
        ? ` · <button class="le-saves-activity-more" onclick="LE.showHistory('${esc(s.id)}')">show more (${hist.length})</button>`
        : '';
      return `Last ${actionLabel} by <b style="color:var(--text)">${who}</b> · ${esc(rel)}${changeHint}${moreBtn}`;
    },

    async saveSearch() {
      const name = $('le-save-name').value.trim();
      const errEl = $('le-save-err');
      const btn   = $('le-save-submit-btn');
      errEl.style.display = 'none';
      if (!name) { errEl.textContent = 'Please enter a name'; errEl.style.display = 'block'; return; }
      const folderId = $('le-save-folder').value || null;
      btn.disabled = true; btn.textContent = 'Saving…';
      const res = await API.opensearch.savedSearches.create({ name, folder_id: folderId, params: this.lastQuery });
      if (!res?.ok) {
        btn.disabled = false; btn.textContent = 'Save to team';
        errEl.textContent = res?.data?.message || 'Failed to save';
        errEl.style.display = 'block';
        return;
      }
      // Push into local cache so the list reflects it without a full reload
      if (res.data?.data) this._allSavedSearches.unshift(res.data.data);
      this._renderFoldersBar();
      this.hideSaveDialog();
      if (window.showToast) showToast(`Search "${name}" saved to team`, 'success');
    },

    // ── Save By SM tab ───────────────────────────────────────────────────
    _allSavedSearches: [],
    _allFolders:      [],
    _folderFilter:    'all',  // 'all' | '__none__' | <folder-id>

    async loadSavedSearches() {
      $('le-saves-wrap').innerHTML = `<div class="lv-msg"><span class="lv-spinner"></span> Loading…</div>`;
      const [sRes, fRes] = await Promise.all([
        API.opensearch.savedSearches.list(),
        API.opensearch.savedFolders.list(),
      ]);
      if (!sRes?.ok) {
        $('le-saves-wrap').innerHTML = `<div class="lv-msg err">Failed to load: ${esc(sRes?.data?.message || 'unknown')}</div>`;
        return;
      }
      this._allSavedSearches = sRes.data?.data?.searches || [];
      this._allFolders       = fRes?.ok ? (fRes.data?.data?.folders || []) : [];
      if ($('le-saves-q')) $('le-saves-q').value = '';
      this._renderFoldersBar();
      this._renderSavesList(this._allSavedSearches);
    },

    _folderName(id) {
      if (!id) return 'Uncategorized';
      const f = this._allFolders.find(x => x.id === id);
      return f ? f.name : 'Uncategorized';
    },

    _renderFoldersBar() {
      const bar = $('le-folders-bar');
      if (!bar) return;
      const searches = this._allSavedSearches;
      const totalAll  = searches.length;
      const totalNone = searches.filter(s => !s.folder_id).length;
      const countsByFolder = new Map();
      searches.forEach(s => {
        if (s.folder_id) countsByFolder.set(s.folder_id, (countsByFolder.get(s.folder_id) || 0) + 1);
      });
      const active = this._folderFilter;
      const chips = [];
      chips.push(`<button class="le-folder-chip${active==='all'?' active':''}" onclick="LE._pickFolder('all')">All <span class="n">${totalAll}</span></button>`);
      chips.push(`<button class="le-folder-chip${active==='__none__'?' active':''}" onclick="LE._pickFolder('__none__')">Uncategorized <span class="n">${totalNone}</span></button>`);
      this._allFolders.forEach(f => {
        const n = countsByFolder.get(f.id) || 0;
        chips.push(`<button class="le-folder-chip${active===f.id?' active':''}" onclick="LE._pickFolder('${esc(f.id)}')" title="${esc(f.name)}">${esc(f.name)} <span class="n">${n}</span></button>`);
      });
      bar.innerHTML = chips.join('');
    },

    _pickFolder(id) {
      this._folderFilter = id;
      this._renderFoldersBar();
      this._filterSaves();
    },

    // Themed prompt — replaces window.prompt (which renders as the browser's
    // native dialog and looks out of place on this app).
    _promptResolve: null,
    _prompt(title, { label = 'Value', defaultValue = '', maxLength = 80, placeholder = '' } = {}) {
      return new Promise(resolve => {
        this._promptResolve = resolve;
        $('le-prompt-title').textContent = title;
        $('le-prompt-label').textContent = label;
        const input = $('le-prompt-input');
        input.value = defaultValue;
        input.maxLength = maxLength;
        input.placeholder = placeholder;
        $('le-prompt-ovl').style.display = 'flex';
        setTimeout(() => { input.focus(); input.select(); }, 50);
      });
    },
    _promptOk() {
      const v = $('le-prompt-input').value;
      $('le-prompt-ovl').style.display = 'none';
      const r = this._promptResolve; this._promptResolve = null;
      if (r) r(v);
    },
    _promptCancel() {
      $('le-prompt-ovl').style.display = 'none';
      const r = this._promptResolve; this._promptResolve = null;
      if (r) r(null);
    },

    async _ensureFoldersLoaded() {
      if (this._allFolders?.length) return;
      const res = await API.opensearch.savedFolders.list();
      if (res?.ok) this._allFolders = res.data?.data?.folders || [];
    },

    _populateFolderSelect(selectId, currentId = '') {
      const sel = $(selectId);
      if (!sel) return;
      const opts = [`<option value="">— Uncategorized —</option>`]
        .concat(this._allFolders.map(f =>
          `<option value="${esc(f.id)}"${f.id === currentId ? ' selected' : ''}>${esc(f.name)}</option>`
        ));
      sel.innerHTML = opts.join('');
      sel.value = currentId || '';
    },

    // Toggle the inline "new folder" row inside Save/Edit dialogs.
    // `which` is 'save' or 'edit'.
    _toggleNewFolder(which, show) {
      const row = $(`le-${which}-newfld-row`);
      const btn = $(`le-${which}-newfld-btn`);
      const input = $(`le-${which}-newfld-name`);
      const err = $(`le-${which}-newfld-err`);
      if (!row) return;
      row.style.display = show ? '' : 'none';
      if (btn) btn.style.display = show ? 'none' : '';
      if (err) { err.style.display = 'none'; err.textContent = ''; }
      if (input) {
        input.value = '';
        if (show) setTimeout(() => input.focus(), 30);
      }
    },

    async _submitNewFolder(which) {
      const input = $(`le-${which}-newfld-name`);
      const err   = $(`le-${which}-newfld-err`);
      const name  = (input?.value || '').trim();
      if (!name) { err.textContent = 'Folder name is required'; err.style.display = 'block'; return; }
      const res = await API.opensearch.savedFolders.create({ name });
      if (!res?.ok) {
        err.textContent = res?.data?.message || 'Create folder failed';
        err.style.display = 'block';
        return;
      }
      const newF = res.data?.data;
      if (newF) this._allFolders.push(newF);
      const selectId = which === 'edit' ? 'le-edit-folder' : 'le-save-folder';
      this._populateFolderSelect(selectId, newF?.id || '');
      this._renderFoldersBar();
      this._toggleNewFolder(which, false);
      if (window.showToast) showToast(`Folder "${newF?.name}" created`, 'success');
    },

    // ── Manage Folders dialog ────────────────────────────────────────────
    async showFoldersDialog() {
      await this._ensureFoldersLoaded();
      $('le-fld-new-name').value = '';
      $('le-fld-err').style.display = 'none';
      this._renderFoldersManage();
      $('le-fld-ovl').style.display = 'flex';
      setTimeout(() => $('le-fld-new-name').focus(), 50);
    },
    hideFoldersDialog() { $('le-fld-ovl').style.display = 'none'; },

    _renderFoldersManage() {
      const wrap = $('le-fld-list');
      if (!this._allFolders.length) {
        wrap.innerHTML = `<div class="le-saves-empty">ยังไม่มี folder — สร้างอันแรกด้านบน</div>`;
        return;
      }
      const countsByFolder = new Map();
      this._allSavedSearches.forEach(s => {
        if (s.folder_id) countsByFolder.set(s.folder_id, (countsByFolder.get(s.folder_id) || 0) + 1);
      });
      wrap.innerHTML = this._allFolders.map(f => {
        const n = countsByFolder.get(f.id) || 0;
        const jsName = f.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<div class="le-fld-row">
          <div class="le-fld-row-name">${esc(f.name)}</div>
          <div class="meta">${n} search${n !== 1 ? 'es' : ''}</div>
          <button class="le-btn" onclick="LE._renameFolder('${esc(f.id)}','${esc(jsName)}')">Rename</button>
          <button class="le-btn danger" onclick="LE._deleteFolder('${esc(f.id)}','${esc(jsName)}')">Delete</button>
        </div>`;
      }).join('');
    },

    async _createFolder() {
      const name = $('le-fld-new-name').value.trim();
      const errEl = $('le-fld-err');
      errEl.style.display = 'none';
      if (!name) { errEl.textContent = 'Folder name is required'; errEl.style.display = 'block'; return; }
      const res = await API.opensearch.savedFolders.create({ name });
      if (!res?.ok) {
        errEl.textContent = res?.data?.message || 'Create failed';
        errEl.style.display = 'block';
        return;
      }
      if (res.data?.data) this._allFolders.push(res.data.data);
      $('le-fld-new-name').value = '';
      this._renderFoldersManage();
      this._renderFoldersBar();
      if (window.showToast) showToast('Folder created', 'success');
    },

    async _renameFolder(id, currentName) {
      const next = await this._prompt('Rename Folder', { label: 'New name', defaultValue: currentName, maxLength: 60 });
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === currentName) return;
      const res = await API.opensearch.savedFolders.update(id, { name: trimmed });
      if (!res?.ok) {
        if (window.showToast) showToast(res?.data?.message || 'Rename failed', 'error');
        return;
      }
      const i = this._allFolders.findIndex(f => f.id === id);
      if (i >= 0 && res.data?.data) this._allFolders[i] = res.data.data;
      this._renderFoldersManage();
      this._renderFoldersBar();
      this._filterSaves();
      if (window.showToast) showToast('Folder renamed', 'success');
    },

    async _deleteFolder(id, name) {
      const count = this._allSavedSearches.filter(s => s.folder_id === id).length;
      const msg = count
        ? `ลบ folder <b>${esc(name)}</b>?<br><span style="font-size:12px;color:var(--text-muted)">Saved search ${count} รายการภายใน folder นี้จะย้ายไปที่ <b>Uncategorized</b> (ไม่ถูกลบ)</span>`
        : `ลบ folder <b>${esc(name)}</b>?`;
      const ok = await this._confirm(msg, { title: 'ลบ Folder', okLabel: 'ลบ', okClass: 'danger', icon: 'danger' });
      if (!ok) return;
      const res = await API.opensearch.savedFolders.remove(id);
      if (!res?.ok) {
        if (window.showToast) showToast(res?.data?.message || 'ลบไม่สำเร็จ', 'error');
        return;
      }
      this._allFolders = this._allFolders.filter(f => f.id !== id);
      // Locally un-folder any cached searches referencing this folder
      this._allSavedSearches.forEach(s => { if (s.folder_id === id) s.folder_id = null; });
      if (this._folderFilter === id) this._folderFilter = 'all';
      this._renderFoldersManage();
      this._renderFoldersBar();
      this._filterSaves();
      if (window.showToast) showToast(`ลบ folder "${name}" แล้ว`, 'success');
    },

    _filterSaves() {
      const q = ($('le-saves-q')?.value || '').toLowerCase().trim();
      const fold = this._folderFilter || 'all';
      const filtered = this._allSavedSearches.filter(s => {
        if (fold === '__none__' && s.folder_id) return false;
        if (fold !== 'all' && fold !== '__none__' && s.folder_id !== fold) return false;
        if (q && !(s.name || '').toLowerCase().includes(q)) return false;
        return true;
      });
      this._renderSavesList(filtered, q);
    },

    _renderSavesList(searches, highlight = '') {
      const total = this._allSavedSearches.length;
      $('le-saves-count').textContent = searches.length < total
        ? `${searches.length} / ${total} รายการ`
        : `${total} saved search${total !== 1 ? 'es' : ''}`;
      if (!total) {
        $('le-saves-wrap').innerHTML = `<div class="le-saves-empty">ยังไม่มี saved search — ค้นหา log แล้วกด <b>Save Search</b></div>`;
        return;
      }
      if (!searches.length) {
        $('le-saves-wrap').innerHTML = `<div class="le-saves-empty">ไม่พบรายการที่ตรงกับคำค้นหา</div>`;
        return;
      }
      const rows = searches.map(s => {
        const p  = s.params || {};
        const ep = this.endpoints.find(e => e.id === p.endpoint_id);
        const badges = [
          ep              ? `<span class="le-saves-param" style="color:#f26419;background:color-mix(in srgb,#f26419 10%,transparent)">${esc(ep.name)}</span>` : '',
          p.index_pattern ? `<span class="le-saves-param">${esc(p.index_pattern)}</span>` : '',
          p.module        ? `<span class="le-saves-param">module: ${esc(p.module)}</span>` : '',
          p.log_level     ? `<span class="le-saves-param">${esc(p.log_level)}</span>` : '',
          p.range         ? `<span class="le-saves-param">${esc(p.range)}</span>` : '',
          p.q             ? `<span class="le-saves-param">q: ${esc(p.q.length>28?p.q.slice(0,28)+'…':p.q)}</span>` : '',
          p.regexp_rest   ? `<span class="le-saves-param">rx: ${esc(p.regexp_rest.length>20?p.regexp_rest.slice(0,20)+'…':p.regexp_rest)}</span>` : '',
        ].filter(Boolean).join('');
        let nameHtml = esc(s.name);
        if (highlight) {
          try {
            const rx = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
            nameHtml = nameHtml.replace(rx, '<mark style="background:color-mix(in srgb,#f59e0b 40%,transparent);border-radius:2px;padding:0 1px">$1</mark>');
          } catch {}
        }
        const date = s.created_at ? new Date(s.created_at*1000).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
        const history = Array.isArray(s.history) && s.history.length
          ? s.history
          : [{ action:'create', by_name: s.created_by_name || s.created_by || '—', at: s.created_at || 0, changes: [] }];
        const latest = history[history.length - 1];
        const actionLabel = latest.action === 'edit' ? 'edited' : 'added';
        const relTime = this._relTime(latest.at);
        let changeHint = '';
        if (latest.action === 'edit' && Array.isArray(latest.changes) && latest.changes.length) {
          const fields = latest.changes.map(c => (c.field || '').replace(/^params\./, '')).slice(0, 2).join(', ');
          const extra = latest.changes.length > 2 ? ` +${latest.changes.length - 2}` : '';
          changeHint = ` · <span>${esc(fields)}${extra}</span>`;
        }
        const moreBtn = history.length > 1
          ? ` · <button class="le-saves-activity-more" onclick="LE.showHistory('${esc(s.id)}')">show more (${history.length})</button>`
          : '';
        const folderName = this._folderName(s.folder_id);
        const folderBadge = `<span class="le-folder-badge" title="Folder: ${esc(folderName)}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${esc(folderName)}</span>`;
        return `<div class="le-saves-row">
          <div>
            <div class="le-saves-row-name">${nameHtml}</div>
            <div class="le-saves-row-params">${folderBadge}${badges}</div>
            <div class="le-saves-activity">
              ${actionLabel} by <b>${esc(latest.by_name || latest.by || '—')}</b> · ${esc(relTime)}${changeHint}${moreBtn}
            </div>
          </div>
          <div class="le-saves-row-by">${esc(s.created_by_name || s.created_by || '—')}</div>
          <div class="le-saves-row-date">${date}</div>
          <div class="le-saves-row-actions">
            <button class="le-btn primary" onclick="LE.runSavedSearch('${esc(s.id)}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run
            </button>
            <button class="le-btn" onclick="LE.copySavedLink('${esc(s.id)}')" title="Copy shareable link">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Link
            </button>
            <button class="le-btn" onclick="LE.showEditDialog('${esc(s.id)}')" title="Edit name">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg> Edit
            </button>
            <button class="le-btn danger" onclick="LE.deleteSavedSearch('${esc(s.id)}','${esc(s.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'"))}')">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete
            </button>
          </div>
        </div>`;
      }).join('');
      $('le-saves-wrap').innerHTML = `
        <div class="le-saves-hdr">
          <span>ชื่อ / Params</span><span>สร้างโดย</span><span>วันที่</span><span></span>
        </div>
        <div class="le-saves-list">${rows}</div>`;
    },

    runSavedSearch(id) {
      const run = (searches) => {
        const s = searches.find(x => x.id === id);
        if (!s) { if (window.showToast) showToast('Search not found', 'error'); return; }
        this._applyParams(s.params || {});
        this.switchTab('search');
        try {
          const qs = new URLSearchParams({ saved: id });
          history.replaceState(null, '', `${location.pathname}?${qs.toString()}`);
        } catch {}
        this.search({ skipUrl: true });
      };
      if (this._allSavedSearches.length) { run(this._allSavedSearches); }
      else { API.opensearch.savedSearches.list().then(res => run(res?.data?.data?.searches || [])); }
    },

    _relTime(ts) {
      if (!ts) return '—';
      const sec = Math.max(0, Math.floor(Date.now()/1000 - ts));
      if (sec < 60)     return `${sec}s ago`;
      if (sec < 3600)   return `${Math.floor(sec/60)}m ago`;
      if (sec < 86400)  return `${Math.floor(sec/3600)}h ago`;
      if (sec < 604800) return `${Math.floor(sec/86400)}d ago`;
      return new Date(ts*1000).toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'2-digit' });
    },

    _editingId: null,
    async showEditDialog(id) {
      const s = this._allSavedSearches.find(x => x.id === id);
      if (!s) return;
      this._editingId = id;
      $('le-edit-name').value = s.name || '';
      $('le-edit-err').style.display = 'none';
      $('le-edit-submit-btn').disabled = false;
      $('le-edit-submit-btn').textContent = 'Save changes';
      if (!this._allFolders?.length) await this._ensureFoldersLoaded();
      this._populateFolderSelect('le-edit-folder', s.folder_id || '');
      this._toggleNewFolder('edit', false);
      this._populateEditFilters(s.params || {});
      $('le-edit-activity').innerHTML = this._historySummaryHtml(s);
      $('le-edit-ovl').style.display = 'flex';
      setTimeout(() => { const el = $('le-edit-name'); el.focus(); el.select(); }, 50);
    },
    hideEditDialog() { $('le-edit-ovl').style.display = 'none'; this._editingId = null; },

    _populateEditFilters(p) {
      const epSel = $('le-edit-endpoint');
      epSel.innerHTML = this.endpoints.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
      epSel.value = p.endpoint_id || (this.endpoints[0]?.id || '');
      this._onEditEndpointChange(p.index_pattern || '');
      $('le-edit-module').value  = p.module || '';
      $('le-edit-lvl').value     = p.log_level || '';
      $('le-edit-q').value       = p.q || '';
      $('le-edit-cid').value     = p.correlation_id || '';
      $('le-edit-regexp').value  = p.regexp_rest || '';
      const range = p.range || 'last_15m';
      const rangeSel = $('le-edit-range');
      if ([...rangeSel.options].some(o => o.value === range)) rangeSel.value = range;
      else rangeSel.value = 'last_15m';
    },

    _onEditEndpointChange(keepIndex) {
      const ep = this.endpoints.find(e => e.id === $('le-edit-endpoint').value);
      const idxSel = $('le-edit-index');
      if (!ep) { idxSel.innerHTML = '<option value="">—</option>'; return; }
      const patterns = (ep.index_patterns?.length ? ep.index_patterns : [ep.default_index_pattern]).filter(Boolean);
      idxSel.innerHTML = patterns.map(ix => `<option value="${esc(ix)}">${esc(ix)}</option>`).join('');
      const want = typeof keepIndex === 'string' ? keepIndex : '';
      if (want && [...idxSel.options].some(o => o.value === want)) idxSel.value = want;
      else if (ep.default_index_pattern) idxSel.value = ep.default_index_pattern;
    },

    _readEditFilters() {
      const p = {
        endpoint_id:    $('le-edit-endpoint').value,
        index_pattern:  $('le-edit-index').value,
        module:         $('le-edit-module').value.trim() || undefined,
        log_level:      $('le-edit-lvl').value || undefined,
        q:              $('le-edit-q').value.trim() || undefined,
        correlation_id: $('le-edit-cid').value.trim() || undefined,
        regexp_rest:    this._parseRegexpInput($('le-edit-regexp').value) || undefined,
        range:          $('le-edit-range').value,
      };
      Object.keys(p).forEach(k => p[k] === undefined && delete p[k]);
      return p;
    },

    _copyFiltersFromMain() {
      const p = this._params();
      // Custom start/end from main form doesn't map to edit's range dropdown; fall back to last_15m if custom.
      if (!p.range && p.start && p.end) p.range = 'last_15m';
      this._populateEditFilters(p);
    },

    async submitEdit() {
      const id = this._editingId;
      if (!id) return;
      const name = $('le-edit-name').value.trim();
      const folderId = $('le-edit-folder').value || null;
      const errEl = $('le-edit-err');
      const btn   = $('le-edit-submit-btn');
      errEl.style.display = 'none';
      if (!name) { errEl.textContent = 'Please enter a name'; errEl.style.display = 'block'; return; }
      const current = this._allSavedSearches.find(x => x.id === id);
      const nameSame   = current && name === current.name;
      const folderSame = current && folderId === (current.folder_id || null);
      const newParams  = this._readEditFilters();
      if (!newParams.endpoint_id) { errEl.textContent = 'Endpoint is required'; errEl.style.display = 'block'; return; }
      const oldParams  = current?.params || {};
      const paramKeys  = ['endpoint_id','index_pattern','module','log_level','q','correlation_id','regexp_rest','range'];
      const paramsSame = paramKeys.every(k => (oldParams[k] ?? '') === (newParams[k] ?? ''));
      if (nameSame && folderSame && paramsSame) { this.hideEditDialog(); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      const payload = {};
      if (!nameSame)   payload.name = name;
      if (!folderSame) payload.folder_id = folderId;
      if (!paramsSame) payload.params = newParams;
      const res = await API.opensearch.savedSearches.update(id, payload);
      if (!res?.ok) {
        btn.disabled = false; btn.textContent = 'Save changes';
        errEl.textContent = res?.data?.message || 'Failed to update';
        errEl.style.display = 'block';
        return;
      }
      const updated = res.data?.data;
      if (updated) {
        const i = this._allSavedSearches.findIndex(x => x.id === id);
        if (i >= 0) this._allSavedSearches[i] = updated;
      }
      this.hideEditDialog();
      this._renderFoldersBar();
      this._filterSaves();
      if (window.showToast) showToast(`Updated "${name}"`, 'success');
    },

    showHistory(id) {
      const s = this._allSavedSearches.find(x => x.id === id);
      if (!s) return;
      const hist = Array.isArray(s.history) ? [...s.history].reverse() : [];
      $('le-hist-title').textContent = `History · ${s.name}`;
      const fmtVal = v => {
        if (v === null || v === undefined || v === '') return '<em style="opacity:.6">(empty)</em>';
        const str = typeof v === 'string' ? v : JSON.stringify(v);
        return esc(str.length > 60 ? str.slice(0,60) + '…' : str);
      };
      const items = hist.map(h => {
        const when = h.at ? new Date(h.at*1000).toLocaleString('th-TH') : '—';
        const changes = Array.isArray(h.changes) && h.changes.length
          ? `<ul class="le-history-changes">${h.changes.map(c => `
              <li><span class="field">${esc((c.field||'').replace(/^params\./,''))}</span>:
                <span class="from">${fmtVal(c.from)}</span>
                → <span class="to">${fmtVal(c.to)}</span></li>`).join('')}</ul>`
          : (h.action === 'create' ? '' : '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">no field-level detail</div>');
        return `<div class="le-history-item">
          <div class="le-history-item-head">
            <div><span class="le-history-action ${esc(h.action||'edit')}">${esc(h.action||'edit')}</span><b>${esc(h.by_name || h.by || '—')}</b></div>
            <div class="t">${esc(when)}</div>
          </div>
          ${changes}
        </div>`;
      }).join('');
      $('le-hist-body').innerHTML = `<div class="le-history-list">${items || '<div class="le-saves-empty" style="padding:16px">No history</div>'}</div>`;
      $('le-hist-ovl').style.display = 'flex';
    },
    hideHistoryDialog() { $('le-hist-ovl').style.display = 'none'; },

    async deleteSavedSearch(id, name) {
      const ok = await this._confirm(
        `ลบ <b>${esc(name)}</b> ออกจาก Save By SM?<br><span style="font-size:12px;color:var(--text-muted)">ทุกคนใน SM Team จะไม่เห็น search นี้อีกต่อไป</span>`,
        { title: 'ลบ Saved Search', okLabel: 'ลบ', okClass: 'danger', icon: 'danger' }
      );
      if (!ok) return;
      const res = await API.opensearch.savedSearches.remove(id);
      if (res?.ok) {
        if (window.showToast) showToast(`ลบ "${name}" แล้ว`, 'success');
        // Remove from cache and re-render without full reload
        this._allSavedSearches = this._allSavedSearches.filter(s => s.id !== id);
        this._filterSaves();
      } else {
        if (window.showToast) showToast(res?.data?.message || 'ลบไม่สำเร็จ', 'error');
      }
    },
  };

  // Enter in gate inputs submits login
  ['le-gate-user', 'le-gate-pass'].forEach(id => {
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') LE.gateLogin(); });
  });

  // Enter in text inputs re-runs search
  ['le-q', 'le-cid', 'le-module', 'le-regexp'].forEach(id => {
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); LE.search(); } });
  });
  ['le-endpoint', 'le-index', 'le-range', 'le-lvl'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      if (id === 'le-range') {
        LE._bucketRange = null;
        const isCustom = $('le-range').value === 'custom';
        $('le-custom-start').style.display = isCustom ? '' : 'none';
        $('le-custom-end').style.display   = isCustom ? '' : 'none';
        if (isCustom) { $('le-custom-start').focus(); return; }
      }
      if (id !== 'le-endpoint') LE.search();
    });
  });
  ['le-custom-start', 'le-custom-end'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      if ($('le-custom-start').value && $('le-custom-end').value) LE.search();
    });
  });
  // Enter key in credential/save dialog inputs
  ['le-cred-pass'].forEach(id => {
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') LE.saveCredentials(); });
  });
  ['le-save-name'].forEach(id => {
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') LE.saveSearch(); });
  });
  $('le-edit-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') LE.submitEdit(); });
  $('le-fld-new-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') LE._createFolder(); });
  $('le-save-newfld-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); LE._submitNewFolder('save'); }
    if (e.key === 'Escape') LE._toggleNewFolder('save', false);
  });
  $('le-edit-newfld-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); LE._submitNewFolder('edit'); }
    if (e.key === 'Escape') LE._toggleNewFolder('edit', false);
  });
  $('le-prompt-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  LE._promptOk();
    if (e.key === 'Escape') LE._promptCancel();
  });
  // Esc closes dialogs
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('le-cred-ovl')?.style.display !== 'none') { LE.hideCredDialog(); return; }
    if ($('le-save-ovl')?.style.display !== 'none') { LE.hideSaveDialog(); }
  });

  // Boot
  LE.init();
})();

})();
