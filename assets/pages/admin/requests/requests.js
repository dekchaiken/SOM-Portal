// admin/requests — page script, extracted from admin/requests.html.
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

  let allRequests = [];
  let filteredRequests = [];

  async function loadRequests() {
    try {
      const res = await API.get('/requests/index.php');
      if (!res?.ok) {
        Toast.error('Failed to load requests');
        return;
      }
      // Ensure it's an array
      const data = res.data;
      allRequests = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      updateStats();
      applyFilters();
    } catch (err) {
      Toast.error('Error loading requests: ' + err.message);
    }
  }

  function updateStats() {
    document.getElementById('stat-pending').textContent = allRequests.filter(r => r.status === 'pending').length;
    document.getElementById('stat-in-progress').textContent = allRequests.filter(r => r.status === 'in_progress').length;
    document.getElementById('stat-completed').textContent = allRequests.filter(r => r.status === 'completed').length;
    document.getElementById('stat-features').textContent = allRequests.filter(r => r.type === 'feature').length;
    document.getElementById('stat-bugs').textContent = allRequests.filter(r => r.type === 'bug').length;
    renderOverview();
  }

  function renderOverview() {
    const total = allRequests.length;
    if (!total) return;

    /* ── counts ── */
    const sc = {
      pending:     allRequests.filter(r => r.status === 'pending').length,
      in_progress: allRequests.filter(r => r.status === 'in_progress').length,
      completed:   allRequests.filter(r => r.status === 'completed').length,
      rejected:    allRequests.filter(r => r.status === 'rejected').length,
    };
    const features = allRequests.filter(r => r.type === 'feature').length;
    const bugs     = allRequests.filter(r => r.type === 'bug').length;
    const pc = {
      high:   allRequests.filter(r => r.priority === 'high').length,
      medium: allRequests.filter(r => r.priority === 'medium').length,
      low:    allRequests.filter(r => r.priority === 'low').length,
    };

    /* ── Donut (SVG stroke-dasharray technique) ── */
    const R = 42, cx = 55, cy = 55;
    const circ = 2 * Math.PI * R;
    const segments = [
      { key: 'completed',   color: '#22c55e', label: 'Completed'   },
      { key: 'in_progress', color: '#3b82f6', label: 'In Progress' },
      { key: 'pending',     color: '#f59e0b', label: 'Pending'     },
      { key: 'rejected',    color: '#6b7280', label: 'Rejected'    },
    ];
    let offset = 0;
    const rings = segments.map(s => {
      const len = (sc[s.key] / total) * circ;
      const el  = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${s.color}" stroke-width="12" stroke-dasharray="${len.toFixed(2)} ${circ.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="butt"/>`;
      offset += len;
      return el;
    });
    document.getElementById('ov-donut-svg').innerHTML =
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--border)" stroke-width="12"/>` +
      rings.join('');
    const pct = Math.round((sc.completed / total) * 100);
    document.getElementById('ov-donut-pct').textContent = pct + '%';

    /* ── Legend ── */
    document.getElementById('ov-legend').innerHTML = segments.map(s => `
      <div class="ov-legend-row">
        <span style="display:flex;align-items:center;gap:6px">
          <span class="ov-legend-dot" style="background:${s.color}"></span>
          <span style="color:var(--text-muted)">${s.label}</span>
        </span>
        <span style="font-weight:700;color:var(--text)">${sc[s.key]}</span>
      </div>`).join('');

    /* ── Breakdown bars ── */
    const bar = (label, count, color) => {
      const p = total ? Math.round(count / total * 100) : 0;
      return `<div class="ov-bar-group" style="margin-bottom:10px">
        <div class="ov-bar-label">
          <span style="color:var(--text-muted)">${label}</span>
          <span style="font-weight:700;color:var(--text)">${count} <span style="font-weight:400;color:var(--text-muted)">(${p}%)</span></span>
        </div>
        <div class="ov-bar-track"><div class="ov-bar-fill" style="width:${p}%;background:${color}"></div></div>
      </div>`;
    };
    document.getElementById('ov-breakdown').innerHTML =
      `<div class="ov-section-lbl">ประเภทคำขอ</div>` +
      bar('Feature Request', features, '#8b5cf6') +
      bar('Bug Report', bugs, '#ef4444') +
      `<div class="ov-section-lbl">Priority</div>` +
      bar('High', pc.high, '#ef4444') +
      bar('Medium', pc.medium, '#f59e0b') +
      bar('Low', pc.low, '#22c55e');

    /* ── Top requesters ── */
    const byUser = {};
    allRequests.forEach(r => {
      const k = r.user_name || 'Unknown';
      if (!byUser[k]) byUser[k] = { name: k, team: r.team, count: 0 };
      byUser[k].count++;
    });
    const top = Object.values(byUser).sort((a, b) => b.count - a.count).slice(0, 5);
    document.getElementById('ov-top-users').innerHTML = top.length
      ? top.map((u, i) => `
          <div class="ov-user-row">
            <div class="ov-rank ov-rank-${i < 3 ? i + 1 : ''}">${i + 1}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(u.name)}</div>
              ${u.team ? `<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">${escHtml(u.team)}</div>` : ''}
            </div>
            <div style="font-size:13px;font-weight:800;color:var(--text);flex-shrink:0">${u.count}</div>
          </div>`).join('')
      : '<div style="color:var(--text-muted);font-size:12px;padding:20px 0;text-align:center">ยังไม่มีข้อมูล</div>';
  }

  function applyFilters() {
    const typeFilter = document.getElementById('filter-type').value;
    const statusFilter = document.getElementById('filter-status').value;
    const priorityFilter = document.getElementById('filter-priority').value;

    filteredRequests = allRequests.filter(r => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      return true;
    });

    renderTable();
  }

  function renderTable() {
    const tbody = document.getElementById('requests-tbody');
    
    if (!filteredRequests.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No requests found</td></tr>';
      return;
    }

    tbody.innerHTML = filteredRequests.map(r => {
      const typeIcon = r.type === 'feature' ? '<i data-icon="sparkles"></i>' : '<i data-icon="bug"></i>';
      const typeClass = r.type === 'feature' ? 'req-type-feature' : 'req-type-bug';
      const typeLabel = r.type === 'feature' ? 'Feature' : 'Bug';

      const statusIcons = {
        pending: '⏳',
        in_progress: '<i data-icon="refresh-cw"></i>',
        completed: '<i data-icon="check-circle"></i>',
        rejected: '<i data-icon="x-circle"></i>'
      };
      const statusLabels = {
        pending: 'Pending',
        in_progress: 'In Progress',
        completed: 'Completed',
        rejected: 'Rejected'
      };

      const priorityIcons = {
        high: '<i data-icon="circle"></i>',
        medium: '<i data-icon="circle"></i>',
        low: '<i data-icon="circle"></i>'
      };

      const createdDate = new Date(r.created_at).toLocaleDateString('th-TH', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });

      const ticketBadge = r.ticket_number
        ? `<span class="ticket-badge">${escHtml(r.ticket_number)}</span>`
        : '<span style="color:var(--text-muted);font-size:10px">—</span>';

      return `<tr>
        <td>${ticketBadge}</td>
        <td><span class="req-type-badge ${typeClass}">${typeIcon} ${typeLabel}</span></td>
        <td>
          <div style="font-weight:600;color:var(--text);margin-bottom:2px">${escHtml(r.title)}</div>
          <div style="font-size:10px;color:var(--text-muted)">${escHtml(r.description.substring(0, 60))}${r.description.length > 60 ? '...' : ''}</div>
        </td>
        <td style="font-size:11px">${escHtml(r.user_name)}</td>
        <td><span class="req-priority-${r.priority}">${priorityIcons[r.priority]} ${r.priority.toUpperCase()}</span></td>
        <td><span class="req-status-badge req-status-${r.status}">${statusIcons[r.status]} ${statusLabels[r.status]}</span></td>
        <td style="font-size:11px;color:var(--text-muted)">${createdDate}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="viewDetail('${r.id}')" title="View"><i data-icon="eye"></i></button>
            <button class="btn btn-ghost btn-sm" onclick="updateStatus('${r.id}')" title="Update Status"><i data-icon="pencil"></i></button>
            <button class="btn btn-danger btn-sm" onclick="deleteRequest('${r.id}')" title="Delete"><i data-icon="trash"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  let _detailReqId = null;

  function viewDetail(id) {
    const req = allRequests.find(r => r.id === id);
    if (!req) return;
    _detailReqId = id;

    const typeIcon = req.type === 'feature' ? '<i data-icon="sparkles"></i>' : '<i data-icon="bug"></i>';
    const typeLabel = req.type === 'feature' ? 'Feature Request' : 'Bug Report';
    const statusLabels = { pending:'Pending', in_progress:'In Progress', completed:'Completed', rejected:'Rejected' };
    const statusColors  = { pending:'#f59e0b', in_progress:'#3b82f6', completed:'#22c55e', rejected:'#6b7280' };

    const ticketHtml = req.ticket_number
      ? `<span class="ticket-badge" style="font-size:12px;padding:3px 10px">${escHtml(req.ticket_number)}</span>`
      : '';

    document.getElementById('detail-title').innerHTML = `${ticketHtml}&nbsp;${typeIcon} ${escHtml(req.title)}`;

    document.getElementById('detail-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;padding:20px">
        <!-- status bar -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="req-status-badge req-status-${req.status}">${statusLabels[req.status]}</span>
          <span class="req-type-badge ${req.type === 'feature' ? 'req-type-feature' : 'req-type-bug'}">${typeIcon} ${typeLabel}</span>
          <span class="req-priority-${req.priority}" style="font-size:11px">${req.priority.toUpperCase()}</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Requester</div>
            <div style="font-size:13px;font-weight:600">${escHtml(req.user_name)}</div>
            ${req.team ? `<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">${escHtml(req.team)}</div>` : ''}
          </div>
          <div>
            <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Created</div>
            <div style="font-size:12px">${new Date(req.created_at).toLocaleString('th-TH')}</div>
          </div>
        </div>

        <div>
          <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Description</div>
          <div style="white-space:pre-wrap;line-height:1.6;font-size:13px;background:var(--bg);padding:12px;border-radius:8px;border:1px solid var(--border)">${escHtml(req.description)}</div>
        </div>

        ${req.admin_note ? `<div>
          <div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Admin Note (Legacy)</div>
          <div style="white-space:pre-wrap;font-size:12px;background:var(--bg);padding:10px;border-radius:8px;color:var(--text-muted)">${escHtml(req.admin_note)}</div>
        </div>` : ''}
      </div>`;

    // Render comment thread
    renderCommentThread(req.comments || []);
    Modal.open('detail-modal');
    // auto-focus comment input
    setTimeout(() => document.getElementById('detail-cmt-input')?.focus(), 200);
  }

  function renderCommentThread(comments) {
    const thread = document.getElementById('detail-cmt-thread');
    const count  = document.getElementById('detail-cmt-count');
    if (count) count.textContent = comments.length;

    if (!comments.length) {
      thread.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0">ยังไม่มี comment</div>';
      return;
    }

    thread.innerHTML = comments.map(c => {
      const isAdmin = ['super_admin', 'sm_admin', 'dev_sm'].includes(c.author_role);
      const initials = (c.author_name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      const time = new Date(c.created_at).toLocaleString('th-TH', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
      return `
        <div class="cmt-bubble ${isAdmin ? 'is-admin' : ''}">
          <div class="cmt-avatar ${isAdmin ? 'admin-av' : 'user-av'}">${initials}</div>
          <div class="cmt-body">
            <div class="cmt-meta">
              <span style="font-weight:700;color:var(--text)">${escHtml(c.author_name)}</span>
              ${isAdmin ? '<span class="cmt-role-badge">Admin</span>' : ''}
              <span>${time}</span>
            </div>
            <div class="cmt-text">${escHtml(c.text)}</div>
          </div>
        </div>`;
    }).join('');

    // scroll to bottom
    thread.scrollTop = thread.scrollHeight;
  }

  async function sendAdminComment() {
    const input = document.getElementById('detail-cmt-input');
    const text = input?.value.trim();
    if (!text || !_detailReqId) return;

    const btn = input.nextElementSibling;
    btn.disabled = true;
    input.disabled = true;

    try {
      const res = await API.patch('/requests/index.php', { id: _detailReqId, comment: text });
      if (res?.ok) {
        input.value = '';
        // Optimistically push comment into allRequests
        const idx = allRequests.findIndex(r => r.id === _detailReqId);
        if (idx !== -1) {
          if (!allRequests[idx].comments) allRequests[idx].comments = [];
          allRequests[idx].comments.push(res.data.data);
          renderCommentThread(allRequests[idx].comments);
        }
      } else {
        Toast.error(res?.data?.message || 'ส่ง comment ไม่สำเร็จ');
      }
    } catch (err) {
      Toast.error('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      btn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  function openUpdateFromDetail() {
    if (_detailReqId) {
      Modal.close('detail-modal');
      updateStatus(_detailReqId);
    }
  }

  async function updateStatus(id) {
    const req = allRequests.find(r => r.id === id);
    if (!req) return;

    // Populate modal
    document.getElementById('update-req-id').value = id;
    document.getElementById('update-req-title').innerHTML =
      (req.ticket_number ? `<span class="ticket-badge" style="margin-right:6px">${escHtml(req.ticket_number)}</span>` : '') +
      escHtml(req.title);
    document.getElementById('update-status').value = req.status;
    document.getElementById('update-priority').value = req.priority;
    document.getElementById('update-note').value = req.admin_note || '';

    Modal.open('update-modal');
  }

  async function saveStatusUpdate() {
    const id = document.getElementById('update-req-id').value;
    const newStatus = document.getElementById('update-status').value;
    const newPriority = document.getElementById('update-priority').value;
    const note = document.getElementById('update-note').value.trim();

    const btn = document.querySelector('#update-modal .btn-primary');
    const icon = document.getElementById('update-icon');
    const text = document.getElementById('update-text');
    
    btn.disabled = true;
    icon.textContent = '⏳';
    text.textContent = 'Saving...';

    try {
      const res = await API.put('/requests/index.php', {
        id,
        status: newStatus,
        priority: newPriority,
        admin_note: note || null
      });

      if (res?.ok) {
        Toast.success('Status updated successfully');
        Modal.close('update-modal');
        loadRequests();
      } else {
        Toast.error(res?.data?.message || 'Update failed');
      }
    } catch (err) {
      Toast.error('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      icon.innerHTML = '<i data-icon="save"></i>';
      text.textContent = 'Save Changes';
    }
  }

  async function deleteRequest(id) {
    const req = allRequests.find(r => r.id === id);
    if (!req) return;

    // Populate delete modal
    document.getElementById('delete-req-id').value = id;
    document.getElementById('delete-req-title').textContent = req.title;

    Modal.open('delete-modal');
  }

  async function confirmDelete() {
    const id = document.getElementById('delete-req-id').value;
    
    const btn = document.querySelector('#delete-modal .btn-danger');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span><span>Deleting...</span>';

    try {
      const res = await API.delete(`/requests/index.php?id=${id}`);
      
      if (res?.ok) {
        Toast.success('Request deleted');
        Modal.close('delete-modal');
        loadRequests();
      } else {
        Toast.error(res?.data?.message || 'Delete failed');
        btn.disabled = false;
        btn.innerHTML = '<span><i data-icon="trash"></i></span><span>Delete</span>';
      }
    } catch (err) {
      Toast.error('Error: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = '<span><i data-icon="trash"></i></span><span>Delete</span>';
    }
  }

  loadRequests();

  // ── Tab switching ──────────────────────────────────────────────
  let _activeTab = 'smhub';

  function switchTab(tab) {
    _activeTab = tab;
    document.getElementById('section-smhub').style.display = tab === 'smhub' ? '' : 'none';
    document.getElementById('section-jira').style.display  = tab === 'jira'  ? '' : 'none';
    document.getElementById('tab-smhub').classList.toggle('active', tab === 'smhub');
    document.getElementById('tab-jira').classList.toggle('active',  tab === 'jira');
    if (tab === 'jira' && !_jiraLoaded) loadJiraRequests();
  }

  // ── Jira (TJCR) requests ───────────────────────────────────────
  let _jiraIssues   = [];
  let _jiraFiltered = [];
  let _jiraLoaded   = false;

  function _jiraStatusStyle(cat) {
    const map = {
      done          : { bg:'rgba(34,197,94,.12)',  color:'#15803d' },
      indeterminate : { bg:'rgba(59,130,246,.12)', color:'#1d4ed8' },
      new           : { bg:'rgba(100,116,139,.12)',color:'#475569' },
    };
    return map[cat] || map['new'];
  }

  function _relTime(iso) {
    if (!iso) return '';
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 2)  return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7)  return d + 'd ago';
    return new Date(iso).toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'numeric' });
  }

  async function loadJiraRequests() {
    const tbody = document.getElementById('jira-tbody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">Loading…</td></tr>';

    try {
      const res = await API.get('/jira-requests/?action=list');
      if (!res?.ok) throw new Error(res?.data?.message || 'Failed');
      _jiraIssues = res.data?.data?.issues || [];
      _jiraLoaded = true;
      _updateJiraStats();
      applyJiraFilters();
      // update tab badge
      document.getElementById('tab-badge-jira').textContent = _jiraIssues.length;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">Error: ${escHtml(e.message)}</td></tr>`;
    }
  }

  function _updateJiraStats() {
    document.getElementById('jstat-new').textContent    = _jiraIssues.filter(i => i.status_cat === 'new').length;
    document.getElementById('jstat-inprog').textContent = _jiraIssues.filter(i => i.status_cat === 'indeterminate').length;
    document.getElementById('jstat-done').textContent   = _jiraIssues.filter(i => i.status_cat === 'done').length;
    document.getElementById('jstat-total').textContent  = _jiraIssues.length;
  }

  function applyJiraFilters() {
    const statusF = document.getElementById('jfilter-status').value;
    _jiraFiltered = _jiraIssues.filter(i => !statusF || i.status_cat === statusF);
    renderJiraTable();
  }

  function renderJiraTable() {
    const tbody = document.getElementById('jira-tbody');
    if (!_jiraFiltered.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No Jira tickets found</td></tr>';
      return;
    }
    tbody.innerHTML = _jiraFiltered.map(iss => {
      const ss = _jiraStatusStyle(iss.status_cat);
      const avatar = iss.reporter_avatar
        ? `<img src="${escHtml(iss.reporter_avatar)}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px;" onerror="this.style.display='none'">`
        : '';
      return `<tr style="cursor:pointer" onclick="openJiraDetail('${escHtml(iss.key)}')">
        <td><span class="jira-key-badge">${escHtml(iss.key)}</span></td>
        <td>
          <div style="font-weight:600;color:var(--text);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(iss.summary)}">${escHtml(iss.summary)}</div>
        </td>
        <td style="font-size:11px">
          ${avatar}${escHtml(iss.reporter_name || '—')}
          ${iss.reporter_email ? `<div style="font-size:10px;color:var(--text-muted)">${escHtml(iss.reporter_email)}</div>` : ''}
        </td>
        <td style="font-size:11px">${escHtml(iss.priority || '—')}</td>
        <td>
          <span class="jira-status-chip" style="background:${ss.bg};color:${ss.color};border:1px solid ${ss.color}33">
            ${escHtml(iss.status)}
          </span>
        </td>
        <td style="font-size:11px;color:var(--text-muted)">${_relTime(iss.created)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openJiraDetail('${escHtml(iss.key)}')" title="View in drawer">
            <i data-icon="eye"></i>
          </button>
          <a href="${escHtml(iss.url || '#')}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" onclick="event.stopPropagation()" title="Open in Jira">
            <i data-icon="external-link"></i>
          </a>
        </td>
      </tr>`;
    }).join('');
    if (window.Icons?.renderAll) Icons.renderAll(document.getElementById('jira-tbody'));
  }

  function openJiraDetail(key) {
    if (typeof JiraInbox !== 'undefined') {
      JiraInbox.openDirect(key);
    } else {
      Toast.warning('Jira Inbox not available');
    }
  }

  // Update SMHUB tab badge after loading
  const _origUpdateStats = updateStats;
  updateStats = function() {
    _origUpdateStats();
    document.getElementById('tab-badge-smhub').textContent = allRequests.length;
  };

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_jiraStatusStyle", { configurable: true, get: () => _jiraStatusStyle, set: (v) => { _jiraStatusStyle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_relTime", { configurable: true, get: () => _relTime, set: (v) => { _relTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_updateJiraStats", { configurable: true, get: () => _updateJiraStats, set: (v) => { _updateJiraStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyFilters", { configurable: true, get: () => applyFilters, set: (v) => { applyFilters = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyJiraFilters", { configurable: true, get: () => applyJiraFilters, set: (v) => { applyJiraFilters = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmDelete", { configurable: true, get: () => confirmDelete, set: (v) => { confirmDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteRequest", { configurable: true, get: () => deleteRequest, set: (v) => { deleteRequest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadJiraRequests", { configurable: true, get: () => loadJiraRequests, set: (v) => { loadJiraRequests = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadRequests", { configurable: true, get: () => loadRequests, set: (v) => { loadRequests = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openJiraDetail", { configurable: true, get: () => openJiraDetail, set: (v) => { openJiraDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openUpdateFromDetail", { configurable: true, get: () => openUpdateFromDetail, set: (v) => { openUpdateFromDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCommentThread", { configurable: true, get: () => renderCommentThread, set: (v) => { renderCommentThread = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderJiraTable", { configurable: true, get: () => renderJiraTable, set: (v) => { renderJiraTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderOverview", { configurable: true, get: () => renderOverview, set: (v) => { renderOverview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveStatusUpdate", { configurable: true, get: () => saveStatusUpdate, set: (v) => { saveStatusUpdate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendAdminComment", { configurable: true, get: () => sendAdminComment, set: (v) => { sendAdminComment = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStats", { configurable: true, get: () => updateStats, set: (v) => { updateStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStatus", { configurable: true, get: () => updateStatus, set: (v) => { updateStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "viewDetail", { configurable: true, get: () => viewDetail, set: (v) => { viewDetail = v; } }); } catch (e) {}
})();
