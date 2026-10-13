// admin/ma-status — page script, extracted from admin/ma-status.html.
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
  Layout.render('admin-ma-status');

  const AdminMA = {
    jobs: [],
    jobsSource: 'default',
    servers: [],
    editingIdx: -1,

    // Mapping state
    services: [],       // ma-services rows (Admin Portal type)
    backoffice: [],     // all backoffice items (matched + unmapped)
    boById: {},
    selectedSvcId: null,
    selectedUseCaseId: null,

    // Hide-items state
    hideMap:      { nano: [], tmn_jenkins: [], tmn_features: [], tmn_backoffice: [] },
    hideMapSaved: { nano: [], tmn_jenkins: [], tmn_features: [], tmn_backoffice: [] },
    hideSrcItems: { nano: [], tmn_jenkins: [], tmn_features: [], tmn_backoffice: [] },
    hideSrc: 'nano',
    hideDirty: false,

    init() {
      this.loadJobs();
      this.loadMap();
      this.loadHide();
    },

    switchTab(name) {
      document.querySelectorAll('.msta-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      document.getElementById('panel-jobs').style.display = name === 'jobs' ? '' : 'none';
      document.getElementById('panel-map').style.display  = name === 'map'  ? '' : 'none';
      document.getElementById('panel-hide').style.display = name === 'hide' ? '' : 'none';
    },

    // ─── Jenkins Jobs ───────────────────────────────────────────
    async loadJobs() {
      try {
        const [jobsRes, srvRes] = await Promise.all([
          API.get('/ma-status/jenkins-jobs.php'),
          API.get('/jenkins-servers/index.php'),
        ]);
        if (!jobsRes.ok) throw new Error(jobsRes.data?.message || 'Load jobs failed');
        this.jobs = jobsRes.data.data.jobs || [];
        this.jobsSource = jobsRes.data.data.source || 'default';
        this.servers = (srvRes.ok ? (srvRes.data.data || srvRes.data) : []) || [];
        this.renderJobs();
      } catch (e) {
        this.toast(e.message, true);
      }
    },

    renderJobs() {
      document.getElementById('tab-jobs-cnt').textContent = this.jobs.length;
      const badge = document.getElementById('jobs-source-badge');
      badge.textContent = this.jobsSource === 'override' ? 'Source: team override' : 'Source: hardcoded defaults (unsaved)';
      badge.style.color = this.jobsSource === 'override' ? 'var(--ok)' : 'var(--text-muted)';

      const tbody = document.getElementById('jobs-tbody');
      if (!this.jobs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="msta-empty">no jobs configured</td></tr>';
        return;
      }
      tbody.innerHTML = this.jobs.map((j, i) => `
        <tr>
          <td>
            <div style="font-weight:700;color:var(--text)">${esc(j.label)}</div>
            ${j.note ? `<div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">${esc(j.note)}</div>` : ''}
          </td>
          <td><span class="chip src">${esc(j.server)}</span></td>
          <td class="mono">${esc(j.path)}</td>
          <td><span class="chip">${esc(j.state_param)}</span></td>
          <td>${(j.on_values || []).map(v => `<span class="chip">${esc(String(v))}</span>`).join('')}</td>
          <td>
            ${j.critical ? '<span class="chip crit">CRIT</span>' : ''}
            ${j.extra_param ? `<span class="chip">+${esc(j.extra_param)}</span>` : ''}
          </td>
          <td class="actions">
            <button onclick="AdminMA.openJobModal(${i})">Edit</button>
            <button class="danger" onclick="AdminMA.deleteJob(${i})">Delete</button>
          </td>
        </tr>
      `).join('');
    },

    openJobModal(idx) {
      this.editingIdx = idx;
      const j = idx === null ? { on_values: ['1','true'] } : this.jobs[idx];
      document.getElementById('job-modal-title').textContent = idx === null ? 'Add Jenkins Job' : 'Edit Jenkins Job';

      // Server dropdown from real jenkins-servers list
      const opts = this.servers.map(s =>
        `<option value="${esc(s.display)}" ${s.display === j.server ? 'selected' : ''}>${esc(s.display)} — ${esc(s.base_url || '')}</option>`
      ).join('');
      document.getElementById('jm-server').innerHTML = `<option value="">— select —</option>` + opts;
      if (j.server && !this.servers.find(s => s.display === j.server)) {
        // Missing server — add as option anyway
        document.getElementById('jm-server').innerHTML += `<option value="${esc(j.server)}" selected>${esc(j.server)} (not in list!)</option>`;
      }

      document.getElementById('jm-label').value = j.label || '';
      document.getElementById('jm-path').value = j.path || '';
      document.getElementById('jm-state-param').value = j.state_param || 'IS_MAINTENANCE';
      document.getElementById('jm-on-values').value = (j.on_values || []).join(', ');
      document.getElementById('jm-extra-param').value = j.extra_param || '';
      document.getElementById('jm-critical').checked = !!j.critical;
      document.getElementById('jm-note').value = j.note || '';

      document.getElementById('job-modal').classList.add('open');
    },

    closeJobModal() {
      document.getElementById('job-modal').classList.remove('open');
    },

    async saveJob() {
      const j = {
        label: document.getElementById('jm-label').value.trim(),
        server: document.getElementById('jm-server').value.trim(),
        path: document.getElementById('jm-path').value.trim(),
        state_param: document.getElementById('jm-state-param').value.trim(),
        on_values: document.getElementById('jm-on-values').value.split(',').map(s => s.trim()).filter(Boolean),
        extra_param: document.getElementById('jm-extra-param').value.trim() || null,
        critical: document.getElementById('jm-critical').checked,
        note: document.getElementById('jm-note').value.trim() || null,
      };
      if (!j.label || !j.server || !j.path || !j.state_param || !j.on_values.length) {
        this.toast('Please fill all required fields', true);
        return;
      }
      const list = this.jobs.slice();
      if (this.editingIdx === null) list.push(j);
      else list[this.editingIdx] = j;
      await this.saveJobsList(list);
      this.closeJobModal();
    },

    async deleteJob(idx) {
      if (!confirm(`Delete "${this.jobs[idx].label}"?`)) return;
      const list = this.jobs.slice();
      list.splice(idx, 1);
      await this.saveJobsList(list);
    },

    async resetJobs() {
      if (!confirm('Delete all overrides and revert to hardcoded defaults?')) return;
      await this.saveJobsList([]);
    },

    async saveJobsList(list) {
      try {
        const res = await API.put('/ma-status/jenkins-jobs.php', { jobs: list });
        if (!res.ok) throw new Error(res.data?.message || 'Save failed');
        this.jobs = res.data.data.jobs || [];
        this.jobsSource = res.data.data.source || 'default';
        this.renderJobs();
        this.toast(res.data.data.reset ? 'Reset to defaults' : `Saved ${res.data.data.saved || list.length} jobs`);
      } catch (e) {
        this.toast(e.message, true);
      }
    },

    // ─── Backoffice Mapping ─────────────────────────────────────
    async loadMap() {
      try {
        const res = await API.get('/ma-status/');
        if (!res.ok) throw new Error(res.data?.message || 'Load failed');
        const d = res.data.data;

        // Left column: all Admin Portal services from ma-services
        this.services = (d.services || []).filter(s => s.tool_type === 'Admin Portal');
        // Right column: unmapped + mapped backoffice items
        const bo = (d.sources?.tmn_backoffice?.items || []).concat([]);
        this.backoffice = bo;
        this.boById = {};
        bo.forEach(it => { this.boById[it.use_case_id] = it; });

        // Build a reverse map: service_id → linked use_case_id (from ma-services rows that matched)
        // Normalize service ids to strings — ma-services.json stores them as integers
        // but we compare against string values from onclick attributes.
        this.svcLink = {};
        for (const s of this.services) {
          const m = /use_case_id=(\d+)/.exec(s.upstream_ref || '');
          if (m) this.svcLink[String(s.id)] = parseInt(m[1], 10);
        }
        // Reverse: use_case_id → service_id
        this.boLink = {};
        for (const [sid, uid] of Object.entries(this.svcLink)) {
          this.boLink[uid] = sid;
        }

        this.renderMap();
      } catch (e) {
        this.toast(e.message, true);
      }
    },

    renderMap() {
      document.getElementById('tab-map-cnt').textContent = this.services.length;
      document.getElementById('ma-svc-cnt').textContent = this.services.length;
      document.getElementById('bo-cnt').textContent = this.backoffice.length;
      this.renderSvcList();
      this.renderBoList();
      this.updateActionBar();
    },

    filterSvc() { this.renderSvcList(); },
    filterBo()  { this.renderBoList(); },

    renderSvcList() {
      const q = document.getElementById('svc-search').value.toLowerCase().trim();
      const filtered = this.services.filter(s => !q || (s.service_name || '').toLowerCase().includes(q));
      const el = document.getElementById('svc-list');
      if (!filtered.length) { el.innerHTML = '<div class="msta-empty">no matches</div>'; return; }
      el.innerHTML = filtered.map(s => {
        const sid = String(s.id);
        const linked = this.svcLink[sid];
        const sel = sid === this.selectedSvcId;
        return `
          <div class="map-row ${sel ? 'selected' : ''} ${linked ? 'linked' : ''}" onclick="AdminMA.pickSvc('${esc(sid)}')">
            <span class="map-row-name">${esc(s.service_name)}</span>
            ${linked ? `<span class="map-row-badge link">→ ${linked}</span>` : ''}
            <span class="map-row-meta">${esc(s.service_type || '')}</span>
          </div>`;
      }).join('');
    },

    renderBoList() {
      const q = document.getElementById('bo-search').value.toLowerCase().trim();
      const filtered = this.backoffice.filter(it => {
        if (!q) return true;
        return (it.label || '').toLowerCase().includes(q) || String(it.use_case_id || '').includes(q);
      });
      const el = document.getElementById('bo-list');
      if (!filtered.length) { el.innerHTML = '<div class="msta-empty">no matches</div>'; return; }
      el.innerHTML = filtered.slice(0, 500).map(it => {
        const linkedSvc = this.boLink[it.use_case_id];
        const sel = it.use_case_id === this.selectedUseCaseId;
        return `
          <div class="map-row ${sel ? 'selected' : ''} ${linkedSvc ? 'linked' : ''}" onclick="AdminMA.pickBo(${it.use_case_id})">
            <span class="map-row-name">${esc(it.label || '')}</span>
            ${linkedSvc ? '<span class="map-row-badge link">linked</span>' : ''}
            <span class="map-row-meta">#${it.use_case_id}</span>
          </div>`;
      }).join('');
    },

    pickSvc(id) {
      this.selectedSvcId = String(id);
      this.renderSvcList();
      this.updateActionBar();
    },

    pickBo(id) {
      this.selectedUseCaseId = id;
      this.renderBoList();
      this.updateActionBar();
    },

    updateActionBar() {
      const sSvc = this.services.find(s => String(s.id) === this.selectedSvcId);
      const sBo  = this.selectedUseCaseId ? this.boById[this.selectedUseCaseId] : null;
      document.getElementById('sel-svc').textContent = sSvc ? sSvc.service_name : '— (pick a service)';
      document.getElementById('sel-bo').textContent = sBo ? `${sBo.label} · #${sBo.use_case_id}` : '— (pick a backoffice item)';

      const linked = sSvc && this.svcLink[String(sSvc.id)];
      document.getElementById('btn-link').disabled = !(sSvc && sBo);
      document.getElementById('btn-unlink').disabled = !linked;
      document.getElementById('btn-link').innerHTML = linked ? '<i data-icon="refresh-cw"></i> Replace link' : '<i data-icon="link"></i> Link';
    },

    async doLink() {
      if (!this.selectedSvcId || !this.selectedUseCaseId) return;
      try {
        const res = await API.post('/ma-status/mapping.php', {
          service_id: this.selectedSvcId,
          use_case_id: this.selectedUseCaseId,
        });
        if (!res.ok) throw new Error(res.data?.message || 'Link failed');
        this.toast('Linked <i data-icon="check"></i>');
        await this.loadMap();
      } catch (e) { this.toast(e.message, true); }
    },

    async doUnlink() {
      if (!this.selectedSvcId) return;
      try {
        const res = await API.post('/ma-status/mapping.php', {
          service_id: this.selectedSvcId,
          use_case_id: null,
        });
        if (!res.ok) throw new Error(res.data?.message || 'Unlink failed');
        this.toast('Unlinked <i data-icon="check"></i>');
        await this.loadMap();
      } catch (e) { this.toast(e.message, true); }
    },

    // ─── Hide Items ─────────────────────────────────────────────
    async loadHide() {
      try {
        // Fetch current hidden map + all source items. Force refresh so we see EVERY item
        // (dashboard endpoint normally filters hidden ones out — we call ?refresh=1 to
        // rebuild AND then use raw source counts from the response).
        // Actually: to list all items INCLUDING already-hidden ones, we need a separate
        // pass. Simplest: call the aggregator, then union the returned items with the
        // hidden keys so the UI can still render toggle rows for hidden ones.
        const [hRes, dRes] = await Promise.all([
          API.get('/ma-status/hidden.php'),
          API.get('/ma-status/?refresh=1'),
        ]);
        if (!hRes.ok) throw new Error(hRes.data?.message || 'Load hidden failed');
        if (!dRes.ok) throw new Error(dRes.data?.message || 'Load dashboard failed');

        const h = hRes.data.data || {};
        this.hideMap      = { nano: h.nano||[], tmn_jenkins: h.tmn_jenkins||[], tmn_features: h.tmn_features||[], tmn_backoffice: h.tmn_backoffice||[] };
        this.hideMapSaved = JSON.parse(JSON.stringify(this.hideMap));

        const data = dRes.data.data;
        // For each source, collect items. Hidden items were already filtered out by the
        // backend — reconstruct them as placeholder rows so the toggle can turn them ON.
        this.hideSrcItems = { nano: [], tmn_jenkins: [], tmn_features: [], tmn_backoffice: [] };

        // NANO
        for (const it of (data.sources?.nano?.items || [])) {
          this.hideSrcItems.nano.push({ key: it.name, label: it.label, status: it.status, meta: `${it.product} · ${it.sub_service}` });
        }
        for (const k of this.hideMap.nano || []) {
          if (!this.hideSrcItems.nano.find(x => x.key === k)) {
            this.hideSrcItems.nano.push({ key: k, label: k, status: 'unknown', meta: '(currently hidden)' });
          }
        }

        // Jenkins
        for (const it of (data.sources?.tmn_jenkins?.items || [])) {
          this.hideSrcItems.tmn_jenkins.push({ key: it.name, label: it.label, status: it.status, meta: it.link ? new URL(it.link).pathname : '' });
        }
        for (const k of this.hideMap.tmn_jenkins || []) {
          if (!this.hideSrcItems.tmn_jenkins.find(x => x.key === k)) {
            this.hideSrcItems.tmn_jenkins.push({ key: k, label: k, status: 'unknown', meta: '(currently hidden)' });
          }
        }

        // Features
        for (const it of (data.sources?.tmn_features?.items || [])) {
          this.hideSrcItems.tmn_features.push({ key: it.label, label: it.label, status: it.status, meta: `${it.method || ''} ${it.url_pattern || ''}` });
        }
        for (const k of this.hideMap.tmn_features || []) {
          if (!this.hideSrcItems.tmn_features.find(x => x.key === k)) {
            this.hideSrcItems.tmn_features.push({ key: k, label: k, status: 'unknown', meta: '(currently hidden)' });
          }
        }

        // Backoffice: use_case_id as key (int)
        for (const it of (data.sources?.tmn_backoffice?.items || [])) {
          this.hideSrcItems.tmn_backoffice.push({ key: it.use_case_id, label: it.label, status: it.status, meta: `#${it.use_case_id} · ${it.category || ''}` });
        }
        for (const k of this.hideMap.tmn_backoffice || []) {
          if (!this.hideSrcItems.tmn_backoffice.find(x => x.key === k)) {
            this.hideSrcItems.tmn_backoffice.push({ key: k, label: `use_case_id ${k}`, status: 'unknown', meta: '(currently hidden)' });
          }
        }

        this.hideDirty = false;
        this.updateHideDirty();
        this.updateHideCounts();
        document.getElementById('tab-hide-cnt').textContent =
          this.hideMap.nano.length + this.hideMap.tmn_jenkins.length + this.hideMap.tmn_features.length + this.hideMap.tmn_backoffice.length;
        this.renderHideList();
      } catch (e) {
        this.toast(e.message, true);
      }
    },

    pickHideSrc(src) {
      this.hideSrc = src;
      document.querySelectorAll('.hide-src').forEach(b => b.classList.toggle('active', b.dataset.src === src));
      document.getElementById('hide-search').value = '';
      this.renderHideList();
    },

    updateHideCounts() {
      for (const s of ['nano','tmn_jenkins','tmn_features','tmn_backoffice']) {
        document.getElementById('hs-' + s).textContent = this.hideMap[s].length;
      }
    },

    updateHideDirty() {
      const same = JSON.stringify(this.hideMap) === JSON.stringify(this.hideMapSaved);
      this.hideDirty = !same;
      document.getElementById('hide-dirty-badge').style.display = this.hideDirty ? '' : 'none';
    },

    renderHideList() {
      const src = this.hideSrc;
      const q = document.getElementById('hide-search').value.toLowerCase().trim();
      const items = (this.hideSrcItems[src] || []).slice()
        .filter(x => !q || String(x.label || '').toLowerCase().includes(q) || String(x.key).toLowerCase().includes(q))
        .sort((a,b) => String(a.label).localeCompare(String(b.label)));

      const el = document.getElementById('hide-list');
      if (!items.length) { el.innerHTML = '<div class="msta-empty">no matches</div>'; return; }
      const hidden = new Set(this.hideMap[src].map(String));
      el.innerHTML = items.map(x => {
        const isHidden = hidden.has(String(x.key));
        return `
          <div class="hide-row ${isHidden ? 'is-hidden' : ''}" data-key="${esc(String(x.key))}">
            <div class="hide-toggle ${isHidden ? 'off' : ''}" onclick="AdminMA.toggleHide('${esc(String(x.key))}')"></div>
            <span class="hide-row-status ${x.status}">${(x.status||'').toUpperCase()}</span>
            <span class="hide-row-name">${esc(x.label)}</span>
            ${isHidden ? '<span class="hide-row-badge">HIDDEN</span>' : ''}
            <span class="hide-row-meta">${esc(x.meta || '')}</span>
          </div>`;
      }).join('');
    },

    toggleHide(rawKey) {
      const src = this.hideSrc;
      // Coerce key to correct type for backoffice (int) vs others (string)
      const key = src === 'tmn_backoffice' ? parseInt(rawKey, 10) : rawKey;
      const arr = this.hideMap[src];
      const idx = arr.findIndex(v => (src === 'tmn_backoffice' ? Number(v) : String(v)) === key);
      if (idx >= 0) arr.splice(idx, 1);
      else          arr.push(key);
      this.updateHideCounts();
      this.updateHideDirty();
      this.renderHideList();
    },

    clearHideCurrentSource() {
      const src = this.hideSrc;
      if (!this.hideMap[src].length) return;
      if (!confirm(`Unhide all ${this.hideMap[src].length} items in ${src}?`)) return;
      this.hideMap[src] = [];
      this.updateHideCounts();
      this.updateHideDirty();
      this.renderHideList();
    },

    async saveHide() {
      try {
        const res = await API.put('/ma-status/hidden.php', this.hideMap);
        if (!res.ok) throw new Error(res.data?.message || 'Save failed');
        this.hideMap      = res.data.data || this.hideMap;
        this.hideMapSaved = JSON.parse(JSON.stringify(this.hideMap));
        this.updateHideCounts();
        this.updateHideDirty();
        document.getElementById('tab-hide-cnt').textContent =
          this.hideMap.nano.length + this.hideMap.tmn_jenkins.length + this.hideMap.tmn_features.length + this.hideMap.tmn_backoffice.length;
        this.renderHideList();
        this.toast('Saved <i data-icon="check"></i>');
      } catch (e) { this.toast(e.message, true); }
    },

    // ─── UI helpers ─────────────────────────────────────────────
    toast(msg, err) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'msta-toast show' + (err ? ' err' : '');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.className = 'msta-toast', 2200);
    },
  };

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  AdminMA.init();
  window.AdminMA = AdminMA;

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "esc", { configurable: true, get: () => esc, set: (v) => { esc = v; } }); } catch (e) {}
})();
