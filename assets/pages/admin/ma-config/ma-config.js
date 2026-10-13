// admin/ma-config — page script, extracted from admin/ma-config.html.
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

/* ── State ────────────────────────────────────── */
    let selectedTheme     = 'amber';
    let selectedTypeColor = 'amber';
    let modulesData       = [];
    const typesCache      = {};

    /* Badge color styles */
    const COLOR_STYLES = {
      amber:  { bg:'#fef3c7', text:'#92400e', border:'#fde68a' },
      blue:   { bg:'#dbeafe', text:'#1e40af', border:'#bfdbfe' },
      green:  { bg:'#dcfce7', text:'#166534', border:'#bbf7d0' },
      red:    { bg:'#fee2e2', text:'#991b1b', border:'#fecaca' },
      purple: { bg:'#ede9fe', text:'#5b21b6', border:'#ddd6fe' },
      orange: { bg:'#ffedd5', text:'#9a3412', border:'#fed7aa' },
      gray:   { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' },
    };

    function typeBadgeStyle(color) {
      const c = COLOR_STYLES[color] || COLOR_STYLES.gray;
      return `background:${c.bg};color:${c.text};border:1px solid ${c.border}`;
    }

    function selectTypeColor(color) {
      selectedTypeColor = color;
      document.querySelectorAll('.color-dot').forEach(d =>
        d.classList.toggle('selected', d.dataset.color === color)
      );
    }

    /* ── Init ─────────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', () => {
      Layout.render('admin-ma-config');
      // Apply per-team read/full mode. When mode = 'read', style.css hides
      // any element with data-action="add|edit|delete|write" and shows the
      // View-only pill in the top-right corner.
      if (typeof Auth !== 'undefined' && Auth.applyPageMode) Auth.applyPageMode('ma-config');
      loadModules();
    });

    /* ════════════════════════════════════════════════
       MODULES
    ════════════════════════════════════════════════ */
    async function loadModules() {
      // Clear stale cache so types reload fresh after every re-render
      Object.keys(typesCache).forEach(k => delete typesCache[k]);

      const result = await API.get('/ma-modules/config.php');
      if (result && result.data && result.data.success) {
        modulesData = result.data.data || [];
        renderModules(modulesData);
        for (const m of modulesData) {
          await toggleModule(m.id);
        }
      } else {
        document.getElementById('module-list').innerHTML =
          '<div style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load modules</div>';
      }
    }

    function renderModules(modules) {
      const list = document.getElementById('module-list');
      if (!modules.length) {
        list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:12px;">No modules configured</div>';
        return;
      }

      list.innerHTML = modules.map(m => {
        const theme      = m.theme || 'gray';
        const icon       = m.icon  || m.id.slice(0,2).toUpperCase();
        const statusBadge = m.builtin
          ? '<span class="mbadge builtin">built-in</span>'
          : `<span class="mbadge ${m.status || 'draft'}">${m.status || 'draft'}</span>`;
        const deleteBtn  = !m.builtin
          ? `<button class="mod-btn danger" data-action="delete" onclick="event.stopPropagation();deleteModule('${m.id}')">Delete</button>`
          : '';

        /* Which types API does this module use? */
        const typesApi   = moduleTypesApi(m.id);
        const typesLabel = moduleTypesLabel(m.id);

        return `
          <div class="module-row" id="module-row-${m.id}">
            <!-- Header row (clickable to expand) -->
            <div class="module-row-head" onclick="toggleModule('${m.id}')">
              <div class="module-accent accent-${theme}"></div>
              <div class="module-icon icon-${theme}">${escHtml(icon)}</div>
              <div class="module-meta">
                <div class="module-name">${escHtml(m.name)}</div>
                <div class="module-desc">${escHtml(m.desc || '')}</div>
              </div>
              <div class="module-badges">
                ${statusBadge}
                <div class="toggle-wrap" data-action="edit" onclick="event.stopPropagation()">
                  <label class="toggle">
                    <input type="checkbox" ${m.enabled ? 'checked' : ''}
                      onchange="toggleEnabled('${m.id}', this)">
                    <span class="toggle-slider"></span>
                  </label>
                  <span class="toggle-lbl" id="toggle-lbl-${m.id}">${m.enabled ? 'On' : 'Off'}</span>
                </div>
              </div>
              <button class="mod-btn edit" data-action="edit" onclick="event.stopPropagation();openEditModule('${m.id}')">Edit</button>
              ${deleteBtn}
              <span class="module-chevron"><i data-icon="play"></i></span>
            </div>

            <!-- Types panel (expands on click) -->
            <div class="module-types-panel" id="types-panel-${m.id}">
              <div class="types-panel-header">
                <span class="types-panel-label">${typesLabel}</span>
                <button class="mod-btn edit" data-action="add" onclick="openAddType('${m.id}')">+ Add</button>
              </div>
              <div class="types-list" id="types-list-${m.id}">
                <div class="types-empty">Loading...</div>
              </div>
            </div>
          </div>`;
      }).join('');
    }

    /* Determine how to manage types for a module */
    function moduleTypesMode(id) {
      if (id === 'usecases') return 'builtin-svc';   // uses /ma-services/types.php
      if (id === 'cutoffs')  return 'builtin-site';  // uses /cutoff-services/types.php
      return 'custom';                                // stored in module JSON
    }

    function moduleTypesApi(id) {
      if (id === 'usecases') return '/ma-services/types.php';
      if (id === 'cutoffs')  return '/cutoff-services/types.php';
      return null;
    }

    function moduleTypesLabel(id) {
      if (id === 'usecases') return 'Service Types';
      if (id === 'cutoffs')  return 'Site Types';
      return 'Sub-types';
    }

    function moduleTypesUnit(id) {
      if (id === 'usecases') return 'usecases';
      if (id === 'cutoffs')  return 'cut-offs';
      return 'items';
    }

    /* ── Accordion toggle ─────────────────────────── */
    async function toggleModule(id) {
      const row = document.getElementById(`module-row-${id}`);
      const isOpen = row.classList.contains('open');

      if (isOpen) {
        row.classList.remove('open');
        return;
      }

      row.classList.add('open');

      // Lazy-load types on first open
      if (!typesCache[id]) {
        await loadTypesForModule(id);
      }
    }

    /* ── Load types for one module ─────────────────── */
    async function loadTypesForModule(id) {
      const listEl = document.getElementById(`types-list-${id}`);
      const mode   = moduleTypesMode(id);

      if (mode === 'custom') {
        // Use type_data from modulesData (includes color)
        const m = modulesData.find(x => x.id === id);
        const rawTypes = (m?.type_data || (m?.types || []).map(n => ({ name: n, color: 'gray' })));
        typesCache[id] = rawTypes;
        renderTypesInPanel(id, rawTypes);
        return;
      }

      // Builtin modules: fetch from their dedicated API
      const result = await API.get(moduleTypesApi(id));
      const types  = result && result.data && result.data.success ? (result.data.data || []) : [];
      typesCache[id] = types;
      renderTypesInPanel(id, types);
    }

    function renderTypesInPanel(moduleId, types) {
      const listEl = document.getElementById(`types-list-${moduleId}`);
      const unit   = moduleTypesUnit(moduleId);

      if (!types.length) {
        listEl.innerHTML = '<div class="types-empty">No types yet — click "+ Add" to create one</div>';
        return;
      }

      listEl.innerHTML = types.map(t => {
        const color = t.color || 'gray';
        return `
          <div class="type-item">
            <div class="type-info">
              <span class="type-badge" style="${typeBadgeStyle(color)}">${escHtml(t.name)}</span>
              <span class="type-name">${escHtml(t.description || t.name)}</span>
              <span class="type-count">(${t.count || 0} ${unit})</span>
            </div>
            <div class="type-actions">
              <button class="mod-btn edit" data-action="edit"
                onclick="openEditType('${moduleId}','${escAttr(t.name)}','${escAttr(t.description||'')}','${color}')">
                Edit
              </button>
              <button class="mod-btn danger" data-action="delete"
                onclick="deleteType('${moduleId}','${escAttr(t.name)}')">
                Delete
              </button>
            </div>
          </div>`;
      }).join('');
    }

    /* ════════════════════════════════════════════════
       MODULE CRUD
    ════════════════════════════════════════════════ */
    function openAddModule() {
      document.getElementById('modal-module-title').textContent = 'Add Module';
      document.getElementById('module-edit-id').value = '';
      document.getElementById('module-name').value    = '';
      document.getElementById('module-desc').value    = '';
      document.getElementById('module-icon').value    = '';
      selectTheme('amber');
      openModal('modal-module');
    }

    function openEditModule(id) {
      const m = modulesData.find(x => x.id === id);
      if (!m) return;
      document.getElementById('modal-module-title').textContent = 'Edit Module';
      document.getElementById('module-edit-id').value = m.id;
      document.getElementById('module-name').value    = m.name;
      document.getElementById('module-desc').value    = m.desc || '';
      document.getElementById('module-icon').value    = m.icon || '';
      selectTheme(m.theme || 'amber');
      openModal('modal-module');
    }

    async function saveModule() {
      const id   = document.getElementById('module-edit-id').value;
      const name = document.getElementById('module-name').value.trim();
      const desc = document.getElementById('module-desc').value.trim();
      const icon = document.getElementById('module-icon').value.trim().toUpperCase();
      if (!name) { alert('Module name is required'); return; }

      const isEdit = !!id;
      const body   = isEdit
        ? { action: 'update', id, name, desc, icon, theme: selectedTheme }
        : { action: 'add',    name, desc, icon, theme: selectedTheme };

      const result = await API.post('/ma-modules/config.php', body);
      if (result && result.data && result.data.success) {
        // Log activity
        await logMAConfigActivity(isEdit ? 'update' : 'create', 'module', name, 
          `Theme: ${selectedTheme}, Icon: ${icon || 'N/A'}`);
        
        closeModal('modal-module');
        loadModules();
        showToast(isEdit ? 'Module updated' : 'Module added', 'success');
      } else {
        alert('Failed: ' + (result?.data?.message || 'Unknown error'));
      }
    }

    async function toggleEnabled(id, checkbox) {
      const lbl = document.getElementById(`toggle-lbl-${id}`);
      const result = await API.post('/ma-modules/config.php', { action: 'toggle', id });
      if (result && result.data && result.data.success) {
        if (lbl) lbl.textContent = checkbox.checked ? 'On' : 'Off';
        
        // Log activity
        const m = modulesData.find(x => x.id === id);
        if (m) {
          await logMAConfigActivity('update', 'module', m.name, 
            `Status: ${checkbox.checked ? 'Enabled' : 'Disabled'}`);
        }
        
        showToast('Module ' + (checkbox.checked ? 'enabled' : 'disabled'), 'success');
        if (m) m.enabled = checkbox.checked;
      } else {
        checkbox.checked = !checkbox.checked;
        alert('Failed: ' + (result?.data?.message || 'Unknown error'));
      }
    }

    async function deleteModule(id) {
      if (!confirm('Delete this module? This cannot be undone.')) return;
      
      const m = modulesData.find(x => x.id === id);
      const moduleName = m ? m.name : id;
      
      const result = await API.delete('/ma-modules/config.php', { id });
      if (result && result.data && result.data.success) {
        // Log activity
        await logMAConfigActivity('delete', 'module', moduleName, '');
        
        loadModules();
        showToast('Module deleted', 'success');
      } else {
        alert('Failed: ' + (result?.data?.message || 'Unknown error'));
      }
    }

    function selectTheme(theme) {
      selectedTheme = theme;
      document.querySelectorAll('.theme-dot').forEach(d =>
        d.classList.toggle('selected', d.dataset.theme === theme)
      );
    }

    /* ════════════════════════════════════════════════
       TYPE CRUD  (scoped to moduleId)
    ════════════════════════════════════════════════ */
    function openAddType(moduleId) {
      const label    = moduleTypesLabel(moduleId);
      const isCustom = moduleTypesMode(moduleId) === 'custom';
      document.getElementById('type-kind').value     = moduleId;
      document.getElementById('type-old-name').value = '';
      document.getElementById('modal-type-title').textContent = `Add ${label.replace(/s$/, '')}`;
      document.getElementById('type-save-btn').textContent = 'Save';
      document.getElementById('type-name').value = '';
      document.getElementById('type-desc').value = '';
      document.getElementById('type-desc-group').style.display = isCustom ? 'none' : '';
      selectTypeColor('amber');
      openModal('modal-type');
    }

    function openEditType(moduleId, name, desc, color) {
      const label    = moduleTypesLabel(moduleId);
      const isCustom = moduleTypesMode(moduleId) === 'custom';
      document.getElementById('type-kind').value     = moduleId;
      document.getElementById('type-old-name').value = name;
      document.getElementById('modal-type-title').textContent = `Edit ${label.replace(/s$/, '')}`;
      document.getElementById('type-save-btn').textContent = 'Update';
      document.getElementById('type-name').value = name;
      document.getElementById('type-desc').value = desc;
      document.getElementById('type-desc-group').style.display = isCustom ? 'none' : '';
      selectTypeColor(color || 'gray');
      openModal('modal-type');
    }

    async function saveType() {
      const moduleId = document.getElementById('type-kind').value;
      const oldName  = document.getElementById('type-old-name').value;
      const name     = document.getElementById('type-name').value.trim();
      const desc     = document.getElementById('type-desc').value.trim();
      if (!name) { alert('Please enter a name'); return; }

      const mode = moduleTypesMode(moduleId);
      let result;

      if (mode === 'custom') {
        if (oldName) {
          result = await API.post('/ma-modules/config.php',
            { action: 'update_type', id: moduleId, old_type: oldName, type: name, color: selectedTypeColor });
        } else {
          result = await API.post('/ma-modules/config.php',
            { action: 'add_type', id: moduleId, type: name, color: selectedTypeColor });
        }
        // Refresh local modulesData
        if (result && result.data && result.data.success) {
          const m = modulesData.find(x => x.id === moduleId);
          if (m) {
            m.types = m.types || [];
            m.type_data = m.type_data || [];
            if (oldName) {
              const idx = m.types.indexOf(oldName);
              if (idx !== -1) { m.types[idx] = name; m.type_data[idx] = { name, color: selectedTypeColor }; }
            } else {
              if (!m.types.includes(name)) {
                m.types.push(name);
                m.type_data.push({ name, color: selectedTypeColor });
              }
            }
          }
        }
      } else {
        // Builtin module — use dedicated types API (includes color)
        const path = moduleTypesApi(moduleId);
        if (oldName) {
          result = await API.request('PUT', path, { old_name: oldName, name, description: desc, color: selectedTypeColor });
        } else {
          result = await API.post(path, { name, description: desc, color: selectedTypeColor });
        }
      }

      if (result && result.data && result.data.success) {
        // Log activity
        const action = oldName ? 'update' : 'create';
        const moduleLabel = moduleTypesLabel(moduleId).replace(/s$/, '');
        const updatedCount = result.data.updated_services || result.data.updated_cutoffs || 0;
        const updateMsg = updatedCount > 0 ? ` (${updatedCount} items updated)` : '';
        
        await logMAConfigActivity(action, 'type', name, 
          `Module: ${moduleId}, ${moduleLabel}, Color: ${selectedTypeColor}${updateMsg}`);
        
        closeModal('modal-type');
        delete typesCache[moduleId];
        await loadTypesForModule(moduleId);
        
        const msg = oldName 
          ? `Type updated${updateMsg}` 
          : 'Type added';
        showToast(msg, 'success');
      } else {
        alert('Failed: ' + (result?.data?.message || 'Unknown error'));
      }
    }

    async function deleteType(moduleId, name) {
      if (!confirm(`Delete type "${name}"?`)) return;

      const mode = moduleTypesMode(moduleId);
      let result;

      if (mode === 'custom') {
        result = await API.post('/ma-modules/config.php',
          { action: 'delete_type', id: moduleId, type: name });
        if (result && result.data && result.data.success) {
          const m = modulesData.find(x => x.id === moduleId);
          if (m) m.types = (m.types || []).filter(t => t !== name);
        }
      } else {
        const path = moduleTypesApi(moduleId) + '?name=' + encodeURIComponent(name);
        result = await API.delete(path);
      }

      if (result && result.data && result.data.success) {
        // Log activity
        const moduleLabel = moduleTypesLabel(moduleId).replace(/s$/, '');
        await logMAConfigActivity('delete', 'type', name, 
          `Module: ${moduleId}, ${moduleLabel}`);
        
        delete typesCache[moduleId];
        await loadTypesForModule(moduleId);
        showToast('Type deleted', 'success');
      } else {
        alert('Failed: ' + (result?.data?.message || 'Unknown error'));
      }
    }

    /* ── Activity Logging ───────────────────────── */
    async function logMAConfigActivity(action, type, itemName, details = '') {
      try {
        // Map actions to standardized format
        const actionMap = {
          'create': `ma_config_${type}_create`,
          'update': `ma_config_${type}_update`,
          'delete': `ma_config_${type}_delete`
        };
        
        const logAction = actionMap[action] || `ma_config_${type}_${action}`;
        
        const token = Auth.getToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        await fetch('../api/log/create.php', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            action: logAction,
            detail: {
              type: type,
              item_name: itemName,
              details: details
            }
          })
        });
      } catch (error) {
        console.error('Error logging activity:', error);
      }
    }

    /* ── Helpers ─────────────────────────────────── */
    function openModal(id)  { document.getElementById(id).classList.add('active'); }
    function closeModal(id) { document.getElementById(id).classList.remove('active'); }

    function showToast(msg, type) {
      if (window.Toast && window.Toast.show) Toast.show(msg, type);
      else console.log(msg);
    }

    function escHtml(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function escAttr(s) { return String(s).replace(/'/g,"\\'"); }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteModule", { configurable: true, get: () => deleteModule, set: (v) => { deleteModule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteType", { configurable: true, get: () => deleteType, set: (v) => { deleteType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escAttr", { configurable: true, get: () => escAttr, set: (v) => { escAttr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadModules", { configurable: true, get: () => loadModules, set: (v) => { loadModules = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadTypesForModule", { configurable: true, get: () => loadTypesForModule, set: (v) => { loadTypesForModule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "logMAConfigActivity", { configurable: true, get: () => logMAConfigActivity, set: (v) => { logMAConfigActivity = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "moduleTypesApi", { configurable: true, get: () => moduleTypesApi, set: (v) => { moduleTypesApi = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "moduleTypesLabel", { configurable: true, get: () => moduleTypesLabel, set: (v) => { moduleTypesLabel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "moduleTypesMode", { configurable: true, get: () => moduleTypesMode, set: (v) => { moduleTypesMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "moduleTypesUnit", { configurable: true, get: () => moduleTypesUnit, set: (v) => { moduleTypesUnit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openAddModule", { configurable: true, get: () => openAddModule, set: (v) => { openAddModule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openAddType", { configurable: true, get: () => openAddType, set: (v) => { openAddType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModule", { configurable: true, get: () => openEditModule, set: (v) => { openEditModule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditType", { configurable: true, get: () => openEditType, set: (v) => { openEditType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderModules", { configurable: true, get: () => renderModules, set: (v) => { renderModules = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTypesInPanel", { configurable: true, get: () => renderTypesInPanel, set: (v) => { renderTypesInPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveModule", { configurable: true, get: () => saveModule, set: (v) => { saveModule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveType", { configurable: true, get: () => saveType, set: (v) => { saveType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectTheme", { configurable: true, get: () => selectTheme, set: (v) => { selectTheme = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectTypeColor", { configurable: true, get: () => selectTypeColor, set: (v) => { selectTypeColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showToast", { configurable: true, get: () => showToast, set: (v) => { showToast = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleEnabled", { configurable: true, get: () => toggleEnabled, set: (v) => { toggleEnabled = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleModule", { configurable: true, get: () => toggleModule, set: (v) => { toggleModule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "typeBadgeStyle", { configurable: true, get: () => typeBadgeStyle, set: (v) => { typeBadgeStyle = v; } }); } catch (e) {}
})();
