// pipeline-flow — page script, extracted from pipeline-flow.html.
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

Auth.requireAuth();
  Layout.render('batch-monitor');

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const urlify = (s) => esc(s).replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  // Safe wrappers — use SOMDialog / Toast from utils.js if loaded, else fall back.
  // Prevents "SOMDialog is not defined" when utils.js is stale-cached in browser.
  const dlg = {
    alert:   (m, o) => (typeof SOMDialog !== 'undefined')
      ? SOMDialog.alert(m, o)
      : Promise.resolve(window.alert(String(m).replace(/<[^>]+>/g, ''))),
    confirm: (m, o) => (typeof SOMDialog !== 'undefined')
      ? SOMDialog.confirm(m, o)
      : Promise.resolve(window.confirm(String(m).replace(/<[^>]+>/g, ''))),
  };
  const toast = (msg, kind) => {
    if (typeof Toast !== 'undefined') Toast[kind || 'success']?.(msg);
  };

  const COLOR_MAP = {
    blue:'success', blue_anime:'running', red:'failure', red_anime:'running',
    yellow:'unstable', yellow_anime:'running', grey:'disabled', grey_anime:'running',
    notbuilt:'notbuilt', notbuilt_anime:'running', aborted:'aborted', aborted_anime:'running',
    disabled:'disabled',
  };
  const fmtAgo = (ms) => {
    if (!ms) return '';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60)    return s + 's ago';
    if (s < 3600)  return Math.floor(s/60)  + 'm ago';
    if (s < 86400) return Math.floor(s/3600)+ 'h ago';
    return Math.floor(s/86400) + 'd ago';
  };
  const ICO_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg>';
  const ICO_DB   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>';

  const PF = {
    index: null,             // { orgs, flows:[summary] }
    flow: null,              // full loaded flow
    jobsMap: {},
    selOrg: null,
    selFlowId: null,
    selJob: null,
    _refreshTimer: null,

    async init() {
      await this.loadIndex();
      // Restore last selection from sessionStorage
      try {
        const s = JSON.parse(sessionStorage.getItem('_pf_state') || '{}');
        if (s.org)    this.selOrg    = s.org;
        if (s.flowId) this.selFlowId = s.flowId;
      } catch {}
      // Default to first org / flow if nothing selected
      if (!this.selOrg && this.index.orgs.length) this.selOrg = this.index.orgs[0];
      this._renderNav();
      if (this.selFlowId && this.index.flows.some(f => f.id === this.selFlowId)) {
        await this.loadFlow(this.selFlowId);
      } else {
        this._renderLanding();
      }
      // Kick off Jenkins fetch — populates status pills across all cards
      this._fetchJenkins().catch(err => console.warn('Jenkins fetch:', err));
      clearInterval(this._refreshTimer);
      this._refreshTimer = setInterval(() => this._fetchJenkins().catch(()=>{}), 60_000);
    },

    async loadIndex() {
      try {
        const res = await API.get('/pipeline-flows/index.php');
        if (!res?.ok || !res?.data?.data) throw new Error(res?.data?.message || 'load failed');
        this.index = res.data.data;
        const jobsTotal = this.index.flows.reduce((s,f) => s + (f.job_count || 0), 0);
        $('pf-h-orgs').textContent  = this.index.orgs.length;
        $('pf-h-flows').textContent = this.index.flows.length;
        $('pf-h-jobs').textContent  = jobsTotal;
      } catch (e) {
        $('pf-main').innerHTML = `<div class="pf-card"><div class="pf-empty" style="color:var(--hot)">โหลดไม่สำเร็จ · ${esc(e.message||e)}</div></div>`;
      }
    },

    async loadFlow(id) {
      this.selFlowId = id; this.selJob = null;
      this._saveState();
      try {
        const res = await API.get('/pipeline-flows/index.php?flow=' + encodeURIComponent(id));
        if (!res?.ok || !res?.data?.data?.flow) throw new Error(res?.data?.message || 'load failed');
        this.flow = res.data.data.flow;
        this._renderNav();
        this._renderFlow();
      } catch (e) {
        $('pf-main').innerHTML = `<div class="pf-card"><div class="pf-empty" style="color:var(--hot)">โหลดไม่สำเร็จ · ${esc(e.message||e)}</div></div>`;
      }
    },

    async _fetchJenkins() {
      const sres = await API.jenkins.servers();
      const servers = sres?.data?.data || [];
      const TREE = 'jobs[name,color,url,lastBuild[number,timestamp,result,duration],jobs[name,color,url,lastBuild[number,timestamp,result,duration]]]';
      const results = await Promise.all(servers.map(async s => {
        try {
          const r = await API.jenkins.jobs(s.id, TREE);
          return { server: s, jobs: r?.data?.data?.jobs || [] };
        } catch { return { server: s, jobs: [] }; }
      }));
      const map = {};
      const walk = (arr, serverId, folder) => {
        for (const j of arr) {
          if (Array.isArray(j.jobs)) walk(j.jobs, serverId, (folder ? folder + '/' : '') + j.name);
          else if (j.name && j.color !== undefined) {
            map[j.name.toLowerCase()] = {
              status:   COLOR_MAP[j.color] || 'notbuilt',
              color:    j.color,
              buildNo:  j.lastBuild?.number || null,
              ts:       j.lastBuild?.timestamp || null,
              result:   j.lastBuild?.result || null,
              duration: j.lastBuild?.duration || null,
              url:      j.url || null,
              server:   serverId, folder,
            };
          }
        }
      };
      results.forEach(r => walk(r.jobs, r.server.id, ''));
      this.jobsMap = map;
      if (this.flow && this.selFlowId) { this._renderFlow(); if (this.selJob) this._renderDetail(this.selJob); }
    },

    _lookup(pattern) {
      const p = (pattern || '').toLowerCase();
      if (this.jobsMap[p]) return this.jobsMap[p];
      for (const [k, v] of Object.entries(this.jobsMap)) {
        if (k === p || k.endsWith('-' + p) || k.endsWith('/' + p) || k.includes(p)) return v;
      }
      return null;
    },

    _saveState() {
      try { sessionStorage.setItem('_pf_state', JSON.stringify({ org: this.selOrg, flowId: this.selFlowId })); } catch {}
    },

    _renderNav() {
      const isSm = Auth.getUser?.()?.team === 'sm';

      // Org chips
      const orgs = this.index.orgs;
      const orgChips = orgs.map(o => {
        const n = this.index.flows.filter(f => f.org === o).length;
        return `<button type="button" class="pf-chip org ${this.selOrg===o?'on':''}" data-org="${esc(o)}">
                  <span>${esc(o)}</span><span class="n">${n}</span>
                </button>`;
      }).join('');
      $('pf-orgs').innerHTML = orgChips
        + (isSm ? `<button type="button" class="pf-chip add" onclick="PF.openCreate()" title="สร้าง flow ใหม่ (เลือก org ในหน้าต่างถัดไป)">+ New Flow</button>` : '');
      $('pf-orgs').querySelectorAll('[data-org]').forEach(el => {
        el.addEventListener('click', () => { this.selOrg = el.dataset.org; this.selFlowId = null; this.flow = null; this._saveState(); this._renderNav(); this._renderLanding(); });
      });

      // Flow chips for selected org
      const orgFlows = this.index.flows.filter(f => f.org === this.selOrg);
      $('pf-flows').innerHTML = orgFlows.length
        ? orgFlows.map(f => `<button type="button" class="pf-chip ${this.selFlowId===f.id?'on':''}" data-flow="${esc(f.id)}">
              <span>${esc(f.name)}</span><span class="n">${f.job_count}</span>
            </button>`).join('')
        : `<span style="font-size:11.5px; color:var(--text-muted); font-style:italic">${isSm ? 'ยังไม่มี flow ใน org นี้ — กด + New Flow ด้านบนเพื่อสร้าง' : 'ยังไม่มี flow ใน org นี้'}</span>`;
      $('pf-flows').querySelectorAll('[data-flow]').forEach(el => {
        el.addEventListener('click', () => this.loadFlow(el.dataset.flow));
      });

      if (isSm && this.selFlowId) $('pf-btn-add-edge').style.display = '';
      else $('pf-btn-add-edge').style.display = 'none';
    },

    _renderLanding() {
      const orgFlows = this.index.flows.filter(f => f.org === this.selOrg);
      $('pf-main').innerHTML = `
        <div class="pf-card">
          <div class="pf-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            <div class="pf-empty-title">${esc(this.selOrg || 'Select an org')}</div>
            <div class="pf-empty-sub">
              ${orgFlows.length ? `เลือก flow จากด้านบน (${orgFlows.length} รายการ) เพื่อดูรายละเอียด jobs + chain + build status` : 'ยังไม่มี flow — กด + New Flow ที่แถบ Org ด้านบนเพื่อสร้าง'}
            </div>
          </div>
        </div>`;
    },

    _renderFlow() {
      const f = this.flow;
      if (!f) return;
      const isSm = Auth.getUser?.()?.team === 'sm';
      const emptyBlock = f.jobs.length === 0 ? `
        <div class="pf-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
          <div class="pf-empty-title">ยังไม่มี job ใน flow นี้</div>
          <div class="pf-empty-sub">${isSm ? 'กด <b>+ Add Job</b> ด้านขวาเพื่อเพิ่ม' : 'รอ SM Team เพิ่ม jobs'}</div>
        </div>` : null;

      // Phase 1 — insert outer shell with EMPTY flow slot so we can measure its width
      $('pf-main').innerHTML = `
        <div class="pf-grid">
          <div class="pf-card">
            <div class="pf-card-head">
              <div class="pf-card-title">${esc(f.name)} <span style="color:var(--text-muted); font-weight:400">· ${f.jobs.length} jobs</span></div>
              <div class="pf-card-hint">
                <span class="pf-legend"><span class="swatch auto"></span>auto</span>
                <span class="pf-legend"><span class="swatch user"></span>declared</span>
                ${isSm ? `<button class="pf-icon-btn" onclick="PF.openJob()" title="เพิ่ม job">+ Add Job</button>` : ''}
                ${isSm ? `<button class="pf-icon-btn" onclick="PF.deleteFlow()" title="ลบ flow นี้">🗑 Delete</button>` : ''}
              </div>
            </div>
            ${emptyBlock || `<div id="pf-flow-slot" class="pf-flow"></div>`}
          </div>
          <div class="pf-card pf-detail" id="pf-detail-card">
            <div class="pf-card-head"><div class="pf-card-title">Job Detail</div></div>
            <div id="pf-detail-body" class="pf-detail-empty">
              คลิก job ในแผนภาพเพื่อดูรายละเอียด<br>
              <span style="font-size:11px; opacity:.7">Purpose · Schedule · Source/Output · DB · Chain</span>
            </div>
          </div>
        </div>`;

      if (emptyBlock) { if (this.selJob) this._renderDetail(this.selJob); return; }

      // Phase 2 — measure actual flow slot width and paint canvas
      this._paintFlow();
      if (this.selJob) this._renderDetail(this.selJob);
    },

    _paintFlow() {
      const f = this.flow;
      if (!f) return;
      const slot = $('pf-flow-slot');
      if (!slot) return;

      const laneW = 260, laneGap = 16, nodeH = 96, nodeGap = 14, padTop = 34, padSide = 12;
      const cats = [...new Set(f.jobs.map(j => j.category).filter(Boolean))];
      const realLanes = cats.length ? cats : [f.name];
      const realByLane = {};
      realLanes.forEach(c => {
        realByLane[c] = f.jobs
          .filter(j => (cats.length ? j.category === c : true))
          .sort((a,b) => (a.schedule?.sort_key ?? 9999) - (b.schedule?.sort_key ?? 9999));
      });

      // Measure ACTUAL flow slot inner width (already laid out by browser)
      const slotStyle = getComputedStyle(slot);
      const padH = parseFloat(slotStyle.paddingLeft) + parseFloat(slotStyle.paddingRight);
      const availW = Math.max(laneW + 60, slot.clientWidth - padH);
      const maxCols = Math.max(1, Math.floor((availW + laneGap) / (laneW + laneGap)));

      let lanes = realLanes;
      let byLane = realByLane;
      let umbrellaLabel = null;
      if (realLanes.length === 1 && realByLane[realLanes[0]].length > maxCols) {
        const jobs = realByLane[realLanes[0]];
        const cols = Math.min(maxCols, jobs.length);
        const rows = Math.ceil(jobs.length / cols);
        lanes = [];
        byLane = {};
        for (let c = 0; c < cols; c++) {
          const key = '__vcol_' + c;
          lanes.push(key);
          byLane[key] = jobs.slice(c*rows, (c+1)*rows);
        }
        umbrellaLabel = realLanes[0];
      }

      const maxRows = Math.max(1, ...Object.values(byLane).map(a => a.length));
      const height  = padTop + maxRows * (nodeH + nodeGap) + 20;
      const width   = padSide*2 + lanes.length * laneW + Math.max(0, lanes.length-1) * laneGap;

      const pos = {};
      lanes.forEach((c, ci) => {
        const laneX = padSide + ci*(laneW + laneGap);
        byLane[c].forEach((j, ji) => {
          pos[j.pattern] = { x: laneX + 12, y: padTop + ji*(nodeH + nodeGap), w: laneW - 24, h: nodeH };
        });
      });

      const edgeKey = (e) => e.from + '→' + e.to;
      const userSet = new Set(f.user_edges.map(edgeKey));
      const edges = [
        ...f.auto_edges.filter(e => !userSet.has(edgeKey(e))).map(e => ({...e, kind:'auto'})),
        ...f.user_edges.map(e => ({...e, kind:'user'})),
      ];
      const hi = new Set();
      if (this.selJob) edges.forEach(e => {
        if (e.from === this.selJob || e.to === this.selJob) hi.add(edgeKey(e));
      });
      const edgePath = (a, b) => {
        const x1 = a.x + a.w/2, y1 = a.y + a.h;
        const x2 = b.x + b.w/2, y2 = b.y;
        if (Math.abs(x1 - x2) < 2) return `M${x1},${y1} L${x2},${y2}`;
        if (y2 > y1) {
          const midY = (y1 + y2) / 2;
          return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
        }
        const dip = y1 + 18;
        return `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2 - 18} L${x2},${y2}`;
      };

      let laneBg = '';
      if (umbrellaLabel) {
        laneBg = `<rect class="pf-lane-bg" x="${padSide}" y="${padTop-22}" width="${width - padSide*2}" height="${height - padTop + 4}" rx="10"/>
                  <text class="pf-lane-lbl" x="${padSide + (width - padSide*2)/2}" y="${padTop - 8}" text-anchor="middle">${esc(umbrellaLabel)}</text>`;
      } else {
        lanes.forEach((c, ci) => {
          const x = padSide + ci*(laneW + laneGap);
          laneBg += `<rect class="pf-lane-bg" x="${x}" y="${padTop-22}" width="${laneW}" height="${height - padTop + 4}" rx="10"/>`;
          laneBg += `<text class="pf-lane-lbl" x="${x + laneW/2}" y="${padTop - 8}" text-anchor="middle">${esc(c)}</text>`;
        });
      }
      let edgesSvg = '';
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        const cls = ['pf-edge']; if (e.kind === 'user') cls.push('user'); if (hi.has(edgeKey(e))) cls.push('hi');
        edgesSvg += `<path class="${cls.join(' ')}" d="${edgePath(a,b)}"></path>`;
      });

      const dimmed = (pat) => this.selJob && this.selJob !== pat
        && !edges.some(e => (e.from === this.selJob && e.to === pat) || (e.to === this.selJob && e.from === pat));

      const statusPill = (jj) => {
        if (!jj) return `<span class="pf-status nodata"><span class="d"></span>no data</span>`;
        const label = jj.status === 'success' ? `#${jj.buildNo}` :
                      jj.status === 'failure' ? `FAIL #${jj.buildNo}` :
                      jj.status === 'running' ? `RUN…` :
                      jj.status === 'unstable'? `UNSTBL` :
                      jj.status === 'aborted' ? `ABORT` :
                      jj.status === 'notbuilt'? `no build` :
                      jj.status === 'disabled'? `disabled` : jj.status;
        return `<span class="pf-status ${jj.status}"><span class="d"></span>${esc(label)}</span>`;
      };

      let nodesHtml = '';
      Object.entries(pos).forEach(([pat, p]) => {
        const j = f.jobs.find(x => x.pattern === pat);
        if (!j) return;
        const jj = this._lookup(pat);
        const cls = ['pf-node']; if (jj?.status) cls.push('st-' + jj.status);
        if (this.selJob === pat) cls.push('sel');
        if (dimmed(pat)) cls.push('dim');
        const isCrit = /yes/i.test(j.critical || '');
        const time = j.schedule?.time || '—';
        const ago = jj?.ts ? fmtAgo(jj.ts) : '';
        const openUrl = jj?.url ? `<a href="${esc(jj.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="เปิดใน Jenkins" style="color:var(--text-muted); flex-shrink:0; display:inline-flex" onmouseover="this.style.color='var(--cool)'" onmouseout="this.style.color='var(--text-muted)'"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>` : '';
        nodesHtml += `
          <div class="${cls.join(' ')}" data-pat="${esc(pat)}" style="left:${p.x}px; top:${p.y}px; width:${p.w}px; height:${p.h}px">
            <div class="pf-node-row1">
              <span class="pf-node-name" title="${esc(pat)}">${esc(pat)}</span>
              ${isCrit ? '<span class="pf-node-crit">CRIT</span>' : ''}
              ${openUrl}
            </div>
            <div class="pf-node-row2">
              ${statusPill(jj)}
              ${ago ? `<span style="opacity:.85">· ${esc(ago)}</span>` : ''}
            </div>
            <div class="pf-node-meta"><b>${esc(time)}</b>${j.schedule?.frequency ? ' · ' + esc(j.schedule.frequency) : ''}${j.dev_owner ? ' · ' + esc(j.dev_owner.slice(0,22)) : ''}</div>
          </div>`;
      });

      slot.innerHTML = `
        <div class="pf-canvas" style="width:${width}px; height:${height}px">
          <svg class="arrows" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
            <defs>
              <marker id="pf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="currentColor"></path>
              </marker>
            </defs>
            ${laneBg}${edgesSvg}
          </svg>
          ${nodesHtml}
        </div>`;

      slot.querySelectorAll('.pf-node').forEach(el => {
        el.addEventListener('click', () => {
          const pat = el.dataset.pat;
          this.selJob = (this.selJob === pat) ? null : pat;
          this._paintFlow();   // repaint without rebuilding shell
          if (this.selJob) this._renderDetail(this.selJob);
        });
      });
    },

    _renderDetail(pat) {
      const f = this.flow;
      const j = f.jobs.find(x => x.pattern === pat);
      const body = $('pf-detail-body');
      if (!j) { body.className = 'pf-detail-empty'; body.innerHTML = 'ไม่พบ job นี้'; return; }
      body.className = 'pf-detail-body';

      const chips = [];
      if (/yes/i.test(j.critical || '')) chips.push('<span class="pf-chip-tag crit">CRITICAL</span>');
      if (/yes/i.test(j.monitor  || '')) chips.push('<span class="pf-chip-tag ok">MONITORED</span>');
      if (j.rerun) {
        const cls = /no.*ทันที|no\s*:/i.test(j.rerun) ? 'crit'
                  : /yes.*ทันที|yes\s*:/i.test(j.rerun) ? 'warn'
                  : /yes/i.test(j.rerun) ? 'ok' : 'info';
        chips.push(`<span class="pf-chip-tag ${cls}">Rerun: ${esc(j.rerun.split('\n')[0])}</span>`);
      }
      if (j.schedule?.frequency) chips.push(`<span class="pf-chip-tag info">${esc(j.schedule.frequency)}</span>`);

      const filesIn  = (j.files || []).filter(x => x.io === 'in');
      const filesOut = (j.files || []).filter(x => x.io === 'out');
      const fileList = (arr, cls, tag) => arr.length
        ? arr.map(x => `<div class="pf-file ${cls}"><div class="pf-file-ico">${ICO_FILE}</div><div class="pf-file-body"><div class="pf-file-name">${esc(x.file)}</div>${x.s3?`<div class="pf-file-path">${esc(x.s3)}</div>`:''}</div><span class="pf-file-tag">${tag}</span></div>`).join('')
        : '<div class="pf-empty-hint">—</div>';
      const dbList = (arr) => arr.map(x => `<div class="pf-file db"><div class="pf-file-ico">${ICO_DB}</div><div class="pf-file-body"><div class="pf-file-name">${esc(x)}</div></div><span class="pf-file-tag">DB</span></div>`).join('');

      const key = (e) => e.from + '→' + e.to;
      const userSet = new Set(f.user_edges.map(key));
      const allEdges = [
        ...f.auto_edges.filter(e => !userSet.has(key(e))).map(e => ({...e, kind:'auto'})),
        ...f.user_edges.map(e => ({...e, kind:'user'})),
      ];
      const upstream   = allEdges.filter(e => e.to   === pat);
      const downstream = allEdges.filter(e => e.from === pat);
      const isSm = Auth.getUser?.()?.team === 'sm';
      const chainItem = (e, dir) => {
        const other = dir === 'up' ? e.from : e.to;
        const k = e.kind === 'user' ? '<span class="k user">USER</span>' : '<span class="k">AUTO</span>';
        const del = (isSm && e.kind === 'user')
          ? `<span class="del" onclick="event.stopPropagation();PF.deleteEdge('${esc(e.from)}','${esc(e.to)}')" title="ลบ">×</span>` : '';
        return `<div class="pf-chain-item" onclick="PF.select('${esc(other)}')"><span>${esc(other)}</span><span style="display:flex;align-items:center;gap:4px">${k}${del}</span></div>`;
      };

      const jj = this._lookup(pat);
      const statusRow = jj ? `
        <div class="pf-d-row"><div class="pf-d-lbl">Last Build</div><div class="pf-d-val">
          <span class="pf-status ${jj.status}"><span class="d"></span>${esc(jj.status.toUpperCase())}</span>
          ${jj.buildNo ? `<span style="color:var(--text-muted); margin-left:6px">#${jj.buildNo}</span>` : ''}
          ${jj.ts ? `<span style="color:var(--text-muted); margin-left:6px">· ${esc(new Date(jj.ts).toLocaleString('th-TH'))} <span style="opacity:.7">(${esc(fmtAgo(jj.ts))})</span></span>` : ''}
          ${jj.duration ? `<div style="color:var(--text-muted); font-size:11px; margin-top:2px">Duration: ${Math.round(jj.duration/1000)}s</div>` : ''}
          ${jj.url ? `<div style="margin-top:4px"><a href="${esc(jj.url)}" target="_blank" rel="noopener">เปิดใน Jenkins ↗</a></div>` : ''}
        </div></div>`
        : `<div class="pf-d-row"><div class="pf-d-lbl">Last Build</div><div class="pf-d-val"><span class="pf-status nodata"><span class="d"></span>NO DATA</span> <span style="color:var(--text-muted); font-size:11px">— ไม่พบใน Jenkins</span></div></div>`;

      body.innerHTML = `
        <div class="pf-d-name">${esc(pat)}</div>
        <div class="pf-d-cat">${esc(j.category || f.name)}${j.label && j.label !== pat ? ' · ' + esc(j.label) : ''}</div>
        <div class="pf-d-chips">${chips.join('')}</div>
        ${statusRow}
        <div class="pf-d-row"><div class="pf-d-lbl">Schedule</div><div class="pf-d-val">${esc(j.schedule?.time || '—')}${j.schedule?.frequency ? ' · ' + esc(j.schedule.frequency) : ''}${j.schedule?.date && j.schedule.date !== '-' ? ' · ' + esc(j.schedule.date) : ''}</div></div>
        ${j.purpose ? `<div class="pf-d-row"><div class="pf-d-lbl">Purpose</div><div class="pf-d-val">${esc(j.purpose)}</div></div>` : ''}
        <div class="pf-d-row"><div class="pf-d-lbl">Jenkins</div><div class="pf-d-val"><span class="pf-mono">${esc(j.jenkins_raw || pat)}</span></div></div>
        ${j.dev_owner   ? `<div class="pf-d-row"><div class="pf-d-lbl">Dev Owner</div><div class="pf-d-val">${esc(j.dev_owner)}${j.dev_owner_detail ? '<br><span style="font-size:11px;color:var(--text-muted);white-space:pre-line">' + esc(j.dev_owner_detail) + '</span>' : ''}</div></div>` : ''}
        ${j.user_owners ? `<div class="pf-d-row"><div class="pf-d-lbl">User Owner</div><div class="pf-d-val">${esc(j.user_owners)}${j.user_group ? ' <span style="color:var(--text-muted);font-size:11px">(' + esc(j.user_group) + ')</span>' : ''}</div></div>` : ''}
        ${j.params      ? `<div class="pf-d-row"><div class="pf-d-lbl">Params</div><div class="pf-d-val">${esc(j.params)}</div></div>` : ''}
        ${j.confluence  ? `<div class="pf-d-row"><div class="pf-d-lbl">Confluence</div><div class="pf-d-val">${urlify(j.confluence)}</div></div>` : ''}

        <div class="pf-section"><h4><span>Source Files (IN)</span></h4>${fileList(filesIn, 'in', 'IN')}</div>
        <div class="pf-section"><h4><span>Output Files (OUT)</span></h4>${fileList(filesOut, 'out', 'OUT')}</div>
        ${(j.dbs && j.dbs.length) ? `<div class="pf-section"><h4><span>Databases (${j.dbs.length})</span></h4>${dbList(j.dbs)}</div>` : ''}
        <div class="pf-section"><h4><span>Chain — Upstream (${upstream.length})</span></h4>${upstream.length ? upstream.map(e=>chainItem(e,'up')).join('') : '<div class="pf-empty-hint">—</div>'}</div>
        <div class="pf-section"><h4><span>Chain — Downstream (${downstream.length})</span></h4>${downstream.length ? downstream.map(e=>chainItem(e,'down')).join('') : '<div class="pf-empty-hint">—</div>'}</div>
        ${isSm ? `<div class="pf-section"><button class="btn btn-ghost" style="font-size:11px; color:var(--hot)" onclick="PF.deleteJob('${esc(pat)}')">🗑 Remove job from flow</button></div>` : ''}
      `;
    },

    select(pat) { this.selJob = pat; this._renderFlow(); this._renderDetail(pat); },

    // ── Create flow ──────────
    openCreate() {
      $('pf-c-org').innerHTML = this.index.orgs.map(o => `<option value="${esc(o)}"${o===this.selOrg?' selected':''}>${esc(o)}</option>`).join('');
      $('pf-c-neworg').value = ''; $('pf-c-name').value = '';
      $('pf-mo-create').classList.add('on');
    },
    closeCreate() { $('pf-mo-create')?.classList.remove('on'); },
    async saveCreate() {
      const org  = ($('pf-c-neworg').value || $('pf-c-org').value || '').trim().toUpperCase();
      const name = $('pf-c-name').value.trim();
      if (!org)  return dlg.alert('กรุณากรอก Org', { icon:'warning', title:'ข้อมูลไม่ครบ' });
      if (!name) return dlg.alert('กรุณากรอกชื่อ flow', { icon:'warning', title:'ข้อมูลไม่ครบ' });
      try {
        const res = await API.post('/pipeline-flows/index.php?action=create', { org, name });
        if (!res?.ok || !res?.data?.data?.flow) throw new Error(res?.data?.message || 'create failed');
        this.closeCreate();
        this.selOrg = org;
        await this.loadIndex();
        this._renderNav();
        await this.loadFlow(res.data.data.flow.id);
        toast('สร้าง flow เรียบร้อย');
      } catch (e) { dlg.alert('สร้างไม่สำเร็จ: ' + (e.message||e), { icon:'danger', title:'ผิดพลาด' }); }
    },

    async deleteFlow() {
      if (!this.flow) return;
      const ok = await dlg.confirm(
        `ลบ flow <b>${esc(this.flow.name)}</b> พร้อม ${this.flow.jobs.length} jobs ทั้งหมด?<br><br>การลบไม่สามารถ undo ได้`,
        { title:'ยืนยันการลบ', icon:'danger', okLabel:'ลบ', okColor:'danger' }
      );
      if (!ok) return;
      try {
        const res = await API.delete('/pipeline-flows/index.php?flow=' + encodeURIComponent(this.selFlowId));
        if (!res?.ok || !res?.data?.ok) throw new Error(res?.data?.message || 'delete failed');
        this.selFlowId = null; this.flow = null; this.selJob = null;
        this._saveState();
        await this.loadIndex();
        this._renderNav();
        this._renderLanding();
        toast('ลบ flow เรียบร้อย');
      } catch (e) { dlg.alert('ลบไม่สำเร็จ: ' + (e.message||e), { icon:'danger' }); }
    },

    // ── Add job (rich fields) ──────────
    openJob() {
      const ids = ['pf-j-pattern','pf-j-category','pf-j-label','pf-j-purpose',
                   'pf-j-time','pf-j-freq','pf-j-date','pf-j-rerun',
                   'pf-j-owner','pf-j-owner-detail','pf-j-userowner','pf-j-usergroup',
                   'pf-j-files-in','pf-j-files-out','pf-j-dbs',
                   'pf-j-params','pf-j-confluence'];
      ids.forEach(id => { const el = $(id); if (el) el.value = ''; });
      $('pf-j-sort').value = '9999';
      $('pf-j-critical').value = ''; $('pf-j-monitor').value = '';
      // Prefill sub-category with current flow name (common case: category = flow name)
      if (this.flow) $('pf-j-category').value = this.flow.name;
      // Reset to first tab
      document.querySelectorAll('#pf-mo-job .pf-jtab').forEach(t => t.classList.toggle('on', t.dataset.jtab === 'basic'));
      document.querySelectorAll('#pf-mo-job .pf-jpane').forEach(p => p.classList.toggle('on', p.dataset.pane === 'basic'));
      $('pf-mo-job').classList.add('on');
    },
    closeJob() { $('pf-mo-job')?.classList.remove('on'); },

    _parseFiles(text) {
      // Each line = "filename | s3path"  (s3path optional)
      return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [file, s3] = line.split('|').map(s => (s || '').trim());
        return { file, s3: s3 || '' };
      });
    },
    _parseDbs(text) {
      // Support both newlines and commas
      return text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    },

    async saveJob() {
      const pattern = $('pf-j-pattern').value.trim();
      if (!pattern) return dlg.alert('กรุณากรอก Jenkins Job Name', { icon:'warning', title:'ข้อมูลไม่ครบ' });

      const filesIn  = this._parseFiles($('pf-j-files-in').value).map(f => ({ ...f, io:'in'  }));
      const filesOut = this._parseFiles($('pf-j-files-out').value).map(f => ({ ...f, io:'out' }));

      const body = {
        pattern,
        jenkins_raw: pattern,
        category:    $('pf-j-category').value.trim() || (this.flow?.name || ''),
        label:       $('pf-j-label').value.trim() || pattern,
        purpose:     $('pf-j-purpose').value.trim(),
        sched_time:  $('pf-j-time').value.trim(),
        frequency:   $('pf-j-freq').value.trim(),
        sched_date:  $('pf-j-date').value.trim(),
        sort_key:    parseInt($('pf-j-sort').value, 10) || 9999,
        critical:    $('pf-j-critical').value,
        monitor:     $('pf-j-monitor').value,
        rerun:       $('pf-j-rerun').value.trim(),
        dev_owner:   $('pf-j-owner').value.trim(),
        dev_owner_detail: $('pf-j-owner-detail').value.trim(),
        user_owners: $('pf-j-userowner').value.trim(),
        user_group:  $('pf-j-usergroup').value.trim(),
        params:      $('pf-j-params').value.trim(),
        confluence:  $('pf-j-confluence').value.trim(),
        files:       [...filesIn, ...filesOut],
        dbs:         this._parseDbs($('pf-j-dbs').value),
      };
      try {
        const res = await API.post('/pipeline-flows/index.php?flow=' + encodeURIComponent(this.selFlowId) + '&action=add-job', body);
        if (!res?.ok || !res?.data?.ok) throw new Error(res?.data?.message || 'save failed');
        this.closeJob();
        await this.loadFlow(this.selFlowId);
        await this.loadIndex(); this._renderNav();
        toast('บันทึก job เรียบร้อย');
      } catch (e) { dlg.alert('บันทึกไม่สำเร็จ: ' + (e.message||e), { icon:'danger' }); }
    },

    async deleteJob(pattern) {
      const ok = await dlg.confirm(
        `ลบ job <b>${esc(pattern)}</b> จาก flow นี้?`,
        { title:'ยืนยันการลบ', icon:'danger', okLabel:'ลบ', okColor:'danger' }
      );
      if (!ok) return;
      try {
        const res = await API.post('/pipeline-flows/index.php?flow=' + encodeURIComponent(this.selFlowId) + '&action=delete-job', { pattern });
        if (!res?.ok || !res?.data?.ok) throw new Error(res?.data?.message || 'delete failed');
        this.selJob = null;
        await this.loadFlow(this.selFlowId);
        await this.loadIndex(); this._renderNav();
        toast('ลบ job เรียบร้อย');
      } catch (e) { dlg.alert('ลบไม่สำเร็จ: ' + (e.message||e), { icon:'danger' }); }
    },

    // ── Chain edit ──────────
    openEdge() {
      if (!this.flow || !this.flow.jobs.length) return dlg.alert('ยังไม่มี job ใน flow นี้ — เพิ่ม job ก่อน', { icon:'info', title:'Flow ว่าง' });
      const opts = this.flow.jobs.map(j => `<option value="${esc(j.pattern)}">${esc(j.pattern)}</option>`).join('');
      $('pf-e-from').innerHTML = opts; $('pf-e-to').innerHTML = opts;
      if (this.selJob) $('pf-e-from').value = this.selJob;
      $('pf-e-note').value = '';
      $('pf-mo-edge').classList.add('on');
    },
    closeEdge() { $('pf-mo-edge')?.classList.remove('on'); },
    async saveEdge() {
      const from = $('pf-e-from').value, to = $('pf-e-to').value, note = $('pf-e-note').value;
      if (!from || !to || from === to) return dlg.alert('เลือก from และ to ที่ต่างกัน', { icon:'warning' });
      try {
        const res = await API.post('/pipeline-flows/index.php?flow=' + encodeURIComponent(this.selFlowId) + '&action=add-edge', { from, to, note });
        if (!res?.ok || !res?.data?.ok) throw new Error(res?.data?.message || 'save failed');
        this.closeEdge();
        await this.loadFlow(this.selFlowId);
        toast('เพิ่ม chain เรียบร้อย');
      } catch (e) { dlg.alert('บันทึกไม่สำเร็จ: ' + (e.message||e), { icon:'danger' }); }
    },
    async deleteEdge(from, to) {
      const ok = await dlg.confirm(
        `ลบ chain: <b>${esc(from)}</b> → <b>${esc(to)}</b>?`,
        { title:'ยืนยันการลบ', icon:'danger', okLabel:'ลบ', okColor:'danger' }
      );
      if (!ok) return;
      try {
        const res = await API.post('/pipeline-flows/index.php?flow=' + encodeURIComponent(this.selFlowId) + '&action=delete-edge', { from, to });
        if (!res?.ok || !res?.data?.ok) throw new Error(res?.data?.message || 'delete failed');
        await this.loadFlow(this.selFlowId);
      } catch (e) { dlg.alert('ลบไม่สำเร็จ: ' + (e.message||e), { icon:'danger' }); }
    },
  };

  // Wire modal tab switching
  document.addEventListener('click', ev => {
    const t = ev.target.closest('.pf-jtab');
    if (!t) return;
    const modal = t.closest('#pf-mo-job');
    if (!modal) return;
    const which = t.dataset.jtab;
    modal.querySelectorAll('.pf-jtab').forEach(x => x.classList.toggle('on', x.dataset.jtab === which));
    modal.querySelectorAll('.pf-jpane').forEach(p => p.classList.toggle('on', p.dataset.pane === which));
  });

  $('pf-btn-add-edge').addEventListener('click', () => PF.openEdge());
  $('pf-btn-reset').addEventListener('click', () => { PF.selJob = null; if (PF.flow) PF._renderFlow(); });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { PF.closeCreate(); PF.closeJob(); PF.closeEdge(); }
  });

  // Repaint flow when window resizes (re-computes column count for the flow slot)
  let _rzT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_rzT);
    _rzT = setTimeout(() => { if (PF.flow && $('pf-flow-slot')) PF._paintFlow(); }, 150);
  });

  PF.init();

})();
