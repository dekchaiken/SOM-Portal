/* genz-notes.js — Obsidian-style 3-panel Knowledge Base v2 */
(function () {
'use strict';

if (!Auth.requireAuth()) {}
Layout.render('genz-notes');

// ── Auth guard ─────────────────────────────────────────────────
(function guard() {
  const u = Auth.getUser();
  if (!u) return;
  const isAdmin = ['sm_admin', 'dev_sm'].includes(u.role);
  if (u.team !== 'sm' || (!u.is_genz && !isAdmin)) {
    document.getElementById('gn-view').innerHTML =
      '<div style="padding:40px;text-align:center;color:#ef4444;font-weight:700">Case Notes ใช้ได้เฉพาะสมาชิก GenZ Team</div>';
    throw new Error('forbidden');
  }
})();

// ── Constants ──────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  'Batch','Database','Network','K8s / Pod','Alert','Deploy',
  'Grafana','Jenkins','PCS','Payment','Wallet','General',
];
const TEAMS = [
  'SM Team','Dev Team','Network Team','DBA Team',
  'Infra Team','Security Team','Business Team','Management',
];
const SEVERITY = [
  { id:'low',      label:'Low',      color:'#22d3ee' },
  { id:'med',      label:'Medium',   color:'#a78bfa' },
  { id:'high',     label:'High',     color:'#fbbf24' },
  { id:'critical', label:'Critical', color:'#ef4444' },
];
const SERVICE_IMPACT = [
  { id:'none',    label:'ไม่มีผลกระทบ', color:'#22c55e' },
  { id:'partial', label:'ปิดบางส่วน',   color:'#f59e0b' },
  { id:'full',    label:'ปิดทั้งหมด',   color:'#ef4444' },
];

const esc     = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('th-TH', {day:'numeric', month:'short', year:'2-digit'}); } catch { return ''; } };
const getSevLabel  = id => (SEVERITY.find(s => s.id === id) || {}).label || 'Medium';
const getImpLabel  = id => (SERVICE_IMPACT.find(s => s.id === id) || {}).label || 'ไม่มีผลกระทบ';

// Derive category list (defaults + any custom from existing notes)
function buildCategoryList() {
  const custom = [...new Set(_all.map(n => n.category).filter(Boolean))];
  const merged = [...new Set([...DEFAULT_CATEGORIES, ...custom])];
  return merged;
}

// ── State ──────────────────────────────────────────────────────
let _all = [];
let _maServices = [];
let _filter = { q: '', cat: '', tag: '', sev: '' };
let _activeNoteId = null;
let _mode = 'hub'; // hub | list | detail | editor
let _prevMode = 'hub';
let _debTimer = null;
let _graph = null;
let _graphCollapsed = false;

// ── Custom confirm dialog ──────────────────────────────────────
function gnConfirm(title = 'ยืนยัน?', msg = '') {
  return new Promise(resolve => {
    const mask = document.getElementById('gn-confirm-mask');
    const msgEl = document.getElementById('gn-confirm-msg');
    const titleEl = mask.querySelector('.gn-confirm-title');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg || 'การกระทำนี้ไม่สามารถย้อนกลับได้';
    mask.style.display = 'flex';
    window.Icons?.render?.(mask);

    const close = result => {
      mask.style.display = 'none';
      ok.onclick = null; cancel.onclick = null; mask.onclick = null;
      resolve(result);
    };
    const ok     = document.getElementById('gn-conf-ok');
    const cancel = document.getElementById('gn-conf-cancel');
    ok.onclick     = () => close(true);
    cancel.onclick = () => close(false);
    mask.onclick   = e => { if (e.target === mask) close(false); };
  });
}

// ══════════════════════════════════════════════════════════════
//  FORCE-DIRECTED KNOWLEDGE GRAPH
// ══════════════════════════════════════════════════════════════
class KnowledgeGraph {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.selectedNode = null;
    this.hoveredNode = null;
    this._raf = null;
    this._iter = 0;
    this._maxIter = 180;
    this._onFilter = null;
    this._cssW = 260;
    this._cssH = 400;
    this._dpr = window.devicePixelRatio || 1;
    this._interactive = !!opts.interactive;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._drag = null;
    this._didDrag = false;

    canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
    canvas.addEventListener('click', this._onClick.bind(this));
    canvas.addEventListener('mouseleave', () => {
      if (!this._drag) { this.hoveredNode = null; this._draw(); }
    });

