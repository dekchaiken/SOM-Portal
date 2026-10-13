// admin/weekly-report — page script, extracted from admin/weekly-report.html.
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

if (!Auth.requireAuth()) {}
Layout.render('admin');

let allWeeksData = [];

async function loadWeeks() {
  try {
    const response = await WeeklyReportAPI.listWeeks();
    const weeks = response.weeks || [];
    
    // Load all week data
    allWeeksData = [];
    for (const week of weeks) {
      try {
        const weekResponse = await WeeklyReportAPI.getWeek(week);
        allWeeksData.push({
          week,
          data: weekResponse.data
        });
      } catch (error) {
        console.error(`Failed to load ${week}:`, error);
      }
    }
    
    renderStats();
    renderTable();
  } catch (error) {
    console.error('Failed to load weeks:', error);
    Toast.error('Failed to load data');
  }
}

function renderStats() {
  let totalIncidents = 0;
  let totalBatch = 0;
  let totalSupport = 0;
  
  allWeeksData.forEach(({ data }) => {
    totalIncidents += (data.incidents || []).length;
    totalBatch += (data.batch?.event || []).length + (data.batch?.pending || []).length;
    totalSupport += (data.support?.ma || []).length + (data.support?.dev || []).length;
  });
  
  document.getElementById('totalWeeks').textContent = allWeeksData.length;
  document.getElementById('totalIncidents').textContent = totalIncidents;
  document.getElementById('totalBatch').textContent = totalBatch;
  document.getElementById('totalSupport').textContent = totalSupport;
}

function renderTable() {
  const tbody = document.getElementById('weeksTableBody');
  
  if (allWeeksData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No weekly reports found</td></tr>';
    return;
  }
  
  // Sort by date descending
  allWeeksData.sort((a, b) => b.week.localeCompare(a.week));
  
  tbody.innerHTML = allWeeksData.map(({ week, data }) => {
    const dateRange = WeeklyDateUtils.formatWeekRange(week);
    const incidents = (data.incidents || []).length;
    const batch = (data.batch?.event || []).length + (data.batch?.pending || []).length;
    const support = (data.support?.ma || []).length + (data.support?.dev || []).length;
    const updates = (data.updates?.alert || []).length + (data.updates?.handover || []).length + (data.updates?.other || []).length;
    const improvements = (data.improvements?.improve || []).length + (data.improvements?.project || []).length;
    const updatedAt = data.updatedAt ? DateTime.timeAgo(data.updatedAt) : '—';
    
    return `
      <tr>
        <td><strong>${week}</strong></td>
        <td>${dateRange}</td>
        <td>${incidents}</td>
        <td>${batch}</td>
        <td>${support}</td>
        <td>${updates}</td>
        <td>${improvements}</td>
        <td>${updatedAt}</td>
        <td>
          <div class="action-btns">
            <a href="../weekly-report.html?week=${week}" class="btn btn-ghost btn-xs" title="View"><i data-icon="eye"></i></a>
            <a href="../weekly-report-form.html?week=${week}" class="btn btn-ghost btn-xs" title="Edit"><i data-icon="pencil"></i></a>
            <button class="btn btn-ghost btn-xs" onclick="exportWeek('${week}')" title="Export"><i data-icon="inbox"></i></button>
            <button class="btn btn-danger btn-xs" onclick="deleteWeek('${week}')" title="Delete"><i data-icon="trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteWeek(week) {
  const confirmed = await confirmDialog(
    `Are you sure you want to delete ${week}? This action cannot be undone.`,
    'Delete Week'
  );
  
  if (!confirmed) return;
  
  try {
    await WeeklyReportAPI.deleteWeek(week);
    Toast.success('Week deleted successfully');
    loadWeeks();
  } catch (error) {
    console.error('Failed to delete week:', error);
    Toast.error('Failed to delete: ' + error.message);
  }
}

function exportWeek(week) {
  window.open(`../api/weekly-report/export.php?week=${week}&format=csv`, '_blank');
}

function exportAllData() {
  const year = new Date().getFullYear();
  window.open(`../api/weekly-report/export.php?type=yearly&year=${year}&format=csv`, '_blank');
}

// Initialize
loadWeeks();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "deleteWeek", { configurable: true, get: () => deleteWeek, set: (v) => { deleteWeek = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportAllData", { configurable: true, get: () => exportAllData, set: (v) => { exportAllData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportWeek", { configurable: true, get: () => exportWeek, set: (v) => { exportWeek = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadWeeks", { configurable: true, get: () => loadWeeks, set: (v) => { loadWeeks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
})();
