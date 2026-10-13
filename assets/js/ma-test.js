/* ══════════════════════════════════════════════════
   ma-test.js  |  Shared logic for MA Test pages
   Used by:
     admin/ma-test-catalog.html
     admin/ma-test-plans.html
     ma-test.html   (user page)

   Uses the app's native UI classes (.badge, .btn, .card,
   .form-control, .modal-overlay.active) — no custom CSS system.
   ══════════════════════════════════════════════════ */

const MaTest = (() => {
  // Note: source CSV uses "WELTH" (typo carried over) for one service; keep
  // both spellings so imported data and admin-entered values stay valid.
  const SERVICES  = ['TMN', 'NANO', 'WELTH', 'WEALTH'];
  const PRIORITIES = ['P1', 'P2', 'P3'];
  const TOOLS     = ['Admin Portal', 'Jenkins', '3rd Party', 'Rundeck', 'Kims Portal'];
  const CAN_CHANGE = ['YES', 'NO'];
  const TYPES     = ['Planwork', 'Auto', 'Test', 'Incident'];
  const RESULTS   = ['Successed', 'Failed', 'Pending', '-'];
  const YESNO     = ['Yes', 'No', '-'];

  const state = { catalog: [], plan: [], results: [], month: currentMonth() };

  function currentMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth()+1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }
  // Normalize service name for case-insensitive comparison (catalog ↔ usecase)
  function normName(s) {
    return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // ── Native-badge helpers ─────────────────────────────────
  function priorityBadge(p) {
    const map = { P1: 'badge-red', P2: 'badge-yellow', P3: 'badge-gray' };
    const cls = map[p] || 'badge-gray';
    return `<span class="badge ${cls}">${escapeHtml(p || '—')}</span>`;
  }
  function toolBadge(tool) {
    const t = (tool || '').toLowerCase();
    let cls = 'badge-gray';
    if (t === 'jenkins')       cls = 'badge-orange';
    else if (t === '3rd party') cls = 'badge-yellow';
    else if (t === 'admin portal') cls = 'badge-blue';
    else if (t === 'rundeck')   cls = 'badge-blue';
    else if (t === 'kims portal') cls = 'badge-blue';
    return `<span class="badge ${cls}">${escapeHtml(tool || '—')}</span>`;
  }
  function resultBadge(r) {
    const map = {
      'Successed': 'badge-green',
      'Failed':    'badge-red',
      'Pending':   'badge-yellow',
      '-':         'badge-gray',
    };
    return `<span class="badge ${map[r] || 'badge-gray'}">${escapeHtml(r || '—')}</span>`;
  }
  function serviceBadge(s) {
    return `<span class="badge badge-orange">${escapeHtml(s || '—')}</span>`;
  }
  function activeBadge(active) {
    return active === false
      ? '<span class="badge badge-gray">Inactive</span>'
      : '<span class="badge badge-green">Active</span>';
  }

  // API.request returns { ok, status, data } where `data` is the PHP JSON body
  // {success, message, data}. Callers here want the PHP body directly, so unwrap.
  async function _unwrap(p) {
    const r = await p;
    if (!r) return { success: false, message: 'No response (session expired?)' };
    return r.data || { success: false, message: `HTTP ${r.status || '?'}` };
  }

  // ── API ──────────────────────────────────────────────────
  const api = {
    listCatalog: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return _unwrap(API.get('/ma-test/catalog.php' + (qs ? '?' + qs : '')));
    },
    getCatalog:    (id)          => _unwrap(API.get('/ma-test/catalog.php?id=' + encodeURIComponent(id))),
    createCatalog: (data)        => _unwrap(API.post('/ma-test/catalog.php', data)),
    updateCatalog: (id, data)    => _unwrap(API.request('PUT', '/ma-test/catalog.php?id=' + encodeURIComponent(id), data)),
    deleteCatalog: (id, hard=false) => _unwrap(API.request('DELETE', '/ma-test/catalog.php?id=' + encodeURIComponent(id) + (hard ? '&hard=1' : ''))),

    importCsv:        (file) => { const fd = new FormData(); fd.append('csv', file); return _unwrap(API.upload('/ma-test/catalog-import.php', fd)); },
    bootstrapImport:  ()     => _unwrap(API.post('/ma-test/catalog-import.php?bootstrap=1', {})),

    listPlan:   (month)       => _unwrap(API.get('/ma-test/plans.php?month=' + encodeURIComponent(month))),
    listMonths: ()            => _unwrap(API.get('/ma-test/plans.php?months=1')),
    addPlan:    (month, ids, extra = {}) => _unwrap(API.post('/ma-test/plans.php?month=' + encodeURIComponent(month), { catalog_ids: ids, ...extra })),
    removePlan: (month, id)   => _unwrap(API.request('DELETE', '/ma-test/plans.php?month=' + encodeURIComponent(month) + '&id=' + encodeURIComponent(id))),

    listResults:  (month, planId) => {
      let url = '/ma-test/results.php?month=' + encodeURIComponent(month);
      if (planId) url += '&plan_id=' + encodeURIComponent(planId);
      return _unwrap(API.get(url));
    },
    createResult: (month, data)     => _unwrap(API.post('/ma-test/results.php?month=' + encodeURIComponent(month), data)),
    updateResult: (month, id, data) => _unwrap(API.request('PUT', '/ma-test/results.php?month=' + encodeURIComponent(month) + '&id=' + encodeURIComponent(id), data)),
    deleteResult: (month, id)       => _unwrap(API.request('DELETE', '/ma-test/results.php?month=' + encodeURIComponent(month) + '&id=' + encodeURIComponent(id))),

    uploadScreenshot: (file, month) => {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('scope', 'ma-test');
      fd.append('month', month || currentMonth());
      return _unwrap(API.upload('/upload.php', fd));
    },

    // For the CSV upload path from the import modal — same unwrap.
    rawUpload: (path, fd) => _unwrap(API.upload(path, fd)),

    // ── MA Usecases (source for catalog linking) ────────────
    listUsecases:  ()               => _unwrap(API.get('/ma-services/list.php')),
    autoLinkCatalog: ()             => _unwrap(API.post('/ma-test/catalog.php?action=auto_link', {})),
    bulkFromUsecases: (ids)         => _unwrap(API.post('/ma-test/catalog.php?action=bulk_from_usecases', { usecase_ids: ids })),

    // ── Webhooks / Google Chat ──────────────────────────────
    listWebhooks:  ()               => _unwrap(API.get('/ma-test/config.php')),
    addWebhook:    (data)           => _unwrap(API.post('/ma-test/config.php', data)),
    updateWebhook: (id, data)       => _unwrap(API.request('PUT', '/ma-test/config.php?id=' + encodeURIComponent(id), data)),
    deleteWebhook: (id)             => _unwrap(API.request('DELETE', '/ma-test/config.php?id=' + encodeURIComponent(id))),
    notify:        (webhookId, msg, kind = '') => _unwrap(API.post('/ma-test/notify.php', { webhook_id: webhookId, message: msg, kind })),
  };

  return {
    SERVICES, PRIORITIES, TOOLS, CAN_CHANGE, TYPES, RESULTS, YESNO,
    state, currentMonth, today, escapeHtml, normName,
    priorityBadge, toolBadge, resultBadge, serviceBadge, activeBadge,
    api,
  };
})();
