/* ══════════════════════════════════════════════════
   admin-kb.js  |  Knowledge Base Admin
   ══════════════════════════════════════════════════ */

let kbData = null;
let deletingCategoryId = null;

// Initialize
async function _initAdminKb() {
  if (!Auth.requireAdmin()) return;
  
  await Layout.render('admin');
  await loadData();
  renderStats();
  renderCategories();
}

// Load data
async function loadData() {
  try {
    const response = await API.knowledgeBase.list();
    if (response && response.ok && response.data) {
      kbData = response.data.data || response.data;
    } else {
      kbData = { categories: {}, entries: {} };
    }
  } catch (error) {
    console.error('Failed to load:', error);
    kbData = { categories: {}, entries: {} };
  }
}

// Render stats
function renderStats() {
  const totalCategories = Object.keys(kbData.categories || {}).length;
  const totalEntries = Object.values(kbData.entries || {}).reduce((sum, arr) => sum + arr.length, 0);
  
  document.getElementById('stat-categories').textContent = totalCategories;
  document.getElementById('stat-entries').textContent = totalEntries;
  
  // Find last updated
  let lastUpdated = null;
  Object.values(kbData.entries || {}).forEach(catEntries => {
    catEntries.forEach(entry => {
      const updated = new Date(entry.updated_at || entry.created_at);
      if (!lastUpdated || updated > lastUpdated) {
        lastUpdated = updated;
      }
    });
  });
  
  document.getElementById('stat-updated').textContent = lastUpdated 
    ? lastUpdated.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
}

// Render categories
function renderCategories() {
  const container = document.getElementById('category-list');
  const categories = kbData.categories || {};
  
  if (Object.keys(categories).length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">◯</div>No categories yet</div>';
    return;
  }
  
  container.innerHTML = Object.entries(categories).map(([catId, cat]) => {
    const entryCount = (kbData.entries[catId] || []).length;
    const fieldCount = (cat.fields || []).length;
    
    return `
      <div class="category-card">
        <div class="category-info">
          <div class="category-name">${escHtml(cat.name)}</div>
          <div class="category-meta">
            ${entryCount} entries · ${fieldCount} fields · Created ${new Date(cat.created_at).toLocaleDateString('th-TH')}
          </div>
        </div>
        <div class="category-actions">
          <button class="btn btn-sm btn-outline" onclick="viewCategory('${catId}')">
            <i>→</i> View
          </button>
          <button class="btn btn-sm btn-danger" onclick="confirmDeleteCategory('${catId}')">
            <i>×</i> Delete
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// View category
function viewCategory(catId) {
  window.location.href = '../knowledge-base.html#' + catId;
}

// Confirm delete category
function confirmDeleteCategory(catId) {
  deletingCategoryId = catId;
  openModal('modal-delete-category');
}

// Execute delete category
async function executeDeleteCategory() {
  if (!deletingCategoryId) return;
  
  try {
    const response = await API.post('/knowledge-base/delete-category.php', {
      category_id: deletingCategoryId
    });
    
    if (response && response.ok) {
      showToast('Category deleted', 'success');
      await loadData();
      renderStats();
      renderCategories();
      closeModal('modal-delete-category');
    } else {
      showToast(response?.data?.message || 'Failed to delete', 'error');
    }
  } catch (error) {
    showToast('Failed to delete category', 'error');
  }
}

// Export data
function exportData() {
  const dataStr = JSON.stringify(kbData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `knowledge-base-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported', 'success');
}

// Open import modal
function openImportModal() {
  openModal('modal-import');
}

// Execute import
async function executeImport() {
  const jsonStr = document.getElementById('import-json').value.trim();
  if (!jsonStr) {
    showToast('Please paste JSON data', 'error');
    return;
  }
  
  try {
    const data = JSON.parse(jsonStr);
    
    if (!data.categories || !data.entries) {
      showToast('Invalid JSON structure', 'error');
      return;
    }
    
    const response = await API.post('/knowledge-base/import.php', data);
    
    if (response && response.ok) {
      showToast('Data imported successfully', 'success');
      await loadData();
      renderStats();
      renderCategories();
      closeModal('modal-import');
      document.getElementById('import-json').value = '';
    } else {
      showToast(response?.data?.message || 'Failed to import', 'error');
    }
  } catch (error) {
    showToast('Invalid JSON format', 'error');
  }
}

// Confirm clear all
function confirmClearAll() {
  if (!confirm('⚠️ WARNING: This will delete ALL categories and entries!\n\nThis action cannot be undone. Are you sure?')) {
    return;
  }
  
  if (!confirm('Please confirm again: Delete ALL Knowledge Base data?')) {
    return;
  }
  
  executeClearAll();
}

// Execute clear all
async function executeClearAll() {
  try {
    const response = await API.post('/knowledge-base/clear-all.php', {});
    
    if (response && response.ok) {
      showToast('All data cleared', 'success');
      await loadData();
      renderStats();
      renderCategories();
    } else {
      showToast(response?.data?.message || 'Failed to clear data', 'error');
    }
  } catch (error) {
    showToast('Failed to clear data', 'error');
  }
}

// Helpers
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function showToast(message, type = 'info') {
  if (typeof Toast !== 'undefined' && Toast.show) {
    Toast.show(message, type);
  } else {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-dot"></span>
      <span class="toast-msg">${escHtml(message)}</span>
    `;
    
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'toastOut .25s ease both';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAdminKb, { once: true });
} else {
  _initAdminKb();
}
