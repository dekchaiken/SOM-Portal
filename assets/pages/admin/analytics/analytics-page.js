// admin/analytics — page script, extracted from admin/analytics.html.
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

  let trendsChart = null;

  // Set default date range (last 30 days)
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  
  document.getElementById('end-date').valueAsDate = today;
  document.getElementById('start-date').valueAsDate = thirtyDaysAgo;

  async function loadAnalytics() {
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    
    try {
      const res = await fetch(`${API_BASE}/analytics/stats.php?start_date=${startDate}&end_date=${endDate}`, {
        headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
      });
      
      const data = await res.json();
      
      if (data.success) {
        renderStats(data.data);
        renderTopFeatures(data.data.top_features);
        renderBottomFeatures(data.data.bottom_features);
        renderTopPages(data.data.top_pages);
        renderTrendsChart(data.data.daily_trends);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  }

  function renderStats(data) {
    document.getElementById('total-events').textContent = formatNumber(data.total_events || 0);
    document.getElementById('unique-users').textContent = formatNumber(data.unique_users || 0);
    document.getElementById('total-pages').textContent = formatNumber(data.total_page_views || 0);
    document.getElementById('total-features').textContent = formatNumber(data.total_feature_uses || 0);
  }

  function renderTopFeatures(features) {
    const container = document.getElementById('top-features');
    
    if (!features || features.length === 0) {
      container.innerHTML = '<li class="empty-state-sm"><div class="empty-icon"><i data-icon="bar-chart"></i></div><div>No data available</div></li>';
      return;
    }
    
    const maxCount = features[0]?.count || 1;
    
    container.innerHTML = features.slice(0, 10).map((feature, index) => {
      const percentage = (feature.count / maxCount) * 100;
      const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : 'rank-other';
      
      return `
        <li class="feature-item">
          <div class="feature-info">
            <div class="feature-rank ${rankClass}">${index + 1}</div>
            <div class="feature-name" title="${escapeHtml(feature.feature)}">${escapeHtml(formatFeatureName(feature.feature))}</div>
          </div>
          <div style="display: flex; align-items: center;">
            <span class="feature-count">${formatNumber(feature.count)}</span>
            <div class="feature-bar">
              <div class="feature-bar-fill" style="width: ${percentage}%"></div>
            </div>
          </div>
        </li>
      `;
    }).join('');
  }

  function renderBottomFeatures(features) {
    const container = document.getElementById('bottom-features');
    
    if (!features || features.length === 0) {
      container.innerHTML = '<li class="empty-state-sm"><div class="empty-icon"><i data-icon="bar-chart"></i></div><div>No data available</div></li>';
      return;
    }
    
    const maxCount = features[0]?.count || 1;
    
    container.innerHTML = features.slice(0, 10).map((feature, index) => {
      const percentage = (feature.count / maxCount) * 100;
      
      return `
        <li class="feature-item">
          <div class="feature-info">
            <div class="feature-rank rank-other">${index + 1}</div>
            <div class="feature-name" title="${escapeHtml(feature.feature)}">${escapeHtml(formatFeatureName(feature.feature))}</div>
          </div>
          <div style="display: flex; align-items: center;">
            <span class="feature-count" style="color: #ef4444;">${formatNumber(feature.count)}</span>
            <div class="feature-bar">
              <div class="feature-bar-fill" style="width: ${percentage}%; background: #ef4444;"></div>
            </div>
          </div>
        </li>
      `;
    }).join('');
  }

  function renderTopPages(pages) {
    const container = document.getElementById('top-pages');
    
    if (!pages || pages.length === 0) {
      container.innerHTML = '<li class="empty-state-sm"><div class="empty-icon"><i data-icon="file"></i></div><div>No data available</div></li>';
      return;
    }
    
    const maxCount = pages[0]?.count || 1;
    
    container.innerHTML = pages.slice(0, 10).map((page, index) => {
      const percentage = (page.count / maxCount) * 100;
      const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : 'rank-other';
      
      return `
        <li class="feature-item">
          <div class="feature-info">
            <div class="feature-rank ${rankClass}">${index + 1}</div>
            <div class="feature-name" title="${escapeHtml(page.page)}">${escapeHtml(formatPageName(page.page))}</div>
          </div>
          <div style="display: flex; align-items: center;">
            <span class="feature-count">${formatNumber(page.count)}</span>
            <div class="feature-bar">
              <div class="feature-bar-fill" style="width: ${percentage}%"></div>
            </div>
          </div>
        </li>
      `;
    }).join('');
  }

  function renderTrendsChart(trends) {
    const ctx = document.getElementById('trends-chart');
    
    if (!ctx) {
      console.error('Chart canvas not found');
      return;
    }
    
    if (!trends || trends.length === 0) {
      const container = ctx.parentElement;
      if (container) {
        container.innerHTML = '<div class="empty-state-sm"><div class="empty-icon"><i data-icon="trending-up"></i></div><div>No trend data available</div></div>';
      }
      return;
    }
    
    // Destroy existing chart
    if (trendsChart) {
      trendsChart.destroy();
    }
    
    const labels = trends.map(t => {
      const date = new Date(t.date);
      return date.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
    });
    
    const pageViews = trends.map(t => t.page_views || 0);
    const featureUses = trends.map(t => t.feature_uses || 0);
    
    trendsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Page Views',
            data: pageViews,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Feature Uses',
            data: featureUses,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              font: { family: 'JetBrains Mono', size: 11 },
              color: '#666',
              usePointStyle: true,
              padding: 15
            }
          },
          tooltip: {
            backgroundColor: '#1c1c1e',
            titleFont: { family: 'JetBrains Mono', size: 11 },
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            padding: 12,
            cornerRadius: 8
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              font: { family: 'JetBrains Mono', size: 10 },
              color: '#999'
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.05)'
            }
          },
          x: {
            ticks: {
              font: { family: 'JetBrains Mono', size: 10 },
              color: '#999'
            },
            grid: {
              display: false
            }
          }
        }
      }
    });
  }

  function formatFeatureName(feature) {
    // Convert snake_case to Title Case
    return feature
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function formatPageName(page) {
    // Extract filename from path
    const parts = page.split('/');
    const filename = parts[parts.length - 1] || 'Home';
    return filename.replace('.html', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initial load
  loadAnalytics();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "escapeHtml", { configurable: true, get: () => escapeHtml, set: (v) => { escapeHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatFeatureName", { configurable: true, get: () => formatFeatureName, set: (v) => { formatFeatureName = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatNumber", { configurable: true, get: () => formatNumber, set: (v) => { formatNumber = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatPageName", { configurable: true, get: () => formatPageName, set: (v) => { formatPageName = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAnalytics", { configurable: true, get: () => loadAnalytics, set: (v) => { loadAnalytics = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderBottomFeatures", { configurable: true, get: () => renderBottomFeatures, set: (v) => { renderBottomFeatures = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTopFeatures", { configurable: true, get: () => renderTopFeatures, set: (v) => { renderTopFeatures = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTopPages", { configurable: true, get: () => renderTopPages, set: (v) => { renderTopPages = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTrendsChart", { configurable: true, get: () => renderTrendsChart, set: (v) => { renderTrendsChart = v; } }); } catch (e) {}
})();
