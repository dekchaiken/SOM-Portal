/* ══════════════════════════════════════════════════
   dashboard.js  |  Weekly Report Dashboard Logic
   ══════════════════════════════════════════════════ */

class WeeklyReportDashboard {
  constructor() {
    // Bootstrap week from URL ?week=YYYY-MM-DD, fall back to current week
    const _urlWeek = new URLSearchParams(location.search).get('week');
    this.currentWeek = (_urlWeek && /^\d{4}-\d{2}-\d{2}$/.test(_urlWeek))
      ? 'week-' + _urlWeek
      : WeeklyDateUtils.getCurrentWeek();
    this.weekData = null;
    this.availableWeeks = [];
    this.analytics = null;
    this.presentation = null;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.showSkeletonState();
    await this.loadAvailableWeeks();
    // Sync current + previous week in parallel so incidents added after
    // the week boundary still appear when the user looks at last week.
    const prevWeek = WeeklyDateUtils.getPreviousWeek(this.currentWeek);
    await Promise.allSettled([
      this.autoSyncJira(this.currentWeek).catch(() => {}),
      this.autoSyncJira(prevWeek).catch(() => {}),
    ]);
    await this.loadWeekData(this.currentWeek, true);

    // Init Analytics & Presentation after data is loaded
    this.analytics = new Analytics(this);
    this.presentation = new PresentationMode(this);
  }

