// collection-lead-flow — page script, extracted from collection-lead-flow.html.
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
  Layout.render('batch-monitor');   // stay highlighted under Batch Monitor in sidebar

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const urlify = (s) => esc(s).replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  // Jenkins color → normalized status
  const COLOR_MAP = {
    blue: 'success', blue_anime: 'running',
    red:  'failure', red_anime:  'running',
    yellow: 'unstable', yellow_anime: 'running',
    grey: 'disabled', grey_anime: 'running',
    notbuilt: 'notbuilt', notbuilt_anime: 'running',
    aborted: 'aborted', aborted_anime: 'running',
    disabled: 'disabled',
  };

  const fmtAgo = (ms) => {
    if (!ms) return '';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60)    return s + 's ago';
    if (s < 3600)  return Math.floor(s/60)  + 'm ago';
    if (s < 86400) return Math.floor(s/3600)+ 'h ago';
    return Math.floor(s/86400) + 'd ago';
  };

  const CL = {
    data: null,
    jobsMap: {},    // lowercase pattern → { status, buildNo, ts, url, server }
    selCat: null,
    selJob: null,
    _refreshTimer: null,

    async load() {
      try {
        const res = await API.get('/collection-lead-flow/index.php');
        if (!res?.ok || !res?.data?.data) throw new Error(res?.data?.message || 'load failed');
        this.data = res.data.data;
        this._render();
        // Kick off Jenkins fetch in parallel — non-fatal if it fails
        this._fetchJenkins().catch(err => console.warn('Jenkins fetch failed:', err));
        // Auto-refresh live status every 60s
        clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => this._fetchJenkins().catch(()=>{}), 60_000);
      } catch (e) {
        $('clf-flow').innerHTML = `<div style="padding:40px;text-align:center;color:var(--hot);font-size:12.5px">โหลดไม่สำเร็จ · ${esc(e.message||e)}</div>`;
      }
    },

    // Fetch Jenkins jobs from all servers in parallel; build lookup by lowercase name.
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
            const key = j.name.toLowerCase();
            const status = COLOR_MAP[j.color] || 'notbuilt';
            map[key] = {
              status,
              color: j.color,
              buildNo: j.lastBuild?.number || null,
              ts:      j.lastBuild?.timestamp || null,
              result:  j.lastBuild?.result   || null,
              duration:j.lastBuild?.duration || null,
              url:     j.url || null,
              server:  serverId,
              folder,
            };
          }
        }
      };
      results.forEach(r => walk(r.jobs, r.server.id, ''));
      this.jobsMap = map;
      // Re-render if data loaded — only the flow (fast) + detail
      if (this.data) {
        this._renderFlow();
        if (this.selJob) this._renderDetail(this.selJob);
      }
    },

    // Look up a job pattern against jobsMap. Try exact then suffix match.
    _lookup(pattern) {
      const p = (pattern || '').toLowerCase();
      if (this.jobsMap[p]) return this.jobsMap[p];
      // Suffix match: job.name ends with pattern (e.g. "get-risk-data" vs "acm-nano-prod-collection-lead-get-risk-data")
      for (const [k, v] of Object.entries(this.jobsMap)) {
        if (k === p || k.endsWith('-' + p) || k.endsWith('/' + p) || k.includes(p)) return v;
      }
      return null;
    },

    _render() {
      const d = this.data;
      $('clf-m-jobs').textContent  = d.jobs.length;
      $('clf-m-lanes').textContent = d.categories.length;
      $('clf-m-edges').textContent = (d.auto_edges.length + d.user_edges.length);
      $('clf-m-src').textContent = d.source ? ('· ' + d.source) : '';

      const u = Auth.getUser?.();
      if (u && u.team === 'sm') $('clf-btn-add-edge').style.display = '';

      // Category tabs (horizontal)
      const tabs = d.categories.map(c => {
        const n = d.jobs.filter(j => j.category === c).length;
        return `<button type="button" class="clf-tab ${this.selCat===c?'on':''}" data-cat="${esc(c)}">
                  <span>${esc(c)}</span><span class="n">${n}</span>
                </button>`;
      }).join('');
      $('clf-tabs').innerHTML =
        `<button type="button" class="clf-tab ${this.selCat===null?'on':''}" data-cat="">
           <span>All</span><span class="n">${d.jobs.length}</span>
         </button>${tabs}`;
      $('clf-tabs').querySelectorAll('.clf-tab').forEach(el => {
        el.addEventListener('click', () => { this.selCat = el.dataset.cat || null; this._render(); });
      });

      this._renderFlow();
      if (this.selJob) this._renderDetail(this.selJob);
    },

    _renderFlow() {
      const d = this.data;
      const cats = this.selCat ? [this.selCat] : d.categories;
      const laneW = 260, laneGap = 16, nodeH = 96, nodeGap = 14, padTop = 34, padSide = 12;

      const byLane = {};
      cats.forEach(c => {
        byLane[c] = d.jobs
          .filter(j => j.category === c)
          .sort((a,b) => (a.schedule?.sort_key ?? 9999) - (b.schedule?.sort_key ?? 9999));
      });

      const maxRows = Math.max(1, ...Object.values(byLane).map(a => a.length));
      const height  = padTop + maxRows * (nodeH + nodeGap) + 20;
      const width   = padSide*2 + cats.length * laneW + Math.max(0, cats.length-1) * laneGap;

      const pos = {};
      cats.forEach((c, ci) => {
        const laneX = padSide + ci*(laneW + laneGap);
        byLane[c].forEach((j, ji) => {
          pos[j.pattern] = {
            x: laneX + 12, y: padTop + ji*(nodeH + nodeGap),
            w: laneW - 24, h: nodeH,
          };
        });
      });

      const edgeKey = (e) => e.from + '→' + e.to;
      const userSet = new Set(d.user_edges.map(edgeKey));
      const edges = [
        ...d.auto_edges.filter(e => !userSet.has(edgeKey(e))).map(e => ({...e, kind:'auto'})),
        ...d.user_edges.map(e => ({...e, kind:'user'})),
      ];
      const hi = new Set();
      if (this.selJob) edges.forEach(e => {
        if (e.from === this.selJob || e.to === this.selJob) hi.add(edgeKey(e));
      });

      const edgePath = (a, b) => {
        const x1 = a.x + a.w/2, y1 = a.y + a.h;
        const x2 = b.x + b.w/2, y2 = b.y;
        if (Math.abs(x1 - x2) < 2) return `M${x1},${y1} L${x2},${y2}`;
        const midY = (y1 + y2) / 2;
        return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
      };

      // Lane backgrounds + labels — SVG
      let laneBg = '';
      cats.forEach((c, ci) => {
        const x = padSide + ci*(laneW + laneGap);
        laneBg += `<rect class="clf-lane-bg" x="${x}" y="${padTop-22}" width="${laneW}" height="${height - padTop + 4}" rx="10"/>`;
        laneBg += `<text class="clf-lane-lbl" x="${x + laneW/2}" y="${padTop - 8}" text-anchor="middle">${esc(c)}</text>`;
      });

      // Edges — SVG
      let edgesSvg = '';
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        const cls = ['clf-edge'];
        if (e.kind === 'user') cls.push('user');
        if (hi.has(edgeKey(e))) cls.push('hi');
        edgesSvg += `<path class="${cls.join(' ')}" d="${edgePath(a,b)}"></path>`;
      });

      const dimmed = (pat) => this.selJob && this.selJob !== pat
          && !edges.some(e => (e.from === this.selJob && e.to === pat) || (e.to === this.selJob && e.from === pat));

      // Nodes — HTML absolutely positioned
      const statusPill = (jj) => {
        if (!jj) return `<span class="clf-status nodata"><span class="d"></span>no data</span>`;
        const label = jj.status === 'success' ? `#${jj.buildNo}`
                    : jj.status === 'failure' ? `FAIL #${jj.buildNo}`
                    : jj.status === 'running' ? `RUN…`
                    : jj.status === 'unstable'? `UNSTBL`
                    : jj.status === 'aborted' ? `ABORT`
                    : jj.status === 'notbuilt'? `no build`
                    : jj.status === 'disabled'? `disabled`
                    : jj.status;
        return `<span class="clf-status ${jj.status}"><span class="d"></span>${esc(label)}</span>`;
      };

      let nodesHtml = '';
      Object.entries(pos).forEach(([pat, p]) => {
        const j = d.jobs.find(x => x.pattern === pat);
        if (!j) return;
        const jj = this._lookup(pat);
        const cls = ['clf-node'];
        if (jj?.status) cls.push('st-' + jj.status);
        if (this.selJob === pat) cls.push('sel');
        if (dimmed(pat)) cls.push('dim');
        const isCrit = /yes/i.test(j.critical || '');
        const time = j.schedule?.time || '—';
        const ago  = jj?.ts ? fmtAgo(jj.ts) : '';
        const openUrl = jj?.url ? `<a href="${esc(jj.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="เปิดใน Jenkins" style="color:var(--text-muted); flex-shrink:0; display:inline-flex" onmouseover="this.style.color='var(--cool)'" onmouseout="this.style.color='var(--text-muted)'">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </a>` : '';

        nodesHtml += `
          <div class="${cls.join(' ')}" data-pat="${esc(pat)}"
               style="left:${p.x}px; top:${p.y}px; width:${p.w}px; height:${p.h}px">
            <div class="clf-node-row1">
              <span class="clf-node-name" title="${esc(pat)}">${esc(pat)}</span>
              ${isCrit ? '<span class="clf-node-crit">CRIT</span>' : ''}
              ${openUrl}
            </div>
            <div class="clf-node-row2">
              ${statusPill(jj)}
              ${ago ? `<span style="opacity:.85">· ${esc(ago)}</span>` : ''}
            </div>
            <div class="clf-node-meta"><b>${esc(time)}</b>${j.schedule?.frequency ? ' · ' + esc(j.schedule.frequency) : ''}${j.dev_owner ? ' · ' + esc(j.dev_owner.slice(0,22)) : ''}</div>
          </div>`;
      });

      $('clf-flow').innerHTML = `
        <div class="clf-canvas" style="width:${width}px; height:${height}px">
          <svg class="arrows" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
            <defs>
              <marker id="clf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="currentColor"></path>
              </marker>
            </defs>
            ${laneBg}
            ${edgesSvg}
          </svg>
          ${nodesHtml}
        </div>`;

      $('clf-flow').querySelectorAll('.clf-node').forEach(el => {
        el.addEventListener('click', () => {
          const pat = el.dataset.pat;
          this.selJob = (this.selJob === pat) ? null : pat;
          this._render();
        });
      });
    },

    _renderDetail(pat) {
      const d = this.data;
      const j = d.jobs.find(x => x.pattern === pat);
      const body = $('clf-detail-body');
      if (!j) {
        body.className = 'clf-detail-empty';
        body.innerHTML = 'ไม่พบ job นี้';
        return;
      }
      body.className = 'clf-detail-body';

      const chips = [];
      if (/yes/i.test(j.critical || '')) chips.push('<span class="clf-chip crit">CRITICAL</span>');
      if (/yes/i.test(j.monitor  || '')) chips.push('<span class="clf-chip ok">MONITORED</span>');
      if (j.rerun) {
        const cls = /no.*ทันที|no\s*:/i.test(j.rerun) ? 'crit'
                  : /yes.*ทันที|yes\s*:/i.test(j.rerun) ? 'warn'
                  : /yes/i.test(j.rerun) ? 'ok' : 'info';
        chips.push(`<span class="clf-chip ${cls}">Rerun: ${esc(j.rerun.split('\n')[0])}</span>`);
      }
      if (j.schedule?.frequency) chips.push(`<span class="clf-chip info">${esc(j.schedule.frequency)}</span>`);

      const filesIn  = (j.files || []).filter(f => f.io === 'in');
      const filesOut = (j.files || []).filter(f => f.io === 'out');
      const ICO_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg>';
      const ICO_DB   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>';
      const fileList = (arr, cls, tag) => arr.length
        ? arr.map(f => `
            <div class="clf-file ${cls}">
              <div class="clf-file-ico">${ICO_FILE}</div>
              <div class="clf-file-body">
                <div class="clf-file-name">${esc(f.file)}</div>
                ${f.s3 ? `<div class="clf-file-path">${esc(f.s3)}</div>` : ''}
              </div>
              <span class="clf-file-tag">${tag}</span>
            </div>`).join('')
        : '<div class="clf-empty-hint">—</div>';
      const dbList = (arr) => arr.map(x => `
        <div class="clf-file db">
          <div class="clf-file-ico">${ICO_DB}</div>
          <div class="clf-file-body"><div class="clf-file-name">${esc(x)}</div></div>
          <span class="clf-file-tag">DB</span>
        </div>`).join('');

      // Live build status row
      const jj = this._lookup(pat);
      const statusRow = jj ? `
        <div class="clf-d-row"><div class="clf-d-lbl">Last Build</div><div class="clf-d-val">
          <span class="clf-status ${jj.status}"><span class="d"></span>${esc(jj.status.toUpperCase())}</span>
          ${jj.buildNo ? `<span style="color:var(--text-muted); margin-left:6px">#${jj.buildNo}</span>` : ''}
          ${jj.ts ? `<span style="color:var(--text-muted); margin-left:6px">· ${esc(new Date(jj.ts).toLocaleString('th-TH'))} <span style="opacity:.7">(${esc(fmtAgo(jj.ts))})</span></span>` : ''}
          ${jj.duration ? `<div style="color:var(--text-muted); font-size:11px; margin-top:2px">Duration: ${Math.round(jj.duration/1000)}s</div>` : ''}
          ${jj.url ? `<div style="margin-top:4px"><a href="${esc(jj.url)}" target="_blank" rel="noopener">เปิดใน Jenkins ↗</a></div>` : ''}
        </div></div>`
        : `<div class="clf-d-row"><div class="clf-d-lbl">Last Build</div><div class="clf-d-val"><span class="clf-status nodata"><span class="d"></span>NO DATA</span> <span style="color:var(--text-muted); font-size:11px">— ไม่พบ job ใน Jenkins (อาจต้อง config server หรือ pattern ไม่ match)</span></div></div>`;

      const key = (e) => e.from + '→' + e.to;
      const userSet = new Set(d.user_edges.map(key));
      const allEdges = [
        ...d.auto_edges.filter(e => !userSet.has(key(e))).map(e => ({...e, kind:'auto'})),
        ...d.user_edges.map(e => ({...e, kind:'user'})),
      ];
      const upstream   = allEdges.filter(e => e.to   === pat);
      const downstream = allEdges.filter(e => e.from === pat);
      const isSm = Auth.getUser?.()?.team === 'sm';
      const chainItem = (e, dir) => {
        const other = dir === 'up' ? e.from : e.to;
        const k = e.kind === 'user'
          ? '<span class="k user" title="Declared by SM">USER</span>'
          : '<span class="k" title="Auto from schedule order">AUTO</span>';
        const del = (isSm && e.kind === 'user')
          ? `<span class="del" onclick="event.stopPropagation();CL.deleteEdge('${esc(e.from)}','${esc(e.to)}')" title="ลบ">×</span>`
          : '';
        return `<div class="clf-chain-item" onclick="CL.select('${esc(other)}')">
                  <span>${esc(other)}</span><span style="display:flex;align-items:center;gap:4px">${k}${del}</span>
                </div>`;
      };

      body.innerHTML = `
        <div class="clf-d-name">${esc(pat)}</div>
        <div class="clf-d-cat">${esc(j.category)}${j.label && j.label !== pat ? ' · ' + esc(j.label) : ''}</div>
        <div class="clf-d-chips">${chips.join('')}</div>

        ${statusRow}
        <div class="clf-d-row"><div class="clf-d-lbl">Schedule</div><div class="clf-d-val">${esc(j.schedule?.time || '—')}${j.schedule?.frequency ? ' · ' + esc(j.schedule.frequency) : ''}${j.schedule?.date && j.schedule.date !== '-' ? ' · ' + esc(j.schedule.date) : ''}</div></div>
        ${j.purpose  ? `<div class="clf-d-row"><div class="clf-d-lbl">Purpose</div><div class="clf-d-val">${esc(j.purpose)}</div></div>` : ''}
        <div class="clf-d-row"><div class="clf-d-lbl">Jenkins</div><div class="clf-d-val"><span class="clf-mono">${esc(j.jenkins_raw || pat)}</span></div></div>
        ${j.dev_owner   ? `<div class="clf-d-row"><div class="clf-d-lbl">Dev Owner</div><div class="clf-d-val">${esc(j.dev_owner)}${j.dev_owner_detail ? '<br><span style="font-size:11px;color:var(--text-muted);white-space:pre-line">' + esc(j.dev_owner_detail) + '</span>' : ''}</div></div>` : ''}
        ${j.user_owners ? `<div class="clf-d-row"><div class="clf-d-lbl">User Owner</div><div class="clf-d-val">${esc(j.user_owners)}${j.user_group ? ' <span style="color:var(--text-muted);font-size:11px">(' + esc(j.user_group) + ')</span>' : ''}</div></div>` : ''}
        ${j.params      ? `<div class="clf-d-row"><div class="clf-d-lbl">Params</div><div class="clf-d-val">${esc(j.params)}</div></div>` : ''}
        ${j.confluence  ? `<div class="clf-d-row"><div class="clf-d-lbl">Confluence</div><div class="clf-d-val">${urlify(j.confluence)}</div></div>` : ''}

        <div class="clf-section">
          <h4>Source Files (IN)</h4>
          ${fileList(filesIn, 'in', 'IN')}
        </div>
        <div class="clf-section">
          <h4>Output Files (OUT)</h4>
          ${fileList(filesOut, 'out', 'OUT')}
        </div>
        ${(j.dbs && j.dbs.length) ? `
          <div class="clf-section">
            <h4>Databases (${j.dbs.length})</h4>
            ${dbList(j.dbs)}
          </div>` : ''}

        <div class="clf-section">
          <h4>Chain — Upstream (${upstream.length})</h4>
          ${upstream.length ? upstream.map(e => chainItem(e,'up')).join('') : '<div class="clf-empty-hint">—</div>'}
        </div>
        <div class="clf-section">
          <h4>Chain — Downstream (${downstream.length})</h4>
          ${downstream.length ? downstream.map(e => chainItem(e,'down')).join('') : '<div class="clf-empty-hint">—</div>'}
        </div>
        ${d.notes?.[pat] ? `<div class="clf-section"><h4>Note</h4><div style="font-size:12px;white-space:pre-wrap">${esc(d.notes[pat].text)}</div><div style="font-size:10.5px;color:var(--text-muted);margin-top:6px">— ${esc(d.notes[pat].by)} · ${esc(new Date(d.notes[pat].at).toLocaleString('th-TH'))}</div></div>` : ''}
      `;
    },

    select(pat) {
      this.selJob = pat;
      const j = this.data.jobs.find(x => x.pattern === pat);
      if (j && this.selCat && this.selCat !== j.category) this.selCat = null;
      this._render();
    },

    openEdge() {
      const from = $('clf-mo-from'), to = $('clf-mo-to');
      from.innerHTML = to.innerHTML = this.data.jobs
        .map(j => `<option value="${esc(j.pattern)}">${esc(j.category)} — ${esc(j.pattern)}</option>`)
        .join('');
      if (this.selJob) from.value = this.selJob;
      $('clf-mo-note').value = '';
      $('clf-mo-edge').classList.add('on');
    },
    closeEdge() { $('clf-mo-edge').classList.remove('on'); },

    async saveEdge() {
      const from = $('clf-mo-from').value;
      const to   = $('clf-mo-to').value;
      const note = $('clf-mo-note').value;
      if (!from || !to || from === to) return alert('เลือก from และ to ที่ต่างกัน');
      try {
        const res = await API.post('/collection-lead-flow/index.php?action=add-edge', { from, to, note });
        if (!res?.ok || !res?.data?.ok) throw new Error(res?.data?.message || 'save failed');
        this.closeEdge();
        await this.load();
      } catch (e) { alert('บันทึกไม่สำเร็จ: ' + (e.message || e)); }
    },

    async deleteEdge(from, to) {
      if (!confirm(`ลบ chain: ${from} → ${to} ?`)) return;
      try {
        const res = await API.post('/collection-lead-flow/index.php?action=delete-edge', { from, to });
        if (!res?.ok || !res?.data?.ok) throw new Error(res?.data?.message || 'delete failed');
        await this.load();
      } catch (e) { alert('ลบไม่สำเร็จ: ' + (e.message || e)); }
    },
  };

  $('clf-btn-add-edge').addEventListener('click', () => CL.openEdge());
  $('clf-btn-reset').addEventListener('click', () => { CL.selJob = null; CL.selCat = null; CL._render(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') CL.closeEdge(); });

  CL.load();

})();
