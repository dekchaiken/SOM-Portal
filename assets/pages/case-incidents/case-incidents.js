// ══════════════════════════════════════════════════════
// CASE INCIDENTS PAGE
// ══════════════════════════════════════════════════════
Auth.requireAuth();
Layout.render('case-incidents');
let allIncidents = [];
let filteredIncidents = [];
let displayedCount = 0;
const INCIDENTS_PER_PAGE = 50;

let filters = {
  days: 'all',
  fromDate: '',
  toDate: '',
  severity: '',
  status: '',
  detected: '',
  search: ''
};

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

async function loadIncidents() {
  const list = document.getElementById('incidents-list');
  const countEl = document.getElementById('incidents-count');

  try {
    list.innerHTML = `<div class="ci-state"><div class="ci-state-icon"><i data-icon="loader"></i></div><div class="ci-state-text">Loading incidents...</div></div>`;
    if (window.Icons?.render) window.Icons.render(list);
    countEl.textContent = '—';

    const params = new URLSearchParams();
    params.append('maxResults', '500');

    if (filters.search) {
      params.append('search', filters.search);
    } else if (filters.days !== 'all') {
      params.append('days', filters.days);
    } else if (filters.fromDate || filters.toDate) {
      if (filters.fromDate) params.append('fromDate', filters.fromDate);
      if (filters.toDate) params.append('toDate', filters.toDate);
    }

    const response = await fetch('./api/jira/incidents.php?' + params.toString(), {
      headers: { 'Authorization': 'Bearer ' + (Auth.getToken() || '') }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('API Error:', response.status, text);
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) throw new Error(result.message || 'Failed to load incidents');

    allIncidents = result.data.incidents || [];
    populateFilterDropdowns();
    applyFilters();

  } catch (error) {
    console.error('Failed to load incidents:', error);
    Toast.error('Failed to load incidents: ' + error.message);
    list.innerHTML = `<div class="ci-state"><div class="ci-state-icon"><i data-icon="alert-triangle"></i></div><div class="ci-state-text">Failed to load incidents</div><div class="ci-state-sub">${escapeHtml(error.message)}</div></div>`;
    if (window.Icons?.render) window.Icons.render(list);
  }
}

function populateFilterDropdowns() {
  const statusSet = new Set();
  const detectedSet = new Set();

  allIncidents.forEach(inc => {
    if (inc.status) statusSet.add(inc.status);
    if (inc.detectedBy) detectedSet.add(inc.detectedBy);
  });

  document.getElementById('filter-status').innerHTML =
    '<option value="">All Status</option>' +
    Array.from(statusSet).sort().map(s => `<option value="${s}">${s}</option>`).join('');

  document.getElementById('filter-detected').innerHTML =
    '<option value="">All</option>' +
    Array.from(detectedSet).sort().map(d => `<option value="${d}">${d}</option>`).join('');
}

function applyFilters() {
  filteredIncidents = allIncidents.filter(inc => {
    if (filters.severity && inc.severity !== filters.severity) return false;
    if (filters.status && inc.status !== filters.status) return false;
    if (filters.detected && inc.detectedBy !== filters.detected) return false;
    return true;
  });
  displayedCount = 0;
  renderIncidents();
}

function renderIncidents() {
  const list = document.getElementById('incidents-list');
  const countEl = document.getElementById('incidents-count');
  const loadMoreContainer = document.getElementById('load-more-container');
  const loadMoreBtn = document.getElementById('btn-load-more');

  countEl.textContent = filteredIncidents.length.toLocaleString();

  if (filteredIncidents.length === 0) {
    list.innerHTML = `<div class="ci-state"><div class="ci-state-icon"><i data-icon="inbox"></i></div><div class="ci-state-text">No incidents found</div><div class="ci-state-sub">ลองปรับ filter หรือ search ใหม่</div></div>`;
    if (window.Icons?.render) window.Icons.render(list);
    loadMoreContainer.style.display = 'none';
    return;
  }

  const toShow = displayedCount === 0 ? INCIDENTS_PER_PAGE : displayedCount + INCIDENTS_PER_PAGE;
  const incidents = filteredIncidents.slice(0, toShow);
  displayedCount = incidents.length;

  list.innerHTML = `
    <div class="incident-row-header">
      <div>Sev</div>
      <div>Ticket</div>
      <div>Summary</div>
      <div>Status</div>
      <div>Detected By</div>
      <div>Created</div>
    </div>
  ` + incidents.map(incident => `
    <div class="incident-row" data-incident-key="${incident.key}">
      <div><div class="incident-sev-badge sev${incident.severity}">S${incident.severity}</div></div>
      <div><a href="${incident.url}" target="_blank" class="incident-key-link" onclick="event.stopPropagation()">${incident.key}</a></div>
      <div><div class="incident-summary-text" title="${escapeHtml(incident.summary)}">${escapeHtml(incident.summary)}</div></div>
      <div><div class="incident-status-badge">${escapeHtml(incident.status)}</div></div>
      <div><div class="incident-detected-badge">${escapeHtml(incident.detectedBy)}</div></div>
      <div><div class="incident-date-text">${incident.createdDate}</div></div>
    </div>
  `).join('');

  if (displayedCount < filteredIncidents.length) {
    loadMoreContainer.style.display = 'block';
    const remaining = filteredIncidents.length - displayedCount;
    loadMoreBtn.textContent = `Load More (${Math.min(remaining, INCIDENTS_PER_PAGE)})`;
  } else {
    loadMoreContainer.style.display = 'none';
  }

  list.querySelectorAll('.incident-row').forEach(row => {
    row.addEventListener('click', () => {
      const key = row.dataset.incidentKey;
      const incident = allIncidents.find(i => i.key === key);
      if (incident) showIncidentDetail(incident);
    });
  });
}

// ── Filter event listeners ───────────────────────────
document.querySelectorAll('.quick-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.quick-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filters.days = btn.dataset.days;
    if (filters.days !== 'all') {
      document.getElementById('filter-from-date').value = '';
      document.getElementById('filter-to-date').value = '';
      filters.fromDate = '';
      filters.toDate = '';
    }
    loadIncidents();
  });
});