  // ── Skeleton while syncing ──────────────────────────
  showSkeletonState() {
    const skItem = (w1, w2) => `
      <div class="sk-item">
        <div class="sk-badge"></div>
        <div style="flex:1">
          <span class="sk-line" style="width:${w1}"></span>
          <span class="sk-line" style="width:${w2};margin-bottom:0"></span>
        </div>
      </div>`;
    const skeleton = skItem('65%','45%') + skItem('70%','50%') + skItem('55%','40%');
    const cards = ['incidentsBody','updatesBody','supportBody','batchBody','improvementsBody'];
    cards.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = skeleton;
    });
  }

  // ── Auto-sync all Jira sources, save new items ──────
  async autoSyncJira(week) {
    const token = Auth.getToken?.() || '';
    const authHeader = { 'Authorization': 'Bearer ' + token };

    // Load existing saved data first so we can diff against it
    let existing = {};
    try {
      const res = await WeeklyReportAPI.getWeek(week);
      existing = res.data || {};
    } catch (_) {}

    if (!existing.incidents) existing.incidents = [];
    if (!existing.support) existing.support = { ma: [], dev: [] };
    if (!existing.support.ma) existing.support.ma = [];
    if (!existing.support.dev) existing.support.dev = [];

    // Cap each Jira sync at 10 s — a slow Jira shouldn't block the whole page
    // from loading. If it times out the sync is skipped silently; data is still
    // read from local storage by loadWeekData() below.
    const _jiraTimeout = ms => new Promise(r => setTimeout(() => r(null), ms));
    const [incRes, maRes, devRes] = await Promise.allSettled([
      Promise.race([fetch(`./api/weekly-report/sync-jira-incidents.php?week=${week}`, { headers: authHeader }).then(r => r.json()).catch(() => null), _jiraTimeout(10000)]),
      Promise.race([fetch(`./api/weekly-report/sync-jira-ma.php?week=${week}`,        { headers: authHeader }).then(r => r.json()).catch(() => null), _jiraTimeout(10000)]),
      Promise.race([fetch(`./api/weekly-report/sync-jira-dev.php?week=${week}`,       { headers: authHeader }).then(r => r.json()).catch(() => null), _jiraTimeout(10000)]),
    ]);

    const saves = [];
    let supportChanged = false;

    if (incRes.status === 'fulfilled' && incRes.value?.ok) {
      const jiraIncidents = incRes.value.data.incidents || [];
      const existingIds = new Set(existing.incidents.map(i => i.ticketId));
      const newItems = jiraIncidents.filter(i => !existingIds.has(i.ticketId));
      if (newItems.length) {
        existing.incidents.push(...newItems);
        saves.push(WeeklyReportAPI.saveEntry({ week, section: 'incidents', data: existing.incidents }));
        Toast.success(`Auto-synced ${newItems.length} incident(s) from Jira`);
      }
    }

    if (maRes.status === 'fulfilled' && maRes.value?.ok) {
      const jiraItems = maRes.value.data.items || [];
      const existingIds = new Set([
        ...existing.support.ma.map(i => i.ticketId),
        ...existing.support.dev.map(i => i.ticketId),
      ]);
      const newItems = jiraItems.filter(i => !existingIds.has(i.ticketId));
      if (newItems.length) {
        existing.support.ma.push(...newItems);
        supportChanged = true;
        Toast.success(`Auto-synced ${newItems.length} MA ticket(s) from Jira`);
      }
    }

    if (devRes.status === 'fulfilled' && devRes.value?.ok) {
      const jiraItems = devRes.value.data.items || [];
      const existingIds = new Set([
        ...existing.support.ma.map(i => i.ticketId),
        ...existing.support.dev.map(i => i.ticketId),
      ]);
      const newItems = jiraItems.filter(i => !existingIds.has(i.ticketId));
      if (newItems.length) {
        existing.support.dev.push(...newItems);
        supportChanged = true;
        Toast.success(`Auto-synced ${newItems.length} Dev ticket(s) from Jira`);
      }
    }

    if (supportChanged) {
      saves.push(WeeklyReportAPI.saveEntry({ week, section: 'support', data: existing.support }));
    }

    await Promise.allSettled(saves);
  }

  setupEventListeners() {
    const prevBtn = document.getElementById('prevWeek');
    const nextBtn = document.getElementById('nextWeek');
    const weekSelect = document.getElementById('weekSelect');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.navigateWeek(-1));
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.navigateWeek(1));
    }
    if (weekSelect) {
      weekSelect.addEventListener('change', (e) => this.loadWeekData(e.target.value));
    }

    const analyticsBtn = document.getElementById('analyticsBtn');
    if (analyticsBtn) {
      analyticsBtn.addEventListener('click', () => this.analytics?.open());
    }

    const presentBtn = document.getElementById('presentBtn');
    if (presentBtn) {
      presentBtn.addEventListener('click', () => this.presentation?.enter());
    }
  }

  async loadAvailableWeeks() {
    try {
      const response = await WeeklyReportAPI.listWeeks();
      // Remove .json extension from week names
      this.availableWeeks = (response.weeks || []).map(w => w.replace('.json', ''));

      // Add current week if not exists
      if (!this.availableWeeks.includes(this.currentWeek)) {
        this.availableWeeks.unshift(this.currentWeek);
      }

      // Add last 12 weeks
      const last12 = WeeklyDateUtils.getLastNWeeks(12);
      last12.forEach(week => {
        if (!this.availableWeeks.includes(week)) {
          this.availableWeeks.push(week);
        }
      });

      // Sort descending
      this.availableWeeks.sort().reverse();

      // Populate selector
      this.populateWeekSelector();
    } catch (error) {
      console.error('Failed to load weeks:', error);
      this.showToast('Error loading weeks', 'error');
    }
  }

  populateWeekSelector() {
    const select = document.getElementById('weekSelect');
    if (!select) return;

    select.innerHTML = '';
    this.availableWeeks.forEach(week => {
      const option = document.createElement('option');
      option.value = week;
      option.textContent = WeeklyDateUtils.formatWeekRange(week);
      if (week === this.currentWeek) {
        option.textContent += ' (Current)';
      }
      select.appendChild(option);
    });

    select.value = this.currentWeek;
  }

  // Returns true if weekId is within `numWeeks` weeks before current week.
  isRecentWeek(weekId, numWeeks = 2) {
    let w = WeeklyDateUtils.getCurrentWeek();
    for (let i = 0; i < numWeeks; i++) {
      if (w === weekId) return true;
      w = WeeklyDateUtils.getPreviousWeek(w);
    }
    return false;
  }

  // skipSync=true when the caller already ran autoSyncJira for this week.
  async loadWeekData(week, skipSync = false) {
    try {
      this.currentWeek = week;
      const weekSelect = document.getElementById('weekSelect');
      if (weekSelect) {
        weekSelect.value = week;
      }

      // Reflect selected week in URL so it's shareable/bookmarkable
      const _dateParam = week.replace('week-', '');
      history.replaceState(null, '', '?week=' + _dateParam);

      // Show loading state
      this.showLoadingState();

      // Sync recent past weeks on demand so incidents added after the
      // week boundary appear without the user having to wait until next init.
      if (!skipSync && this.isRecentWeek(week)) {
        try { await this.autoSyncJira(week); } catch (_) {}
      }

      // Fetch data
      const response = await WeeklyReportAPI.getWeek(week);
      this.weekData = response.data;

      // Render all sections
      this.renderStats();
      this.renderIncidents();
      this.renderUpdates();
      this.renderSupport();
      this.renderBatch();
      this.renderImprovements();

      // Update navigation buttons
      this.updateNavigationButtons();

    } catch (error) {
      console.error('Failed to load week data:', error);
      this.showToast('Error loading week data', 'error');
      this.showErrorState();
    }
  }

  showLoadingState() {
    const cards = ['incidentsBody', 'updatesBody', 'supportBody', 'batchBody', 'improvementsBody'];
    cards.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
      }
    });
  }

  showErrorState() {
    const cards = ['incidentsBody', 'updatesBody', 'supportBody', 'batchBody', 'improvementsBody'];
    cards.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = `
          <div class="card-empty">
            <div class="card-empty-icon"><i data-icon="alert-triangle"></i></div>
            <div class="card-empty-text">Failed to load data</div>
          </div>
        `;
      }
    });
  }

  renderStats() {
    const data = this.weekData;

    const incidentsCount = data.incidents?.length || 0;
    const batchCount = (data.batch?.event?.length || 0) + (data.batch?.pending?.length || 0);
    const supportCount = (data.support?.ma?.length || 0) + (data.support?.dev?.length || 0);
    const updatesCount = (data.updates?.alert?.length || 0) +
      (data.updates?.handover?.length || 0) +
      (data.updates?.other?.length || 0);

    this.setElementText('statIncidents', incidentsCount);
    this.setElementText('statBatch', batchCount);
    this.setElementText('statSupport', supportCount);
    this.setElementText('statUpdates', updatesCount);
  }

  renderIncidents() {
    const incidents = this.weekData.incidents || [];
    const body = document.getElementById('incidentsBody');
    const badge = document.getElementById('incidentsBadge');

    if (badge) badge.textContent = incidents.length;

    if (!body) return;

    if (incidents.length === 0) {
      body.innerHTML = '<div class="card-empty"><div class="card-empty-text">No incidents</div></div>';
      return;
    }

    const detectedCount = incidents.filter(i => i.detected === 'Y').length;

    let html = `
      <div class="section">
        <div class="section-header">
          <div class="section-title">Total: ${incidents.length} | SM Detected: ${detectedCount}</div>
        </div>
        <div class="section-body">
    `;

    incidents.forEach(incident => {
      const sevClass = `badge-sev-${incident.severity}`;
      const detectedBadge = incident.detected === 'Y'
        ? '<span class="badge badge-detected"><i data-icon="check"></i>SM</span>'
        : '<span class="badge badge-not-detected"><i data-icon="x"></i>SM</span>';

      html += `
        <div class="item">
          <div class="item-content">
            <span class="badge ${sevClass}">S${incident.severity}</span>
            <div class="item-title">
              ${incident.ticketId ? `<a href="${escHtml(incident.ticketUrl || '#')}" class="ticket-link" target="_blank">[${escHtml(incident.ticketId)}]</a>` : ''}
              ${escHtml(incident.title)}
            </div>
            ${detectedBadge}
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
    body.innerHTML = html;
  }

  renderUpdates() {
    const updates = this.weekData.updates || {};
    const body = document.getElementById('updatesBody');
    const badge = document.getElementById('updatesBadge');

    const alertItems = updates.alert || [];
    const handoverItems = updates.handover || [];
    const otherItems = updates.other || [];
    const totalCount = alertItems.length + handoverItems.length + otherItems.length;

    if (badge) badge.textContent = totalCount;

    if (!body) return;

    if (totalCount === 0) {
      body.innerHTML = '<div class="card-empty"><div class="card-empty-text">No updates</div></div>';
      return;
    }

    let html = '';

    if (alertItems.length > 0) {
      html += this.renderSection('Update Alert & Grafana', alertItems);
    }
    if (handoverItems.length > 0) {
      html += this.renderSection('Handover', handoverItems);
    }
    if (otherItems.length > 0) {
      html += this.renderSection('Other', otherItems);
    }

    body.innerHTML = html;
  }

  renderSupport() {
    const support = this.weekData.support || {};
    const body = document.getElementById('supportBody');
    const badge = document.getElementById('supportBadge');

    const maItems = support.ma || [];
    const devItems = support.dev || [];
    const totalCount = maItems.length + devItems.length;

    if (badge) badge.textContent = totalCount;

    if (!body) return;

    if (totalCount === 0) {
      body.innerHTML = '<div class="card-empty"><div class="card-empty-text">No support tasks</div></div>';
      return;
    }

    let html = '';

    if (maItems.length > 0) {
      html += this.renderSupportSection('MA', maItems);
    }
    if (devItems.length > 0) {
      html += this.renderSupportSection('Dev', devItems);
    }

    body.innerHTML = html;
  }

  renderBatch() {
    const batch = this.weekData.batch || {};
    const body = document.getElementById('batchBody');
    const badge = document.getElementById('batchBadge');

    const eventItems = batch.event || [];
    const pendingItems = batch.pending || [];
    const totalCount = eventItems.length + pendingItems.length;

    if (badge) badge.textContent = totalCount;

    if (!body) return;

    if (totalCount === 0) {
      body.innerHTML = '<div class="card-empty"><div class="card-empty-text">No batch issues</div></div>';
      return;
    }

    let html = '';

    if (eventItems.length > 0) {
      html += this.renderSection('Batch & Event', eventItems);
    }
    if (pendingItems.length > 0) {
      html += this.renderSection('Pending Issue', pendingItems);
    }

    body.innerHTML = html;
  }

  renderImprovements() {
    const improvements = this.weekData.improvements || {};
    const body = document.getElementById('improvementsBody');
    const badge = document.getElementById('improvementsBadge');

    const improveItems = improvements.improve || [];
    const projectItems = improvements.project || [];
    const totalCount = improveItems.length + projectItems.length;

    if (badge) badge.textContent = totalCount;

    if (!body) return;

    if (totalCount === 0) {
      body.innerHTML = '<div class="card-empty"><div class="card-empty-text">No improvements</div></div>';
      return;
    }

    let html = '';

    if (improveItems.length > 0) {
      html += this.renderSection('Improvement', improveItems);
    }
    if (projectItems.length > 0) {
      html += this.renderSection('Project Update', projectItems);
    }

    body.innerHTML = html;
  }

  renderSection(title, items) {
    let html = `
      <div class="section">
        <div class="section-header">
          <div class="section-title">${title}</div>
          <span class="section-count">${items.length}</span>
        </div>
        <div class="section-body">
    `;

    items.forEach(item => {
      const statusBadge = item.status ? `<span class="badge badge-${item.status.toLowerCase()}">${escHtml(item.status)}</span>` : '';
      const linkIcon = item.url ? `<a href="${escHtml(item.url)}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';

      html += `
        <div class="item">
          <div class="item-content">
            <div class="item-title">
              ${escHtml(item.name || 'Untitled')}
              ${item.date ? ` - ${item.date}` : ''}
              ${item.desc ? `: ${escHtml(item.desc)}` : ''}
              ${linkIcon}
            </div>
            ${statusBadge}
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
    return html;
  }

  renderSupportSection(title, items) {
    let html = `
      <div class="section">
        <div class="section-header">
          <div class="section-title">${title}</div>
          <span class="section-count">${items.length}</span>
        </div>
        <div class="section-body">
    `;

    items.forEach(item => {
      const statusBadge = item.status ? `<span class="badge badge-${item.status.toLowerCase()}">${escHtml(item.status)}</span>` : '';
      const ticketDisplay = item.ticketId ?
        (item.ticketUrl ? `<a href="${escHtml(item.ticketUrl)}" target="_blank" class="ticket-link">${escHtml(item.ticketId)}</a>` : escHtml(item.ticketId))
        : '';

      html += `
        <div class="item">
          <div class="item-content">
            <div class="item-title">
              ${escHtml(item.summary || 'Untitled')}
              ${ticketDisplay ? ` [${ticketDisplay}]` : ''}
              ${item.owner ? ` - ${escHtml(item.owner)}` : ''}
            </div>
            ${statusBadge}
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
    return html;
  }

  navigateWeek(direction) {
    const currentIndex = this.availableWeeks.indexOf(this.currentWeek);
    const newIndex = currentIndex - direction;

    if (newIndex >= 0 && newIndex < this.availableWeeks.length) {
      this.loadWeekData(this.availableWeeks[newIndex]);
    }
  }

  updateNavigationButtons() {
    const currentIndex = this.availableWeeks.indexOf(this.currentWeek);
    const prevBtn = document.getElementById('prevWeek');
    const nextBtn = document.getElementById('nextWeek');

    if (prevBtn) {
      prevBtn.disabled = currentIndex <= 0;
    }
    if (nextBtn) {
      nextBtn.disabled = currentIndex >= this.availableWeeks.length - 1;
    }
  }

  setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  showToast(message, type = 'info') {
    // Use existing toast system if available
    if (typeof showToast === 'function') {
      showToast(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }
}

// Auto-init entry point. Called from the inline script in weekly-report.html
// so it always runs AFTER .main-content is in the DOM (layout.js SPA step ⑪).
// For non-SPA page loads it also auto-runs via DOMContentLoaded below.
WeeklyReportDashboard.start = function () {
  if (window.weeklyReportDashboard) return; // guard against double-init
  window.weeklyReportDashboard = new WeeklyReportDashboard();
};

// Content is always in place before this script loads (layout.js SPA step ⑥
// now happens after the .main-content swap). Safe to init immediately.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', WeeklyReportDashboard.start, { once: true });
} else {
  WeeklyReportDashboard.start();
}
