// import-ma — page script, extracted from import-ma.html.
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

if (!Auth.requireAuth()) { /* redirects if not logged in */ }
    document.addEventListener('DOMContentLoaded', () => {
      Layout.render('import-ma');
    });

    function clearData() {
      document.getElementById('csv-input').value = '';
      document.getElementById('import-result').style.display = 'none';
    }

    async function importData() {
      const csvText = document.getElementById('csv-input').value.trim();
      
      if (!csvText) {
        await SOMDialog.alert('กรุณา Paste ข้อมูล CSV', { title: 'แจ้งเตือน', icon: 'warning' });
        return;
      }

      try {
        // Parse CSV
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
          await SOMDialog.alert('ข้อมูลไม่ถูกต้อง ต้องมีอย่างน้อย 2 บรรทัด (header + data)', { title: 'แจ้งเตือน', icon: 'warning' });
          return;
        }

        // Parse header
        const header = lines[0].split('\t');
        console.log('Header:', header);

        // Parse data rows
        const services = [];
        let id = 1;

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split('\t');
          
          if (values.length < 3) continue; // Skip invalid rows

          const service = {
            id: id++,
            service_name: values[0] || '',
            service_type: values[1] || 'TMN',
            tool_type: values[2] || 'Jenkins',
            can_change_text: values[3] || '',
            link_manual: values[4] || '',
            remark: values[5] || '',
            direct_link: '',
            custom_url: '',
            created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
          };

          services.push(service);
        }

        if (services.length === 0) {
          await SOMDialog.alert('ไม่พบข้อมูลที่ถูกต้อง', { title: 'แจ้งเตือน', icon: 'warning' });
          return;
        }

        // Send to API
        const response = await fetch('./api/ma-services/import.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ services })
        });

        const result = await response.json();

        if (result.success) {
          showResult(true, `Import สำเร็จ! นำเข้าข้อมูล ${services.length} รายการ`, {
            total: services.length,
            tmn: services.filter(s => s.service_type === 'TMN').length,
            nano: services.filter(s => s.service_type === 'NANO').length,
            wealth: services.filter(s => s.service_type === 'WEALTH').length
          });
        } else {
          showResult(false, 'Import ล้มเหลว: ' + (result.message || 'Unknown error'));
        }

      } catch (error) {
        console.error('Import error:', error);
        showResult(false, 'เกิดข้อผิดพลาด: ' + error.message);
      }
    }

    function showResult(success, message, stats = null) {
      const resultDiv = document.getElementById('import-result');
      const titleDiv = document.getElementById('result-title');
      const messageDiv = document.getElementById('result-message');
      const statsDiv = document.getElementById('result-stats');

      resultDiv.className = 'import-result ' + (success ? 'success' : 'error');
      resultDiv.style.display = 'block';
      
      titleDiv.innerHTML = success ? '<i data-icon="check-circle"></i> Import Successful!' : '<i data-icon="x-circle"></i> Import Failed';
      messageDiv.textContent = message;

      if (stats) {
        statsDiv.innerHTML = `
          <div class="result-stat">
            <div class="result-stat-value">${stats.total}</div>
            <div class="result-stat-label">Total Services</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value">${stats.tmn}</div>
            <div class="result-stat-label">TMN</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value">${stats.nano}</div>
            <div class="result-stat-label">NANO</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value">${stats.wealth}</div>
            <div class="result-stat-label">WEALTH</div>
          </div>
        `;
      } else {
        statsDiv.innerHTML = '';
      }

      // Scroll to result
      resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "clearData", { configurable: true, get: () => clearData, set: (v) => { clearData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "importData", { configurable: true, get: () => importData, set: (v) => { importData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showResult", { configurable: true, get: () => showResult, set: (v) => { showResult = v; } }); } catch (e) {}
})();