document.getElementById('filter-from-date').addEventListener('change', (e) => {
  filters.fromDate = e.target.value;
  document.querySelectorAll('.quick-filter-btn').forEach(b => b.classList.remove('active'));
  loadIncidents();
});

document.getElementById('filter-to-date').addEventListener('change', (e) => {
  filters.toDate = e.target.value;
  document.querySelectorAll('.quick-filter-btn').forEach(b => b.classList.remove('active'));
  loadIncidents();
});

document.getElementById('filter-severity').addEventListener('change', (e) => {
  filters.severity = e.target.value;
  applyFilters();
});

document.getElementById('filter-status').addEventListener('change', (e) => {
  filters.status = e.target.value;
  applyFilters();
});

document.getElementById('filter-detected').addEventListener('change', (e) => {
  filters.detected = e.target.value;
  applyFilters();
});

document.getElementById('btn-load-more').addEventListener('click', () => {
  renderIncidents();
});

document.getElementById('btn-refresh-incidents').addEventListener('click', loadIncidents);

// ── Search (debounced) ───────────────────────────────
(function() {
  const searchInput = document.getElementById('incidents-search');
  const clearBtn    = document.getElementById('btn-clear-search');
  const hintEl      = document.getElementById('incidents-search-hint');
  let debounceTimer = null;

  function updateHint() {
    if (filters.search) {
      hintEl.textContent = 'Searching all incidents';
      clearBtn.style.display = 'inline-flex';
    } else {
      hintEl.textContent = '';
      clearBtn.style.display = 'none';
    }
  }

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (val === filters.search) return;
      filters.search = val;
      updateHint();
      loadIncidents();
    }, 400);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    if (filters.search === '') return;
    filters.search = '';
    updateHint();
    loadIncidents();
  });
})();

