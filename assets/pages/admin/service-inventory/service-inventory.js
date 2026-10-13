// admin/service-inventory — page script, extracted from admin/service-inventory.html.
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
  Layout.render('service-inventory');

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function toast(msg, kind = 'ok') {
    const t = document.createElement('div');
    t.className = 'si-toast ' + kind;
    t.textContent = msg;
    $('si-toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = '.3s'; }, 3200);
    setTimeout(() => t.remove(), 3600);
  }
  function fmtBytes(n) {
    if (!n) return '—';
    const u = ['B','KB','MB','GB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[i];
  }
  function fmtRel(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - t);
    const min = Math.floor(diff / 60000);
    const hr  = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    if (day >= 1) return day + (day === 1 ? ' day ago' : ' days ago');
    if (hr >= 1)  return hr + (hr === 1 ? ' hr ago' : ' hrs ago');
    if (min >= 1) return min + ' min ago';
    return 'just now';
  }
  function fmtAbs(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
  }
  function sevClass(sev) {
    if (!sev || sev === '-') return '';
    const n = parseInt(sev, 10);
    return n === 1 ? 'sev1' : n === 2 ? 'sev2' : 'sev3';
  }

  const SI = window.SI = {
    rows: [],
    meta: null,
    pendingFile: null,

    async init() {
      $('si-download-current').href = API.serviceInventory.downloadUrl();
      await Promise.all([this.loadList(), this.loadHistory(), this._loadSheetLink()]);
      this._wireDrop();
      this._wireFilter();
    },

    // Reuse the service-performance /list endpoint just to pluck the sheet URL
    // (config field `sheetOpenUrl`). Failing quietly is fine — the link is a
    // nice-to-have, not required for the upload flow.
    async _loadSheetLink() {
      try {
        const res = await API.servicePerformance.list('all');
        const url = res?.data?.data?.sheetOpenUrl || res?.data?.data?.sheetEmbedUrl || '';
        if (!url) return;
        $('si-source-sheet').href = url;
        $('si-source-sheet').style.display = '';
        $('si-help-sheet-link').href = url;
        $('si-help').style.display = 'block';
      } catch (_) { /* silent */ }
    },

    async loadList() {
      $('si-tbody').innerHTML = '';
      const res = await API.serviceInventory.list('', '');
      if (!res?.ok) { toast('โหลดไม่สำเร็จ', 'err'); return; }
      const data = res.data?.data || {};
      this.rows = data.rows || [];
      this.meta = data.meta || null;
      this._renderMeta();
      this._renderRunwayFilter();
      this._renderTable();
    },

    async loadHistory() {
      const res = await API.serviceInventory.history();
      if (!res?.ok) return;
      const items = res.data?.data?.backups || [];
      $('si-meta-backups').textContent = items.length;
      $('si-hist-count').textContent = items.length + ' backup' + (items.length !== 1 ? 's' : '');
      $('si-hist-body').innerHTML = items.length
        ? items.map(b => `
          <div class="si-hist-row">
            <div>
              <div class="name">${esc(b.name)}</div>
              <div class="meta">${fmtAbs(b.mtime)} · ${fmtBytes(b.sizeBytes)}</div>
            </div>
            <a class="si-btn" href="${API.serviceInventory.downloadBackupUrl(b.name)}">↓ Download</a>
            <button class="si-btn" onclick="SI.restore('${esc(b.name)}')">↺ Restore</button>
            <span></span>
          </div>`).join('')
        : `<div class="si-empty" style="padding:22px">ยังไม่มี backup — จะสร้างอัตโนมัติทุกครั้งที่ upload</div>`;
    },

    async restore(name) {
      if (!confirm(`Restore inventory จาก ${name}?\nไฟล์ปัจจุบันจะถูกเก็บเข้า history อัตโนมัติ (ย้อนกลับได้)`)) return;
      const res = await API.serviceInventory.restore(name);
      if (!res?.ok) return toast(res?.data?.message || 'Restore ล้มเหลว', 'err');
      toast('Restored — reloading list…');
      await this.loadList();
      await this.loadHistory();
    },

    _renderMeta() {
      const m = this.meta || {};
      $('si-meta-count').textContent  = (m.entries || 0).toLocaleString();
      $('si-meta-mtime').textContent  = fmtRel(m.mtime);
      $('si-meta-mtime-abs').textContent = fmtAbs(m.mtime);
      $('si-meta-size').textContent   = fmtBytes(m.sizeBytes);
      $('si-meta-path').textContent   = m.path ? m.path.replace(/^.*\/data\//, 'data/') : '—';
    },

    _renderRunwayFilter() {
      const runways = Array.from(new Set(this.rows.map(r => r.runway).filter(Boolean))).sort();
      const sel = $('si-runway');
      const cur = sel.value;
      sel.innerHTML = '<option value="">All runways</option>' + runways.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
      if (runways.includes(cur)) sel.value = cur;
    },

    _renderTable() {
      const q  = $('si-q').value.trim().toLowerCase();
      const rw = $('si-runway').value;
      const filtered = this.rows.filter(r => {
        if (rw && r.runway !== rw) return false;
        if (q) {
          const hay = (r.service + ' ' + (r.bu || '') + ' ' + (r.team || '')).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      $('si-count').textContent = filtered.length + ' of ' + this.rows.length + ' services';

      if (!filtered.length) {
        $('si-tbody').innerHTML = '';
        $('si-empty').style.display = 'block';
        return;
      }
      $('si-empty').style.display = 'none';
      // Virtual-ish: cap to 500 for perf, add a "showing first N" note
      const cap = 500;
      const shown = filtered.slice(0, cap);
      const rows = shown.map(r => {
        const urlLink = r.urlProduction
          ? `<a class="si-link" href="${esc(r.urlProduction)}" target="_blank" rel="noopener">${esc(r.urlProduction.replace(/^https?:\/\//, '').replace(/\/$/, ''))} ↗</a>`
          : '<span style="color:var(--ssoft)">—</span>';
        return `<tr>
          <td>
            <div class="si-svc">${esc(r.service)}</div>
          </td>
          <td>${r.runway ? `<span class="si-tag">${esc(r.runway)}</span>` : ''}</td>
          <td>${r.bu   ? `<span class="si-tag">${esc(r.bu)}</span>`   : '<span style="color:var(--ssoft)">—</span>'}</td>
          <td>${r.team ? `<span class="si-tag">${esc(r.team)}</span>` : '<span style="color:var(--ssoft)">—</span>'}</td>
          <td class="right">${r.severity && r.severity !== '-' ? `<span class="si-tag ${sevClass(r.severity)}">${esc(r.severity)}</span>` : '<span style="color:var(--ssoft)">—</span>'}</td>
          <td class="right" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${esc(r.replicasProd || '—')}</td>
          <td>${r.appLanguage ? `<span class="si-tag">${esc(r.appLanguage)}</span>` : ''}</td>
          <td>${urlLink}</td>
        </tr>`;
      }).join('');
      const capNote = filtered.length > cap
        ? `<tr><td colspan="8" style="text-align:center;color:var(--smut);padding:14px">Showing first ${cap.toLocaleString()} of ${filtered.length.toLocaleString()} — narrow the filter to see more</td></tr>`
        : '';
      $('si-tbody').innerHTML = rows + capNote;
    },

    // ── Upload flow ─────────────────────────────────────────
    _wireDrop() {
      const drop = $('si-drop');
      const inp = $('si-file');
      inp.addEventListener('change', (e) => this._chooseFile(e.target.files[0]));
      ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hot'); }));
      ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('hot'); }));
      drop.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) this._chooseFile(f);
      });
    },

    async _chooseFile(file) {
      if (!file) return;
      if (!/\.csv$/i.test(file.name)) { toast('ต้องเป็นไฟล์ .csv', 'err'); return; }
      if (file.size > 8 * 1024 * 1024) { toast('ไฟล์เกิน 8MB', 'err'); return; }
      this.pendingFile = file;
      $('si-preview-file').textContent = `${file.name} · ${fmtBytes(file.size)}`;
      $('si-preview').classList.add('on');
      // Dry-run to validate + get preview
      const res = await API.serviceInventory.upload(file, true);
      if (!res?.ok) {
        this.pendingFile = null;
        $('si-preview').classList.remove('on');
        return toast(res?.data?.message || 'ไฟล์ไม่ผ่าน validation', 'err');
      }
      const d = res.data?.data || {};
      $('si-preview-total').textContent = d.total || 0;
      $('si-preview-named').textContent = d.withName || 0;
      $('si-preview-size').textContent = fmtBytes(d.sizeBytes || 0);
      $('si-preview-samples').innerHTML = (d.preview || []).map(s => `<li>${esc(s)}</li>`).join('');
    },

    cancelPreview() {
      this.pendingFile = null;
      $('si-preview').classList.remove('on');
      $('si-file').value = '';
    },

    async commit() {
      if (!this.pendingFile) return;
      const btn = $('si-commit');
      btn.disabled = true;
      const original = btn.innerHTML;
      btn.innerHTML = '⌛ กำลังอัพโหลด…';
      try {
        const res = await API.serviceInventory.upload(this.pendingFile, false);
        if (!res?.ok) throw new Error(res?.data?.message || 'upload failed');
        toast(res.data?.message || 'อัพเดตสำเร็จ');
        this.cancelPreview();
        await this.loadList();
        await this.loadHistory();
      } catch (e) {
        toast(e.message || String(e), 'err');
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    },

    _wireFilter() {
      let t = null;
      $('si-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this._renderTable(), 120); });
      $('si-runway').addEventListener('change', () => this._renderTable());
    },
  };

  SI.init();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "fmtAbs", { configurable: true, get: () => fmtAbs, set: (v) => { fmtAbs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtBytes", { configurable: true, get: () => fmtBytes, set: (v) => { fmtBytes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtRel", { configurable: true, get: () => fmtRel, set: (v) => { fmtRel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sevClass", { configurable: true, get: () => sevClass, set: (v) => { sevClass = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toast", { configurable: true, get: () => toast, set: (v) => { toast = v; } }); } catch (e) {}
})();
