// admin/system-monitor — page script, extracted from admin/system-monitor.html.
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

// Require admin auth
    if (!Auth.requireAdmin()) {}
    Layout.render('admin');

    // Security events are audit data — reveal card only for super_admin
    const _isSuperAdmin = Auth.getUser()?.role === 'super_admin';
    let refreshInterval;
    
    async function loadHealthStatus() {
      try {
        const response = await fetch(`${API_BASE}/health/check.php`);
        const data = await response.json();
        
        let html = '';
        for (const [check, result] of Object.entries(data.checks)) {
          const statusClass = result.status === 'ok' ? 'status-ok' : 
                             result.status === 'warning' ? 'status-warning' : 'status-error';
          
          html += `
            <div class="stat-row">
              <span class="stat-label">
                <span class="status-dot ${statusClass}"></span>
                ${check.replace(/_/g, ' ')}
              </span>
              <span class="stat-value">${result.status}</span>
            </div>
          `;
        }
        
        document.getElementById('health-status').innerHTML = html;
      } catch (error) {
        document.getElementById('health-status').innerHTML = '<div class="stat-row">Error loading health status</div>';
      }
    }
    
    async function loadCacheStats() {
      try {
        const response = await fetch(`${API_BASE}/cache/stats.php`, {
          headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
        });
        const data = await response.json();
        
        if (data.success) {
          const stats = data.data;
          let html = `
            <div class="stat-row">
              <span class="stat-label">Backend</span>
              <span class="stat-value">${stats.backend}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Hit Rate</span>
              <span class="stat-value">${stats.hit_rate}%</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Total Hits</span>
              <span class="stat-value">${stats.hits_apcu + stats.hits_file}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Misses</span>
              <span class="stat-value">${stats.misses}</span>
            </div>
          `;
          
          if (stats.file) {
            html += `
              <div class="stat-row">
                <span class="stat-label">File Cache Usage</span>
                <span class="stat-value">${stats.file.usage_percent}%</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${stats.file.usage_percent > 80 ? 'warning' : ''}" 
                     style="width: ${stats.file.usage_percent}%"></div>
              </div>
            `;
          }
          
          document.getElementById('cache-stats').innerHTML = html;
        }
      } catch (error) {
        document.getElementById('cache-stats').innerHTML = '<div class="stat-row">Error loading cache stats</div>';
      }
    }
    
    async function loadPerformanceMetrics() {
      try {
        const response = await fetch(`${API_BASE}/monitoring/metrics.php`, {
          headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
        });
        const text = await response.text();
        
        // Parse Prometheus format (simplified)
        const lines = text.split('\n');
        let html = '<div class="stat-row"><span class="stat-label">Metrics collected</span><span class="stat-value"><i data-icon="check"></i></span></div>';
        
        document.getElementById('performance-metrics').innerHTML = html;
      } catch (error) {
        document.getElementById('performance-metrics').innerHTML = '<div class="stat-row">Error loading metrics</div>';
      }
    }
    
    async function loadSecurityLogs() {
      try {
        const response = await fetch(`${API_BASE}/log/security.php?limit=10`, {
          headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
        });
        const data = await response.json();
        
        if (data.success && data.data.length > 0) {
          let html = '';
          for (const log of data.data) {
            const eventType = getEventType(log.event);
            const userName = log.user_name || 'Unknown';
            const userId = log.user_id || 'N/A';
            const initials = getInitials(userName);
            
            html += `
              <div class="log-item">
                <div class="log-header">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="log-badge ${eventType.severity}">${eventType.label}</span>
                    <span class="log-event">${escapeHtml(eventType.title)}</span>
                  </div>
                  <span class="log-time">${formatDateTime(log.ts)}</span>
                </div>
                
                ${userName !== 'Unknown' ? `
                <div class="log-user">
                  <div class="log-user-icon">${initials}</div>
                  <span class="log-user-name">${escapeHtml(userName)}</span>
                  <span class="log-user-id">(${escapeHtml(userId)})</span>
                </div>
                ` : ''}
                
                <div class="log-meta">
                  <div class="log-meta-item">
                    <span class="log-meta-label">IP:</span>
                    <span>${escapeHtml(log.ip || 'N/A')}</span>
                  </div>
                  <div class="log-meta-item">
                    <span class="log-meta-label">Browser:</span>
                    <span>${escapeHtml(log.ua || 'N/A')}</span>
                  </div>
                  ${log.path ? `
                  <div class="log-meta-item">
                    <span class="log-meta-label">Path:</span>
                    <span>${escapeHtml(log.path)}</span>
                  </div>
                  ` : ''}
                </div>
                
                ${log.detail && Object.keys(log.detail).length > 0 ? `
                <div class="log-detail">
                  ${formatDetail(log.detail)}
                </div>
                ` : ''}
              </div>
            `;
          }
          document.getElementById('security-logs').innerHTML = html;
        } else {
          document.getElementById('security-logs').innerHTML = '<div class="log-item">No recent security events</div>';
        }
      } catch (error) {
        document.getElementById('security-logs').innerHTML = '<div class="log-item">Error loading logs</div>';
      }
    }
    
    function getEventType(event) {
      const types = {
        'login_success': { label: 'Success', severity: 'success', title: 'Login Success' },
        'login_failed': { label: 'Error', severity: 'error', title: 'Login Failed' },
        'logout': { label: 'Info', severity: 'info', title: 'Logout' },
        'auth_no_token': { label: 'Warning', severity: 'warning', title: 'No Auth Token' },
        'token_invalid': { label: 'Error', severity: 'error', title: 'Invalid Token' },
        'forbidden': { label: 'Error', severity: 'error', title: 'Access Forbidden' },
        'brute_force_blocked': { label: 'Error', severity: 'error', title: 'Brute Force Blocked' },
        'api_rate_limit_exceeded': { label: 'Warning', severity: 'warning', title: 'Rate Limit Exceeded' },
        'csrf_token_missing': { label: 'Warning', severity: 'warning', title: 'CSRF Token Missing' },
        'csrf_token_invalid': { label: 'Error', severity: 'error', title: 'CSRF Token Invalid' },
        'file_upload_rejected': { label: 'Warning', severity: 'warning', title: 'File Upload Rejected' },
        'suspicious_file': { label: 'Error', severity: 'error', title: 'Suspicious File Detected' },
        'password_changed': { label: 'Info', severity: 'info', title: 'Password Changed' },
        'user_created': { label: 'Info', severity: 'info', title: 'User Created' },
        'user_deleted': { label: 'Warning', severity: 'warning', title: 'User Deleted' },
      };
      
      return types[event] || { label: 'Info', severity: 'info', title: event.replace(/_/g, ' ').toUpperCase() };
    }
    
    function formatDetail(detail) {
      if (typeof detail === 'string') return escapeHtml(detail);
      
      let parts = [];
      for (const [key, value] of Object.entries(detail)) {
        const label = key.replace(/_/g, ' ');
        parts.push(`<strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}`);
      }
      return parts.join(' <i data-icon="circle"></i> ');
    }
    
    function formatDateTime(iso) {
      if (!iso) return 'N/A';
      const d = new Date(iso);
      if (isNaN(d)) return 'N/A';
      
      const now = new Date();
      const diff = now - d;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 1) return 'Just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      
      return d.toLocaleString('th-TH', { 
        day: '2-digit', 
        month: 'short', 
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    function getInitials(name) {
      if (!name) return '?';
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    async function clearCache() {
      if (!confirm('Clear all cache? This may temporarily slow down the system.')) return;
      
      try {
        const response = await fetch(`${API_BASE}/cache/clear.php`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Auth.getToken(),
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        
        if (data.success) {
          alert('Cache cleared successfully');
          loadCacheStats();
        } else {
          alert('Failed to clear cache: ' + data.message);
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }
    
    async function rotateLogs() {
      if (!confirm('Rotate log files now?')) return;
      
      try {
        const response = await fetch(`${API_BASE}/logging/rotate.php`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Auth.getToken(),
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        
        if (data.success) {
          alert('Logs rotated successfully');
        } else {
          alert('Failed to rotate logs: ' + data.message);
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }
    
    async function createBackup() {
      if (!confirm('Create backup now? This may take a few minutes.')) return;
      
      try {
        const response = await fetch(`${API_BASE}/backup/create.php`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Auth.getToken(),
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        
        if (data.success) {
          alert('Backup created successfully: ' + data.data.backup_id);
        } else {
          alert('Failed to create backup: ' + data.message);
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }
    
    async function cleanupOldData() {
      if (!confirm('Cleanup old analytics data and logs?')) return;
      
      try {
        const response = await fetch(`${API_BASE}/analytics/cleanup.php`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Auth.getToken(),
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        
        if (data.success) {
          alert('Cleanup completed');
        } else {
          alert('Failed to cleanup: ' + data.message);
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }
    
    function refreshMetrics() {
      loadHealthStatus();
      loadCacheStats();
      loadPerformanceMetrics();
      if (_isSuperAdmin) loadSecurityLogs();
    }

    // Initial load
    document.addEventListener('DOMContentLoaded', () => {
      if (_isSuperAdmin) {
        document.getElementById('security-events-card').style.display = '';
      }
      refreshMetrics();
      
      // Auto-refresh every 30 seconds
      refreshInterval = setInterval(refreshMetrics, 30000);
    });
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    });

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "cleanupOldData", { configurable: true, get: () => cleanupOldData, set: (v) => { cleanupOldData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearCache", { configurable: true, get: () => clearCache, set: (v) => { clearCache = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "createBackup", { configurable: true, get: () => createBackup, set: (v) => { createBackup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escapeHtml", { configurable: true, get: () => escapeHtml, set: (v) => { escapeHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatDateTime", { configurable: true, get: () => formatDateTime, set: (v) => { formatDateTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatDetail", { configurable: true, get: () => formatDetail, set: (v) => { formatDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getEventType", { configurable: true, get: () => getEventType, set: (v) => { getEventType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getInitials", { configurable: true, get: () => getInitials, set: (v) => { getInitials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadCacheStats", { configurable: true, get: () => loadCacheStats, set: (v) => { loadCacheStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHealthStatus", { configurable: true, get: () => loadHealthStatus, set: (v) => { loadHealthStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPerformanceMetrics", { configurable: true, get: () => loadPerformanceMetrics, set: (v) => { loadPerformanceMetrics = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSecurityLogs", { configurable: true, get: () => loadSecurityLogs, set: (v) => { loadSecurityLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshMetrics", { configurable: true, get: () => refreshMetrics, set: (v) => { refreshMetrics = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rotateLogs", { configurable: true, get: () => rotateLogs, set: (v) => { rotateLogs = v; } }); } catch (e) {}
})();