// ── Incident Detail Modal ────────────────────────────
async function showIncidentDetail(incident) {
  document.getElementById('incident-detail-title').textContent = incident.key;
  document.getElementById('incident-jira-link').href = incident.url;

  const body = document.getElementById('incident-detail-body');
  body.innerHTML = `
    <div style="display:grid;gap:16px">
      <div>
        <div class="detail-section-label">Summary</div>
        <div class="detail-section-value">${escapeHtml(incident.summary)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="detail-field-item">
          <div class="detail-field-key">Ticket</div>
          <div class="detail-field-val"><a href="${incident.url}" target="_blank" class="incident-key-link">${incident.key}</a></div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">Status</div>
          <div class="detail-field-val">${escapeHtml(incident.status)}</div>
        </div>
      </div>
      <div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">
        <i data-icon="loader"></i> Loading full details from Jira…
      </div>
    </div>
  `;
  if (window.Icons?.render) window.Icons.render(body);
  openModal('incident-detail-modal');

  let detail;
  try {
    const resp = await fetch('./api/jira/issue-detail.php?key=' + encodeURIComponent(incident.key), {
      headers: { 'Authorization': 'Bearer ' + (Auth.getToken() || '') }
    });
    const json = await resp.json();
    if (!resp.ok || json.success === false) {
      throw new Error(json.message || json.error || ('HTTP ' + resp.status));
    }
    detail = json.data || json;
  } catch (err) {
    body.innerHTML = `
      <div style="display:grid;gap:16px">
        <div>
          <div class="detail-section-label">Summary</div>
          <div class="detail-section-value">${escapeHtml(incident.summary)}</div>
        </div>
        <div style="padding:16px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;color:#991B1B;font-size:13px">
          <strong>Could not load full details:</strong> ${escapeHtml(err.message || String(err))}
        </div>
      </div>
    `;
    return;
  }

  const fields   = detail.fields   || {};
  const rendered = detail.rendered || {};
  const names    = detail.names    || {};

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const nameToId = {};
  Object.entries(names).forEach(([id, name]) => { nameToId[norm(name)] = id; });

  function pickField(candidates) {
    for (const cand of candidates) {
      const id = nameToId[norm(cand)];
      if (!id) continue;
      if (rendered[id] && String(rendered[id]).trim() !== '') return { html: rendered[id] };
      const raw = fields[id];
      if (raw === null || raw === undefined || raw === '') continue;
      return { raw };
    }
    return null;
  }

  function fieldValueToText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(fieldValueToText).filter(Boolean).join(', ');
    if (typeof v === 'object') {
      if (v.value)       return String(v.value);
      if (v.name)        return String(v.name);
      if (v.displayName) return String(v.displayName);
      if (v.child)       return [v.value, v.child.value].filter(Boolean).join(' / ');
    }
    return '';
  }

  function renderPicked(picked) {
    if (!picked) return '<span style="color:var(--text-muted);font-style:italic">—</span>';
    if (picked.html) return `<div class="jira-rendered" style="font-size:13px;line-height:1.6">${picked.html}</div>`;
    const txt = fieldValueToText(picked.raw);
    return txt ? escapeHtml(txt) : '<span style="color:var(--text-muted);font-style:italic">—</span>';
  }

  const sevPick   = pickField(['TH Severity', 'Severity']);
  const detBy     = pickField(['Detected by', 'Detected By']);
  const bu        = pickField(['Business Unit Impacted', 'Business Unit']);
  const trxImpact = pickField(['Transaction Impact']);
  const channel   = pickField(['TH Channel / Component', 'TH Channel/Component', 'Channel / Component', 'TH Channel']);
  const sof       = pickField(['TH Source of Fund', 'Source of Fund']);
  const initCause = pickField(['Initial Cause', 'Initial cause']);
  const actionSol = pickField(['Action/Solution', 'Action / Solution', 'Action-Solution', 'Action']);

  const created  = fields.created ? new Date(fields.created).toLocaleString('th-TH') : '';
  const assignee = fields.assignee?.displayName || 'Unassigned';
  const status   = fields.status?.name || incident.status || '';

  body.innerHTML = `
    <div style="display:grid;gap:16px">
      <div>
        <div class="detail-section-label">Summary</div>
        <div class="detail-section-value">${escapeHtml(fields.summary || incident.summary)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="detail-field-item">
          <div class="detail-field-key">Ticket</div>
          <div class="detail-field-val"><a href="${detail.url || incident.url}" target="_blank" class="incident-key-link">${detail.key || incident.key}</a></div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">Status</div>
          <div class="detail-field-val">${escapeHtml(status)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">TH Severity</div>
          <div class="detail-field-val">${renderPicked(sevPick)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">Detected by</div>
          <div class="detail-field-val">${renderPicked(detBy)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">Business Unit Impacted</div>
          <div class="detail-field-val">${renderPicked(bu)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">Transaction Impact</div>
          <div class="detail-field-val">${renderPicked(trxImpact)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">TH Channel / Component</div>
          <div class="detail-field-val">${renderPicked(channel)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">TH Source of Fund</div>
          <div class="detail-field-val">${renderPicked(sof)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">Assignee</div>
          <div class="detail-field-val">${escapeHtml(assignee)}</div>
        </div>
        <div class="detail-field-item">
          <div class="detail-field-key">Created</div>
          <div class="detail-field-val">${escapeHtml(created)}</div>
        </div>
      </div>
      <div>
        <div class="detail-section-label">Initial Cause</div>
        <div class="detail-field-item" style="padding:14px 16px">${renderPicked(initCause)}</div>
      </div>
      <div>
        <div class="detail-section-label">Action / Solution</div>
        <div class="detail-field-item" style="padding:14px 16px">${renderPicked(actionSol)}</div>
      </div>
    </div>
  `;
  if (window.Icons?.render) window.Icons.render(body);
}

document.getElementById('btn-close-incident-detail').addEventListener('click', () => {
  closeModal('incident-detail-modal');
});
document.getElementById('btn-close-incident-detail-2').addEventListener('click', () => {
  closeModal('incident-detail-modal');
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Bootstrap ───────────────────────────────────────
loadIncidents();
