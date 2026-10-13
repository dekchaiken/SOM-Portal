/**
 * Analytics Dashboard — adapted for Centralize-SOM Weekly Report
 */

class Analytics {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.isOpen = false;
    this.chartInstances = {};
    this.currentData = null;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.createAnalyticsModal();
    this.loadAnalyticsData();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    const modal = document.getElementById('analyticsModal');
    if (modal) modal.remove();

    Object.values(this.chartInstances).forEach(chart => {
      if (chart && chart.destroy) chart.destroy();
    });
    this.chartInstances = {};
  }

  createAnalyticsModal() {
    const modal = document.createElement('div');
    modal.id = 'analyticsModal';
    modal.className = 'analytics-modal';

    modal.innerHTML = `
      <div class="analytics-container">
        <div class="analytics-header">
          <div>
            <h2><i data-icon="bar-chart"></i> Analytics Dashboard</h2>
            <p class="analytics-subtitle">Detailed insights and trends</p>
          </div>
          <button class="analytics-close" id="analyticsClose"><i data-icon="x"></i></button>
        </div>

        <div class="analytics-filters">
          <div class="filter-group">
            <label>Period</label>
            <select id="analyticsRange">
              <option value="current">Current Week</option>
              <option value="last4">Last 4 Weeks</option>
              <option value="last8">Last 8 Weeks</option>
              <option value="last12">Last 12 Weeks</option>
              <option value="all">All Available</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          <div class="filter-group an-hidden" id="customRangeGroup">
            <label>From</label>
            <select id="rangeFrom"></select>
            <label>To</label>
            <select id="rangeTo"></select>
          </div>

          <button class="btn btn-primary btn-sm" id="analyticsApply">
            <i data-icon="refresh-cw"></i> Apply
          </button>
        </div>

        <div class="analytics-body">

          <div class="metrics-overview">
            <h3 class="an-section-title"><i data-icon="trending-up"></i> Key Metrics</h3>
            <div id="keyMetrics" class="key-metrics-grid"></div>
          </div>

          <div class="analytics-grid">

            <div class="analytics-card analytics-card-wide">
              <div class="card-header-analytics">
                <h3><i data-icon="alert-triangle"></i> Incident Trend Analysis</h3>
                <span class="card-info" id="incidentTrendInfo">0 total incidents</span>
              </div>
              <canvas id="incidentTrendChart"></canvas>
            </div>

            <div class="analytics-card">
              <div class="card-header-analytics">
                <h3><i data-icon="target"></i> Severity Distribution</h3>
                <span class="card-info" id="severityInfo">By severity level</span>
              </div>
              <canvas id="severityChart"></canvas>
              <div class="chart-legend" id="severityLegend"></div>
            </div>

            <div class="analytics-card">
              <div class="card-header-analytics">
                <h3><i data-icon="check"></i> SM Detection Performance</h3>
                <span class="card-info" id="detectionInfo">Detection rate</span>
              </div>
              <canvas id="detectionChart"></canvas>
              <div class="chart-legend" id="detectionLegend"></div>
            </div>

            <div class="analytics-card analytics-card-wide">
              <div class="card-header-analytics">
                <h3><i data-icon="bar-chart"></i> Activity by Category</h3>
                <span class="card-info" id="categoryInfo">All categories</span>
              </div>
              <canvas id="categoryChart"></canvas>
            </div>

            <div class="analytics-card">
              <div class="card-header-analytics">
                <h3>⏳ Task Completion Status</h3>
                <span class="card-info" id="statusInfo">Overall progress</span>
              </div>
              <canvas id="statusChart"></canvas>
              <div class="chart-legend" id="statusLegend"></div>
            </div>

            <div class="analytics-card">
              <div class="card-header-analytics">
                <h3><i data-icon="package"></i> Batch Operations</h3>
                <span class="card-info" id="batchInfo">Events & Pending</span>
              </div>
              <canvas id="batchChart"></canvas>
              <div class="chart-legend" id="batchLegend"></div>
            </div>

            <div class="analytics-card analytics-card-wide">
              <div class="card-header-analytics">
                <h3><i data-icon="calendar"></i> Weekly Activity Comparison</h3>
                <span class="card-info" id="weeklyInfo">Stacked view</span>
              </div>
              <canvas id="weeklyComparisonChart"></canvas>
            </div>

            <div class="analytics-card">
              <div class="card-header-analytics">
                <h3><i data-icon="users"></i> Support Tasks Breakdown</h3>
                <span class="card-info" id="supportInfo">MA vs Dev</span>
              </div>
              <canvas id="supportChart"></canvas>
              <div class="chart-legend" id="supportLegend"></div>
            </div>

            <div class="analytics-card">
              <div class="card-header-analytics">
                <h3><i data-icon="rocket"></i> Updates & Improvements</h3>
                <span class="card-info" id="updatesInfo">System enhancements</span>
              </div>
              <canvas id="updatesChart"></canvas>
              <div class="chart-legend" id="updatesLegend"></div>
            </div>

          </div>

          <div class="detailed-stats">
            <h3 class="an-section-title"><i data-icon="clipboard"></i> Detailed Statistics</h3>
            <div id="detailedStatsTable"></div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('analyticsClose').addEventListener('click', () => this.close());
    document.getElementById('analyticsApply').addEventListener('click', () => this.loadAnalyticsData());

    document.getElementById('analyticsRange').addEventListener('change', (e) => {
      const customGroup = document.getElementById('customRangeGroup');
      if (e.target.value === 'custom') {
        customGroup.classList.remove('an-hidden');
        this.populateCustomRangeSelects();
      } else {
        customGroup.classList.add('an-hidden');
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target.id === 'analyticsModal') this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  populateCustomRangeSelects() {
    const weeks = this.dashboard.availableWeeks;
    const fromSelect = document.getElementById('rangeFrom');
    const toSelect = document.getElementById('rangeTo');

    fromSelect.innerHTML = '';
    toSelect.innerHTML = '';

    weeks.forEach(week => {
      const label = WeeklyDateUtils.formatWeekRange(week);

      const o1 = document.createElement('option');
      o1.value = week; o1.textContent = label;
      fromSelect.appendChild(o1);

      const o2 = document.createElement('option');
      o2.value = week; o2.textContent = label;
      toSelect.appendChild(o2);
    });

    if (weeks.length > 0) {
      fromSelect.value = weeks[Math.min(3, weeks.length - 1)];
      toSelect.value = weeks[0];
    }
  }

  async loadAnalyticsData() {
    const range = document.getElementById('analyticsRange').value;
    let weeks = [];

    switch (range) {
      case 'current': weeks = [this.dashboard.currentWeek]; break;
      case 'last4':   weeks = this.dashboard.availableWeeks.slice(0, 4); break;
      case 'last8':   weeks = this.dashboard.availableWeeks.slice(0, 8); break;
      case 'last12':  weeks = this.dashboard.availableWeeks.slice(0, 12); break;
      case 'all':     weeks = this.dashboard.availableWeeks; break;
      case 'custom': {
        const from = document.getElementById('rangeFrom').value;
        const to   = document.getElementById('rangeTo').value;
        const fromIdx = this.dashboard.availableWeeks.indexOf(from);
        const toIdx   = this.dashboard.availableWeeks.indexOf(to);
        if (fromIdx >= 0 && toIdx >= 0) {
          weeks = this.dashboard.availableWeeks.slice(
            Math.min(toIdx, fromIdx),
            Math.max(toIdx, fromIdx) + 1
          );
        }
        break;
      }
    }

    this.showLoadingState();

    const data = await this.fetchWeeksData(weeks);
    this.currentData = data;

    this.renderKeyMetrics(data);
    this.renderIncidentTrend(data);
    this.renderSeverityChart(data);
    this.renderDetectionChart(data);
    this.renderCategoryChart(data);
    this.renderStatusChart(data);
    this.renderBatchChart(data);
    this.renderWeeklyComparison(data);
    this.renderSupportChart(data);
    this.renderUpdatesChart(data);
    this.renderDetailedStats(data);
  }

  showLoadingState() {
    const container = document.getElementById('keyMetrics');
    if (container) {
      container.innerHTML = '<div class="an-loading"><i data-icon="refresh-cw"></i> Loading analytics data...</div>';
    }
  }

  async fetchWeeksData(weeks) {
    const data = [];
    for (const week of weeks) {
      try {
        const response = await WeeklyReportAPI.getWeek(week);
        data.push({ week, data: response.data });
      } catch (error) {
        console.error(`Failed to load ${week}:`, error);
      }
    }
    return data.reverse();
  }

  calculateMetrics(data) {
    let totalIncidents = 0, sev1 = 0, sev2 = 0, sev3 = 0, detectedBySM = 0;
    let totalBatch = 0, batchEvents = 0, batchPending = 0;
    let totalSupport = 0, supportMA = 0, supportDev = 0;
    let totalUpdates = 0, updateAlerts = 0, updateHandover = 0, updateOther = 0;
    let totalImprovements = 0, improvements = 0, projects = 0;
    let done = 0, inprogress = 0;

    data.forEach(({ data: wd }) => {
      const incidents = wd.incidents || [];
      totalIncidents += incidents.length;
      incidents.forEach(inc => {
        if (inc.severity === '1') sev1++;
        else if (inc.severity === '2') sev2++;
        else if (inc.severity === '3') sev3++;
        if (inc.detected === 'Y') detectedBySM++;
      });

      const batchEvt = wd.batch?.event || [];
      const batchPnd = wd.batch?.pending || [];
      batchEvents  += batchEvt.length;
      batchPending += batchPnd.length;
      totalBatch   += batchEvt.length + batchPnd.length;

      const suppMA  = wd.support?.ma  || [];
      const suppDev = wd.support?.dev || [];
      supportMA  += suppMA.length;
      supportDev += suppDev.length;
      totalSupport += suppMA.length + suppDev.length;

      const updAlert   = wd.updates?.alert   || [];
      const updHandover = wd.updates?.handover || [];
      const updOther   = wd.updates?.other   || [];
      updateAlerts   += updAlert.length;
      updateHandover += updHandover.length;
      updateOther    += updOther.length;
      totalUpdates   += updAlert.length + updHandover.length + updOther.length;

      const improv = wd.improvements?.improve || [];
      const proj   = wd.improvements?.project || [];
      improvements      += improv.length;
      projects          += proj.length;
      totalImprovements += improv.length + proj.length;

      [batchEvt, batchPnd, suppMA, suppDev, updAlert, updHandover, updOther, improv, proj].forEach(items => {
        items.forEach(item => {
          if (item.status === 'Done') done++;
          else if (item.status === 'Inprogress') inprogress++;
        });
      });
    });

    const detectionRate  = totalIncidents > 0 ? ((detectedBySM / totalIncidents) * 100).toFixed(1) : 0;
    const totalTasks     = done + inprogress;
    const completionRate = totalTasks > 0 ? ((done / totalTasks) * 100).toFixed(1) : 0;

    return {
      totalIncidents, sev1, sev2, sev3, detectedBySM, detectionRate,
      totalBatch, batchEvents, batchPending,
      totalSupport, supportMA, supportDev,
      totalUpdates, updateAlerts, updateHandover, updateOther,
      totalImprovements, improvements, projects,
      done, inprogress, completionRate
    };
  }

  renderKeyMetrics(data) {
    const container = document.getElementById('keyMetrics');
    const m = this.calculateMetrics(data);

    const fmtWeek = (w) => WeeklyDateUtils.formatWeekRange(w).split(',')[0];

    const card = (cls, label, value, detail) => `
      <div class="metric-card-large ${cls}">
        <div class="metric-content">
          <div class="metric-label">${label}</div>
          <div class="metric-value">${value}</div>
          <div class="metric-detail">${detail}</div>
        </div>
      </div>`;

    container.innerHTML =
      card('', 'Total Incidents', m.totalIncidents, `S1: ${m.sev1} · S2: ${m.sev2} · S3: ${m.sev3}`) +
      card(m.detectionRate >= 80 ? 'metric-success' : m.detectionRate >= 60 ? 'metric-warning' : 'metric-danger',
        'SM Detection Rate', `${m.detectionRate}%`, `${m.detectedBySM} of ${m.totalIncidents} detected`) +
      card('', 'Batch Operations', m.totalBatch, `Events: ${m.batchEvents} · Pending: ${m.batchPending}`) +
      card('', 'Support Tasks', m.totalSupport, `MA: ${m.supportMA} · Dev: ${m.supportDev}`) +
      card('', 'System Updates', m.totalUpdates, `Alerts: ${m.updateAlerts} · Handover: ${m.updateHandover}`) +
      card('', 'Improvements', m.totalImprovements, `Improve: ${m.improvements} · Projects: ${m.projects}`) +
      card(m.completionRate >= 80 ? 'metric-success' : 'metric-warning',
        'Completion Rate', `${m.completionRate}%`, `${m.done} done · ${m.inprogress} in progress`) +
      card('', 'Weeks Analyzed', data.length,
        data.length > 0 ? `${fmtWeek(data[0].week)} – ${fmtWeek(data[data.length - 1].week)}` : '—');
  }

  renderIncidentTrend(data) {
    const ctx = document.getElementById('incidentTrendChart');
    if (this.chartInstances.incidentTrend) this.chartInstances.incidentTrend.destroy();

    const labels   = data.map(d => WeeklyDateUtils.formatWeekRange(d.week).split(',')[0]);
    const incidents = data.map(d => d.data.incidents?.length || 0);
    const detected  = data.map(d => d.data.incidents?.filter(i => i.detected === 'Y').length || 0);

    this.chartInstances.incidentTrend = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Total Incidents', data: incidents, borderColor: '#F26419', backgroundColor: 'rgba(242,100,25,0.1)', tension: 0.4 },
          { label: 'Detected by SM',  data: detected,  borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.1)',  tension: 0.4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
    });
  }

  renderSeverityChart(data) {
    const ctx = document.getElementById('severityChart');
    if (this.chartInstances.severity) this.chartInstances.severity.destroy();

    let sev1 = 0, sev2 = 0, sev3 = 0;
    data.forEach(({ data: wd }) => {
      wd.incidents?.forEach(inc => {
        if (inc.severity === '1') sev1++;
        else if (inc.severity === '2') sev2++;
        else if (inc.severity === '3') sev3++;
      });
    });

    this.chartInstances.severity = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['SEV 1', 'SEV 2', 'SEV 3'], datasets: [{ data: [sev1, sev2, sev3], backgroundColor: ['#EF4444', '#F59E0B', '#3B82F6'] }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
    });
  }

  renderDetectionChart(data) {
    const ctx = document.getElementById('detectionChart');
    if (this.chartInstances.detection) this.chartInstances.detection.destroy();

    let detected = 0, notDetected = 0;
    data.forEach(({ data: wd }) => {
      wd.incidents?.forEach(inc => { inc.detected === 'Y' ? detected++ : notDetected++; });
    });

    this.chartInstances.detection = new Chart(ctx, {
      type: 'pie',
      data: { labels: ['Detected by SM', 'Not Detected'], datasets: [{ data: [detected, notDetected], backgroundColor: ['#22C55E', '#767676'] }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
    });
  }

  renderCategoryChart(data) {
    const ctx = document.getElementById('categoryChart');
    if (this.chartInstances.category) this.chartInstances.category.destroy();

    let incidents = 0, batch = 0, support = 0, updates = 0, improvements = 0;
    data.forEach(({ data: wd }) => {
      incidents    += wd.incidents?.length || 0;
      batch        += (wd.batch?.event?.length || 0) + (wd.batch?.pending?.length || 0);
      support      += (wd.support?.ma?.length || 0) + (wd.support?.dev?.length || 0);
      updates      += (wd.updates?.alert?.length || 0) + (wd.updates?.handover?.length || 0) + (wd.updates?.other?.length || 0);
      improvements += (wd.improvements?.improve?.length || 0) + (wd.improvements?.project?.length || 0);
    });

    this.chartInstances.category = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Incidents', 'Batch', 'Support', 'Updates', 'Improvements'],
        datasets: [{ label: 'Count', data: [incidents, batch, support, updates, improvements], backgroundColor: ['#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6', '#22C55E'] }]
      },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
    });
  }

  renderStatusChart(data) {
    const ctx = document.getElementById('statusChart');
    if (this.chartInstances.status) this.chartInstances.status.destroy();

    let done = 0, inprogress = 0;
    data.forEach(({ data: wd }) => {
      ['batch', 'support', 'updates', 'improvements'].forEach(section => {
        const sectionData = wd[section];
        if (sectionData) {
          Object.values(sectionData).forEach(items => {
            if (Array.isArray(items)) {
              items.forEach(item => {
                if (item.status === 'Done') done++;
                else if (item.status === 'Inprogress') inprogress++;
              });
            }
          });
        }
      });
    });

    this.chartInstances.status = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Done', 'In Progress'], datasets: [{ data: [done, inprogress], backgroundColor: ['#22C55E', '#F59E0B'] }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
    });
  }

  renderBatchChart(data) {
    const ctx = document.getElementById('batchChart');
    if (!ctx) return;
    if (this.chartInstances.batch) this.chartInstances.batch.destroy();

    const m = this.calculateMetrics(data);
    document.getElementById('batchInfo').textContent = `${m.totalBatch} total operations`;

    this.chartInstances.batch = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Events', 'Pending'],
        datasets: [{ data: [m.batchEvents, m.batchPending], backgroundColor: ['#F26419', '#F59E0B'], borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
    });

    const legendEl = document.getElementById('batchLegend');
    if (legendEl) {
      legendEl.innerHTML = `
        <div class="legend-item"><span class="legend-color" style="background:#F26419;"></span> Events: ${m.batchEvents}</div>
        <div class="legend-item"><span class="legend-color" style="background:#F59E0B;"></span> Pending: ${m.batchPending}</div>
      `;
    }
  }

  renderSupportChart(data) {
    const ctx = document.getElementById('supportChart');
    if (!ctx) return;
    if (this.chartInstances.support) this.chartInstances.support.destroy();

    const m = this.calculateMetrics(data);
    document.getElementById('supportInfo').textContent = `${m.totalSupport} total tasks`;

    this.chartInstances.support = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['MA Support', 'Dev Support'],
        datasets: [{ data: [m.supportMA, m.supportDev], backgroundColor: ['#3B82F6', '#8B5CF6'], borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
    });

    const legendEl = document.getElementById('supportLegend');
    if (legendEl) {
      legendEl.innerHTML = `
        <div class="legend-item"><span class="legend-color" style="background:#3B82F6;"></span> MA: ${m.supportMA}</div>
        <div class="legend-item"><span class="legend-color" style="background:#8B5CF6;"></span> Dev: ${m.supportDev}</div>
      `;
    }
  }

  renderUpdatesChart(data) {
    const ctx = document.getElementById('updatesChart');
    if (!ctx) return;
    if (this.chartInstances.updates) this.chartInstances.updates.destroy();

    const m = this.calculateMetrics(data);
    document.getElementById('updatesInfo').textContent = `${m.totalUpdates + m.totalImprovements} total items`;

    this.chartInstances.updates = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Alerts', 'Handover', 'Other', 'Improvements', 'Projects'],
        datasets: [{ data: [m.updateAlerts, m.updateHandover, m.updateOther, m.improvements, m.projects], backgroundColor: ['#EF4444', '#F26419', '#F59E0B', '#22C55E', '#10B981'], borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
    });

    const legendEl = document.getElementById('updatesLegend');
    if (legendEl) {
      legendEl.innerHTML = `
        <div class="legend-item"><span class="legend-color" style="background:#EF4444;"></span> Alerts: ${m.updateAlerts}</div>
        <div class="legend-item"><span class="legend-color" style="background:#F26419;"></span> Handover: ${m.updateHandover}</div>
        <div class="legend-item"><span class="legend-color" style="background:#F59E0B;"></span> Other: ${m.updateOther}</div>
        <div class="legend-item"><span class="legend-color" style="background:#22C55E;"></span> Improvements: ${m.improvements}</div>
        <div class="legend-item"><span class="legend-color" style="background:#10B981;"></span> Projects: ${m.projects}</div>
      `;
    }
  }

  renderWeeklyComparison(data) {
    const ctx = document.getElementById('weeklyComparisonChart');
    if (this.chartInstances.weeklyComparison) this.chartInstances.weeklyComparison.destroy();

    const labels = data.map(d => WeeklyDateUtils.formatWeekRange(d.week).split(',')[0]);

    this.chartInstances.weeklyComparison = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Incidents',    data: data.map(d => d.data.incidents?.length || 0), backgroundColor: '#EF4444' },
          { label: 'Batch',        data: data.map(d => (d.data.batch?.event?.length || 0) + (d.data.batch?.pending?.length || 0)), backgroundColor: '#F59E0B' },
          { label: 'Support',      data: data.map(d => (d.data.support?.ma?.length || 0) + (d.data.support?.dev?.length || 0)), backgroundColor: '#3B82F6' },
          { label: 'Updates',      data: data.map(d => (d.data.updates?.alert?.length || 0) + (d.data.updates?.handover?.length || 0) + (d.data.updates?.other?.length || 0)), backgroundColor: '#8B5CF6' },
          { label: 'Improvements', data: data.map(d => (d.data.improvements?.improve?.length || 0) + (d.data.improvements?.project?.length || 0)), backgroundColor: '#22C55E' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true } }
      }
    });
  }

  renderDetailedStats(data) {
    const container = document.getElementById('detailedStatsTable');
    if (!container) return;

    const m = this.calculateMetrics(data);
    const pct = (n, total) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%';

    container.innerHTML = `
      <table class="detailed-table">
        <thead>
          <tr><th>Category</th><th>Metric</th><th>Value</th><th>Percentage</th></tr>
        </thead>
        <tbody>
          <tr><td rowspan="4" class="category-cell"><i data-icon="alert-triangle"></i> Incidents</td><td>Total Incidents</td><td>${m.totalIncidents}</td><td>100%</td></tr>
          <tr><td>SEV 1 (Critical)</td><td>${m.sev1}</td><td>${pct(m.sev1, m.totalIncidents)}</td></tr>
          <tr><td>SEV 2 (High)</td><td>${m.sev2}</td><td>${pct(m.sev2, m.totalIncidents)}</td></tr>
          <tr><td>SEV 3 (Medium)</td><td>${m.sev3}</td><td>${pct(m.sev3, m.totalIncidents)}</td></tr>
          <tr><td rowspan="2" class="category-cell"><i data-icon="check"></i> Detection</td><td>Detected by SM</td><td>${m.detectedBySM}</td><td>${m.detectionRate}%</td></tr>
          <tr><td>Not Detected</td><td>${m.totalIncidents - m.detectedBySM}</td><td>${m.totalIncidents > 0 ? (100 - m.detectionRate).toFixed(1) : 0}%</td></tr>
          <tr><td rowspan="2" class="category-cell"><i data-icon="package"></i> Batch</td><td>Events</td><td>${m.batchEvents}</td><td>${pct(m.batchEvents, m.totalBatch)}</td></tr>
          <tr><td>Pending</td><td>${m.batchPending}</td><td>${pct(m.batchPending, m.totalBatch)}</td></tr>
          <tr><td rowspan="2" class="category-cell"><i data-icon="users"></i> Support</td><td>MA Support</td><td>${m.supportMA}</td><td>${pct(m.supportMA, m.totalSupport)}</td></tr>
          <tr><td>Dev Support</td><td>${m.supportDev}</td><td>${pct(m.supportDev, m.totalSupport)}</td></tr>
          <tr><td rowspan="3" class="category-cell"><i data-icon="bell"></i> Updates</td><td>Alerts</td><td>${m.updateAlerts}</td><td>${pct(m.updateAlerts, m.totalUpdates)}</td></tr>
          <tr><td>Handover</td><td>${m.updateHandover}</td><td>${pct(m.updateHandover, m.totalUpdates)}</td></tr>
          <tr><td>Other</td><td>${m.updateOther}</td><td>${pct(m.updateOther, m.totalUpdates)}</td></tr>
          <tr><td rowspan="2" class="category-cell"><i data-icon="rocket"></i> Improvements</td><td>Improvements</td><td>${m.improvements}</td><td>${pct(m.improvements, m.totalImprovements)}</td></tr>
          <tr><td>Projects</td><td>${m.projects}</td><td>${pct(m.projects, m.totalImprovements)}</td></tr>
          <tr><td rowspan="2" class="category-cell">⏳ Status</td><td>Done</td><td>${m.done}</td><td>${m.completionRate}%</td></tr>
          <tr><td>In Progress</td><td>${m.inprogress}</td><td>${(m.done + m.inprogress) > 0 ? (100 - m.completionRate).toFixed(1) : 0}%</td></tr>
        </tbody>
      </table>
    `;
  }
}