    if (this._interactive) {
      canvas.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
      canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
      window.addEventListener('mouseup', this._onMouseUp.bind(this));
    }
  }

  setData(notes) {
    cancelAnimationFrame(this._raf);
    this.nodes = []; this.edges = [];
    this.selectedNode = null; this.hoveredNode = null;
    this._iter = 0;
    if (!notes.length) return;
    const W = this._cssW, H = this._cssH;
    const rand = (a, b) => a + Math.random() * (b - a);
    const svcMap = new Map(), tagMap = new Map(), noteMap = new Map();
    notes.forEach(n => {
      const node = { id:'note:'+n.id, type:'note', label:n.title, noteId:n.id,
                     x:rand(40,W-40), y:rand(40,H-40), vx:0, vy:0, mass:1 };
      noteMap.set(n.id, node); this.nodes.push(node);
    });
    notes.forEach(n => {
      const nNode = noteMap.get(n.id);
      (n.related_services||[]).slice(0,6).forEach(svc => {
        if (!svcMap.has(svc)) {
          const node = { id:'svc:'+svc, type:'service', label:svc,
                         x:rand(40,W-40), y:rand(40,H-40), vx:0, vy:0, mass:1.4 };
          svcMap.set(svc, node); this.nodes.push(node);
        }
        this.edges.push({ a:nNode, b:svcMap.get(svc) });
      });
      (n.tags||[]).slice(0,5).forEach(tag => {
        if (!tagMap.has(tag)) {
          const node = { id:'tag:'+tag, type:'tag', label:'#'+tag,
                         x:rand(40,W-40), y:rand(40,H-40), vx:0, vy:0, mass:1 };
          tagMap.set(tag, node); this.nodes.push(node);
        }
        this.edges.push({ a:nNode, b:tagMap.get(tag) });
      });
      // Related runbooks edges
      (n.related_runbooks||[]).forEach(rb => {
        const other = noteMap.get(rb.id);
        if (other && other !== nNode) this.edges.push({ a:nNode, b:other, type:'runbook' });
      });
    });
    this._run();
  }

  _step() {
    const nodes = this.nodes, W = this._cssW, H = this._cssH;
    const repK = 1800, sprK = 0.03, restLen = 70, damping = 0.82, gravity = 0.012;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x-a.x, dy = b.y-a.y, dist = Math.sqrt(dx*dx+dy*dy)||0.1;
        const f = repK/(dist*dist), fx = f*dx/dist, fy = f*dy/dist;
        a.vx -= fx/a.mass; a.vy -= fy/a.mass;
        b.vx += fx/b.mass; b.vy += fy/b.mass;
      }
    }
    for (const e of this.edges) {
      const a=e.a, b=e.b, dx=b.x-a.x, dy=b.y-a.y, dist=Math.sqrt(dx*dx+dy*dy)||0.1;
      const f=sprK*(dist-restLen), fx=f*dx/dist, fy=f*dy/dist;
      a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
    }
    for (const n of nodes) {
      n.vx += (W/2-n.x)*gravity; n.vy += (H/2-n.y)*gravity;
      n.vx *= damping; n.vy *= damping;
      n.x = Math.max(16, Math.min(W-16, n.x+n.vx));
      n.y = Math.max(16, Math.min(H-16, n.y+n.vy));
    }
  }

  _draw() {
    const ctx = this.ctx, W = this._cssW, H = this._cssH;
    const dpr = this._dpr || 1;

    // Reset to DPR scale so clearRect always covers the full canvas
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Dot grid stays in screen space (fixed background, like Obsidian)
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let x = 15; x < W; x += 22) {
      for (let y = 15; y < H; y += 22) {
        ctx.beginPath(); ctx.arc(x, y, 0.8, 0, Math.PI*2); ctx.fill();
      }
    }

    // Apply viewport transform for all graph content
    if (this._interactive) {
      ctx.save();
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);
    }

    // Connection count per node (for sizing hub nodes)
    const connCount = new Map();
    this.nodes.forEach(n => connCount.set(n.id, 0));
    this.edges.forEach(e => {
      connCount.set(e.a.id, (connCount.get(e.a.id)||0) + 1);
      connCount.set(e.b.id, (connCount.get(e.b.id)||0) + 1);
    });

    // Draw ALL edges — always visible (Obsidian style)
    for (const e of this.edges) {
      const isSel = this.selectedNode &&
        (e.a === this.selectedNode || e.b === this.selectedNode);
      const isRunbook = e.type === 'runbook';

      ctx.setLineDash(isRunbook ? [3, 4] : []);
      ctx.lineWidth = isSel ? 1.6 : (isRunbook ? 0.8 : 0.9);
      ctx.strokeStyle = isSel
        ? (isRunbook ? 'rgba(244,114,182,.9)' : 'rgba(167,139,250,.85)')
        : (isRunbook ? 'rgba(244,114,182,.35)' : 'rgba(140,150,175,.42)');
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw nodes
    const hasSel = !!this.selectedNode;
    const totalNodes = this.nodes.length;

    for (const n of this.nodes) {
      const isSel    = n === this.selectedNode;
      const isHov    = n === this.hoveredNode;
      const isLinked = hasSel && this.edges.some(e =>
        (e.a === this.selectedNode && e.b === n) ||
        (e.b === this.selectedNode && e.a === n));
      const conns    = connCount.get(n.id) || 0;
      const dimmed   = hasSel && !isSel && !isLinked && !isHov;

      // Radius: base size + connection bonus
      let r, clr, strokeClr;
      if (n.type === 'note') {
        r = Math.min(3 + conns * 0.6, 7);
        clr = '#d4dde8'; strokeClr = '#8898b0';
      } else if (n.type === 'service') {
        r = Math.min(4 + conns * 0.8, 9);
        clr = '#22d3ee'; strokeClr = '#0891b2';
      } else {
        r = Math.min(3 + conns * 0.5, 6);
        clr = '#f472b6'; strokeClr = '#be185d';
      }

      if (isSel)    { r += 3.5; ctx.shadowBlur = 18; ctx.shadowColor = clr; }
      else if (isHov)  { r += 2;   ctx.shadowBlur = 10; ctx.shadowColor = clr; }
      else if (isLinked){ r += 1.5; ctx.shadowBlur = 6;  ctx.shadowColor = clr; }
      else              { ctx.shadowBlur = 0; }

      ctx.globalAlpha = dimmed ? 0.13 : 1;

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = (isSel || isHov) ? '#fff' : clr;
      ctx.fill();

      if (!dimmed) {
        ctx.lineWidth = isSel ? 1.5 : 1;
        ctx.strokeStyle = strokeClr;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      const showLabel = isHov || isSel || isLinked || conns >= 2 || totalNodes <= 8;
      if (showLabel && !dimmed) {
        ctx.font = `${(isSel||isHov)?'700':'600'} ${isSel?11:10}px 'Space Grotesk',sans-serif`;
        ctx.textAlign = 'center';
        const txt = n.label.length > 20 ? n.label.slice(0, 18) + '…' : n.label;
        const tw  = ctx.measureText(txt).width;
        const lx  = n.x, ly = n.y - r - 5;
        ctx.fillStyle = isSel ? 'rgba(10,12,20,.92)' : 'rgba(10,12,20,.75)';
        ctx.beginPath();
        ctx.roundRect(lx - tw/2 - 5, ly - 11, tw + 10, 14, 3);
        ctx.fill();
        ctx.fillStyle = isSel ? '#fff' : 'rgba(210,220,240,.88)';
        ctx.fillText(txt, lx, ly);
      }
    }

    if (this._interactive) ctx.restore();
  }

  _run() {
    const tick = () => {
      if (this._iter < this._maxIter) { this._step(); this._iter++; }
      this._draw();
      if (this._iter < this._maxIter+30) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  resize() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const dpr = window.devicePixelRatio||1, w=wrap.clientWidth, h=wrap.clientHeight;
    if(w<1||h<1) return;
    this._dpr = dpr;
    this._cssW=w; this._cssH=h;
    this.canvas.width=w*dpr; this.canvas.height=h*dpr;
    this._draw();
    if(this.nodes.length){
      this._iter=Math.max(0,this._iter-40);
      cancelAnimationFrame(this._raf); this._run();
    }
  }

  // Convert screen coords (CSS px, relative to canvas) → world coords
  _toWorld(sx, sy) {
    return this._interactive
      ? { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom }
      : { x: sx, y: sy };
  }

  _getNodeAt(sx, sy) {
    const { x: wx, y: wy } = this._toWorld(sx, sy);
    for (const n of this.nodes) {
      const dx = n.x - wx, dy = n.y - wy;
      if (dx*dx + dy*dy <= 196) return n;
    }
    return null;
  }

  _onMouseMove(e) {
    if (this._drag) { this._onDragMove(e); return; }
    const rect = this.canvas.getBoundingClientRect();
    const n = this._getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (n !== this.hoveredNode) {
      this.hoveredNode = n;
      this.canvas.style.cursor = n ? 'pointer' : (this._interactive ? 'grab' : 'default');
      this._draw();
    }
  }

  _onClick(e) {
    if (this._didDrag) { this._didDrag = false; return; }
    const rect = this.canvas.getBoundingClientRect();
    const n = this._getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    this.selectedNode = (n === this.selectedNode) ? null : n;
    this._draw();
    if (this._onFilter) this._onFilter(this.selectedNode);
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const newZoom = Math.max(0.15, Math.min(6, this.zoom * factor));
    // Zoom toward mouse position
    this.panX = sx - (sx - this.panX) * (newZoom / this.zoom);
    this.panY = sy - (sy - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;
    this._draw();
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    this._didDrag = false;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const n = this._getNodeAt(sx, sy);
    if (n) {
      this._drag = { type: 'node', node: n, ox: n.x, oy: n.y, sx, sy };
    } else {
      this._drag = { type: 'pan', sx, sy, px0: this.panX, py0: this.panY };
    }
    this.canvas.style.cursor = 'grabbing';
  }

  _onDragMove(e) {
    if (!this._drag) return;
    this._didDrag = true;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (this._drag.type === 'node') {
      const n = this._drag.node;
      n.x = this._drag.ox + (sx - this._drag.sx) / this.zoom;
      n.y = this._drag.oy + (sy - this._drag.sy) / this.zoom;
      n.x = Math.max(16, Math.min(this._cssW - 16, n.x));
      n.y = Math.max(16, Math.min(this._cssH - 16, n.y));
      n.vx = 0; n.vy = 0;
    } else {
      this.panX = this._drag.px0 + (sx - this._drag.sx);
      this.panY = this._drag.py0 + (sy - this._drag.sy);
    }
    this._draw();
  }

  _onMouseUp(e) {
    if (!this._drag) return;
    this._drag = null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const n = this._getNodeAt(sx, sy);
    this.canvas.style.cursor = n ? 'pointer' : 'grab';
  }

  fitToView() {
    if (!this.nodes.length) return;
    const W = this._cssW, H = this._cssH, pad = 80;
    const xs = this.nodes.map(n => n.x), ys = this.nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX || 100, rangeY = maxY - minY || 100;
    this.zoom = Math.max(0.2, Math.min((W - pad*2) / rangeX, (H - pad*2) / rangeY, 3));
    this.panX = W/2 - ((minX + maxX)/2) * this.zoom;
    this.panY = H/2 - ((minY + maxY)/2) * this.zoom;
    this._draw();
  }

  highlight(noteId) {
    this.selectedNode = noteId ? (this.nodes.find(n => n.type === 'note' && n.noteId === noteId) || null) : null;
    this._draw();
  }
  destroy() { cancelAnimationFrame(this._raf); }
}

// ══════════════════════════════════════════════════════════════
//  LOAD & FILTER
// ══════════════════════════════════════════════════════════════
async function loadAll() {
  renderSkeleton();
  const [notesR, svcsR] = await Promise.all([
    API.genzNotes.list(),
    _maServices.length ? null : API.get('/ma-services/list.php'),
  ]);
  _all = notesR?.ok ? (notesR.data.data||[]) : [];
  // ma-services/list.php returns { success, data: [...], count }
  if (svcsR?.ok && Array.isArray(svcsR.data?.data)) {
    _maServices = svcsR.data.data.map(s => ({ id: s.id, name: s.service_name, type: s.service_type }));
  }
  buildNav();
  renderServiceHub();
  if (_graph){ _graph.setData(_all); updateGraphStats(); }
  const _gnUrlNote = new URLSearchParams(location.search).get('note');
  if (_gnUrlNote && _all.find(x => x.id === _gnUrlNote)) openDetail(_gnUrlNote);
}

function filtered() {
  const q = _filter.q.toLowerCase();
  return _all.filter(n => {
    if (_filter.cat && n.category !== _filter.cat) return false;
    if (_filter.sev && n.severity !== _filter.sev) return false;
    if (_filter.tag && !(n.tags||[]).includes(_filter.tag)) return false;
    if (q) {
      const hay = [n.title,n.symptoms,n.root_cause,n.when_encountered,n.notes,
        ...(n.tags||[]),...(n.related_services||[])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ══════════════════════════════════════════════════════════════
//  LEFT NAV
// ══════════════════════════════════════════════════════════════
function buildNav() {
  const nav = document.getElementById('gn-nav');
  const countByCat = id => _all.filter(n => n.category === id).length;
  const countBySev = id => _all.filter(n => n.severity === id).length;
  const tagCount = {};
  _all.forEach(n => (n.tags||[]).forEach(t => { tagCount[t]=(tagCount[t]||0)+1; }));
  const tags = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]);
  const cats = buildCategoryList().filter(c => countByCat(c) > 0 || _filter.cat === c);

  nav.innerHTML = `
    <div class="gn-nav-item ${_mode==='hub'?'active':''}" data-action="home" style="font-weight:800">
      <span class="gn-nav-item-label"><i data-icon="home"></i> Home</span>
    </div>
    <div class="gn-nav-item ${_mode!=='hub'&&!_filter.cat&&!_filter.tag&&!_filter.sev?'active':''}" data-action="all">
      <span class="gn-nav-item-label">All Notes</span>
      <span class="gn-nav-item-count">${_all.length}</span>
    </div>
    <div class="gn-nav-section" id="gnns-cat">
      <div class="gn-nav-section-hd" data-toggle="gnns-cat">Categories <span class="toggle-icon">›</span></div>
      <div class="gn-nav-items">
        ${cats.map(c=>`
          <div class="gn-nav-item ${_filter.cat===c?'active':''}" data-action="cat" data-val="${esc(c)}">
            <span class="gn-nav-item-label">${esc(c)}</span>
            <span class="gn-nav-item-count">${countByCat(c)}</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="gn-nav-section" id="gnns-sev">
      <div class="gn-nav-section-hd" data-toggle="gnns-sev">Severity <span class="toggle-icon">›</span></div>
      <div class="gn-nav-items">
        ${SEVERITY.filter(s=>countBySev(s.id)>0||_filter.sev===s.id).map(s=>`
          <div class="gn-nav-item ${_filter.sev===s.id?'active':''}" data-action="sev" data-val="${esc(s.id)}">
            <span class="gn-nav-sev-dot ${s.id}"></span>
            <span class="gn-nav-item-label">${esc(s.label)}</span>
            <span class="gn-nav-item-count">${countBySev(s.id)}</span>
          </div>`).join('')}
      </div>
    </div>
    ${tags.length?`
    <div class="gn-nav-section" id="gnns-tag">
      <div class="gn-nav-section-hd" data-toggle="gnns-tag">Tags <span class="toggle-icon">›</span></div>
      <div class="gn-nav-items">
        <div class="gn-nav-tag-wrap">
          ${tags.map(([t,c])=>`<span class="gn-nav-tag ${_filter.tag===t?'active':''}" data-action="tag" data-val="${esc(t)}">#${esc(t)}&nbsp;<span style="opacity:.6">${c}</span></span>`).join('')}
        </div>
      </div>
    </div>`:``}
  `;
  document.getElementById('gn-note-count').textContent = `${_all.length} note${_all.length!==1?'s':''}`;

  nav.addEventListener('click', e => {
    const item = e.target.closest('[data-action]');
    if (!item) {
      const hd = e.target.closest('[data-toggle]');
      if (hd) { const sec=document.getElementById(hd.dataset.toggle); if(sec)sec.classList.toggle('collapsed'); }
      return;
    }
    const {action, val} = item.dataset;
    if (action==='home'){ buildNav(); renderServiceHub(); return; }
    if (action==='all'){ _filter.cat='';_filter.tag='';_filter.sev=''; }
    else if(action==='cat'){ _filter.cat=_filter.cat===val?'':val;_filter.tag='';_filter.sev=''; }
    else if(action==='sev'){ _filter.sev=_filter.sev===val?'':val;_filter.tag='';_filter.cat=''; }
    else if(action==='tag'){ _filter.tag=_filter.tag===val?'':val;_filter.cat='';_filter.sev=''; }
    _prevMode = 'list';
    buildNav(); renderList();
  });
  window.Icons?.render?.(nav);
}

// ══════════════════════════════════════════════════════════════
//  LIST VIEW
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  SERVICE HUB VIEW (default landing)
// ══════════════════════════════════════════════════════════════
function renderServiceHub() {
  _mode = 'hub'; _prevMode = 'hub';
  _activeNoteId = null;
  if (_graph) _graph.highlight(null);
  _updateOtp(null);

  const v = document.getElementById('gn-view');

  if (!_all.length) {
    v.className = 'gn-view-enter';
    v.innerHTML = `<div class="gn-empty">
      <div class="gn-empty-icon"><i data-icon="book-open"></i></div>
      <h3>ยังไม่มี Case Note</h3>
      <p>เริ่มจด Case Note แรกของทีมกันเลย</p>
      <button class="gn-btn primary" id="gn-empty-new"><i data-icon="plus"></i> New Note</button>
    </div>`;
    window.Icons?.render?.(v);
    document.getElementById('gn-empty-new')?.addEventListener('click', () => openEditor());
    return;
  }

  // Build service data
  const svcMap = new Map();
  _all.forEach(n => {
    (n.related_services || []).forEach(svc => {
      if (!svcMap.has(svc)) svcMap.set(svc, { count: 0, sevCounts: {low:0,med:0,high:0,critical:0} });
      const d = svcMap.get(svc);
      d.count++;
      d.sevCounts[n.severity || 'med'] = (d.sevCounts[n.severity || 'med'] || 0) + 1;
    });
  });
  const svcs = [...svcMap.entries()]
    .map(([name, d]) => ({ name, count: d.count, sevCounts: d.sevCounts,
      domSev: Object.entries(d.sevCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'med' }))
    .sort((a, b) => b.count - a.count);

  // Build category data
  const catMap = new Map();
  _all.forEach(n => {
    const c = n.category || 'General';
    catMap.set(c, (catMap.get(c) || 0) + 1);
  });
  const cats = [...catMap.entries()].map(([name, count]) => ({name, count})).sort((a,b)=>b.count-a.count);

  const svcCards = svcs.map(svc => {
    const dots = Object.entries(svc.sevCounts).filter(([,c])=>c>0)
      .map(([s,c])=>`<span class="gn-hub-sev-dot sev-${esc(s)}" title="${esc(getSevLabel(s))}: ${c}"></span>`).join('');
    return `<div class="gn-hub-svc-card sev-${esc(svc.domSev)}" data-svc="${esc(svc.name)}">
      <div class="gn-hub-svc-icon"><i data-icon="server"></i></div>
      <div class="gn-hub-svc-name">${esc(svc.name)}</div>
      <div class="gn-hub-svc-count">${svc.count} note${svc.count>1?'s':''}</div>
      <div class="gn-hub-sev-dots">${dots}</div>
    </div>`;
  }).join('');

  const catChips = cats.map(c =>
    `<div class="gn-hub-cat-chip" data-cat="${esc(c.name)}">
      ${esc(c.name)}<span class="gn-hub-cat-cnt">${c.count}</span>
    </div>`).join('');

  v.className = 'gn-view-enter';
  v.innerHTML = `
    <div class="gn-hub-hero">
      <div class="gn-hub-hero-txt">
        <h2>Case Notes <span class="star">✦</span></h2>
        <p>${_all.length} notes · ${svcs.length} services · ${cats.length} categories</p>
      </div>
      <button class="gn-btn primary gn-hub-all-btn" id="gn-hub-all-btn">
        <i data-icon="list"></i> All Notes
      </button>
    </div>

    ${svcs.length ? `<div class="gn-hub-section">
      <div class="gn-hub-section-hd">
        <i data-icon="server"></i> Services
        <span class="gn-hub-section-cnt">${svcs.length}</span>
      </div>
      <div class="gn-hub-svc-grid">${svcCards}</div>
    </div>` : ''}

    ${cats.length ? `<div class="gn-hub-section">
      <div class="gn-hub-section-hd">
        <i data-icon="folder"></i> Categories
      </div>
      <div class="gn-hub-cat-wrap">${catChips}</div>
    </div>` : ''}
  `;

  window.Icons?.render?.(v);

  v.querySelectorAll('.gn-hub-svc-card').forEach(card => {
    card.addEventListener('click', () => {
      _prevMode = 'hub';
      renderFilteredByService(card.dataset.svc);
    });
  });
  v.querySelectorAll('.gn-hub-cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _filter.cat = chip.dataset.cat; _filter.tag = ''; _filter.sev = '';
      _prevMode = 'hub';
      buildNav(); renderList();
    });
  });
  document.getElementById('gn-hub-all-btn')?.addEventListener('click', () => {
    _filter.cat = ''; _filter.tag = ''; _filter.sev = '';
    _prevMode = 'hub';
    buildNav(); renderList();
  });
}

function renderSkeleton() {
  document.getElementById('gn-view').innerHTML = [1,2,3].map(()=>`
    <div class="gn-skel">
      <div class="gn-skel-line" style="width:35%;height:8px"></div>
      <div class="gn-skel-line" style="width:80%;height:14px"></div>
      <div class="gn-skel-line" style="width:60%;height:9px"></div>
    </div>`).join('');
}

function renderList() {
  _mode='list'; _activeNoteId=null;
  history.replaceState(null, '', location.pathname);
  if(_graph)_graph.highlight(null);
  const list=filtered(), v=document.getElementById('gn-view');
  const filt=_filter.cat||_filter.tag||_filter.sev;
  const filtLabel=_filter.cat?_filter.cat:_filter.tag?`#${_filter.tag}`:_filter.sev?getSevLabel(_filter.sev):'';
  const hd=`<div class="gn-list-hd">
    <div class="gn-list-hd-title">
      ${filt?`<span class="gn-filt-badge">${esc(filtLabel)}</span>`:''}
      ${list.length} note${list.length!==1?'s':''}
      ${_filter.q?`<span style="font-size:11px;font-weight:500;color:var(--text-muted)">· "${esc(_filter.q)}"</span>`:''}
    </div>
  </div>`;
  if(!list.length){
    v.className='gn-view-enter';
    v.innerHTML=hd+`<div class="gn-empty">
      <div class="gn-empty-icon"><i data-icon="book-open"></i></div>
      <h3>${_all.length?'ไม่พบ note ที่ตรงกัน':'ยังไม่มี Case Note'}</h3>
      <p>${_all.length?'ลองเปลี่ยน filter หรือคำค้น':'เริ่มจด Case Note แรกของทีมกันเลย'}</p>
      ${!_all.length?`<button class="gn-btn primary" id="gn-empty-new"><i data-icon="plus"></i> New Note</button>`:''}
    </div>`;
    window.Icons?.render?.(v);
    document.getElementById('gn-empty-new')?.addEventListener('click',()=>openEditor());
    return;
  }
  const cards=list.map(n=>{
    const stepDone  = (n.resolution_steps||[]).filter(s=>s.done).length;
    const stepTotal = (n.resolution_steps||[]).length;
    const abbr      = (n.category||'G').charAt(0).toUpperCase();
    const sev       = n.severity || 'med';
    const maCount   = (n.ma_service_ids||[]).length;
    return `<div class="gn-note-card sev-${esc(sev)}" data-id="${esc(n.id)}" data-abbr="${esc(abbr)}">
      <div class="gnc-inner">
        <div class="gnc-head">
          <span class="gnc-cat"><i data-icon="folder"></i>${esc(n.category)}</span>
          <div class="gnc-badges">
            <span class="gnc-sev sev-${esc(sev)}">${esc(getSevLabel(n.severity))}</span>
            ${n.ma_required?`<span class="gnc-ma-badge">MA${maCount?` ·${maCount}`:''}</span>`:''}
            ${n.service_impact&&n.service_impact!=='none'?`<span class="gnc-imp-badge imp-${esc(n.service_impact)}">${esc(getImpLabel(n.service_impact))}</span>`:''}
          </div>
        </div>
        <h3 class="gnc-title">${esc(n.title)}</h3>
        ${n.symptoms||n.root_cause?`<p class="gnc-excerpt">${esc((n.symptoms||n.root_cause).slice(0,120))}${(n.symptoms||n.root_cause).length>120?'…':''}</p>`:''}
        <div class="gnc-foot">
          <div class="gnc-tags">
            ${(n.tags||[]).slice(0,3).map(t=>`<span class="gnc-tag">#${esc(t)}</span>`).join('')}
            ${(n.related_services||[]).slice(0,2).map(s=>`<span class="gnc-svc">${esc(s)}</span>`).join('')}
          </div>
          <div class="gnc-meta">
            ${stepTotal?`<span class="gnc-steps">${stepDone}/${stepTotal}</span>`:''}
            <span class="gnc-date">${esc(fmtDate(n.updated_at))}</span>
            <span class="gnc-arrow">→</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  v.className='gn-view-enter';
  v.innerHTML=hd+`<div class="gn-note-list">${cards}</div>`;
  window.Icons?.render?.(v);
  v.addEventListener('click', e=>{ const c=e.target.closest('.gn-note-card'); if(c)openDetail(c.dataset.id); });
}

// ══════════════════════════════════════════════════════════════
//  DETAIL VIEW
// ══════════════════════════════════════════════════════════════
function openDetail(id) {
  const n=_all.find(x=>x.id===id); if(!n)return;
  _prevMode = _mode; _mode='detail'; _activeNoteId=id;
  history.replaceState(null, '', '?note=' + encodeURIComponent(id));
  if(_graph)_graph.highlight(id);
  const me=Auth.getUser();
  const canEdit=me&&(me.id===n.created_by||['sm_admin','dev_sm'].includes(me.role));

  const secIds = ['gn-sec-symptom','gn-sec-trigger','gn-sec-cause','gn-sec-steps','gn-sec-ma','gn-sec-teams','gn-sec-esc','gn-sec-rb','gn-sec-svc','gn-sec-links','gn-sec-notes'];
  let _secIdx = 0;
  const sec=(cls,icon,title,body)=>{
    const sid = secIds[_secIdx++] || '';
    return `<div class="gn-runbook-sec" ${sid?`id="${sid}"`:''}>
      <div class="gn-runbook-sec-hd ${cls}">
        <div class="icon-wrap"><i data-icon="${icon}"></i></div>
        <h4>${title}</h4>
      </div>${body}
    </div>`;
  };

  const stepsHtml=(n.resolution_steps||[]).length
    ?`<div class="gn-steps-view">${n.resolution_steps.map((s,i)=>`
        <div class="gn-step-view ${s.done?'done':''}">
          <div class="step-num">${i+1}</div>
          <div class="step-text">${esc(s.text)}</div>
        </div>`).join('')}</div>`
    :`<p class="gn-runbook-empty">— ยังไม่มี step —</p>`;

  const teamsHtml=(n.teams_to_notify||[]).length
    ?`<div class="gn-teams-view" style="padding-left:34px">${n.teams_to_notify.map(t=>`<span class="gn-team-chip">${esc(t)}</span>`).join('')}</div>`
    :`<p class="gn-runbook-empty">— ไม่ได้ระบุ —</p>`;

  const escalationHtml=n.escalation_path
    ?`<div class="gn-runbook-body" style="padding-left:34px">${esc(n.escalation_path)}</div>`
    :`<p class="gn-runbook-empty">— ไม่ได้ระบุ —</p>`;

  const relRunbooksHtml=(n.related_runbooks||[]).length
    ?`<div class="gn-rel-rb-view" style="padding-left:34px">${n.related_runbooks.map(rb=>{
        const exists=_all.find(x=>x.id===rb.id);
        return `<button class="gn-rel-rb-chip ${exists?'':'orphan'}" data-rb-id="${esc(rb.id)}">
          <i data-icon="book-open"></i>${esc(rb.title||rb.id)}
        </button>`;
      }).join('')}</div>`
    :`<p class="gn-runbook-empty">— ไม่มี —</p>`;

  const svcHtml=(n.related_services||[]).length
    ?`<div class="gn-services-view" style="padding-left:34px">${n.related_services.map(s=>`<span class="gn-service-chip">${esc(s)}</span>`).join('')}</div>`
    :`<p class="gn-runbook-empty">— ไม่มี —</p>`;

  const linksHtml=(n.links||[]).length
    ?`<div class="gn-links-view" style="padding-left:34px">${n.links.map(l=>`<a class="gn-link-chip" href="${esc(l.url)}" target="_blank" rel="noopener"><i data-icon="external-link"></i>${esc(l.label)}</a>`).join('')}</div>`
    :`<p class="gn-runbook-empty">— ไม่มี —</p>`;

  // MA services section
  const maHtml = n.ma_required
    ? `<div style="padding-left:34px">
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${(n.ma_service_ids||[]).length
            ? (n.ma_service_ids).map(s=>`<span class="gn-ma-chip" style="background:rgba(239,68,68,.1);color:#991b1b;border:1px solid rgba(239,68,68,.2);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:5px"><i data-icon="alert-triangle"></i>${esc(s.name)}</span>`).join('')
            : '<span style="font-size:12px;color:var(--text-muted)">ไม่ได้ระบุ service ที่จะ MA</span>'
          }
        </div>
       </div>`
    : `<p class="gn-runbook-empty">— ไม่ต้องขึ้น MA —</p>`;

  // Impact summary bar
  const impBars=[];
  if(n.ma_required) impBars.push(`<span class="gn-detail-imp-badge ma"><i data-icon="alert-triangle"></i> MA Required${(n.ma_service_ids||[]).length?` (${n.ma_service_ids.length} services)`:''}</span>`);
  if(n.service_impact&&n.service_impact!=='none') impBars.push(`<span class="gn-detail-imp-badge si-${esc(n.service_impact)}">${getImpLabel(n.service_impact)}</span>`);
  if((n.teams_to_notify||[]).length) impBars.push(`<span class="gn-detail-imp-badge teams"><i data-icon="users"></i> ${esc(n.teams_to_notify.join(', '))}</span>`);

  const v=document.getElementById('gn-view');
  v.className='gn-view-enter';
  v.innerHTML=`
    <div class="gn-detail-wrap">
      <div class="gn-detail-bar">
        <button class="gn-back" id="gn-back"><i data-icon="arrow-left"></i> Back</button>
        <span class="sep">/</span>
        <span class="crumb">${esc(n.category)}</span>
        <div class="gn-detail-actions">
          ${canEdit?`<button class="gn-btn danger" id="gn-del-btn"><i data-icon="trash-2"></i></button>
          <button class="gn-btn" id="gn-edit-btn"><i data-icon="pencil"></i> Edit</button>`:''}
        </div>
      </div>
      <div class="gn-detail-content">
        <div class="gn-detail-head">
          <div class="gn-detail-meta-row">
            <span class="gn-card-cat">${esc(n.category)}</span>
            <span class="gn-sev-badge ${esc(n.severity||'med')}">${esc(getSevLabel(n.severity))}</span>
            ${(n.tags||[]).map(t=>`<span class="gn-tag">#${esc(t)}</span>`).join('')}
          </div>
          <h2 class="gn-detail-title">${esc(n.title)}</h2>
          ${impBars.length?`<div class="gn-detail-imp-bar">${impBars.join('')}</div>`:''}
          <div class="gn-detail-author">
            สร้างโดย <b>${esc(n.created_by_name||'GenZ')}</b> · ${esc(fmtDate(n.created_at))}
            ${n.updated_at&&n.updated_at!==n.created_at?` · อัปเดต ${esc(fmtDate(n.updated_at))} โดย ${esc(n.updated_by_name||'')}`:``}
          </div>
        </div>
        <div class="gn-runbook">
          ${sec('c-symptom','alert-triangle','อาการที่เห็น / Symptoms',`<div class="gn-runbook-body">${esc(n.symptoms||'')}</div>`)}
          ${sec('c-trigger','clock','เจอตอนไหน / Trigger',`<div class="gn-runbook-body">${esc(n.when_encountered||'')}</div>`)}
          ${sec('c-cause','search','Root Cause',`<div class="gn-runbook-body">${esc(n.root_cause||'')}</div>`)}
          ${sec('c-steps','check-square','วิธีแก้ Step-by-step',stepsHtml)}
          ${n.ma_required||true?sec('c-teams','shield-alert','MA Required',maHtml):''}
          ${sec('c-teams','users','Teams to Notify',teamsHtml)}
          ${sec('c-escalation','git-branch','Escalation Path',escalationHtml)}
          ${sec('c-rb','link-2','Related Runbooks',relRunbooksHtml)}
          ${sec('c-services','server','Related Services',svcHtml)}
          ${sec('c-links','link','Links / References',linksHtml)}
          ${n.notes?sec('c-notes','file-text','Note เพิ่มเติม',`<div class="gn-runbook-body">${esc(n.notes)}</div>`):''}
        </div>
      </div>
    </div>`;

  window.Icons?.render?.(v);
  document.getElementById('gn-back')?.addEventListener('click', () => {
    _updateOtp(null);
    if (_prevMode === 'hub') { buildNav(); renderServiceHub(); }
    else renderList();
  });
  document.getElementById('gn-edit-btn')?.addEventListener('click',()=>openEditor(id));
  document.getElementById('gn-del-btn')?.addEventListener('click',()=>deleteNote(id));

  // Related runbooks navigation
  v.querySelectorAll('.gn-rel-rb-chip[data-rb-id]').forEach(btn=>{
    btn.addEventListener('click',()=>{ const found=_all.find(x=>x.id===btn.dataset.rbId); if(found)openDetail(found.id); });
  });

  // "On This Page" panel
  _updateOtp(n);
}

// Build "On This Page" TOC in the right panel
function _updateOtp(n) {
  const otp    = document.getElementById('gn-otp');
  const otpList = document.getElementById('gn-otp-list');
  if (!otp || !otpList) return;
  if (!n) { otp.style.display = 'none'; otpList.innerHTML = ''; return; }

  const secs = [
    { id:'gn-sec-symptom', label:'อาการที่เห็น',   show: !!n.symptoms },
    { id:'gn-sec-trigger', label:'เจอตอนไหน',      show: !!n.when_encountered },
    { id:'gn-sec-cause',   label:'Root Cause',      show: !!n.root_cause },
    { id:'gn-sec-steps',   label:'Steps',           show: !!(n.resolution_steps||[]).length },
    { id:'gn-sec-ma',      label:'MA Required',     show: true },
    { id:'gn-sec-teams',   label:'Teams to Notify', show: !!(n.teams_to_notify||[]).length },
    { id:'gn-sec-esc',     label:'Escalation Path', show: !!n.escalation_path },
    { id:'gn-sec-rb',      label:'Related Runbooks',show: !!(n.related_runbooks||[]).length },
    { id:'gn-sec-svc',     label:'Related Services',show: !!(n.related_services||[]).length },
    { id:'gn-sec-links',   label:'Links',           show: !!(n.links||[]).length },
    { id:'gn-sec-notes',   label:'Note เพิ่มเติม', show: !!n.notes },
  ].filter(s => s.show);

  otpList.innerHTML = secs.map(s =>
    `<a class="gn-otp-item" data-sec="${esc(s.id)}">▸ ${esc(s.label)}</a>`
  ).join('');
  otp.style.display = 'flex';

  otpList.querySelectorAll('.gn-otp-item').forEach(a => {
    a.addEventListener('click', () => {
      const target = document.getElementById(a.dataset.sec);
      if (target) { target.scrollIntoView({ behavior:'smooth', block:'start' }); }
      otpList.querySelectorAll('.gn-otp-item').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  EDITOR VIEW
// ══════════════════════════════════════════════════════════════
function openEditor(id) {
  const isNew=!id;
  const n=id?_all.find(x=>x.id===id):{
    id:'',title:'',category:'General',severity:'med',tags:[],symptoms:'',when_encountered:'',
    root_cause:'',resolution_steps:[],links:[],related_services:[],notes:'',
    teams_to_notify:[],ma_required:false,service_impact:'none',escalation_path:'',related_runbooks:[]
  };
  if(!n)return;
  _mode='editor';

  const cats=buildCategoryList();
  // Build datalist for categories
  const catsDl=`<datalist id="gn-cats-dl">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`;

  const v=document.getElementById('gn-view');
  v.className='gn-view-enter';
  v.innerHTML=`
    <div class="gn-editor-wrap">
      <div class="gn-editor-bar">
        <span class="gn-editor-title">${isNew?'New Case Note':'Edit Case Note'}</span>
        <div class="gn-editor-actions">
          <button class="gn-btn ghost" id="gn-cancel-btn">Cancel</button>
          <button class="gn-btn primary" id="gn-save-btn"><i data-icon="save"></i> ${isNew?'Create':'Save'}</button>
        </div>
      </div>
      <form class="gn-editor-form" id="gn-form" autocomplete="off">
        ${catsDl}

        <!-- Section: Basic Info -->
        <div class="gn-ed-section">
          <div class="gn-ed-section-hd"><i data-icon="info"></i> Basic Info</div>
          <div class="gn-field">
            <label>Title <span style="color:#ef4444">*</span></label>
            <input name="title" required maxlength="200" placeholder="เช่น: Batch NANO-CUTOFF ค้างที่ step 3" value="${esc(n.title)}">
          </div>
          <div class="gn-row3">
            <div class="gn-field">
              <label>Category</label>
              <input name="category" list="gn-cats-dl" value="${esc(n.category)}" placeholder="เลือกหรือพิมพ์ใหม่">
            </div>
            <div class="gn-field">
              <label>Severity</label>
              <select name="severity">
                ${SEVERITY.map(s=>`<option value="${s.id}" ${s.id===n.severity?'selected':''}>${s.label}</option>`).join('')}
              </select>
            </div>
            <div class="gn-field">
              <label>Tags <span class="hint">คั่นด้วย ,</span></label>
              <input name="tags" value="${esc((n.tags||[]).join(', '))}" placeholder="oom, restart, timeout">
            </div>
          </div>
        </div>

        <!-- Section: Incident Context -->
        <div class="gn-ed-section">
          <div class="gn-ed-section-hd c-symptom"><i data-icon="alert-triangle"></i> Incident Context</div>
          <div class="gn-field">
            <label>อาการที่เห็น <span class="hint">Symptoms</span></label>
            <textarea name="symptoms" maxlength="4000" placeholder="อธิบาย error / behaviour ที่เห็น">${esc(n.symptoms)}</textarea>
          </div>
          <div class="gn-row2">
            <div class="gn-field">
              <label>เจอตอนไหน <span class="hint">Trigger</span></label>
              <textarea name="when_encountered" maxlength="2000" placeholder="deploy? cutoff? load สูง?">${esc(n.when_encountered)}</textarea>
            </div>
            <div class="gn-field">
              <label>Root Cause</label>
              <textarea name="root_cause" maxlength="4000" placeholder="รากของปัญหาคืออะไร">${esc(n.root_cause)}</textarea>
            </div>
          </div>
        </div>

        <!-- Section: Resolution -->
        <div class="gn-ed-section">
          <div class="gn-ed-section-hd c-steps"><i data-icon="check-square"></i> Resolution Steps</div>
          <div class="gn-field">
            <div class="gn-steps-editor" id="gn-steps-ed"></div>
            <button type="button" class="gn-btn-add-step" id="gn-add-step"><i data-icon="plus"></i> Add step</button>
          </div>
        </div>

        <!-- Section: Impact & Response -->
        <div class="gn-ed-section">
          <div class="gn-ed-section-hd c-teams"><i data-icon="shield-alert"></i> Impact &amp; Response</div>

          <div class="gn-field">
            <label>Teams to Notify</label>
            <div class="gn-teams-grid" id="gn-teams-grid">
              ${(() => {
                // All teams = defaults + custom (from note, not in defaults)
                const customTeams = (n.teams_to_notify||[]).filter(t => !TEAMS.includes(t));
                return [
                  ...TEAMS.map(t=>`
                    <label class="gn-team-check ${(n.teams_to_notify||[]).includes(t)?'checked':''}">
                      <input type="checkbox" name="team_notify" value="${esc(t)}" ${(n.teams_to_notify||[]).includes(t)?'checked':''}>
                      <span>${esc(t)}</span>
                    </label>`),
                  ...customTeams.map(t=>`
                    <label class="gn-team-check custom checked" data-custom>
                      <input type="checkbox" name="team_notify" value="${esc(t)}" checked>
                      <span>${esc(t)}</span>
                      <button type="button" class="gn-team-del" data-val="${esc(t)}">✕</button>
                    </label>`),
                ].join('');
              })()}
            </div>
            <div class="gn-teams-custom-row">
              <input type="text" id="gn-team-custom-input" placeholder="เพิ่มทีมอื่นๆ เช่น PCS Team...">
              <button type="button" class="gn-teams-custom-add" id="gn-team-custom-add">+ เพิ่ม</button>
            </div>
          </div>

          <div class="gn-field">
            <label>MA Required <span class="hint">ต้องขึ้น Maintenance Announcement</span></label>
            <label class="gn-toggle-wrap">
              <div class="gn-toggle ${n.ma_required?'on':''}" id="gn-ma-toggle">
                <div class="gn-toggle-thumb"></div>
              </div>
              <span id="gn-ma-label">${n.ma_required?'ต้องขึ้น MA':'ไม่ต้องขึ้น MA'}</span>
              <input type="hidden" name="ma_required" id="gn-ma-input" value="${n.ma_required?'1':'0'}">
            </label>
            <!-- MA Services selector — shown when MA = ON -->
            <div class="gn-ma-svc-wrap" id="gn-ma-svc-wrap" style="${n.ma_required?'':'display:none'}">
              <div class="gn-ma-svc-chips" id="gn-ma-svc-chips"></div>
              <div class="gn-ma-svc-search">
                <i data-icon="search" style="color:var(--text-muted);flex-shrink:0"></i>
                <input type="text" id="gn-ma-svc-q" placeholder="ค้นหา service... เช่น Login, Wallet, NANO">
              </div>
              <div class="gn-ma-svc-dd" id="gn-ma-svc-dd"></div>
            </div>
          </div>

          <div class="gn-row2">
            <div class="gn-field">
              <label>Service Impact</label>
              <div class="gn-impact-opts" id="gn-impact-opts">
                ${SERVICE_IMPACT.map(s=>`
                  <label class="gn-impact-opt ${(n.service_impact||'none')===s.id?'active':''}" data-val="${s.id}">
                    <input type="radio" name="service_impact" value="${s.id}" ${(n.service_impact||'none')===s.id?'checked':''}>
                    ${esc(s.label)}
                  </label>`).join('')}
              </div>
            </div>
            <div class="gn-field">
              <label>Escalation Path <span class="hint">ถ้าแก้ไม่ได้ต้องแจ้งใครต่อ</span></label>
              <textarea name="escalation_path" maxlength="2000" placeholder="1. SM Lead → 2. Dev Team Lead → 3. Management">${esc(n.escalation_path||'')}</textarea>
            </div>
          </div>

        </div>

        <!-- Section: Related -->
        <div class="gn-ed-section">
          <div class="gn-ed-section-hd c-rb"><i data-icon="link-2"></i> References</div>

          <div class="gn-field">
            <label>Related Runbooks <span class="hint">Obsidian-style linking</span></label>
            <div class="gn-rb-wrap">
              <div class="gn-rb-chips" id="gn-rb-chips"></div>
              <div class="gn-rb-input-row">
                <i data-icon="search" style="color:var(--text-muted);flex-shrink:0"></i>
                <input type="text" id="gn-rb-q" placeholder="พิมพ์ชื่อ note เพื่อเชื่อมโยง..." autocomplete="off">
              </div>
              <div class="gn-rb-dd" id="gn-rb-dd"></div>
            </div>
          </div>

          <div class="gn-row2">
            <div class="gn-field">
              <label>Related Services <span class="hint">คั่นด้วย ,</span></label>
              <input name="related_services" value="${esc((n.related_services||[]).join(', '))}" placeholder="nano-cutoff, tmn-wallet">
            </div>
            <div class="gn-field">
              <label>Note เพิ่มเติม</label>
              <textarea name="notes" maxlength="4000" placeholder="บันทึกเพิ่มเติม">${esc(n.notes)}</textarea>
            </div>
          </div>

          <div class="gn-field">
            <label>Links / References</label>
            <div class="gn-links-editor" id="gn-links-ed"></div>
            <button type="button" class="gn-btn-add-step" id="gn-add-link"><i data-icon="plus"></i> Add link</button>
          </div>
        </div>

      </form>
    </div>`;

  window.Icons?.render?.(v);

  // Steps
  const stepsWrap=document.getElementById('gn-steps-ed');
  const addStep=(text='',done=false)=>{
    const row=document.createElement('div'); row.className='gn-step-row';
    row.innerHTML=`<input type="checkbox" ${done?'checked':''}><input type="text" placeholder="อธิบาย step..." value="${esc(text)}" maxlength="400"><button type="button" class="gn-step-del">✕</button>`;
    row.querySelector('.gn-step-del').addEventListener('click',()=>row.remove());
    stepsWrap.appendChild(row);
  };
  (n.resolution_steps||[]).forEach(s=>addStep(s.text,s.done));
  if(!(n.resolution_steps||[]).length) addStep();
  document.getElementById('gn-add-step').addEventListener('click',()=>addStep());

  // Links
  const linksWrap=document.getElementById('gn-links-ed');
  const addLink=(label='',url='')=>{
    const row=document.createElement('div'); row.className='gn-link-row-ed';
    row.innerHTML=`<input type="text" placeholder="label" value="${esc(label)}" maxlength="120"><input type="text" placeholder="https://..." value="${esc(url)}" maxlength="500"><button type="button" class="gn-btn ghost" style="padding:5px 9px;font-size:12px">✕</button>`;
    row.querySelector('button').addEventListener('click',()=>row.remove());
    linksWrap.appendChild(row);
  };
  (n.links||[]).forEach(l=>addLink(l.label,l.url));
  document.getElementById('gn-add-link').addEventListener('click',()=>addLink());

  // MA toggle
  const maToggle=document.getElementById('gn-ma-toggle');
  const maInput=document.getElementById('gn-ma-input');
  const maLabel=document.getElementById('gn-ma-label');
  const maSvcWrap=document.getElementById('gn-ma-svc-wrap');
  maToggle.addEventListener('click',()=>{
    const on=!maToggle.classList.contains('on');
    maToggle.classList.toggle('on',on);
    maInput.value=on?'1':'0';
    maLabel.textContent=on?'ต้องขึ้น MA':'ไม่ต้องขึ้น MA';
    maSvcWrap.style.display=on?'':'none';
  });

  // MA Services autocomplete
  let _selectedMaSvcs=[...(n.ma_service_ids||[])];
  const maSvcChips=document.getElementById('gn-ma-svc-chips');
  const maSvcQ=document.getElementById('gn-ma-svc-q');
  const maSvcDd=document.getElementById('gn-ma-svc-dd');

  const renderMaChips=()=>{
    if(!maSvcChips)return;
    maSvcChips.innerHTML=_selectedMaSvcs.map((s,i)=>`
      <span class="gn-ma-chip">
        ${esc(s.name)}
        <button type="button" data-i="${i}">✕</button>
      </span>`).join('');
    maSvcChips.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click',()=>{ _selectedMaSvcs.splice(+btn.dataset.i,1); renderMaChips(); });
    });
  };
  renderMaChips();

  if(maSvcQ){
    const renderMaDd=(q='')=>{
      if(!maSvcDd)return;
      const matches=_maServices.filter(s=>
        !_selectedMaSvcs.find(sel=>sel.id===s.id) &&
        (!q || s.name.toLowerCase().includes(q.toLowerCase()) || s.type.toLowerCase().includes(q.toLowerCase()))
      ).slice(0,30);
      if(!matches.length){maSvcDd.innerHTML='<div class="gn-ma-svc-empty">ไม่พบ service</div>';maSvcDd.classList.add('open');return;}
      const grouped={};
      matches.forEach(s=>{ (grouped[s.type]=grouped[s.type]||[]).push(s); });
      maSvcDd.innerHTML=Object.entries(grouped).map(([type,svcs])=>`
        <div class="gn-ma-svc-group-hd">${esc(type)}</div>
        ${svcs.map(s=>`<div class="gn-ma-svc-item" data-id="${s.id}" data-name="${esc(s.name)}">${esc(s.name)}</div>`).join('')}
      `).join('');
      maSvcDd.classList.add('open');
      maSvcDd.querySelectorAll('.gn-ma-svc-item').forEach(item=>{
        item.addEventListener('click',()=>{
          _selectedMaSvcs.push({id:+item.dataset.id, name:item.dataset.name});
          maSvcQ.value=''; maSvcDd.classList.remove('open');
          renderMaChips();
        });
      });
    };
    maSvcQ.addEventListener('focus',()=>renderMaDd(maSvcQ.value));
    maSvcQ.addEventListener('input',()=>renderMaDd(maSvcQ.value));
    document.addEventListener('click',e=>{ if(!e.target.closest('.gn-ma-svc-wrap'))maSvcDd?.classList.remove('open'); });
    // Show dropdown on focus even if empty
    if(n.ma_required) setTimeout(()=>{ if(maSvcQ)maSvcQ.dispatchEvent(new Event('focus')); },50);
  }

  // Service impact visual radio
  document.getElementById('gn-impact-opts').addEventListener('click',e=>{
    const opt=e.target.closest('.gn-impact-opt');
    if(!opt)return;
    document.querySelectorAll('.gn-impact-opt').forEach(o=>o.classList.remove('active'));
    opt.classList.add('active');
    opt.querySelector('input').checked=true;
  });

  // Teams checkbox visual feedback
  const teamsGrid=document.getElementById('gn-teams-grid');
  teamsGrid.addEventListener('change',e=>{
    const cb=e.target; if(cb.type!=='checkbox')return;
    cb.closest('.gn-team-check').classList.toggle('checked',cb.checked);
  });

  // Custom teams
  const teamCustomInput=document.getElementById('gn-team-custom-input');
  const teamCustomAdd=document.getElementById('gn-team-custom-add');
  const addCustomTeam=()=>{
    const val=(teamCustomInput.value||'').trim();
    if(!val)return;
    // Check not already in grid
    if([...teamsGrid.querySelectorAll('input[name="team_notify"]')].some(c=>c.value===val)){
      teamCustomInput.value=''; return;
    }
    const label=document.createElement('label');
    label.className='gn-team-check custom checked';
    label.dataset.custom='';
    label.innerHTML=`<input type="checkbox" name="team_notify" value="${esc(val)}" checked><span>${esc(val)}</span><button type="button" class="gn-team-del" data-val="${esc(val)}">✕</button>`;
    label.querySelector('.gn-team-del').addEventListener('click',()=>label.remove());
    label.querySelector('input').addEventListener('change',e=>label.classList.toggle('checked',e.target.checked));
    teamsGrid.appendChild(label);
    teamCustomInput.value='';
    teamCustomInput.focus();
  };
  teamCustomAdd.addEventListener('click',addCustomTeam);
  teamCustomInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();addCustomTeam();} });

  // Remove custom teams
  teamsGrid.addEventListener('click',e=>{
    const del=e.target.closest('.gn-team-del');
    if(del)del.closest('.gn-team-check').remove();
  });

  // Related runbooks autocomplete
  let _selectedRb=[...(n.related_runbooks||[])];
  const rbChips=document.getElementById('gn-rb-chips');
  const rbQ=document.getElementById('gn-rb-q');
  const rbDd=document.getElementById('gn-rb-dd');

  const renderRbChips=()=>{
    rbChips.innerHTML=_selectedRb.map(rb=>`
      <span class="gn-rb-chip-item" data-rb-id="${esc(rb.id)}">
        <i data-icon="book-open"></i>${esc(rb.title||rb.id)}
        <button type="button" class="gn-rb-chip-del">✕</button>
      </span>`).join('');
    window.Icons?.render?.(rbChips);
    rbChips.querySelectorAll('.gn-rb-chip-del').forEach((btn,i)=>{
      btn.addEventListener('click',()=>{ _selectedRb.splice(i,1); renderRbChips(); });
    });
  };
  renderRbChips();

  rbQ.addEventListener('input',()=>{
    const q=rbQ.value.toLowerCase().trim();
    if(!q){rbDd.innerHTML='';rbDd.classList.remove('open');return;}
    const matches=_all.filter(x=>x.id!==(id||'')&&!_selectedRb.find(r=>r.id===x.id)&&x.title.toLowerCase().includes(q)).slice(0,8);
    if(!matches.length){rbDd.innerHTML='<div class="gn-rb-dd-empty">ไม่พบ note</div>';rbDd.classList.add('open');return;}
    rbDd.innerHTML=matches.map(x=>`<div class="gn-rb-dd-item" data-id="${esc(x.id)}" data-title="${esc(x.title)}">
      <span class="gn-rb-dd-cat">${esc(x.category)}</span>
      ${esc(x.title)}
    </div>`).join('');
    rbDd.classList.add('open');
    window.Icons?.render?.(rbDd);
    rbDd.querySelectorAll('.gn-rb-dd-item').forEach(item=>{
      item.addEventListener('click',()=>{
        _selectedRb.push({id:item.dataset.id,title:item.dataset.title});
        rbQ.value=''; rbDd.innerHTML=''; rbDd.classList.remove('open');
        renderRbChips();
      });
    });
  });
  document.addEventListener('click',e=>{ if(!e.target.closest('.gn-rb-wrap'))rbDd.classList.remove('open'); },{once:false});

  // Save / cancel
  document.getElementById('gn-save-btn').addEventListener('click',()=>saveNote(id,_selectedRb,_selectedMaSvcs));
  document.getElementById('gn-cancel-btn').addEventListener('click',()=>{ _updateOtp(null); id?openDetail(id):renderList(); });
}

async function saveNote(id, selectedRb, selectedMaSvcs) {
  const form=document.getElementById('gn-form');
  if(!form.reportValidity())return;
  const fd=new FormData(form);
  const steps=[...document.querySelectorAll('#gn-steps-ed .gn-step-row')].map(row=>({
    text:row.querySelector('input[type="text"]').value.trim(),
    done:row.querySelector('input[type="checkbox"]').checked,
  })).filter(s=>s.text);
  const links=[...document.querySelectorAll('#gn-links-ed .gn-link-row-ed')].map(row=>{
    const [li,ui]=row.querySelectorAll('input'); return {label:li.value.trim(),url:ui.value.trim()};
  }).filter(l=>l.url);
  const teamsNotify=[...document.querySelectorAll('input[name="team_notify"]:checked')].map(c=>c.value);

  const body={
    title:           fd.get('title'),
    category:        (fd.get('category')||'General').trim(),
    severity:        fd.get('severity'),
    tags:            (fd.get('tags')||'').split(',').map(t=>t.trim()).filter(Boolean),
    symptoms:        fd.get('symptoms'),
    when_encountered:fd.get('when_encountered'),
    root_cause:      fd.get('root_cause'),
    resolution_steps:steps, links,
    related_services:(fd.get('related_services')||'').split(',').map(t=>t.trim()).filter(Boolean),
    notes:           fd.get('notes'),
    teams_to_notify: teamsNotify,
    ma_required:     fd.get('ma_required')==='1',
    ma_service_ids:  selectedMaSvcs||[],
    service_impact:  fd.get('service_impact')||'none',
    escalation_path: fd.get('escalation_path'),
    related_runbooks:selectedRb||[],
  };
  const btn=document.getElementById('gn-save-btn');
  btn.disabled=true; btn.textContent='Saving...';
  const r=id?await API.genzNotes.update(id,body):await API.genzNotes.create(body);
  if(!r?.ok){ Toast.error(r?.data?.message||'บันทึกไม่สำเร็จ'); btn.disabled=false; btn.innerHTML=`<i data-icon="save"></i> ${id?'Save':'Create'}`; window.Icons?.render?.(btn); return; }
  Toast.success(id?'แก้ไขเรียบร้อย':'สร้าง Note เรียบร้อย');
  await loadAll();
  if(id)openDetail(id); else renderList();
}

async function deleteNote(id) {
  const n = _all.find(x => x.id === id);
  const ok = await gnConfirm('ลบ Case Note นี้?', `"${n?.title || id}" จะถูกลบถาวร ไม่สามารถกู้คืนได้`);
  if (!ok) return;
  const r=await API.genzNotes.delete(id);
  if(!r?.ok){Toast.error(r?.data?.message||'ลบไม่สำเร็จ');return;}
  Toast.success('ลบเรียบร้อย');
  await loadAll();
  renderServiceHub();
}

// ══════════════════════════════════════════════════════════════
//  GRAPH PANEL
// ══════════════════════════════════════════════════════════════
function updateGraphStats() {
  const stats=document.getElementById('gn-graph-info');
  if(!stats)return;
  const svcSet=new Set(),tagSet=new Set();
  _all.forEach(n=>{ (n.related_services||[]).forEach(s=>svcSet.add(s)); (n.tags||[]).forEach(t=>tagSet.add(t)); });
  stats.textContent=_all.length?`${_all.length} notes · ${svcSet.size} services · ${tagSet.size} tags`:'เพิ่ม Note แรกเพื่อดู graph';
  const el=document.getElementById('gn-graph-empty');
  if(el)el.style.display=_all.length?'none':'flex';
}

function showGraph() {
  _graphCollapsed=false;
  document.getElementById('gn-pane-graph')?.classList.remove('collapsed');
  document.getElementById('gn-show-graph').style.display='none';
  setTimeout(()=>_graph?.resize(),300);
}
function hideGraph() {
  _graphCollapsed=true;
  document.getElementById('gn-pane-graph')?.classList.add('collapsed');
  document.getElementById('gn-show-graph').style.display='flex';
}

function renderFilteredByService(svcName) {
  const list = _all.filter(n => (n.related_services||[]).includes(svcName));
  _mode = 'svc'; _activeNoteId = null;
  if (_graph) _graph.highlight(null);
  _updateOtp(null);
  buildNav(); // update nav active state

  // Severity distribution for header
  const sevCounts = {low:0, med:0, high:0, critical:0};
  list.forEach(n => { sevCounts[n.severity||'med']++; });
  const domSev = Object.entries(sevCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'med';
  const sevDots = Object.entries(sevCounts).filter(([,c])=>c>0)
    .map(([s,c])=>`<span class="gn-hub-sev-dot sev-${esc(s)}" title="${esc(getSevLabel(s))}: ${c}"></span>`).join('');

  const cards = list.map(n => {
    const abbr = (n.category||'G').charAt(0).toUpperCase();
    const sev  = n.severity || 'med';
    const stepDone  = (n.resolution_steps||[]).filter(s=>s.done).length;
    const stepTotal = (n.resolution_steps||[]).length;
    return `<div class="gn-note-card sev-${esc(sev)}" data-id="${esc(n.id)}" data-abbr="${esc(abbr)}">
      <div class="gnc-inner">
        <div class="gnc-head">
          <span class="gnc-cat"><i data-icon="folder"></i>${esc(n.category)}</span>
          <div class="gnc-badges">
            <span class="gnc-sev sev-${esc(sev)}">${esc(getSevLabel(n.severity))}</span>
            ${n.ma_required?`<span class="gnc-ma-badge">MA</span>`:''}
          </div>
        </div>
        <h3 class="gnc-title">${esc(n.title)}</h3>
        ${n.symptoms||n.root_cause?`<p class="gnc-excerpt">${esc((n.symptoms||n.root_cause||'').slice(0,100))}…</p>`:''}
        <div class="gnc-foot">
          <div class="gnc-tags">
            ${(n.tags||[]).slice(0,3).map(t=>`<span class="gnc-tag">#${esc(t)}</span>`).join('')}
          </div>
          <div class="gnc-meta">
            ${stepTotal?`<span class="gnc-steps">${stepDone}/${stepTotal}</span>`:''}
            <span class="gnc-date">${esc(fmtDate(n.updated_at))}</span>
            <span class="gnc-arrow">→</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  const v = document.getElementById('gn-view');
  v.className = 'gn-view-enter';
  v.innerHTML = `
    <!-- Service header banner -->
    <div class="gn-svc-header sev-${esc(domSev)}">
      <div class="gn-svc-header-left">
        <button class="gn-svc-back" id="gn-svc-back">
          <i data-icon="arrow-left"></i>
        </button>
        <div class="gn-svc-header-icon sev-${esc(domSev)}">
          <i data-icon="server"></i>
        </div>
        <div class="gn-svc-header-info">
          <div class="gn-svc-header-name">${esc(svcName)}</div>
          <div class="gn-svc-header-sub">
            ${list.length} note${list.length!==1?'s':''} &nbsp;
            <span class="gn-hub-sev-dots">${sevDots}</span>
          </div>
        </div>
      </div>
      <button class="gn-btn" id="gn-svc-new-note">
        <i data-icon="plus"></i> เพิ่ม Note
      </button>
    </div>

    <!-- Notes -->
    ${list.length
      ? `<div class="gn-note-list">${cards}</div>`
      : `<div class="gn-empty">
           <div class="gn-empty-icon"><i data-icon="file-text"></i></div>
           <h3>ยังไม่มี Note สำหรับ service นี้</h3>
           <p>เริ่มจด Case Note สำหรับ ${esc(svcName)}</p>
         </div>`
    }
  `;

  window.Icons?.render?.(v);

  document.getElementById('gn-svc-back')?.addEventListener('click', () => {
    _graph?.highlight(null);
    const info = document.getElementById('gn-graph-info');
    if (info) info.textContent = 'Click a node to filter';
    renderServiceHub();
  });
  document.getElementById('gn-svc-new-note')?.addEventListener('click', () => {
    openEditor(); // open editor; user can fill related_services with svcName
  });
  v.addEventListener('click', e => {
    const c = e.target.closest('.gn-note-card');
    if (c) openDetail(c.dataset.id);
  });
}

// ══════════════════════════════════════════════════════════════
//  FULLSCREEN GRAPH MODAL
// ══════════════════════════════════════════════════════════════
let _graphFull = null;

function _applyGraphFilter(node) {
  if (!node) {
    _filter.cat=''; _filter.tag=''; _filter.sev='';
    const i = document.getElementById('gn-graph-info'); if (i) i.textContent = 'Click a node to filter';
    buildNav(); renderList();
  } else if (node.type === 'service') {
    const i = document.getElementById('gn-graph-info'); if (i) i.textContent = `Service: ${node.label}`;
    renderFilteredByService(node.label);
  } else if (node.type === 'tag') {
    _filter.tag = node.label.replace(/^#/, ''); _filter.cat = ''; _filter.sev = '';
    const i = document.getElementById('gn-graph-info'); if (i) i.textContent = `Tag: ${node.label}`;
    buildNav(); renderList();
  } else if (node.type === 'note') {
    openDetail(node.noteId);
  }
}

function openGraphModal() {
  const modal = document.getElementById('gn-graph-modal');
  if (!modal) return;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  window.Icons?.render?.(modal);

  const canvas = document.getElementById('gn-canvas-full');
  if (canvas && !_graphFull) {
    _graphFull = new KnowledgeGraph(canvas, { interactive: true });
    _graphFull._onFilter = node => { closeGraphModal(); _applyGraphFilter(node); _graph?.highlight(node?.noteId || null); };
    const ro = new ResizeObserver(() => _graphFull.resize());
    ro.observe(canvas.parentElement);
  }

  if (_graphFull) {
    _graphFull.zoom = 1; _graphFull.panX = 0; _graphFull.panY = 0;
    _graphFull.setData(_all);
    setTimeout(() => {
      _graphFull.resize();
      setTimeout(() => _graphFull.fitToView(), 300);
    }, 60);
  }

  const stats = document.getElementById('gn-gm-stats');
  if (stats) {
    const svcSet = new Set(), tagSet = new Set();
    _all.forEach(n => { (n.related_services||[]).forEach(s => svcSet.add(s)); (n.tags||[]).forEach(t => tagSet.add(t)); });
    stats.textContent = `${_all.length} notes · ${svcSet.size} services · ${tagSet.size} tags`;
  }
}

function closeGraphModal() {
  const modal = document.getElementById('gn-graph-modal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════
//  SEARCH
// ══════════════════════════════════════════════════════════════
const qInput=document.getElementById('gn-q'), qClear=document.getElementById('gn-q-clear');
qInput.addEventListener('input',()=>{
  _filter.q=qInput.value; qClear.classList.toggle('visible',!!_filter.q);
  clearTimeout(_debTimer); _debTimer=setTimeout(()=>{buildNav();renderList();},220);
});
qClear.addEventListener('click',()=>{ qInput.value='';_filter.q=''; qClear.classList.remove('visible'); buildNav();renderList(); });

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
function init() {
  document.getElementById('gn-btn-new').addEventListener('click',()=>openEditor());
  document.getElementById('gn-graph-close')?.addEventListener('click',hideGraph);
  document.getElementById('gn-fab-graph')?.addEventListener('click',()=>{ document.getElementById('gn-pane-graph')?.classList.toggle('mobile-open'); });
  document.getElementById('gn-show-graph')?.addEventListener('click',showGraph);
  document.getElementById('gn-graph-expand')?.addEventListener('click',openGraphModal);

  // Fullscreen modal controls
  document.getElementById('gn-gm-close')?.addEventListener('click', closeGraphModal);
  document.getElementById('gn-gm-fit')?.addEventListener('click', () => _graphFull?.fitToView());
  document.getElementById('gn-gm-zoomin')?.addEventListener('click', () => {
    if (_graphFull) { _graphFull.zoom = Math.min(6, _graphFull.zoom * 1.3); _graphFull._draw(); }
  });
  document.getElementById('gn-gm-zoomout')?.addEventListener('click', () => {
    if (_graphFull) { _graphFull.zoom = Math.max(0.15, _graphFull.zoom * 0.77); _graphFull._draw(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('gn-graph-modal')?.classList.contains('open')) closeGraphModal();
  });

  const canvas=document.getElementById('gn-canvas');
  if(canvas){
    _graph=new KnowledgeGraph(canvas);
    _graph._onFilter = node => _applyGraphFilter(node);
    const ro=new ResizeObserver(()=>_graph.resize());
    ro.observe(document.getElementById('gn-graph-canvas-wrap'));
    setTimeout(()=>_graph.resize(),100);
  }
  loadAll();
}

init();
})();
