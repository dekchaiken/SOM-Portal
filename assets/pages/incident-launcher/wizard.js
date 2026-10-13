/* ══════════════════════════════════════════════════════════
   Incident Launcher Wizard — ILW
   Full-screen step-by-step modal, replaces Guided/Express
   ══════════════════════════════════════════════════════════ */

const ILW = (() => {
  'use strict';

  /* ── State ─────────────────────────────────────────────── */
  let _inc          = {};    // current incident data
  let _cfg          = {};    // launcher config
  let _case         = null;  // active case object (or null = custom)
  let _step         = 0;     // current step index
  let _stepMeta     = {};    // {stepId: {state:'pending'|'running'|'done'|'skip'|'error', detail}}
  let _maLog        = [];    // [{id,name,type,ts}]
  let _ticket       = null;  // Jira ticket key after step 3
  let _sentFlags    = {};    // {channelId: 'alert'|'resolved'|'copy'}
  let _tl           = [];    // timeline log entries
  let _busy         = false; // transition guard
  let _channels     = [];    // notify_channels from config
  let _ilwThreadKey = null;  // Google Chat thread key for Step 1→2 threading

  /* ── Step definitions ──────────────────────────────────── */
  const STEPS = [
    { id:'notify',      icon:'send',            label:'แจ้งช่องทาง',             desc:'ส่งข้อความแจ้งทีมก่อน → สร้าง thread ใน Chat',   type:'manual', canSkip:true  },
    { id:'meet',        icon:'video',          label:'Open War Room',          desc:'เปิด Meet + reply Meet link ต่อ thread Step 1',    type:'auto',   canSkip:true  },
    { id:'jira',        icon:'file-text',       label:'Create Jira Ticket',     desc:'กรอก fields + สร้าง Jira ticket → ได้ ticket number', type:'manual', canSkip:false },
    { id:'email',       icon:'mail',            label:'Email Partners',         desc:'ส่ง email แจ้ง partner + front-end team',           type:'manual', canSkip:true  },
    { id:'ma',          icon:'zap',             label:'Maintenance Actions',    desc:'ขึ้น MA หลังได้รับคำสั่ง — Jenkins / Rundeck / Manual', type:'manual', canSkip:true  },
    { id:'ma_log',      icon:'clock',           label:'MA Timestamp Log',       desc:'รายการเวลา MA ทั้งหมดที่บันทึกไว้',                  type:'auto',   canSkip:false },
    { id:'investigate', icon:'search',          label:'Ticket → Investigating', desc:'ดูข้อมูล ticket + กรอก fields + เปลี่ยน status',     type:'manual', canSkip:true  },
    { id:'service_perf',icon:'activity',        label:'Service Performance',    desc:'ดู performance ของ services ที่เกี่ยวข้อง',           type:'auto',   canSkip:true  },
    { id:'impact',      icon:'bar-chart-2',     label:'Impact Summary',         desc:'Query Prometheus — services + บริการที่กระทบทั้งหมด', type:'auto',   canSkip:true  },
  ];

  /* ── Open wizard ───────────────────────────────────────── */
  function open(incident, config, caseObj) {
    try {
      _inc  = incident || {};
      _cfg  = config   || {};
      _case = caseObj  || null;
      _step = 0;
      _stepMeta  = {};
      _maLog     = [];
      _ticket    = null;
      _sentFlags = {};
      _tl        = [];
      _busy          = false;
      _ilwThreadKey  = null;
      _channels      = _cfg.channels || _cfg.notify_channels || [];

      const el = _el('ilw');
      if (!el) { console.error('[ILW] #ilw element not found'); return; }

      el.style.removeProperty('display');
      el.style.setProperty('display', 'flex');
      el.classList.add('ilw--opening');
      console.log('[ILW] opened ok, display=', el.style.display);

      _buildSidebar();
      _renderStep(0, 'r').catch(e => console.error('[ILW] renderStep error:', e));
      _log(`เริ่ม: ${_inc.title || '—'}`);
    } catch(e) {
      console.error('[ILW] open error:', e);
    }
  }

  function close() {
    const el = _el('ilw');
    if (el) el.style.display = 'none';
  }

  /* ── Navigation ────────────────────────────────────────── */
  async function next() {
    if (_busy) return;
    if (_step < STEPS.length - 1) {
      await _goto(_step + 1, 'r');
    } else {
      _showFinish();
    }
  }

  async function prev() {
    if (_busy || _step <= 0) return;
    await _goto(_step - 1, 'l');
  }

  function skip() {
    _setStepMeta(STEPS[_step].id, 'skip', 'ข้าม');
    _log(`ข้าม: ${STEPS[_step].label}`);
    next();
  }

  async function jumpTo(idx) {
    if (_busy || idx === _step) return;
    await _goto(idx, idx > _step ? 'r' : 'l');
  }

  async function _goto(idx, dir) {
    if (_busy) return;
    _busy = true;

    const area    = _el('ilw-area');
    const oldWrap = area?.querySelector('.ilw-step-wrap');
    if (oldWrap) {
      oldWrap.classList.add(dir === 'r' ? 'exit-l' : 'exit-r');
      await _delay(200);
      oldWrap.remove();
    }

    _step = idx;
    _updateNavDots();
    _updateProgress();
    await _renderStep(_step, dir);
    _busy = false;
  }

  /* ── Sidebar ───────────────────────────────────────────── */
  function _buildSidebar() {
    /* incident card */
    const sev = _inc.severity || 'sev1';
    _html('ilw-sev-badge', `<i data-icon="${sev==='sev1'?'alert-triangle':sev==='sev2'?'alert-circle':'info'}"></i> ${sev.toUpperCase().replace('SEV','SEV ')}`);
    _el('ilw-sev-badge')?.setAttribute('class', `ilw-inc-badge ${sev}`);
    _html('ilw-inc-title', _e(_inc.title || '—'));

    const caseBadgeHtml = _case
      ? `<div class="ilw-case-badge" style="--case-clr:${_e(_case.color||'#6366f1')}">
           <i data-icon="${_e(_case.icon||'zap')}"></i> ${_e(_case.name)}
         </div>` : '';
    _html('ilw-inc-meta', [
      _inc.service  ? `Service: ${_e(_inc.service)}`   : '',
      _inc.time     ? `เวลา: ${_e(_inc.time)}`         : '',
      _inc.reporter ? `โดย: ${_e(_inc.reporter)}`      : '',
    ].filter(Boolean).join('<br>') + caseBadgeHtml);

    /* step nav */
    const nav = _el('ilw-steps-nav');
    if (!nav) return;
    nav.innerHTML = STEPS.map((s, i) => `
      <div class="ilw-step-nav-item ${i===0?'is-active':''}" id="ilw-nav-${i}" onclick="ILW.jumpTo(${i})">
        <div class="ilw-nav-dot ${i===0?'active':'pending'}" id="ilw-dot-${i}">${i+1}</div>
        <div class="ilw-nav-info">
          <div class="ilw-nav-name">${_e(s.label)}</div>
          <div class="ilw-nav-sub" id="ilw-sub-${i}">pending</div>
        </div>
      </div>`).join('');
    _updateProgress();
    if (window.Icons) Icons.replaceAll(nav);
  }

  function _updateNavDots() {
    STEPS.forEach((s, i) => {
      const item = _el(`ilw-nav-${i}`);
      const dot  = _el(`ilw-dot-${i}`);
      const sub  = _el(`ilw-sub-${i}`);
      if (!item) return;
      const meta  = _stepMeta[s.id] || {};
      const state = i === _step ? 'active'
        : meta.state === 'done'  ? 'done'
        : meta.state === 'skip'  ? 'skipped'
        : meta.state === 'error' ? 'error'
        : i < _step             ? 'done'
        : 'pending';
      item.className = `ilw-step-nav-item ${i===_step?'is-active':''} ${state==='done'?'is-done':''}`;
      dot.className  = `ilw-nav-dot ${state}`;
      dot.innerHTML  = state==='done'    ? '<i data-icon="check"></i>'
                     : state==='skipped' ? '<i data-icon="minus"></i>'
                     : state==='error'   ? '<i data-icon="x"></i>'
                     : (i+1);
      if (sub) sub.textContent = meta.detail || (state==='done'?'เสร็จสิ้น':state==='active'?'กำลังดำเนินการ':state==='skipped'?'ข้าม':'pending');
    });
    if (window.Icons) Icons.replaceAll(_el('ilw-steps-nav'));
  }

  function _updateProgress() {
    const pct = _step === 0 ? 0 : Math.round((_step / (STEPS.length-1)) * 100);
    const fill = _el('ilw-prog-fill');
    const ctr  = _el('ilw-step-ctr');
    if (fill) fill.style.width = pct + '%';
    if (ctr)  ctr.textContent  = `Step ${_step+1} / ${STEPS.length}`;
  }

  /* ── Step render ───────────────────────────────────────── */
  async function _renderStep(idx, dir) {
    const step = STEPS[idx];
    const area = _el('ilw-area');
    if (!area) return;

    /* build wrapper — wide steps get more room; iframe steps go full width */
    const wideSteps   = new Set(['email','ma','notify','investigate','service_perf','impact']);
    const iframeSteps = new Set(['service_perf']);
    const wrap = document.createElement('div');
    wrap.className = `ilw-step-wrap enter-${dir}${wideSteps.has(step.id) ? ' ilw-wide' : ''}${iframeSteps.has(step.id) ? ' ilw-iframe-step' : ''}`;
    wrap.innerHTML = `
      <div class="ilw-step-hd">
        <div class="ilw-step-icon"><i data-icon="${step.icon}" style="font-size:22px"></i></div>
        <div class="ilw-step-title">${_e(step.label)}</div>
        <div class="ilw-step-desc">${_e(step.desc)}</div>
      </div>
      <div id="ilw-step-body"></div>`;
    area.appendChild(wrap);
    if (window.Icons) Icons.replaceAll(wrap);

    /* footer buttons */
    const skipBtn = _el('ilw-skip-btn');
    const prevBtn = _el('ilw-prev-btn');
    const nextBtn = _el('ilw-next-btn');
    if (skipBtn) skipBtn.style.display = step.canSkip ? '' : 'none';
    if (prevBtn) prevBtn.style.display = idx > 0 ? '' : 'none';
    if (nextBtn) {
      nextBtn.innerHTML  = idx === STEPS.length-1 ? '<i data-icon="check-circle"></i> เสร็จสิ้น' : 'ถัดไป <i data-icon="chevron-right"></i>';
      nextBtn.disabled   = step.type === 'auto';
      if (window.Icons) Icons.replaceAll(nextBtn);
    }

    const body = _el('ilw-step-body');

    if (step.type === 'auto') {
      _setStepMeta(step.id, 'running', 'กำลังดำเนินการ…');
      _updateNavDots();
      try {
        await _autoHandlers[step.id]?.(body);
        _setStepMeta(step.id, 'done', 'เสร็จสิ้น');
      } catch(e) {
        _setStepMeta(step.id, 'error', e?.message || 'error');
        if (body) body.innerHTML = `<div class="ilw-auto-center" style="color:#ef4444"><i data-icon="alert-circle" style="font-size:32px"></i><div>${_e(e?.message||'เกิดข้อผิดพลาด')}</div></div>`;
        if (window.Icons) Icons.replaceAll(body);
      }
      _updateNavDots();
      if (nextBtn) nextBtn.disabled = false;
    } else {
      _manualRenderers[step.id]?.(body);
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  function _setStepMeta(id, state, detail) {
    _stepMeta[id] = { state, detail };
  }

  /* ══════════════════════════════════════════════════════════
     AUTO STEP HANDLERS
  ══════════════════════════════════════════════════════════ */
  const _autoHandlers = {

    /* STEP 1: Meet */
    async meet(body) {
      const rawUrl  = (_cfg.meet_main_url || '').trim();
      const isMeet  = rawUrl.startsWith('https://meet.google.com/') || !rawUrl;
      const meetUrl = isMeet ? (rawUrl || 'https://meet.google.com/new') : 'https://meet.google.com/new';

      if (rawUrl && !isMeet) {
        body.innerHTML = `
          <div class="ilw-auto-center" style="color:#ef4444;gap:12px">
            <i data-icon="alert-circle" style="font-size:30px"></i>
            <div style="font-size:14px;font-weight:700">URL ในช่อง "Meet URL" ไม่ถูกต้อง</div>
            <div style="font-size:12px;color:var(--text-muted);max-width:420px;text-align:center">
              ตรวจพบ URL ที่ไม่ใช่ Google Meet:<br>
              <code style="font-size:10px;word-break:break-all">${_e(rawUrl.slice(0,80))}…</code><br><br>
              ไปที่ <strong>Admin → Step 1</strong> แล้วใส่ URL ให้ถูกต้อง เช่น<br>
              <code>https://meet.google.com/abc-xxxx-xyz</code>
            </div>
            <a href="admin/incident-launcher-config.html" target="_blank" class="ilwb ilwb--primary">
              <i data-icon="settings"></i> ไปแก้ Admin Config
            </a>
          </div>`;
        if (window.Icons) Icons.replaceAll(body);
        return;
      }

      const channelIds  = _cfg.meet_channel_ids || [];
      const hasChatCfg  = channelIds.length > 0;
      const channels    = (_cfg.channels || []).filter(c => channelIds.includes(c.id));
      const defaultTpl  = `🚨 SOS: {title}\n\nWar Room: {meet_link}\n\nทีม SM กำลัง investigate — โปรดเข้าร่วมด่วน`;
      const msgTpl      = _cfg.meet_msg_tpl || defaultTpl;

      body.innerHTML = `
        <div class="ilw-meet-single" id="ilw-meet-card">
          <div class="ilw-meet-single-icon"><i data-icon="video" style="font-size:36px;color:#6366f1"></i></div>
          <div class="ilw-meet-single-name">War Room — ห้องใหญ่ (Main Room)</div>
          <div class="ilw-meet-single-url">${_e(meetUrl)}</div>
          <div class="ilw-meet-single-status" id="ilw-meet-status">คลิกปุ่มด้านล่างเพื่อเปิดห้อง</div>
          <a href="${_e(meetUrl)}" target="_blank" rel="noopener" class="ilwb ilwb--primary ilw-meet-open-btn"
            id="ilw-meet-open-btn"
            onclick="ILW._meetOpened('${_e(meetUrl)}')">
            <i data-icon="external-link"></i> เปิดห้อง${_ilwThreadKey ? ' + Reply Meet link ใน thread' : ' + ส่ง Meet link'}
          </a>
        </div>

        <div class="ilw-meet-chat-preview" id="ilw-meet-chat-preview" ${(!hasChatCfg&&!_ilwThreadKey)?'style="display:none"':''}>
          <div class="ilw-meet-chat-preview-hd">
            <i data-icon="${_ilwThreadKey?'corner-down-right':'message-square'}"></i>
            ${_ilwThreadKey
              ? `Reply ใน <strong>thread เดิม</strong> จาก Step 1 (${channels.length || Object.keys(_sentFlags).length} channel)`
              : `จะส่งไปยัง ${channels.map(c=>`<strong>${_e(c.name)}</strong>`).join(', ')}`}
          </div>
          <pre class="ilw-meet-chat-msg">${_ilwThreadKey
            ? _e('📹 War Room เปิดแล้ว — เข้าประชุมได้เลย\n' + meetUrl)
            : _e((_fillTpl(msgTpl)).replace(/\{meet_link\}/g, meetUrl))}</pre>
        </div>
        <div class="ilw-meet-chat-sent" id="ilw-meet-chat-sent" style="display:none">
          <i data-icon="check-circle"></i>
          ${_ilwThreadKey ? 'Reply Meet link ใน thread เดิมสำเร็จ' : 'ส่ง Chat สำเร็จแล้ว'}
        </div>
        ${!hasChatCfg && !_ilwThreadKey ? `
        <div class="ilw-hint" style="margin-top:16px">
          <i data-icon="info"></i>
          ยังไม่ได้ตั้งค่า channel — ไปที่ Admin → Step 1 เพื่อเลือก channel ที่จะส่ง Meet link
        </div>` : ''}`;

      if (window.Icons) Icons.replaceAll(body);
      _log('เตรียม War Room: ' + meetUrl);
    },

    /* (Step 3 Jira is now manual — handled by _manualRenderers.jira) */
    /* (Step 4 Email is now manual — handled by _manualRenderers.email) */

    /* STEP 6: MA Log */
    async ma_log(body) {
      if (!_maLog.length) {
        body.innerHTML = `<div class="ilw-auto-center"><div class="ilw-done-icon"><i data-icon="info" style="font-size:26px"></i></div><div style="font-size:13px;color:var(--text-muted)">ไม่มี MA action ที่บันทึก</div></div>`;
        if (window.Icons) Icons.replaceAll(body);
        return;
      }
      body.innerHTML = `
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:14px">
          MA Timestamp Log — <span style="color:#6366f1">${_maLog.length}</span> actions
        </div>
        <div class="ilw-malog">
          ${_maLog.map((m,i)=>`
            <div class="ilw-malog-row" style="animation-delay:${i*55}ms">
              <div class="ilw-malog-time">${_e(m.ts)}</div>
              <div class="ilw-malog-name">${_e(m.name)}</div>
              <div class="ilw-malog-type">${_e(m.type||'manual')}</div>
            </div>`).join('')}
        </div>`;
      if (window.Icons) Icons.replaceAll(body);
    },

    /* STEP 8: Service Performance — embeds full SP page via iframe */
    async service_perf(body) {
      const svcs = _cfg.sp_services || ['tmn-mobile-gateway','mobile-auth-service','core-service','wallet-payment-service','vas-service'];
      const first = svcs[0];
      _spCurrent = first;
      body.innerHTML = `
        <div class="ilw-sp-card-row" id="ilw-sp-tabs">
          ${svcs.map((s,i) => `
            <button class="ilw-sp-svc-card${i===0?' active':''}" id="ilw-sp-tab-${_e(s)}"
              onclick="ILW._spSelect('${_e(s)}')">
              <div class="ilw-sp-svc-ico"><i data-icon="activity"></i></div>
              <div class="ilw-sp-svc-body">
                <div class="ilw-sp-svc-name">${_e(s)}</div>
                <div class="ilw-sp-svc-sub">Service Performance</div>
              </div>
            </button>`).join('')}
          <a href="service-performance.html?service=${encodeURIComponent(first)}" target="_blank"
             id="ilw-sp-newpage" rel="noopener" class="ilw-sp-svc-card ilw-sp-svc-card--link" style="border-style:dashed">
            <div class="ilw-sp-svc-ico" style="color:#6366f1;background:rgba(99,102,241,.1)"><i data-icon="external-link"></i></div>
            <div class="ilw-sp-svc-body">
              <div class="ilw-sp-svc-name" style="color:#6366f1">เปิดหน้าเต็ม</div>
              <div class="ilw-sp-svc-sub">New tab</div>
            </div>
          </a>
        </div>
        <div class="ilw-sp-iframe-wrap">
          <iframe id="ilw-sp-frame"
            src="service-performance.html?service=${encodeURIComponent(first)}&wizard=1"
            class="ilw-sp-iframe" frameborder="0" loading="lazy">
          </iframe>
        </div>`;
      if (window.Icons) Icons.replaceAll(body);
      _log('Service Performance embedded');
    },

    /* STEP 9: Impact Summary */
    async impact(body) {
      body.innerHTML = `<div class="ilw-auto-center"><div class="ilw-spinner"></div><div class="ilw-auto-lbl">กำลัง query Prometheus (4 layers)…</div></div>`;
      const from  = _inc.time || new Date(Date.now()-3600000).toISOString().slice(0,16);
      const toIso = new Date().toISOString();
      try {
        const r  = await API.get(`/incident-launcher/index.php?action=impact_summary&from=${encodeURIComponent(from)}&to=${encodeURIComponent(toIso)}`);
        const rd = r?.data || {};
        const layers = rd.layers || {};
        const sum    = rd.summary || {};
        const sev    = rd.severity || 'low';
        const sevCol = { critical:'#ef4444', high:'#f59e0b', medium:'#3b82f6', low:'#6b7280' }[sev];

        body.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:18px">
            <span style="padding:4px 12px;border-radius:20px;border:1px solid ${sevCol}40;background:${sevCol}18;color:${sevCol};font-size:11px;font-weight:800">${sev.toUpperCase()}</span>
            ${sum.total_http_5xx>0?`<span style="padding:3px 9px;border-radius:6px;background:rgba(239,68,68,.08);color:#ef4444;font-size:11px;font-weight:600"><i data-icon="x-circle"></i> ${Math.round(sum.total_http_5xx).toLocaleString()} HTTP 5xx</span>`:''}
            ${sum.total_restarts>0?`<span style="padding:3px 9px;border-radius:6px;background:rgba(245,158,11,.08);color:#f59e0b;font-size:11px;font-weight:600"><i data-icon="refresh-cw"></i> ${Math.round(sum.total_restarts)} restarts</span>`:''}
            ${sum.total_bank_errors>0?`<span style="padding:3px 9px;border-radius:6px;background:rgba(99,102,241,.08);color:#6366f1;font-size:11px;font-weight:600"><i data-icon="credit-card"></i> ${Math.round(sum.total_bank_errors).toLocaleString()} bank errors</span>`:''}
          </div>
          ${_renderBizGroups(rd.business_impact||[])}
          ${_renderImpactTable('Bank Errors', (layers.banking||[]).map(b=>({ name:b.bankName||b.bankCode, cnt:Math.round(b.errors||0).toLocaleString(), url:b.exploreUrl })))}
          ${_renderImpactTable('HTTP 5xx', (layers.http_errors||[]).slice(0,8).map(s=>({ name:s.app_name, cnt:Math.round(s.http_5xx||0).toLocaleString(), url:s.exploreUrl })))}`;
        if (window.Icons) Icons.replaceAll(body);
        _log(`Impact: ${sev} · ${Math.round(sum.total_http_5xx||0)} 5xx · ${Math.round(sum.total_bank_errors||0)} bank errors`);
      } catch(e) {
        throw new Error(`Query ไม่สำเร็จ: ${e?.message||''}`);
      }
    },
  };

  function _renderBizGroups(biz) {
    if (!biz.length) return '';
    return `<div style="margin-bottom:16px">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:9px">Business Services Impacted</div>
      <div class="ilw-impact-biz-groups">
        ${biz.map(g=>`
          <div class="ilw-impact-biz-row">
            <div class="ilw-impact-biz-cat">${_e(g.category)}</div>
            <div class="ilw-impact-chips">${(g.services||[]).map(s=>`<span class="ilw-impact-chip">${_e(s)}</span>`).join('')}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  function _renderImpactTable(title, rows) {
    if (!rows.length) return '';
    return `<div style="margin-bottom:14px">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:7px">${_e(title)}</div>
      <div class="ilw-impact-table">
        ${rows.map(r=>`
          <div class="ilw-impact-trow">
            <div class="ilw-impact-trow-name">${_e(r.name)}</div>
            <div class="ilw-impact-trow-cnt">${_e(r.cnt)}</div>
            ${r.url?`<a href="${_e(r.url)}" target="_blank" rel="noopener" class="ilw-impact-trow-lnk"><i data-icon="bar-chart-2"></i></a>`:''}
          </div>`).join('')}
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     MANUAL STEP RENDERERS
  ══════════════════════════════════════════════════════════ */
  const _manualRenderers = {

    /* STEP 2: Notify */
    notify(body) {
      if (!_channels.length) {
        body.innerHTML = `<div class="ilw-auto-center" style="color:#f59e0b"><i data-icon="info" style="font-size:28px"></i><div>ยังไม่มี channels — <a href="admin/incident-launcher-config.html">ตั้งค่าที่ Admin</a></div></div>`;
        if (window.Icons) Icons.replaceAll(body);
        return;
      }
      body.innerHTML = `
        <div class="ilw-channels" id="ilw-ch-wrap">
          ${_channels.map(ch=>_buildChannelCard(ch)).join('')}
        </div>
        <div class="ilw-resolved-row" id="ilw-resolved-row" style="${_hasAnySent()?'':'display:none'}">
          <span class="ilw-resolved-label"><i data-icon="check-circle"></i> แจ้งครบแล้ว — ต้องการส่ง "กลับมาปกติ" ด้วยไหม?</span>
          <button class="ilwb ilwb--success" onclick="ILW._notifyResolved()"><i data-icon="check-circle"></i> Notify กลับปกติ</button>
        </div>
        <div class="ilw-hint"><i data-icon="info"></i> เมื่อแจ้งครบแล้ว กด <strong>ถัดไป</strong></div>`;
      if (window.Icons) Icons.replaceAll(body);
    },

    /* STEP 4: Email compose form */
    email(body) {
      const groups   = _cfg.partner_groups || [];
      const defaults = _cfg.default_partners || [];

      // Collect To/CC/BCC from separate per-group lists (+ legacy flat emails → to)
      const _grpTo  = g => g.to_emails || (g.emails || []);
      const _grpCc  = g => g.cc_emails  || [];
      const _grpBcc = g => g.bcc_emails || [];
      const toEmails  = [...new Set([...groups.flatMap(_grpTo),  ...defaults].filter(e=>e?.includes('@')))];
      const ccEmails  = [...new Set(groups.flatMap(_grpCc).filter(e=>e?.includes('@')))];
      const bccEmails = [...new Set(groups.flatMap(_grpBcc).filter(e=>e?.includes('@')))];

      if (!toEmails.length && !ccEmails.length) {
        body.innerHTML = `<div class="ilw-auto-center" style="color:#f59e0b">
          <i data-icon="info" style="font-size:28px"></i>
          <div>ยังไม่มี partner email<br>
          <a href="admin/incident-launcher-config.html" target="_blank" style="font-size:12px;color:var(--accent,#f26419)">ตั้งค่า Partner Groups ที่ Admin</a></div>
        </div>`;
        if (window.Icons) Icons.replaceAll(body);
        return;
      }

      const now     = new Date();
      const bkkNow  = new Date(now.getTime() + 7*60*60*1000);
      const dateStr = bkkNow.toISOString().slice(0,10).split('-').reverse().join('/');
      const timeStr = bkkNow.toISOString().slice(11,16);
      const vars    = { ticket: _ticket||'', title: _inc.title||'', service: _inc.service||'', date: dateStr, time: timeStr };
      const _fill   = tpl => (tpl||'').replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

      const tpl      = _cfg.email_template || {};
      const defSubj  = `[${vars.ticket||'Ticket'}] [Event Open] : แจ้งให้ทราบ ระบบ ${vars.service||vars.title} ไม่สามารถใช้งานได้ในขณะนี้ค่ะ`;
      const defBody  = `เรียน ทีมงานที่เกี่ยวข้อง\n\nเนื่องจากวันที่ ${dateStr} เวลา ${timeStr} - ปัจจุบัน ทาง TrueMoney แจ้งให้ทราบว่าตอนนี้ ระบบ ${vars.service||vars.title} ไม่สามารถใช้งานได้ขณะนี้ เบื้องต้นทีมงานได้ดำเนินการประสานงานทีมที่เกี่ยวข้องตรวจสอบแล้ว\n\nหากมีอะไรคืบหน้าจะแจ้งให้ทราบอีกครั้ง ขออภัยในความไม่สะดวก ขอบคุณครับ\n\nBest regards,`;
      const initSubj = tpl.subject ? _fill(tpl.subject) : defSubj;
      const initBody = tpl.body    ? _fill(tpl.body)    : defBody;

      const totalTo  = toEmails.length;
      const chipRow  = (emails, extra='') => emails.map(e=>`<span class="ilw-email-chip">${_e(e)}</span>`).join('') + extra;

      body.innerHTML = `
        <div class="ilw-email-compose">
          <!-- To -->
          <div class="ilw-email-field">
            <span class="ilw-email-label">ถึง</span>
            <div class="ilw-email-to-chips" id="ilw-email-to">
              ${chipRow(toEmails, `<input class="ilw-email-extra-input" id="ilw-email-to-extra" placeholder="เพิ่ม email คั่นด้วย , …" title="เพิ่ม email ใน To">`)}
            </div>
          </div>
          <!-- CC -->
          <div class="ilw-email-field">
            <span class="ilw-email-label" style="color:#6366f1">CC</span>
            <div class="ilw-email-to-chips" id="ilw-email-cc">
              ${chipRow(ccEmails, `<input class="ilw-email-extra-input" id="ilw-email-cc-extra" placeholder="เพิ่ม email สำเนา …">`)}
            </div>
          </div>
          <!-- BCC -->
          <div class="ilw-email-field">
            <span class="ilw-email-label" style="color:#6b7280">BCC</span>
            <div class="ilw-email-to-chips" id="ilw-email-bcc">
              ${chipRow(bccEmails, `<input class="ilw-email-extra-input" id="ilw-email-bcc-extra" placeholder="เพิ่ม email สำเนาซ่อน …">`)}
            </div>
          </div>
          <!-- Subject -->
          <div class="ilw-email-field">
            <span class="ilw-email-label">เรื่อง</span>
            <input id="ilw-email-subj" class="ilw-email-subj-input" type="text" value="${_e(initSubj)}">
          </div>
          <div class="ilw-email-body-wrap">
            <textarea id="ilw-email-body" class="ilw-email-body-ta" rows="10">${_e(initBody)}</textarea>
          </div>
          <div class="ilw-email-actions">
            <button class="ilwb ilwb--primary" id="ilw-email-send-btn" onclick="ILW._sendEmail()">
              <i data-icon="send"></i> ส่ง Email (${totalTo} To${ccEmails.length?` · ${ccEmails.length} CC`:''}${bccEmails.length?` · ${bccEmails.length} BCC`:''})
            </button>
            <span id="ilw-email-status" style="font-size:12px;color:var(--text-muted)"></span>
          </div>
          <div class="ilw-hint"><i data-icon="info"></i> ตรวจสอบและแก้ไขก่อนกดส่ง — เพิ่ม email พิเศษได้ในช่อง To / CC / BCC</div>
        </div>`;
      if (window.Icons) Icons.replaceAll(body);
    },

    /* STEP 5: MA */
    ma(body) {
      const jobs = (_cfg.ma_jobs||[]).filter(j=>j.enabled!==false);
      if (!jobs.length) {
        body.innerHTML = `<div class="ilw-auto-center" style="color:#f59e0b"><i data-icon="info" style="font-size:28px"></i><div>ยังไม่มี MA jobs — <a href="admin/incident-launcher-config.html">ตั้งค่าที่ Admin</a></div></div>`;
        if (window.Icons) Icons.replaceAll(body);
        return;
      }
      body.innerHTML = `
        <div class="ilw-ma-list" id="ilw-ma-list">
          ${jobs.map(j=>_buildMaCard(j)).join('')}
        </div>
        <div class="ilw-hint"><i data-icon="info"></i> กด Mark Done หลังขึ้น MA แต่ละอัน — ระบบบันทึกเวลาให้อัตโนมัติ</div>`;
      if (window.Icons) Icons.replaceAll(body);
    },

    /* STEP 3: Jira create form */
    async jira(body) {
      body.innerHTML = `<div class="ilw-auto-center"><div class="ilw-spinner"></div><div class="ilw-auto-lbl">กำลังโหลด Jira field options…</div></div>`;

      /* resolve severity — admin default or launch-form value */
      const sev      = _inc.severity || _cfg.jira_default_severity || 'sev1';
      const sevLabel = { sev1:'Critical (Sev1)', sev2:'Major (Sev2)', sev3:'Minor (Sev3)' }[sev] || sev;
      const sevNum   = sev.replace('sev','SEV ');

      /* summary — from admin template or fallback */
      const _fillVar = (tpl, extra = {}) => (tpl || '').replace(/\{(\w+)\}/g, (_, k) => ({
        sev: sevNum, title: _inc.title || 'Incident', service: _inc.service || '-',
        severity_label: sevLabel, time: _inc.time || '', description: _inc.description || '',
        ...extra,
      })[k] ?? '');

      const summary = _cfg.jira_summary_tpl
        ? _fillVar(_cfg.jira_summary_tpl)
        : `[${sevNum}] ${_inc.title || 'Incident'}`;

      const faultDt = _inc.time || _toBkk(new Date());

      /* description — from admin template or fallback */
      const defaultDescTpl = `Service: {service}\nSeverity: {severity_label}\nเวลาเริ่มต้น: {time}\n\n{description}`;
      const descVal = _fillVar(_cfg.jira_desc_tpl || defaultDescTpl);

      /* detected by — from admin config or fallback */
      const defaultDetectedBy = _cfg.jira_detected_by || 'Service Monitoring (SM)';

      const r = await API.get('/jira/field-options.php');
      _jiraFieldOpts = r?.data?.data || {};

      /* pre-populate from admin field defaults */
      const fd = _cfg.jira_field_defaults || {};
      _jiraMulti  = {
        bu:  Array.isArray(fd.bu)  ? [...fd.bu]  : [],
        svc: Array.isArray(fd.svc) ? [...fd.svc] : [],
        chn: Array.isArray(fd.chn) ? [...fd.chn] : [],
      };
      _jiraSingle = {
        detected: fd.detected    || defaultDetectedBy,
        '3rd':    fd.third_party || '',
      };

      /* preset fields from admin config — skip fields already handled by the standard form */
      const STANDARD_FIELD_IDS = new Set([
        'customfield_17031', // TH Severity (dropdown)
        'customfield_17066', // Business Unit Impacted (typeahead)
        'customfield_17024', // TH Service Impacted (typeahead)
        'customfield_17023', // TH Channel / Component (typeahead)
        'customfield_17016', // Detected by (typeahead)
        'customfield_17238', // Caused by 3rd Party (typeahead)
        'customfield_17026', // Fault Start (datetime)
      ]);
      const presetFields = (_cfg.jira_preset_fields || []).filter(f => f.field_id && !STANDARD_FIELD_IDS.has(f.field_id));
      const presetSection = presetFields.length ? `
        <div class="ilw-ct-preset-section">
          <div class="ilw-ct-preset-hd">
            <i data-icon="settings"></i> Preset Fields (ตั้งค่าจาก Admin Config)
            <span class="ilw-ct-preset-count">${presetFields.length} fields</span>
          </div>
          <div class="ilw-ct-preset-grid">
            ${presetFields.map(f => `
              <div class="ilw-ct-preset-field">
                <label class="ilw-ct-label" title="${_e(f.field_id)}">${_e(f.label || f.field_id)}</label>
                <input type="text" id="ilw-ct-pf-${_e(f.field_id)}"
                  class="ilw-ct-input ilw-ct-preset-input"
                  value="${_e(f.value)}"
                  placeholder="${_e(f.field_id)}">
              </div>`).join('')}
          </div>
        </div>` : '';

      body.innerHTML = `
        <div class="ilw-ct-form">
          <!-- Summary -->
          <div class="ilw-ct-grid-1">
            <label class="ilw-ct-label ilw-ct-req">Summary</label>
            <input type="text" id="ilw-ct-summary" class="ilw-ct-input" value="${_e(summary)}" placeholder="หัวข้อปัญหา (สั้น กระชับ)">
          </div>

          <!-- TH Severity + Fault Start -->
          <div class="ilw-ct-grid-2">
            <div>
              <label class="ilw-ct-label ilw-ct-req">TH Severity</label>
              <select id="ilw-ct-severity" class="ilw-ct-select">
                <option value="Severity 1" ${sev==='sev1'?'selected':''}>Severity 1</option>
                <option value="Severity 2" ${sev==='sev2'?'selected':''}>Severity 2</option>
                <option value="Severity 3" ${sev==='sev3'?'selected':''}>Severity 3</option>
              </select>
              ${_cfg.jira_default_severity ? `<span style="font-size:10px;color:var(--text-muted);margin-top:3px;display:block">default จาก admin config</span>` : ''}
            </div>
            <div>
              <label class="ilw-ct-label ilw-ct-req">Fault Start (Date &amp; Time)</label>
              <div class="ilw-ct-fault-row">
                <select id="ilw-ct-fault-mode" class="ilw-ct-select" onchange="ILW._jiraFaultMode()">
                  <option value="auto">Auto (current time)</option>
                  <option value="manual" ${faultDt?'selected':''}>Manual input</option>
                </select>
                <input type="datetime-local" id="ilw-ct-fault-dt" class="ilw-ct-input" value="${_e(faultDt)}" ${faultDt?'':'disabled'}>
              </div>
            </div>
          </div>

          <!-- Business Unit Impacted -->
          <div class="ilw-ct-grid-1">
            <label class="ilw-ct-label ilw-ct-req">Business Unit Impacted</label>
            <div class="ilw-ct-multi" data-ilw-ta="multi" data-ilw-key="bu">
              <input type="text" class="ilw-ct-typeahead" placeholder="พิมพ์เพื่อค้นหาแล้วคลิกเพื่อเพิ่ม…" autocomplete="off">
              <div class="ilw-ct-dropdown"></div>
            </div>
          </div>

          <!-- TH Service Impacted -->
          <div class="ilw-ct-grid-1">
            <label class="ilw-ct-label ilw-ct-req">TH Service Impacted</label>
            <div class="ilw-ct-multi" data-ilw-ta="multi" data-ilw-key="svc">
              <input type="text" class="ilw-ct-typeahead" placeholder="พิมพ์เพื่อค้นหาแล้วคลิกเพื่อเพิ่ม…" autocomplete="off">
              <div class="ilw-ct-dropdown"></div>
            </div>
          </div>

          <!-- TH Channel / Component -->
          <div class="ilw-ct-grid-1">
            <label class="ilw-ct-label ilw-ct-req">TH Channel / Component</label>
            <div class="ilw-ct-multi" data-ilw-ta="multi" data-ilw-key="chn">
              <input type="text" class="ilw-ct-typeahead" placeholder="พิมพ์เพื่อค้นหาแล้วคลิกเพื่อเพิ่ม…" autocomplete="off">
              <div class="ilw-ct-dropdown"></div>
            </div>
          </div>

          <!-- Detected by / 3rd Party -->
          <div class="ilw-ct-grid-2">
            <div>
              <label class="ilw-ct-label ilw-ct-req">Detected by</label>
              <div class="ilw-ct-single has-value" data-ilw-ta="single" data-ilw-key="detected">
                <input type="text" class="ilw-ct-typeahead" value="${_e(defaultDetectedBy)}" autocomplete="off">
                <div class="ilw-ct-dropdown"></div>
              </div>
            </div>
            <div>
              <label class="ilw-ct-label">Caused by 3rd Party <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
              <div class="ilw-ct-single" data-ilw-ta="single" data-ilw-key="3rd">
                <input type="text" class="ilw-ct-typeahead" placeholder="พิมพ์เพื่อค้นหา (ไม่กรอกได้)" autocomplete="off">
                <div class="ilw-ct-dropdown"></div>
              </div>
            </div>
          </div>

          <!-- Description -->
          <div class="ilw-ct-grid-1">
            <label class="ilw-ct-label">Description / Action</label>
            <textarea id="ilw-ct-desc" class="ilw-ct-textarea">${_e(descVal)}</textarea>
          </div>

          ${presetSection}

          <!-- Submit -->
          <div class="ilw-ct-submit-row">
            <button class="ilwb ilwb--primary" id="ilw-ct-submit-btn" onclick="ILW._submitJira()">
              <i data-icon="file-text"></i> สร้าง Jira Ticket
            </button>
          </div>
        </div>`;
      if (window.Icons) Icons.replaceAll(body);
      _jiraInitTypeaheads(body);

      /* render pre-selected chips from admin defaults */
      ['bu','svc','chn'].forEach(k => _jiraRenderChips(k));
      /* set single detected-by value */
      _jiraSetSingle('detected', _jiraSingle.detected);
      if (_jiraSingle['3rd']) _jiraSetSingle('3rd', _jiraSingle['3rd']);
    },

    /* STEP 7: Investigate — show all available transitions */
    async investigate(body) {
      if (!_ticket) {
        body.innerHTML = `
          <div class="ilw-inv-no-ticket">
            <div class="ilw-inv-no-ticket-icon"><i data-icon="ticket" style="font-size:28px;color:var(--text-muted)"></i></div>
            <div class="ilw-inv-no-ticket-title">ยังไม่มี Jira ticket จาก Step 3</div>
            <div class="ilw-inv-no-ticket-sub">กรอก ticket key ที่มีอยู่แล้ว เพื่อ transition ได้เลย</div>
            <div class="ilw-inv-manual-input">
              <input id="ilw-inv-manual-key" class="ilw-ct-input" type="text"
                placeholder="เช่น SMC-10483" style="max-width:200px;text-transform:uppercase"
                oninput="this.value=this.value.toUpperCase()"
                onkeydown="if(event.key==='Enter')ILW._invLoadManual()">
              <button class="ilwb ilwb--primary" onclick="ILW._invLoadManual()">
                <i data-icon="search"></i> โหลด Ticket
              </button>
            </div>
          </div>`;
        if (window.Icons) Icons.replaceAll(body);
        return;
      }
      await _invLoad(body, _ticket);
    },
  };

  /* ── Step 7 state ─────────────────────────────────────── */
  let _invTransitions = [];
  let _invTicket      = null;
  let _invStatus      = '';
  let _invSelectedId  = null;

  /* ── Step 1: Meet opened ──────────────────────────────── */
  async function _meetOpened(meetUrl) {
    /* update card state */
    const card   = _el('ilw-meet-card');
    const status = _el('ilw-meet-status');
    const btn    = _el('ilw-meet-open-btn');
    if (card)   card.classList.add('ready');
    if (status) { status.textContent = 'เปิดแล้ว ✓'; status.style.color = '#22c55e'; }
    if (btn)    { btn.innerHTML = '<i data-icon="loader"></i> กำลังส่ง Meet link…'; btn.disabled=true; if(window.Icons)Icons.replaceAll(btn); }

    /* channels to reply to — prefer Step 1's channels, fallback to meet_channel_ids config */
    const channelIds = _cfg.meet_channel_ids || [];
    const hasSentBefore = Object.keys(_sentFlags).length > 0;

    /* build Meet link reply message */
    const replyMsg = _ilwThreadKey && hasSentBefore
      ? `📹 War Room เปิดแล้ว — เข้าประชุมได้เลย\n${meetUrl}`
      : `🚨 SOS War Room\n\n${meetUrl}`;

    let sentCount = 0;
    /* reply to all channels that already received Step 1 notification */
    const targetChannels = channelIds.length
      ? channelIds
      : Object.keys(_sentFlags); // fallback: channels already sent in step 1

    for (const chId of targetChannels) {
      const ch = (_cfg.channels || []).find(c => c.id === chId);
      if (!ch || ch.platform === 'manual') continue;
      const r = await API.post('/incident-launcher/index.php', {
        action:     'notify_channel',
        channel_id: chId,
        message:    replyMsg,
        thread_key: _ilwThreadKey || undefined,  // reply in thread if key exists
      });
      if (r?.ok) {
        sentCount++;
        _log(`ส่ง Meet link → ${ch.name}${_ilwThreadKey ? ' (reply thread)' : ''}`);
      } else {
        window.showToast?.(`ส่งไม่สำเร็จ: ${ch.name} — ${r?.data?.message||''}`, 'error');
      }
    }

    if (btn) { btn.innerHTML = '<i data-icon="check"></i> เปิดแล้ว'; btn.disabled=false; if(window.Icons)Icons.replaceAll(btn); }

    if (sentCount > 0) {
      window.showToast?.(
        _ilwThreadKey
          ? `Reply Meet link ใน thread เดิม (${sentCount} channel) สำเร็จ`
          : `ส่ง Meet link (${sentCount} channel) สำเร็จ`,
        'success'
      );
      const preview = _el('ilw-meet-chat-preview');
      const sent    = _el('ilw-meet-chat-sent');
      if (preview) preview.style.display = 'none';
      if (sent)    { sent.style.display = ''; if(window.Icons)Icons.replaceAll(sent); }
    }
  }

  function _invChangeTicket() {
    /* reset and show manual input again */
    _ticket = null;
    const body = _el('ilw-step-body');
    if (!body) return;
    body.innerHTML = `
      <div class="ilw-inv-no-ticket">
        <div class="ilw-inv-no-ticket-icon"><i data-icon="ticket" style="font-size:28px;color:var(--text-muted)"></i></div>
        <div class="ilw-inv-no-ticket-title">ระบุ Ticket Key ที่ต้องการ</div>
        <div class="ilw-inv-manual-input">
          <input id="ilw-inv-manual-key" class="ilw-ct-input" type="text"
            placeholder="เช่น SMC-10483" style="max-width:200px;text-transform:uppercase"
            oninput="this.value=this.value.toUpperCase()"
            onkeydown="if(event.key==='Enter')ILW._invLoadManual()">
          <button class="ilwb ilwb--primary" onclick="ILW._invLoadManual()">
            <i data-icon="search"></i> โหลด Ticket
          </button>
        </div>
      </div>`;
    if (window.Icons) Icons.replaceAll(body);
    setTimeout(() => _el('ilw-inv-manual-key')?.focus(), 50);
  }

  async function _invLoadManual() {
    const input = _el('ilw-inv-manual-key');
    const key   = input?.value?.trim().toUpperCase();
    if (!key || !/^[A-Z]+-\d+$/.test(key)) {
      window.showToast?.('กรุณาระบุ ticket key เช่น SMC-10483', 'warn');
      return;
    }
    _ticket = key; // set global ticket so later steps work
    const body = _el('ilw-step-body');
    if (body) {
      body.innerHTML = `<div class="ilw-auto-center"><div class="ilw-spinner"></div><div class="ilw-auto-lbl">กำลังโหลด ${key}…</div></div>`;
    }
    await _invLoad(body, key);
  }

  async function _invLoad(body, ticketKey) {
    if (!body) body = _el('ilw-step-body');
    if (!body) return;
    body.innerHTML = `<div class="ilw-auto-center"><div class="ilw-spinner"></div><div class="ilw-auto-lbl">กำลังดึง transitions จาก Jira…</div></div>`;

    const [tr, ir] = await Promise.all([
      API.get(`/incident-launcher/index.php?action=jira_transitions&key=${encodeURIComponent(ticketKey)}`),
      API.get(`/incident-launcher/index.php?action=jira_issue&key=${encodeURIComponent(ticketKey)}`).catch(()=>({})),
    ]);

    if (!tr?.ok) {
      body.innerHTML = `<div class="ilw-auto-center" style="color:#ef4444"><i data-icon="alert-circle" style="font-size:28px"></i><div>${_e(tr?.data?.message||'ดึงข้อมูล Jira ไม่สำเร็จ')}</div></div>`;
      if (window.Icons) Icons.replaceAll(body);
      return;
    }

    const transitions   = tr?.data?.transitions || [];
    const issue         = ir?.data?.issue || {};
    const currentStatus = issue.status || 'Open';
    const STATUS_COLOR  = {
      'open':'#6b7280','new':'#6b7280',
      'investigating':'#f59e0b','in progress':'#f59e0b',
      'pending':'#3b82f6','waiting':'#3b82f6',
      'resolved':'#22c55e','done':'#22c55e','closed':'#22c55e',
      'escalate':'#ef4444','escalated':'#ef4444',
    };
    const statusColor = STATUS_COLOR[currentStatus.toLowerCase()] || '#6366f1';

    body.innerHTML = `
      <div class="ilw-ticket-card" style="margin-bottom:18px">
        <div class="ilw-ticket-key">${_e(ticketKey)}</div>
        <div class="ilw-ticket-title">${_e(issue.summary || _inc.title || '—')}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <span class="ilw-inv-status-badge" style="background:${statusColor}18;color:${statusColor};border-color:${statusColor}30">
            <i data-icon="circle" style="font-size:7px"></i> ${_e(currentStatus)}
          </span>
          <button class="ilw-inv-change-ticket" onclick="ILW._invChangeTicket()" title="เปลี่ยน Ticket">
            <i data-icon="edit-2"></i> เปลี่ยน Ticket
          </button>
          <a href="https://truemoney.atlassian.net/browse/${_e(ticketKey)}"
             target="_blank" rel="noopener" class="ilw-ticket-link" style="margin-left:auto">
            <i data-icon="external-link"></i> เปิดใน Jira
          </a>
        </div>
      </div>

      <div class="ilw-inv-section-hd">
        <i data-icon="git-branch"></i>
        Transitions ที่ทำได้ตอนนี้ (${transitions.length})
      </div>
      ${transitions.length ? `
      <div class="ilw-inv-trans-list" id="ilw-inv-trans-list">
        ${transitions.map(t => `
          <div class="ilw-inv-trans-card" id="ilw-inv-tc-${_e(t.id)}" onclick="ILW._invSelectTrans('${_e(t.id)}')">
            <div class="ilw-inv-trans-from">
              <span class="ilw-inv-status-badge" style="background:${statusColor}18;color:${statusColor};border-color:${statusColor}30">
                ${_e(currentStatus)}
              </span>
            </div>
            <div class="ilw-inv-trans-arrow"><i data-icon="arrow-right"></i></div>
            <div class="ilw-inv-trans-to">
              <span class="ilw-inv-to-name">${_e(t.name)}</span>
            </div>
            ${Object.keys(t.fields||{}).length
              ? `<div class="ilw-inv-trans-fields-tag"><i data-icon="edit-2"></i> กรอก fields</div>`
              : `<div class="ilw-inv-trans-fields-tag ilw-inv-trans-fields-tag--none"><i data-icon="zap"></i> ไม่ต้องกรอก</div>`}
          </div>`).join('')}
      </div>
      <div class="ilw-inv-form-wrap" id="ilw-inv-form-wrap" style="display:none">
        <div class="ilw-inv-form-hd" id="ilw-inv-form-hd"></div>
        <div class="ilw-inv-grid" id="ilw-inv-form"></div>
        <div class="ilw-inv-form-actions">
          <button class="ilwb ilwb--secondary" onclick="ILW._invCancelTrans()">
            <i data-icon="x"></i> ยกเลิก
          </button>
          <button class="ilwb ilwb--success" id="ilw-inv-submit-btn" onclick="ILW._invDoTransition()">
            <i data-icon="arrow-right-circle"></i> Submit Transition
          </button>
        </div>
      </div>`
      : `<div class="ilw-auto-center" style="color:var(--text-muted);margin-top:20px"><i data-icon="info" style="font-size:22px"></i><div>ไม่มี transition ที่ทำได้ตอนนี้</div></div>`}`;

    if (window.Icons) Icons.replaceAll(body);
    _invTransitions = transitions;
    _invTicket      = ticketKey;
    _invStatus      = currentStatus;
  }

  function _invSelectTrans(transId) {
    _invSelectedId = transId;
    const trans = _invTransitions.find(t => t.id === transId);
    if (!trans) return;

    /* highlight selected card */
    document.querySelectorAll('.ilw-inv-trans-card').forEach(c =>
      c.classList.toggle('selected', c.id === `ilw-inv-tc-${transId}`)
    );

    const formWrap = _el('ilw-inv-form-wrap');
    const formHd   = _el('ilw-inv-form-hd');
    const formEl   = _el('ilw-inv-form');
    const submitBtn = _el('ilw-inv-submit-btn');
    if (!formWrap) return;

    const hasFields = Object.keys(trans.fields || {}).length > 0;
    if (formHd) formHd.innerHTML = `
      <i data-icon="arrow-right-circle"></i>
      Transition: <strong>${_e(trans.name)}</strong>
      ${hasFields ? '' : '<span class="ilw-inv-no-fields-tag">ไม่ต้องกรอก fields เพิ่ม</span>'}`;
    if (formEl) formEl.innerHTML = hasFields ? _buildTransFields(trans.fields) : '';
    if (submitBtn) submitBtn.innerHTML = `<i data-icon="arrow-right-circle"></i> Submit → ${_e(trans.name)}`;
    if (window.Icons) Icons.replaceAll(formWrap);

    formWrap.style.display = '';
    formWrap.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  function _invCancelTrans() {
    _invSelectedId = null;
    document.querySelectorAll('.ilw-inv-trans-card').forEach(c => c.classList.remove('selected'));
    const fw = _el('ilw-inv-form-wrap');
    if (fw) fw.style.display = 'none';
  }

  async function _invDoTransition() {
    if (!_invSelectedId || !_invTicket) return;
    const trans  = _invTransitions.find(t => t.id === _invSelectedId);
    const form   = _el('ilw-inv-form');
    const fields = {};
    form?.querySelectorAll('[name]').forEach(el => { if (el.value) fields[el.name] = el.value; });

    const btn = _el('ilw-inv-submit-btn');
    if (btn) { btn.disabled=true; btn.innerHTML='<i data-icon="loader"></i> กำลัง submit…'; if(window.Icons)Icons.replaceAll(btn); }

    const r = await API.post('/incident-launcher/index.php', {
      action: 'jira_do_transition', key: _invTicket, transition_id: _invSelectedId, fields,
    });

    if (!r?.ok) {
      if (btn) { btn.disabled=false; btn.innerHTML=`<i data-icon="arrow-right-circle"></i> Submit → ${_e(trans?.name||'')}`;if(window.Icons)Icons.replaceAll(btn); }
      window.showToast?.(`Transition ไม่สำเร็จ: ${r?.data?.message||`HTTP ${r?.status}`}`, 'error');
      return;
    }

    window.showToast?.(`เปลี่ยนสถานะ → ${trans?.name} สำเร็จ`, 'success');
    _log(`${_invTicket} → ${trans?.name}`);
    _setStepMeta('investigate','done', `→ ${trans?.name}`);
    _updateNavDots();
    next();
  }

  /* ── Jira typeahead state (scoped to wizard) ────────────── */
  const CT_FID = { bu:'customfield_17066', svc:'customfield_17024', chn:'customfield_17023', detected:'customfield_17016', '3rd':'customfield_17238' };
  let _jiraFieldOpts = {};
  let _jiraMulti  = { bu:[], svc:[], chn:[] };
  let _jiraSingle = { detected:'', '3rd':'' };

  function _jiraGetOpts(key) { return _jiraFieldOpts[CT_FID[key]]?.options || []; }

  function _jiraHighlight(text, q) {
    if (!q) return _e(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return _e(text);
    return _e(text.slice(0,i)) + '<mark>' + _e(text.slice(i,i+q.length)) + '</mark>' + _e(text.slice(i+q.length));
  }

  function _jiraRenderDD(wrap, key, q) {
    const dd = wrap.querySelector('.ilw-ct-dropdown');
    const isMulti = wrap.dataset.ilwTa === 'multi';
    const opts = _jiraGetOpts(key);
    const taken = isMulti ? new Set(_jiraMulti[key]) : new Set();
    const filtered = opts.filter(o => !q || o.toLowerCase().includes((q||'').toLowerCase()));
    dd.innerHTML = filtered.length
      ? filtered.map(o => `<div class="ilw-ct-opt${taken.has(o)?' ilw-ct-opt--dis':''}" data-val="${_e(o)}">${_jiraHighlight(o,q)}${taken.has(o)?' ✓':''}</div>`).join('')
      : `<div class="ilw-ct-opt-empty">ไม่พบ "${_e(q||'')}"</div>`;
  }

  function _jiraOpenDD(wrap, key) {
    _jiraCloseAll();
    _jiraRenderDD(wrap, key, wrap.querySelector('.ilw-ct-typeahead').value);
    wrap.querySelector('.ilw-ct-dropdown').classList.add('open');
  }

  function _jiraCloseAll() {
    document.querySelectorAll('.ilw-ct-dropdown.open').forEach(d=>d.classList.remove('open'));
  }

  function _jiraRenderChips(key) {
    const wrap = document.querySelector(`[data-ilw-ta="multi"][data-ilw-key="${key}"]`);
    if (!wrap) return;
    wrap.querySelectorAll('.ilw-ct-chip').forEach(c=>c.remove());
    const input = wrap.querySelector('.ilw-ct-typeahead');
    _jiraMulti[key].forEach(v => {
      const chip = document.createElement('span');
      chip.className = 'ilw-ct-chip';
      chip.innerHTML = `${_e(v)}<button class="ilw-ct-chip-x" type="button">×</button>`;
      chip.querySelector('.ilw-ct-chip-x').addEventListener('click', () => {
        _jiraMulti[key] = _jiraMulti[key].filter(x=>x!==v);
        _jiraRenderChips(key);
      });
      wrap.insertBefore(chip, input);
    });
  }

  function _jiraSetSingle(key, val) {
    _jiraSingle[key] = val;
    const wrap = document.querySelector(`[data-ilw-ta="single"][data-ilw-key="${key}"]`);
    if (!wrap) return;
    const input = wrap.querySelector('.ilw-ct-typeahead');
    if (input) input.value = val;
    wrap.classList.toggle('has-value', !!val);
  }

  function _jiraInitTypeaheads(container) {
    container.querySelectorAll('[data-ilw-ta]').forEach(wrap => {
      const key = wrap.dataset.ilwKey;
      const isMulti = wrap.dataset.ilwTa === 'multi';
      const input = wrap.querySelector('.ilw-ct-typeahead');
      const dd    = wrap.querySelector('.ilw-ct-dropdown');
      if (!input || input.dataset.ilwReady) return;
      input.dataset.ilwReady = '1';

      input.addEventListener('focus', () => _jiraOpenDD(wrap, key));
      input.addEventListener('input', () => {
        _jiraRenderDD(wrap, key, input.value);
        dd.classList.add('open');
        if (!isMulti && _jiraSingle[key]) { _jiraSingle[key]=''; wrap.classList.remove('has-value'); }
      });
      input.addEventListener('keydown', e => {
        if (e.key==='Backspace' && isMulti && !input.value && _jiraMulti[key].length) {
          _jiraMulti[key].pop(); _jiraRenderChips(key);
        }
        if (e.key==='Enter') {
          e.preventDefault();
          const first = dd.querySelector('.ilw-ct-opt:not(.ilw-ct-opt--dis)');
          if (first) first.click();
        }
      });
      dd.addEventListener('mousedown', e => {
        e.preventDefault();
        const opt = e.target.closest('.ilw-ct-opt');
        if (!opt || opt.classList.contains('ilw-ct-opt--dis')) return;
        const val = opt.dataset.val;
        if (isMulti) {
          if (!_jiraMulti[key].includes(val)) { _jiraMulti[key].push(val); _jiraRenderChips(key); }
          input.value = '';
          _jiraRenderDD(wrap, key, '');
        } else {
          _jiraSetSingle(key, val);
          dd.classList.remove('open');
        }
      });
      // Single: click ✕
      if (!isMulti) {
        wrap.addEventListener('click', e => {
          const r = wrap.getBoundingClientRect();
          if (wrap.classList.contains('has-value') && e.clientX > r.right-28 && e.clientX < r.right-4) {
            _jiraSetSingle(key,''); input.focus();
          }
        });
      }
    });
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('[data-ilw-ta]')) _jiraCloseAll();
    }, { once:false });
  }

  function _toBkk(date) {
    // Bangkok = UTC+7, format as datetime-local string
    const d = new Date(date);
    const bkk = new Date(d.getTime() + 7*60*60*1000);
    return bkk.toISOString().slice(0,16);
  }

  function _jiraFaultMode() {
    const mode = _el('ilw-ct-fault-mode')?.value;
    const dt   = _el('ilw-ct-fault-dt');
    if (!dt) return;
    if (mode==='manual') { dt.disabled=false; if (!dt.value) dt.value=_toBkk(new Date()); }
    else { dt.disabled=true; }
  }

  /* ── Jira field builder ────────────────────────────────── */
  function _buildJiraField(id, meta, defaultVal) {
    const label = meta.label || id;
    const val   = _e(defaultVal || '');
    const elId  = `ilw-jf-${id}`;
    const required = meta.required ? `<span class="ilw-inv-req">*</span>` : '';

    if (meta.type === 'select' && meta.options?.length) {
      const opts = meta.options.map(o =>
        `<option value="${_e(o)}" ${o===defaultVal?'selected':''}>${_e(o)}</option>`
      ).join('');
      return `<div class="ilw-inv-field">
        <label class="ilw-inv-label">${_e(label)} ${required}</label>
        <select class="ilw-inv-select" id="${elId}" name="${id}">
          <option value="">— เลือก —</option>${opts}
        </select>
      </div>`;
    }

    if (meta.type === 'datetime') {
      return `<div class="ilw-inv-field">
        <label class="ilw-inv-label">${_e(label)} ${required}</label>
        <input class="ilw-inv-input" type="datetime-local" id="${elId}" name="${id}" value="${val}" step="60">
      </div>`;
    }

    if (meta.type === 'tags') {
      return `<div class="ilw-inv-field">
        <label class="ilw-inv-label">${_e(label)} ${required} <span style="font-size:10px;color:var(--text-muted)">คั่นด้วย comma</span></label>
        <input class="ilw-inv-input" id="${elId}" name="${id}" value="${val}" placeholder="${_e(meta.placeholder||'')}">
      </div>`;
    }

    return `<div class="ilw-inv-field">
      <label class="ilw-inv-label">${_e(label)} ${required}</label>
      <input class="ilw-inv-input" id="${elId}" name="${id}" value="${val}" placeholder="${_e(meta.placeholder||'')}">
    </div>`;
  }

  async function _submitJira() {
    const summary   = _el('ilw-ct-summary')?.value?.trim();
    const desc      = _el('ilw-ct-desc')?.value?.trim() || '';
    const severity  = _el('ilw-ct-severity')?.value || '';
    const faultMode = _el('ilw-ct-fault-mode')?.value;
    const faultDt   = _el('ilw-ct-fault-dt')?.value;

    if (!summary)              { window.showToast?.('กรุณาระบุ Summary', 'warn'); return; }
    if (!_jiraSingle.detected) { window.showToast?.('กรุณาเลือก Detected by', 'warn'); return; }
    if (!_jiraMulti.bu.length) { window.showToast?.('กรุณาเลือก Business Unit Impacted', 'warn'); return; }
    if (!_jiraMulti.svc.length){ window.showToast?.('กรุณาเลือก TH Service Impacted', 'warn'); return; }
    if (!_jiraMulti.chn.length){ window.showToast?.('กรุณาเลือก TH Channel / Component', 'warn'); return; }

    const btn = _el('ilw-ct-submit-btn');
    if (btn) { btn.disabled=true; btn.innerHTML='<i data-icon="loader"></i> กำลังสร้าง…'; if(window.Icons)Icons.replaceAll(btn); }

    const fields = {
      issuetype:          _cfg.jira_issue_type || 'Monitoring',
      customfield_17031:  severity,
      customfield_17066:  _jiraMulti.bu.join(','),
      customfield_17024:  _jiraMulti.svc.join(','),
      customfield_17023:  _jiraMulti.chn.join(','),
      customfield_17016:  _jiraSingle.detected,
    };
    if (_jiraSingle['3rd']) fields.customfield_17238 = _jiraSingle['3rd'];
    fields.customfield_17026 = (faultMode === 'manual' && faultDt)
      ? new Date(faultDt).toISOString().replace('Z', '+0000')
      : 'auto';

    /* collect preset field values from rendered inputs (user may have changed them) */
    (_cfg.jira_preset_fields || []).forEach(f => {
      if (!f.field_id || fields[f.field_id]) return;
      const el  = _el(`ilw-ct-pf-${f.field_id}`);
      const val = el ? el.value.trim() : f.value;
      if (val) fields[f.field_id] = val;
    });

    const r = await API.post('/jira/create.php', { summary, description: desc, fields });

    if (!r?.ok) {
      if (btn) { btn.disabled=false; btn.innerHTML='<i data-icon="file-text"></i> สร้าง Jira Ticket'; if(window.Icons)Icons.replaceAll(btn); }
      /* build detailed error from Jira response */
      const d        = r?.data || {};
      const jiraErrs = d.jira_errors  || {};
      const jiraMsgs = d.jira_messages|| [];
      const details  = [
        ...Object.entries(jiraErrs).map(([f,m]) => `${f}: ${m}`),
        ...jiraMsgs,
      ];
      const errMsg = details.length ? details.join(' · ') : (d.message || `HTTP ${r?.status}`);
      window.showToast?.(`สร้าง Ticket ไม่สำเร็จ: ${errMsg}`, 'error');

      /* show inline error in step body */
      const stepBodyEl = _el('ilw-step-body');
      if (stepBodyEl) {
        const errDiv = document.createElement('div');
        errDiv.className = 'ilw-jira-err-box';
        errDiv.innerHTML = `
          <div class="ilw-jira-err-title"><i data-icon="alert-circle"></i> Jira ปฏิเสธคำขอ (${r?.status})</div>
          <div class="ilw-jira-err-body">${details.map(e=>`<div>• ${_e(e)}</div>`).join('')||_e(errMsg)}</div>
          <div class="ilw-jira-err-hint">ตรวจสอบ field values และลองใหม่อีกครั้ง</div>`;
        if (window.Icons) Icons.replaceAll(errDiv);
        stepBodyEl.appendChild(errDiv);
      }
      return;
    }

    const key = r?.data?.data?.issue_key || r?.data?.data?.key || r?.data?.key || '';
    _ticket   = key;
    const url = key ? `https://truemoney.atlassian.net/browse/${key}` : null;

    const stepBody = _el('ilw-step-body');
    if (stepBody) {
      stepBody.innerHTML = `
        <div class="ilw-jira-done">
          <div class="ilw-jira-done-icon"><i data-icon="check-circle" style="font-size:32px"></i></div>
          <div class="ilw-jira-done-title">สร้าง Ticket สำเร็จ</div>
        </div>
        <div class="ilw-ticket-card">
          <div class="ilw-ticket-key">${_e(key || '—')}</div>
          <div class="ilw-ticket-title">${_e(summary)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <span class="ilw-ticket-sev-badge">${_e(severity)}</span>
            ${url ? `<a href="${_e(url)}" target="_blank" rel="noopener" class="ilw-ticket-link"><i data-icon="external-link"></i> เปิดใน Jira</a>` : ''}
          </div>
          ${(_cfg.jira_preset_fields||[]).filter(f=>f.field_id).length ? `
          <div class="ilw-ticket-preset-summary">
            ${(_cfg.jira_preset_fields||[]).filter(f=>f.field_id).map(f => {
              const el = _el(`ilw-ct-pf-${f.field_id}`);
              const val = el ? el.value.trim() : f.value;
              return val ? `<span class="ilw-ticket-preset-chip"><b>${_e(f.label||f.field_id)}</b>: ${_e(val)}</span>` : '';
            }).filter(Boolean).join('')}
          </div>` : ''}
        </div>`;
      if (window.Icons) Icons.replaceAll(stepBody);
    }

    _setStepMeta('jira', 'done', key || 'สำเร็จ');
    _updateNavDots();
    _log(`Jira: ${key}`);
    _refreshChannelCards();
    window.showToast?.(`สร้าง Ticket ${key} สำเร็จ`, 'success');
    const nextBtn = _el('ilw-next-btn');
    if (nextBtn) nextBtn.disabled = false;
  }

  /* ── Channel helpers ───────────────────────────────────── */
  const _CH_COLOR = { googlechat:'#6366f1', line:'#22c55e', dingtalk:'#f59e0b', manual:'#6b7280' };
  const _CH_ICON  = { googlechat:'message-square', line:'message-circle', dingtalk:'bell', manual:'clipboard' };
  const _CH_LABEL = { googlechat:'Google Chat', line:'LINE Notify', dingtalk:'DingTalk', manual:'Manual (Copy)' };

  function _buildChannelCard(ch) {
    const color    = _CH_COLOR[ch.platform] || '#6b7280';
    const icon     = _CH_ICON[ch.platform]  || 'send';
    const label    = _CH_LABEL[ch.platform] || ch.platform;
    const isManual = ch.platform === 'manual';
    const haswh    = !isManual && !!ch.auth;
    const sent     = _sentFlags[ch.id];
    const tplAlert    = _fillTpl(ch.template_alert    || ch.template || '');
    const tplResolved = _fillTpl(ch.template_resolved || '');

    return `
      <div class="ilw-ch-card ${sent?'sent-alert':''}" id="ilw-ch-${_e(ch.id)}">
        <div class="ilw-ch-head">
          <div class="ilw-ch-icon" style="background:${color}18;color:${color}">
            <i data-icon="${icon}"></i>
          </div>
          <div class="ilw-ch-meta">
            <div class="ilw-ch-name">${_e(ch.name)}</div>
            <div class="ilw-ch-plat-row">
              <span class="ilw-ch-plat-badge" style="--chc:${color}">${_e(label)}</span>
              ${!haswh&&!isManual?`<span class="ilw-ch-nowh"><i data-icon="alert-triangle"></i> ยังไม่มี webhook</span>`:''}
            </div>
          </div>
          ${sent?`<div class="ilw-ch-sent-tag"><i data-icon="check-circle"></i> ส่งแล้ว</div>`:''}
        </div>
        <div class="ilw-ch-tabs-row">
          <button class="ilw-ch-tab active" id="ilw-cht-alert-${_e(ch.id)}" onclick="ILW._chTab('${_e(ch.id)}','alert')">
            <i data-icon="alert-triangle"></i> แจ้งปัญหา
          </button>
          <button class="ilw-ch-tab" id="ilw-cht-resolved-${_e(ch.id)}" onclick="ILW._chTab('${_e(ch.id)}','resolved')">
            <i data-icon="check-circle"></i> กลับปกติ
          </button>
        </div>
        <div class="ilw-ch-pane" id="ilw-chp-alert-${_e(ch.id)}">
          <textarea class="ilw-ch-textarea" id="ilw-chta-alert-${_e(ch.id)}" rows="5">${_e(tplAlert)}</textarea>
          <div class="ilw-ch-actions">
            ${haswh?`<button class="ilw-ch-btn send" id="ilw-chsend-${_e(ch.id)}" onclick="ILW._sendCh('${_e(ch.id)}','alert')">
              <i data-icon="send"></i> ส่ง
            </button>`:''}
            <button class="ilw-ch-btn copy" onclick="ILW._copyCh('${_e(ch.id)}','alert')">
              <i data-icon="copy"></i> Copy
            </button>
          </div>
        </div>
        <div class="ilw-ch-pane" id="ilw-chp-resolved-${_e(ch.id)}" style="display:none">
          <textarea class="ilw-ch-textarea" id="ilw-chta-resolved-${_e(ch.id)}" rows="4">${_e(tplResolved)}</textarea>
          <div class="ilw-ch-actions">
            ${haswh?`<button class="ilw-ch-btn send" onclick="ILW._sendCh('${_e(ch.id)}','resolved')">
              <i data-icon="send"></i> ส่ง Resolved
            </button>`:''}
            <button class="ilw-ch-btn copy" onclick="ILW._copyCh('${_e(ch.id)}','resolved')">
              <i data-icon="copy"></i> Copy
            </button>
          </div>
        </div>
      </div>`;
  }

  function _chTab(chId, type) {
    ['alert','resolved'].forEach(t => {
      const pane = _el(`ilw-chp-${t}-${chId}`);
      const tab  = _el(`ilw-cht-${t}-${chId}`);
      if (pane) pane.style.display = t === type ? '' : 'none';
      if (tab)  tab.classList.toggle('active', t === type);
    });
  }

  async function _sendCh(chId, type = 'alert') {
    const ch = _channels.find(c=>c.id===chId);
    if (!ch?.auth || ch.platform === 'manual') return;
    const ta  = _el(`ilw-chta-${type}-${chId}`);
    const msg = ta?.value?.trim() || _fillTpl(type === 'alert' ? (ch.template_alert||ch.template||'') : (ch.template_resolved||''));
    if (!msg) { window.showToast?.('ข้อความว่างเปล่า', 'warn'); return; }
    const btn = _el(type === 'alert' ? `ilw-chsend-${chId}` : null);
    if (btn) { btn.disabled=true; btn.innerHTML='<i data-icon="loader"></i> กำลังส่ง…'; if(window.Icons)Icons.replaceAll(btn); }

    /* generate thread key on first send (Step 1) — reused for Meet reply in Step 2 */
    if (!_ilwThreadKey) _ilwThreadKey = `ilw-${Date.now()}`;
    const postBody = { action:'notify_channel', channel_id:chId, message:msg, thread_key: _ilwThreadKey };
    const r = await API.post('/incident-launcher/index.php', postBody);

    if (!r?.ok) {
      const errMsg = r?.data?.message || `HTTP ${r?.status || '?'}`;
      if (btn) { btn.disabled=false; btn.innerHTML='<i data-icon="send"></i> ส่ง'; if(window.Icons)Icons.replaceAll(btn); }
      window.showToast?.(`ส่งไม่สำเร็จ (${ch.name}): ${errMsg}`, 'error');
      return;
    }

    _sentFlags[chId] = type;
    _log(`ส่ง${type==='alert'?'':'กลับปกติ'}: ${ch.name}`);
    window.showToast?.(`ส่งไปยัง ${ch.name} สำเร็จ`, 'success');
    if (btn) { btn.innerHTML='<i data-icon="check"></i> ส่งแล้ว'; btn.disabled=false; btn.classList.add('done'); if(window.Icons)Icons.replaceAll(btn); }
    const card = _el(`ilw-ch-${chId}`);
    if (card) card.classList.add('sent-alert');
    const head = card?.querySelector('.ilw-ch-head');
    if (head && !head.querySelector('.ilw-ch-sent-tag')) {
      const tag = document.createElement('div');
      tag.className = 'ilw-ch-sent-tag';
      tag.innerHTML = '<i data-icon="check-circle"></i> ส่งแล้ว';
      head.appendChild(tag);
      if(window.Icons)Icons.replaceAll(tag);
    }
    const rr = _el('ilw-resolved-row');
    if (rr) rr.style.display = '';
  }

  function _copyCh(chId, type = 'alert') {
    const ch = _channels.find(c=>c.id===chId);
    if (!ch) return;
    const ta  = _el(`ilw-chta-${type}-${chId}`);
    const txt = ta?.value || _fillTpl(type === 'alert' ? (ch.template_alert||ch.template||'') : (ch.template_resolved||''));
    navigator.clipboard?.writeText(txt).then(() => {
      if (!_sentFlags[chId]) _sentFlags[chId] = 'copy';
      _log(`Copy${type==='alert'?'':' กลับปกติ'}: ${ch.name}`);
      window.showToast?.(`Copy ข้อความ ${ch.name} แล้ว`, 'success');
    });
  }

  async function _notifyResolved() {
    for (const ch of _channels.filter(c=>_sentFlags[c.id])) {
      const ta  = _el(`ilw-chta-resolved-${ch.id}`);
      const msg = ta?.value?.trim() || _fillTpl(ch.template_resolved || ch.template_alert || '');
      if (ch.auth && ch.platform !== 'manual') {
        try {
          await API.post('/incident-launcher/index.php', { action:'notify_channel', channel_id:ch.id, message:msg });
          _log(`Notify กลับปกติ: ${ch.name}`);
        } catch(_) {}
      } else {
        navigator.clipboard?.writeText(msg);
        _log(`Copy กลับปกติ: ${ch.name}`);
      }
    }
    window.showToast?.('ส่ง/Copy ข้อความกลับปกติแล้ว', 'success');
  }

  function _refreshChannelCards() {
    const wrap = _el('ilw-ch-wrap');
    if (!wrap) return;
    wrap.innerHTML = _channels.map(ch=>_buildChannelCard(ch)).join('');
    if (window.Icons) Icons.replaceAll(wrap);
    const rr = _el('ilw-resolved-row');
    if (rr) rr.style.display = _hasAnySent() ? '' : 'none';
  }

  function _hasAnySent() { return _channels.some(c=>_sentFlags[c.id]); }

  function _refreshChannelCardsOnTicket() {
    /* called when ticket key is set — re-render to include {ticket} */
    _refreshChannelCards();
  }

  /* ── MA helpers ────────────────────────────────────────── */
  function _buildMaCard(job) {
    const done    = _maLog.find(m=>m.id===job.id);
    const typeCls = job.type==='jenkins'?'jenkins':job.type==='rundeck'?'rundeck':'';
    const typeIco = job.type==='jenkins'?'settings':job.type==='rundeck'?'terminal':'clipboard';
    return `
      <div class="ilw-ma-card ${done?'done':''}" id="ilw-mac-${_e(job.id)}">
        <div class="ilw-ma-ico ${typeCls}"><i data-icon="${typeIco}"></i></div>
        <div class="ilw-ma-info">
          <div class="ilw-ma-name">${_e(job.name||job.id)}</div>
          <div class="ilw-ma-type">${_e(job.type||'manual')}</div>
          ${done?`<div class="ilw-ma-ts"><i data-icon="check-circle"></i> ขึ้น MA: ${_e(done.ts)}</div>`:''}
        </div>
        <div class="ilw-ma-btns">
          ${job.type==='jenkins'
            ?`<button class="ilw-ma-btn" onclick="ILW._maJenkins('${_e(job.id)}')"><i data-icon="settings"></i> Jenkins</button>`
            : job.type==='rundeck'&&job.url
            ?`<button class="ilw-ma-btn" onclick="window.open('${_e(job.url)}','_blank','noopener')"><i data-icon="terminal"></i> Rundeck</button>`
            : ''}
          <button class="ilw-ma-btn ${done?'done':''}" onclick="ILW._maDone('${_e(job.id)}')">
            <i data-icon="${done?'check-circle':'circle'}"></i> ${done?'Done':'Mark Done'}
          </button>
        </div>
      </div>`;
  }

  function _maDone(jobId) {
    const job = (_cfg.ma_jobs||[]).find(j=>j.id===jobId);
    if (!job || _maLog.find(m=>m.id===jobId)) return;
    const ts = new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    _maLog.push({ id:jobId, name:job.name||jobId, type:job.type||'manual', ts });
    _log(`MA Done: ${job.name||jobId} @ ${ts}`);
    const list = _el('ilw-ma-list');
    if (list) {
      list.innerHTML = (_cfg.ma_jobs||[]).filter(j=>j.enabled!==false).map(j=>_buildMaCard(j)).join('');
      if (window.Icons) Icons.replaceAll(list);
    }
  }

  /* ── Jenkins inline build ─────────────────────────────── */
  const _JK_TREE = 'displayName,buildable,nextBuildNumber,lastBuild[number,result,timestamp],property[parameterDefinitions[name,_class,defaultParameterValue[value],description,choices]]';
  let _jkState = {}; // jobId → { paramDefs, pollTimer }

  async function _maJenkins(jobId) {
    const job = (_cfg.ma_jobs||[]).find(j=>j.id===jobId);
    if (!job) return;

    // Expand inline panel below MA card
    const panelId = `ilw-jk-panel-${jobId}`;
    const existing = _el(panelId);
    if (existing) { existing.remove(); return; } // toggle off

    const card = _el(`ilw-mac-${jobId}`);
    if (!card) return;

    // Insert panel after card
    const panel = document.createElement('div');
    panel.id = panelId;
    panel.className = 'ilw-jk-panel';
    panel.innerHTML = `<div class="ilw-jk-loading"><div class="ilw-spinner" style="width:24px;height:24px;border-width:2px"></div><span>กำลังโหลด parameters…</span></div>`;
    card.insertAdjacentElement('afterend', panel);

    // No server_id — direct URL
    if (!job.server_id && job.url) {
      panel.innerHTML = `<div class="ilw-jk-noparams">
        Job นี้ใช้ Direct URL — กด Build เพื่อเปิด Jenkins
        <button class="ilwb ilwb--primary" onclick="window.open('${_e(job.url)}','_blank','noopener');ILW._maDone('${_e(jobId)}')">
          <i data-icon="external-link"></i> เปิด Jenkins + Mark Done
        </button>
      </div>`;
      if (window.Icons) Icons.replaceAll(panel);
      return;
    }

    try {
      const r = await API.get(
        `/jenkins-proxy/index.php?server=${encodeURIComponent(job.server_id)}&path=${encodeURIComponent(job.job_path+'/api/json')}&tree=${encodeURIComponent(_JK_TREE)}`
      );
      if (!r?.ok) throw new Error(r?.data?.message||`HTTP ${r?.status}`);
      const jd = r?.data?.data || {};
      const paramDefs = (jd.property||[]).find(p=>p._class?.includes('ParametersDefinition'))?.parameterDefinitions || [];
      _jkState[jobId] = { paramDefs, nextBuild: jd.nextBuildNumber, serverId: job.server_id, jobPath: job.job_path };

      const lastBuild = jd.lastBuild?.number ? `#${jd.lastBuild.number} · ${jd.lastBuild.result||'IN PROGRESS'}` : 'ยังไม่มี';

      const hasBoCfgs = (job.bo_configs?.length > 0) || (job.bo_application);
      panel.className = `ilw-jk-panel${hasBoCfgs ? ' ilw-jk-panel--split' : ''}`;
      panel.innerHTML = `
        <div class="ilw-jk-header">
          <div>
            <div class="ilw-jk-jobname">${_e(jd.displayName||job.name)}</div>
            <div class="ilw-jk-meta">Next: <strong>#${jd.nextBuildNumber||'—'}</strong> · Last: ${_e(lastBuild)}</div>
          </div>
        </div>
        <div class="ilw-jk-split-body">
          ${hasBoCfgs ? `<div class="ilw-jk-bo-col" id="ilw-jk-bo-${jobId}">
            <div class="ilw-jk-bo-col-hd"><i data-icon="database"></i> Admin Portal Message</div>
            <div class="ilw-bo-rows" id="ilw-bo-rows-${jobId}">
              <div style="color:var(--text-muted);font-size:12px;font-style:italic">กำลังโหลด…</div>
            </div>
          </div>` : ''}
          <div class="ilw-jk-params-col">
            ${paramDefs.length ? `
            <div class="ilw-jk-params" id="ilw-jkp-${jobId}">
              ${paramDefs.map((p,i) => _buildJkParam(p, i, jobId)).join('')}
            </div>` : `<div class="ilw-jk-noparams"><i data-icon="info"></i> ไม่มี parameters — กด Build ได้เลย</div>`}
            <div class="ilw-jk-actions">
              <button class="ilwb ilwb--primary" id="ilw-jkbtn-${jobId}" onclick="ILW._jkBuild('${_e(jobId)}')">
                <i data-icon="play"></i> Build Now
              </button>
            </div>
            <div class="ilw-jk-progress" id="ilw-jkprog-${jobId}" style="display:none">
              <div class="ilw-jk-progress-bar"><div class="ilw-jk-progress-fill" id="ilw-jkfill-${jobId}"></div></div>
              <div class="ilw-jk-progress-info">
                <span class="ilw-jk-progress-label" id="ilw-jklbl-${jobId}">Queued…</span>
                <span class="ilw-jk-progress-time" id="ilw-jktime-${jobId}"></span>
                <span class="ilw-jk-progress-pct"  id="ilw-jkpct-${jobId}"></span>
              </div>
            </div>
          </div>
        </div>`;
      if (window.Icons) Icons.replaceAll(panel);

      // Wire boolean toggles + inject description HTML
      paramDefs.forEach((p,i) => {
        if ((p._class||'').includes('Boolean')) {
          const cb = _el(`ilw-jkp-${jobId}-${i}`);
          const lb = _el(`ilw-jkpl-${jobId}-${i}`);
          cb?.addEventListener('change', () => { if (lb) lb.textContent = cb.checked ? 'true (enabled)' : 'false (disabled)'; });
        }
        if (p.description) {
          const descEl = panel.querySelector(`.ilw-jk-field:nth-child(${i+1}) .ilw-jk-desc`);
          if (descEl) descEl.innerHTML = p.description;
        }
      });
      // Fix: safer injection by data attribute
      panel.querySelectorAll('.ilw-jk-desc[data-desc]').forEach(el => {
        el.innerHTML = el.getAttribute('data-desc');
        el.removeAttribute('data-desc');
      });

      // BO Config preview
      await _loadBoPreview(job, panel);

    } catch(e) {
      panel.innerHTML = `<div class="ilw-jk-error"><i data-icon="alert-circle"></i> โหลดไม่สำเร็จ: ${_e(e?.message||'error')}</div>`;
      if (window.Icons) Icons.replaceAll(panel);
    }
  }

  function _buildJkParam(p, i, jobId) {
    const defVal = String(p.defaultParameterValue?.value ?? '');
    const cls    = p._class || '';
    const isChoice = cls.includes('Choice') && Array.isArray(p.choices) && p.choices.length;
    const isBool   = cls.includes('Boolean');
    const isText   = cls.includes('TextParameter');
    const isPass   = cls.includes('Password');
    const elId  = `ilw-jkp-${jobId}-${i}`;

    let input;
    if (isChoice) {
      input = `<select class="ilw-jk-input" id="${elId}">
        ${p.choices.map(c=>`<option value="${_e(c)}"${c===defVal?' selected':''}>${_e(c)}</option>`).join('')}
      </select>`;
    } else if (isBool) {
      const checked = defVal==='true';
      input = `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <input type="checkbox" id="${elId}" ${checked?'checked':''} style="width:15px;height:15px;accent-color:#6366f1;cursor:pointer">
        <label for="${elId}" style="font-size:12px;cursor:pointer;color:var(--text)" id="ilw-jkpl-${jobId}-${i}">${checked?'true (enabled)':'false (disabled)'}</label>
      </div>`;
    } else if (isText) {
      input = `<textarea class="ilw-jk-input" id="${elId}" rows="2" style="font-family:monospace;font-size:11px;resize:vertical">${_e(defVal)}</textarea>`;
    } else if (isPass) {
      input = `<input type="password" class="ilw-jk-input" id="${elId}" value="${_e(defVal)}">`;
    } else {
      input = `<input type="text" class="ilw-jk-input" id="${elId}" value="${_e(defVal)}" placeholder="${_e(p.name)}">`;
    }
    return `<div class="ilw-jk-field">
      <label class="ilw-jk-label">${_e(p.name)}</label>
      ${p.description?`<div class="ilw-jk-desc" data-desc="${_e(p.description)}" style="font-size:10px;color:var(--text-muted);margin-bottom:3px;line-height:1.6"></div>`:''}
      ${input}
    </div>`;
  }

  async function _loadBoPreview(job, panel) {
    const cfgs = job.bo_configs?.length ? job.bo_configs
      : (job.bo_application ? [{ application: job.bo_application, key: job.bo_key||'', label:'', environment:'production', profile:'main', editable:false }] : []);
    if (!cfgs.length) return;

    // Render into the pre-allocated BO column
    const rowsWrap = document.getElementById(`ilw-bo-rows-${job.id}`);
    if (!rowsWrap) return;
    rowsWrap.innerHTML = cfgs.map((c,i) => `
      <div class="ilw-bo-item" id="ilw-bo-${_e(job.id)}-${i}">
        <div class="ilw-bo-item-hd">
          <span class="ilw-bo-key">${_e(c.label || c.key)}</span>
          ${c.editable ? `<button class="ilw-bo-edit-btn" onclick="ILW._boEditOpen('${_e(job.id)}',${i})" title="แก้ไขข้อความ"><i data-icon="edit"></i></button>` : ''}
        </div>
        <div class="ilw-bo-val loading" id="ilw-bo-val-${_e(job.id)}-${i}">กำลังโหลด…</div>
        <div class="ilw-bo-edit-area" id="ilw-bo-edit-${_e(job.id)}-${i}" style="display:none">
          <textarea class="ilw-bo-edit-input" id="ilw-bo-ta-${_e(job.id)}-${i}" rows="3" placeholder="ข้อความใหม่…"></textarea>
          <div class="ilw-bo-edit-actions">
            <button class="ilwb ilwb--sm" onclick="ILW._boEditCancel('${_e(job.id)}',${i})">ยกเลิก</button>
            <button class="ilwb ilwb--sm ilwb--primary" onclick="ILW._boEditSave('${_e(job.id)}',${i},'${_e(c.application)}','${_e(c.key)}','${_e(c.environment||'production')}','${_e(c.profile||'main')}')">
              <i data-icon="save"></i> บันทึก
            </button>
          </div>
          <div class="ilw-bo-edit-status" id="ilw-bo-st-${_e(job.id)}-${i}"></div>
        </div>
      </div>`).join('');
    if (window.Icons) Icons.replaceAll(rowsWrap);

    await Promise.all(cfgs.map(async (c, i) => {
      const valEl = document.getElementById(`ilw-bo-val-${job.id}-${i}`);
      if (!valEl) return;
      try {
        const r = await API.get(`/incident-launcher/index.php?action=bo_config_peek&application=${encodeURIComponent(c.application)}&key=${encodeURIComponent(c.key)}`);
        const p = r?.data?.property;
        if (!p) throw new Error('ไม่พบ');
        valEl.className = 'ilw-bo-val';
        valEl.textContent = p.value || '(ว่าง)';
        if (c.editable) {
          const ta = document.getElementById(`ilw-bo-ta-${job.id}-${i}`);
          if (ta) ta.value = p.value || '';
        }
      } catch(e) {
        valEl.className = 'ilw-bo-val err';
        valEl.textContent = e?.message || 'ดึงข้อมูลไม่สำเร็จ';
      }
    }));
  }

  function _boEditOpen(jobId, idx) {
    document.getElementById(`ilw-bo-edit-${jobId}-${idx}`)?.style.setProperty('display','');
  }
  function _boEditCancel(jobId, idx) {
    document.getElementById(`ilw-bo-edit-${jobId}-${idx}`)?.style.setProperty('display','none');
    const st = document.getElementById(`ilw-bo-st-${jobId}-${idx}`);
    if (st) st.textContent = '';
  }
  async function _boEditSave(jobId, idx, application, key, environment, profile) {
    const ta  = document.getElementById(`ilw-bo-ta-${jobId}-${idx}`);
    const st  = document.getElementById(`ilw-bo-st-${jobId}-${idx}`);
    const val = ta?.value ?? '';
    if (!val.trim()) { if (st) st.textContent = 'ข้อความไม่ควรว่าง'; return; }
    if (st) st.innerHTML = '<span style="color:var(--text-muted)">กำลังบันทึก…</span>';
    try {
      const r = await API.post('/incident-launcher/index.php', {
        action: 'bo_config_update', application, key, value: val, environment, profile,
      });
      if (!r?.ok) throw new Error(r?.data?.message || `HTTP ${r?.status}`);
      // Update displayed value
      const valEl = document.getElementById(`ilw-bo-val-${jobId}-${idx}`);
      if (valEl) { valEl.className = 'ilw-bo-val'; valEl.textContent = val; }
      if (st) st.innerHTML = '<span style="color:#22c55e"><i data-icon="check-circle"></i> บันทึกสำเร็จ</span>';
      if (window.Icons) Icons.replaceAll(document.getElementById(`ilw-bo-st-${jobId}-${idx}`));
      setTimeout(() => _boEditCancel(jobId, idx), 1500);
    } catch(e) {
      if (st) st.innerHTML = `<span style="color:#f87171">Error: ${_e(e?.message||'ไม่สำเร็จ')}</span>`;
    }
  }

  async function _jkBuild(jobId) {
    const state = _jkState[jobId];
    if (!state) return;

    const params = {};
    (state.paramDefs||[]).forEach((p,i) => {
      const el = _el(`ilw-jkp-${jobId}-${i}`);
      if (!el) return;
      params[p.name] = (p._class||'').includes('Boolean') ? (el.checked?'true':'false') : el.value;
    });

    const btn  = _el(`ilw-jkbtn-${jobId}`);
    const prog = _el(`ilw-jkprog-${jobId}`);
    const fill = _el(`ilw-jkfill-${jobId}`);
    const lbl  = _el(`ilw-jklbl-${jobId}`);

    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> Queuing…'; if (window.Icons) Icons.replaceAll(btn); }

    try {
      await API.post('/jenkins-proxy/index.php?action=build', {
        server: state.serverId,
        path:   state.jobPath,
        params: Object.keys(params).length ? params : undefined,
      });
      if (btn) btn.style.display = 'none';
      if (prog) prog.style.display = '';
      if (fill) fill.style.width = '5%';
      if (lbl)  lbl.textContent = 'Queued — รอ Jenkins เริ่ม build…';
      _log(`MA Build queued: ${(_cfg.ma_jobs||[]).find(j=>j.id===jobId)?.name||jobId}`);

      // Poll build status
      _jkState[jobId].pollTimer = setInterval(() => _jkPoll(jobId, state), 5000);
      setTimeout(() => _jkPoll(jobId, state), 2000); // first check quick
    } catch(e) {
      window.showToast?.(`Build ล้มเหลว: ${e?.message||''}`, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="play"></i> Build Now'; if (window.Icons) Icons.replaceAll(btn); }
    }
  }

  /* ── Service Performance inline ──────────────────────────── */
  let _spCurrent = null;
  let _spEngineLoaded = false;

  async function _spEnsureEngine() {
    if (_spEngineLoaded || window.paintCharts) { _spEngineLoaded = true; return; }
    // Load CSS
    if (!document.querySelector('link[data-sp2-css]')) {
      const lnk = document.createElement('link');
      lnk.rel = 'stylesheet'; lnk.dataset.sp2Css = '1';
      lnk.href = 'assets/pages/service-performance/service-performance.css';
      document.head.appendChild(lnk);
    }
    // Load JS
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'assets/pages/service-performance/service-performance.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    _spEngineLoaded = true;
  }

  function _spSelect(service) {
    _spCurrent = service;
    document.querySelectorAll('.ilw-sp-svc-card').forEach(t =>
      t.classList.toggle('active', t.id === `ilw-sp-tab-${service}`)
    );
    const link = _el('ilw-sp-newpage');
    if (link) link.href = `service-performance.html?service=${encodeURIComponent(service)}`;
    const frame = _el('ilw-sp-frame');
    if (!frame) return;
    frame.src = `service-performance.html?service=${encodeURIComponent(service)}&wizard=1`;
  }

  // Sparkline from timeseries [[ts,val],...] — returns SVG string
  function _spSparkline(series, color) {
    if (!series?.length) return null;
    const vals = series.map(p => parseFloat(Array.isArray(p) ? p[1] : p));
    const clean = vals.filter(v => isFinite(v));
    if (!clean.length) return null;
    const min = Math.min(...clean), max = Math.max(...clean);
    const rng = (max - min) || 0.001;
    const W = 400, H = 56, PAD = 3;
    const pts = clean.map((v,i) => {
      const x = PAD + (i / Math.max(clean.length-1,1)) * (W - PAD*2);
      const y = (H - PAD) - ((v - min) / rng) * (H - PAD*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const areaPath = `M${PAD},${H-PAD} L${pts.join(' L')} L${W-PAD},${H-PAD} Z`;
    const id = `sg${Math.random().toString(36).slice(2,6)}`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:56px;display:block">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${areaPath}" fill="url(#${id})"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  // Bar chart from pod list — visualise fleet CPU/MEM distribution
  function _spPodBarChart(pods, metric) {
    if (!pods?.length) return '';
    const vals = pods.map(p => metric === 'cpu' ? (p.cpuPct ?? 0) : (p.memPct ?? 0));
    const maxV = Math.max(...vals, 1);
    const H = 52, gap = 2;
    const barW = Math.max(2, Math.min(18, Math.floor((560 - gap * vals.length) / vals.length)));
    const totalW = vals.length * (barW + gap);
    const bars = vals.map((v, i) => {
      const c = _spPctColor(v);
      const bh = Math.max(2, Math.round((v / maxV) * (H - 8)));
      const x = i * (barW + gap), y = H - bh;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="1.5" fill="${c}" opacity=".85"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${totalW} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;display:block">
      <line x1="0" y1="${H-1}" x2="${totalW}" y2="${H-1}" stroke="rgba(128,128,128,.15)" stroke-width="1"/>
      ${bars}
    </svg>`;
  }

  function _spPctColor(pct) {
    return pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : pct >= 50 ? '#3b82f6' : '#22c55e';
  }

  function _spFmtMem(b) {
    if (b == null) return '—';
    return b >= 1e9 ? (b/1e9).toFixed(1)+' GB' : b >= 1e6 ? (b/1e6).toFixed(0)+' MB' : b+' B';
  }

  function _spGaugeBar(pct) {
    if (pct == null) return '<div class="ilw-sp-gauge-wrap"><span style="color:var(--text-muted);font-size:11px">—</span></div>';
    const c = _spPctColor(pct);
    return `<div class="ilw-sp-gauge-wrap">
      <div class="ilw-sp-gauge-bar"><div class="ilw-sp-gauge-fill" style="width:${Math.min(100,pct)}%;background:${c}"></div></div>
      <span class="ilw-sp-gauge-pct" style="color:${c}">${pct}%</span>
    </div>`;
  }

  function _spStatFromSeries(series) {
    if (!series?.length) return null;
    const vals = series.map(p => parseFloat(Array.isArray(p) ? p[1] : p)).filter(v => isFinite(v));
    if (!vals.length) return null;
    const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
    return { min: Math.min(...vals), max: Math.max(...vals), mean };
  }

  function _spRenderDetail(service, d) {
    const sum  = d.summary    || {};
    const ts   = d.timeseries || {};
    const pods = d.pods       || [];
    const hasCpuTs = ts.cpu?.length >= 2;
    const hasMemTs = ts.mem?.length >= 2;

    // Compute min/max/mean from timeseries
    const cpuStat = _spStatFromSeries(ts.cpu);
    const memStat = _spStatFromSeries(ts.mem);

    // SP2 chart slots (using global areaChart() from lazy-loaded engine)
    const cpuBand  = { max: ts.cpuMax || [], min: ts.cpuMin || [] };
    const memBand  = { max: ts.memMax || [], min: ts.memMin || [] };
    const cpuChart = hasCpuTs && window.areaChart
      ? window.areaChart(ts.cpu, 'cores', '#6366f1', cpuBand)
      : _spPodBarChart(pods, 'cpu');
    const memChart = hasMemTs && window.areaChart
      ? window.areaChart(ts.mem, 'bytes', '#0ea5e9', memBand)
      : _spPodBarChart(pods, 'mem');

    const fmtCores = (v) => v == null ? '—' : v >= 1 ? v.toFixed(2)+' cores' : (v*1000).toFixed(0)+'m';
    const fmtStat  = (s, fn) => s ? `<span class="ilw-sp-stat-mmm"><span>min <b>${fn(s.min)}</b></span><span>avg <b>${fn(s.mean)}</b></span><span>max <b>${fn(s.max)}</b></span></span>` : '';

    const statCard = (icon, label, val, sub, color, mmm) => `
      <div class="ilw-sp-stat-card">
        <div class="ilw-sp-stat-icon" style="color:${color}"><i data-icon="${icon}"></i></div>
        <div class="ilw-sp-stat-body">
          <div class="ilw-sp-stat-val" style="color:${color}">${val}</div>
          <div class="ilw-sp-stat-lbl">${label}</div>
          ${sub ? `<div class="ilw-sp-stat-sub">${sub}</div>` : ''}
          ${mmm || ''}
        </div>
      </div>`;

    const sortedPods = [...pods].sort((a,b) => (b.cpuPct||0) - (a.cpuPct||0));

    return `
    <div class="ilw-sp-detail">
      <div class="ilw-sp-detail-hd">
        <span class="ilw-sp-detail-name"><i data-icon="activity"></i> ${_e(service)}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;color:var(--text-muted)">${hasCpuTs ? 'time-series 30 min' : 'pod snapshot'}</span>
          <a href="service-performance.html?service=${encodeURIComponent(service)}" target="_blank" rel="noopener" class="ilw-sp-detail-link">
            <i data-icon="external-link"></i> หน้าเต็ม
          </a>
        </div>
      </div>

      <!-- Stat cards with min/avg/max -->
      <div class="ilw-sp-stats-row">
        ${statCard('layers', 'Pods', sum.pods ?? '—', null, '#6366f1')}
        ${statCard('cpu', 'CPU avg/pod',
          sum.cpuPct != null ? sum.cpuPct+'%' : '—',
          sum.cpuCores != null ? fmtCores(sum.cpuCores) : null,
          _spPctColor(sum.cpuPct),
          fmtStat(cpuStat, fmtCores))}
        ${statCard('database', 'MEM avg/pod',
          sum.memPct != null ? sum.memPct+'%' : '—',
          _spFmtMem(sum.memBytes),
          _spPctColor(sum.memPct),
          fmtStat(memStat, v => _spFmtMem(v)))}
        ${sum.cpuThrottledPct != null ? statCard('alert-triangle', 'CPU Throttle', sum.cpuThrottledPct+'%', null, sum.cpuThrottledPct>20?'#ef4444':'#6b7280') : ''}
      </div>

      <!-- Gauge bars -->
      <div class="ilw-sp-gauges">
        <div class="ilw-sp-gauge-row">
          <span class="ilw-sp-gauge-label">CPU</span>
          ${_spGaugeBar(sum.cpuPct)}
        </div>
        <div class="ilw-sp-gauge-row">
          <span class="ilw-sp-gauge-label">MEM</span>
          ${_spGaugeBar(sum.memPct)}
        </div>
      </div>

      <!-- SP2 area charts with time axis + min/max band -->
      <div class="ilw-sp-charts-grid">
        <div class="ilw-sp-chart-card sp2-cc-chart-card">
          <div class="ilw-sp-chart-lbl sp2-cc-chart-head">
            <i data-icon="cpu"></i>
            CPU / pod — ${hasCpuTs ? '30 min' : 'pod distribution'}
            ${cpuStat ? `<span class="now" style="margin-left:auto;font-size:11px;color:var(--text-muted)">now ${sum.cpuPct!=null?sum.cpuPct+'%':'—'}</span>` : ''}
          </div>
          <div class="ilw-sp-chart-body" style="min-height:160px">${cpuChart}</div>
        </div>
        <div class="ilw-sp-chart-card sp2-cc-chart-card">
          <div class="ilw-sp-chart-lbl sp2-cc-chart-head">
            <i data-icon="database"></i>
            Memory / pod — ${hasMemTs ? '30 min' : 'pod distribution'}
            ${memStat ? `<span class="now" style="margin-left:auto;font-size:11px;color:var(--text-muted)">now ${sum.memPct!=null?sum.memPct+'%':'—'}</span>` : ''}
          </div>
          <div class="ilw-sp-chart-body" style="min-height:160px">${memChart}</div>
        </div>
      </div>

      <!-- All pods -->
      ${sortedPods.length ? `
      <div class="ilw-sp-pods">
        <div class="ilw-sp-pods-hd">
          <span><i data-icon="layers"></i> Pods ทั้งหมด ${sortedPods.length} รายการ</span>
          <span style="font-size:10px;opacity:.6;font-weight:400">เรียงตาม CPU สูง→ต่ำ</span>
        </div>
        <div class="ilw-sp-pods-list">
          ${sortedPods.map(p => {
            const cc = _spPctColor(p.cpuPct); const mc = _spPctColor(p.memPct);
            return `<div class="ilw-sp-pod">
              <span class="ilw-sp-pod-name">${_e(p.pod || p.name || '—')}</span>
              <div class="ilw-sp-pod-bars">
                <div class="ilw-sp-pod-bar-row">
                  <span class="ilw-sp-pod-bar-lbl">CPU</span>
                  <div class="ilw-sp-pod-bar-track"><div class="ilw-sp-pod-bar-fill" style="width:${Math.min(100,p.cpuPct??0)}%;background:${cc}"></div></div>
                  <span class="ilw-sp-pod-bar-val" style="color:${cc}">${p.cpuPct!=null?p.cpuPct+'%':'—'}</span>
                </div>
                <div class="ilw-sp-pod-bar-row">
                  <span class="ilw-sp-pod-bar-lbl">MEM</span>
                  <div class="ilw-sp-pod-bar-track"><div class="ilw-sp-pod-bar-fill" style="width:${Math.min(100,p.memPct??0)}%;background:${mc}"></div></div>
                  <span class="ilw-sp-pod-bar-val" style="color:${mc}">${p.memPct!=null?p.memPct+'%':'—'}</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>`;
  }

  function _fmtSec(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
  }

  async function _jkPoll(jobId, state) {
    const fill    = _el(`ilw-jkfill-${jobId}`);
    const lbl     = _el(`ilw-jklbl-${jobId}`);
    const timeEl  = _el(`ilw-jktime-${jobId}`);
    const pctEl   = _el(`ilw-jkpct-${jobId}`);
    try {
      const r = await API.get(
        `/jenkins-proxy/index.php?server=${encodeURIComponent(state.serverId)}&path=${encodeURIComponent(state.jobPath+`/${state.nextBuild}/api/json`)}&tree=number,building,result,duration,estimatedDuration,timestamp`
      );
      const b = r?.data?.data;
      if (!b) return; // not started yet

      if (b.building) {
        const elapsed  = Date.now() - (b.timestamp || Date.now());
        const estTotal = b.estimatedDuration > 0 ? b.estimatedDuration : 0;
        const pct      = estTotal > 0 ? Math.min(95, Math.round(elapsed / estTotal * 100)) : 50;
        const remain   = estTotal > 0 ? Math.max(0, estTotal - elapsed) : null;

        if (fill) fill.style.width = pct + '%';
        if (lbl)  lbl.textContent  = `Building #${b.number}`;
        if (timeEl) {
          const elapsedStr = _fmtSec(elapsed);
          const remainStr  = remain !== null ? ` · เหลือ ~${_fmtSec(remain)}` : '';
          timeEl.textContent = `ผ่านไป ${elapsedStr}${remainStr}`;
        }
        if (pctEl) pctEl.textContent = pct + '%';
      } else {
        // Done
        clearInterval(_jkState[jobId].pollTimer);
        const ok      = b.result === 'SUCCESS';
        const durStr  = _fmtSec(b.duration || 0);
        if (fill) { fill.style.width = '100%'; fill.className = `ilw-jk-progress-fill ${ok ? 'done-ok' : 'done-err'}`; }
        if (lbl)  lbl.textContent  = ok ? `Build #${b.number} สำเร็จ` : `Build #${b.number} ${b.result||'FAILED'}`;
        if (timeEl) timeEl.textContent = `ใช้เวลา ${durStr}`;
        if (pctEl)  pctEl.textContent  = ok ? '100%' : '';

        if (ok) {
          _maDone(jobId, `Build #${b.number} SUCCESS (${durStr})`);
          window.showToast?.(`Build #${b.number} สำเร็จ — ทำการ Mark Done อัตโนมัติแล้ว`, 'success');
        } else {
          window.showToast?.(`Build #${b.number} ${b.result||'FAILED'} — ${durStr}`, 'error');
        }
      }
    } catch(_) {}
  }

  /* ── Jira transition helpers ───────────────────────────── */
  function _buildTransFields(fields) {
    return Object.entries(fields).map(([key,f]) => {
      const req = f.required ? '<span class="ilw-inv-req">*</span>' : '';
      if (f.allowedValues?.length) {
        return `<div class="ilw-inv-field">
          <label class="ilw-inv-label">${_e(f.name)} ${req}</label>
          <select class="ilw-inv-select" name="${_e(key)}">
            <option value="">— เลือก —</option>
            ${f.allowedValues.map(v=>`<option value="${_e(v.id||v.value||v.name)}">${_e(v.name||v.value)}</option>`).join('')}
          </select>
        </div>`;
      }
      const isLong = /desc|comment|detail|note/i.test(f.name||'');
      if (isLong) return `<div class="ilw-inv-field">
        <label class="ilw-inv-label">${_e(f.name)} ${req}</label>
        <textarea class="ilw-inv-textarea" name="${_e(key)}" placeholder="${_e(f.name)}"></textarea>
      </div>`;
      return `<div class="ilw-inv-field">
        <label class="ilw-inv-label">${_e(f.name)} ${req}</label>
        <input class="ilw-inv-input" type="text" name="${_e(key)}" placeholder="${_e(f.name)}">
      </div>`;
    }).join('');
  }

  async function _submitTransition(key, transId) {
    const form   = _el('ilw-inv-form');
    const fields = {};
    form?.querySelectorAll('[name]').forEach(el=>{ if(el.value) fields[el.name]=el.value; });
    try {
      await API.post('/incident-launcher/index.php', { action:'jira_do_transition', key, transition_id:transId, fields });
      window.showToast?.(`เปลี่ยน status → Investigating สำเร็จ`, 'success');
      _log(`${key} → Investigating`);
      next();
    } catch(e) {
      window.showToast?.(`Transition ไม่สำเร็จ: ${e?.message||''}`, 'error');
    }
  }

  /* ── Finish ────────────────────────────────────────────── */
  function _showFinish() {
    const area = _el('ilw-area');
    if (!area) return;
    area.innerHTML = `
      <div class="ilw-step-wrap enter-r">
        <div class="ilw-finish">
          <div class="ilw-finish-icon"><i data-icon="check-circle" style="font-size:36px"></i></div>
          <div class="ilw-finish-title">เสร็จสิ้น</div>
          <div class="ilw-finish-sub">Incident Launcher ทำงานครบทุก step แล้ว<br>Ticket: <strong style="color:#6366f1">${_e(_ticket||'—')}</strong></div>
          <button class="ilwb ilwb--secondary" onclick="ILW.close()">ปิด</button>
        </div>
      </div>`;
    if (window.Icons) Icons.replaceAll(area);
    const footer = document.querySelector('.ilw-footer');
    if (footer) footer.style.display = 'none';
  }

  /* ── Utilities ─────────────────────────────────────────── */
  function _fillTpl(tpl) {
    return (tpl||'')
      .replace(/\{title\}/g,    _inc.title    ||'—')
      .replace(/\{service\}/g,  _inc.service  ||'—')
      .replace(/\{severity\}/g, (_inc.severity||'').toUpperCase())
      .replace(/\{sev\}/g,      (_inc.severity||'').toUpperCase())
      .replace(/\{time\}/g,     _inc.time     ||'—')
      .replace(/\{ticket\}/g,   _ticket       ||'—')
      .replace(/\{reporter\}/g, _inc.reporter ||'—');
  }

  function _highlightVars(html) {
    return html.replace(/\{[^}]+\}/g, m=>`<var>${m}</var>`);
  }

  function _log(msg) {
    const ts = new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    _tl.unshift({ ts, msg });
    const list = _el('ilw-tl-list');
    if (list) {
      const row = document.createElement('div');
      row.className = 'ilw-tl-row';
      row.innerHTML = `<div class="ilw-tl-ts">${ts}</div><div class="ilw-tl-msg">${_e(msg)}</div>`;
      list.prepend(row);
    }
  }

  /* ── Email send ────────────────────────────────────────── */
  function _parseExtraEmails(id) {
    const val = (_el(id)?.value || '').trim();
    if (!val) return [];
    return val.split(/[,;\n]+/).map(e => e.trim()).filter(e => e.includes('@'));
  }

  async function _sendEmail() {
    const btn     = _el('ilw-email-send-btn');
    const status  = _el('ilw-email-status');
    const subject = (_el('ilw-email-subj')?.value || '').trim();
    const bodyTxt = (_el('ilw-email-body')?.value || '').trim();

    // Collect To: configured chips + extra input
    const groups   = _cfg.partner_groups || [];
    const defaults = _cfg.default_partners || [];
    const toBase   = [...new Set([...groups.flatMap(g => g.to_emails || g.emails || []),  ...defaults].filter(e=>e?.includes('@')))];
    const ccBase   = [...new Set(groups.flatMap(g => g.cc_emails  || []).filter(e=>e?.includes('@')))];
    const bccBase  = [...new Set(groups.flatMap(g => g.bcc_emails || []).filter(e=>e?.includes('@')))];

    const toList  = [...new Set([...toBase,  ..._parseExtraEmails('ilw-email-to-extra')])];
    const ccList  = [...new Set([...ccBase,  ..._parseExtraEmails('ilw-email-cc-extra')])];
    const bccList = [...new Set([...bccBase, ..._parseExtraEmails('ilw-email-bcc-extra')])];

    if (!subject) { window.showToast?.('กรุณาระบุหัวเรื่อง', 'error'); return; }
    if (!bodyTxt) { window.showToast?.('กรุณาระบุเนื้อหา', 'error'); return; }
    if (!toList.length && !ccList.length) { window.showToast?.('กรุณาระบุผู้รับ (To หรือ CC)', 'error'); return; }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-icon="loader"></i> กำลังส่ง…'; }
    if (status) status.textContent = '';
    if (window.Icons) Icons.replaceAll(btn);

    try {
      await API.post('/mail/send.php', {
        to:      toList,
        cc:      ccList,
        bcc:     bccList,
        subject,
        body:    bodyTxt.replace(/\n/g, '<br>'),
        isHtml:  true,
      });
      const total = toList.length + ccList.length + bccList.length;
      if (btn) btn.innerHTML = '<i data-icon="check"></i> ส่งแล้ว';
      if (status) status.textContent = `To: ${toList.length}${ccList.length?` · CC: ${ccList.length}`:''}${bccList.length?` · BCC: ${bccList.length}`:''} — เรียบร้อย`;
      if (window.Icons) Icons.replaceAll(btn);
      _setStepMeta('email', 'done', `ส่ง ${total} recipients`);
      _updateNavDots();
      _log(`Email: To ${toList.length}${ccList.length?` CC ${ccList.length}`:''}${bccList.length?` BCC ${bccList.length}`:''} — "${subject}"`);
      window.showToast?.('ส่ง Email เรียบร้อย', 'success');
    } catch(e) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-icon="send"></i> ส่ง Email อีกครั้ง'; }
      if (status) status.textContent = `ส่งไม่สำเร็จ: ${e?.message||'error'}`;
      if (window.Icons) Icons.replaceAll(btn);
      window.showToast?.(`ส่ง email ไม่สำเร็จ: ${e?.message||''}`, 'error');
    }
  }

  function _el(id)       { return document.getElementById(id); }
  function _html(id,h)   { const e=_el(id); if(e) e.innerHTML=h; }
  function _e(s)         { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _delay(ms)    { return new Promise(r=>setTimeout(r,ms)); }

  /* expose for onclick handlers */
  return { open, close, next, prev, skip, jumpTo, _meetOpened, _sendCh, _copyCh, _chTab, _notifyResolved, _maDone, _maJenkins, _jkBuild, _submitJira, _jiraFaultMode, _invSelectTrans, _invCancelTrans, _invDoTransition, _invLoadManual, _invChangeTicket, _sendEmail, _boEditOpen, _boEditCancel, _boEditSave, _spSelect };
})();

/* ── Global launch entry-point — called directly from button onclick ── */
window._ilwLaunch = function(caseObj) {
  const el = document.getElementById('ilw');
  if (!el) { console.error('[ILW] #ilw not found'); return; }

  const inc = {
    title:       '',
    service:     '',
    severity:    'sev1',
    time:        new Date().toISOString().slice(0,16),
    reporter:    '',
    description: '',
    partners:    [],
  };

  let cfg = {};
  try { cfg = (typeof IL !== 'undefined' && typeof IL._getConfig === 'function') ? IL._getConfig() : {}; } catch(_) {}

  el.style.display = 'flex';
  ILW.open(inc, cfg, caseObj || null);
};
