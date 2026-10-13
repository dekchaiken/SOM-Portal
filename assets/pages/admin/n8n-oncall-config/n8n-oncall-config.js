// admin/n8n-oncall-config — page script, extracted from admin/n8n-oncall-config.html.
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


/* ── next inline block ── */


    const form = document.getElementById('config-form');
    const webhookInput = document.getElementById('webhook-url');
    const testBtn = document.getElementById('test-btn');
    const alertContainer = document.getElementById('alert-container');
    const testResultDiv = document.getElementById('test-result');

    // Load current config
    async function loadConfig() {
      try {
        const res = await API.get('/n8n-oncall-config.php');
        if (res?.ok && res.data) {
          webhookInput.value = res.data.webhook_url || '';
        }
      } catch (err) {
        console.error('Failed to load config:', err);
      }
    }

    // Show alert
    function showAlert(message, type = 'success') {
      const icon = type === 'success' ? '<i data-icon="check-circle"></i>' : type === 'error' ? '<i data-icon="x-circle"></i>' : '<i data-icon="alert-triangle"></i>';
      alertContainer.innerHTML = `
        <div class="alert alert-${type}">
          <span>${icon}</span>
          <span>${message}</span>
        </div>
      `;
      setTimeout(() => {
        alertContainer.innerHTML = '';
      }, 5000);
    }

    // Save config
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const webhookUrl = webhookInput.value.trim();
      if (!webhookUrl) {
        showAlert('กรุณาใส่ Webhook URL', 'error');
        return;
      }

      try {
        const res = await API.post('/n8n-oncall-config.php', { webhook_url: webhookUrl });

        if (res?.ok) {
          showAlert('บันทึกสำเร็จ! ระบบจะใช้ n8n webhook นี้ในการดึงข้อมูล', 'success');
          // Keep the value in input after save
          webhookInput.value = webhookUrl;
        } else {
          showAlert(res?.data?.message || 'เกิดข้อผิดพลาด', 'error');
        }
      } catch (err) {
        showAlert('ไม่สามารถบันทึกได้: ' + err.message, 'error');
      }
    });

    // Test webhook
    testBtn.addEventListener('click', async () => {
      const webhookUrl = webhookInput.value.trim();
      if (!webhookUrl) {
        showAlert('กรุณาใส่ Webhook URL ก่อน', 'warning');
        return;
      }

      testBtn.disabled = true;
      testBtn.innerHTML = '<span>⏳</span> Testing...';
      testResultDiv.style.display = 'none';

      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await API.get(`/n8n-oncall.php?date=${today}&refresh=1`);

        if (res?.ok && res.data) {
          const oncall = res.data.oncall || [];
          const teams = [...new Set(oncall.map(p => p.team))];
          
          if (teams.length > 0) {
            const teamColors = {
              'TMN': '#3b82f6',
              'NNO': '#22c55e',
              'IM': '#8b5cf6',
              'CloudTech': '#f59e0b',
              'DBA': '#ec4899',
              'SD': '#14b8a6',
              'SRE': '#f26419',
              'System': '#6366f1',
              'Network': '#10b981'
            };

            const badges = teams.map(team => {
              const color = teamColors[team] || '#888';
              return `
                <span class="team-badge" style="color: ${color}; background: ${color}20; border: 1px solid ${color}40;">
                  <span class="team-badge-dot"></span>
                  ${team}
                </span>
              `;
            }).join('');

            testResultDiv.innerHTML = `
              <div class="test-result-header"><i data-icon="check-circle"></i> Webhook ทำงานได้! พบข้อมูล ${teams.length} ทีม:</div>
              <div class="test-result-teams">${badges}</div>
            `;
            testResultDiv.style.display = 'block';
            showAlert(`Webhook ทำงานได้! พบข้อมูล ${teams.length} ทีม: ${teams.join(', ')}`, 'success');
          } else {
            testResultDiv.innerHTML = `
              <div class="test-result-header"><i data-icon="alert-triangle"></i> ไม่พบข้อมูล on-call วันนี้</div>
            `;
            testResultDiv.style.display = 'block';
            showAlert('Webhook ทำงานได้ แต่ไม่พบข้อมูล on-call วันนี้', 'warning');
          }
        } else {
          showAlert(res?.data?.message || 'Webhook ไม่ทำงาน', 'error');
        }
      } catch (err) {
        showAlert('ไม่สามารถเชื่อมต่อ webhook ได้: ' + err.message, 'error');
      } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = '<span><i data-icon="test-tube"></i></span> Test Webhook';
      }
    });

    // Load config on page load
    loadConfig();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "loadConfig", { configurable: true, get: () => loadConfig, set: (v) => { loadConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showAlert", { configurable: true, get: () => showAlert, set: (v) => { showAlert = v; } }); } catch (e) {}
})();
