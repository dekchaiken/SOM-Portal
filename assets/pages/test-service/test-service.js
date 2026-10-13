// test-service — page script, extracted from test-service.html.
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
  Layout.render('test-service');
  trackTestServiceRun('view');

  /* ── Tab definitions ─────────────────────────── */
  const TABS = [
    {
      id: 'reconcile',
      label: 'Reconcile Status',
      icon: '<i data-icon="refresh-cw"></i>',
      type: 'panel',
      url: 'https://acm-financial-portal.backoffice-a-cloud1p.ascendmoney.io/acm-financial-portal/#/app.reconciliation-cashout',
    },
    {
      id: 'portal',
      label: 'Test Service Portal',
      icon: '<i data-icon="test-tube"></i>',
      type: 'panel',
      url: 'https://script.google.com/a/macros/ascendcorp.com/s/AKfycbwZ18qUWuUvzeOC5p_NRJ0EapFt3D7Mh0loFajku27oSay5a7qaNPxbDnTlVX16i4lIKw/exec',
      gated: true,
    },
    {
      id: 'records',
      label: 'Daily Test Records',
      icon: '<i data-icon="clipboard"></i>',
      type: 'records',
      url: 'https://docs.google.com/spreadsheets/d/1Iqj36FpwqhykoPTZhe1uOEo9qFmHwQakBGxuep0_GDA/edit?gid=0#gid=0',
      gated: true,
    },
  ];

  let activeTabId   = null;
  let frameLoaded   = {};
  let blockTimeout  = null;
  let reconRanOnce  = false;  // reset every page reload — gate Portal/Records

  /* ── Render tabs ─────────────────────────────── */
  function renderTabs() {
    const bar       = document.getElementById('ts-tabbar');
    const spacer    = bar.querySelector('.ts-tabbar-spacer');

    TABS.forEach(t => {
      const el = document.createElement('div');
      el.className = 'ts-tab';
      el.id = 'tab-' + t.id;
      el.innerHTML = `<span class="tab-lock" style="display:none"><i data-icon="lock"></i></span><span>${t.icon}</span> ${escHtml(t.label)} <span class="tab-dot"></span>`;
      el.onclick = () => switchTab(t.id);
      bar.insertBefore(el, spacer);
    });
    refreshTabLockUI();
  }

  /* ── Update lock icon / disabled style on gated tabs ─── */
  function refreshTabLockUI() {
    TABS.forEach(t => {
      if (!t.gated) return;
      const el   = document.getElementById('tab-' + t.id);
      const lock = el?.querySelector('.tab-lock');
      if (!el) return;
      if (reconRanOnce) {
        el.classList.remove('ts-tab-locked');
        if (lock) lock.style.display = 'none';
      } else {
        el.classList.add('ts-tab-locked');
        if (lock) lock.style.display = 'inline';
      }
    });
    // Also toggle Portal Submit button
    const submitBtn = document.getElementById('portal-submit-btn');
    if (submitBtn) submitBtn.disabled = !reconRanOnce;
  }

  /* ── Switch tab ──────────────────────────────── */
  function switchTab(id) {
    if (activeTabId === id) return;

    const tab = TABS.find(t => t.id === id);
    if (!tab) return;

    // Gate: Portal/Records require a successful Check Now first
    if (tab.gated && !reconRanOnce) {
      Toast.warning('กรุณากด Check Now ในแท็บ Reconcile Status ก่อน');
      return;
    }

    activeTabId = id;

    document.querySelectorAll('.ts-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + id)?.classList.add('active');

    ['tab-newtab', 'blocked-newtab'].forEach(elId => {
      const a = document.getElementById(elId);
      if (a) { a.href = tab.url; a.title = 'เปิด ' + tab.label + ' ในแท็บใหม่'; }
    });

    loadFrame(tab);
  }

  /* ── Load iframe or custom panel ─────────────── */
  function loadFrame(tab) {
    ['recon-panel','portal-panel','records-panel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('show');
    });
    if (tab.type === 'panel' || tab.type === 'records') {
      document.getElementById('main-frame').src = 'about:blank';
      document.getElementById('ts-loading').classList.add('hidden');
      document.getElementById('ts-blocked').classList.remove('show');
      const panelMap = { reconcile:'recon-panel', portal:'portal-panel', records:'records-panel' };
      const el = document.getElementById(panelMap[tab.id]);
      if (el) el.classList.add('show');
      if (tab.id === 'reconcile') reconUpdateTimeDisplay();
      if (tab.id === 'records')   recordsLoad();
      if (tab.id === 'portal')    portalInit();
      return;
    }
    loadFrameIframe(tab);
  }

  function loadFrameIframe(tab) {
    const frame    = document.getElementById('main-frame');
    const loading  = document.getElementById('ts-loading');
    const blocked  = document.getElementById('ts-blocked');
    const loadText = document.getElementById('loading-text');

    blocked.classList.remove('show');
    frame.classList.remove('loaded');
    loading.classList.remove('hidden');
    loadText.textContent = 'กำลังโหลด ' + tab.label + '…';

    if (blockTimeout) { clearTimeout(blockTimeout); blockTimeout = null; }

    frame.src = tab.url;

    const onLoad = () => {
      frame.removeEventListener('load', onLoad);
      clearTimeout(blockTimeout);

      let isBlocked = false;
      try {
        const doc = frame.contentDocument;
        if (!doc || !doc.body || doc.body.innerHTML.trim() === '') isBlocked = true;
      } catch (e) {
        isBlocked = true;
      }

      loading.classList.add('hidden');
      if (isBlocked) showBlocked(tab);
      else { frame.classList.add('loaded'); blocked.classList.remove('show'); }
    };

    frame.addEventListener('load', onLoad);

    blockTimeout = setTimeout(() => {
      frame.removeEventListener('load', onLoad);
      loading.classList.add('hidden');
      showBlocked(tab);
    }, 4000);
  }

  const TAB_META = {
    portal: {
      icon: '<i data-icon="test-tube"></i>',
      title: 'Test Service Portal ไม่สามารถแสดงในหน้านี้ได้',
      sub: 'Google Apps Script ตั้งค่าป้องกันการแสดงผลใน iframe (X-Frame-Options)\nกรุณาเปิดในแท็บใหม่เพื่อใช้งานฟอร์ม',
      hint: 'ถ้าเชื่อมต่อ VPN ของบริษัทอยู่ สามารถเปิดลิงก์ด้านล่างได้ทันที',
    },
    reconcile: {
      icon: '<i data-icon="refresh-cw"></i>',
      title: 'Reconcile Status ไม่สามารถแสดงในหน้านี้ได้',
      sub: 'Financial Portal ตั้งค่าป้องกันการแสดงผลใน iframe (X-Frame-Options)\nกรุณาเปิดในแท็บใหม่เพื่อดูสถานะ',
      hint: 'ถ้าเชื่อมต่อ VPN ของบริษัทอยู่ สามารถเปิดลิงก์ด้านล่างได้ทันที',
    },
    records: {
      icon: '<i data-icon="clipboard"></i>',
      title: 'Daily Test Records ไม่สามารถแสดงในหน้านี้ได้',
      sub: 'Google Sheets ตั้งค่าป้องกันการแสดงผลใน iframe\nกรุณาเปิดในแท็บใหม่',
      hint: 'Sheet จะเปิดได้ทันทีถ้า login ด้วย Google Account ขององค์กรอยู่',
    },
  };

  function showBlocked(tab) {
    const meta = TAB_META[tab.id] || {};
    document.getElementById('blocked-icon').innerHTML  = meta.icon || '<i data-icon="link"></i>';
    document.getElementById('blocked-title').textContent = meta.title || tab.label + ' ไม่สามารถแสดงในหน้านี้ได้';
    document.getElementById('blocked-sub').innerHTML     = (meta.sub || '').replace(/\n/g, '<br>');
    document.getElementById('blocked-hint').textContent  = meta.hint || 'กรุณาเปิดในแท็บใหม่';
    document.getElementById('blocked-newtab').href       = tab.url;
    document.getElementById('ts-blocked').classList.add('show');
  }

  /* ── Reload current ──────────────────────────── */
  function reloadCurrent() {
    const tab = TABS.find(t => t.id === activeTabId);
    if (tab) {
      document.getElementById('main-frame').src = 'about:blank';
      setTimeout(() => loadFrame(tab), 80);
    }
  }

  /* ── Init ────────────────────────────────────── */
  renderTabs();
  setTimeout(() => switchTab(TABS[0].id), 0);

  /* ════════════════════════════════════════════════
     RECONCILE / FUND-OUT CHECK  (Browser-based auth)
     ════════════════════════════════════════════════ */
  const PROXY_BASE      = './api/fundout-proxy.php';
  const MONTHS_TH       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad2            = n => String(n).padStart(2, '0');
  
  // Bank mapping: code -> short abbr  (ยึดตาม payload จริงของ ACM Financial Portal)
  // payload default (Status New) = 001,005,006,008,010,011,017,018,020,022,024,025,026,027,028,030,031,032,033,034,039,045,065,066,067,069,070,071,073
  // BBL / KBANK / SCB ไม่อยู่ใน payload นี้ → ไม่ต้องแสดงในกริด
  const BANK_MAP = {
    '001': 'BOT',      // Bank of Thailand
    '005': 'ABN',      // ABN AMRO
    '006': 'KTB',      // Krung Thai Bank
    '008': 'JP',       // JP Morgan Chase
    '010': 'BTMU',     // MUFG / Bank of Tokyo-Mitsubishi
    '011': 'TMB',      // TMBThanachart (ttb)
    '017': 'CITI',     // Citibank
    '018': 'SMBC',     // Sumitomo Mitsui
    '020': 'SCBT',     // Standard Chartered Bangkok
    '022': 'CIMB',     // CIMB Thai
    '024': 'UOB',      // United Overseas Bank
    '025': 'BAY',      // Bank of Ayudhya (Krungsri)
    '026': 'MEGA ICBC',// Mega International Commercial Bank
    '027': 'BA',       // Bank of America
    '028': 'CALYON',   // Crédit Agricole CIB (Calyon)
    '030': 'GSB',      // Government Savings Bank
    '031': 'HSBC',     // HSBC
    '032': 'DEUTSHE',  // Deutsche Bank
    '033': 'GHB',      // Government Housing Bank
    '034': 'BACC',     // Bank for Agriculture & Agricultural Co-ops
    '039': 'MHBC',     // Mizuho Bank (Corporate)
    '045': 'BNP',      // BNP Paribas
    '065': 'TBANK',    // Thanachart Bank
    '066': 'ISBT',     // Islamic Bank of Thailand
    '067': 'TISCO',    // Tisco Bank
    '069': 'KK',       // Kiatnakin Bank
    '070': 'ICBC',     // Industrial and Commercial Bank of China
    '071': 'TCRB',     // Thai Credit Retail Bank
    '073': 'LH BANK',  // Land and Houses Bank
  };

  // Default bank codes for Status New (BBL/KBANK/SCB excluded — ยึดตาม API จริง)
  const BANK_CODES_DEFAULT = '001,005,006,008,010,011,017,018,020,022,024,025,026,027,028,030,031,032,033,034,039,045,065,066,067,069,070,071,073';

  const BANK_MAP_LIST = [
    { code: '001', abbr: 'BOT',       name: 'ธ.แห่งประเทศไทย' },
    { code: '005', abbr: 'ABN',       name: 'ABN AMRO' },
    { code: '006', abbr: 'KTB',       name: 'กรุงไทย' },
    { code: '008', abbr: 'JP',        name: 'JP Morgan' },
    { code: '010', abbr: 'BTMU',      name: 'MUFG (BTMU)' },
    { code: '011', abbr: 'TMB',       name: 'ทหารไทยธนชาต' },
    { code: '017', abbr: 'CITI',      name: 'Citibank' },
    { code: '018', abbr: 'SMBC',      name: 'Sumitomo SMBC' },
    { code: '020', abbr: 'SCBT',      name: 'Standard Chartered' },
    { code: '022', abbr: 'CIMB',      name: 'CIMB Thai' },
    { code: '024', abbr: 'UOB',       name: 'United Overseas' },
    { code: '025', abbr: 'BAY',       name: 'กรุงศรีอยุธยา' },
    { code: '026', abbr: 'MEGA ICBC', name: 'Mega ICBC' },
    { code: '027', abbr: 'BA',        name: 'Bank of America' },
    { code: '028', abbr: 'CALYON',    name: 'Crédit Agricole' },
    { code: '030', abbr: 'GSB',       name: 'ออมสิน' },
    { code: '031', abbr: 'HSBC',      name: 'HSBC' },
    { code: '032', abbr: 'DEUTSHE',   name: 'Deutsche Bank' },
    { code: '033', abbr: 'GHB',       name: 'อาคารสงเคราะห์' },
    { code: '034', abbr: 'BACC',      name: 'เพื่อการเกษตรฯ' },
    { code: '039', abbr: 'MHBC',      name: 'Mizuho Bank' },
    { code: '045', abbr: 'BNP',       name: 'BNP Paribas' },
    { code: '065', abbr: 'TBANK',     name: 'Thanachart' },
    { code: '066', abbr: 'ISBT',      name: 'Islamic Bank' },
    { code: '067', abbr: 'TISCO',     name: 'TISCO' },
    { code: '069', abbr: 'KK',        name: 'เกียรตินาคิน' },
    { code: '070', abbr: 'ICBC',      name: 'ICBC (Thai)' },
    { code: '071', abbr: 'TCRB',      name: 'Thai Credit Retail' },
    { code: '073', abbr: 'LH BANK',   name: 'Land & Houses' },
  ];

  function rqpBuildBankGrid() {
    const grid = document.getElementById('rqp-bank-grid');
    if (!grid || grid.children.length > 0) return; // already built
    const selectedCodes = new Set((document.getElementById('rqp-banks').value || BANK_CODES_DEFAULT).split(',').map(s=>s.trim()));
    grid.innerHTML = BANK_MAP_LIST.map(b => `
      <label class="bank-item">
        <input type="checkbox" data-code="${b.code}" ${selectedCodes.has(b.code)?'checked':''} onchange="rqpBankChanged()">
        <span>
          <span class="bank-item-code">${b.abbr}</span>
          <span class="bank-item-name">${b.name}</span>
        </span>
      </label>
    `).join('');
  }

  function rqpBankChanged() {
    const codes = [...document.querySelectorAll('#rqp-bank-grid input[type=checkbox]:checked')]
      .map(cb => cb.dataset.code).join(',');
    document.getElementById('rqp-banks').value = codes;
    rqpSyncChips();
  }

  function rqpBankSelectAll() {
    document.querySelectorAll('#rqp-bank-grid input[type=checkbox]').forEach(cb => cb.checked = true);
    rqpBankChanged();
  }

  function rqpBankDeselectAll() {
    document.querySelectorAll('#rqp-bank-grid input[type=checkbox]').forEach(cb => cb.checked = false);
    rqpBankChanged();
  }

  /* ────────────────────────────────────────────────────────────
     QUERY PARAMS FORM  —  Step 1 inline filter
  ──────────────────────────────────────────────────────────── */

  function rqpToggle() {
    const body  = document.getElementById('rqp-body');
    const arrow = document.getElementById('rqp-arrow');
    const open  = body.classList.toggle('open');
    arrow.classList.toggle('open', open);
    arrow.textContent = open ? '▾' : '▸';
    if (open) reconUpdateTimeDisplay();
  }

  function rqpToggleDateAuto() {
    const auto = document.getElementById('rqp-auto').checked;
    document.getElementById('rqp-date-preview').style.display      = auto ? '' : 'none';
    document.getElementById('rqp-date-manual-wrap').style.display  = auto ? 'none' : 'block';
    if (auto) reconUpdateTimeDisplay();
    rqpSyncChips();
  }

  function rqpToggleBanks() {
    const all = document.getElementById('rqp-banks-all').checked;
    document.getElementById('rqp-banks-custom').style.display = all ? 'none' : 'block';
    if (!all) {
      if (!document.getElementById('rqp-banks').value)
        document.getElementById('rqp-banks').value = BANK_CODES_DEFAULT;
      rqpBuildBankGrid();
    }
    rqpSyncChips();
  }

  function rqpToggleOptional() {
    const el  = document.getElementById('rqp-optional');
    const btn = document.getElementById('rqp-more-btn');
    const open = el.classList.toggle('open');
    btn.textContent = (open ? '▾' : '▸') + ' Optional filters';
  }

  function rqpSyncChips() {
    const recon    = document.getElementById('rqp-recon-status').value;
    const transfer = document.getElementById('rqp-transfer-status').value;
    const auto     = document.getElementById('rqp-auto').checked;
    const allBanks = document.getElementById('rqp-banks-all').checked;
    document.getElementById('rqp-chip-recon').textContent    = 'Recon: '    + (recon    || 'All');
    document.getElementById('rqp-chip-transfer').textContent = 'Transfer: ' + (transfer || 'All');
    document.getElementById('rqp-chip-date').innerHTML     = auto ? '<i data-icon="calendar"></i> Auto' : '<i data-icon="calendar"></i> Manual';
    document.getElementById('rqp-chip-banks').textContent    = allBanks ? 'Banks: All' : 'Banks: Custom';
  }

  function rqpReset() {
    document.getElementById('rqp-recon-status').value    = 'New';
    document.getElementById('rqp-transfer-status').value = 'Success';
    document.getElementById('rqp-auto').checked          = true;
    document.getElementById('rqp-banks-all').checked     = true;
    document.getElementById('rqp-date-preview').style.display     = '';
    document.getElementById('rqp-date-manual-wrap').style.display = 'none';
    document.getElementById('rqp-banks-custom').style.display     = 'none';
    document.getElementById('rqp-date-from').value   = '';
    document.getElementById('rqp-date-to').value     = '';
    document.getElementById('rqp-banks').value = BANK_CODES_DEFAULT;
    // Reset bank grid so it rebuilds on next open
    const bankGrid = document.getElementById('rqp-bank-grid');
    if (bankGrid) bankGrid.innerHTML = '';
    document.getElementById('rqp-req-channel').value = '';
    document.getElementById('rqp-req-status').value  = '';
    document.getElementById('rqp-tpp-id').value      = '';
    document.getElementById('rqp-utiba-id').value    = '';
    document.getElementById('rqp-ew-acct').value     = '';
    document.getElementById('rqp-req-amt').value     = '';
    document.getElementById('rqp-bank-acct-no').value   = '';
    document.getElementById('rqp-bank-acct-name').value = '';
    document.getElementById('rqp-limit').value       = '10000';
    rqpSyncChips();
    reconUpdateTimeDisplay();
  }

  function rqpGetParams() {
    const autoDate = document.getElementById('rqp-auto').checked;
    const allBanks = document.getElementById('rqp-banks-all').checked;
    
    // Get selected bank codes
    let bankCode = BANK_CODES_DEFAULT;
    if (!allBanks) {
      const banksHidden = document.getElementById('rqp-banks');
      bankCode = (banksHidden && banksHidden.value) ? banksHidden.value : BANK_CODES_DEFAULT;
    }
    
    return {
      autoDate,
      dateFrom:        autoDate ? null : (document.getElementById('rqp-date-from').value.trim() || null),
      dateTo:          autoDate ? null : (document.getElementById('rqp-date-to').value.trim()   || null),
      reconcileStatus: document.getElementById('rqp-recon-status').value,
      transferStatus:  document.getElementById('rqp-transfer-status').value,
      bankCode:        bankCode,
      requestChannel:  document.getElementById('rqp-req-channel').value.trim(),
      requestStatus:   document.getElementById('rqp-req-status').value.trim(),
      tppId:           document.getElementById('rqp-tpp-id').value.trim(),
      utibaId:         document.getElementById('rqp-utiba-id').value.trim(),
      ewAccount:       document.getElementById('rqp-ew-acct').value.trim(),
      requestAmount:   document.getElementById('rqp-req-amt').value.trim(),
      bankAccountNo:   document.getElementById('rqp-bank-acct-no').value.trim(),
      bankAccountName: document.getElementById('rqp-bank-acct-name').value.trim(),
      limit:           document.getElementById('rqp-limit').value.trim() || '10000',
    };
  }

  function reconGetRange() {
    const now    = new Date();
    const ICT    = 7 * 60 * 60 * 1000;
    const ictNow = new Date(now.getTime() + ICT);

    const toICT = new Date(ictNow.getTime() - 2 * 60 * 60 * 1000);
    toICT.setUTCMinutes(59); toICT.setUTCSeconds(59); toICT.setUTCMilliseconds(999);

    const fromICT = new Date(toICT);
    fromICT.setUTCHours(0, 0, 0, 0);

    const fmt = d =>
      `${pad2(d.getUTCDate())}-${MONTHS_TH[d.getUTCMonth()]}-${d.getUTCFullYear()} ` +
      `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

    return {
      from:        fromICT.getTime() - ICT,
      to:          toICT.getTime()   - ICT,
      fromDisplay: fmt(fromICT),
      toDisplay:   fmt(toICT),
    };
  }

  function reconUpdateTimeDisplay() {
    const { fromDisplay, toDisplay } = reconGetRange();
    document.getElementById('recon-from').textContent = fromDisplay;
    document.getElementById('recon-to').textContent   = toDisplay;
  }

  function reconSetLoading(on) {
    const btn  = document.getElementById('recon-btn');
    const icon = document.getElementById('recon-btn-icon');
    const text = document.getElementById('recon-btn-text');
    btn.disabled = on;
    if (on) {
      icon.outerHTML = '<span class="spinner" id="recon-btn-icon" style="width:13px;height:13px;border-width:2px;border-color:rgba(255,255,255,.3);border-top-color:#fff;flex-shrink:0"></span>';
      text.textContent = 'กำลังตรวจสอบ…';
    } else {
      document.getElementById('recon-btn-icon').outerHTML = '<span id="recon-btn-icon"><i data-icon="search"></i></span>';
      text.textContent = 'Check Now';
    }
  }

  function reconSetStatus(msg) {
    document.getElementById('recon-status').innerHTML = msg ? `<span>${msg}</span>` : '';
  }

  function reconShowError(msg) {
    document.getElementById('recon-error-msg').textContent = msg;
    document.getElementById('recon-error').classList.add('show');
  }

  function reconHideAll() {
    ['recon-error', 'recon-empty', 'recon-result'].forEach(id =>
      document.getElementById(id).classList.remove('show')
    );
  }

  // Removed reconToggleSettings - credentials now managed in admin panel

  let SERVICE_GROUPS = [];
  let activePortalBrand  = 'tmn';
  let activeRecordsBrand = 'tmn';

  function setPortalBrand(brand) {
    activePortalBrand = brand;
    document.querySelectorAll('#portal-brand-switcher .brand-sw-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.brand === brand);
    });
    // Re-render form for the new brand
    const body = document.getElementById('portal-form-body');
    if (body) body.innerHTML = '';
    portalInit();
  }

  function setRecordsBrand(brand) {
    activeRecordsBrand = brand;
    document.querySelectorAll('#records-brand-switcher .brand-sw-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.brand === brand);
    });
    recRender();
  }

  async function loadServiceGroups() {
    try {
      const token = Auth.getToken ? Auth.getToken()
        : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
      const resp = await fetch('./api/test-service-config.php?action=get-groups', {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      });
      const json = await resp.json();
      if (json.success && Array.isArray(json.data) && json.data.length) {
        SERVICE_GROUPS = json.data;
      }
    } catch (_) { /* fallback */ }
  }

  function mkToggle(gId, defaultVal = 'Success') {
    const opts = [['Success','<i data-icon="check-circle"></i> Success'],['Fail','<i data-icon="x-circle"></i> Fail'],['NA','— N/A']];
    return `<div class="svc-toggle" data-name="${escHtml(gId)}__status">` +
      opts.map(([v,l]) =>
        `<button type="button" class="svc-toggle-btn${v===defaultVal?' active':''}" data-v="${v}" onclick="statusToggle(this)">${l}</button>`
      ).join('') + '</div>';
  }

  function mkChildSel(name, defaultVal = 'OK') {
    const opts = [['OK','OK'],['Fail','Fail'],['NA','— N/A']];
    const options = opts.map(([v,l]) =>
      `<option value="${v}"${v===defaultVal?' selected':''}>${escHtml(l)}</option>`
    ).join('');
    return `<select class="svc-sel" data-v="${defaultVal}" data-name="${escHtml(name)}"
      onchange="this.dataset.v=this.value">${options}</select>`;
  }

  function statusToggle(btn) {
    const group = btn.closest('.svc-toggle');
    group.querySelectorAll('.svc-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Cascade to child rows if parent is Fail
    const newStatus = btn.dataset.v;
    if (newStatus === 'Fail') {
      const groupName = group.dataset.name.replace('__status', '');
      const childSelects = document.querySelectorAll(`select[data-name^="${groupName}__"]`);
      childSelects.forEach(sel => {
        if (sel.dataset.name !== groupName + '__remark') {
          sel.value = 'Fail';
          sel.dataset.v = 'Fail';
        }
      });
    }
  }

  async function portalInit() {
    const bf = window.__portalBackfill || null;
    const displayTs = bf ? new Date(bf.iso) : new Date();
    const dtEl = document.getElementById('portal-datetime');
    if (bf) {
      dtEl.innerHTML =
        `<span style="display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:99px;background:rgba(37,99,235,.15);color:#1d4ed8;font-weight:800"><i data-icon="edit"></i> บันทึกย้อนหลัง</span> ` +
        escHtml(displayTs.toLocaleString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Bangkok' }));
    } else {
      dtEl.textContent =
        displayTs.toLocaleDateString('th-TH',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) +
        '  ' + displayTs.toLocaleTimeString('th-TH');
    }

    try {
      const user = Auth.getUser ? Auth.getUser() : JSON.parse(localStorage.getItem('auth_user') || sessionStorage.getItem('auth_user') || '{}');
      document.getElementById('portal-reporter-name').textContent = user?.email || user?.username || 'Unknown';
    } catch { document.getElementById('portal-reporter-name').textContent = 'Unknown'; }

    const body = document.getElementById('portal-form-body');
    if (body.children.length > 0) return;

    if (!SERVICE_GROUPS.length) await loadServiceGroups();

    const brandGroups = SERVICE_GROUPS.filter(g => (g.brand || 'tmn') === activePortalBrand);

    const rows = brandGroups.flatMap(g => {
      const parentRow = `
        <tr class="svc-group-hd">
          <td class="col-name"><span class="svc-group-name">${escHtml(g.name)}</span></td>
          <td class="col-toggle">${mkToggle(g.id)}</td>
          <td class="col-remark"><input class="svc-remark" type="text" placeholder="Remark…" data-name="${escHtml(g.id)}__remark"></td>
        </tr>`;
      const childRows = g.children.map(c => `
        <tr class="svc-child-row">
          <td class="col-name"><span class="svc-child-name">${escHtml(c)}</span></td>
          <td class="col-child-pill">${mkChildSel(g.id + '__' + c)}</td>
          <td></td>
        </tr>`).join('');
      return [parentRow, childRows];
    }).join('');
    body.innerHTML = `<table class="svc-table"><tbody>${rows}</tbody></table>`;
  }

  async function portalSubmit() {
    const bf = window.__portalBackfill || null;
    // Defense-in-depth: block submit even if user bypassed the tab gate.
    // Backfill flow skips the guard — we're admitting a past run, so Check Now
    // wouldn't make sense.
    if (!reconRanOnce && !bf) {
      Toast.warning('กรุณากด Check Now ในแท็บ Reconcile Status ก่อน submit');
      return;
    }

    const btn    = document.getElementById('portal-submit-btn');
    const icon   = document.getElementById('portal-submit-icon');
    const text   = document.getElementById('portal-submit-text');
    const status = document.getElementById('portal-submit-status');

    btn.disabled = true;
    icon.textContent = '⏳';
    text.textContent = 'กำลังส่ง…';
    status.textContent = '';

    const reporter = document.getElementById('portal-reporter-name').textContent;
    const services = {};
    const brandGroups = SERVICE_GROUPS.filter(g => (g.brand || 'tmn') === activePortalBrand);

    brandGroups.forEach(g => {
      const activeBtn = document.querySelector(`.svc-toggle[data-name="${g.id}__status"] .svc-toggle-btn.active`);
      const remarkEl  = document.querySelector(`input[data-name="${g.id}__remark"]`);
      const children  = {};
      g.children.forEach(c => {
        const sel = document.querySelector(`select[data-name="${g.id}__${c}"]`);
        if (sel) children[c] = sel.value;
      });
      services[g.id] = {
        name:    g.name,
        status:  activeBtn?.dataset.v || 'NA',
        remark:  remarkEl?.value  || '',
        children,
      };
    });

    const payload = {
      timestamp: bf ? new Date(bf.iso).toISOString() : new Date().toISOString(),
      reporter,
      brand: activePortalBrand,
      services,
    };
    if (bf) payload.backfill = true;

    try {
      const submitToken = Auth.getToken ? Auth.getToken()
        : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
      const resp = await fetch('./api/test-records.php?action=submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(submitToken ? { 'Authorization': 'Bearer ' + submitToken } : {}),
        },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) throw new Error(json.error || json.message || 'Submit failed');

      trackTestServiceRun('portal_submit');
      icon.innerHTML = '<i data-icon="check-circle"></i>';
      text.textContent = 'Submit Test Result';
      btn.disabled = false;
      const bfNote = bf
        ? `\n<i data-icon="edit"></i> บันทึกย้อนหลังสำหรับ ${bf.date} ${String(bf.hour).padStart(2,'0')}:00`
        : '';
      document.getElementById('submit-modal-sub').textContent =
        'บันทึกเมื่อ ' + new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) +
        '\nโดย ' + document.getElementById('portal-reporter-name').textContent + bfNote;
      document.getElementById('submit-modal-overlay').classList.add('show');
      // Consume the backfill token so a later manual submit doesn't reuse it,
      // and refresh Coverage so the newly-filled hour turns green.
      if (bf) {
        window.__portalBackfill = null;
        tcovLoad().catch(() => {});
      }
    } catch(err) {
      icon.innerHTML = '<i data-icon="check-circle"></i>';
      text.textContent = 'Submit Test Result';
      status.innerHTML = '<i data-icon="x-circle"></i> ' + err.message;
      status.style.color = '#fca5a5';
      btn.disabled = false;
    }
  }

  function submitModalClose() {
    document.getElementById('submit-modal-overlay').classList.remove('show');
  }
  function submitModalViewRecords() {
    submitModalClose();
    switchTab('records');
  }

  /* ════════════════════════════════════════════════
     DAILY TEST RECORDS — Inline Edit
     ════════════════════════════════════════════════ */
  let recRows        = [];
  let recExpanded    = new Set();
  let recCancelClick = null;
  let recCurrentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  function recMonthLabel(ym) {
    const [y, m] = ym.split('-');
    const names = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${names[parseInt(m)-1]} ${y}`;
  }

  async function recLoadMonths() {
    try {
      const res = await recFetch('./api/test-records-admin.php?action=months');
      const months = Array.isArray(res.data) ? res.data : [];
      const sel = document.getElementById('rec-month-sel');
      if (!months.length) { sel.innerHTML = '<option value="">ไม่มีข้อมูล</option>'; return; }
      // Ensure current month is in list (may be empty but still valid)
      if (!months.includes(recCurrentMonth)) months.unshift(recCurrentMonth);
      sel.innerHTML = months.map(m =>
        `<option value="${m}" ${m === recCurrentMonth ? 'selected' : ''}>${recMonthLabel(m)}</option>`
      ).join('');
    } catch {}
  }

  function recMonthChange(m) {
    recCurrentMonth = m;
    recordsLoad();
  }

  function recClearCancel() {
    if (recCancelClick) { document.removeEventListener('click', recCancelClick); recCancelClick = null; }
  }

  function recAuthHdr() {
    const t = Auth.getToken ? Auth.getToken()
      : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }
             : { 'Content-Type': 'application/json' };
  }
  async function recFetch(url, opts = {}) {
    opts.headers = { ...recAuthHdr(), ...(opts.headers || {}) };
    const r = await fetch(url, opts);
    return r.json();
  }

  function recPill(val) {
    const m = { Success:['sp-s','<i data-icon="check-circle"></i> Success'], Fail:['sp-f','<i data-icon="x-circle"></i> Fail'], NA:['sp-n','— N/A'], OK:['sp-s','<i data-icon="check-circle"></i> OK'] };
    const [cls, lbl] = m[val] || ['sp-n', escHtml(val||'—')];
    return `<span class="sp ${cls}">${lbl}</span>`;
  }

  function recRender() {
    recClearCancel();
    const empty = document.getElementById('records-empty');
    const table = document.getElementById('records-table');
    if (!recRows.length) {
      table.style.display = 'none';
      empty.innerHTML = '<div class="rec-empty-icon"><i data-icon="inbox"></i></div><div>ยังไม่มีข้อมูล</div>';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    table.style.display = '';

    const visGroups  = SERVICE_GROUPS.filter(g => (g.brand || 'tmn') === activeRecordsBrand);
    const visRecords = recRows.filter(r => (r.brand || 'tmn') === activeRecordsBrand);

    if (!visRecords.length) {
      table.style.display = 'none';
      empty.innerHTML = '<div class="rec-empty-icon"><i data-icon="inbox"></i></div><div>ยังไม่มีข้อมูลของ ' + activeRecordsBrand.toUpperCase() + '</div>';
      empty.style.display = '';
      return;
    }

    const grpCols = visGroups.map(g =>
      `<th title="${escHtml(g.name)}">${escHtml(g.name.split('(')[0].split('|')[0].trim())}</th>`
    ).join('');
    document.getElementById('records-thead').innerHTML = `<tr>
      <th class="td-exp"></th>
      <th>Date / Time</th>
      <th>Reporter</th>
      ${grpCols}
      <th>Edited</th>
      <th>Actions</th>
    </tr>`;

    document.getElementById('records-tbody').innerHTML = visRecords.map(rec => {
      const dt = new Date(rec.timestamp).toLocaleString('th-TH',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const isOpen = recExpanded.has(rec.id);

      const grpCells = visGroups.map(g => {
        const status = rec.services?.[g.id]?.status || 'NA';
        return `<td class="td-ed" onclick="recStatusClick(this,'${escHtml(rec.id)}','${escHtml(g.id)}','parent')">
          <div class="td-ci">${recPill(status)}<span class="ed-hint"><i data-icon="pencil"></i></span></div>
        </td>`;
      }).join('');

      const editedBadge = rec.edited_at
        ? `<span class="ed-badge"><i data-icon="pencil"></i> ${escHtml(rec.edited_by||'')} ${new Date(rec.edited_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</span>`
        : '';

      const mainRow = `<tr data-rid="${escHtml(rec.id)}">
        <td class="td-exp">
          <div class="td-ci" style="justify-content:center;padding:4px 0">
            <button class="btn-exp ${isOpen?'open':''}" onclick="recToggleExpand('${escHtml(rec.id)}')" title="ดู children">⌄</button>
          </div>
        </td>
        <td class="td-ed" onclick="recTextClick(this,'${escHtml(rec.id)}','timestamp')">
          <div class="td-ci"><span class="cv">${escHtml(dt)}</span><span class="ed-hint"><i data-icon="pencil"></i></span></div>
        </td>
        <td class="td-ed" onclick="recTextClick(this,'${escHtml(rec.id)}','reporter')">
          <div class="td-ci"><span class="cv">${escHtml(rec.reporter)}</span><span class="ed-hint"><i data-icon="pencil"></i></span></div>
        </td>
        ${grpCells}
        <td><div class="td-ci">${editedBadge}</div></td>
        <td>
          <div class="td-ci" style="justify-content:center">
            <button class="btn btn-danger btn-sm" onclick="recDelete('${escHtml(rec.id)}','${escHtml(dt)}')" title="Delete record"><i data-icon="trash"></i></button>
          </div>
        </td>
      </tr>`;

      const subRow = isOpen ? recBuildSub(rec) : '';
      return mainRow + subRow;
    }).join('');
  }

  function recBuildSub(rec) {
    const visGroups = SERVICE_GROUPS.filter(g => (g.brand || 'tmn') === activeRecordsBrand);
    const cells = visGroups.map(g => {
      const svc = rec.services?.[g.id] || {};
      if (!g.children?.length) return '<td></td>';
      const items = g.children.map(c => {
        const cv = svc.children?.[c] || 'NA';
        return `<span style="display:inline-flex;align-items:center;gap:3px;margin:2px 6px 2px 0">
          <span style="font-size:9px;color:var(--text-muted)">${escHtml(c)}:</span>
          <span onclick="recStatusClick(this,'${escHtml(rec.id)}','${escHtml(g.id)}','child','${escHtml(c)}')">${recPill(cv)}</span>
        </span>`;
      }).join('');
      return `<td><div class="td-ci" style="flex-wrap:wrap;gap:2px;padding:5px 8px;">${items}</div></td>`;
    }).join('');
    return `<tr class="sub-row" data-sub="${escHtml(rec.id)}">
      <td colspan="3"><div class="td-ci" style="padding:5px 8px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.05em">CHILDREN</div></td>
      ${cells}
      <td></td>
    </tr>`;
  }

  function recToggleExpand(id) {
    if (recExpanded.has(id)) recExpanded.delete(id); else recExpanded.add(id);
    recRender();
  }

  function recTextClick(td, recId, field) {
    if (td.querySelector('input')) return;
    recClearCancel();
    const inner = td.querySelector('.td-ci');
    const rec   = recRows.find(r => r.id === recId);

    const inp = document.createElement('input');
    inp.className = 'ci-input';
    if (field === 'timestamp') {
      inp.type  = 'datetime-local';
      // Format for datetime-local input (YYYY-MM-DDTHH:mm) in local timezone
      const dt = new Date(rec.timestamp);
      const year = dt.getFullYear();
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      const hours = String(dt.getHours()).padStart(2, '0');
      const minutes = String(dt.getMinutes()).padStart(2, '0');
      inp.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      inp.type  = 'text';
      inp.value = rec.reporter;
    }
    inner.innerHTML = '';
    inner.appendChild(inp);
    inp.focus();

    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const v = inp.value.trim();
      if (!v) { recRender(); return; }
      const payload = { id: recId };
      if (field === 'timestamp') {
        // datetime-local gives us local time, convert to ISO string
        payload.timestamp = new Date(v).toISOString();
      } else {
        payload.reporter = v;
      }
      inner.innerHTML = '<span class="saving-dot"></span>';
      const res = await recFetch(`./api/test-records-admin.php?action=edit&month=${recCurrentMonth}`, { method:'POST', body: JSON.stringify(payload) });
      if (res.success) { Object.assign(rec, res.data); recRender(); }
      else { inner.innerHTML = `<span style="color:#ef4444;font-size:10px"><i data-icon="x-circle"></i></span>`; setTimeout(recRender, 1200); }
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { committed = true; recRender(); }
    });
  }

  function recStatusClick(el, recId, gId, type, childName) {
    const container = type === 'parent' ? el.querySelector('.td-ci') : el.parentElement;
    if (container?.querySelector('.isel')) return;
    recClearCancel();

    const rec  = recRows.find(r => r.id === recId);
    const svc  = rec?.services?.[gId] || {};
    const opts = type === 'parent' ? ['Success','Fail','NA'] : ['OK','Fail','NA'];
    const lbls = { Success:'<i data-icon="check-circle"></i> Success', Fail:'<i data-icon="x-circle"></i> Fail', NA:'— N/A', OK:'<i data-icon="check-circle"></i> OK' };

    const sel = document.createElement('span');
    sel.className = 'isel';
    sel.innerHTML = opts.map(v => `<button type="button" class="isel-btn" data-v="${v}">${lbls[v]}</button>`).join('');

    const pill = type === 'parent' ? el.querySelector('.sp') : el;
    pill.replaceWith(sel);

    sel.querySelectorAll('.isel-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        recClearCancel();
        const newVal = btn.dataset.v;
        const newSvc = JSON.parse(JSON.stringify(svc));
        if (type === 'parent') newSvc.status = newVal;
        else newSvc.children = { ...(newSvc.children||{}), [childName]: newVal };
        const services = { ...rec.services, [gId]: newSvc };
        sel.replaceWith(document.createTextNode('…'));
        const res = await recFetch(`./api/test-records-admin.php?action=edit&month=${recCurrentMonth}`, {
          method:'POST', body: JSON.stringify({ id: recId, services }),
        });
        if (res.success) Object.assign(rec, res.data);
        recRender();
      });
    });

    setTimeout(() => {
      recCancelClick = function(e) {
        if (!sel.contains(e.target)) { recClearCancel(); recRender(); }
      };
      document.addEventListener('click', recCancelClick);
    }, 0);
  }

  async function recordsLoad() {
    if (!SERVICE_GROUPS.length) await loadServiceGroups();
    recLoadMonths();
    document.getElementById('records-sub').textContent = 'กำลังโหลด…';
    document.getElementById('records-empty').innerHTML = '<div class="rec-empty-icon">⏳</div><div>กำลังโหลด…</div>';
    document.getElementById('records-table').style.display = 'none';
    try {
      const res = await recFetch(`./api/test-records-admin.php?action=list&month=${recCurrentMonth}`);
      // Backend now sorts newest-first; keep as-is so backfilled records land
      // in their true chronological slot (was: .slice().reverse() over the
      // insertion-order file, which pushed backfills to the top).
      recRows = res.success ? (res.data || []) : (res.records || []);
      document.getElementById('records-sub').textContent = `${recRows.length} รายการ (${recMonthLabel(recCurrentMonth)})`;
      recRender();
    } catch(err) {
      document.getElementById('records-sub').innerHTML = '<i data-icon="x-circle"></i> โหลดไม่ได้: ' + err.message;
    }
    // Warm up Coverage in the background so the badge is accurate even if the
    // user stays on the Records list tab. Skip for non-admins to avoid a 403.
    tcovApplyLock();
    const _u = Auth.getUser ? Auth.getUser() : null;
    if (isSmCoverageAdminUser(_u)) tcovLoad().catch(() => {});
  }

  /* ════════════════════════════════════════════════
     COVERAGE VIEW — per-day 24-hour grid
     Only SM-team admins can access (matches api/helpers.php isSmCoverageAdmin)
     ════════════════════════════════════════════════ */
  let tcovData = null;
  let recView  = 'list';

  function isSmCoverageAdminUser(u) {
    if (!u) return false;
    if (u.role === 'super_admin') return true;
    if (!['sm_admin','dev_sm'].includes(u.role)) return false;
    return u.team === 'sm';
  }

  function tcovApplyLock() {
    const user = Auth.getUser ? Auth.getUser() : null;
    const locked = !isSmCoverageAdminUser(user);
    const tab = document.getElementById('rec-subtab-coverage');
    if (!tab) return;
    tab.classList.toggle('locked', locked);
    tab.dataset.locked = locked ? '1' : '';
    tab.title = locked ? 'เฉพาะ admin ของทีม sm เท่านั้น' : '';
    const badge = document.getElementById('rec-subtab-miss');
    const badgeHtml = badge ? badge.outerHTML : '';
    tab.innerHTML = (locked ? '<i data-icon="lock"></i>' : '<i data-icon="calendar"></i>') + ' Coverage ' + badgeHtml;
  }

  function recSwitchView(name) {
    if (name === 'coverage') {
      const tab = document.getElementById('rec-subtab-coverage');
      if (tab?.dataset.locked === '1') {
        Toast.warning('เฉพาะ admin ของทีม sm เท่านั้น');
        return;
      }
    }
    recView = name;
    document.getElementById('rec-subtab-list').classList.toggle('active',     name === 'list');
    document.getElementById('rec-subtab-coverage').classList.toggle('active', name === 'coverage');
    document.getElementById('rec-view-list').classList.toggle('active',     name === 'list');
    document.getElementById('rec-view-coverage').classList.toggle('active', name === 'coverage');
    if (name === 'coverage' && !tcovData) tcovLoad();
  }

  async function tcovLoad() {
    const list = document.getElementById('tcov-list');
    if (list) list.innerHTML = `<div class="tcov-empty">⏳ กำลังโหลด…</div>`;
    try {
      const json = await recFetch(`./api/test-records.php?action=coverage&month=${recCurrentMonth}&tz=%2B07:00`);
      tcovData = json?.data || null;
    } catch { tcovData = null; }
    tcovRender();
    tcovUpdateBadge();
  }

  function tcovUpdateBadge() {
    const badge = document.getElementById('rec-subtab-miss');
    if (!badge) return;
    const s = tcovData?.summary || {};
    const n = (s.missing || 0) + (s.duplicates || 0);
    if (n > 0) { badge.textContent = String(n); badge.style.display = ''; }
    else       { badge.style.display = 'none'; }
  }

  function tcovRender() {
    const list = document.getElementById('tcov-list');
    const sumEl = document.getElementById('tcov-summary');
    if (!tcovData) {
      if (list)  list.innerHTML  = `<div class="tcov-empty">โหลดข้อมูลไม่สำเร็จ</div>`;
      if (sumEl) sumEl.innerHTML = '';
      return;
    }
    const s = tcovData.summary || {};
    const bs = s.by_status || {};
    sumEl.innerHTML =
        `<span class="tcov-chip ok"><i data-icon="check-circle"></i> ครบ ${bs.ok||0} วัน</span>` +
        `<span class="tcov-chip partial"><i data-icon="alert-triangle"></i> ไม่ครบ ${bs.partial||0} วัน</span>` +
        `<span class="tcov-chip missing"><i data-icon="x-circle"></i> ขาด ${bs.missing||0} วัน</span>` +
        (bs.future ? `<span class="tcov-chip future">⏳ ยังไม่ถึง ${bs.future} วัน</span>` : '') +
        `<span class="tcov-chip missing">${s.missing||0} ชม.ขาด</span>` +
        `<span class="tcov-chip dup">${s.duplicates||0} ชม.ซ้ำ</span>` +
        `<span class="tcov-legend">ครอบคลุม ${s.covered||0}/${s.expected_hours||0} ชม. ที่คาดว่าต้องมี</span>`;

    const onlyIssue   = document.getElementById('tcov-only-issue').checked;
    const hideWeekend = document.getElementById('tcov-hide-weekend').checked;
    const hideHoliday = document.getElementById('tcov-hide-holiday').checked;
    const hideFuture  = document.getElementById('tcov-hide-future').checked;

    const rows = (tcovData.days || []).filter(d => {
      if (hideFuture  && d.future)     return false;
      if (hideWeekend && d.is_weekend) return false;
      if (hideHoliday && d.holiday)    return false;
      if (onlyIssue   && d.status === 'ok' && !d.dup_count) return false;
      if (onlyIssue   && d.status === 'future')             return false;
      return true;
    });

    if (!rows.length) {
      list.innerHTML = `<div class="tcov-empty">ไม่มีวันที่ตรงเงื่อนไข</div>`;
      return;
    }

    const today     = tcovData.today;
    const todayHour = tcovData.today_hour ?? 23;

    list.innerHTML = rows.map(d => {
      const cls = ['tcov-row',
        d.date === today ? 'today' : '',
        d.holiday        ? 'holiday' : '',
        (d.is_weekend && !d.holiday) ? 'weekend' : '',
      ].filter(Boolean).join(' ');

      const dateObj = new Date(d.date + 'T00:00:00');
      const thDate  = dateObj.toLocaleDateString('th-TH', { day:'numeric', month:'short' });
      const wknd    = d.is_weekend ? `<span class="tcov-tag wknd">${escHtml(d.weekday)}</span>` : '';
      const hol     = d.holiday    ? `<span class="tcov-tag hol" title="${escHtml(d.holiday)}">🌸 หยุด</span>` : '';
      const bf      = d.backfilled ? `<span class="tcov-tag bf" title="Backfilled"><i data-icon="edit"></i> ${d.backfilled}</span>` : '';
      const dupTag  = d.dup_count  ? `<span class="tcov-tag dup" title="${d.dup_count} ชม.ซ้ำ"><i data-icon="refresh-cw"></i> ${d.dup_count}</span>` : '';

      const statusLbl = { ok:'<i data-icon="check-circle"></i> ครบ', partial:'<i data-icon="alert-triangle"></i> ไม่ครบ', missing:'<i data-icon="x-circle"></i> ขาด', future:'⏳ ยังไม่ถึง' }[d.status] || d.status;

      const isFuture = d.future;
      const cells = (d.hours || []).map((n, h) => {
        let hcls = 'tcov-hour';
        let title = `${String(h).padStart(2,'0')}:00 — `;
        // For today, hours beyond current hour aren't "expected yet"
        const isBeyondNow = (d.date === today && h > todayHour) || isFuture;
        let click = '';
        if (n === 0) {
          if (isBeyondNow) { hcls += ' next'; title += 'ยังไม่ถึง'; }
          else             { hcls += ' miss'; title += 'ไม่มีบันทึก · คลิกเพื่อบันทึกย้อนหลัง'; click = ` onclick="tcovBackfillHour('${d.date}', ${h})"`; }
        } else if (n === 1) { hcls += ' have'; title += '1 บันทึก'; }
        else                { hcls += ' dup';  title += n + ' บันทึก (ซ้ำ) · คลิกเพื่อจัดการ'; click = ` onclick="tcovShowDupPopover(event, '${d.date}', ${h})"`; }
        return `<div class="${hcls}" title="${title}"${click}>${String(h).padStart(2,'0')}</div>`;
      }).join('');

      const covLabel = isFuture
        ? '—'
        : `${d.covered}/${d.expected_hours}`;

      return `<div class="${cls}">
        <div>
          <div class="tcov-date-main">${escHtml(thDate)}${wknd}${hol}${dupTag}${bf}</div>
          <div class="tcov-date-sub">${escHtml(d.date)} · ${escHtml(d.weekday)} · ${covLabel} ชม.</div>
        </div>
        <div><span class="tcov-status ${d.status}">${statusLbl}</span></div>
        <div class="tcov-hours">${cells}</div>
        <div class="tcov-actions"></div>
      </div>`;
    }).join('');
  }

  function tcovBackfillHour(dateStr, hour) {
    const u = Auth.getUser ? Auth.getUser() : null;
    if (!isSmCoverageAdminUser(u)) { Toast.warning('เฉพาะ admin ของทีม sm เท่านั้น'); return; }
    // ISO with +07:00 offset so PHP DateTime treats hour as Bangkok local.
    const hh = String(hour).padStart(2, '0');
    const iso = `${dateStr}T${hh}:00:00+07:00`;
    window.__portalBackfill = { date: dateStr, hour, iso };
    switchTab('portal');
    Toast.info?.(`<i data-icon="refresh-cw"></i> บันทึกย้อนหลังสำหรับ ${dateStr} ${hh}:00 — กด Check Now แล้ว Submit`) ||
      Toast.success?.(`บันทึกย้อนหลัง ${dateStr} ${hh}:00`);
    // portalInit will render the backfill banner (see portalInit patch).
  }

  /* ── Duplicate-hour popover ─────────────────────────── */
  let _tcovPopEl = null;

  function tcovClosePopover() {
    if (_tcovPopEl) { _tcovPopEl.remove(); _tcovPopEl = null; }
    document.removeEventListener('click', _tcovOnDocClick, true);
    document.removeEventListener('keydown', _tcovOnKeyDown, true);
  }
  function _tcovOnDocClick(e) {
    if (_tcovPopEl && !_tcovPopEl.contains(e.target)) tcovClosePopover();
  }
  function _tcovOnKeyDown(e) {
    if (e.key === 'Escape') tcovClosePopover();
  }

  function tcovShowDupPopover(event, dateStr, hour) {
    event.stopPropagation();
    const u = Auth.getUser ? Auth.getUser() : null;
    if (!isSmCoverageAdminUser(u)) { Toast.warning('เฉพาะ admin ของทีม sm เท่านั้น'); return; }

    const day = (tcovData?.days || []).find(d => d.date === dateStr);
    const recs = (day?.dup_details && day.dup_details[String(hour)]) || [];
    if (!recs.length) { Toast.warning('ไม่พบข้อมูลรายละเอียด — ลอง Refresh'); return; }

    tcovClosePopover();

    const hh = String(hour).padStart(2, '0');
    const rows = recs.map(r => {
      const t = new Date(r.timestamp).toLocaleTimeString('th-TH', {
        hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Bangkok',
      });
      const bf = r.backfilled ? '<span class="tcov-pop-bf"><i data-icon="edit"></i> BF</span>' : '';
      return `<div class="tcov-pop-row" data-id="${escHtml(r.id)}">
        <div class="tcov-pop-row-main">
          <div class="tcov-pop-time">${escHtml(t)}${bf}</div>
          <div class="tcov-pop-reporter"><i data-icon="user"></i> ${escHtml(r.reporter || '—')}</div>
        </div>
        <button class="tcov-pop-del" onclick="tcovDeleteDup('${escHtml(r.id)}', '${dateStr}', ${hour})"><i data-icon="trash"></i> ลบ</button>
      </div>`;
    }).join('');

    const pop = document.createElement('div');
    pop.className = 'tcov-pop';
    pop.innerHTML = `
      <div class="tcov-pop-hd">
        <div class="tcov-pop-hd-title"><i data-icon="refresh-cw"></i> ${recs.length} รายการซ้ำ
          <span class="tcov-pop-hd-sub">· ${escHtml(dateStr)} ${hh}:00</span>
        </div>
        <button class="tcov-pop-close" title="Esc" onclick="tcovClosePopover()"><i data-icon="x"></i></button>
      </div>
      <div class="tcov-pop-body">${rows}</div>
      <div class="tcov-pop-foot">ลบตัวไหนก็ได้ — เก็บไว้ 1 รายการเพื่อให้ hour นี้ยังนับว่า "ครบ"</div>
    `;
    document.body.appendChild(pop);
    _tcovPopEl = pop;

    // Position anchored below the cell, flip above if overflowing.
    const cell = event.currentTarget || event.target;
    const cellRect = cell.getBoundingClientRect();
    const popRect  = pop.getBoundingClientRect();
    const margin   = 6;
    let top  = cellRect.bottom + margin;
    let left = cellRect.left + (cellRect.width / 2) - (popRect.width / 2);
    if (top + popRect.height > window.innerHeight - 12) {
      top = cellRect.top - popRect.height - margin;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
    pop.style.top  = top + 'px';
    pop.style.left = left + 'px';

    // Defer wiring outside-click until after this click bubbles.
    setTimeout(() => {
      document.addEventListener('click', _tcovOnDocClick, true);
      document.addEventListener('keydown', _tcovOnKeyDown, true);
    }, 0);
  }

  async function tcovDeleteDup(recId, dateStr, hour) {
    const u = Auth.getUser ? Auth.getUser() : null;
    if (!isSmCoverageAdminUser(u)) { Toast.warning('เฉพาะ admin ของทีม sm เท่านั้น'); return; }
    if (!await SOMDialog.confirm(`ลบ record นี้?\n\n${dateStr} ${String(hour).padStart(2,'0')}:00\nID: ${recId}\n\nจะบันทึกใน activity log`, { title: 'ยืนยันการลบ', okLabel: 'ลบ', icon: 'danger', okColor: 'danger' })) return;

    // Disable the row's delete button while the request is in flight.
    const row = _tcovPopEl?.querySelector(`.tcov-pop-row[data-id="${recId}"]`);
    const btn = row?.querySelector('.tcov-pop-del');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    // The month path for the delete endpoint = the month of THIS record's
    // UTC timestamp (that's the file it's stored in), not necessarily the
    // local-tz month the coverage view uses.
    const day = (tcovData?.days || []).find(d => d.date === dateStr);
    const rec = day?.dup_details?.[String(hour)]?.find(r => r.id === recId);
    const monthForFile = (rec?.timestamp || '').slice(0, 7) || recCurrentMonth;

    try {
      const res = await recFetch(`./api/test-records-admin.php?action=delete&month=${monthForFile}`, {
        method: 'POST',
        body: JSON.stringify({ id: recId }),
      });
      if (!res?.success) throw new Error(res?.message || 'ลบไม่สำเร็จ');

      Toast.success?.('ลบ record สำเร็จ');
      tcovClosePopover();
      // Reload coverage + the Records tab list so both stay in sync.
      await tcovLoad();
      recordsLoad().catch(() => {});
    } catch (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="trash"></i> ลบ'; }
      Toast.error?.('ลบไม่สำเร็จ: ' + err.message);
    }
  }

  // Refresh coverage when month dropdown changes (recMonthChange calls recordsLoad
  // → which calls tcovLoad in background).

  async function recDelete(recId, dateTime) {
    if (!await SOMDialog.confirm(`ต้องการลบ record นี้?\n\n${dateTime}\n\nการลบจะถูกบันทึกใน activity log`, { title: 'ยืนยันการลบ', okLabel: 'ลบ', icon: 'danger', okColor: 'danger' })) return;
    
    try {
      const res = await recFetch(`./api/test-records-admin.php?action=delete&month=${recCurrentMonth}`, {
        method: 'POST',
        body: JSON.stringify({ id: recId })
      });
      
      if (res.success) {
        // Remove from local array
        recRows = recRows.filter(r => r.id !== recId);
        recExpanded.delete(recId);
        document.getElementById('records-sub').textContent = `${recRows.length} รายการ`;
        recRender();
        
        // Show success message
        if (typeof Toast !== 'undefined') {
          Toast.success('ลบ record สำเร็จ');
        } else {
          await SOMDialog.alert('ลบ record สำเร็จ', { title: 'สำเร็จ', icon: 'success' });
        }
      } else {
        throw new Error(res.message || 'ลบไม่สำเร็จ');
      }
    } catch(err) {
      if (typeof Toast !== 'undefined') {
        Toast.error('ลบไม่สำเร็จ: ' + err.message);
      } else {
        await SOMDialog.alert('ลบไม่สำเร็จ: ' + err.message, { title: 'เกิดข้อผิดพลาด', icon: 'danger' });
      }
    }
  }

  async function recordsExportCSV() {
    const records = recRows.filter(r => (r.brand || 'tmn') === activeRecordsBrand).slice().reverse();
    if (!records.length) { await SOMDialog.alert('ไม่มีข้อมูลของ ' + activeRecordsBrand.toUpperCase(), { title: 'แจ้งเตือน', icon: 'info' }); return; }
    const visGroups = SERVICE_GROUPS.filter(g => (g.brand || 'tmn') === activeRecordsBrand);
    const headers = ['DateTime','Reporter'];
    visGroups.forEach(g => {
      headers.push(g.name + ' Status', g.name + ' Remark');
      g.children.forEach(c => headers.push(c));
    });
    const rows = [headers];
    records.forEach(rec => {
      const row = [new Date(rec.timestamp).toLocaleString('th-TH'), rec.reporter];
      visGroups.forEach(g => {
        const grp = rec.services?.[g.id] || {};
        row.push(grp.status||'', grp.remark||'');
        g.children.forEach(c => row.push(grp.children?.[c]||''));
      });
      rows.push(row);
    });
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'test-records-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  }


/* ── next inline block ── */


  // Removed reconSaveConfig - credentials now managed in admin panel

  function reconToggleDebug() {
    const el = document.getElementById('recon-debug');
    el.classList.toggle('show');
  }

  function updateDebugInfo(endpoint, params, token, response) {
    document.getElementById('debug-endpoint').textContent = endpoint;
    document.getElementById('debug-params').textContent = JSON.stringify(params, null, 2);
    document.getElementById('debug-token').textContent = token ? token.substring(0, 50) + '...' : 'No token';
    document.getElementById('debug-response').textContent = JSON.stringify(response, null, 2);
  }

  function toggleJenkinsDebug() {
    const el = document.getElementById('jenkins-debug');
    el.classList.toggle('show');
  }

  async function checkJenkinsJob() {
    const resultDiv = document.getElementById('jenkins-result');
    const buildsDiv = document.getElementById('jenkins-builds');
    const debugDiv  = document.getElementById('jenkins-debug-content');

    resultDiv.style.display = 'block';
    buildsDiv.innerHTML = `<div class="step-status-row"><div class="spinner" style="width:12px;height:12px;border-width:2px;flex-shrink:0"></div> กำลังโหลด...</div>`;

    try {
      const jenkinsUrl = 'https://jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io/job/truemoney-fund-production/job/fund-out-reconcile-job-job-fund-out-reconcile-run-pipeline/api/json?tree=builds[number,result,timestamp,duration,url]{0,5}';
      const apiToken   = '115bed079dac44a59cbea48f9566f20651';
      const username   = 'warapon.lea';
      const proxyUrl   = './api/jenkins-proxy.php?url=' + encodeURIComponent(jenkinsUrl);

      debugDiv.innerHTML = `<i data-icon="satellite"></i> Endpoint: ${proxyUrl}\n<i data-icon="key"></i> User: ${username}\n⏳ กำลังส่งคำขอ...`;

      const resp = await fetch(proxyUrl, {
        headers: { 'X-Jenkins-Token': apiToken, 'X-Jenkins-User': username }
      });
      const responseText = await resp.text();
      let data;
      try { data = JSON.parse(responseText); }
      catch (e) { throw new Error('Invalid JSON: ' + responseText.substring(0, 200)); }

      debugDiv.innerHTML = `<i data-icon="satellite"></i> Endpoint: ${proxyUrl}\n<i data-icon="check-circle"></i> Status: ${resp.status}\n${JSON.stringify(data, null, 2).substring(0, 400)}...`;

      if (!resp.ok) throw new Error('HTTP ' + resp.status + (data.error ? ': ' + data.error : ''));

      const builds = data.builds || [];
      if (!builds.length) {
        buildsDiv.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">ไม่พบข้อมูล Build</div>';
        return;
      }

      const STATUS_MAP = {
        SUCCESS: ['success','<i data-icon="check-circle"></i>','#86efac'],
        FAILURE: ['failure','<i data-icon="x-circle"></i>','#fca5a5'],
        ABORTED: ['aborted','<i data-icon="stop-circle"></i>','#9ca3af'],
      };

      trackTestServiceRun('jenkins_check');
      buildsDiv.innerHTML = '<div class="build-list">' + builds.map(build => {
        const s     = build.result || 'RUNNING';
        const [cls, icon, color] = STATUS_MAP[s] || ['running','<i data-icon="refresh-cw"></i>','#fbbf24'];
        const date  = new Date(build.timestamp);
        const dur   = Math.round(build.duration / 1000 / 60);
        return `<div class="build-row ${cls}">
          <div class="build-icon">${icon}</div>
          <div class="build-info">
            <div class="build-title">Build #${build.number} — ${s}</div>
            <div class="build-meta">${date.toLocaleString('th-TH')} · ${dur} นาที</div>
          </div>
          <a href="${build.url}" target="_blank" class="build-link">↗ ดูรายละเอียด</a>
        </div>`;
      }).join('') + '</div>';

    } catch (err) {
      debugDiv.textContent += `\n\n<i data-icon="x-circle"></i> Error: ${err.message}`;
      buildsDiv.innerHTML = `
        <div class="step-info-box error show" style="flex-direction:column;align-items:flex-start;gap:6px;">
          <div><strong><i data-icon="alert-triangle"></i> ไม่สามารถดึงข้อมูลอัตโนมัติได้</strong><br>${escHtml(err.message)}</div>
          <a href="https://jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io/job/truemoney-fund-production/job/fund-out-reconcile-job-job-fund-out-reconcile-run-pipeline/"
             target="_blank" class="btn-link-action" style="font-size:11px;padding:5px 12px;">↗ เปิด Jenkins</a>
        </div>`;
    }
  }

  function toggleRundeckGuide() {
    document.getElementById('rundeck-guide').classList.toggle('show');
  }

  async function reconCheck() {
    reconHideAll();
    reconSetLoading(true);
    reconSetStatus('<i data-icon="lock"></i> กำลัง Login…');

    // ── Read query params from the inline form ──
    const qp = rqpGetParams();

    // Validate manual date inputs
    if (!qp.autoDate && (!qp.dateFrom || !qp.dateTo)) {
      reconSetLoading(false);
      reconSetStatus('');
      reconShowError('กรุณากรอก From และ To date ให้ครบทั้งสองช่อง');
      return;
    }

    let from, to, toDisplay, fromDisplay;
    if (qp.autoDate) {
      const range = reconGetRange();
      from = range.from; to = range.to;
      fromDisplay = range.fromDisplay; toDisplay = range.toDisplay;
    } else {
      // Manual dates — convert to timestamp
      fromDisplay = qp.dateFrom || '';
      toDisplay   = qp.dateTo   || '';
      
      // Parse dates and convert to timestamp
      if (fromDisplay) {
        const fromDate = new Date(fromDisplay);
        from = fromDate.getTime();
      }
      if (toDisplay) {
        const toDate = new Date(toDisplay);
        to = toDate.getTime();
      }
    }

    try {
      const token = await getValidToken();
      reconSetStatus('<i data-icon="search"></i> กำลังตรวจสอบ…');

      const headers = { 'Authorization': 'Bearer ' + token };

      // Build URL with all overridable query params
      const qs = new URLSearchParams({ action: 'check' });
      
      // Always use timestamp format
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      
      qs.set('reconcile_status',  qp.reconcileStatus);
      qs.set('transfer_status',   qp.transferStatus);
      qs.set('bank_code',         qp.bankCode);
      if (qp.requestChannel)  qs.set('request_channel',  qp.requestChannel);
      if (qp.requestStatus)   qs.set('request_status',   qp.requestStatus);
      if (qp.tppId)           qs.set('tpp_id',           qp.tppId);
      if (qp.utibaId)         qs.set('utiba_id',         qp.utibaId);
      if (qp.ewAccount)       qs.set('ew_account',       qp.ewAccount);
      if (qp.requestAmount)   qs.set('request_amount',   qp.requestAmount);
      if (qp.bankAccountNo)   qs.set('bank_account_no',  qp.bankAccountNo);
      if (qp.bankAccountName) qs.set('bank_account_name',qp.bankAccountName);
      qs.set('length', qp.limit);

      const url = `${PROXY_BASE}?${qs.toString()}`;

      const debugParams = {
        action: 'check',
        date_mode:       qp.autoDate ? 'auto' : 'manual',
        from:            from,
        to:              to,
        from_display:    fromDisplay,
        to_display:      toDisplay,
        reconcile_status: qp.reconcileStatus || '(all)',
        transfer_status:  qp.transferStatus  || '(all)',
        bank_code:        qp.bankCode,
        length:           qp.limit,
      };
      updateDebugInfo(url, debugParams, token, { status: 'Sending request...' });

      const resp = await fetch(url, { headers });

      let json;
      try { json = await resp.json(); }
      catch (parseErr) {
        const errorResponse = { error: 'JSON parse error', status: resp.status, message: parseErr.message };
        updateDebugInfo(url, debugParams, token, errorResponse);
        reconShowError(`Server response error (${resp.status}): ไม่สามารถอ่าน JSON ได้`);
        return;
      }

      updateDebugInfo(url, debugParams, token, { status: resp.status, ok: resp.ok, data: json });

      if (!resp.ok) {
        const msg = json.error || `Error ${resp.status}`;
        if (resp.status === 401) {
          clearTokenCache();
          reconShowError(msg + ' - กรุณาติดต่อ Admin เพื่อตรวจสอบ Reconcile Credentials');
        } else {
          reconShowError(msg);
        }
        return;
      }

      // Backend responded 200 → unlock Portal/Records tabs
      if (!reconRanOnce) {
        reconRanOnce = true;
        refreshTabLockUI();
        Toast.success('ปลดล็อค Test Service Portal และ Daily Test Records แล้ว');
      }

      const data = json.data || [];
      _alertReconData = data; // store for email CSV attachment

      if (data.length === 0) {
        document.getElementById('recon-empty').classList.add('show');
      } else {
        document.getElementById('recon-count').textContent = data.length;
        const cols = Object.keys(data[0]);
        document.getElementById('recon-thead').innerHTML =
          '<tr>' + cols.map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';
        document.getElementById('recon-tbody').innerHTML =
          data.map(row =>
            '<tr>' + cols.map(c => `<td>${escHtml(String(row[c] ?? '—'))}</td>`).join('') + '</tr>'
          ).join('');
        document.getElementById('recon-last-check').textContent =
          'ตรวจสอบล่าสุด ' + new Date().toLocaleTimeString('th-TH') + ' · ถึง ' + toDisplay;
        trackTestServiceRun('recon_check');
        document.getElementById('recon-result').classList.add('show');

        // ── Threshold check → show alert modal ──
        const cfg       = getStep1Config();
        const threshold = parseInt(cfg.threshold) || 50;
        if (data.length >= threshold) {
          // Store date range for email subject
          const fromDt = from ? new Date(Number(from)) : null;
          const toDt   = to   ? new Date(Number(to))   : null;
          _alertDateRange = fromDt && toDt
            ? fmtDateEN(fromDt) + ' - ' + fmtDateEN(toDt).replace(/^\d{2}-\w{3}-\d{4} /, '')
            : fmtDateEN(new Date());
          setTimeout(() => showAlertModal(data.length, threshold), 400);
        }
      }
    } catch (err) {
      updateDebugInfo('Error', {}, null, { error: err.message, stack: err.stack });
      reconShowError(err.message || 'เกิดข้อผิดพลาด');
    } finally {
      reconSetLoading(false);
      reconSetStatus('');
    }
  }


/* ── next inline block ── */


/* ════════════════════════════════════════════════════════════════
   SETTINGS — localStorage-backed config for all 3 steps
   ════════════════════════════════════════════════════════════════ */

const CFG_KEY = 'ts_step_config';

function getAllConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
}
function getStep1Config() {
  const d = getAllConfig().step1 || {};
  return {
    threshold:    d.threshold    ?? 50,
    offset:       d.offset       ?? 2,
    jiraSummary:  d.jiraSummary  ?? 'CIMB transfer reconcile status New {count} transactions ({datetime})',
    jiraBU:       d.jiraBU       ?? 'TrueMoneyTH',
    jiraService:  d.jiraService  ?? 'Fund-out',
    jiraChannel:  d.jiraChannel  ?? 'TrueMoney Transfer - CIMB',
    jiraDetected: d.jiraDetected ?? 'Service Monitoring (SM)',
    jiraWorkType: d.jiraWorkType ?? 'Monitoring',
    jiraAction:   d.jiraAction   ?? 'Escalated to CIMB support team.',
    chatWebhook:  d.chatWebhook  ?? '',
    chatMsg:      d.chatMsg      ?? '<i data-icon="alert-triangle"></i> Reconciliation Alert\nCash-out Status: New\n\nTotal Records: {count} รายการ\nCheck Time: {datetime}\nStatus: NEW\n\n<i data-icon="alert-triangle"></i> รายการเกิน {threshold} - สร้าง Jira Ticket แล้ว\nเพื่อทราบค่ะ/ครับ ทีมพบ CIMB Reconcile Status New = {count} รายการ\nทีมกำลังประสานงานตรวจสอบเพิ่มเติมครับ/ค่ะ',
    emailTo:      d.emailTo      ?? 'prajuk.s@cimbthai.com, varin.j@cimbthai.com, tbhotline@cimbthai.com',
    emailCc:      d.emailCc      ?? 'TH_TB_IMP@cimbthai.com, sm@ascendcorp.com, Chiraphong.Khu@ascendcorp.com, tak.sut@ascendcorp.com, chalit.cho@ascendcorp.com, sirirat.kam@ascendcorp.com, IQ-SO@ascendcorp.com',
    emailSubject: d.emailSubject ?? '[{jira_key}] : CIMB transfer reconcile status New {count} transactions ({date})',
    emailBody:    d.emailBody    ?? '',
  };
}
function getStep2Config() {
  const d = getAllConfig().step2 || {};
  return {
    user:    d.user    ?? 'warapon.lea',
    token:   d.token   ?? '115bed079dac44a59cbea48f9566f20651',
    url:     d.url     ?? 'https://jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io/job/truemoney-fund-production/job/fund-out-reconcile-job-job-fund-out-reconcile-run-pipeline/api/json?tree=builds[number,result,timestamp,duration,url]{0,5}',
    builds:  d.builds  ?? 5,
    console: d.console ?? 'https://jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io/job/truemoney-fund-production/job/fund-out-reconcile-job-job-fund-out-reconcile-run-pipeline/',
  };
}
function getStep3Config() {
  const d = getAllConfig().step3 || {};
  return {
    url:      d.url      ?? 'https://th-ops-rundeck.mgt.ascendmoney.io/project/SM/job/show/b87c7df1-2ec1-4480-9fe6-22a07f31ad02',
    partner:  d.partner  ?? 'CIMB',
    step1txt: d.step1txt ?? 'คลิก "เปิด Rundeck Job" ด้านล่าง',
    step2txt: d.step2txt ?? 'ถ้ายังไม่ได้ login → Login ด้วย User ของคุณ',
    selector: d.selector ?? 'sftp_partner_name = CIMB',
  };
}

/* ── Open / close / tab switch ── */
let _cfgActiveTab = 'step1';

function openSettings(tab = 'step1') {
  _cfgActiveTab = tab;
  loadSettingsForm();
  document.getElementById('cfg-overlay').classList.add('show');
}
function closeSettings() {
  document.getElementById('cfg-overlay').classList.remove('show');
  document.getElementById('cfg-save-status').textContent = '';
}
function switchCfgTab(tab) {
  _cfgActiveTab = tab;
  document.querySelectorAll('.cfg-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.cfg-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('cfg-tab-' + tab).classList.add('active');
  document.getElementById('cfg-pane-' + tab).classList.add('active');
}

/* ── Populate form from saved config ── */
function loadSettingsForm() {
  const s1 = getStep1Config();
  const s2 = getStep2Config();
  const s3 = getStep3Config();

  // Step 1
  document.getElementById('cfg-s1-threshold').value    = s1.threshold;
  document.getElementById('cfg-s1-offset').value        = s1.offset;
  document.getElementById('cfg-s1-jira-summary').value  = s1.jiraSummary;
  document.getElementById('cfg-s1-jira-bu').value       = s1.jiraBU;
  document.getElementById('cfg-s1-jira-service').value  = s1.jiraService;
  document.getElementById('cfg-s1-jira-channel').value  = s1.jiraChannel;
  document.getElementById('cfg-s1-jira-detected').value  = s1.jiraDetected;
  document.getElementById('cfg-s1-jira-worktype').value  = s1.jiraWorkType || 'Monitoring';
  document.getElementById('cfg-s1-jira-action').value    = s1.jiraAction;
  document.getElementById('cfg-s1-chat-webhook').value  = s1.chatWebhook;
  document.getElementById('cfg-s1-chat-msg').value      = s1.chatMsg;
  document.getElementById('cfg-s1-email-to').value      = s1.emailTo      || '';
  document.getElementById('cfg-s1-email-cc').value      = s1.emailCc      || '';
  document.getElementById('cfg-s1-email-subject').value = s1.emailSubject || '';
  document.getElementById('cfg-s1-email-body').value    = s1.emailBody    || '';

  // Step 2
  document.getElementById('cfg-s2-user').value    = s2.user;
  document.getElementById('cfg-s2-token').value   = s2.token;
  document.getElementById('cfg-s2-url').value     = s2.url;
  document.getElementById('cfg-s2-builds').value  = s2.builds;
  document.getElementById('cfg-s2-console').value = s2.console;

  // Step 3
  document.getElementById('cfg-s3-url').value      = s3.url;
  document.getElementById('cfg-s3-partner').value  = s3.partner;
  document.getElementById('cfg-s3-step1').value    = s3.step1txt;
  document.getElementById('cfg-s3-step2').value    = s3.step2txt;
  document.getElementById('cfg-s3-selector').value = s3.selector;

  // Activate the requested tab
  switchCfgTab(_cfgActiveTab);
}

/* ── Save all settings ── */
function saveSettings() {
  const all = {
    step1: {
      threshold:    document.getElementById('cfg-s1-threshold').value,
      offset:       document.getElementById('cfg-s1-offset').value,
      jiraSummary:  document.getElementById('cfg-s1-jira-summary').value,
      jiraBU:       document.getElementById('cfg-s1-jira-bu').value,
      jiraService:  document.getElementById('cfg-s1-jira-service').value,
      jiraChannel:  document.getElementById('cfg-s1-jira-channel').value,
      jiraDetected: document.getElementById('cfg-s1-jira-detected').value,
      jiraWorkType: document.getElementById('cfg-s1-jira-worktype').value || 'Monitoring',
      jiraAction:   document.getElementById('cfg-s1-jira-action').value,
      chatWebhook:  document.getElementById('cfg-s1-chat-webhook').value,
      chatMsg:      document.getElementById('cfg-s1-chat-msg').value,
      emailTo:      document.getElementById('cfg-s1-email-to').value.trim(),
      emailCc:      document.getElementById('cfg-s1-email-cc').value.trim(),
      emailSubject: document.getElementById('cfg-s1-email-subject').value.trim(),
      emailBody:    document.getElementById('cfg-s1-email-body').value,
    },
    step2: {
      user:    document.getElementById('cfg-s2-user').value,
      token:   document.getElementById('cfg-s2-token').value,
      url:     document.getElementById('cfg-s2-url').value,
      builds:  document.getElementById('cfg-s2-builds').value,
      console: document.getElementById('cfg-s2-console').value,
    },
    step3: {
      url:      document.getElementById('cfg-s3-url').value,
      partner:  document.getElementById('cfg-s3-partner').value,
      step1txt: document.getElementById('cfg-s3-step1').value,
      step2txt: document.getElementById('cfg-s3-step2').value,
      selector: document.getElementById('cfg-s3-selector').value,
    },
  };
  localStorage.setItem(CFG_KEY, JSON.stringify(all));

  const st = document.getElementById('cfg-save-status');
  st.innerHTML = '<i data-icon="check-circle"></i> บันทึกแล้ว';
  st.style.color = '#15803d';
  setTimeout(() => { st.textContent = ''; closeSettings(); }, 1200);
}

/* ════════════════════════════════════════════════════════════════
   ALERT MODAL — Threshold exceeded
   ════════════════════════════════════════════════════════════════ */

let _alertStep       = 1;
let _alertCount      = 0;
let _alertThreshold  = 50;
let _alertDoneItems  = [];
let _alertJiraKey    = '';
let _alertReconData  = [];
let _alertDateRange  = '';   // e.g. "17-Apr-2026 18:00 - 18:48"
let _jiraFieldsLoaded = false;
let _jiraFieldOptions = {};

// Format Date → "17-Apr-2026 18:48 AM/PM" (English, used in email subject)
function fmtDateEN(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd  = String(d.getDate()).padStart(2,'0');
  const mon = months[d.getMonth()];
  const yr  = d.getFullYear();
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dd}-${mon}-${yr} ${String(h).padStart(2,'0')}:${m} ${ampm}`;
}

// Load Jira field options
async function loadJiraFieldOptions() {
  if (_jiraFieldsLoaded) return; // Already loaded
  
  // Hardcoded options (from actual Jira field values)
  const fieldOptions = {
    'customfield_17066': [ // Business Unit Impacted (array)
      'Ascend Insurance',
      'Ascend Wealth',
      'Eagle',
      'Nano',
      'NCB',
      'None',
      'Orbit',
      'Others',
      'TrueMoney',
      'Vortex',
      'TMN Coin',
      'Ascend Bank',
    ],
    'customfield_17024': [ // TH Service Impacted (array)
      'Fund-in',
      'Fund-out',
      'Payment',
      'Wallet',
      'Loan',
      'Investment',
      'Insurance',
      'Bill Payment',
      'Top-up',
      'Transfer',
    ],
    'customfield_17023': [ // TH Channel/Component (array)
      'TrueMoney Transfer - CIMB',
      'TrueMoney Transfer - SCB',
      'TrueMoney Transfer - BBL',
      'TrueMoney Transfer - KBANK',
      'TrueMoney Wallet',
      'Mobile App',
      'Web Portal',
      'API',
      'Batch Process',
    ],
    'customfield_17016': [ // Detected by (select)
      'Service Monitoring (SM)',
      'Service Support (SS)',
      'CLT',
      'BU informed',
      '3rd party / partner',
      'Others',
    ],
    '__worktype__': [ // Work Type (issuetype)
      'Monitoring',
      'Task',
      'Bug',
      'Incident',
      'Change',
      'Problem',
      'Request',
    ],
  };

  const fieldMapping = {
    'customfield_17066': 'alert-jira-bu',
    'customfield_17024': 'alert-jira-service',
    'customfield_17023': 'alert-jira-channel',
    'customfield_17016': 'alert-jira-detected',
    '__worktype__':      'alert-jira-worktype',
  };
  
  try {
    for (const [fieldId, selectId] of Object.entries(fieldMapping)) {
      const options = fieldOptions[fieldId] || [];
      _jiraFieldOptions[fieldId] = options.map(v => ({ value: v }));
      
      // Populate select element
      const selectEl = document.getElementById(selectId);
      selectEl.innerHTML = '<option value="">-- เลือก --</option>' +
        options.map(opt => `<option value="${escHtml(opt)}">${escHtml(opt)}</option>`).join('');
    }
    
    _jiraFieldsLoaded = true;

    // Hide loading, show form
    document.getElementById('alert-jira-loading').style.display = 'none';
    document.getElementById('alert-jira-form').style.display = 'block';

    // Auto-select default values from config
    const cfg2 = getStep1Config();
    function trySetSelect(id, val) {
      const sel = document.getElementById(id);
      if (!sel || !val) return;
      // Try exact match first, then partial (case-insensitive)
      for (const opt of sel.options) {
        if (opt.value === val || opt.text === val) { sel.value = opt.value; return; }
      }
      const valLow = val.toLowerCase();
      for (const opt of sel.options) {
        if (opt.value.toLowerCase().includes(valLow) || opt.text.toLowerCase().includes(valLow)) {
          sel.value = opt.value; return;
        }
      }
    }
    trySetSelect('alert-jira-bu',       cfg2.jiraBU       || 'TrueMoney');
    trySetSelect('alert-jira-service',  cfg2.jiraService  || 'Fund-out');
    trySetSelect('alert-jira-channel',  cfg2.jiraChannel  || 'TrueMoney Transfer - CIMB');
    trySetSelect('alert-jira-detected', cfg2.jiraDetected || 'Service Monitoring (SM)');
    trySetSelect('alert-jira-worktype', cfg2.jiraWorkType || 'Monitoring');

  } catch (err) {
    console.error('Failed to load Jira fields:', err);
    // Show form anyway with empty options
    document.getElementById('alert-jira-loading').style.display = 'none';
    document.getElementById('alert-jira-form').style.display = 'block';
  }
}


function showAlertModal(count, threshold) {
  _alertStep      = 1;
  _alertCount     = count;
  _alertThreshold = threshold;
  _alertDoneItems = [];

  // Update header
  document.getElementById('alert-count').textContent     = count;
  document.getElementById('alert-threshold').textContent = threshold;

  // Load Jira field options if not loaded yet
  if (!_jiraFieldsLoaded) {
    loadJiraFieldOptions();
  } else {
    // Already loaded, show form immediately
    document.getElementById('alert-jira-loading').style.display = 'none';
    document.getElementById('alert-jira-form').style.display = 'block';
  }

  // Pre-fill Jira form
  const cfg     = getStep1Config();
  const now     = new Date();
  const dtStr   = now.toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' }) +
                  ' ' + now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
  const summary = (cfg.jiraSummary || 'CIMB transfer reconcile status New {count} transactions ({datetime})')
    .replace('{count}', count).replace('{datetime}', dtStr);

  document.getElementById('alert-jira-summary').value   = summary;
  
  // BU + Detected by จะถูก auto-select ใน loadJiraFieldOptions() → trySetSelect()
  
  document.getElementById('alert-jira-action').value    = cfg.jiraAction   || 'Escalated to CIMB support team.';

  // Default fault start = now (datetime-local format)
  const pad = n => String(n).padStart(2,'0');
  const faultDt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  document.getElementById('alert-jira-fault-start').value = faultDt;

  // Pre-fill Chat form
  const chatMsg = (cfg.chatMsg || '')
    .replace(/{count}/g, count)
    .replace(/{threshold}/g, threshold)
    .replace(/{datetime}/g, dtStr);
  document.getElementById('alert-chat-webhook').value = cfg.chatWebhook || '';
  document.getElementById('alert-chat-msg').value     = chatMsg;

  // Pre-fill Email form
  const nowDate = now.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const roundTime = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const emailTo = cfg.emailTo || 'prajuk.s@cimbthai.com, varin.j@cimbthai.com, tbhotline@cimbthai.com';
  const emailCc = cfg.emailCc || 'TH_TB_IMP@cimbthai.com, sm@ascendcorp.com, Chiraphong.Khu@ascendcorp.com, tak.sut@ascendcorp.com, chalit.cho@ascendcorp.com, sirirat.kam@ascendcorp.com, IQ-SO@ascendcorp.com';
  const emailSubjectTpl = cfg.emailSubject || '[{jira_key}] : CIMB transfer reconcile status New {count} transactions ({date})';
  const emailBodyTpl = cfg.emailBody ||
`เรียนทีมงาน CIMB

ในวันที่ {date} ทีมทรูมันนี่พบรายการ CIMB transfer ไม่เปลี่ยนสถานะเป็น reconcile รอบ {round_time} จำนวน {count} รายการ
จึงอยากรบกวนให้ทีมงาน CIMB ตรวจสอบเพิ่มเติมว่าพบรายการในฝั่ง CIMB หรือไม่ เบื้องต้นทรูมันนี่ได้แนบรายละเอียดไปให้ในไฟล์แนบแล้ว

:::::::::
วันเวลาที่ทำรายการเข้ามาที่ธนาคาร  = Field ใน File : Request Date/Time
Request id / Client Transaction No  = Field ใน File : TPP ID
Transaction ID                       = Field ใน File : Issuer Reference
Amount                               = Field ใน File : Request Amount
Account หรือ Biller ID ที่ต้องการโอนเงิน = Field ใน File : Bank A/C No.


Best regards,

Service Monitoring Center (SMC),
Service Management Center, Ascend Money
M +66 91 6969 885  E sm@ascendcorp.com
101 True Digital Park, Phoenix Building 7th Floor, Sukhumvit Road, Bang Chak,
Phra Khanong, Bangkok 10260
www.ascendmoneygroup.com`;

  // Subject: ใช้ English date range จาก query; {jira_key} จะถูก replace ใหม่หลัง Jira สร้าง
  const dateForSubject = _alertDateRange || fmtDateEN(now);
  const jiraKey = _alertJiraKey || '{Jira Key}';
  const emailSubject = emailSubjectTpl
    .replace(/{jira_key}/g, jiraKey).replace(/{count}/g, count).replace(/{date}/g, dateForSubject);
  const emailBody = emailBodyTpl
    .replace(/{date}/g, nowDate).replace(/{round_time}/g, roundTime).replace(/{count}/g, count);

  const emailToEl = document.getElementById('alert-email-to');
  const emailCcEl = document.getElementById('alert-email-cc');
  const emailSubEl = document.getElementById('alert-email-subject');
  const emailBodyEl = document.getElementById('alert-email-body');
  if (emailToEl)  emailToEl.value  = emailTo;
  if (emailCcEl)  emailCcEl.value  = emailCc;
  if (emailSubEl) emailSubEl.value = emailSubject;
  if (emailBodyEl) emailBodyEl.value = emailBody;

  const csvCountEl = document.getElementById('alert-csv-count');
  if (csvCountEl) csvCountEl.textContent = _alertReconData.length;

  // Reset progress UI
  alertUpdateStepUI();

  document.getElementById('alert-overlay').classList.add('show');
}

function closeAlertModal() {
  document.getElementById('alert-overlay').classList.remove('show');
}

function alertUpdateStepUI() {
  const steps    = ['alert-s1','alert-s2','alert-s3','alert-s4'];
  const lines    = ['alert-line1','alert-line2','alert-line3'];
  const contents = ['alert-step1-content','alert-step2-content','alert-step3-content','alert-step4-content'];
  const icons    = ['<i data-icon="ticket"></i>','<i data-icon="megaphone"></i>','<i data-icon="mail"></i>','<i data-icon="check-circle"></i>'];
  const labels   = ['สร้าง Jira Ticket','ส่ง Chat Alert','ส่งอีเมล','เสร็จสิ้น'];

  steps.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active','done');
    if (i + 1 < _alertStep)       el.classList.add('done');
    else if (i + 1 === _alertStep) el.classList.add('active');
  });
  lines.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('done', i + 1 < _alertStep);
  });
  contents.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (i + 1 === _alertStep) ? '' : 'none';
  });

  const nextBtn  = document.getElementById('alert-next-btn');
  const skipBtn  = document.getElementById('alert-skip-btn');
  const icon     = document.getElementById('alert-next-icon');
  const text     = document.getElementById('alert-next-text');
  const statusEl = document.getElementById('alert-status');
  statusEl.textContent = '';

  if (_alertStep === 4) {
    // Done screen
    const doneEl = document.getElementById('alert-done-items');
    if (doneEl) doneEl.innerHTML = _alertDoneItems.map(d => `<div class="alert-done-item"><i data-icon="check-circle"></i> ${escHtml(d)}</div>`).join('');
    nextBtn.style.display = 'none';
    skipBtn.style.display = 'none';
  } else {
    nextBtn.style.display = '';
    skipBtn.style.display = '';
    icon.innerHTML = icons[_alertStep - 1];
    text.textContent = labels[_alertStep - 1];
  }
}

function alertSkipStep() {
  if (_alertStep < 4) { _alertStep++; alertUpdateStepUI(); }
  else closeAlertModal();
}

async function alertNextStep() {
  if (_alertStep === 1)      await alertCreateJira();
  else if (_alertStep === 2) await alertSendChat();
  else if (_alertStep === 3) await alertSendEmail();
  else                       closeAlertModal();
}

/* ── Step 1: Create Jira Ticket ── */
async function alertCreateJira() {
  const btn    = document.getElementById('alert-next-btn');
  const status = document.getElementById('alert-status');
  btn.disabled = true;
  status.textContent = '⏳ กำลังสร้าง Jira Ticket…';
  status.style.color = 'var(--text-muted)';

  const summary    = document.getElementById('alert-jira-summary').value.trim();
  const bu         = document.getElementById('alert-jira-bu').value.trim();
  const service    = document.getElementById('alert-jira-service').value.trim();
  const channel    = document.getElementById('alert-jira-channel').value.trim();
  const detected   = document.getElementById('alert-jira-detected').value.trim();
  const workType   = document.getElementById('alert-jira-worktype').value.trim() || 'Monitoring';
  const action     = document.getElementById('alert-jira-action').value.trim();
  const faultStart = document.getElementById('alert-jira-fault-start').value;

  const faultIso = faultStart ? new Date(faultStart).toISOString() : new Date().toISOString();

  const payload = {
    summary,
    fields: {
      customfield_17066: bu,       // Business Unit Impacted (array) - will be converted by API
      customfield_17024: service,  // TH Service Impacted (array) - will be converted by API
      customfield_17023: channel,  // TH Channel / Component (array) - will be converted by API
      customfield_17016: detected, // Detected by (select) - will be converted by API
      customfield_17026: faultIso, // Fault Start Date/Time
      description: action,
      issuetype: workType,         // Work Type (issue type)
    },
  };

  try {
    const res = await API.jira.createTicket(payload);
    if (res?.ok) {
      const key = res.data?.data?.issue_key || res.data?.issue_key || '—';
      const issueUrl = res.data?.data?.issue_url || res.data?.issue_url || '';
      _alertJiraKey = key; // store for email subject

      // Update email subject field with real Jira key
      const subEl = document.getElementById('alert-email-subject');
      if (subEl && key !== '—') {
        subEl.value = subEl.value.replace(/\{Jira Key\}|{jira_key}/g, key);
      }

      _alertDoneItems.push(`สร้าง Jira Ticket สำเร็จ: ${key}${issueUrl ? ` (${issueUrl})` : ''}`);
      status.innerHTML = `<i data-icon="check-circle"></i> สร้างสำเร็จ: ${key}`;
      status.style.color = '#15803d';
      setTimeout(() => { _alertStep = 2; alertUpdateStepUI(); }, 900);
    } else {
      throw new Error(res?.data?.message || 'Jira API error');
    }
  } catch (err) {
    status.innerHTML = '<i data-icon="x-circle"></i> ' + err.message;
    status.style.color = '#dc2626';
  } finally {
    btn.disabled = false;
  }
}

/* ── Step 2: Send Google Chat Alert (via PHP proxy to bypass CSP) ── */
async function alertSendChat() {
  const btn    = document.getElementById('alert-next-btn');
  const status = document.getElementById('alert-status');
  btn.disabled = true;
  status.textContent = '⏳ กำลังส่ง Chat Alert…';
  status.style.color = 'var(--text-muted)';

  const webhook = document.getElementById('alert-chat-webhook').value.trim();
  const msg     = document.getElementById('alert-chat-msg').value.trim();

  if (!webhook) {
    status.innerHTML = '<i data-icon="alert-triangle"></i> กรุณาใส่ Webhook URL ก่อน';
    status.style.color = '#d97706';
    btn.disabled = false;
    return;
  }
  if (!msg) {
    status.innerHTML = '<i data-icon="alert-triangle"></i> กรุณาใส่ข้อความแจ้งเตือน';
    status.style.color = '#d97706';
    btn.disabled = false;
    return;
  }

  try {
    // Use PHP proxy to bypass CSP restrictions
    const res = await fetch('./api/chat-proxy.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (Auth.getToken ? Auth.getToken() : (localStorage.getItem('som_token') || '')),
      },
      body: JSON.stringify({ webhook, message: msg }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) {
      _alertDoneItems.push('ส่ง Google Chat Alert สำเร็จ');
      status.innerHTML = '<i data-icon="check-circle"></i> ส่ง Chat สำเร็จ';
      status.style.color = '#15803d';
      setTimeout(() => { _alertStep = 3; alertUpdateStepUI(); }, 900);
    } else {
      throw new Error(json.message || json.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    status.innerHTML = '<i data-icon="x-circle"></i> ' + err.message;
    status.style.color = '#dc2626';
  } finally {
    btn.disabled = false;
  }
}

/* ── Step 3: Send Email to CIMB ── */
async function alertSendEmail() {
  const btn    = document.getElementById('alert-next-btn');
  const status = document.getElementById('alert-status');
  btn.disabled = true;
  status.textContent = '⏳ กำลังส่งอีเมล…';
  status.style.color = 'var(--text-muted)';

  const parseEmails = (str) =>
    str.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);

  const to      = parseEmails(document.getElementById('alert-email-to').value);
  const cc      = parseEmails(document.getElementById('alert-email-cc').value);
  const subject = document.getElementById('alert-email-subject').value.trim();
  const bodyTxt = document.getElementById('alert-email-body').value.trim();

  if (!to.length) {
    status.innerHTML = '<i data-icon="alert-triangle"></i> กรุณาใส่ที่อยู่ผู้รับ (To) อย่างน้อย 1 ช่อง';
    status.style.color = '#d97706';
    btn.disabled = false;
    return;
  }
  if (!subject) {
    status.innerHTML = '<i data-icon="alert-triangle"></i> กรุณาใส่ Subject';
    status.style.color = '#d97706';
    btn.disabled = false;
    return;
  }

  // Convert plain text body to simple HTML (preserve line breaks + email signature feel)
  const htmlBody = bodyTxt
    .split('\n')
    .map(l => l.trim() === '' ? '<br>' : `<p style="margin:4px 0">${escHtml(l)}</p>`)
    .join('\n');

  // Build CSV attachment from stored reconcile data
  const attachments = [];
  if (_alertReconData && _alertReconData.length > 0) {
    const cols = Object.keys(_alertReconData[0]);
    const rows = [cols, ..._alertReconData.map(r => cols.map(c => String(r[c] ?? '')))];
    const csv  = rows.map(row => row.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    // Add BOM for Thai characters in Excel
    const csvWithBom = '\uFEFF' + csv;
    // btoa requires latin1; use TextEncoder → Uint8Array → base64
    const bytes  = new TextEncoder().encode(csvWithBom);
    let binary   = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    const b64    = btoa(binary);
    const fname  = 'reconcile_' + new Date().toISOString().slice(0, 10) + '.csv';
    attachments.push({ filename: fname, mime: 'text/csv', data: b64 });
  }

  try {
    const res = await API.mail.send({ to, cc, subject, body: htmlBody, isHtml: true, attachments });
    if (res?.ok) {
      _alertDoneItems.push(`ส่งอีเมลสำเร็จ → ${to.join(', ')}`);
      status.textContent = '✅ ส่งอีเมลสำเร็จ';
      status.style.color = '#15803d';
      setTimeout(() => { _alertStep = 4; alertUpdateStepUI(); }, 900);
    } else {
      throw new Error(res?.data?.message || res?.data?.error || 'Mail API error');
    }
  } catch (err) {
    status.textContent = '❌ ' + err.message;
    status.style.color = '#dc2626';
  } finally {
    btn.disabled = false;
  }
}

/* ── Apply saved Step 2/3 config to the live functions ── */
// Patch checkJenkinsJob to use saved config
const _origCheckJenkins = checkJenkinsJob;
window.checkJenkinsJob = async function() {
  const cfg = getStep2Config();
  const resultDiv  = document.getElementById('jenkins-result');
  const buildsDiv  = document.getElementById('jenkins-builds');
  const debugDiv   = document.getElementById('jenkins-debug-content');
  const numBuilds  = parseInt(cfg.builds) || 5;
  const jenkinsUrl = cfg.url.replace(/\{0,\d+\}/, `{0,${numBuilds}}`);
  const apiToken   = cfg.token;
  const username   = cfg.user;
  const proxyUrl   = './api/jenkins-proxy.php?url=' + encodeURIComponent(jenkinsUrl);

  // Update console link dynamically
  const consoleLink = document.querySelector('#jenkins-card a[href*="jenkins"]');
  if (consoleLink && cfg.console) consoleLink.href = cfg.console;

  resultDiv.style.display = 'block';
  buildsDiv.innerHTML = `<div class="step-status-row"><div class="spinner" style="width:12px;height:12px;border-width:2px;flex-shrink:0"></div> กำลังโหลด...</div>`;
  debugDiv.textContent = `📡 Endpoint: ${proxyUrl}\n🔑 User: ${username}\n⏳ กำลังส่งคำขอ...`;

  try {
    const resp = await fetch(proxyUrl, {
      headers: { 'X-Jenkins-Token': apiToken, 'X-Jenkins-User': username }
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Invalid JSON: ' + text.substring(0,200)); }
    debugDiv.textContent = `📡 Endpoint: ${proxyUrl}\n✅ Status: ${resp.status}\n${JSON.stringify(data,null,2).substring(0,400)}...`;
    if (!resp.ok) throw new Error('HTTP ' + resp.status + (data.error ? ': ' + data.error : ''));

    const builds = data.builds || [];
    if (!builds.length) { buildsDiv.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">ไม่พบข้อมูล Build</div>'; return; }

    const STATUS_MAP = { SUCCESS:['success','✅','#15803d'], FAILURE:['failure','❌','#dc2626'], ABORTED:['aborted','⏹️','#6b7280'] };
    buildsDiv.innerHTML = '<div class="build-list">' + builds.map(b => {
      const s = b.result || 'RUNNING';
      const [cls, icon] = STATUS_MAP[s] || ['running','🔄'];
      return `<div class="build-row ${cls}">
        <div class="build-icon">${icon}</div>
        <div class="build-info">
          <div class="build-title">Build #${b.number} — ${s}</div>
          <div class="build-meta">${new Date(b.timestamp).toLocaleString('th-TH')} · ${Math.round(b.duration/1000/60)} นาที</div>
        </div>
        <a href="${b.url}" target="_blank" class="build-link">↗ ดูรายละเอียด</a>
      </div>`;
    }).join('') + '</div>';
  } catch (err) {
    debugDiv.textContent += `\n\n❌ Error: ${err.message}`;
    buildsDiv.innerHTML = `<div class="step-info-box error show">${escHtml(err.message)}</div>`;
  }
};

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "setPortalBrand",  { configurable: true, get: () => setPortalBrand,  set: (v) => { setPortalBrand  = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setRecordsBrand", { configurable: true, get: () => setRecordsBrand, set: (v) => { setRecordsBrand = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_tcovOnDocClick", { configurable: true, get: () => _tcovOnDocClick, set: (v) => { _tcovOnDocClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_tcovOnKeyDown", { configurable: true, get: () => _tcovOnKeyDown, set: (v) => { _tcovOnKeyDown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "alertCreateJira", { configurable: true, get: () => alertCreateJira, set: (v) => { alertCreateJira = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "alertNextStep", { configurable: true, get: () => alertNextStep, set: (v) => { alertNextStep = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "alertSendChat", { configurable: true, get: () => alertSendChat, set: (v) => { alertSendChat = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "alertSendEmail", { configurable: true, get: () => alertSendEmail, set: (v) => { alertSendEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "alertSkipStep", { configurable: true, get: () => alertSkipStep, set: (v) => { alertSkipStep = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "alertUpdateStepUI", { configurable: true, get: () => alertUpdateStepUI, set: (v) => { alertUpdateStepUI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "checkJenkinsJob", { configurable: true, get: () => checkJenkinsJob, set: (v) => { checkJenkinsJob = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeAlertModal", { configurable: true, get: () => closeAlertModal, set: (v) => { closeAlertModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeSettings", { configurable: true, get: () => closeSettings, set: (v) => { closeSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateEN", { configurable: true, get: () => fmtDateEN, set: (v) => { fmtDateEN = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getAllConfig", { configurable: true, get: () => getAllConfig, set: (v) => { getAllConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getStep1Config", { configurable: true, get: () => getStep1Config, set: (v) => { getStep1Config = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getStep2Config", { configurable: true, get: () => getStep2Config, set: (v) => { getStep2Config = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getStep3Config", { configurable: true, get: () => getStep3Config, set: (v) => { getStep3Config = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isSmCoverageAdminUser", { configurable: true, get: () => isSmCoverageAdminUser, set: (v) => { isSmCoverageAdminUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFrame", { configurable: true, get: () => loadFrame, set: (v) => { loadFrame = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFrameIframe", { configurable: true, get: () => loadFrameIframe, set: (v) => { loadFrameIframe = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadJiraFieldOptions", { configurable: true, get: () => loadJiraFieldOptions, set: (v) => { loadJiraFieldOptions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadServiceGroups", { configurable: true, get: () => loadServiceGroups, set: (v) => { loadServiceGroups = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSettingsForm", { configurable: true, get: () => loadSettingsForm, set: (v) => { loadSettingsForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mkChildSel", { configurable: true, get: () => mkChildSel, set: (v) => { mkChildSel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mkToggle", { configurable: true, get: () => mkToggle, set: (v) => { mkToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openSettings", { configurable: true, get: () => openSettings, set: (v) => { openSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "portalInit", { configurable: true, get: () => portalInit, set: (v) => { portalInit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "portalSubmit", { configurable: true, get: () => portalSubmit, set: (v) => { portalSubmit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recAuthHdr", { configurable: true, get: () => recAuthHdr, set: (v) => { recAuthHdr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recBuildSub", { configurable: true, get: () => recBuildSub, set: (v) => { recBuildSub = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recClearCancel", { configurable: true, get: () => recClearCancel, set: (v) => { recClearCancel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recDelete", { configurable: true, get: () => recDelete, set: (v) => { recDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recFetch", { configurable: true, get: () => recFetch, set: (v) => { recFetch = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recLoadMonths", { configurable: true, get: () => recLoadMonths, set: (v) => { recLoadMonths = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recMonthChange", { configurable: true, get: () => recMonthChange, set: (v) => { recMonthChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recMonthLabel", { configurable: true, get: () => recMonthLabel, set: (v) => { recMonthLabel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recPill", { configurable: true, get: () => recPill, set: (v) => { recPill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recRender", { configurable: true, get: () => recRender, set: (v) => { recRender = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recStatusClick", { configurable: true, get: () => recStatusClick, set: (v) => { recStatusClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recSwitchView", { configurable: true, get: () => recSwitchView, set: (v) => { recSwitchView = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recTextClick", { configurable: true, get: () => recTextClick, set: (v) => { recTextClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recToggleExpand", { configurable: true, get: () => recToggleExpand, set: (v) => { recToggleExpand = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconCheck", { configurable: true, get: () => reconCheck, set: (v) => { reconCheck = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconGetRange", { configurable: true, get: () => reconGetRange, set: (v) => { reconGetRange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconHideAll", { configurable: true, get: () => reconHideAll, set: (v) => { reconHideAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconSetLoading", { configurable: true, get: () => reconSetLoading, set: (v) => { reconSetLoading = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconSetStatus", { configurable: true, get: () => reconSetStatus, set: (v) => { reconSetStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconShowError", { configurable: true, get: () => reconShowError, set: (v) => { reconShowError = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconToggleDebug", { configurable: true, get: () => reconToggleDebug, set: (v) => { reconToggleDebug = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reconUpdateTimeDisplay", { configurable: true, get: () => reconUpdateTimeDisplay, set: (v) => { reconUpdateTimeDisplay = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recordsExportCSV", { configurable: true, get: () => recordsExportCSV, set: (v) => { recordsExportCSV = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "recordsLoad", { configurable: true, get: () => recordsLoad, set: (v) => { recordsLoad = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshTabLockUI", { configurable: true, get: () => refreshTabLockUI, set: (v) => { refreshTabLockUI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reloadCurrent", { configurable: true, get: () => reloadCurrent, set: (v) => { reloadCurrent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTabs", { configurable: true, get: () => renderTabs, set: (v) => { renderTabs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpBankChanged", { configurable: true, get: () => rqpBankChanged, set: (v) => { rqpBankChanged = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpBankDeselectAll", { configurable: true, get: () => rqpBankDeselectAll, set: (v) => { rqpBankDeselectAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpBankSelectAll", { configurable: true, get: () => rqpBankSelectAll, set: (v) => { rqpBankSelectAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpBuildBankGrid", { configurable: true, get: () => rqpBuildBankGrid, set: (v) => { rqpBuildBankGrid = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpGetParams", { configurable: true, get: () => rqpGetParams, set: (v) => { rqpGetParams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpReset", { configurable: true, get: () => rqpReset, set: (v) => { rqpReset = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpSyncChips", { configurable: true, get: () => rqpSyncChips, set: (v) => { rqpSyncChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpToggle", { configurable: true, get: () => rqpToggle, set: (v) => { rqpToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpToggleBanks", { configurable: true, get: () => rqpToggleBanks, set: (v) => { rqpToggleBanks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpToggleDateAuto", { configurable: true, get: () => rqpToggleDateAuto, set: (v) => { rqpToggleDateAuto = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rqpToggleOptional", { configurable: true, get: () => rqpToggleOptional, set: (v) => { rqpToggleOptional = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveSettings", { configurable: true, get: () => saveSettings, set: (v) => { saveSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showAlertModal", { configurable: true, get: () => showAlertModal, set: (v) => { showAlertModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showBlocked", { configurable: true, get: () => showBlocked, set: (v) => { showBlocked = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "statusToggle", { configurable: true, get: () => statusToggle, set: (v) => { statusToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitModalClose", { configurable: true, get: () => submitModalClose, set: (v) => { submitModalClose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitModalViewRecords", { configurable: true, get: () => submitModalViewRecords, set: (v) => { submitModalViewRecords = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchCfgTab", { configurable: true, get: () => switchCfgTab, set: (v) => { switchCfgTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovApplyLock", { configurable: true, get: () => tcovApplyLock, set: (v) => { tcovApplyLock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovBackfillHour", { configurable: true, get: () => tcovBackfillHour, set: (v) => { tcovBackfillHour = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovClosePopover", { configurable: true, get: () => tcovClosePopover, set: (v) => { tcovClosePopover = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovDeleteDup", { configurable: true, get: () => tcovDeleteDup, set: (v) => { tcovDeleteDup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovLoad", { configurable: true, get: () => tcovLoad, set: (v) => { tcovLoad = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovRender", { configurable: true, get: () => tcovRender, set: (v) => { tcovRender = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovShowDupPopover", { configurable: true, get: () => tcovShowDupPopover, set: (v) => { tcovShowDupPopover = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tcovUpdateBadge", { configurable: true, get: () => tcovUpdateBadge, set: (v) => { tcovUpdateBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleJenkinsDebug", { configurable: true, get: () => toggleJenkinsDebug, set: (v) => { toggleJenkinsDebug = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleRundeckGuide", { configurable: true, get: () => toggleRundeckGuide, set: (v) => { toggleRundeckGuide = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateDebugInfo", { configurable: true, get: () => updateDebugInfo, set: (v) => { updateDebugInfo = v; } }); } catch (e) {}
})();
