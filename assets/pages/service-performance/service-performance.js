// service-performance — page script, extracted from service-performance.html.
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
  Layout.render('service-performance');

  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Error Focus helpers (used by SP._loadErrorFocus + friends).
  const _efFmt = (n) => (typeof n !== 'number' || !isFinite(n)) ? '—'
    : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k'
    : String(Math.round(n));
  const _efPct = (n) => (n == null || !isFinite(n)) ? '—' : n.toFixed(n >= 10 ? 0 : 1) + '%';

  // ── Formatting helpers ──────────────────────────────────────────
  function fmtBytes(n) {
    if (n == null || n <= 0) return '—';
    const u = ['B','KB','MB','GB','TB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + ' ' + u[i];
  }
  function fmtCores(n) {
    if (n == null || n <= 0) return '—';
    if (n >= 1) return n.toFixed(2) + ' cores';
    return (n * 1000).toFixed(0) + ' m';
  }
  function pctBar(pct) {
    if (pct == null) return '<span style="color:var(--sp-text-soft);font-size:11px">n/a</span>';
    const cls = pct >= 80 ? 'hot' : pct >= 60 ? 'warn' : '';
    const w = Math.min(100, Math.max(0, pct));
    return `<span class="sp2-bar"><span class="sp2-bar-track ${cls}"><i style="width:${w}%"></i></span><span class="mono" style="font-size:11.5px;min-width:44px;text-align:right">${pct.toFixed(1)}%</span></span>`;
  }
  function sevClass(sev) {
    if (!sev || sev === '-') return '';
    const n = parseInt(sev, 10);
    return n === 1 ? 'sev1' : n === 2 ? 'sev2' : 'sev3';
  }
  function runwayColor(slug) {
    return { 'eks-tmn':'#3b82f6', 'eks-nano':'#a855f7', 'acm':'#f59e0b' }[slug] || '#71717a';
  }

  // ── SVG chart primitives (no library) ───────────────────────────
  // Responsive line/area chart. Instead of viewBox-scaling (which stretches
  // text and lines when `preserveAspectRatio="xMinYMin meet"`), we render at the
  // container's actual pixel width and use 1:1 SVG units → CSS pixels. Result:
  // no distortion, crisp text, consistent stroke width at any width.
  //
  // Usage:
  //   1. Render a placeholder <div data-chart data-...="..."></div> in HTML
  //   2. Call paintCharts() after inject — measures container width, draws SVG
  //   3. A ResizeObserver re-renders on layout changes (window resize / drawer)
  // Adaptive x-axis time label. Format shifts based on total span so the
  // reader can always locate a tick in the calendar without a legend:
  //   <24h span   → HH:MM
  //   24h–7d span → "DD MMM" line 1 + "HH:MM" line 2 (two-line stack)
  //   ≥7d span    → "DD MMM"
  // `full=true` (used by the crosshair tooltip) always includes date + time
  // regardless of span so the exact timestamp is unambiguous.
  function _fmtChartTime(ts, spanSec, full) {
    const d = new Date(ts * 1000);
    const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (full) return `${day} ${time}`;
    if (spanSec < 86400)      return time;
    if (spanSec < 7 * 86400)  return { line1: day, line2: time };
    return day;
  }

  // Build the x-axis tick <text> + light vertical grid lines. Kept as its own
  // helper so single-series and multi-line charts render an identical axis.
  function _buildXAxis(W, H, PL, PR, PB, xMin, xMax, sx) {
    const usableW  = W - PL - PR;
    const labelCount = Math.max(3, Math.min(9, Math.floor(usableW / 90)));
    const spanSec = xMax - xMin;
    let xLabels = '', xGrid = '';
    for (let i = 0; i < labelCount; i++) {
      const f  = i / (labelCount - 1);
      const ts = xMin + spanSec * f;
      const xx = sx(ts).toFixed(1);
      // Faint vertical grid — skip the outermost pair so the axis edges stay clean.
      if (i > 0 && i < labelCount - 1) {
        xGrid += `<line x1="${xx}" x2="${xx}" y1="${(14).toFixed(1)}" y2="${(H - PB).toFixed(1)}" stroke="var(--border)" stroke-dasharray="2 4" opacity=".55"/>`;
      }
      const anchor = i === 0 ? 'start' : i === labelCount - 1 ? 'end' : 'middle';
      const lbl = _fmtChartTime(ts, spanSec, false);
      if (typeof lbl === 'string') {
        xLabels += `<text x="${xx}" y="${H - 8}" font-size="10.5" fill="var(--sp-text-soft)" text-anchor="${anchor}">${lbl}</text>`;
      } else {
        // Two-line stack: date on top, time below.
        xLabels += `<text x="${xx}" y="${H - 15}" font-size="10" fill="var(--sp-text-soft)" text-anchor="${anchor}">${lbl.line1}</text>`;
        xLabels += `<text x="${xx}" y="${H - 4}"  font-size="10" fill="var(--sp-text-soft)" text-anchor="${anchor}" opacity=".8">${lbl.line2}</text>`;
      }
    }
    return { xLabels, xGrid };
  }

  // ── SLO defaults (Feature 5 · Sprint 2) ────────────────────────────
  // Hardcoded warn/critical thresholds chosen from existing color rules
  // in the codebase (e.g. latency `.now.warn` fires ≥ 500ms in the CC).
  // Absolute-value thresholds (latency, GC pause) apply universally;
  // percentage-based ones (CPU/MEM/heap) need multiplication by the
  // per-service limit at call time. Option to override per-service via
  // CSV inventory columns (`sloLatencyMs`, `sloCpuPct`, ...) is wired
  // in `_sloFor(name, d)` — falls back to defaults when column absent.
  const SLO_DEFAULTS = {
    latencyMs: { warn: 500,   crit: 1000 },
    cpuPct:    { warn: 0.60,  crit: 0.80 },
    memPct:    { warn: 0.75,  crit: 0.85 },
    heapPct:   { warn: 0.75,  crit: 0.85 },
    gcPauseMs: { warn: 100,   crit: 500 },
    tomcatBusyPct: { warn: 0.70, crit: 0.90 },
    hikariActivePct: { warn: 0.70, crit: 0.90 },
  };
  // Build the SLO-line array expected by areaChart. Reads override from
  // d.inventory when present; otherwise falls back to defaults. Both
  // labels get the localised "warn"/"crit" suffix so the meaning reads
  // right off the chart without a legend.
  function _sloLines(kind, ctx) {
    ctx = ctx || {};
    const inv = ctx.inventory || {};
    const def = SLO_DEFAULTS[kind];
    if (!def) return [];
    const warn = Number.isFinite(+inv[kind + 'Warn']) ? +inv[kind + 'Warn'] : def.warn;
    const crit = Number.isFinite(+inv[kind + 'Crit']) ? +inv[kind + 'Crit'] : def.crit;
    // Percentage-family SLOs need multiplication by the per-service limit.
    // ctx.limit carries the absolute limit (e.g. cores or bytes) for that
    // metric — caller supplies it since we don't want to reach into d here.
    const isPct = kind.endsWith('Pct');
    if (isPct) {
      const lim = +ctx.limit;
      if (!lim || !Number.isFinite(lim)) return [];   // no limit → skip
      return [
        { value: warn * lim, label: `warn ${(warn * 100).toFixed(0)}%`, color: 'var(--warn)' },
        { value: crit * lim, label: `crit ${(crit * 100).toFixed(0)}%`, color: 'var(--hot)' },
      ];
    }
    return [
      { value: warn, label: 'warn',      color: 'var(--warn)' },
      { value: crit, label: 'critical',  color: 'var(--hot)' },
    ];
  }

  // Log-scale toggle state — per-slot, keyed by a stable id we stash on
  // the slot. Global so it survives paintCharts rebuild (dataset would be
  // wiped when innerHTML changes on the wrapper card).
  const _logScaleSlots = new Set();
  function _slotKey(slot) {
    if (!slot._sp2key) slot._sp2key = 'k' + Math.random().toString(36).slice(2, 8);
    return slot._sp2key;
  }
  // Log10 helper — clamps to 1 as floor so log(0) → 0 instead of -Infinity.
  // Chart values are always ≥ 0 (rates, counts, bytes, ms) so this is safe.
  function _logSafe(v) { return v > 1 ? Math.log10(v) : 0; }
  // Minimal escape for SVG text content — < > & only. Label text goes
  // straight into <text>…</text> so untrusted input needs sanitizing.
  function _escSvg(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function _buildAreaSvg(points, W, H, unitFmt, color, band, opts) {
    opts = opts || {};
    const logY = !!opts.logY;
    // SLO threshold lines — array of {value, label, color}. Each becomes a
    // horizontal dashed line at that Y value with a small label pill to
    // the right. Values outside the visible Y-axis range are skipped so
    // they don't clip. Included in yMax expansion so a threshold above
    // current data still shows up (e.g. 1s latency SLO on a chart that
    // currently peaks at 300ms — line should be visible for context).
    const sloLines = Array.isArray(opts.slo) ? opts.slo.filter(s => s && Number.isFinite(+s.value)) : [];
    if (!points || points.length < 2) return '<div class="sp2-chart-empty">ไม่มีข้อมูล time-series</div>';
    const spanSec  = points[points.length - 1][0] - points[0][0];
    // Two-line date+time labels need extra vertical room, else they clip.
    const PL = 48, PR = 14, PT = 14, PB = (spanSec >= 86400 && spanSec < 7 * 86400) ? 34 : 26;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const xMin = xs[0], xMax = xs[xs.length - 1];
    // Optional min/max band — same timestamps as the avg series, one point
    // per sample. Rendered as a translucent envelope behind the avg line so
    // users can see the pod-spread at a glance (max = worst pod at each
    // moment, min = best pod). Falls back gracefully when band is missing.
    const bandMax = (band && band.max && band.max.length >= 2) ? band.max : null;
    const bandMin = (band && band.min && band.min.length >= 2) ? band.min : null;
    // Auto-fit Y-axis to actual range. For metrics that stay near a stable
    // value (container_memory_working_set_bytes typically hovers around the
    // JVM's -Xmx + overhead), a 0-based axis flattens the line into a barely-
    // visible bump at the top. Padding both sides by 15% keeps the shape
    // readable without extending needlessly into empty ranges.
    let yMax = Math.max(...ys), yMin = Math.min(...ys);
    if (bandMax) for (const p of bandMax) { if (p[1] > yMax) yMax = p[1]; }
    if (bandMin) for (const p of bandMin) { if (p[1] < yMin) yMin = p[1]; }
    // Include SLO thresholds so they stay visible even when data is well
    // below them (e.g. current latency 100ms + 1s SLO line). But cap the
    // stretch at 2× dataMax so a way-high SLO (e.g. 5s crit line when data
    // sits at 30ms) doesn't distort the axis into an unreadable strip at
    // the bottom. Beyond the cap the SLO line simply clips (`sy(v)` check
    // in the render loop drops it) — cleaner than a squished chart.
    const dataMax = yMax;
    for (const s of sloLines) {
      const v = +s.value;
      if (v > yMax && v <= dataMax * 2) yMax = v;
    }
    const yRange = yMax - yMin;
    if (yRange <= 0) {
      yMin = Math.max(0, yMax * 0.95);
      yMax = yMax * 1.05 || 1;
    } else {
      const pad = yRange * 0.15;
      yMin = Math.max(0, yMin - pad);
      yMax = yMax + pad;
    }
    const sx = (x) => PL + ((x - xMin) / (xMax - xMin || 1)) * (W - PL - PR);
    // Y-scale: linear (default) OR log10 when opts.logY is true. Log makes
    // long-tail latency spikes readable (100ms baseline + occasional 30s
    // spike would flatten to a single peak on linear — log spreads them so
    // the shape of both is visible). Uses log10 of clamped(v, 1) so zeros
    // don't blow up; visualizes values from ~1 upward on the log scale.
    const _lyMin = _logSafe(yMin), _lyMax = _logSafe(yMax);
    const sy = logY
      ? (y) => H - PB - ((_logSafe(y) - _lyMin) / (_lyMax - _lyMin || 1)) * (H - PT - PB)
      : (y) => H - PB - ((y - yMin)             / (yMax - yMin || 1))       * (H - PT - PB);
    const path = points.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
    const area = path + ` L${sx(xMax).toFixed(1)},${(H - PB).toFixed(1)} L${sx(xMin).toFixed(1)},${(H - PB).toFixed(1)} Z`;

    // Min-max band — drawn as TWO separate envelopes (upper: avg→max,
    // lower: min→avg) so each side renders independently. Some metrics
    // (e.g. latency from Micrometer `_max`) only have a legitimate max
    // and no true min — we want the upper band to still appear in that
    // case, not silently drop when the min series is empty.
    //   14% opacity = "context tint" not "second series"; upper band a
    //   touch darker so max spikes read more prominently than min dips.
    let bandPath = '';
    if (bandMax || bandMin) {
      // Timestamp → avg-Y helper. Nearest-neighbour on the avg series so
      // the polygon closes cleanly even when min/max sample counts differ
      // slightly (Prometheus can return uneven timestamps).
      const avgAt = (ts) => {
        let lo = 0, hi = points.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (points[mid][0] < ts) lo = mid + 1; else hi = mid;
        }
        if (lo > 0 && Math.abs(points[lo-1][0] - ts) < Math.abs(points[lo][0] - ts)) lo--;
        return points[lo][1];
      };
      if (bandMax && bandMax.length >= 2) {
        const topD = bandMax.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
        const botD = [...bandMax].reverse().map((p, i) => 'L' + sx(p[0]).toFixed(1) + ',' + sy(avgAt(p[0])).toFixed(1)).join(' ');
        bandPath += `<path d="${topD} ${botD} Z" fill="${color}" fill-opacity=".16" stroke="none"/>`;
      }
      if (bandMin && bandMin.length >= 2) {
        const topD = bandMin.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(avgAt(p[0])).toFixed(1)).join(' ');
        const botD = [...bandMin].reverse().map((p, i) => 'L' + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
        bandPath += `<path d="${topD} ${botD} Z" fill="${color}" fill-opacity=".10" stroke="none"/>`;
      }
    }

    // Y-axis grid — 4 lines
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const yVal = yMin + (yMax - yMin) * (i / 4);
      const yy = sy(yVal).toFixed(1);
      gridLines += `<line x1="${PL}" x2="${W - PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
      gridLines += `<text x="${PL - 6}" y="${yy}" font-size="10" fill="var(--sp-text-soft)" text-anchor="end" dominant-baseline="middle">${unitFmt(yVal)}</text>`;
    }

    const { xLabels, xGrid } = _buildXAxis(W, H, PL, PR, PB, xMin, xMax, sx);

    // SLO threshold lines — dashed horizontal + right-anchored label pill.
    // Rendered in-plot (before crosshair overlay so hover still hits).
    // Label sits inside the plot on the right edge — no extra margin needed
    // and doesn't compete with the Y-axis labels on the left.
    let sloSvg = '';
    for (const s of sloLines) {
      const v = +s.value;
      // Y computation matches the primary sy() (respects log-scale toggle).
      const yPx = sy(v);
      if (yPx < PT || yPx > H - PB) continue;   // outside plot area
      const c = s.color || 'var(--warn)';
      const lbl = s.label || unitFmt(v);
      sloSvg += `<line x1="${PL}" x2="${W - PR}" y1="${yPx.toFixed(1)}" y2="${yPx.toFixed(1)}" stroke="${c}" stroke-width="1" stroke-dasharray="5 4" opacity=".7"/>`;
      // Small label pill anchored to the right edge, offset up by 3px so
      // it sits above the line rather than centered on it (easier to read
      // when the line runs through a data point).
      sloSvg += `<text x="${W - PR - 4}" y="${(yPx - 4).toFixed(1)}" font-size="9.5" font-weight="600" fill="${c}" text-anchor="end">${_escSvg(lbl)}</text>`;
    }

    // Crosshair scaffolding — line + focus dot + interaction overlay. The
    // overlay <rect> captures pointer events and forwards them to paintCharts'
    // handler; the line + dot start hidden and only appear on hover.
    const cxLine = `<line class="sp2-cx-line" x1="0" x2="0" y1="${PT}" y2="${H - PB}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
    const cxDot  = `<circle class="sp2-cx-dot" cx="0" cy="0" r="4" fill="${color}" stroke="var(--bg-card)" stroke-width="2" opacity="0"/>`;
    const overlay = `<rect class="sp2-cx-overlay" x="${PL}" y="${PT}" width="${Math.max(0, W - PL - PR)}" height="${Math.max(0, H - PT - PB)}"/>`;

    const grad = 'sp2grad-' + Math.random().toString(36).slice(2, 8);
    // NB: no `height` attribute — it contributes to the SVG's intrinsic size
    // which then feeds back into slot.clientHeight, causing paintCharts →
    // RO → paintCharts to grow the card on every range change. Height comes
    // purely from CSS (`svg { height:100% }`) against a slot with a fixed
    // min-height, keeping the loop stable.
    return `<svg width="${W}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
      <defs>
        <linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${color}" stop-opacity=".28"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      ${xGrid}
      <path d="${area}" fill="url(#${grad})"/>
      ${bandPath}
      ${sloSvg}
      <path d="${path}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>
      ${xLabels}
      ${cxLine}
      ${cxDot}
      ${overlay}
    </svg><div class="sp2-cx-tip"></div>`;
  }

  // Placeholder shell — data lives on the DOM node so paintCharts() can read
  // it without touching global state.
  // `unitFmt` may be a function (formatting the Y-axis) OR a string tag
  // ('cores' | 'bytes' | 'reqs' | 'ms') — the tag is preferred because it
  // survives the JSON round-trip through the DOM data-attrs.
  function areaChart(points, unitFmt, color = 'var(--cool)', band, slo) {
    if (!points || points.length < 2) return '<div class="sp2-chart-empty">ไม่มีข้อมูล time-series</div>';
    // Explicit string tag wins; otherwise infer from the color choice for
    // back-compat with the old (points, unitFmtFn, color) call sites.
    const unitType = (typeof unitFmt === 'string')
      ? unitFmt
      : (color.includes('emerald') ? 'bytes' : 'cores');
    // Optional min-max band: {max: [[ts,v],...], min: [[ts,v],...]}. Skip
    // the attribute when absent so old chart types keep zero payload.
    const bandAttr = (band && (band.max?.length || band.min?.length))
      ? ` data-band='${JSON.stringify(band).replace(/</g, '\\u003c').replace(/'/g, '&#39;')}'`
      : '';
    // Optional SLO threshold lines: array of {value, label, color}.
    const sloAttr = (Array.isArray(slo) && slo.length)
      ? ` data-slo='${JSON.stringify(slo).replace(/</g, '\\u003c').replace(/'/g, '&#39;')}'`
      : '';
    // Escape `'` → &#39; so metric labels containing apostrophes (seen in
    // real Prom data, e.g. `id="mapped - 'non-volatile memory'"`) don't close
    // the single-quoted attribute early and truncate the JSON.
    const pointsJson = JSON.stringify(points).replace(/'/g, '&#39;');
    return `<div class="sp2-chart-slot" data-chart="area" data-points='${pointsJson}' data-color="${color}" data-unit="${unitType}"${bandAttr}${sloAttr} style="min-height:180px"></div>`;
  }

  // Per-pod line palette — 22 slots, cycled if more pods exist. Picked for
  // decent separation on both light/dark themes. Not tied to any semantic
  // meaning (severity/status) — purely visual differentiation.
  const POD_PALETTE = [
    '#4c78a8','#f58518','#e45756','#72b7b2','#54a24b','#eeca3b','#b279a2','#ff9da6',
    '#9d755d','#bab0ac','#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272',
    '#fc8452','#9a60b4','#ea7ccc','#17becf','#bcbd22','#e377c2',
  ];

  // Multi-line variant of areaChart — draws one line per {pod, values} entry.
  // Same data-attr contract as areaChart, differentiated by data-chart="multi".
  function multiLineChart(series, unitType = 'cores') {
    if (!series || !series.length) return '<div class="sp2-chart-empty">ไม่มีข้อมูล time-series</div>';
    // Single-quote-safe JSON — pod names are k8s DNS labels so they can't
    // contain quotes/angle-brackets in practice, BUT this helper is also
    // reused for arbitrary metric labels (e.g. buffer id "mapped - 'non-volatile memory'",
    // thread state names) where apostrophes appear. Escape `'` → &#39; so
    // the single-quoted `data-series=` attribute doesn't close early.
    const json = JSON.stringify(series).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
    // Explicit `height` (not `min-height`) so the child svg's `height:100%`
    // has a definite parent to resolve against — otherwise the browser
    // falls back to viewBox-aspect intrinsic sizing which grows unbounded
    // when the outer container width changes (see modal open/close bug).
    return `<div class="sp2-chart-slot" data-chart="multi" data-series='${json}' data-unit="${unitType}" style="height:240px"></div>`;
  }

  // Measure each chart slot's actual width and render the SVG at that size.
  // Called after every _renderDetail; also wired to ResizeObserver so window
  // resize / drawer toggles redraw automatically without stretching.
  function paintCharts() {
    const unitFns = {
      cores: (v) => v.toFixed(v >= 1 ? 2 : 3),
      bytes: (v) => fmtBytes(v),
      // req/sec (TXN rate) — integer for high volumes, decimals for low
      reqs:  (v) => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2),
      // Latency — auto-scale to seconds when ≥1000 ms so the axis stays legible
      ms:    (v) => v >= 1000 ? (v/1000).toFixed(2) + 's' : v.toFixed(0) + 'ms',
    };
    document.querySelectorAll('.sp2-chart-slot').forEach(slot => {
      const w = Math.max(280, slot.clientWidth || 600);
      // Measure actual container height so charts stretch when the card is
      // grown by the grid (e.g. taller neighbor pushes row height up). Falls
      // back to a floor if the slot hasn't been laid out yet.
      const kind = slot.dataset.chart || 'area';
      const fallbackH = kind === 'multi' ? 240 : 180;
      const h = Math.max(fallbackH, slot.clientHeight || fallbackH);
      // Skip repaint if dims unchanged — belt-and-suspenders against the
      // ResizeObserver → paintCharts feedback loop that used to grow the
      // card vertically on every range change (fixed by dropping the SVG
      // `height` attribute, but keep this guard so a future regression
      // can't reintroduce the growth).
      if (slot.dataset.paintedW == w && slot.dataset.paintedH == h && slot.querySelector('svg')) return;
      slot.dataset.paintedW = w;
      slot.dataset.paintedH = h;
      const unit = unitFns[slot.dataset.unit] || unitFns.cores;
      if (kind === 'multi') {
        const series = JSON.parse(slot.dataset.series);
        slot.innerHTML = _buildMultiLineSvg(series, w, h, unit);
        _attachCrosshair(slot, { kind: 'multi', series, unit });
      } else {
        const points = JSON.parse(slot.dataset.points);
        const color  = slot.dataset.color;
        const band   = slot.dataset.band ? JSON.parse(slot.dataset.band) : null;
        const slo    = slot.dataset.slo  ? JSON.parse(slot.dataset.slo)  : null;
        const logY   = _logScaleSlots.has(_slotKey(slot));
        slot.innerHTML = _buildAreaSvg(points, w, h, unit, color, band, { logY, slo });
        _attachCrosshair(slot, { kind: 'area', points, color, unit, band });
      }
      // Append per-chart expand button. `slot.innerHTML = svg` above just
      // wiped everything inside the slot, so we MUST re-append on every paint
      // (no dedupe guard — there's guaranteed to be exactly one button since
      // the wipe removes any previous instance). Skipped inside the expand
      // modal itself to avoid a nested-expand button.
      if (!slot.closest('#sp2-cx-modal')) {
        slot.style.position = 'relative';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sp2-chart-expand';
        btn.title = 'ขยาย + ดูตารางข้อมูล';
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          SP.expandChart(slot);
        });
        slot.appendChild(btn);

        // Log-scale toggle — only for area charts (log on multi is trickier).
        // Small pill in top-left: "LOG" when active, "LIN" when off. Clicking
        // flips the state + rebuilds the SVG at the same size.
        if (kind === 'area') {
          const isLog = _logScaleSlots.has(_slotKey(slot));
          const logBtn = document.createElement('button');
          logBtn.type = 'button';
          logBtn.className = 'sp2-chart-log' + (isLog ? ' on' : '');
          logBtn.title = isLog
            ? 'Y-axis: log scale (spike-friendly). คลิกเพื่อ back to linear'
            : 'Y-axis: linear. คลิกเพื่อสลับเป็น log scale (เห็น spike ที่ linear กลบไป)';
          logBtn.textContent = isLog ? 'LOG' : 'LIN';
          logBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const k = _slotKey(slot);
            if (_logScaleSlots.has(k)) _logScaleSlots.delete(k); else _logScaleSlots.add(k);
            // Bypass the "size unchanged" guard so the axis actually redraws.
            slot.dataset.paintedW = ''; slot.dataset.paintedH = '';
            paintCharts();
          });
          slot.appendChild(logBtn);
        }
      }
    });
  }

  // ── Chart hover: crosshair + floating tooltip ─────────────────────
  // Wire mousemove/mouseleave on the overlay rect. On move: convert cursor
  // x → nearest data-point index (per series, since points can be sparse),
  // move the crosshair line + focus dots to those positions, and update the
  // tooltip content + position. On leave: hide everything.
  //
  // Global registry of active-slot controllers so that when _renderDetail()
  // wipes chart-slot nodes wholesale (their `_sp2Abort` reference vanishes
  // with them), the next _attachCrosshair() call can find + abort the
  // orphaned window listeners.
  const _crosshairControllers = new Set();
  function _attachCrosshair(slot, cfg) {
    const svg     = slot.querySelector('svg');
    const overlay = slot.querySelector('.sp2-cx-overlay');
    const tip     = slot.querySelector('.sp2-cx-tip');
    if (!svg || !overlay || !tip) return;
    const line = slot.querySelector('.sp2-cx-line');
    const dots = slot.querySelectorAll('.sp2-cx-dot');

    // Every paintCharts() call rewires listeners on the fresh overlay + on
    // window (mouseup for brush-drag commit). Overlay listeners die with the
    // detached node, but the window listener would accumulate on every repaint
    // (range switch, resize, log-scale toggle) and never get GC'd. Wrap ALL
    // listener registrations in an AbortController; abort the previous one on
    // this slot before attaching new ones.
    //
    // Extra wrinkle: _renderDetail() replaces the ENTIRE chart-slot tree by
    // rewriting a parent's innerHTML, so old slot nodes (and their _sp2Abort
    // references) become unreachable without their controller ever being
    // aborted → window mouseup listeners leaked. Track every controller in a
    // module-level set and sweep out ones whose slot is no longer in the DOM
    // on each new attach — bounded work (O(active slots)) and self-healing.
    if (slot._sp2Abort) { try { slot._sp2Abort.abort(); } catch (_) {} }
    for (const c of _crosshairControllers) {
      if (!c._slot || !document.contains(c._slot)) {
        try { c.abort(); } catch (_) {}
        _crosshairControllers.delete(c);
      }
    }
    const _ac = new AbortController();
    _ac._slot = slot;
    slot._sp2Abort = _ac;
    _crosshairControllers.add(_ac);
    const _sig = _ac.signal;

    // Binary-search-friendly nearest-point lookup per series.
    const nearest = (arr, x) => {
      if (!arr || !arr.length) return -1;
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid][0] < x) lo = mid + 1; else hi = mid;
      }
      // Compare with previous — take whichever is closer in time.
      if (lo > 0 && Math.abs(arr[lo - 1][0] - x) < Math.abs(arr[lo][0] - x)) lo--;
      return lo;
    };

    overlay.addEventListener('mousemove', (ev) => {
      // Pointer → svg-space coords. viewBox is 1:1 with pixel width, and the
      // svg fills the slot, so slot-rect and svg-rect are effectively equal.
      // Using svg's rect keeps this correct even if a future layout wraps the
      // svg in extra padding.
      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width  ? svg.viewBox.baseVal.width  / rect.width  : 1;
      const scaleY = rect.height ? svg.viewBox.baseVal.height / rect.height : 1;
      const px   = (ev.clientX - rect.left) * scaleX;
      const py   = (ev.clientY - rect.top)  * scaleY;
      // Read overlay's own bounds to map px → data x.
      const ox   = parseFloat(overlay.getAttribute('x'));
      const ow   = parseFloat(overlay.getAttribute('width'));
      if (px < ox || px > ox + ow) return;
      const t   = (px - ox) / (ow || 1);

      let cursorTs, valueRows = [];
      if (cfg.kind === 'area') {
        const pts = cfg.points;
        const xMin = pts[0][0], xMax = pts[pts.length - 1][0];
        const targetTs = xMin + t * (xMax - xMin);
        const i = nearest(pts, targetTs);
        if (i < 0) return;
        const p = pts[i];
        cursorTs = p[0];
        // Convert data → svg coords via the same transform used at build time.
        const sxData = ox + ((p[0] - xMin) / (xMax - xMin || 1)) * ow;
        line.setAttribute('x1', sxData.toFixed(1));
        line.setAttribute('x2', sxData.toFixed(1));
        line.setAttribute('opacity', '1');
        if (dots[0]) {
          // For Y we need the data-space → svg-space y. Read stroke bounds
          // from the rendered <path>? Simpler: recompute using yMin/yMax
          // captured on the slot when we built. Since we don't stash those,
          // fall back to reading position from the drawn line by picking the
          // matching pixel; instead, compute from the line's own PT/PB.
          // We need yMin/yMax — stash on the slot when building would be
          // cleanest, but for a minimal patch, read them from the path's bbox
          // and the plot area to re-derive the scale.
          const plotTop = parseFloat(overlay.getAttribute('y'));
          const plotH   = parseFloat(overlay.getAttribute('height'));
          const ys = pts.map(pp => pp[1]);
          let yMax = Math.max(...ys), yMin = Math.min(...ys);
          // Keep the crosshair dot in sync with the SVG's Y-scale, which
          // widens to include band extents when a min/max band is drawn.
          if (cfg.band) {
            const bMax = cfg.band.max || [], bMin = cfg.band.min || [];
            for (const bp of bMax) { if (bp[1] > yMax) yMax = bp[1]; }
            for (const bp of bMin) { if (bp[1] < yMin) yMin = bp[1]; }
          }
          const yR = yMax - yMin;
          if (yR <= 0) { yMin = Math.max(0, yMax * 0.95); yMax = yMax * 1.05 || 1; }
          else { const pad = yR * 0.15; yMin = Math.max(0, yMin - pad); yMax = yMax + pad; }
          const cy = plotTop + plotH - ((p[1] - yMin) / (yMax - yMin || 1)) * plotH;
          dots[0].setAttribute('cx', sxData.toFixed(1));
          dots[0].setAttribute('cy', cy.toFixed(1));
          dots[0].setAttribute('opacity', '1');
        }
        valueRows.push({ label: 'avg', color: cfg.color, value: cfg.unit(p[1]) });
        // If a min/max band is attached, surface max & min at the same
        // timestamp so hover reveals the pod-spread (worst vs best pod).
        if (cfg.band) {
          const bMax = cfg.band.max || [], bMin = cfg.band.min || [];
          if (bMax.length) {
            const jm = nearest(bMax, p[0]);
            if (jm >= 0) valueRows.push({ label: 'max', color: 'var(--sp-text-soft)', value: cfg.unit(bMax[jm][1]) });
          }
          if (bMin.length) {
            const jn = nearest(bMin, p[0]);
            if (jn >= 0) valueRows.push({ label: 'min', color: 'var(--sp-text-soft)', value: cfg.unit(bMin[jn][1]) });
          }
        }
      } else {
        // multi: pick nearest per series, but use the FIRST non-empty series
        // to define cursor timestamp for the crosshair line. Reset every dot
        // to hidden first — pods with no sample at this cursor are skipped
        // in the per-series loop and would otherwise stay visible from the
        // previous cursor position.
        dots.forEach(d => d.setAttribute('opacity', '0'));
        let refTs = null, refX = null;
        const plotTop = parseFloat(overlay.getAttribute('y'));
        const plotH   = parseFloat(overlay.getAttribute('height'));
        // Global x + y extents (same math as _buildMultiLineSvg).
        let xMin = Infinity, xMax = -Infinity, yMax = -Infinity, yMin = Infinity;
        for (const s of cfg.series) for (const [x, y] of (s.values || [])) {
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
          if (y > yMax) yMax = y; if (y < yMin) yMin = y;
        }
        const yR = yMax - yMin;
        if (yR <= 0) { yMin = Math.max(0, yMax * 0.95); yMax = yMax * 1.05 || 1; }
        else { const pad = yR * 0.15; yMin = Math.max(0, yMin - pad); yMax = yMax + pad; }
        const targetTs = xMin + t * (xMax - xMin);
        const rows = [];
        cfg.series.forEach((s, si) => {
          const arr = s.values || [];
          const i = nearest(arr, targetTs);
          if (i < 0) return;
          const p = arr[i];
          const cx = ox + ((p[0] - xMin) / (xMax - xMin || 1)) * ow;
          const cy = plotTop + plotH - ((p[1] - yMin) / (yMax - yMin || 1)) * plotH;
          const dot = dots[si];
          if (dot) {
            dot.setAttribute('cx', cx.toFixed(1));
            dot.setAttribute('cy', cy.toFixed(1));
            dot.setAttribute('opacity', '1');
          }
          if (refTs == null) { refTs = p[0]; refX = cx; }
          rows.push({
            label: s.pod || '',
            color: POD_PALETTE[si % POD_PALETTE.length],
            value: cfg.unit(p[1]),
            rawY:  p[1],
          });
        });
        // Sort by value desc — highest first so eye lands on hot pods.
        rows.sort((a, b) => b.rawY - a.rawY);
        cursorTs  = refTs;
        valueRows = rows;
        if (refX != null) {
          line.setAttribute('x1', refX.toFixed(1));
          line.setAttribute('x2', refX.toFixed(1));
          line.setAttribute('opacity', '1');
        }
      }

      // Compute chart span for time-format hint (always show full date+time
      // in tooltip regardless of span).
      const timeStr = _fmtChartTime(cursorTs, 999999, true);
      const MAX_ROWS = 12;
      const shownRows = valueRows.slice(0, MAX_ROWS).map(r => `
        <div class="t-row">
          ${r.label ? `<span class="t-dot" style="background:${r.color}"></span><span class="t-lbl" title="${(r.label || '').replace(/"/g,'&quot;')}">${(r.label || '').replace(/</g,'&lt;')}</span>` : `<span class="t-dot" style="background:${r.color}"></span>`}
          <span class="t-val">${r.value}</span>
        </div>`).join('');
      const moreHtml = valueRows.length > MAX_ROWS
        ? `<div class="t-more">+ ${valueRows.length - MAX_ROWS} more pods</div>` : '';
      tip.innerHTML = `<div class="t-time">${timeStr}</div>${shownRows}${moreHtml}`;

      // Position tip: prefer above the cursor; flip below when near top edge;
      // clamp horizontally to the slot so it doesn't overflow the card. Tip
      // is CSS-transformed by (-50%, -110%) so we anchor at (pointer-x, pointer-y).
      const slotRect = slot.getBoundingClientRect();
      const pointerXinSlot = ev.clientX - slotRect.left;
      const pointerYinSlot = ev.clientY - slotRect.top;
      const tipW = tip.offsetWidth || 160;
      const tipH = tip.offsetHeight || 40;
      let tipX = pointerXinSlot;
      let tipY = pointerYinSlot - 6;
      // Clamp horizontally within [tipW/2, slot.width - tipW/2]
      tipX = Math.max(tipW / 2 + 4, Math.min(slotRect.width - tipW / 2 - 4, tipX));
      // If placing above would clip, flip below the cursor.
      if (pointerYinSlot - tipH - 12 < 0) tipY = pointerYinSlot + tipH + 18;
      tip.style.left = tipX + 'px';
      tip.style.top  = tipY + 'px';
      slot.classList.add('sp2-cx-on');
    }, { signal: _sig });

    overlay.addEventListener('mouseleave', () => {
      slot.classList.remove('sp2-cx-on');
      if (line) line.setAttribute('opacity', '0');
      dots.forEach(d => d.setAttribute('opacity', '0'));
      // Notify sibling charts that hover ended so their linked crosshairs
      // fade out too — otherwise a stale mirror lingers on other panels.
      window.dispatchEvent(new CustomEvent('sp2-crosshair-off', { detail: { source: slot } }));
    }, { signal: _sig });

    // ── Brush-zoom (drag to select) ─────────────────────────────────────
    // Mousedown on the overlay starts a selection; mousemove grows the
    // rect; mouseup applies the ts window via SP.setCustomRange (which
    // rewires every chart on the page to the new range). Small drags
    // (< 5px) are treated as clicks — they fall through to the expand
    // button click handler.
    let drag = null;
    const clearBrush = () => {
      const b = svg.querySelector('.sp2-brush'); if (b) b.remove();
      drag = null;
    };
    const overlayXToTs = (px) => {
      const ox = parseFloat(overlay.getAttribute('x'));
      const ow = parseFloat(overlay.getAttribute('width'));
      const clamped = Math.max(ox, Math.min(ox + ow, px));
      const t = (clamped - ox) / (ow || 1);
      let xMin, xMax;
      if (cfg.kind === 'area') {
        const pts = cfg.points;
        xMin = pts[0][0]; xMax = pts[pts.length - 1][0];
      } else {
        xMin = Infinity; xMax = -Infinity;
        for (const s of cfg.series) for (const [x] of (s.values || [])) {
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        }
      }
      return { ts: Math.round(xMin + t * (xMax - xMin)), px: clamped, xMin, xMax };
    };
    const svgX = (ev) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width ? svg.viewBox.baseVal.width / rect.width : 1;
      return (ev.clientX - rect.left) * scaleX;
    };

    // Right-click at any spike → deep-link into Log Explorer, filtered by
    // this service + a ±5 minute window around the clicked timestamp.
    // Only wires when SP.LogViewer is available (SM team only) so non-SM
    // users get the browser's native context menu as usual.
    overlay.addEventListener('contextmenu', (ev) => {
      if (!SP.LogViewer || !SP.currentService) return;
      const px = svgX(ev);
      const at = overlayXToTs(px);
      if (!at || !isFinite(at.ts)) return;
      ev.preventDefault();
      // ±5 min window centered on the clicked ts — narrow enough that the
      // log list is manageable, wide enough to catch the request that
      // caused the spike + a bit of context before/after.
      const startMs = (at.ts - 300) * 1000;
      const endMs   = (at.ts + 300) * 1000;
      SP.LogViewer.open(SP.currentService, SP._lastDetail?.namespace || '', {
        start: new Date(startMs).toISOString(),
        end:   new Date(endMs).toISOString(),
        label: 'spike @ ' + _fmtChartTime(at.ts, 999999, true),
      });
    }, { signal: _sig });

    overlay.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;   // left-click only
      const px = svgX(ev);
      const start = overlayXToTs(px);
      drag = { startPx: start.px, startTs: start.ts };
      // Create the brush rect inside the svg (above overlay so hover still
      // works). Height matches the overlay's plot area.
      const plotY = parseFloat(overlay.getAttribute('y'));
      const plotH = parseFloat(overlay.getAttribute('height'));
      const brush = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      brush.setAttribute('class', 'sp2-brush');
      brush.setAttribute('x', start.px.toFixed(1));
      brush.setAttribute('y', plotY);
      brush.setAttribute('width', '0');
      brush.setAttribute('height', plotH);
      // Insert before the overlay so pointer events still hit the overlay.
      svg.insertBefore(brush, overlay);
      drag.rect = brush;
      ev.preventDefault();
    }, { signal: _sig });

    overlay.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const px = svgX(ev);
      const cur = overlayXToTs(px);
      const x1 = Math.min(drag.startPx, cur.px);
      const x2 = Math.max(drag.startPx, cur.px);
      drag.rect.setAttribute('x', x1.toFixed(1));
      drag.rect.setAttribute('width', (x2 - x1).toFixed(1));
      drag.endTs = cur.ts;
    }, { signal: _sig });

    // Window-level mouseup so a drag that ends outside the overlay still
    // commits (users often overshoot). Also handles mouseleave-mid-drag.
    const onWinUp = (ev) => {
      if (!drag) return;
      const px = svgX(ev);
      const cur = overlayXToTs(px);
      const pxDist = Math.abs(cur.px - drag.startPx);
      const startTs = Math.min(drag.startTs, cur.ts);
      const endTs   = Math.max(drag.startTs, cur.ts);
      clearBrush();
      // Guard: too-short drag = it was a click (let expand button fire).
      if (pxDist < 6) return;
      let s = startTs, e = endTs;
      // Backend requires min 5-minute span (detail.php validation). Instead
      // of failing, auto-expand around the midpoint — preserves the user's
      // intent (they wanted to look at THAT moment) while satisfying the
      // API. Toast is informational, not an error.
      const MIN_SPAN = 300;
      if (e - s < MIN_SPAN) {
        const mid = Math.round((s + e) / 2);
        s = mid - Math.floor(MIN_SPAN / 2);
        e = mid + Math.ceil (MIN_SPAN / 2);
        if (window.SP?._flashToast) SP._flashToast('ขยายช่วงเป็น 5 นาที (backend min)');
      }
      if (window.SP?.setCustomRange) {
        window.SP.setCustomRange(s, e);
      }
    };
    window.addEventListener('mouseup', onWinUp, { signal: _sig });

    // Broadcast the current cursor timestamp so every OTHER chart on the
    // page can mirror the same time position (shared-crosshair pattern).
    // Reads it off the primary mousemove handler by tapping the same event
    // with a second listener — keeps the primary logic untouched.
    overlay.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width ? svg.viewBox.baseVal.width / rect.width : 1;
      const px = (ev.clientX - rect.left) * scaleX;
      const ox = parseFloat(overlay.getAttribute('x'));
      const ow = parseFloat(overlay.getAttribute('width'));
      if (px < ox || px > ox + ow) return;
      const t = (px - ox) / (ow || 1);
      let xMin, xMax;
      if (cfg.kind === 'area') {
        const pts = cfg.points;
        xMin = pts[0][0]; xMax = pts[pts.length - 1][0];
      } else {
        xMin = Infinity; xMax = -Infinity;
        for (const s of cfg.series) for (const [x] of (s.values || [])) {
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        }
      }
      const targetTs = xMin + t * (xMax - xMin);
      window.dispatchEvent(new CustomEvent('sp2-crosshair', { detail: { ts: targetTs, source: slot } }));
    }, { signal: _sig });
  }

  // ── Shared crosshair — the incident-response feature ──────────────────
  // Registered ONCE globally. When any chart broadcasts a hover timestamp,
  // every OTHER chart on the page paints its own crosshair at that same
  // moment. Used to visually align e.g. an Avg latency spike with the same
  // timestamp's GC pause, Tomcat busy-thread saturation, and outbound-call
  // latency — no need to eyeball 5 charts sequentially.
  //   Source chart gets full-opacity crosshair (its own handler); linked
  //   charts render dimmer (opacity ~.55) so it's obvious which chart the
  //   user is driving vs mirroring.
  let _sharedCrosshairWired = false;
  function _setupSharedCrosshair() {
    if (_sharedCrosshairWired) return;
    _sharedCrosshairWired = true;
    window.addEventListener('sp2-crosshair', (ev) => {
      const { ts, source } = ev.detail || {};
      if (ts == null) return;
      document.querySelectorAll('.sp2-chart-slot').forEach(slot => {
        if (slot === source) return;
        _paintLinkedCrosshair(slot, ts);
      });
    });
    window.addEventListener('sp2-crosshair-off', (ev) => {
      const { source } = ev.detail || {};
      document.querySelectorAll('.sp2-chart-slot').forEach(slot => {
        if (slot === source) return;
        slot.classList.remove('sp2-cx-on');
        const line = slot.querySelector('.sp2-cx-line');
        const dots = slot.querySelectorAll('.sp2-cx-dot');
        if (line) line.setAttribute('opacity', '0');
        dots.forEach(d => d.setAttribute('opacity', '0'));
      });
    });
  }

  // Paint a linked (mirror) crosshair on ONE slot at the given timestamp.
  // Reads dataset (data-points / data-series / data-band) so we don't need
  // to keep cfg alive per slot — works even for slots painted before the
  // subscriber was wired.
  function _paintLinkedCrosshair(slot, targetTs) {
    const svg     = slot.querySelector('svg');
    const overlay = slot.querySelector('.sp2-cx-overlay');
    if (!svg || !overlay) return;
    const line    = slot.querySelector('.sp2-cx-line');
    const dots    = slot.querySelectorAll('.sp2-cx-dot');
    const tip     = slot.querySelector('.sp2-cx-tip');
    const ox = parseFloat(overlay.getAttribute('x'));
    const ow = parseFloat(overlay.getAttribute('width'));
    const plotTop = parseFloat(overlay.getAttribute('y'));
    const plotH   = parseFloat(overlay.getAttribute('height'));
    const unitFns = {
      cores: (v) => v.toFixed(v >= 1 ? 2 : 3),
      bytes: (v) => fmtBytes(v),
      reqs:  (v) => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2),
      ms:    (v) => v >= 1000 ? (v/1000).toFixed(2) + 's' : v.toFixed(0) + 'ms',
    };
    const unit = unitFns[slot.dataset.unit] || unitFns.cores;
    const nearest = (arr, ts) => {
      if (!arr || !arr.length) return -1;
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][0] < ts) lo = m + 1; else hi = m; }
      if (lo > 0 && Math.abs(arr[lo-1][0] - ts) < Math.abs(arr[lo][0] - ts)) lo--;
      return lo;
    };
    const kind = slot.dataset.chart || 'area';

    if (kind === 'multi') {
      const series = JSON.parse(slot.dataset.series || '[]');
      let xMin = Infinity, xMax = -Infinity, yMax = -Infinity, yMin = Infinity;
      for (const s of series) for (const [x, y] of (s.values || [])) {
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y > yMax) yMax = y; if (y < yMin) yMin = y;
      }
      if (!isFinite(xMin) || targetTs < xMin || targetTs > xMax) {
        // Timestamp outside this chart's window → hide mirror crosshair.
        slot.classList.remove('sp2-cx-on');
        if (line) line.setAttribute('opacity', '0');
        dots.forEach(d => d.setAttribute('opacity', '0'));
        return;
      }
      const yR = yMax - yMin;
      if (yR <= 0) { yMin = Math.max(0, yMax * 0.95); yMax = yMax * 1.05 || 1; }
      else { const pad = yR * 0.15; yMin = Math.max(0, yMin - pad); yMax = yMax + pad; }
      const cx = ox + ((targetTs - xMin) / (xMax - xMin || 1)) * ow;
      const rows = [];
      dots.forEach(d => d.setAttribute('opacity', '0'));
      series.forEach((s, si) => {
        const arr = s.values || [];
        const i = nearest(arr, targetTs);
        if (i < 0) return;
        const p = arr[i];
        const cy = plotTop + plotH - ((p[1] - yMin) / (yMax - yMin || 1)) * plotH;
        const dot = dots[si];
        if (dot) { dot.setAttribute('cx', cx.toFixed(1)); dot.setAttribute('cy', cy.toFixed(1)); dot.setAttribute('opacity', '0.55'); }
        rows.push({ label: s.pod || '', color: POD_PALETTE[si % POD_PALETTE.length], value: unit(p[1]), rawY: p[1] });
      });
      rows.sort((a, b) => b.rawY - a.rawY);
      if (line) { line.setAttribute('x1', cx.toFixed(1)); line.setAttribute('x2', cx.toFixed(1)); line.setAttribute('opacity', '0.4'); }
      if (tip) {
        tip.innerHTML = `<div class="t-time">${_fmtChartTime(targetTs, 999999, true)}</div>` +
          rows.slice(0, 8).map(r => `<div class="t-row"><span class="t-dot" style="background:${r.color}"></span><span class="t-lbl">${(r.label || '').replace(/</g, '&lt;')}</span><span class="t-val">${r.value}</span></div>`).join('') +
          (rows.length > 8 ? `<div class="t-more">+ ${rows.length - 8} more</div>` : '');
        const slotRect = slot.getBoundingClientRect();
        const tipW = tip.offsetWidth || 160;
        tip.style.left = Math.max(tipW/2 + 4, Math.min(slotRect.width - tipW/2 - 4, cx)) + 'px';
        tip.style.top = '14px';
      }
      slot.classList.add('sp2-cx-on');
    } else {
      const points = JSON.parse(slot.dataset.points || '[]');
      if (points.length < 2) return;
      const xMin = points[0][0], xMax = points[points.length - 1][0];
      if (targetTs < xMin || targetTs > xMax) {
        slot.classList.remove('sp2-cx-on');
        if (line) line.setAttribute('opacity', '0');
        dots.forEach(d => d.setAttribute('opacity', '0'));
        return;
      }
      const i = nearest(points, targetTs);
      if (i < 0) return;
      const p = points[i];
      const cx = ox + ((p[0] - xMin) / (xMax - xMin || 1)) * ow;
      const ys = points.map(pp => pp[1]);
      let yMax = Math.max(...ys), yMin = Math.min(...ys);
      const band = slot.dataset.band ? JSON.parse(slot.dataset.band) : null;
      if (band) {
        for (const bp of band.max || []) if (bp[1] > yMax) yMax = bp[1];
        for (const bp of band.min || []) if (bp[1] < yMin) yMin = bp[1];
      }
      const yR = yMax - yMin;
      if (yR <= 0) { yMin = Math.max(0, yMax * 0.95); yMax = yMax * 1.05 || 1; }
      else { const pad = yR * 0.15; yMin = Math.max(0, yMin - pad); yMax = yMax + pad; }
      const cy = plotTop + plotH - ((p[1] - yMin) / (yMax - yMin || 1)) * plotH;
      if (line) { line.setAttribute('x1', cx.toFixed(1)); line.setAttribute('x2', cx.toFixed(1)); line.setAttribute('opacity', '0.4'); }
      if (dots[0]) { dots[0].setAttribute('cx', cx.toFixed(1)); dots[0].setAttribute('cy', cy.toFixed(1)); dots[0].setAttribute('opacity', '0.55'); }
      if (tip) {
        const color = slot.dataset.color || 'var(--cool)';
        let html = `<div class="t-time">${_fmtChartTime(targetTs, 999999, true)}</div>`;
        html += `<div class="t-row"><span class="t-dot" style="background:${color}"></span><span class="t-lbl">avg</span><span class="t-val">${unit(p[1])}</span></div>`;
        if (band?.max?.length) { const j = nearest(band.max, targetTs); if (j >= 0) html += `<div class="t-row"><span class="t-dot" style="background:var(--sp-text-soft)"></span><span class="t-lbl">max</span><span class="t-val">${unit(band.max[j][1])}</span></div>`; }
        if (band?.min?.length) { const j = nearest(band.min, targetTs); if (j >= 0) html += `<div class="t-row"><span class="t-dot" style="background:var(--sp-text-soft)"></span><span class="t-lbl">min</span><span class="t-val">${unit(band.min[j][1])}</span></div>`; }
        tip.innerHTML = html;
        const slotRect = slot.getBoundingClientRect();
        const tipW = tip.offsetWidth || 160;
        tip.style.left = Math.max(tipW/2 + 4, Math.min(slotRect.width - tipW/2 - 4, cx)) + 'px';
        tip.style.top = '14px';
      }
      slot.classList.add('sp2-cx-on');
    }
  }
  // Wire the global listeners once at parse time — safe because module is
  // top-level and only executes after DOMContentLoaded.
  _setupSharedCrosshair();

  // ── Auto Max/Min badges in chart headers ──────────────────────────────
  // For every chart slot that carries a band (data-band attribute), inject
  // a compact "max X · min Y" sub-line under the closest chart-head .now
  // value. Runs after every paintCharts so it stays in sync with range /
  // service switches. Idempotent — the sub-line is data-attr tagged so
  // reruns replace instead of appending.
  function _paintHeaderMinMax() {
    document.querySelectorAll('.sp2-chart-slot[data-band]').forEach(slot => {
      let band;
      try { band = JSON.parse(slot.dataset.band); } catch (_) { return; }
      const bMax = band?.max || [], bMin = band?.min || [];
      // Reduce entire series to true peak (worst request / hottest pod
      // over the window) + true trough (calmest observation). This isn't
      // the same as "instant max/min at latest sample" — it's the extreme
      // over the whole displayed range, which is what ops actually want
      // to see next to the current "now" value.
      let peakMax = null, peakMin = null;
      for (const p of bMax) { const v = +p[1]; if (isFinite(v) && (peakMax === null || v > peakMax)) peakMax = v; }
      for (const p of bMin) { const v = +p[1]; if (isFinite(v) && (peakMin === null || v < peakMin)) peakMin = v; }
      if (peakMax === null && peakMin === null) return;

      // Pick the header .now that lives in the same chart card as this slot.
      // Traverses upward through both known card types (.sp2-cc-chart-card
      // for CC + app metrics, .sp2-sub-chart-card for subsystem charts).
      const card = slot.closest('.sp2-cc-chart-card, .sp2-sub-chart-card, .sp2-perpod-card');
      if (!card) return;
      const now = card.querySelector('.sp2-cc-chart-head .now') || card.querySelector('.sp2-sub-chart-title .now');
      const header = card.querySelector('.sp2-cc-chart-head, .sp2-sub-chart-title');
      if (!header && !now) return;

      // Format each value with the chart's own unit tag so mixed units
      // (bytes / cores / ms / req/s) render legibly.
      const unitFns = {
        cores: (v) => v >= 1 ? v.toFixed(2) + ' cores' : (v * 1000).toFixed(0) + 'm',
        bytes: (v) => fmtBytes(v),
        reqs:  (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' /s',
        ms:    (v) => v >= 1000 ? (v/1000).toFixed(2) + 's' : v.toFixed(0) + 'ms',
      };
      const unit = unitFns[slot.dataset.unit] || unitFns.cores;

      // Colour cue: red for latency max ≥3s, yellow ≥1s, otherwise soft.
      const isLatency = slot.dataset.unit === 'ms';
      const maxColor = isLatency && peakMax != null
        ? (peakMax >= 3000 ? 'var(--hot)' : peakMax >= 1000 ? 'var(--warn)' : 'var(--sp-text-soft)')
        : 'var(--sp-text-soft)';

      const parts = [];
      if (peakMax != null) parts.push(`<span style="color:${maxColor};font-weight:${maxColor === 'var(--hot)' ? 600 : 500}">max ${unit(peakMax)}</span>`);
      if (peakMin != null) parts.push(`<span style="color:var(--sp-text-soft)">min ${unit(peakMin)}</span>`);
      const badge = `<div class="sp2-mm-badge" data-mm-injected="1" style="font-size:10.5px;color:var(--sp-text-soft);margin-top:2px;font-variant-numeric:tabular-nums;font-weight:500">${parts.join(' · ')}</div>`;

      // Attach below .now if present, else at end of header. Replace any
      // previous injection so range changes update in place.
      const existing = card.querySelector('.sp2-mm-badge[data-mm-injected="1"]');
      if (existing) existing.remove();
      if (now) now.insertAdjacentHTML('afterend', badge);
      else if (header) header.insertAdjacentHTML('beforeend', badge);
    });
  }
  // Hook paintCharts — run after every paint so badges follow data updates.
  const _origPaintCharts_forMM = paintCharts;
  paintCharts = function() {
    _origPaintCharts_forMM.apply(this, arguments);
    _paintHeaderMinMax();
    _paintAnnotations();
  };

  // ── Timeline annotations (Sprint 3 + Sprint 4 upgrade) ────────────────
  // Overlay vertical dashed lines on every chart for pod restart / deploy
  // events. Reads from two sources:
  //   • SP._lastDetail.events  — pod creation + restart deltas (detail.php)
  //   • SP._deployEvents       — smart deploy detection (deploys.php)
  // Smart deploys OVERRIDE the naive "D" markers with 🚀 + version label
  // when they overlap (± 5 min). This turns generic pod-creates into
  // proper "deploy at 15:02 · v1.5.3" annotations you can trust.
  function _paintAnnotations() {
    const raw = (window.SP?._lastDetail?.events) || [];
    const smartDeploys = window.SP?._deployEvents || [];
    // Build merged event list. Smart deploy wins over naive "deploy"
    // (kube_pod_created) within ± 5 min — we don't want two markers for
    // the same rollout. Restarts always pass through since they represent
    // individual crashes that a deploy summary shouldn't hide.
    const events = [];
    for (const ev of raw) {
      if (ev.type === 'deploy') {
        // Suppress naive deploy if a smart-deploy covers it
        const covered = smartDeploys.some(d => Math.abs(d.ts - ev.ts) <= 300);
        if (covered) continue;
      }
      events.push(ev);
    }
    for (const d of smartDeploys) {
      events.push({
        ts:   d.ts,
        type: 'smart-deploy',
        pod:  d.version ? 'version ' + d.version : (d.podsRecreated + '/' + d.totalPods + ' pods'),
        note: d.note,
        confidence: d.confidence,
      });
    }
    document.querySelectorAll('.sp2-chart-slot').forEach(slot => {
      // Wipe previous annotations before repainting.
      slot.querySelectorAll('[data-annot="1"]').forEach(n => n.remove());
      if (!events.length) return;
      const svg = slot.querySelector('svg');
      const overlay = slot.querySelector('.sp2-cx-overlay');
      if (!svg || !overlay) return;
      const ox = parseFloat(overlay.getAttribute('x'));
      const ow = parseFloat(overlay.getAttribute('width'));
      const plotTop = parseFloat(overlay.getAttribute('y'));
      const plotH   = parseFloat(overlay.getAttribute('height'));
      // Figure out the chart's x-domain (same math as _paintLinkedCrosshair).
      const kind = slot.dataset.chart || 'area';
      let xMin, xMax;
      try {
        if (kind === 'multi') {
          const series = JSON.parse(slot.dataset.series || '[]');
          xMin = Infinity; xMax = -Infinity;
          for (const s of series) for (const [x] of (s.values || [])) {
            if (x < xMin) xMin = x; if (x > xMax) xMax = x;
          }
        } else {
          const pts = JSON.parse(slot.dataset.points || '[]');
          if (pts.length < 2) return;
          xMin = pts[0][0]; xMax = pts[pts.length - 1][0];
        }
      } catch (_) { return; }
      if (!isFinite(xMin) || !isFinite(xMax) || xMax === xMin) return;

      // Palette per event type:
      //   restart     = orange R    (crash / OOM — individual)
      //   deploy      = cool D      (naive pod-created — no smart detection)
      //   smart-deploy= brand-orange 🚀 (confirmed rollout via cluster/version)
      // Circle marker sits at the top of the plot so it doesn't compete
      // with data lines below.
      const styleFor = (type) => {
        if (type === 'restart')      return { line: '#f59e0b', dot: '#f59e0b', label: 'R' };
        if (type === 'smart-deploy') return { line: '#f26419', dot: '#f26419', label: 'D' };
        return                              { line: 'var(--cool)', dot: 'var(--cool)', label: 'D' };
      };

      // Group events by rounded x-pixel so overlapping restarts on the
      // same tick don't draw N lines on top of each other.
      const byX = new Map();
      for (const ev of events) {
        if (ev.ts < xMin || ev.ts > xMax) continue;
        const x = ox + ((ev.ts - xMin) / (xMax - xMin)) * ow;
        const key = Math.round(x);
        if (!byX.has(key)) byX.set(key, []);
        byX.get(key).push(ev);
      }

      const ns = 'http://www.w3.org/2000/svg';
      for (const [x, group] of byX.entries()) {
        // Type priority: smart-deploy > restart > deploy (most authoritative wins).
        const primary = group.find(e => e.type === 'smart-deploy')
                     || group.find(e => e.type === 'restart')
                     || group[0];
        const st = styleFor(primary.type);
        // Vertical dashed line spanning the plot.
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x); line.setAttribute('x2', x);
        line.setAttribute('y1', plotTop);
        line.setAttribute('y2', plotTop + plotH);
        line.setAttribute('stroke', st.line);
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '3 4');
        line.setAttribute('opacity', '.55');
        line.setAttribute('data-annot', '1');
        line.setAttribute('pointer-events', 'none');
        svg.appendChild(line);
        // Circle marker with letter (R/D) at top — hoverable for tooltip.
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('data-annot', '1');
        g.setAttribute('transform', `translate(${x}, ${plotTop - 2})`);
        g.style.cursor = 'help';
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('r', '6'); c.setAttribute('fill', st.dot);
        c.setAttribute('stroke', 'var(--bg-card)'); c.setAttribute('stroke-width', '1.5');
        g.appendChild(c);
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('y', '0.5');
        t.setAttribute('font-size', '8');
        t.setAttribute('font-weight', '700');
        t.setAttribute('fill', 'var(--bg-card)');
        t.textContent = st.label;
        g.appendChild(t);
        // Native <title> tooltip — lists each event in the group with
        // pod name + time. Screen-reader friendly + zero extra JS.
        const tt = document.createElementNS(ns, 'title');
        tt.textContent = group.map(e =>
          `${e.type === 'restart' ? 'Restart' : 'Deploy'} · ${e.pod}\n${new Date(e.ts * 1000).toLocaleString()}`
        ).join('\n\n');
        g.appendChild(tt);
        svg.appendChild(g);
      }
    });
  }

  // Build a multi-series line chart (N pods, N distinct colors, no fill).
  // Auto-scales Y across all series, shares the X range, and marks each
  // path with a <title> so hovering reveals the pod name in-place.
  function _buildMultiLineSvg(series, W, H, unitFmt) {
    if (!series.length) return '<div class="sp2-chart-empty">ไม่มีข้อมูล time-series</div>';

    // Global x/y extents across every pod's timeline. Track BOTH yMin and yMax
    // so we can auto-fit the Y-axis to the actual data range — for metrics like
    // container_memory_working_set_bytes that stay clustered near a big value
    // (e.g. 14 pods all in 2.75-2.85 GB), a 0-based Y-axis crushes all the
    // lines into a single band at the top and hides per-pod variation.
    let xMin = Infinity, xMax = -Infinity, yMax = -Infinity, yMin = Infinity;
    for (const s of series) {
      for (const [x, y] of (s.values || [])) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y > yMax) yMax = y;
        if (y < yMin) yMin = y;
      }
    }
    if (!isFinite(xMin) || xMax === xMin) return '<div class="sp2-chart-empty">ไม่มีข้อมูล time-series</div>';
    const spanSec = xMax - xMin;
    const PL = 60, PR = 14, PT = 14, PB = (spanSec >= 86400 && spanSec < 7 * 86400) ? 34 : 26;
    // Zoom-fit Y-axis: pad the actual range by 15% on each side. If range is
    // zero (all values identical) fall back to yMax ± 5% so we don't divide
    // by zero. Never go negative for CPU/MEM.
    const yRange = yMax - yMin;
    if (yRange <= 0) {
      yMin = Math.max(0, yMax * 0.95);
      yMax = yMax * 1.05 || 1;
    } else {
      const pad = yRange * 0.15;
      yMin = Math.max(0, yMin - pad);
      yMax = yMax + pad;
    }
    const sx = (x) => PL + ((x - xMin) / (xMax - xMin || 1)) * (W - PL - PR);
    const sy = (y) => H - PB - ((y - yMin) / (yMax - yMin || 1)) * (H - PT - PB);

    // Y-axis grid — 4 lines like the area chart.
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const yVal = yMin + (yMax - yMin) * (i / 4);
      const yy   = sy(yVal).toFixed(1);
      gridLines += `<line x1="${PL}" x2="${W - PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
      gridLines += `<text x="${PL - 6}" y="${yy}" font-size="10" fill="var(--sp-text-soft)" text-anchor="end" dominant-baseline="middle">${unitFmt(yVal)}</text>`;
    }

    const { xLabels, xGrid } = _buildXAxis(W, H, PL, PR, PB, xMin, xMax, sx);

    // One <path> per series. Highlight on hover (CSS) so overlapping lines are
    // distinguishable; <title> gives the pod name as a native tooltip. The
    // data-pod-idx lets the crosshair handler map SVG index → series.
    const paths = series.map((s, i) => {
      const pts = s.values || [];
      if (pts.length < 2) return '';
      const color = POD_PALETTE[i % POD_PALETTE.length];
      const d = pts.map((p, j) => (j ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
      return `<path class="sp2-pod-line" data-pod-idx="${i}" d="${d}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" opacity=".85"><title>${(s.pod || '').replace(/</g,'&lt;')}</title></path>`;
    }).join('');

    // Crosshair scaffolding — one focus dot per series, hidden by default.
    const cxLine = `<line class="sp2-cx-line" x1="0" x2="0" y1="${PT}" y2="${H - PB}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
    const cxDots = series.map((s, i) => {
      const color = POD_PALETTE[i % POD_PALETTE.length];
      return `<circle class="sp2-cx-dot" data-pod-idx="${i}" cx="0" cy="0" r="3.5" fill="${color}" stroke="var(--bg-card)" stroke-width="1.5" opacity="0"/>`;
    }).join('');
    const overlay = `<rect class="sp2-cx-overlay" x="${PL}" y="${PT}" width="${Math.max(0, W - PL - PR)}" height="${Math.max(0, H - PT - PB)}"/>`;

    // See _buildAreaSvg for why `height` attribute is omitted (RO feedback loop).
    return `<svg width="${W}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
      ${gridLines}
      ${xGrid}
      ${paths}
      ${xLabels}
      ${cxLine}
      ${cxDots}
      ${overlay}
    </svg><div class="sp2-cx-tip"></div>`;
  }

  // Debounced re-paint on window/pane resize so charts stay 1:1 with container.
  let _resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(paintCharts, 120);
  });

  // Also observe individual chart slots so charts re-render when their
  // container height changes — needed because the CC grid stretches cards
  // to match the tallest column, and the final laid-out slot height isn't
  // known until CSS resolves. Without this, the first paintCharts() runs
  // with clientHeight=0 → uses fallback → SVG stays small even after the
  // slot grows. ResizeObserver catches that first real size, then noops.
  const _slotObserver = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(paintCharts, 60);
  }) : null;
  function observeChartSlots() {
    if (!_slotObserver) return;
    document.querySelectorAll('.sp2-chart-slot').forEach(el => _slotObserver.observe(el));
  }

  function podGauge(running, target) {
    // Donut showing running vs desired. If we don't know target, show running as a full ring.
    const R = 68, C = 90, STROKE = 14;
    const circ = 2 * Math.PI * R;
    const ratio = target > 0 ? Math.min(1, running / target) : (running > 0 ? 1 : 0);
    const dash = (circ * ratio).toFixed(1);
    const color = running === 0 ? 'var(--hot)' : ratio >= 1 ? 'var(--ok)' : 'var(--warn)';
    const cap = target > 0
      ? (target === running ? 'all pods ready' : `${running}/${target} ready`)
      : (running > 0 ? 'currently running' : 'no pods');
    const zeroCls = running === 0 ? ' zero' : '';
    return `
      <div class="sp2-gauge${zeroCls}">
        <svg viewBox="0 0 180 180">
          <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${STROKE}"/>
          <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}"
                  stroke-linecap="round" stroke-dasharray="0 ${circ}"
                  style="transition:stroke-dasharray .8s cubic-bezier(.4,0,.2,1)"
                  data-dash-target="${dash} ${circ}"/>
        </svg>
        <div class="sp2-gauge-inner">
          <div class="sp2-gauge-val">${running}</div>
          <div class="sp2-gauge-lbl">Pods</div>
          <div class="sp2-gauge-cap">${cap}</div>
        </div>
      </div>`;
  }
  // Animate the gauge stroke after inject (queueMicrotask lets DOM commit first).
  function animateGauges() {
    document.querySelectorAll('.sp2-gauge circle[data-dash-target], .sp2-cc-gauge circle[data-dash-target]').forEach(el => {
      requestAnimationFrame(() => { el.setAttribute('stroke-dasharray', el.dataset.dashTarget); });
    });
  }

  // ── App state ──────────────────────────────────────────────────
  // Time-range presets shared by the CPU + MEM sparkline in the detail view.
  // Values are minutes; backend caps at 30d (43200 min). Keep the ordering
  // shortest→longest so the pill row reads left-to-right like Grafana.
  const SP_RANGES = [
    { min: 15,    label: '15m' },
    { min: 30,    label: '30m' },
    { min: 60,    label: '1h'  },
    { min: 180,   label: '3h'  },
    { min: 360,   label: '6h'  },
    { min: 720,   label: '12h' },
    { min: 1440,  label: '24h' },
    { min: 4320,  label: '3d'  },
    { min: 10080, label: '7d'  },
    { min: 43200, label: '30d' },
  ];
  function fmtWindow(m) {
    if (m < 60)   return `${m}m`;
    if (m < 1440) return `${m / 60}h`;
    return `${m / 1440}d`;
  }
  // When a downstream row lacks a resolved service name (e.g. call goes to a
  // bare IP or an external SaaS), fall back to the first hostname label so the
  // node card still has something meaningful to render.
  function _depsFallbackName(host) {
    if (!host) return '(unknown)';
    const cleaned = String(host).replace(/^[a-z]+:\/\//i, '').split(/[\/?:]/)[0];
    return cleaned.split('.')[0] || cleaned;
  }

  // Draw the curved connectors from each side node to the center card. Runs
  // AFTER the DOM lays out — reads getBoundingClientRect on every dep-node +
  // the center card, computes svg-local coords, and paints a smooth cubic
  // path. Also drops a small protocol label above each curve.
  function _paintDepsGraph() {
    const body = document.getElementById('sp2-deps-body');
    const svg  = document.getElementById('sp2-deps-svg');
    if (!body || !svg) return;
    const bodyRect = body.getBoundingClientRect();
    const w = Math.max(0, bodyRect.width);
    const h = Math.max(0, bodyRect.height);
    if (w === 0 || h === 0) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width',  w);
    svg.setAttribute('height', h);

    const center = body.querySelector('.sp2-deps-col.center .sp2-deps-center-card');
    if (!center) { svg.innerHTML = ''; return; }
    const cRect  = center.getBoundingClientRect();

    // Convert a viewport-space rect to body-local coords.
    const local = (r) => ({
      left:   r.left   - bodyRect.left,
      right:  r.right  - bodyRect.left,
      top:    r.top    - bodyRect.top,
      bottom: r.bottom - bodyRect.top,
      cx:     (r.left + r.right)  / 2 - bodyRect.left,
      cy:     (r.top  + r.bottom) / 2 - bodyRect.top,
    });
    const c = local(cRect);

    // Protocol → stroke color. Kept in sync with the CSS pill palette.
    const PROTO_COLOR = {
      redis:'#dc2626', mongo:'#10b981', rabbitmq:'#f97316', kafka:'#374151',
      mysql:'#6366f1', postgres:'#6366f1', oracle:'#6366f1', sql:'#6366f1',
      search:'#a16207', http:'var(--cool)',
    };

    let out = '';
    body.querySelectorAll('.sp2-deps-node').forEach(node => {
      const side  = node.dataset.depSide;
      const proto = node.dataset.depProto || 'http';
      const r = local(node.getBoundingClientRect());
      // Anchor points: exit the inside edge of the node → enter the outside
      // edge of the center card. For a left node, exit its right edge and
      // enter the center's left edge (mirror for right side).
      let x1, y1, x2, y2;
      if (side === 'left') {
        x1 = r.right; y1 = r.cy;
        x2 = c.left;  y2 = c.cy + (r.cy - c.cy) * 0.15;   // slight lean toward node y
      } else {
        x1 = r.left;  y1 = r.cy;
        x2 = c.right; y2 = c.cy + (r.cy - c.cy) * 0.15;
      }
      // Cubic control points create the S-curve. Distance is 45% of the gap,
      // so lines never straighten out or overshoot when columns are close.
      const dx = Math.abs(x2 - x1) * 0.45;
      const cp1x = side === 'left' ? x1 + dx : x1 - dx;
      const cp2x = side === 'left' ? x2 - dx : x2 + dx;
      const color = PROTO_COLOR[proto] || 'var(--cool)';
      // Stroke width scales with rate so heavy edges are visually louder,
      // but capped so a single hot edge doesn't dominate the whole card.
      const rate = parseFloat(node.querySelector('.row2 .req')?.textContent) || 0;
      const width = Math.min(3, Math.max(1, 1 + Math.log10(1 + rate) * 0.8));
      out += `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cp1x.toFixed(1)} ${y1.toFixed(1)}, ${cp2x.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}"
                stroke="${color}" stroke-width="${width.toFixed(2)}" opacity=".55"/>`;
      // Protocol label midway along the curve (skip generic http to reduce
      // clutter — user can still see the pill on the node itself).
      if (proto !== 'http') {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 4;
        out += `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}">${proto}</text>`;
      }
    });
    svg.innerHTML = out;
  }

  // Debounced redraw for the deps graph on window resize + card mutations.
  let _depsRT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_depsRT);
    _depsRT = setTimeout(_paintDepsGraph, 100);
  });

  // "Aug 4 09:30 → Aug 4 15:30" formatter for the custom-range pill label.
  function fmtCustomRange(startSec, endSec) {
    const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const s = new Date(startSec * 1000).toLocaleString('en-GB', opts);
    const e = new Date(endSec   * 1000).toLocaleString('en-GB', opts);
    return `${s} → ${e}`;
  }

  const SP = window.SP = {
    suggestions: [],
    activeIndex: -1,
    detailLoadGen: 0,
    // Subsystem tabs + chip row have their own generation counters so a
    // rapid range-change doesn't paint a stale response over a newer one.
    _subsysLoadGen: 0,
    _chipsLoadGen:  0,
    _subsysLoaded:  {},   // { "<service>|<tab>": true } — cleared on service switch
    // In-flight AbortControllers so a rapid range/service switch cancels the
    // outgoing HTTP request too, not just discards its result. The gen-counter
    // guards below stay as a belt-and-suspenders check in case abort races the
    // response back.
    _detailAbort:  null,
    _chipsAbort:   null,
    _subsysAborts: {},    // per-tab (dbpool/tomcat/runtime/txn) — sibling tabs load in parallel
    inventoryCount: 0,
    currentService: null,   // last-loaded service (so refresh/range-change re-fetches the same one)
    windowMinutes: 30,      // persists across service switches — user's preferred preset
    // Absolute range (unix seconds) for the "Custom…" mode. null when a preset is active.
    customStart: null,
    customEnd:   null,
    // Pinned cluster name (e.g. "a-th2p") when the winning source covers >1
    // cluster (OCP TH). Reset to '' on service switch so the backend picks the
    // largest cluster by default; user can override via the header selector.
    currentCluster: '',

    async initSuggest() {
      // Warm-load the first 20 alphabetically so the dropdown has content the
      // moment the user focuses the input.
      try {
        const res = await API.servicePerformance.suggest('', 20);
        if (res?.ok && res?.data?.data) {
          this.suggestions = res.data.data.suggestions || [];
          this.inventoryCount = res.data.data.inventoryCount || 0;
          $('sp2-inv-count').textContent = `${this.inventoryCount.toLocaleString()} services in inventory`;
        }
      } catch (_) { /* fail silent — dropdown will fetch on-demand */ }
    },

    async runSuggest(q) {
      try {
        const res = await API.servicePerformance.suggest(q, 20);
        if (!res?.ok) return;
        this.suggestions = res.data?.data?.suggestions || [];
        this.activeIndex = this.suggestions.length ? 0 : -1;
        this._renderDropdown();
      } catch (_) { /* ignore transient failures */ }
    },

    _renderDropdown() {
      const dd = $('sp2-dropdown');
      if (!this.suggestions.length) {
        dd.innerHTML = '<div class="sp2-drop-empty">ไม่พบ service ที่ match — พิมพ์ต่อ หรือเช็คสะกด</div>';
        dd.classList.add('on');
        return;
      }
      const rows = this.suggestions.map((s, i) => `
        <div class="sp2-drop-item ${i === this.activeIndex ? 'active' : ''}" data-idx="${i}">
          <div>
            <div class="sp2-drop-name">${esc(s.service)}</div>
            <div class="sp2-drop-sub">
              ${s.source === 'grafana' ? `<span class="sp2-tag sp2-tag-grafana-only" title="Service found in Grafana but not in the curated Service Inventory CSV — no BU/team/SLO metadata available">not in inventory</span>` : ''}
              ${s.bu       ? `<span class="sp2-tag">${esc(s.bu)}</span>` : ''}
              ${s.team     ? `<span class="sp2-tag">${esc(s.team)}</span>` : ''}
              ${s.severity && s.severity !== '-' ? `<span class="sp2-tag ${sevClass(s.severity)}">SEV ${esc(s.severity)}</span>` : ''}
              ${s.runway   ? `<span class="sp2-tag">${esc(s.runway)}</span>` : ''}
            </div>
          </div>
          <div class="sp2-drop-hint">↵</div>
        </div>`).join('');
      dd.innerHTML = `<div class="sp2-drop-header">${this.suggestions.length} match${this.suggestions.length !== 1 ? 'es' : ''}</div>${rows}`;
      dd.classList.add('on');
      dd.querySelectorAll('.sp2-drop-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.select(this.suggestions[+el.dataset.idx]);
        });
        el.addEventListener('mouseover', () => {
          this.activeIndex = +el.dataset.idx;
          dd.querySelectorAll('.sp2-drop-item').forEach((n, i) => n.classList.toggle('active', i === this.activeIndex));
        });
      });
    },

    closeDropdown() { $('sp2-dropdown')?.classList.remove('on'); },
    openDropdown()  { if (this.suggestions.length) $('sp2-dropdown').classList.add('on'); },

    select(sugg) {
      if (!sugg) return;
      $('sp2-input').value = sugg.service;
      $('sp2-clear').classList.add('on');
      this.closeDropdown();
      this.loadDetail(sugg.service);
    },

    // Change the shared time-range without ripping the whole detail panel.
    //
    // Full loadDetail() replaces the entire #sp2-detail node with a skeleton +
    // re-fetches everything. For a range switch that's overkill — only the two
    // sparklines actually change. We instead:
    //   1. Flip the active pill instantly (visual feedback with zero latency)
    //   2. Update the two "CPU · last Xh" labels
    //   3. Fade the chart bodies to signal a fetch is in flight
    //   4. Hit the API
    //   5. Replace ONLY the chart bodies + headline numbers, then repaint SVGs
    //
    // If the user rapidly clicks multiple ranges, detailLoadGen skips stale
    // responses so the last click wins.
    setWindow(min) {
      const clamped = SP_RANGES.some(r => r.min === min) ? min : 30;
      const wasPreset = this.customStart === null && this.customEnd === null;
      if (wasPreset && clamped === this.windowMinutes) return;
      this.windowMinutes = clamped;
      this.customStart = null;
      this.customEnd   = null;
      this._syncPillState();
      this._syncChartLabels('last ' + fmtWindow(clamped));
      return this._reloadCharts({ windowMin: clamped });
    },

    // ── Custom range picker ─────────────────────────────────────────
    // Open the modal, pre-filling with either the active custom range or
    // "last <windowMinutes>" so the user has a sensible baseline to tweak.
    // `target` routes the Apply button: 'graph' (default) = outer SP chart,
    // 'da' = Deep Analysis modal. DA reuses the exact same picker DOM so we
    // don't duplicate the datetime-local inputs + validation code.
    openCustomPicker(target = 'graph') {
      this._pickerTarget = target;
      const from = $('sp2-picker-from');
      const to   = $('sp2-picker-to');
      const err  = $('sp2-picker-err');
      err.textContent = '';
      let s, e;
      if (target === 'da') {
        const DA = window.SP.DeepAnalysis;
        if (DA?.customStart && DA?.customEnd) { s = DA.customStart; e = DA.customEnd; }
        else { e = Math.floor(Date.now()/1000); s = e - (DA?.windowMin || 720) * 60; }
      } else if (this.customStart && this.customEnd) {
        s = this.customStart; e = this.customEnd;
      } else {
        e = Math.floor(Date.now() / 1000);
        s = e - this.windowMinutes * 60;
      }
      from.value = this._toLocalInput(s);
      to.value   = this._toLocalInput(e);
      $('sp2-picker').classList.add('on');
      setTimeout(() => from.focus(), 30);
    },

    closeCustomPicker() {
      $('sp2-picker').classList.remove('on');
      this._pickerTarget = 'graph';
    },

    // Apply the modal's inputs. Basic client-side validation echoes the
    // backend's rules (min 5min, max 30d, end > start).
    applyCustomPicker() {
      const err = $('sp2-picker-err');
      const s = this._fromLocalInput($('sp2-picker-from').value);
      const e = this._fromLocalInput($('sp2-picker-to').value);
      if (!s || !e) { err.textContent = 'ระบุทั้ง From และ To'; return; }
      if (e <= s)   { err.textContent = 'To ต้องอยู่หลัง From'; return; }
      const spanMin = (e - s) / 60;
      if (spanMin < 5)         { err.textContent = 'ช่วงเวลาต้อง ≥ 5 นาที'; return; }
      if (spanMin > 30 * 1440) { err.textContent = 'ช่วงเวลาต้อง ≤ 30 วัน'; return; }
      const target = this._pickerTarget || 'graph';
      this.closeCustomPicker();
      if (target === 'da') window.SP.DeepAnalysis?.setCustomRange(s, e);
      else                 this.setCustomRange(s, e);
    },

    // Quick-preset shortcuts in the modal — populate inputs; user still clicks Apply.
    _pickerPreset(kind) {
      const now = new Date();
      const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
      let s, e;
      if (kind === 'today')       { s = midnight;                         e = now; }
      else if (kind === 'yesterday') {
        e = midnight;
        s = new Date(midnight); s.setDate(s.getDate() - 1);
      }
      else if (kind === 'last3d')  { e = now; s = new Date(e - 3  * 86400e3); }
      else if (kind === 'last7d')  { e = now; s = new Date(e - 7  * 86400e3); }
      else if (kind === 'last30d') { e = now; s = new Date(e - 30 * 86400e3); }
      else return;
      $('sp2-picker-from').value = this._toLocalInput(Math.floor(s.getTime() / 1000));
      $('sp2-picker-to').value   = this._toLocalInput(Math.floor(e.getTime() / 1000));
      $('sp2-picker-err').textContent = '';
    },

    // Unix seconds → "YYYY-MM-DDTHH:MM" (local time) for datetime-local input.
    _toLocalInput(unixSec) {
      const d  = new Date(unixSec * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    _fromLocalInput(str) {
      if (!str) return null;
      const ms = new Date(str).getTime();
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    },

    // Custom absolute range (Unix seconds). Both bounds required.
    // Reset any custom range (brush-zoom or picker) back to the 30m preset —
    // matches Grafana's "zoom out" behavior. Rebuilds the full detail so
    // the pill row + Custom pill disappear cleanly. URL sync fires via
    // the setWindow wrapper installed in boot.
    resetZoom() {
      if (!this.customStart) return;
      this.customStart = null;
      this.customEnd = null;
      this.setWindow(30);
    },

    setCustomRange(startSec, endSec) {
      if (!startSec || !endSec || endSec <= startSec) return;
      this.customStart = startSec;
      this.customEnd   = endSec;
      this.windowMinutes = Math.round((endSec - startSec) / 60);
      this._syncPillState();
      this._syncChartLabels(fmtCustomRange(startSec, endSec));
      return this._reloadCharts({ start: startSec, end: endSec });
    },

    // Highlight the pill that matches current state. Called after any
    // window/customRange change. Also refreshes the Custom pill's caption
    // to show "Custom · <range>" when a custom range is active.
    _syncPillState() {
      const isCustom = this.customStart !== null;
      document.querySelectorAll('.sp2-cc-range-btn').forEach(btn => {
        if (btn.dataset.custom === '1') {
          btn.classList.toggle('on', isCustom);
          // Use innerHTML (not textContent) so the pencil icon actually
          // renders as an SVG instead of showing as literal `<i…></i>` text.
          // Icons.replaceAll then swaps the placeholder for the real SVG.
          if (isCustom) {
            btn.innerHTML = `<i data-icon="pencil" style="width:11px;height:11px;vertical-align:-1px;margin-right:4px"></i>${esc(fmtCustomRange(this.customStart, this.customEnd))}`;
            if (window.Icons?.replaceAll) window.Icons.replaceAll(btn);
          } else {
            btn.textContent = 'Custom…';
          }
        } else {
          btn.classList.toggle('on', !isCustom && +btn.dataset.min === this.windowMinutes);
        }
      });
    },

    // Rewrite the "CPU · last X" / "MEM · last X" labels on both the aggregate
    // and per-pod cards. `label` is already formatted ("last 6h" or "Aug 4 09:00 → Aug 4 15:00").
    _syncChartLabels(label) {
      const cpuLbl = document.querySelector('[data-metric="cpu"] .sp2-cc-chart-head .lbl');
      const memLbl = document.querySelector('[data-metric="mem"] .sp2-cc-chart-head .lbl');
      // Preserve the .sp2-help-icon that was rendered in the initial HTML —
      // textContent would strip it, so rebuild via innerHTML and re-run
      // Icons.replaceAll on the labels so the new <i> gets swapped for SVG.
      const cpuHelp = 'ค่า CPU เฉลี่ยที่ pod หนึ่งใช้อยู่&#10;&#10;หน่วย \'m\' = millicores (1000 m = 1 core)&#10;% = เทียบกับ CPU limit ของแต่ละ pod';
      const memHelp = 'ค่า memory เฉลี่ยที่ pod หนึ่งใช้อยู่&#10;&#10;วัด container_memory_working_set_bytes (memory ทั้ง container รวม heap + off-heap + native)&#10;% = เทียบกับ MEM limit ของแต่ละ pod';
      if (cpuLbl) cpuLbl.innerHTML = `CPU avg/pod · ${label}<i class="sp2-help-icon" data-icon="help-circle" title="${cpuHelp}"></i>`;
      if (memLbl) memLbl.innerHTML = `MEM avg/pod · ${label}<i class="sp2-help-icon" data-icon="help-circle" title="${memHelp}"></i>`;
      // TXN rate / Avg latency (Spring Boot) share the same shared time-range.
      const txnLbl = document.querySelector('[data-metric="txn-rate"] .sp2-cc-chart-head .lbl');
      const msLbl  = document.querySelector('[data-metric="proc-ms"]  .sp2-cc-chart-head .lbl');
      const txnHelp = 'อัตราการรับ HTTP request รวมทั้ง workload (req/sec)&#10;&#10;PromQL: sum(rate(http_server_requests_seconds_count[5m]))&#10;&#10;มาจาก Micrometer /actuator/prometheus — เฉพาะ Spring Boot service';
      const msHelp  = 'Avg latency (เส้น) = sum(rate(_sum))/sum(rate(_count))×1000&#10;Max latency (band บาง) = max(http_server_requests_seconds_max)×1000&#10;&#10;Max = request ที่ช้าที่สุดใน scrape interval (Micrometer _max gauge) — จับ spike ที่ avg กลบไป';
      if (txnLbl) txnLbl.innerHTML = `TXN rate · ${label}<i class="sp2-help-icon" data-icon="help-circle" title="${txnHelp}"></i>`;
      if (msLbl)  msLbl.innerHTML  = `Avg latency · ${label}<i class="sp2-help-icon" data-icon="help-circle" title="${msHelp}"></i>`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll(document.querySelector('.sp2-cc-center'));
      if (window.Icons?.replaceAll) window.Icons.replaceAll(document.querySelector('.sp2-app-grid'));
      const cpuPpLbl = document.querySelector('[data-metric="cpu-per-pod"] .sp2-perpod-head .lbl');
      const memPpLbl = document.querySelector('[data-metric="mem-per-pod"] .sp2-perpod-head .lbl');
      if (cpuPpLbl) cpuPpLbl.textContent = 'CPU per pod · ' + label;
      if (memPpLbl) memPpLbl.textContent = 'MEM per pod · ' + label;
    },

    // Shared fetch + surgical repaint. apiOpts is passed straight to
    // API.servicePerformance.detail() → either {windowMin} or {start, end}.
    async _reloadCharts(apiOpts) {
      if (!this.currentService) return;
      // Show blocking overlay for the range/cluster refetch. Message is short
      // because this is a frequent action (range pill clicks).
      const _rangeLabel = apiOpts?.windowMin
        ? ('last ' + fmtWindow(apiOpts.windowMin))
        : (apiOpts?.start && apiOpts?.end
            ? ('custom range ' + Math.round((apiOpts.end - apiOpts.start) / 60) + ' min')
            : 'new range');
      try { LoadingOverlay?.show('กำลังโหลดกราฟใหม่ — ' + _rangeLabel, { hint: this.currentService }); } catch(_){}
      const _hide = () => { try { LoadingOverlay?.hide(); } catch(_){} };

      const bodies = document.querySelectorAll('.sp2-cc-chart-body, .sp2-perpod-body');
      bodies.forEach(b => b.classList.add('sp2-loading'));

      // Rapid range-picker clicks: cancel the previous fetch so the backend
      // stops working on the abandoned range. Reuses this._detailAbort — same
      // slot as loadDetail() since they mutate the same #sp2-detail region.
      try { this._detailAbort?.abort(); } catch (_) {}
      this._detailAbort = new AbortController();
      const _sig = this._detailAbort.signal;
      const gen = ++this.detailLoadGen;
      let res;
      try {
        res = await API.servicePerformance.detail(this.currentService, '', { ...apiOpts, cluster: this.currentCluster, signal: _sig });
      } catch (_) {
        bodies.forEach(b => b.classList.remove('sp2-loading'));
        _hide();
        return;
      }
      if (gen !== this.detailLoadGen) { _hide(); return; }
      if (res === null) { _hide(); return; }  // aborted — bodies get repainted by the winning call
      if (!res?.ok || !res?.data?.data) {
        bodies.forEach(b => b.classList.remove('sp2-loading'));
        _hide();
        return;
      }

      const d = res.data.data;
      const s = d.summary || {};
      // Update the cached detail so timeline annotations, header badges,
      // and any other consumer see the fresh range's events + inventory.
      this._lastDetail = d;

      // 5a: swap chart-body innerHTML with the new areaChart shell + repaint.
      const cpuBody = document.querySelector('[data-metric="cpu"] .sp2-cc-chart-body');
      const memBody = document.querySelector('[data-metric="mem"] .sp2-cc-chart-body');
      if (cpuBody) cpuBody.innerHTML = areaChart(d.series?.cpu || [], 'cores', 'var(--violet)',  { max: d.series?.cpuMax || [], min: d.series?.cpuMin || [] }, _sloLines('cpuPct', { inventory: d.inventory, limit: s.cpuLimit }));
      if (memBody) memBody.innerHTML = areaChart(d.series?.mem || [], 'bytes', 'var(--emerald)', { max: d.series?.memMax || [], min: d.series?.memMin || [] }, _sloLines('memPct', { inventory: d.inventory, limit: s.memLimit }));

      // 5a′: per-pod bodies + legends (rebuilt because pod set can shift over
      // longer windows — e.g. a pod that only existed 6h ago won't show up
      // in the 30m window's data).
      const cpuPpBody = document.querySelector('[data-metric="cpu-per-pod"] .sp2-perpod-body');
      const memPpBody = document.querySelector('[data-metric="mem-per-pod"] .sp2-perpod-body');
      const cpuPp = d.series?.cpuPerPod || [];
      const memPp = d.series?.memPerPod || [];
      const legendHtml = (series) => series.map((s, i) => `
        <span class="sp2-pod-legend-item" data-pod-idx="${i}" title="${(s.pod || '').replace(/"/g,'&quot;')}">
          <span class="dot" style="background:${POD_PALETTE[i % POD_PALETTE.length]}"></span>
          <span class="pod">${(s.pod || '').replace(/</g,'&lt;')}</span>
        </span>`).join('');
      if (cpuPpBody) cpuPpBody.innerHTML = multiLineChart(cpuPp, 'cores');
      if (memPpBody) memPpBody.innerHTML = multiLineChart(memPp, 'bytes');
      const cpuPpCard = document.querySelector('[data-metric="cpu-per-pod"]');
      const memPpCard = document.querySelector('[data-metric="mem-per-pod"]');
      if (cpuPpCard) {
        const cnt = cpuPpCard.querySelector('.sp2-perpod-head .cnt');
        if (cnt) cnt.textContent = `${cpuPp.length} pod${cpuPp.length !== 1 ? 's' : ''}`;
        const leg = cpuPpCard.querySelector('.sp2-pod-legend');
        if (leg) leg.innerHTML = legendHtml(cpuPp);
        else if (cpuPp.length) cpuPpCard.insertAdjacentHTML('beforeend', `<div class="sp2-pod-legend">${legendHtml(cpuPp)}</div>`);
      }
      if (memPpCard) {
        const cnt = memPpCard.querySelector('.sp2-perpod-head .cnt');
        if (cnt) cnt.textContent = `${memPp.length} pod${memPp.length !== 1 ? 's' : ''}`;
        const leg = memPpCard.querySelector('.sp2-pod-legend');
        if (leg) leg.innerHTML = legendHtml(memPp);
        else if (memPp.length) memPpCard.insertAdjacentHTML('beforeend', `<div class="sp2-pod-legend">${legendHtml(memPp)}</div>`);
      }

      // 5b: refresh headline "now" values (may drift slightly since backend re-runs
      // the instant query on each detail call — user expects the number to match
      // what the chart tail shows).
      const cpuNow = document.querySelector('[data-metric="cpu"] .sp2-cc-chart-head .now');
      const memNow = document.querySelector('[data-metric="mem"] .sp2-cc-chart-head .now');
      if (cpuNow) {
        cpuNow.className = 'now ' + (s.cpuPct >= 80 ? 'hot' : s.cpuPct >= 60 ? 'warn' : '');
        cpuNow.textContent = (s.cpuCores > 0 ? fmtCores(s.cpuCores) : '—') + (s.cpuPct != null ? ` · ${s.cpuPct.toFixed(1)}%` : '');
      }
      if (memNow) {
        memNow.className = 'now ' + (s.memPct >= 80 ? 'hot' : s.memPct >= 60 ? 'warn' : '');
        memNow.textContent = (s.memBytes > 0 ? fmtBytes(s.memBytes) : '—') + (s.memPct != null ? ` · ${s.memPct.toFixed(1)}%` : '');
      }

      // 5c: TXN rate / Avg latency (Spring Boot Micrometer) — same time-range,
      // so their sparkline + headline must follow. Skip when the section isn't
      // rendered (non-Spring apps).
      const app = d.app || {};
      const txnBody = document.querySelector('[data-metric="txn-rate"] .sp2-cc-chart-body');
      const msBody  = document.querySelector('[data-metric="proc-ms"]  .sp2-cc-chart-body');
      if (txnBody) txnBody.innerHTML = areaChart(d.series?.txnRate || [], 'reqs', 'var(--violet)', { max: d.series?.txnRateMax || [], min: d.series?.txnRateMin || [] });
      // Latency: only max is meaningful (real per-scrape max from Micrometer's
      // `_max` gauge). No true min from summary metrics — omit rather than
      // mislead with a synthetic min that just equals avg.
      if (msBody)  msBody.innerHTML  = areaChart(d.series?.procMs  || [], 'ms',   '#f59e0b',      { max: d.series?.procMsMax  || [] }, _sloLines('latencyMs', { inventory: d.inventory }));
      const fmtTxn = (v) => v == null ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtMs  = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms');
      const txnNow = document.querySelector('[data-metric="txn-rate"] .sp2-cc-chart-head .now');
      const msNow  = document.querySelector('[data-metric="proc-ms"]  .sp2-cc-chart-head .now');
      if (txnNow) {
        txnNow.className = 'now';
        txnNow.innerHTML = fmtTxn(app.txnRate) + (app.txnRate != null ? ' <span style="font-size:12px;color:var(--sp-text-soft);font-weight:500">req/s</span>' : '');
      }
      if (msNow) {
        const procCls = app.procTimeMs == null ? '' : app.procTimeMs >= 1000 ? 'hot' : app.procTimeMs >= 500 ? 'warn' : '';
        msNow.className = 'now ' + procCls;
        msNow.textContent = fmtMs(app.procTimeMs);
      }

      // 5d: Live-status list on the left column (TXN rate + Avg latency stats).
      // Their surrounding threshold color also shifts with fresh data.
      const statVals = document.querySelectorAll('.sp2-cc-status-list .sp2-cc-stat');
      statVals.forEach((stat) => {
        const lbl = stat.querySelector('.sp2-cc-stat-lbl');
        if (!lbl) return;
        const t = lbl.textContent || '';
        const dot  = stat.querySelector('.sp2-cc-stat-dot');
        const valE = stat.querySelector('.sp2-cc-stat-val');
        const subE = stat.querySelector('.sp2-cc-stat-sub');
        if (t.startsWith('TXN rate') && valE) {
          const txnColor = app.txnRate == null ? 'var(--sp-text-soft)' : 'var(--violet)';
          if (dot) { dot.style.background = txnColor; dot.style.color = txnColor; }
          valE.innerHTML = fmtTxn(app.txnRate) + '<span style="font-size:12px;color:var(--sp-text-soft);font-weight:500"> req/s</span>';
        } else if (t.startsWith('Avg latency') && valE) {
          const procColor = app.procTimeMs == null ? 'var(--sp-text-soft)' : app.procTimeMs >= 1000 ? 'var(--hot)' : app.procTimeMs >= 500 ? 'var(--warn)' : 'var(--ok)';
          if (dot) { dot.style.background = procColor; dot.style.color = procColor; }
          valE.textContent = fmtMs(app.procTimeMs);
          if (subE) subE.textContent = app.procTimeMs == null ? 'no requests' : app.procTimeMs >= 1000 ? 'slow' : app.procTimeMs >= 500 ? 'watching' : 'healthy';
        } else if (t.startsWith('CPU used') && valE && subE) {
          const cpuColor = s.cpuPct == null ? 'var(--sp-text-soft)' : s.cpuPct >= 80 ? 'var(--hot)' : s.cpuPct >= 60 ? 'var(--warn)' : 'var(--cool)';
          if (dot) { dot.style.background = cpuColor; dot.style.color = cpuColor; }
          valE.textContent = fmtCores(s.cpuCores);
          subE.textContent = s.cpuPct != null ? `${s.cpuPct.toFixed(1)}% of ${fmtCores(s.cpuLimit)}` : 'no limit set';
        } else if (t.startsWith('MEM used') && valE && subE) {
          const memColor = s.memPct == null ? 'var(--sp-text-soft)' : s.memPct >= 80 ? 'var(--hot)' : s.memPct >= 60 ? 'var(--warn)' : 'var(--emerald)';
          if (dot) { dot.style.background = memColor; dot.style.color = memColor; }
          valE.textContent = fmtBytes(s.memBytes);
          subE.textContent = s.memPct != null ? `${s.memPct.toFixed(1)}% of ${fmtBytes(s.memLimit)}` : 'no limit set';
        }
      });

      // 5e: Range-dependent sections that _reloadCharts historically DIDN'T
      // touch — they were re-rendered only on service switch. But Circuit
      // Breakers time-series, p95/p99 endpoint columns, and downstream tables
      // all reflect the current window, so they need a refresh when the range
      // pill changes. Swap section innerHTML in place so scroll position and
      // any open collapsibles below survive the update.
      const swapSection = (id, html) => {
        const sec = document.getElementById('sp2-la-sec-' + id);
        if (!sec) return;
        const hd = sec.querySelector('.sp2-la-section-hd');
        sec.innerHTML = (hd ? hd.outerHTML : '') + html;
      };
      if (d.app?.upstream || d.app?.downstream || d.app?.circuitBreakers) {
        swapSection('deps', this._dependencySection(d));
      }
      if (d.app?.endpoints?.length) {
        swapSection('endpoints', this._endpointsSection(d.app.endpoints, d.service, d.runway));
      }
      if (d.app?.downstream?.length) {
        swapSection('outbound', this._downstreamSection(d.app.downstream, d.service, d.runway));
      }

      bodies.forEach(b => b.classList.remove('sp2-loading'));
      paintCharts();  // measure new .sp2-chart-slot containers + draw SVGs
      observeChartSlots();  // re-paint automatically when card sizes settle
      // Icons in freshly swapped sections need re-rendering (data-icon spans)
      if (window.Icons?.replaceAll) window.Icons.replaceAll();

      // Range change affects the chip row + any currently-open subsystem
      // tab — chip refresh is deferred to idle so the main sparkline swap
      // feels instant, subsystem tab is only re-fetched if it's actually
      // open (else user pays nothing for it).
      this._scheduleChipLoad();
      this._reloadSubsystemIfOpen();
      this._reloadErrorFocusIfOpen?.();
      // Deploy detection is window-scoped — new range = potentially new deploys
      // captured. Cheap due to 5min server cache.
      this._loadDeploys?.();
      _hide();
    },

    // Pin queries to a specific cluster and re-render. No-op when the value
    // hasn't changed (avoids a needless round-trip when the user reopens the
    // <select> and picks the current value).
    switchCluster(cluster) {
      if (!this.currentService) return;
      if ((cluster || '') === (this.currentCluster || '')) return;
      this.currentCluster = cluster || '';
      this.loadDetail(this.currentService, true);
    },

    // Detail dashboard ------------------------------------------------
    // `keepCluster=true` when switching clusters for the SAME service so the
    // user's pinned choice survives the re-fetch; otherwise reset so the
    // backend re-picks the largest cluster for the new service.
    async loadDetail(service, keepCluster = false) {
      // Blocking overlay so user doesn't click charts / range pills while
      // the fetch is in flight. Auto-hides on all exit paths (success, error, abort).
      try { LoadingOverlay?.show('กำลังโหลดข้อมูล ' + service + '...', { hint: 'ดึง Prometheus + inventory + events' }); } catch(_){}
      try {
      if (!keepCluster || service !== this.currentService) this.currentCluster = '';
      this.currentService = service;
      // Cancel the previous detail fetch + all in-flight subsystem/chip loads
      // (they targeted the OLD service; keeping them in-flight wastes upstream
      // capacity and their responses would be discarded by the gen guards
      // below anyway). Do this BEFORE bumping gen so any late resolutions
      // still see gen mismatch.
      try { this._detailAbort?.abort(); } catch (_) {}
      try { this._chipsAbort?.abort();  } catch (_) {}
      for (const k in this._subsysAborts) { try { this._subsysAborts[k]?.abort(); } catch (_) {} }
      this._subsysAborts = {};
      this._detailAbort = new AbortController();
      const _sig = this._detailAbort.signal;
      const gen = ++this.detailLoadGen;
      const detail = $('sp2-detail');
      // Skeleton
      detail.innerHTML = `
        <div class="sp2-svc-head">
          <div>
            <div class="sp2-svc-title">${esc(service)}</div>
            <div class="sp2-svc-sub"><span class="sp2-skel" style="height:12px;width:220px"></span></div>
          </div>
        </div>
        <div class="sp2-kpi-grid">
          ${Array.from({ length: 4 }, () => `<div class="sp2-kpi"><div class="sp2-skel" style="height:11px;width:50%"></div><div class="sp2-skel" style="height:24px;width:60%"></div><div class="sp2-skel" style="height:10px;width:40%"></div></div>`).join('')}
        </div>
        <div class="sp2-charts">
          <div class="sp2-card"><div class="sp2-card-head"><div class="sp2-card-title">CPU (last 30 min)</div></div><div class="sp2-card-body"><div class="sp2-skel" style="height:180px"></div></div></div>
          <div class="sp2-card"><div class="sp2-card-head"><div class="sp2-card-title">MEM (last 30 min)</div></div><div class="sp2-card-body"><div class="sp2-skel" style="height:180px"></div></div></div>
          <div class="sp2-card sp2-gauge-card"><div class="sp2-card-head"><div class="sp2-card-title">Running pods</div></div><div class="sp2-card-body"><div class="sp2-skel" style="height:180px;width:180px;border-radius:50%"></div></div></div>
        </div>
      `;

      // Respect an already-active custom range so switching services doesn't
      // silently snap back to a preset window.
      const apiOpts = (this.customStart && this.customEnd)
        ? { start: this.customStart, end: this.customEnd, cluster: this.currentCluster }
        : { windowMin: this.windowMinutes,                 cluster: this.currentCluster };
      try {
        const res = await API.servicePerformance.detail(service, '', { ...apiOpts, signal: _sig });
        if (gen !== this.detailLoadGen) return;
        // API.request returns null on abort — treat as a silent no-op so the
        // "โหลดไม่สำเร็จ" error state isn't shown for user-driven cancellations.
        if (res === null) return;
        if (!res?.ok || !res?.data?.data) throw new Error(res?.data?.message || 'load failed');
        // Sync our state to whatever the backend actually pinned (may differ
        // from currentCluster if it was '' — backend picks the largest cluster).
        this.currentCluster = res.data.data.selectedCluster || '';
        this._renderDetail(res.data.data);
      } catch (e) {
        if (gen !== this.detailLoadGen) return;
        detail.innerHTML = `<div class="sp2-empty" style="border-style:solid;border-color:var(--hot);color:var(--hot)">
          <div class="sp2-empty-title">โหลดไม่สำเร็จ</div>
          <div class="sp2-empty-sub" style="color:var(--text-muted)">${esc(e.message || e)}</div>
        </div>`;
      }
      } finally {
        try { LoadingOverlay?.hide(); } catch(_){}
      }
    },

    _renderDetail(d) {
      // Cache the full detail response so the drill panel can filter
      // downstream rows locally (grouped-pill drill needs the hidden nodes).
      this._lastDetail = d;
      const inv = d.inventory || {};
      const rw  = d.runway    || {};
      const s   = d.summary   || {};

      // Header — 2 Grafana links:
      //   <i data-icon="circle"></i> Dashboard: opens the dashboard filtered by the workload variable
      //     (name is configurable per-runway → dashboardVarName). Defaults to
      //     "App" which matches ACM; TMN/NANO admins can override in the
      //     service-performance-sources.json config if their dashboard uses a
      //     different variable name.
      //   <i data-icon="circle"></i> Explore: deep-link to Grafana Explore with a pre-built PromQL
      //     query scoped to this service — works even if the dashboard doesn't.
      const dashUrl = rw.grafanaUrl && rw.dashboardUid
        ? `${rw.grafanaUrl}/d/${rw.dashboardUid}?orgId=${rw.orgId || 2}&var-${encodeURIComponent(rw.dashboardVarName || 'App')}=${encodeURIComponent(d.service)}`
        : '';
      const exploreQueries = rw.dsUid ? this._exploreQueriesFor(rw, d.service, d.namespace) : [];
      const badges = [];
      if (rw.name)      badges.push(`<span class="sp2-tag"><span class="sp2-runway-dot" style="background:${esc(runwayColor(rw.slug))}"></span>${esc(rw.name)}</span>`);
      if (d.namespace)  badges.push(`<span class="mono" style="font-size:11.5px;color:var(--text-muted)">${esc(d.namespace)}</span>`);
      if (inv.bu)       badges.push(`<span class="sp2-tag">${esc(inv.bu)}</span>`);
      if (inv.team)     badges.push(`<span class="sp2-tag">${esc(inv.team)}</span>`);
      if (inv.severity && inv.severity !== '-') badges.push(`<span class="sp2-tag ${sevClass(inv.severity)}">SEV ${esc(inv.severity)}</span>`);

      // Not-found case — render diagnostic breakdown of what each runway probe returned
      if (!d.found) {
        const probeRows = (d.probes || []).map(p => {
          const cls = p.error ? 'sev1' : (p.seriesReturned > 0 ? 'sev2' : '');
          const status = p.error
            ? `<span class="sp2-tag ${cls}">error</span>`
            : (p.seriesReturned > 0
                ? `<span class="sp2-tag ${cls}">${p.seriesReturned} series, no exact match</span>`
                : `<span class="sp2-tag">no series</span>`);
          const close = p.closePodSample?.length
            ? `<div class="mono" style="font-size:11px;color:var(--sp-text-soft);margin-top:6px">sample: ${p.closePodSample.slice(0,4).map(esc).join(', ')}${p.closePodSample.length > 4 ? '…' : ''}</div>`
            : '';
          const workloads = p.matchingWorkloads?.length
            ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px">Workload-aggregated hits: ${p.matchingWorkloads.slice(0,6).map(w => `<span class="mono">${esc(w)}</span>`).join(', ')}</div>`
            : '';
          return `<tr>
            <td>
              <div style="font-weight:600">${esc(p.name)} <span style="font-size:11px;color:var(--sp-text-soft);font-weight:400">· ${esc(p.scheme)}</span></div>
              ${close}${workloads}
              ${p.error ? `<div style="font-size:11px;color:var(--hot);margin-top:6px">${esc(p.error)}</div>` : ''}
            </td>
            <td class="right">${status}</td>
          </tr>`;
        }).join('');

        const missingRw = d.runwayNotConfigured || '';
        const emptyTitle = missingRw
          ? `Runway '${esc(missingRw)}' ยังไม่ได้ config`
          : 'ไม่พบ pod ที่ทำงานอยู่';
        const emptySub = missingRw
          ? `Service นี้อยู่บน Runway <b>${esc(missingRw)}</b> ตาม inventory sheet แต่ยังไม่มี source ใน <code>service-performance-sources.json</code> ที่ scrape metrics จาก runway นี้ — ให้ admin เพิ่ม source ที่ผูกกับ <b>${esc(missingRw)}</b> ก่อน`
          : esc(d.message || 'Service อาจถูก scale-down เหลือ 0 หรือชื่อไม่ตรงกับ pod ในคลัสเตอร์');
        const emptyBorder = missingRw ? 'border-color:var(--warn);color:var(--warn)' : '';

        $('sp2-detail').innerHTML = `
          <div class="sp2-svc-head">
            <div>
              <div class="sp2-svc-title">${esc(d.service)}</div>
              <div class="sp2-svc-sub">${badges.join('')}</div>
            </div>
          </div>
          <div class="sp2-empty" style="border-style:solid;${emptyBorder}">
            <div class="sp2-empty-ico">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
            </div>
            <div class="sp2-empty-title">${emptyTitle}</div>
            <div class="sp2-empty-sub">${emptySub}</div>
          </div>
          <div class="sp2-card">
            <div class="sp2-card-head">
              <div class="sp2-card-title">Probe diagnostics</div>
              <div style="margin-left:auto;font-size:11px;color:var(--sp-text-soft)">${(d.probes || []).length} runway probed</div>
            </div>
            <table class="sp2-tbl">
              <thead><tr><th>Runway</th><th class="right" style="width:220px">Result</th></tr></thead>
              <tbody>${probeRows}</tbody>
            </table>
          </div>`;
        return;
      }

      // Replicas (Prod) from CSV → true "desired" count if set. Otherwise
      // fall back to running count so the gauge shows 100%.
      const declaredReplicas = parseInt((inv.replicasProd || '').trim(), 10);
      const target = Number.isFinite(declaredReplicas) && declaredReplicas > 0 ? declaredReplicas : s.pods;
      const podDrift = Number.isFinite(declaredReplicas) && declaredReplicas > 0 && s.pods !== declaredReplicas;

      const kpi = (icoCls, ico, lbl, val, sub) => `
        <div class="sp2-kpi">
          <div class="sp2-kpi-top">
            <span class="sp2-kpi-icobox ${icoCls}">${ico}</span>
            <span class="sp2-kpi-lbl">${lbl}</span>
          </div>
          <div class="sp2-kpi-val">${val}</div>
          <div class="sp2-kpi-sub">${sub}</div>
        </div>`;

      const ic = (svg) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
      const kpis = [
        kpi('blue',    ic('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18"/><path d="M7 4h10l1 4H6l1-4Z"/>'), 'Running pods', s.pods,
            target > 0 && s.pods === target ? 'all healthy' : `${s.pods} up`),
        kpi('violet',  ic('<path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/><path d="M15 21h4a2 2 0 0 0 2-2v-4"/><rect x="7" y="7" width="10" height="10" rx="1"/>'), 'CPU avg/pod', fmtCores(s.cpuCores),
            s.cpuLimit > 0 ? `/ ${fmtCores(s.cpuLimit)} · ${s.cpuPct?.toFixed(1) ?? '—'}%` : 'no limit set'),
        kpi('emerald', ic('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4M10 10v4M14 10v4M18 10v4"/>'), 'MEM avg/pod', fmtBytes(s.memBytes),
            s.memLimit > 0 ? `/ ${fmtBytes(s.memLimit)} · ${s.memPct?.toFixed(1) ?? '—'}%` : 'no limit set'),
        kpi(s.memPct >= 80 || s.cpuPct >= 80 ? 'warn' : 'blue',
            ic('<path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z"/><path d="M12 6v6l4 2"/>'), 'Last fetched',
            new Date(d.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            d.fromCache ? 'from 60s cache' : 'live'),
      ].join('');

      // Pod rows
      const podRows = (d.pods || []).map(p => `
        <tr>
          <td><div class="mono" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;max-width:340px;white-space:nowrap" title="${esc(p.pod)}">${esc(p.pod)}</div></td>
          <td class="right mono">${fmtCores(p.cpuCores)}</td>
          <td class="right">${pctBar(p.cpuPct)}</td>
          <td class="right mono">${fmtBytes(p.memBytes)}</td>
          <td class="right">${pctBar(p.memPct)}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--sp-text-soft)">no pods</td></tr>';

      // ── Health pulse color: hot if 0 pods, warn if drift, ok otherwise
      const declaredReplicasN = parseInt((inv.replicasProd || '').trim(), 10);
      const healthyDrift = !Number.isFinite(declaredReplicasN) || declaredReplicasN === s.pods;
      const pulseColor = s.pods === 0 ? 'var(--hot)' : (!healthyDrift ? 'var(--warn)' : 'var(--ok)');
      const pulseIcon = s.pods === 0
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>'
        : !healthyDrift
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

      // Meta bits — runway badge (colored), namespace (mono), optional cluster
      // pin (only when the source covers >1 cluster), then BU/Team/SEV
      const clusterOpts = d.clusterOptions || [];
      const clusterPin = clusterOpts.length > 1 ? `
        <label class="sp2-cluster-pin" title="Pin queries to one cluster — this source covers ${clusterOpts.length} clusters and would otherwise sum their pod counts">
          <span class="lbl">Cluster</span>
          <select onchange="SP.switchCluster(this.value)">
            ${clusterOpts.map(o => `<option value="${esc(o.cluster)}" ${o.cluster === d.selectedCluster ? 'selected' : ''}>${esc(o.cluster)} · ${o.pods} pod${o.pods !== 1 ? 's' : ''}</option>`).join('')}
          </select>
        </label>` : '';
      const meta1 = `<span class="sp2-runway-badge"><span class="dot"></span>${esc(rw.name)}</span>`
        + (d.namespace ? `<span class="sp2-svc-ns" title="${esc(d.namespace)}">${esc(d.namespace)}</span>` : '')
        + clusterPin;

      const meta2Bits = [];
      if (inv.bu)       meta2Bits.push(esc(inv.bu));
      if (inv.team)     meta2Bits.push(esc(inv.team));
      if (inv.severity && inv.severity !== '-') meta2Bits.push(`SEV ${esc(inv.severity)}`);
      const meta2 = meta2Bits.length ? meta2Bits.join('<span class="sp2-svc-meta-sep"> · </span>') : '';

      $('sp2-detail').innerHTML = `
        <!-- Header hero -->
        <div class="sp2-svc-head" style="--runway-accent:${esc(runwayColor(rw.slug))};--sp-pulse:${pulseColor}">
          <div class="sp2-svc-pulse">${pulseIcon}</div>
          <div class="sp2-svc-info">
            <div class="sp2-svc-title" title="${esc(d.service)}">${esc(d.service)}</div>
            <div class="sp2-svc-meta1">${meta1}</div>
            ${meta2 ? `<div class="sp2-svc-meta2">${meta2}</div>` : ''}
          </div>
          <div class="sp2-svc-actions">
            <button class="sp2-btn" onclick="SP.loadDetail('${esc(d.service)}', true)" title="Reload (bypasses 60s cache next tick)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
              รีเฟรช
            </button>
            ${SP._logViewerBtn ? SP._logViewerBtn(d.service, d.namespace) : ''}
            ${exploreQueries.length ? `
              <div class="sp2-menu-wrap">
                <button class="sp2-btn" onclick="SP.toggleExploreMenu(event)" title="Pre-built PromQL queries for this service">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  Explore
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.6"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div id="sp2-explore-menu" class="sp2-menu">
                  <div class="sp2-menu-title">Open in Grafana Explore</div>
                  ${exploreQueries.map(q => {
                    const url = this._buildExploreUrl(rw, d.service, d.namespace, q.expr, q.dsUid);
                    return `<div class="sp2-menu-row">
                      <a href="${esc(url)}" target="_blank" rel="noopener" class="sp2-menu-link" onclick="SP._closeMenuOnce()">
                        <span>${q.label}</span>
                        <span class="sp2-menu-hint">Explore ↗</span>
                      </a>
                      <button class="sp2-menu-copy" title="Copy PromQL" onclick="SP.copyToClipboard(${JSON.stringify(q.expr).replace(/"/g, '&quot;')}, event)">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                      </button>
                    </div>`;
                  }).join('')}
                  <div class="sp2-menu-foot">
                    Datasource UID: <code>${esc(rw.dsUid)}</code>
                  </div>
                </div>
              </div>
            ` : ''}
            <button type="button" class="sp2-btn" onclick="SP.copyShareLink(this)" title="Copy link to this exact view (service + range + cluster) so teammates open the same page">
              <i data-icon="link" style="width:12px;height:12px;vertical-align:-1px;margin-right:5px"></i>Copy link
            </button>
            ${rw.grafanaUrl ? `<a class="sp2-btn" href="${esc(rw.grafanaUrl)}/alerting/list?search=${encodeURIComponent(d.service)}" target="_blank" rel="noopener" title="Open Grafana Alerting UI filtered to this service — see firing/pending/no-data rules">
              <i data-icon="bell" style="width:12px;height:12px;vertical-align:-1px;margin-right:5px"></i>Alerts ↗
            </a>` : ''}
            ${(() => {
              // Inline SM guard — _isSm() lives in the LogViewer <script>
              // block (loaded later), so we can't reference it here in
              // template-eval order. Cheap duplicate check matches its logic.
              const u = Auth.getUser?.();
              const canAlerts = u && (u.team === 'sm' || u.role === 'super_admin');
              return canAlerts ? `<button type="button" class="sp2-btn" onclick="SP.Alerts.open('${esc(d.service)}')" title="สร้าง / จัดการ threshold alert สำหรับ service นี้ — ยิง Google Chat เมื่อค่าเกิน (ประเมินทุก 30s)">
                <i data-icon="bell" style="width:12px;height:12px;vertical-align:-1px;margin-right:5px"></i>My Alerts
              </button>` : '';
            })()}
            <button type="button" class="sp2-btn" onclick="SP.DeepAnalysis.open('${esc(d.service)}')" title="Deep Analysis — deploys + anomalies + regression + correlation ในหน้าเดียว">
              <i data-icon="activity" style="width:12px;height:12px;vertical-align:-1px;margin-right:5px"></i>Deep Analysis
            </button>
            <button type="button" class="sp2-btn" onclick="SP.Compare.open('${esc(d.service)}')" title="Compare กับ service อื่น — overlay CPU / MEM / latency ของ 2-8 services บนแกนเวลาเดียวกัน (in-page modal)">
              <i data-icon="bar-chart" style="width:12px;height:12px;vertical-align:-1px;margin-right:5px"></i>Compare
            </button>
            ${dashUrl ? `<a class="sp2-btn primary" href="${esc(dashUrl)}" target="_blank" rel="noopener">Dashboard ↗</a>` : ''}
          </div>
        </div>

        <!-- ══ Command Center: symmetric 3-column grid ════════════════════
             Each column is a flex-column of 2 cards (or range picker + 2 cards
             for center). flex:1 on cards means each card fills half the grid
             row height → columns end at the same y-baseline, all cards feel
             equally "populated" instead of some floating with empty space. -->
        <div class="sp2-cc-grid">
          <!-- LEFT col: LIVE STATUS + CONFIG DRIFT as 2 separate cards -->
          <div class="sp2-cc-col">
            <div class="sp2-cc-card">${this._ccStatusList(s, target, d.app, d.hpa)}</div>
            <div class="sp2-cc-card">${this._ccDriftList(inv, s)}</div>
          </div>

          <!-- CENTER col: range pill row + CPU chart card + MEM chart card.
               data-metric attrs let SP.setWindow() surgically update these
               without re-rendering the whole detail page. -->
          <div class="sp2-cc-col">
            <div class="sp2-cc-range">
              <span class="sp2-cc-range-lbl">Range</span>
              ${SP_RANGES.map(r => `
                <button type="button"
                        class="sp2-cc-range-btn ${!this.customStart && r.min === this.windowMinutes ? 'on' : ''}"
                        data-min="${r.min}"
                        onclick="SP.setWindow(${r.min})">${r.label}</button>`).join('')}
              <button type="button"
                      class="sp2-cc-range-btn ${this.customStart ? 'on' : ''}"
                      data-custom="1"
                      onclick="SP.openCustomPicker()">${this.customStart ? `<i data-icon="pencil" style="width:11px;height:11px;vertical-align:-1px;margin-right:4px"></i>${esc(fmtCustomRange(this.customStart, this.customEnd))}` : 'Custom…'}</button>
              ${this.customStart ? `<button type="button" class="sp2-cc-range-btn sp2-reset-zoom" onclick="SP.resetZoom()" title="Back to 30m preset (Esc)">
                <i data-icon="arrow-left" style="width:11px;height:11px;vertical-align:-1px;margin-right:3px"></i>Reset
              </button>` : ''}
              <span class="sp2-brush-hint" title="Drag horizontally on any chart to zoom every chart on the page to that time window · Right-click a spike to jump to Log Explorer at that moment">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>
                ลาก = zoom · คลิกขวา = ดู log
              </span>
            </div>
            <div class="sp2-cc-card sp2-cc-chart-card" data-metric="cpu">
              <div class="sp2-cc-chart-head">
                <span class="lbl">CPU avg/pod · ${this.customStart ? fmtCustomRange(this.customStart, this.customEnd) : 'last ' + fmtWindow(this.windowMinutes)}<i class="sp2-help-icon" data-icon="help-circle" title="ค่า CPU เฉลี่ยที่ pod หนึ่งใช้อยู่ (avg ข้าม ${s.pods} pods)&#10;&#10;หน่วย 'm' = millicores (1000 m = 1 core)&#10;% = เทียบกับ CPU limit ของแต่ละ pod&#10;&#10;ตัวอย่าง: 314 m = 0.314 cores · 8.7% ของ limit 3.60 cores/pod"></i></span>
                <span class="now ${s.cpuPct >= 80 ? 'hot' : s.cpuPct >= 60 ? 'warn' : ''}">${s.cpuCores > 0 ? fmtCores(s.cpuCores) : '—'}${s.cpuPct != null ? ` · ${s.cpuPct.toFixed(1)}%` : ''}</span>
              </div>
              <div class="sp2-cc-chart-body">${areaChart(d.series?.cpu || [], 'cores', 'var(--violet)', { max: d.series?.cpuMax || [], min: d.series?.cpuMin || [] }, _sloLines('cpuPct', { inventory: d.inventory, limit: s.cpuLimit }))}</div>
            </div>
            <div class="sp2-cc-card sp2-cc-chart-card" data-metric="mem">
              <div class="sp2-cc-chart-head">
                <span class="lbl">MEM avg/pod · ${this.customStart ? fmtCustomRange(this.customStart, this.customEnd) : 'last ' + fmtWindow(this.windowMinutes)}<i class="sp2-help-icon" data-icon="help-circle" title="ค่า memory เฉลี่ยที่ pod หนึ่งใช้อยู่ (avg ข้าม ${s.pods} pods)&#10;&#10;วัดจาก container_memory_working_set_bytes (memory ทั้ง container รวม heap + off-heap + native)&#10;% = เทียบกับ MEM limit ของแต่ละ pod&#10;&#10;ตัวอย่าง: 2.62 GB · 65.4% ของ limit 4 GB/pod"></i></span>
                <span class="now ${s.memPct >= 80 ? 'hot' : s.memPct >= 60 ? 'warn' : ''}">${s.memBytes > 0 ? fmtBytes(s.memBytes) : '—'}${s.memPct != null ? ` · ${s.memPct.toFixed(1)}%` : ''}</span>
              </div>
              <div class="sp2-cc-chart-body">${areaChart(d.series?.mem || [], 'bytes', 'var(--emerald)', { max: d.series?.memMax || [], min: d.series?.memMin || [] }, _sloLines('memPct', { inventory: d.inventory, limit: s.memLimit }))}</div>
            </div>
          </div>

          <!-- RIGHT col: Pods gauge + JVM Heap gauge (or Summary fallback when
               the service isn't Java) so the column always has exactly 2 cards
               to match LEFT and CENTER — no lopsided single-card column. -->
          <div class="sp2-cc-col">
            <div class="sp2-cc-card">
              <div class="sp2-cc-section-title">Running pods</div>
              <div class="sp2-cc-gauge-body">${this._ccGauge(s.pods, target)}</div>
            </div>
            ${d.jvm ? this._jvmHeapCard(d.jvm) : this._ccSummary(d, s, inv)}
          </div>
        </div>

        <!-- Scrape-DOWN banner — Prometheus exporter for this service is
             unreachable (up=0). Explains why the metric tiles below are empty
             instead of silently rendering "—" everywhere. Common causes:
             sidecar exporter crash, TLS cert expiry on :18443, network policy. -->
        ${d.phpfpm && d.phpfpm.scrapeUp === 0 ? this._scrapeDownBanner(d) : ''}

        <!-- HTTP throughput + latency (Spring Boot). Only rendered when the
             service exposes Micrometer http_server_requests_seconds_* metrics. -->
        ${d.app ? this._appMetricsSection(d) : ''}

        <!-- PHP-FPM pool health (workers busy / listen queue / max-children /
             slow requests). Rendered for PHP-FPM services (e.g. ecatalog-web)
             detected via phpfpm_up label on the app_name. -->
        ${d.phpfpm ? this._phpFpmSection(d) : ''}

        <!-- Network fallback — always rendered when the primary TPS metric
             is missing (no Spring/PHP-FPM data). Uses cadvisor packets+bytes
             so the user always has SOMETHING to look at (spike/drop pattern)
             even when the app exporter is down. -->
        ${(d.app?.txnRate == null && d.network?.rxPacketsPerSec != null) ? this._networkFallbackSection(d) : ''}

        <!-- ══ Section tabs ═══════════════════════════════════════════════
             Overview (Command Center + TXN/latency) sits above the fold; big
             detail sections (Dependencies / API endpoints / Outbound / Per pod
             / Meta) become tabs beneath it. Only tabs with data show up. -->
        ${this._buildTabsSection(d, podRows, inv, s, target, podDrift)}
      `;
      animateGauges();
      paintCharts();     // measure containers + render SVGs at exact width (no stretch)
      // Layout A: every section is visible from the start — no tab to pick,
      // no panel to reveal. Just kick off the deps graph paint + set up
      // scroll-spy for the sticky mini-nav.
      requestAnimationFrame(() => requestAnimationFrame(_paintDepsGraph));
      this._setupScrollSpy();
      // Reset per-service subsystem load cache (a service switch means the
      // previously-cached "section X was loaded" flags no longer apply).
      this._subsysLoaded = {};
      // Chip row = deferred to browser idle (skeleton chips render instantly;
      // real fetch fires when the main paint is done so search feels fast).
      this._scheduleChipLoad();
      // Layout A: subsystem sections are all visible → hydrate them all in
      // parallel so users see the full picture without scrolling-triggered
      // fetches. Small stagger to keep the browser responsive.
      this._loadAllSubsystems();
      // Error Focus card lives inside the outbound section. Skipped when
      // the service has no downstream calls (section wasn't rendered).
      this._loadErrorFocus?.();
      // Sprint 4 · Deploy auto-detection — fetch in background so smart
      // deploy markers (🚀 + version) replace the naive "D" pod-created
      // markers on every chart. Cached 5min server-side so this is cheap.
      this._loadDeploys();
    },

    // Fetch deploys.php + re-paint annotations so 🚀 markers show up.
    // Silent on failure — smart deploys are a UX enhancement, not required.
    async _loadDeploys() {
      if (!this.currentService) return;
      try {
        const res = await API.servicePerformance.deploys(
          this.currentService,
          this.windowMinutes || 720,
          this.currentCluster || ''
        );
        if (res?.ok) {
          const d = res.data?.data || {};
          this._deployEvents = d.deploys || [];
          // Console visibility so users can verify detection is running +
          // debug when no 🚀 markers appear despite known deploys. If the
          // array is empty, the console shows totalPods + signals-tried
          // context so you can see WHY detection missed.
          if (this._deployEvents.length) {
            console.info('[sp2 deploys]', d.service, 'found', this._deployEvents.length, 'deploy(s):', this._deployEvents);
          } else {
            console.warn('[sp2 deploys]', d.service, 'no deploys detected · totalPods=' + d.totalPods + ' · window=' + d.window?.minutes + 'min · cluster=' + d.cluster + ' · debug=', d.debug || '(add ?debug=1 for details)');
          }
          if (typeof paintCharts === 'function') paintCharts();
        } else {
          console.warn('[sp2 deploys] fetch failed:', res);
        }
      } catch (e) {
        console.warn('[sp2 deploys] error:', e);
      }
    },

    // ── Tab layout builder ────────────────────────────────────────────
    // Renders the sticky tab bar + the panels below. Each panel is only
    // included when there's actual data — hides empty tabs entirely so the
    // bar doesn't have dead entries. `hasDeps` = at least 1 caller OR callee.
    // Layout A · Dense grid: no tabs — every subsystem drops into its own
    // scroll-anchored section, tied together by a sticky mini-nav on top.
    // We keep the same panel HTML the tabs used to render, just wrap each
    // in a <section> with a header + id for scroll-spy. Subsystem sections
    // (DB Pool / Tomcat / Runtime / Transaction) still start as skeletons
    // and are hydrated on load via _loadAllSubsystems() — but they load in
    // parallel now, so ops see the full picture without clicking anywhere.
    _buildTabsSection(d, podRows, inv, s, target, podDrift) {
      const hasDeps = !!(d.app?.upstream?.length || d.app?.downstream?.length);
      const hasEps  = !!(d.app?.endpoints?.length);
      const hasOut  = !!(d.app?.downstream?.length);
      const hasJvm  = !!(d.runway?.jvmDsUid && (d.jvm || d.app));
      const navItems = [];
      const sections = [];
      const push = (id, label, count, bodyHtml, pillHtml = '') => {
        navItems.push(`
          <button type="button" class="sp2-la-nav-btn" data-la-nav="${id}" onclick="SP.jumpToSection('${id}')">
            <span>${label}</span>${count != null ? `<span class="cnt">${count}</span>` : ''}
          </button>`);
        sections.push(`
          <section class="sp2-la-section" id="sp2-la-sec-${id}" data-la-sec="${id}">
            <div class="sp2-la-section-hd">
              <h3>${label}</h3><div class="spacer"></div>${pillHtml}
            </div>
            ${bodyHtml}
          </section>`);
      };

      // Order tuned for real incident-response workflow:
      //   1. Per pod  — "which pod is bad?" is almost always the first
      //      question, and per-pod CPU/MEM sparklines answer it visually
      //      faster than any subsystem drill. Priority slot right below
      //      the CC.
      //   2. Dependencies — "who is this service talking to, and is any
      //      dep slow?"; second-most-common troubleshooting hop.
      //   3. API endpoints — "which route is hot / erroring?".
      //   4. Subsystem drill (DB Pool → Tomcat → Runtime → Transaction) —
      //      root-cause work: connections exhausted, threads pinned, GC
      //      pressure, transaction thrash.
      //   5. Outbound calls — downstream-focused deep dive.
      //   6. Meta — config/inventory, not usually incident-relevant.
      push('pods', 'Per pod', d.pods.length, `
        ${this._perPodSection(d)}
        <div class="sp2-card">
          <div class="sp2-card-head">
            <div class="sp2-card-title">Pod detail</div>
            <div style="margin-left:auto;font-size:11px;color:var(--sp-text-soft)">${d.pods.length} pod${d.pods.length !== 1 ? 's' : ''}</div>
          </div>
          <table class="sp2-tbl sp2-tbl-sortable">
            <thead><tr>
              <th data-sort-col="pod" onclick="SP._sortPodTable(this)">POD <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="cpuCores" onclick="SP._sortPodTable(this)">CPU <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="cpuPct" onclick="SP._sortPodTable(this)">CPU % <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="memBytes" onclick="SP._sortPodTable(this)">MEM <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="memPct" onclick="SP._sortPodTable(this)">MEM % <span class="sp2-sort-icon"></span></th>
            </tr></thead>
            <tbody id="sp2-pod-detail-tbody" data-pods='${JSON.stringify(d.pods||[]).replace(/'/g,"&#39;")}'>${podRows}</tbody>
          </table>
        </div>`);
      if (hasDeps) push('deps', 'Dependencies',
        (d.app.upstream?.length || 0) + (d.app.downstream?.length || 0),
        this._dependencySection(d));
      if (hasEps) push('endpoints', 'API endpoints', d.app.endpoints.length,
        this._endpointsSection(d.app.endpoints, d.service, d.runway));
      if (hasJvm) {
        push('dbpool',  'DB Pool',    null, this._subsystemSkeleton('dbpool'));
        push('tomcat',  'Tomcat',     null, this._subsystemSkeleton('tomcat'));
        push('runtime', 'Runtime',    null, this._subsystemSkeleton('runtime'));
        push('httppool','HTTP Client Pool', null, this._subsystemSkeleton('httppool'));
        push('txn',     'Transaction',null, this._subsystemSkeleton('txn'));
      }
      // Error Focus — INDEPENDENT of hasOut. SP2's downstream aggregator
      // can return empty (esp. on OCP) even when http_client_requests
      // metrics exist for the service. We query Prometheus directly and
      // hide the section post-load if nothing comes back.
      if (d.runway && d.runway.jvmDsUid) {
        push('error-focus', 'Error Focus', null, this._errorFocusSectionHtml(d.service));
      }
      if (hasOut) push('outbound', 'Outbound calls', d.app.downstream.length,
        this._downstreamSection(d.app.downstream, d.service, d.runway));
      push('meta', 'Meta', null, this._metaCard(inv, s, target, podDrift));

      // Overview entry at the front — jumps back to top of detail. No
      // count because the CC + app-metrics blocks always render for any
      // service that reached _renderDetail.
      const overviewNav = `
        <button type="button" class="sp2-la-nav-btn on" data-la-nav="overview" onclick="SP.jumpToSection('overview')">
          <span>Overview</span>
        </button>`;

      return `
        <nav class="sp2-la-nav" role="tablist" id="sp2-la-nav">${overviewNav}${navItems.join('')}</nav>
        <div class="sp2-la-sections">${sections.join('')}</div>`;
    },

    // Layout A: sections are always visible. Kept as thin back-compat
    // shims so anything that used to switch tabs (e.g. status chips) now
    // just scrolls to the equivalent section.
    _pickInitialTab(d) { return null; },
    switchTab(name) { this.jumpToSection(name); },
    _activateTab(name) { this.jumpToSection(name); },

    // Scroll to a section (or the top of the detail for 'overview'). Also
    // highlights the matching nav button so the user sees where they landed.
    jumpToSection(id) {
      if (!id) return;
      // Cache-bust ensures we always resolve at scroll time (sections can
      // re-render on range change).
      const target = (id === 'overview')
        ? document.querySelector('.sp2-svc-head') || document.getElementById('sp2-detail')
        : document.getElementById('sp2-la-sec-' + id);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this._activateNavPill(id);
    },

    _activateNavPill(id) {
      document.querySelectorAll('.sp2-la-nav-btn').forEach(el =>
        el.classList.toggle('on', el.dataset.laNav === id));
    },

    // Intersection-observer scroll-spy — highlights the nav pill whose
    // section is currently the "primary" one in the viewport. Root margin
    // top = the sticky nav's height so the section header hitting the
    // bottom of the nav counts as "in view".
    _setupScrollSpy() {
      if (this._scrollSpyObs) {
        this._scrollSpyObs.disconnect();
        this._scrollSpyObs = null;
      }
      const sections = document.querySelectorAll('.sp2-la-section');
      if (!sections.length) return;
      // Track most recently intersected section — sort by DOM order + pick
      // the topmost visible one so rapid scrolls still highlight sanely.
      const visible = new Set();
      this._scrollSpyObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) visible.add(e.target.dataset.laSec);
          else                  visible.delete(e.target.dataset.laSec);
        });
        // Pick the earliest section in DOM order that's currently visible.
        for (const sec of sections) {
          if (visible.has(sec.dataset.laSec)) { this._activateNavPill(sec.dataset.laSec); return; }
        }
        // Nothing in view (scrolled above the first section) → Overview.
        this._activateNavPill('overview');
      }, { rootMargin: '-72px 0px -60% 0px', threshold: 0 });
      sections.forEach(el => this._scrollSpyObs.observe(el));
    },

    // Hydrate every subsystem section in parallel. Called once per render;
    // range-picker changes route through _reloadAllSubsystems() instead.
    _loadAllSubsystems() {
      const tabs = ['dbpool', 'tomcat', 'runtime', 'httppool', 'txn'];
      for (const tab of tabs) {
        if (document.querySelector(`.sp2-sub-body[data-sub="${tab}"]`)) {
          this._loadSubsystem(tab);
        }
      }
    },

    // ── Subsystem tabs (DB Pool / Tomcat / Runtime / Transaction) ─────
    // Skeleton HTML: same shape as the real render so the layout doesn't jump.
    // A 3-KPI placeholder + one wide chart placeholder covers all 4 tabs since
    // the real renderers dump into `.sp2-sub-body` at load time.
    _subsystemSkeleton(id) {
      return `
        <div class="sp2-sub-body" data-sub="${id}">
          <div class="sp2-sub-grid">
            <div class="sp2-sub-kpi"><div class="sp2-skel" style="height:11px;width:50%"></div><div class="sp2-skel" style="height:22px;width:60%;margin-top:6px"></div></div>
            <div class="sp2-sub-kpi"><div class="sp2-skel" style="height:11px;width:50%"></div><div class="sp2-skel" style="height:22px;width:60%;margin-top:6px"></div></div>
            <div class="sp2-sub-kpi"><div class="sp2-skel" style="height:11px;width:50%"></div><div class="sp2-skel" style="height:22px;width:60%;margin-top:6px"></div></div>
          </div>
          <div class="sp2-sub-chart-grid">
            <div class="sp2-sub-chart-card"><div class="sp2-skel" style="height:150px"></div></div>
            <div class="sp2-sub-chart-card"><div class="sp2-skel" style="height:150px"></div></div>
          </div>
        </div>`;
    },

    // Fire the subsystem fetch once per (service, tab). Range changes call
    // _reloadSubsystem() directly so they always refetch.
    _ensureSubsystemLoaded(tab) {
      const key = this.currentService + '|' + tab;
      if (this._subsysLoaded?.[key]) return;
      this._loadSubsystem(tab);
    },

    // Map tab id → API section name. Kept as one place so range-reload and
    // first-open agree on the request shape.
    _subsysSection(tab) {
      return { dbpool: 'hikari', tomcat: 'tomcat', runtime: 'jvm', httppool: 'httppool', txn: 'txn' }[tab] || '';
    },

    // Layout A: sections without real data should just disappear (not sit
     // there as skeleton forever or show an empty stub). Pull the whole
     // section AND its nav pill so the page stays tight for services that
     // don't expose that subsystem's metrics.
    _hideSubsystemSection(tab) {
      const sec = document.getElementById('sp2-la-sec-' + tab);
      if (sec) sec.remove();
      const nav = document.querySelector(`.sp2-la-nav-btn[data-la-nav="${tab}"]`);
      if (nav) nav.remove();
      // Re-run scroll-spy since sections changed.
      if (this._setupScrollSpy) this._setupScrollSpy();
    },

    // Detect empty payload: `kpis` object with every value null / undefined,
    // OR no timeseries data — means the target service doesn't emit these
    // metrics (common for non-Spring apps or Spring apps that disabled the
    // subsystem's Actuator binding).
    _subsystemIsEmpty(sec) {
      if (!sec) return true;
      const kpis = sec.kpis || {};
      const hasKpi = Object.values(kpis).some(v => v !== null && v !== undefined);
      const hasSeries = ['series','timeseries','trends'].some(k => {
        const v = sec[k];
        if (!v) return false;
        if (Array.isArray(v)) return v.some(row => Array.isArray(row?.values) && row.values.length);
        if (typeof v === 'object') return Object.values(v).some(row =>
          Array.isArray(row) ? row.length : Array.isArray(row?.values) && row.values.length);
        return false;
      });
      return !hasKpi && !hasSeries;
    },

    async _loadSubsystem(tab) {
      const section = this._subsysSection(tab);
      if (!section || !this.currentService || !this._lastDetail?.runway?.slug) {
        this._hideSubsystemSection(tab);
        return;
      }
      const body = document.querySelector(`.sp2-sub-body[data-sub="${tab}"]`);
      if (!body) return;
      // Per-tab gen counter — global one would treat sibling subsystem loads
      // as "stale" (dbpool's timeout would be suppressed because tomcat/
      // runtime/txn incremented gen after it started) → sections stuck as
      // skeleton forever. Track staleness per tab: only later calls for the
      // SAME tab (e.g. range change) should invalidate this one.
      this._subsysGen = this._subsysGen || {};
      this._subsysGen[tab] = (this._subsysGen[tab] || 0) + 1;
      const gen = this._subsysGen[tab];
      // Per-tab abort — a range flip cancels the previous fetch for the SAME
      // tab, but sibling tabs (loaded in parallel by _reloadSubsystemIfOpen)
      // keep their independent controllers.
      try { this._subsysAborts[tab]?.abort(); } catch (_) {}
      this._subsysAborts[tab] = new AbortController();
      const _sig = this._subsysAborts[tab].signal;
      const opts = (this.customStart && this.customEnd)
        ? { start: this.customStart, end: this.customEnd, cluster: this.currentCluster, signal: _sig }
        : { windowMin: this.windowMinutes,                 cluster: this.currentCluster, signal: _sig };
      // 10s cap — subsystem queries hitting a slow Thanos should give up
      // and hide the section rather than leave a skeleton loading forever.
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('subsystem timeout')), 10000));
      let res;
      try {
        res = await Promise.race([
          API.servicePerformance.subsystems(this.currentService, this._lastDetail.runway.slug, section, opts),
          timeout,
        ]);
      } catch (e) {
        console.warn(`[sp2] subsystem ${tab} load failed:`, e);
        if (gen !== this._subsysGen[tab]) return;
        this._hideSubsystemSection(tab);
        return;
      }
      if (gen !== this._subsysGen[tab]) return;
      if (res === null) return;  // aborted (new range/service in flight)
      const sec = res?.data?.data?.sections?.[section];
      // Missing / error / empty → hide the whole section + nav pill.
      if (!sec || sec.error || this._subsystemIsEmpty(sec)) {
        if (sec?.error) console.warn(`[sp2] subsystem ${tab} query error:`, sec.error);
        this._hideSubsystemSection(tab);
        return;
      }
      const win = res.data.data.window || {};
      const winLbl = win.isCustom
        ? fmtCustomRange(win.startUnix, win.endUnix)
        : 'last ' + fmtWindow(win.windowMinutes || 30);
      const renderer = {
        dbpool:  '_renderHikari',
        tomcat:  '_renderTomcat',
        runtime: '_renderJvm',
        httppool:'_renderHttpPool',
        txn:     '_renderTxn',
      }[tab];
      body.innerHTML = this[renderer](sec, winLbl);
      this._subsysLoaded = this._subsysLoaded || {};
      this._subsysLoaded[this.currentService + '|' + tab] = true;
      if (window.Icons?.replaceAll) window.Icons.replaceAll(body);
      paintCharts();
    },

    // Range-picker change side-effect: Layout A shows all subsystem
    // sections at once, so a range flip needs to refetch every one of them
    // (not just the "open tab" like the tab-era version did). Fires in
    // parallel — each section fades independently until its own fetch
    // resolves, so slow ones don't block fast ones.
    _reloadSubsystemIfOpen() {
      const tabs = ['dbpool','tomcat','runtime','httppool','txn'];
      for (const tab of tabs) {
        const body = document.querySelector(`.sp2-sub-body[data-sub="${tab}"]`);
        if (!body) continue;
        if (this._subsysLoaded) delete this._subsysLoaded[this.currentService + '|' + tab];
        body.style.opacity = '0.5';
        this._loadSubsystem(tab).finally(() => { body.style.opacity = ''; });
      }
    },

    // ── Renderers per subsystem ─────────────────────────────────────
    _renderHikari(h, winLbl) {
      const k = h.kpis || {};
      const fmt = (v, unit = '', dec = 0) => v == null ? '—' : (unit === 'ms'
        ? (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(v >= 10 ? 0 : 2) + ' ms')
        : (typeof v === 'number' ? v.toFixed(dec) : v) + (unit ? ' ' + unit : ''));
      const usagePct = (k.active != null && k.max) ? Math.min(100, (k.active / k.max) * 100) : null;
      const usageCls = usagePct == null ? '' : usagePct >= 90 ? 'hot' : usagePct >= 70 ? 'warn' : 'ok';
      const timeoutCls = (k.timeoutRate || 0) > 0.05 ? 'hot' : (k.timeoutRate || 0) > 0 ? 'warn' : 'ok';
      const acqCls = (k.acquireMaxMs || 0) > 100 ? 'hot' : (k.acquireMaxMs || 0) > 20 ? 'warn' : 'ok';
      return `
        <div style="font-size:11.5px;color:var(--sp-text-soft);margin-bottom:10px;line-height:1.6">
          <b style="color:var(--text)">DB Pool (Hikari)</b> — เช็ค connection pool ของ JDBC.
          <b>Pending &gt; 0</b> = thread รอ conn (pool เล็กไป) · <b>Timeout &gt; 0</b> = ขอ conn ไม่ทัน (error โผล่ที่ user) ·
          Acquire max สูง = DB ตอบช้า/network delay. ตัวชี้ขาดกรณี "app ปกติแต่ latency พุ่ง"
        </div>
        <div class="sp2-sub-grid">
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Active <span style="color:var(--sp-text-soft);font-weight:500">/ pool max</span></div>
            <div class="sp2-sub-kpi-val ${usageCls}">${fmt(k.active)}<span style="color:var(--sp-text-soft);font-size:14px;font-weight:500"> / ${fmt(k.max)}</span></div>
            <div class="sp2-sub-kpi-sub">${usagePct == null ? 'no data' : usagePct.toFixed(1) + '% used'}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Idle</div>
            <div class="sp2-sub-kpi-val">${fmt(k.idle)}</div>
            <div class="sp2-sub-kpi-sub">${k.min != null ? 'min pool ' + fmt(k.min) : ''}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Pending (waiting)</div>
            <div class="sp2-sub-kpi-val ${(k.pending || 0) > 0 ? 'hot' : 'ok'}">${fmt(k.pending)}</div>
            <div class="sp2-sub-kpi-sub">${(k.pending || 0) > 0 ? 'threads blocked on DB' : 'no waiters'}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Timeout rate <span style="color:var(--sp-text-soft);font-weight:500">/sec</span></div>
            <div class="sp2-sub-kpi-val ${timeoutCls}">${k.timeoutRate == null ? '—' : k.timeoutRate.toFixed(3)}</div>
            <div class="sp2-sub-kpi-sub">connection requests that timed out</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Acquire max</div>
            <div class="sp2-sub-kpi-val ${acqCls}">${fmt(k.acquireMaxMs, 'ms')}</div>
            <div class="sp2-sub-kpi-sub">longest wait to get a conn</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Usage max</div>
            <div class="sp2-sub-kpi-val">${fmt(k.usageMaxMs, 'ms')}</div>
            <div class="sp2-sub-kpi-sub">longest a conn was held</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Create max</div>
            <div class="sp2-sub-kpi-val">${fmt(k.createMaxMs, 'ms')}</div>
            <div class="sp2-sub-kpi-sub">slowest new-conn creation</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Usage rate <span style="color:var(--sp-text-soft);font-weight:500">/sec</span></div>
            <div class="sp2-sub-kpi-val">${k.usageRate == null ? '—' : k.usageRate.toFixed(1)}</div>
            <div class="sp2-sub-kpi-sub">DB queries per second (approx)</div>
          </div>
        </div>
        <div class="sp2-sub-chart-grid">
          ${this._subChartCard('Active connections · ' + winLbl, h.series?.active,     'reqs', 'var(--violet)',  { max: h.series?.activeMax,     min: h.series?.activeMin }, _sloLines('hikariActivePct', { limit: k.max }))}
          ${this._subChartCard('Idle · '             + winLbl, h.series?.idle,       'reqs', 'var(--emerald)', { max: h.series?.idleMax,       min: h.series?.idleMin })}
          ${this._subChartCard('Pending (waiters) · '+ winLbl, h.series?.pending,    'reqs', 'var(--warn)',    { max: h.series?.pendingMax,    min: h.series?.pendingMin })}
          ${this._subChartCard('Timeout rate · '     + winLbl, h.series?.timeout,    'reqs', 'var(--hot)',     { max: h.series?.timeoutMax,    min: h.series?.timeoutMin })}
          ${this._subChartCard('Acquire max (ms) · ' + winLbl, h.series?.acquireMax, 'ms',   '#f59e0b',        { min: h.series?.acquireMaxMin })}
          ${this._subChartCard('Usage max (ms) · '   + winLbl, h.series?.usageMax,   'ms',   'var(--cool)',    { min: h.series?.usageMaxMin })}
        </div>`;
    },

    _renderTomcat(t, winLbl) {
      const k = t.kpis || {};
      const fmt = (v, dec = 0) => v == null ? '—' : (typeof v === 'number' ? v.toFixed(dec) : v);
      const busy = k.busy;
      const max  = k.maxThreads;
      const ratio = (busy != null && max) ? busy / max : 0;
      const cls = ratio >= 0.9 ? 'hot' : ratio >= 0.7 ? 'warn' : 'ok';
      // Config table — only show fields the source actually populated (JMX
      // exporter is optional). Skips rows with null so we don't render "—" mud.
      const configRows = [
        ['Max threads',        k.maxThreads,       ''],
        ['Min spare threads',  k.minSpareThreads,  ''],
        ['Max connections',    k.maxConnections,   ''],
        ['Accept count',       k.acceptCount,      'connection queue depth'],
        ['Keep-alive timeout', k.keepAliveTimeout, 'ms'],
        ['Connection timeout', k.connectionTimeout,'ms'],
      ].filter(([_l, v]) => v != null);
      const _tomcatHint = `
        <div style="font-size:11.5px;color:var(--sp-text-soft);margin-bottom:10px;line-height:1.6">
          <b style="color:var(--text)">Tomcat HTTP thread pool</b> — thread ที่ handle inbound HTTP.
          <b>Busy / Max ≥ 90%</b> ต่อเนื่อง = คิว accept ล้น → 503 · เพิ่ม <code>server.tomcat.threads.max</code> หรือ scale out.
          Config table ด้านล่างมาจาก JMX exporter (optional)
        </div>`;
      const configTable = configRows.length ? `
        <div class="sp2-sub-chart-card" style="grid-column:1/-1">
          <div class="sp2-sub-chart-title">Tomcat Configuration <span class="sub">from Tomcat_ThreadPool_* JMX metrics</span></div>
          <table class="sp2-sub-pool-tbl">
            <thead><tr><th>Setting</th><th class="right">Value</th><th>Notes</th></tr></thead>
            <tbody>${configRows.map(([l, v, n]) => `<tr><td>${esc(l)}</td><td class="right">${fmt(v)}</td><td style="color:var(--sp-text-soft)">${esc(n)}</td></tr>`).join('')}</tbody>
          </table>
        </div>` : '';
      return `
        ${_tomcatHint}
        <div class="sp2-sub-grid">
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Busy threads <span style="color:var(--sp-text-soft);font-weight:500">/ max</span></div>
            <div class="sp2-sub-kpi-val ${cls}">${fmt(busy)}<span style="color:var(--sp-text-soft);font-size:14px;font-weight:500"> / ${fmt(max)}</span></div>
            <div class="sp2-sub-kpi-sub">${busy == null ? 'no data' : (ratio * 100).toFixed(1) + '% pool utilised'}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Current threads</div>
            <div class="sp2-sub-kpi-val">${fmt(k.current)}</div>
            <div class="sp2-sub-kpi-sub">total pool size right now</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Connections</div>
            <div class="sp2-sub-kpi-val">${fmt(k.connCount)}</div>
            <div class="sp2-sub-kpi-sub">${k.maxConnections ? 'max ' + fmt(k.maxConnections) : 'from JMX exporter'}</div>
          </div>
        </div>
        <div class="sp2-sub-chart-grid">
          ${this._subChartCard('Busy threads · '   + winLbl, t.series?.busy,      'reqs', 'var(--warn)',   { min: t.series?.busyMin }, _sloLines('tomcatBusyPct', { limit: t.kpis?.maxThreads }))}
          ${this._subChartCard('Current threads · '+ winLbl, t.series?.current,   'reqs', 'var(--violet)', { min: t.series?.currentMin })}
          ${this._subChartCard('Connections · '    + winLbl, t.series?.connCount, 'reqs', 'var(--cool)',   { min: t.series?.connCountMin })}
          ${configTable}
        </div>`;
    },

    _renderJvm(j, winLbl) {
      const heap = (j.pools || []).filter(p => p.area === 'heap');
      const nonHeap = (j.pools || []).filter(p => p.area === 'nonheap');
      const th = j.threads || {}, sys = j.system || {}, gc = j.gc || {}, files = j.files || {};
      const poolRow = (p) => {
        const pct = p.pct;
        const cls = pct == null ? '' : pct >= 85 ? 'hot' : pct >= 70 ? 'warn' : 'ok';
        const barCol = pct == null ? 'var(--sp-text-soft)' : pct >= 85 ? 'var(--hot)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)';
        return `
          <tr>
            <td>${esc(p.id)}</td>
            <td class="right">${fmtBytes(p.used)}</td>
            <td class="right">${p.max > 0 ? fmtBytes(p.max) : '—'}</td>
            <td class="right ${cls}">${pct == null ? '—' : pct.toFixed(1) + '%'}</td>
            <td class="right"><span class="sp2-sub-pool-bar"><span style="width:${Math.min(100, pct || 0)}%;background:${barCol}"></span></span></td>
          </tr>`;
      };
      const poolTable = (title, pools) => pools.length ? `
        <div class="sp2-sub-chart-card">
          <div class="sp2-sub-chart-title">${esc(title)} <span class="sub">used / max</span></div>
          <table class="sp2-sub-pool-tbl">
            <thead><tr><th>Pool</th><th class="right">Used</th><th class="right">Max</th><th class="right">%</th><th class="right"></th></tr></thead>
            <tbody>${pools.map(poolRow).join('')}</tbody>
          </table>
        </div>` : '';
      const gcCls = (gc.pauseMaxMs || 0) >= 500 ? 'hot' : (gc.pauseMaxMs || 0) >= 100 ? 'warn' : 'ok';
      const fdCls = (files.open && files.max) ? ((files.open / files.max >= 0.8) ? 'hot' : (files.open / files.max >= 0.6 ? 'warn' : 'ok')) : '';
      const fmt = (v, dec = 1) => v == null ? '—' : (typeof v === 'number' ? v.toFixed(dec) : v);
      return `
        <div style="font-size:11.5px;color:var(--sp-text-soft);margin-bottom:10px;line-height:1.6">
          <b style="color:var(--text)">JVM Runtime</b> — เจาะลึก JVM internal.
          <b>Heap pool</b> แยก Eden/Old/Survivor (Old เต็ม = memory leak signal) · <b>Non-heap</b> Metaspace เต็ม = classloader leak ·
          <b>GC pause ≥ 100ms</b> = user รู้สึกหน่วง / ≥ 500ms = timeout · <b>FD leak</b> = open FDs เพิ่มเรื่อยๆ ไม่ลง
        </div>
        <div class="sp2-sub-grid">
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">GC pause max</div>
            <div class="sp2-sub-kpi-val ${gcCls}">${gc.pauseMaxMs == null ? '—' : gc.pauseMaxMs >= 1000 ? (gc.pauseMaxMs/1000).toFixed(2) + ' s' : gc.pauseMaxMs.toFixed(1) + ' ms'}</div>
            <div class="sp2-sub-kpi-sub">${gc.countPerSec != null ? fmt(gc.countPerSec, 2) + ' GC/s' : 'per collection'}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Live threads <span style="color:var(--sp-text-soft);font-weight:500">/ peak</span></div>
            <div class="sp2-sub-kpi-val">${fmt(th.live, 0)}<span style="color:var(--sp-text-soft);font-size:14px;font-weight:500"> / ${fmt(th.peak, 0)}</span></div>
            <div class="sp2-sub-kpi-sub">${th.daemon != null ? fmt(th.daemon, 0) + ' daemon' : ''}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Process CPU</div>
            <div class="sp2-sub-kpi-val">${sys.procCpuPct == null ? '—' : sys.procCpuPct.toFixed(1) + '%'}</div>
            <div class="sp2-sub-kpi-sub">${sys.sysCpuPct != null ? 'system ' + sys.sysCpuPct.toFixed(1) + '%' : ''}${sys.load1 != null ? ' · load1 ' + sys.load1.toFixed(2) : ''}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">File descriptors</div>
            <div class="sp2-sub-kpi-val ${fdCls}">${fmt(files.open, 0)}${files.max ? '<span style="color:var(--sp-text-soft);font-size:14px;font-weight:500"> / ' + fmt(files.max, 0) + '</span>' : ''}</div>
            <div class="sp2-sub-kpi-sub">watch for leaks</div>
          </div>
          ${(th.byState && Object.keys(th.byState).length) ? (() => {
            const blocked = th.byState.blocked || 0;
            const waiting = (th.byState.waiting || 0) + (th.byState['timed-waiting'] || 0);
            const cls = blocked >= 5 ? 'hot' : blocked > 0 ? 'warn' : '';
            return `
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Thread states <span style="color:var(--sp-text-soft);font-weight:500">blocked / waiting</span></div>
            <div class="sp2-sub-kpi-val ${cls}">${blocked}<span style="color:var(--sp-text-soft);font-size:14px;font-weight:500"> / ${waiting}</span></div>
            <div class="sp2-sub-kpi-sub">${blocked >= 5 ? 'lock contention likely' : blocked > 0 ? 'some contention' : 'no contention'}</div>
          </div>`;
          })() : ''}
          ${j.classesLoaded != null ? `
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Classes loaded <span style="color:var(--sp-text-soft);font-weight:500">rising = leak</span></div>
            <div class="sp2-sub-kpi-val">${j.classesLoaded.toLocaleString()}</div>
            <div class="sp2-sub-kpi-sub">watch trend — monotonic ↑ = classloader leak</div>
          </div>` : ''}
          ${(j.buffers && j.buffers.length) ? (() => {
            const totalBuf = j.buffers.reduce((a, b) => a + (b.used || 0), 0);
            return `
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Direct buffers <span style="color:var(--sp-text-soft);font-weight:500">off-heap</span></div>
            <div class="sp2-sub-kpi-val">${fmtBytes(totalBuf)}</div>
            <div class="sp2-sub-kpi-sub">${j.buffers.map(b => b.id + ' ' + fmtBytes(b.used)).join(' · ')}</div>
          </div>`;
          })() : ''}
        </div>
        <div class="sp2-sub-chart-grid">
          ${poolTable('Heap pools', heap)}
          ${poolTable('Non-heap pools', nonHeap)}
          ${this._subChartCard('GC pause max (ms) · ' + winLbl, j.series?.gcPauseMaxMs, 'ms',   'var(--hot)',     { min: j.series?.gcPauseMaxMsMin }, _sloLines('gcPauseMs'))}
          ${this._subChartCard('GC pause rate (ms/s) · ' + winLbl, j.series?.gcPauseRate, 'ms',   '#f59e0b')}
          ${this._subChartCard('Live threads · '   + winLbl, j.series?.threadsLive, 'reqs', 'var(--violet)',     { min: j.series?.threadsLiveMin })}
          ${this._threadStatesChart(j.series?.threadsByState, winLbl)}
          ${this._subChartCard('Classes loaded · ' + winLbl, j.series?.classesLoaded, 'reqs', 'var(--warn)')}
          ${this._buffersChart(j.series?.buffersUsed, winLbl)}
          ${this._subChartCard('Process CPU % · '  + winLbl, j.series?.procCpuPct,  'reqs', 'var(--cool)',       { max: j.series?.procCpuPctMax,   min: j.series?.procCpuPctMin })}
          ${this._subChartCard('System load 1m · ' + winLbl, j.series?.load1,       'reqs', 'var(--emerald)',    { max: j.series?.load1Max,        min: j.series?.load1Min })}
          ${this._subChartCard('Open FDs · '       + winLbl, j.series?.filesOpen,   'reqs', 'var(--warn)',       { min: j.series?.filesOpenMin })}
        </div>`;
    },

    // Thread states chart — stacked-ish rendering using multiLineChart (one
    // colored line per state). BLOCKED gets red so it pops. Hidden if no
    // series (service doesn't export jvm_threads_states_threads).
    _threadStatesChart(byState, winLbl) {
      if (!byState || !Object.keys(byState).length) return '';
      const stateColor = {
        runnable: 'var(--ok)',
        blocked: 'var(--hot)',
        waiting: 'var(--warn)',
        'timed-waiting': '#f59e0b',
        new: 'var(--cool)',
        terminated: 'var(--sp-text-soft)',
      };
      // Convert map → multiLineChart's [{pod, values}] shape (pod = state name)
      const series = Object.entries(byState).map(([state, values]) => ({
        pod: state,
        values: values || [],
      }));
      const legend = series.map(s => `
        <span class="sp2-pod-legend-item">
          <span class="dot" style="background:${stateColor[s.pod] || 'var(--sp-text-soft)'}"></span>
          <span class="pod">${esc(s.pod)}</span>
        </span>`).join('');
      // Pass a custom palette hint via inline data-attr on the slot: reuse
      // multiLineChart but override colors via CSS variable on the wrapper.
      const chartHtml = multiLineChart(series, 'reqs');
      return `
        <div class="sp2-sub-chart-card">
          <div class="sp2-sub-chart-title"><span>Thread states · ${esc(winLbl)}</span><i class="sp2-help-icon" data-icon="help-circle" title="JVM Thread states breakdown&#10;&#10;• RUNNABLE = executing / ready to execute&#10;• BLOCKED = waiting for monitor lock (synchronized block) — >0 = contention&#10;• WAITING = wait(), park(), join() with no timeout&#10;• TIMED_WAITING = sleep(), wait(ms), park(ns) — async pool waits often live here&#10;&#10;BLOCKED สูง = lock contention → มองหา synchronized ที่ผิดที่ / DB row lock&#10;WAITING พุ่ง = ExecutorService/downstream pool ตัน"></i></div>
          <div class="sp2-sub-chart-body">${chartHtml}</div>
          <div class="sp2-pod-legend" style="padding:4px 8px;flex-wrap:wrap">${legend}</div>
        </div>`;
    },

    // Off-heap buffers chart — one line per buffer pool (direct/mapped).
    _buffersChart(buffersById, winLbl) {
      if (!buffersById || !Object.keys(buffersById).length) return '';
      const series = Object.entries(buffersById).map(([id, values]) => ({
        pod: id, values: values || [],
      }));
      const chartHtml = multiLineChart(series, 'bytes');
      const legend = series.map((s, i) => `
        <span class="sp2-pod-legend-item">
          <span class="dot" style="background:${POD_PALETTE[i % POD_PALETTE.length]}"></span>
          <span class="pod">${esc(s.pod)}</span>
        </span>`).join('');
      return `
        <div class="sp2-sub-chart-card">
          <div class="sp2-sub-chart-title"><span>Direct buffers · ${esc(winLbl)}</span><i class="sp2-help-icon" data-icon="help-circle" title="Off-heap ByteBuffer usage&#10;&#10;• direct = ByteBuffer.allocateDirect() — Netty/NIO frameworks&#10;• mapped = MappedByteBuffer (memory-mapped files)&#10;&#10;อธิบายเคส: 'container mem โต แต่ heap chart flat' → หา leak ที่นี่&#10;บ่อยที่สุด: Netty channel not released / PDF library / image processor"></i></div>
          <div class="sp2-sub-chart-body">${chartHtml}</div>
          <div class="sp2-pod-legend" style="padding:4px 8px;flex-wrap:wrap">${legend}</div>
        </div>`;
    },

    // HTTP Client Pool (Apache HttpComponents) — parity with Grafana panel 38
    // on bay-pp dashboards. Ops signal: `pending > 0` = pool exhausted (all
    // connections leased, callers queueing) → downstream slowdown ripples up.
    // `leased / max` is the leading indicator to watch before `pending` climbs.
    _renderHttpPool(h, winLbl) {
      const k = h.kpis || {};
      const pools = h.pools || [];
      const fmt = (v, dec = 0) => v == null ? '—' : (typeof v === 'number' ? v.toFixed(dec) : v);
      const pendCls = (k.pending || 0) >= 10 ? 'hot' : (k.pending || 0) > 0 ? 'warn' : 'ok';
      const utilCls = (k.utilPct || 0) >= 90 ? 'hot' : (k.utilPct || 0) >= 70 ? 'warn' : 'ok';
      const poolRow = (p) => {
        const cls = p.utilPct == null ? '' : p.utilPct >= 90 ? 'hot' : p.utilPct >= 70 ? 'warn' : 'ok';
        const barCol = p.utilPct == null ? 'var(--sp-text-soft)' : p.utilPct >= 90 ? 'var(--hot)' : p.utilPct >= 70 ? 'var(--warn)' : 'var(--ok)';
        const pendCol = p.pending > 0 ? 'var(--hot)' : 'var(--sp-text-soft)';
        return `
          <tr>
            <td class="mono" style="font-size:11px">${esc(p.name)}</td>
            <td class="right">${fmt(p.leased)}<span style="color:var(--sp-text-soft);font-size:11px"> / ${fmt(p.max)}</span></td>
            <td class="right">${fmt(p.available)}</td>
            <td class="right" style="color:${pendCol};font-weight:${p.pending > 0 ? 600 : 400}">${fmt(p.pending)}</td>
            <td class="right ${cls}">${p.utilPct == null ? '—' : p.utilPct.toFixed(1) + '%'}</td>
            <td class="right"><span class="sp2-sub-pool-bar"><span style="width:${Math.min(100, p.utilPct || 0)}%;background:${barCol}"></span></span></td>
          </tr>`;
      };
      const poolTable = pools.length > 1 ? `
        <div class="sp2-sub-chart-card">
          <div class="sp2-sub-chart-title">Per pool <span class="sub">${pools.length} httpclient beans</span></div>
          <table class="sp2-sub-pool-tbl">
            <thead><tr><th>Pool (httpclient)</th><th class="right">Leased / Max</th><th class="right">Avail</th><th class="right">Pending</th><th class="right">Util</th><th class="right"></th></tr></thead>
            <tbody>${pools.map(poolRow).join('')}</tbody>
          </table>
        </div>` : '';
      return `
        <div style="font-size:11.5px;color:var(--sp-text-soft);margin-bottom:10px;line-height:1.6">
          <b style="color:var(--text)">HTTP Client Pool</b> — Apache HttpComponents connection pool (RestTemplate / Feign default).
          <b>Pending &gt; 0</b> = pool หมด มี request รอ connection (downstream ตัน หรือ pool size เล็กไป) ·
          <b>Leased ใกล้ Max</b> = leading indicator ก่อน pending จะขึ้น · <b>Route max</b> = ceiling ต่อ target host (มัก saturate ก่อน total)
        </div>
        <div class="sp2-sub-grid">
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Pending <span style="color:var(--sp-text-soft);font-weight:500">queue depth</span></div>
            <div class="sp2-sub-kpi-val ${pendCls}">${fmt(k.pending)}</div>
            <div class="sp2-sub-kpi-sub">${(k.pending || 0) >= 10 ? 'exhausted — queue building' : (k.pending || 0) > 0 ? 'saturating' : 'no waiters'}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Leased <span style="color:var(--sp-text-soft);font-weight:500">/ max</span></div>
            <div class="sp2-sub-kpi-val ${utilCls}">${fmt(k.leased)}<span style="color:var(--sp-text-soft);font-size:14px;font-weight:500"> / ${fmt(k.max)}</span></div>
            <div class="sp2-sub-kpi-sub">${k.utilPct == null ? 'no data' : k.utilPct.toFixed(1) + '% util'}</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Available <span style="color:var(--sp-text-soft);font-weight:500">idle</span></div>
            <div class="sp2-sub-kpi-val">${fmt(k.available)}</div>
            <div class="sp2-sub-kpi-sub">connections ready in pool</div>
          </div>
          <div class="sp2-sub-kpi">
            <div class="sp2-sub-kpi-lbl">Route max <span style="color:var(--sp-text-soft);font-weight:500">per target</span></div>
            <div class="sp2-sub-kpi-val">${k.routeMax == null ? '—' : fmt(k.routeMax)}</div>
            <div class="sp2-sub-kpi-sub">${k.poolCount > 1 ? k.poolCount + ' pools' : 'single pool'}</div>
          </div>
        </div>
        <div class="sp2-sub-chart-grid">
          ${this._subChartCard('Pool leased · '    + winLbl, h.series?.leased,    'reqs', 'var(--cool)',    { max: h.series?.leasedMax, min: h.series?.leasedMin })}
          ${this._subChartCard('Pool pending · '   + winLbl, h.series?.pending,   'reqs', 'var(--hot)',     { max: h.series?.pendingMax })}
          ${this._subChartCard('Pool available · ' + winLbl, h.series?.available, 'reqs', 'var(--emerald)')}
          ${this._subChartCard('Pool max (capacity) · ' + winLbl, h.series?.max,  'reqs', 'var(--sp-text-soft)')}
          ${poolTable}
        </div>`;
    },

    _renderTxn(t, winLbl) {
      const fmtN  = (v, dec = 1) => v == null ? '—' : (typeof v === 'number' ? v.toFixed(dec) : v);
      const fmtMs = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms');
      const kpi = (lbl, val, sub, cls = '') => `
        <div class="sp2-sub-kpi">
          <div class="sp2-sub-kpi-lbl">${lbl}</div>
          <div class="sp2-sub-kpi-val ${cls}">${val}</div>
          <div class="sp2-sub-kpi-sub">${sub}</div>
        </div>`;
      const latCls = (t.latMaxMs || 0) >= 1000 ? 'hot' : (t.latMaxMs || 0) >= 500 ? 'warn' : '';
      const dbCls  = (t.peakDbActive != null && t.maxDb) ? ((t.peakDbActive / t.maxDb >= 0.9) ? 'hot' : (t.peakDbActive / t.maxDb >= 0.7 ? 'warn' : '')) : '';
      const tcCls  = (t.peakTcThread != null && t.peakTcThread >= 180) ? 'warn' : '';
      return `
        <div style="font-size:11.5px;color:var(--sp-text-soft);margin-bottom:8px">
          <i data-icon="info"></i> Peak values calculated with <span class="mono">max_over_time</span> across ${esc(winLbl)}. เปลี่ยน range แถบด้านบนจะรีเฟรชอัตโนมัติ
        </div>
        <div class="sp2-sub-grid">
          ${kpi('Peak TPS <span style="color:var(--sp-text-soft);font-weight:500">server</span>', fmtN(t.peakTps, 1) + ' <span style="font-size:14px;color:var(--sp-text-soft)">req/s</span>', 'sum(rate(http_server_requests[1m]))')}
          ${kpi('Peak client TPS', fmtN(t.peakClientTps, 1) + ' <span style="font-size:14px;color:var(--sp-text-soft)">req/s</span>', 'outbound to downstream services')}
          ${kpi('Latency max',    fmtMs(t.latMaxMs), 'server-side p-max', latCls)}
          ${kpi('Client RT max',  fmtMs(t.clientRtMaxMs), 'p-max on outbound calls')}
          ${kpi('Peak DB conn',   fmtN(t.peakDbActive, 0), 'max active hikari conn', dbCls)}
          ${kpi('Max DB pool',    fmtN(t.maxDb, 0), 'pool.max (config)')}
          ${kpi('Min DB pool',    fmtN(t.minDb, 0), 'pool.min (config)')}
          ${kpi('Peak DB usage',  fmtN(t.peakDbUsageQps, 1) + ' <span style="font-size:14px;color:var(--sp-text-soft)">q/s</span>', 'peak DB queries per sec')}
          ${kpi('Peak Tomcat threads', fmtN(t.peakTcThread, 0), 'busy threads at peak', tcCls)}
          ${kpi('Peak Tomcat conn',    fmtN(t.peakTcConn, 0), 'JMX connectionCount peak')}
          ${kpi('Peak JVM threads',    fmtN(t.peakThreads, 0), 'live threads at peak')}
          ${kpi('Peak Heap %',         t.peakHeapPct == null ? '—' : t.peakHeapPct.toFixed(1) + '%', 'heap util at peak', (t.peakHeapPct || 0) >= 85 ? 'hot' : (t.peakHeapPct || 0) >= 70 ? 'warn' : '')}
        </div>`;
    },

    // Shared chart card — wraps areaChart() with the same header/body shell
    // so all subsystem charts render uniformly. `unitTag` is one of the keys
    // in paintCharts()'s unitFns map ('cores' | 'bytes' | 'reqs' | 'ms').
    // Optional `band` = {max, min} (either side optional) surfaces per-pod
    // spread as a translucent envelope behind the avg line — same treatment
    // as the CPU/MEM aggregate charts up top.
    _subChartCard(title, series, unitTag, color, band, slo) {
      const isEmpty = !series || !series.length;
      return `
        <div class="sp2-sub-chart-card">
          <div class="sp2-sub-chart-title"><span>${esc(title)}</span></div>
          <div class="sp2-sub-chart-body">${isEmpty ? '<div class="sp2-sub-empty" style="padding:20px 8px">ไม่มีข้อมูล</div>' : areaChart(series, unitTag, color, band, slo)}</div>
        </div>`;
    },

    // ── Health chips (Command Center bottom row) ────────────────────
    // Two-phase render so the main dashboard feels instant:
    //   1. _scheduleChipLoad() — plants skeleton chips (shimmer) so the row
    //      isn't empty, then defers the real fetch to browser idle time
    //      (requestIdleCallback → falls back to setTimeout for Safari).
    //   2. _loadChips() — actual network call + swap skeleton for real chips.
    // The extra ~200-500ms delay is invisible to the user because the main
    // CPU/MEM charts + tabs are already painted. Range-change also uses
    // _scheduleChipLoad so the shared window ripples through without blocking.
    _scheduleChipLoad() {
      if (!this._lastDetail?.runway?.jvmDsUid) return;
      const row = document.getElementById('sp2-chip-row');
      if (!row) return;
      // Skeleton state — 5 shimmer pills matching the real chip layout so
      // the row doesn't jump size when real data arrives.
      row.innerHTML = ['DB Pool','Tomcat','GC','Threads','Heap'].map(n =>
        `<span class="sp2-chip na sp2-chip-skel">
          <span class="sp2-chip-dot" style="background:currentColor"></span>
          <span class="sp2-chip-name">${n}</span>
          <span class="sp2-chip-val"></span>
        </span>`).join('');
      const fire = () => this._loadChips();
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(fire, { timeout: 1500 });
      } else {
        setTimeout(fire, 300);
      }
    },

    async _loadChips() {
      if (!this.currentService || !this._lastDetail?.runway?.slug) return;
      if (!this._lastDetail?.runway?.jvmDsUid) return;   // non-Java source — no chips
      const row = document.getElementById('sp2-chip-row');
      if (!row) return;
      const gen = ++this._chipsLoadGen;
      try { this._chipsAbort?.abort(); } catch (_) {}
      this._chipsAbort = new AbortController();
      const _sig = this._chipsAbort.signal;
      const opts = (this.customStart && this.customEnd)
        ? { start: this.customStart, end: this.customEnd, cluster: this.currentCluster, signal: _sig }
        : { windowMin: this.windowMinutes,                 cluster: this.currentCluster, signal: _sig };
      let res;
      try {
        res = await API.servicePerformance.subsystems(
          this.currentService, this._lastDetail.runway.slug, 'chips', opts);
      } catch (_) { return; }
      if (gen !== this._chipsLoadGen) return;
      if (res === null) return;  // aborted
      const c = res?.data?.data?.sections?.chips;
      if (!c || c.error) { row.innerHTML = ''; return; }
      const chip = (tab, name, obj) => {
        const st = obj?.state || 'na';
        const clickable = st !== 'na';
        return `<span class="sp2-chip ${st}" ${clickable ? `onclick="SP.switchTab('${tab}')"` : ''}>
          <span class="sp2-chip-dot" style="background:currentColor"></span>
          <span class="sp2-chip-name">${esc(name)}</span>
          <span class="sp2-chip-val">${esc(obj?.label || 'n/a')}</span>
        </span>`;
      };
      row.innerHTML =
        chip('dbpool',  'DB Pool',  c.dbPool) +
        chip('tomcat',  'Tomcat',   c.tomcat) +
        chip('runtime', 'GC',       c.gc) +
        chip('runtime', 'Threads',  c.threads) +
        chip('runtime', 'Heap',     c.heap);
      if (window.Icons?.replaceAll) window.Icons.replaceAll(row);
    },

    // Toggle expand/collapse for a single API endpoint row. Used by the
    // per-endpoint chevron in the compact endpoint table.
    toggleEndpoint(el) {
      const tbody = el.closest('.sp2-ep-tbody');
      if (!tbody) return;
      tbody.classList.toggle('on');
      const parent = tbody.querySelector('.sp2-ep-parent');
      if (parent) parent.classList.toggle('on');
    },

    // ── Command Center: left-column status list ─────────────
    _ccStatusList(s, target, app, hpa) {
      const podColor = s.pods === 0 ? 'var(--hot)' : (target && s.pods < target ? 'var(--warn)' : 'var(--ok)');
      const cpuColor = s.cpuPct == null ? 'var(--sp-text-soft)' : s.cpuPct >= 80 ? 'var(--hot)' : s.cpuPct >= 60 ? 'var(--warn)' : 'var(--cool)';
      const memColor = s.memPct == null ? 'var(--sp-text-soft)' : s.memPct >= 80 ? 'var(--hot)' : s.memPct >= 60 ? 'var(--warn)' : 'var(--emerald)';
      // Spring Boot HTTP metrics — only rendered when the app exposes
      // `http_server_requests_seconds_*` on the JVM datasource. Threshold on
      // latency mirrors typical Ascend SLA (>500 ms warn, >1000 ms hot).
      const txnRate    = app?.txnRate;
      const procTimeMs = app?.procTimeMs;
      const txnColor  = txnRate == null ? 'var(--sp-text-soft)' : 'var(--violet)';
      const procColor = procTimeMs == null ? 'var(--sp-text-soft)' : procTimeMs >= 1000 ? 'var(--hot)' : procTimeMs >= 500 ? 'var(--warn)' : 'var(--ok)';
      const fmtTxn = (v) => v == null ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtMs  = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms');
      return `
        <div class="sp2-cc-section-title">Live status</div>
        <div class="sp2-cc-status-list">
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${podColor};color:${podColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">Running pods</div>
              <div class="sp2-cc-stat-val">${s.pods}${target && target !== s.pods ? ` <span style="color:var(--sp-text-soft);font-size:14px;font-weight:400">/ ${target}</span>` : ''}</div>
              <div class="sp2-cc-stat-sub">${s.pods === 0 ? 'no pods running' : target && s.pods < target ? `${target - s.pods} missing` : 'all healthy'}</div>
            </div>
          </div>
          ${hpa ? (() => {
            const h = hpa;
            const col = h.state === 'hot' ? 'var(--hot)' : h.state === 'warn' ? 'var(--warn)' : 'var(--ok)';
            const val = `${h.current ?? '—'}<span style="color:var(--sp-text-soft);font-size:14px;font-weight:400"> / ${h.max ?? '—'}</span>`;
            return `
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${col};color:${col}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">HPA <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">min ${h.min ?? '—'} · desired ${h.desired ?? '—'}</span><i class="sp2-help-icon" data-icon="help-circle" title="HorizontalPodAutoscaler status&#10;&#10;• current / max = replicas ที่ scale อยู่ / เพดาน&#10;• desired = HPA อยาก scale ไปเท่านี้ (อาจ != current ถ้า pending)&#10;• Conditions: ScalingActive/AbleToScale/ScalingLimited&#10;&#10;สี:&#10;• hot = capped at max (ต้องการมากกว่านี้) หรือ ScalingActive=False (metrics adapter พัง)&#10;• warn = ≥80% ของ max หรือ throttled&#10;• ok = healthy"></i></div>
              <div class="sp2-cc-stat-val" style="color:${col}">${val}</div>
              <div class="sp2-cc-stat-sub">${esc(h.reason)}</div>
            </div>
          </div>`;
          })() : ''}
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${cpuColor};color:${cpuColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">CPU used <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">avg/pod</span><i class="sp2-help-icon" data-icon="help-circle" title="ค่า CPU เฉลี่ยที่ pod หนึ่งใช้อยู่&#10;&#10;หน่วย 'm' = millicores (1000 m = 1 core)&#10;% = เทียบกับ CPU limit ของแต่ละ pod"></i></div>
              <div class="sp2-cc-stat-val">${fmtCores(s.cpuCores)}</div>
              <div class="sp2-cc-stat-sub">${s.cpuPct != null ? `${s.cpuPct.toFixed(1)}% of ${fmtCores(s.cpuLimit)}` : 'no limit set'}</div>
            </div>
          </div>
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${memColor};color:${memColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">MEM used <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">avg/pod</span><i class="sp2-help-icon" data-icon="help-circle" title="ค่า memory เฉลี่ยที่ pod หนึ่งใช้อยู่&#10;&#10;วัด container_memory_working_set_bytes (memory ทั้ง container รวม heap + off-heap + native)&#10;% = เทียบกับ MEM limit ของแต่ละ pod"></i></div>
              <div class="sp2-cc-stat-val">${fmtBytes(s.memBytes)}</div>
              <div class="sp2-cc-stat-sub">${s.memPct != null ? `${s.memPct.toFixed(1)}% of ${fmtBytes(s.memLimit)}` : 'no limit set'}</div>
            </div>
          </div>
          ${s.cpuThrottledPct != null ? (() => {
            const th = s.cpuThrottledPct;
            const thColor = th >= 25 ? 'var(--hot)' : th >= 5 ? 'var(--warn)' : 'var(--ok)';
            const thSub   = th >= 25 ? 'severe — raise CPU limit'
                          : th >= 5  ? 'noticeable — check limits'
                          : th > 0   ? 'occasional' : 'no throttling';
            return `
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${thColor};color:${thColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">CPU throttled <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">% of periods</span><i class="sp2-help-icon" data-icon="help-circle" title="CPU throttling — % of scheduler periods where container hit CPU limit&#10;&#10;วัดจาก rate(container_cpu_cfs_throttled_periods_total) / rate(container_cpu_cfs_periods_total) × 100&#10;&#10;สำคัญ: chart CPU % อาจแสดง headroom (60%) แต่ยังโดน throttle อยู่&#10;→ latency พุ่งโดยไม่มี CPU spike ให้เห็น = pod หิว CPU (limit ตั้งต่ำเกิน)&#10;&#10;สี: 0% ok · 1-4% ok · 5-24% warn · ≥25% hot"></i></div>
              <div class="sp2-cc-stat-val">${th.toFixed(th >= 10 ? 0 : 1)}<span style="font-size:12px;color:var(--sp-text-soft);font-weight:500">%</span></div>
              <div class="sp2-cc-stat-sub">${thSub}</div>
            </div>
          </div>`;
          })() : ''}
          ${app ? `
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${txnColor};color:${txnColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">TXN rate <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">req/sec · total</span><i class="sp2-help-icon" data-icon="help-circle" title="อัตราการรับ HTTP request ทั้ง workload&#10;&#10;วัดจาก sum(rate(http_server_requests_seconds_count[5m]))&#10;หน่วย req/sec (รวมทุก pod เข้าด้วยกัน)"></i></div>
              <div class="sp2-cc-stat-val">${fmtTxn(txnRate)}<span style="font-size:12px;color:var(--sp-text-soft);font-weight:500"> req/s</span></div>
              <div class="sp2-cc-stat-sub">Spring Boot · Micrometer</div>
            </div>
          </div>
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${procColor};color:${procColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">Avg latency <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">per request</span><i class="sp2-help-icon" data-icon="help-circle" title="เวลาเฉลี่ยต่อ HTTP request&#10;&#10;วัดจาก sum(rate(http_server_requests_seconds_sum)) / sum(rate(http_server_requests_seconds_count)) × 1000&#10;หน่วย ms&#10;&#10;สี: <500ms ok, 500-1000ms warn, >1000ms hot"></i></div>
              <div class="sp2-cc-stat-val">${fmtMs(procTimeMs)}</div>
              <div class="sp2-cc-stat-sub">${procTimeMs == null ? 'no requests' : procTimeMs >= 1000 ? 'slow' : procTimeMs >= 500 ? 'watching' : 'healthy'}</div>
            </div>
          </div>
          ${app.circuitBreakers ? (() => {
            const cb = app.circuitBreakers;
            const cbColor = cb.open > 0 ? 'var(--hot)' : cb.halfOpen > 0 ? 'var(--warn)' : 'var(--ok)';
            const cbVal   = cb.open > 0 ? `${cb.open} open` : cb.halfOpen > 0 ? `${cb.halfOpen} half` : `${cb.total} closed`;
            const cbSub   = cb.open > 0 ? 'downstream ruled unhealthy'
                          : cb.halfOpen > 0 ? 'probing recovery'
                          : 'all downstream healthy';
            return `
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${cbColor};color:${cbColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">Circuit breakers <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">${cb.total} total</span><i class="sp2-help-icon" data-icon="help-circle" title="Resilience4j circuit breakers — downstream health guards&#10;&#10;• closed = ปกติ ยิง request ตามปกติ&#10;• open = downstream ตาย breaker ตัด fail-fast (ปกป้อง user จาก timeout ช้าๆ)&#10;• half_open = ทดสอบว่า downstream ฟื้นยัง (ยิงบางส่วน)&#10;• forced_open = ปิดด้วยมือ (manual disable)&#10;&#10;สี: closed=ok · half_open=warn · open/forced_open=hot"></i></div>
              <div class="sp2-cc-stat-val" style="color:${cbColor}">${cbVal}</div>
              <div class="sp2-cc-stat-sub">${cbSub}</div>
            </div>
          </div>`;
          })() : ''}
          ${app.httpPool ? (() => {
            const hp = app.httpPool;
            const pendColor = hp.pending >= 10 ? 'var(--hot)' : hp.pending > 0 ? 'var(--warn)' : 'var(--ok)';
            const utilColor = hp.utilPct >= 90 ? 'var(--hot)' : hp.utilPct >= 70 ? 'var(--warn)' : 'var(--ok)';
            const pendSub   = hp.pending >= 10 ? 'exhausted — queue building' : hp.pending > 0 ? 'saturating' : 'no waiters';
            const utilSub   = `${hp.leased}/${hp.max} leased${hp.poolCount > 1 ? ` · ${hp.poolCount} pools` : ''}`;
            return `
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${pendColor};color:${pendColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">Pool pending <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">queue depth</span><i class="sp2-help-icon" data-icon="help-circle" title="HTTP client pool waiters (Apache HttpComponents)&#10;&#10;วัดจาก sum(httpcomponents_httpclient_pool_total_pending)&#10;&#10;ค่า >0 = pool หมดแล้ว มี request รอ connection&#10;สี: 0 ok · 1-9 warn · ≥10 hot (downstream ตันหรือ pool size เล็กไป)"></i></div>
              <div class="sp2-cc-stat-val">${hp.pending}</div>
              <div class="sp2-cc-stat-sub">${pendSub}</div>
            </div>
          </div>
          <div class="sp2-cc-stat">
            <span class="sp2-cc-stat-dot" style="background:${utilColor};color:${utilColor}"></span>
            <div class="sp2-cc-stat-body">
              <div class="sp2-cc-stat-lbl">Pool util <span style="color:var(--sp-text-soft);font-weight:400;font-size:9px">leased / max</span><i class="sp2-help-icon" data-icon="help-circle" title="HTTP client pool utilization&#10;&#10;leased ÷ max × 100 (sum ข้าม pod + pool)&#10;max = per-pod config, รวมเป็น fleet capacity&#10;&#10;สี: <70% ok · 70-89% warn · ≥90% hot (ใกล้ตัน — pending จะเริ่มขึ้น)"></i></div>
              <div class="sp2-cc-stat-val">${hp.utilPct.toFixed(0)}<span style="font-size:12px;color:var(--sp-text-soft);font-weight:500">%</span></div>
              <div class="sp2-cc-stat-sub">${utilSub}</div>
            </div>
          </div>`;
          })() : ''}` : ''}
          <div id="sp2-chip-row" class="sp2-chips">
            <!-- Filled by _loadChips() right after main render. Empty state (no
                 Java / no Micrometer) leaves this row blank so no dead UI. -->
          </div>
        </div>`;
    },

    // ── Command Center: left-column drift list (compact) ────
    _ccDriftList(inv, live) {
      if (!inv || !Object.keys(inv).length) {
        return `
          <div class="sp2-cc-section-title">Config drift</div>
          <div class="sp2-cc-drift" style="color:var(--sp-text-soft);font-size:11.5px;font-style:italic">no CSV inventory entry</div>`;
      }
      const parseCpu = (v) => {
        if (!v) return null;
        const m = String(v).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(m?)$/);
        if (!m) return null;
        const n = parseFloat(m[1]);
        return m[2] === 'm' ? n / 1000 : (n >= 10 ? n / 1000 : n);
      };
      const cmp = (declared, live) => {
        if (declared == null || declared === 0) return 'miss';
        if (live === 0) return 'warn';
        return Math.abs(declared - live) / declared <= 0.05 ? 'ok' : 'warn';
      };
      const ico = (state) => {
        const map = { ok: '✓', warn: '!', miss: '—' };
        return `<span class="sp2-cc-drift-ico ${state}">${map[state]}</span>`;
      };

      const declaredReplicas = parseInt((inv.replicasProd || '').trim(), 10);
      const replicaState = !Number.isFinite(declaredReplicas) || declaredReplicas === 0
        ? 'miss'
        : (declaredReplicas === live.pods ? 'ok' : 'warn');

      const cpuLimDec = parseCpu(inv.cpuLimit);
      const cpuReqDec = parseCpu(inv.cpuRequest);
      const cpuLimState = cmp(cpuLimDec, live.perPodCpuLimit   || 0);
      const cpuReqState = cmp(cpuReqDec, live.perPodCpuRequest || 0);

      const rows = [
        {
          lbl: 'Replicas',
          val: `${Number.isFinite(declaredReplicas) ? declaredReplicas : '—'} = ${live.pods}`,
          state: replicaState,
        },
        {
          lbl: 'CPU lim /pod',
          val: cpuLimDec != null ? `${fmtCores(cpuLimDec)} ${cpuLimState === 'ok' ? '=' : '≠'} ${fmtCores(live.perPodCpuLimit || 0)}` : '—',
          state: cpuLimState,
        },
        {
          lbl: 'CPU req /pod',
          val: cpuReqDec != null ? `${fmtCores(cpuReqDec)} ${cpuReqState === 'ok' ? '=' : '≠'} ${fmtCores(live.perPodCpuRequest || 0)}` : '—',
          state: cpuReqState,
        },
      ];
      return `
        <div class="sp2-cc-section-title">
          <span>Config drift</span>
          <span style="font-size:10px;color:var(--sp-text-soft);font-weight:400;text-transform:none;letter-spacing:0">CSV vs Live</span>
        </div>
        <div class="sp2-cc-drift">
          ${rows.map(r => `
            <div class="sp2-cc-drift-row">
              <span class="sp2-cc-drift-lbl">${esc(r.lbl)}</span>
              <span class="sp2-cc-drift-val">${esc(r.val)} ${ico(r.state)}</span>
            </div>`).join('')}
        </div>`;
    },

    // ── Command Center: right-column gauge (compact size) ───
    _ccGauge(running, target) {
      const R = 58, C = 75, STROKE = 12;
      const circ = 2 * Math.PI * R;
      const ratio = target > 0 ? Math.min(1, running / target) : (running > 0 ? 1 : 0);
      const dash = (circ * ratio).toFixed(1);
      const color = running === 0 ? 'var(--hot)' : ratio >= 1 ? 'var(--ok)' : 'var(--warn)';
      const cap = target > 0
        ? (target === running ? 'all pods ready' : `${running}/${target} ready`)
        : (running > 0 ? 'currently running' : 'no pods');
      const zeroCls = running === 0 ? ' zero' : '';
      return `
        <div class="sp2-cc-gauge${zeroCls}">
          <svg viewBox="0 0 150 150">
            <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${STROKE}"/>
            <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}"
                    stroke-linecap="round" stroke-dasharray="0 ${circ}"
                    style="transition:stroke-dasharray .8s cubic-bezier(.4,0,.2,1)"
                    data-dash-target="${dash} ${circ}"/>
          </svg>
          <div class="sp2-cc-gauge-inner">
            <div class="sp2-cc-gauge-val">${running}</div>
            <div class="sp2-cc-gauge-lbl">Pods</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--sp-text-soft);text-align:center">${cap}</div>`;
    },

    // ── JVM Heap gauge card — mirrors Grafana's "core-service mem %"
    // panel exactly. Only rendered when the source declared jvmDsUid AND the
    // service actually exposes Micrometer JVM metrics (Java/Spring). Values
    // are `avg(jvm_memory_used_bytes)/avg(jvm_memory_max_bytes)` — averaged
    // across every JVM memory pool × every pod, matching Grafana's query.
    _jvmHeapCard(jvm) {
      const R = 58, C = 75, STROKE = 12;
      const circ = 2 * Math.PI * R;
      const pct = Math.max(0, Math.min(100, jvm.memPct || 0));
      const ratio = pct / 100;
      const dash = (circ * ratio).toFixed(1);
      const color = pct >= 85 ? 'var(--hot)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)';
      const helpText = 'JVM Heap % (Micrometer /actuator/prometheus)&#10;&#10;avg(jvm_memory_used_bytes) / avg(jvm_memory_max_bytes)&#10;เฉลี่ยข้ามทุก memory pool × ทุก pod — ตรงตาม query ของ Grafana panel &quot;core-service mem %&quot;&#10;&#10;ต่างจาก MEM avg/pod ที่วัด container working_set (รวม heap + non-heap + native)';
      return `
        <div class="sp2-cc-card">
          <div class="sp2-cc-section-title">JVM Heap<i class="sp2-help-icon" data-icon="help-circle" title="${helpText}"></i></div>
          <div class="sp2-cc-gauge-body">
            <div class="sp2-cc-gauge">
              <svg viewBox="0 0 150 150">
                <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${STROKE}"/>
                <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}"
                        stroke-linecap="round" stroke-dasharray="0 ${circ}"
                        style="transition:stroke-dasharray .8s cubic-bezier(.4,0,.2,1)"
                        data-dash-target="${dash} ${circ}"/>
              </svg>
              <div class="sp2-cc-gauge-inner">
                <div class="sp2-cc-gauge-val">${pct.toFixed(1)}<span style="font-size:14px;font-weight:600">%</span></div>
                <div class="sp2-cc-gauge-lbl">Heap</div>
              </div>
            </div>
            <div style="font-size:11px;color:var(--sp-text-soft);text-align:center">${fmtBytes(jvm.memUsed)} / ${fmtBytes(jvm.memMax)}</div>
          </div>
        </div>`;
    },

    // ── Command Center: right-column config summary card ────
    _ccSummary(d, s, inv) {
      // Count drift rows the drift-list produced — same rules
      const parseCpu = (v) => {
        if (!v) return null;
        const m = String(v).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(m?)$/);
        if (!m) return null;
        const n = parseFloat(m[1]);
        return m[2] === 'm' ? n / 1000 : (n >= 10 ? n / 1000 : n);
      };
      let checked = 0, drifted = 0;
      const check = (dec, live) => {
        if (dec == null || dec === 0) return;
        checked++;
        if (live === 0 || Math.abs(dec - live) / dec > 0.05) drifted++;
      };
      const declaredReplicas = parseInt((inv?.replicasProd || '').trim(), 10);
      if (Number.isFinite(declaredReplicas) && declaredReplicas > 0) {
        checked++;
        if (declaredReplicas !== s.pods) drifted++;
      }
      check(parseCpu(inv?.cpuLimit),   s.perPodCpuLimit   || 0);
      check(parseCpu(inv?.cpuRequest), s.perPodCpuRequest || 0);

      const badgeCls = drifted === 0 ? 'ok' : 'warn';
      const badgeTxt = checked === 0 ? 'no CSV data' : (drifted === 0 ? `${checked} in sync` : `${drifted} drift`);
      return `
        <div class="sp2-cc-card">
          <div class="sp2-cc-section-title">Summary</div>
          <div class="sp2-cc-summary">
            <div class="sp2-cc-summary-row">
              <span class="sp2-cc-summary-lbl">Fetched</span>
              <span class="sp2-cc-summary-val">${new Date(d.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
            <div class="sp2-cc-summary-row">
              <span class="sp2-cc-summary-lbl">Source</span>
              <span class="sp2-cc-summary-val">${d.fromCache ? 'cache · 60s' : 'live'}</span>
            </div>
            <div class="sp2-cc-summary-row">
              <span class="sp2-cc-summary-lbl">Namespace</span>
              <span class="sp2-cc-summary-val" style="font-size:10.5px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(d.namespace || '—')}">${esc(d.namespace || '—')}</span>
            </div>
            <div class="sp2-cc-summary-row" style="margin-top:4px">
              <span class="sp2-cc-summary-lbl">Config</span>
              <span class="sp2-cc-summary-badge ${badgeCls}">${esc(badgeTxt)}</span>
            </div>
          </div>
        </div>`;
    },

    // Per-pod breakdown — stacked full-width cards for CPU + MEM. Reuses
    // the same time-range as the aggregate charts (SP.windowMinutes).
    // Legend under each chart maps color → pod name so users can identify
    // spikes at a glance. Empty per-pod series is common right after a
    // deploy — we render an empty-state instead of hiding the card so the
    // layout doesn't jump when data starts flowing.
    // ── HTTP throughput + latency section (Spring Boot Micrometer) ─────────
    // Renders 2 side-by-side charts under the Command Center. Only visible
    // for services that expose /actuator/prometheus (checked via d.app).
    _appMetricsSection(d) {
      const txnSeries = d.series?.txnRate || [];
      const msSeries  = d.series?.procMs  || [];
      const txnBand   = { max: d.series?.txnRateMax || [], min: d.series?.txnRateMin || [] };
      // Latency: only real max (Micrometer `_max` gauge) — no min counterpart.
      const msBand    = { max: d.series?.procMsMax  || [] };
      const winLbl = this.customStart
        ? fmtCustomRange(this.customStart, this.customEnd)
        : 'last ' + fmtWindow(this.windowMinutes);
      const app = d.app || {};
      const fmtTxn = (v) => v == null ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtMs  = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms');
      const procColor = app.procTimeMs == null ? '' : app.procTimeMs >= 1000 ? 'hot' : app.procTimeMs >= 500 ? 'warn' : '';
      // areaChart is coloured by the string containing 'emerald' for bytes;
      // for these new metrics use distinct hues (violet for throughput,
      // orange for latency) so they don't visually collide with CPU/MEM.
      return `
        <div class="sp2-app-grid">
          <div class="sp2-card sp2-cc-chart-card" data-metric="txn-rate">
            <div class="sp2-cc-chart-head">
              <span class="lbl">TXN rate · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="อัตราการรับ HTTP request รวมทั้ง workload (req/sec)&#10;&#10;PromQL: sum(rate(http_server_requests_seconds_count{app_name=X,cluster=Y}[5m]))&#10;&#10;มาจาก Micrometer /actuator/prometheus — เฉพาะ Spring Boot service"></i></span>
              <span class="now">${fmtTxn(app.txnRate)}${app.txnRate != null ? ' <span style="font-size:12px;color:var(--sp-text-soft);font-weight:500">req/s</span>' : ''}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(txnSeries, 'reqs', 'var(--violet)', txnBand)}</div>
          </div>
          <div class="sp2-card sp2-cc-chart-card" data-metric="proc-ms">
            <div class="sp2-cc-chart-head">
              <span class="lbl">Avg latency · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="Avg latency (เส้น) = sum(rate(_sum))/sum(rate(_count))×1000&#10;Max latency (band บาง) = max(http_server_requests_seconds_max)×1000&#10;&#10;Max = request ที่ช้าที่สุดใน scrape interval (Micrometer _max gauge) — จับ spike ที่ avg กลบไป&#10;&#10;สี: <500ms ok, 500-1000ms warn, >1000ms hot"></i></span>
              <span class="now ${procColor}">${fmtMs(app.procTimeMs)}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(msSeries, 'ms', '#f59e0b', msBand, _sloLines('latencyMs', { inventory: d.inventory }))}</div>
          </div>
        </div>`;
    },

    // ── Scrape-DOWN banner ─────────────────────────────────────────────
    // Prometheus `up{app_name=svc}=0` means the exporter endpoint is dead,
    // so NO app metric will populate below. Render a red strip explaining
    // this + the usual suspects; otherwise users think the tool is broken
    // when it's really the exporter that's broken.
    _scrapeDownBanner(d) {
      return `
        <div class="sp2-card" style="border:1px solid var(--hot,#ef4444);background:rgba(239,68,68,0.08);padding:12px 16px;margin:12px 0;display:flex;gap:12px;align-items:flex-start">
          <i data-icon="alert-triangle" style="color:var(--hot,#ef4444);flex:none;margin-top:2px"></i>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;color:var(--hot,#ef4444);margin-bottom:4px">
              Metrics exporter unreachable · <code style="font-size:12px">up{app_name="${d.service}"} = 0</code>
            </div>
            <div style="font-size:12px;color:var(--sp-text-soft);line-height:1.55">
              Prometheus can't scrape any pod of this service, so TPS / workers / latency panels below will be empty.
              Common causes: sidecar exporter crashed, TLS cert on <code>:18443</code> expired, network policy, or the
              app never exposed metrics. Container CPU / MEM / restarts still work because they come from kubelet, not the app.
            </div>
          </div>
        </div>`;
    },

    // ── PHP-FPM section ────────────────────────────────────────────────
    // Rendered for services whose metrics come from php-fpm_exporter (not
    // Micrometer). Shows: TPS (accepted_conn rate), workers busy %, listen
    // queue depth, max-children reached rate, slow-request rate — the
    // signals that predict/explain PHP-FPM pool exhaustion + restarts.
    _phpFpmSection(d) {
      const p = d.phpfpm || {};
      const winLbl = this.customStart
        ? fmtCustomRange(this.customStart, this.customEnd)
        : 'last ' + fmtWindow(this.windowMinutes);
      const fmtTxn  = (v) => v == null ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtPct  = (v) => v == null ? '—' : v.toFixed(0) + '%';
      const fmtRate = (v) => v == null ? '—' : (v >= 1 ? v.toFixed(2) : v.toFixed(3));
      const workersCls = p.workersBusyPct == null ? '' : p.workersBusyPct >= 90 ? 'hot' : p.workersBusyPct >= 70 ? 'warn' : '';
      const queueCls   = p.listenQueue    == null ? '' : p.listenQueue    >= 10 ? 'hot' : p.listenQueue    >= 1  ? 'warn' : '';
      const maxKidsCls = p.maxChildrenPerSec == null ? '' : p.maxChildrenPerSec > 0 ? 'hot' : '';
      const slowCls    = p.slowReqPerSec == null ? '' : p.slowReqPerSec > 0.1 ? 'warn' : '';
      const txnBand    = { max: d.series?.txnRateMax || [], min: d.series?.txnRateMin || [] };
      return `
        <div class="sp2-app-grid">
          <div class="sp2-card sp2-cc-chart-card" data-metric="phpfpm-tps">
            <div class="sp2-cc-chart-head">
              <span class="lbl">TPS (accepted conn) · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="PHP-FPM req/sec รวมทั้ง pool&#10;&#10;PromQL: sum(rate(phpfpm_accepted_conn{app_name=X,cluster=Y}[5m]))&#10;หรือ phpfpm_accepted_connections (exporter รุ่นเก่า)"></i></span>
              <span class="now">${fmtTxn(p.txnRate)}${p.txnRate != null ? ' <span style="font-size:12px;color:var(--sp-text-soft);font-weight:500">req/s</span>' : ''}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(d.series?.txnRate || [], 'reqs', 'var(--violet)', txnBand)}</div>
          </div>
          <div class="sp2-card sp2-cc-chart-card" data-metric="phpfpm-workers">
            <div class="sp2-cc-chart-head">
              <span class="lbl">Workers busy · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="% ของ worker ที่กำลังประมวลผล request&#10;&#10;PromQL: avg(phpfpm_active_processes / phpfpm_max_active_processes) * 100&#10;&#10;สี: <70% ok, 70-90% warn, ≥90% hot (ใกล้ตัน pool)"></i></span>
              <span class="now ${workersCls}">${fmtPct(p.workersBusyPct)}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(d.series?.phpfpmWorkersBusyPct || [], 'pct', '#f59e0b')}</div>
          </div>
          <div class="sp2-card sp2-cc-chart-card" data-metric="phpfpm-queue">
            <div class="sp2-cc-chart-head">
              <span class="lbl">Listen queue · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="จำนวน request ที่ค้างรอ worker ว่าง&#10;&#10;PromQL: max(phpfpm_listen_queue)&#10;&#10;>0 = pool ตัน (request รอ), ≥10 = อันตราย"></i></span>
              <span class="now ${queueCls}">${p.listenQueue == null ? '—' : p.listenQueue}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(d.series?.phpfpmListenQueue || [], 'queue', 'var(--hot)')}</div>
          </div>
          <div class="sp2-card" style="padding:16px">
            <div style="display:flex;flex-direction:column;gap:14px">
              <div>
                <div style="font-size:11px;color:var(--sp-text-soft);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Pool</div>
                <div style="font-size:15px;font-weight:600">${p.active ?? '—'} active / ${p.idle ?? '—'} idle</div>
                <div style="font-size:11px;color:var(--sp-text-soft)">peak this window: ${p.maxActive ?? '—'}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--sp-text-soft);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Max children reached</div>
                <div style="font-size:15px;font-weight:600" class="${maxKidsCls}">${fmtRate(p.maxChildrenPerSec)} /s</div>
                <div style="font-size:11px;color:var(--sp-text-soft)">FPM ปฏิเสธ request เพราะ worker หมด — >0 = pool เล็กเกินไป</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--sp-text-soft);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Slow requests</div>
                <div style="font-size:15px;font-weight:600" class="${slowCls}">${fmtRate(p.slowReqPerSec)} /s</div>
                <div style="font-size:11px;color:var(--sp-text-soft)">request ที่ช้ากว่า request_slowlog_timeout</div>
              </div>
              ${p.scrapeUp != null ? `
              <div>
                <div style="font-size:11px;color:var(--sp-text-soft);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Scrape health</div>
                <div style="font-size:15px;font-weight:600;color:${p.scrapeUp ? 'var(--ok)' : 'var(--hot)'}">${p.scrapeUp ? 'up' : 'DOWN'}</div>
              </div>` : ''}
            </div>
          </div>
        </div>`;
    },

    // ── Network fallback section ───────────────────────────────────────
    // Rendered when the primary TPS metric is unavailable (Spring/PHP-FPM
    // exporter down or not exposed). Shows pod-level packets/bytes per sec
    // from cadvisor — ALWAYS works because it's kubelet-side, not app-side.
    // Not a true TPS (1 request = many packets), but the spike/drop pattern
    // tracks request volume tightly enough to answer "is traffic reaching
    // this workload?" and spot bursts that correlate with restarts.
    _networkFallbackSection(d) {
      const n = d.network || {};
      const winLbl = this.customStart
        ? fmtCustomRange(this.customStart, this.customEnd)
        : 'last ' + fmtWindow(this.windowMinutes);
      const fmtPps = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(1) + 'k' : Math.round(v).toString());
      const fmtBps = (v) => {
        if (v == null) return '—';
        if (v >= 1024*1024) return (v/1024/1024).toFixed(1) + ' MB/s';
        if (v >= 1024)      return (v/1024).toFixed(1) + ' KB/s';
        return Math.round(v) + ' B/s';
      };
      return `
        <div class="sp2-card" style="border:1px solid var(--warn,#f59e0b);background:rgba(245,158,11,0.06);padding:12px 16px;margin:12px 0 4px 0;display:flex;gap:12px;align-items:flex-start">
          <i data-icon="info" style="color:var(--warn,#f59e0b);flex:none;margin-top:2px"></i>
          <div style="flex:1;min-width:0;font-size:12px;color:var(--sp-text-soft);line-height:1.55">
            <strong style="color:var(--text)">Fallback view</strong> — แสดง network throughput (packets/bytes per sec) จาก kubelet cadvisor
            เนื่องจาก app exporter ไม่ตอบสนอง ตัวเลขนี้ไม่ใช่ TPS แท้ (1 request = หลาย packet)
            แต่ pattern พีค/ลด สะท้อน request volume ใช้เช็คว่า "traffic ยังเข้าอยู่มั้ย" และเทียบเวลากับ restart ได้
          </div>
        </div>
        <div class="sp2-app-grid">
          <div class="sp2-card sp2-cc-chart-card" data-metric="net-rx-pkts">
            <div class="sp2-cc-chart-head">
              <span class="lbl">Packets IN · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="Rate of network packets received by every pod of this service (cadvisor).&#10;&#10;PromQL: sum(rate(container_network_receive_packets_total{pod=~svc.*}[5m]))&#10;&#10;Proxy for TPS — spike/drop pattern tracks request volume."></i></span>
              <span class="now">${fmtPps(n.rxPacketsPerSec)}${n.rxPacketsPerSec != null ? ' <span style="font-size:12px;color:var(--sp-text-soft);font-weight:500">pps</span>' : ''}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(d.series?.netRxPkts || [], 'pps', 'var(--violet)')}</div>
          </div>
          <div class="sp2-card sp2-cc-chart-card" data-metric="net-tx-pkts">
            <div class="sp2-cc-chart-head">
              <span class="lbl">Packets OUT · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="Rate of network packets sent by every pod of this service.&#10;&#10;PromQL: sum(rate(container_network_transmit_packets_total{pod=~svc.*}[5m]))"></i></span>
              <span class="now">${fmtPps(n.txPacketsPerSec)}${n.txPacketsPerSec != null ? ' <span style="font-size:12px;color:var(--sp-text-soft);font-weight:500">pps</span>' : ''}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(d.series?.netTxPkts || [], 'pps', '#22d3ee')}</div>
          </div>
          <div class="sp2-card sp2-cc-chart-card" data-metric="net-rx-bytes">
            <div class="sp2-cc-chart-head">
              <span class="lbl">Bytes IN · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="PromQL: sum(rate(container_network_receive_bytes_total{pod=~svc.*}[5m]))"></i></span>
              <span class="now">${fmtBps(n.rxBytesPerSec)}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(d.series?.netRxBytes || [], 'bytes', 'var(--emerald)')}</div>
          </div>
          <div class="sp2-card sp2-cc-chart-card" data-metric="net-tx-bytes">
            <div class="sp2-cc-chart-head">
              <span class="lbl">Bytes OUT · ${winLbl}<i class="sp2-help-icon" data-icon="help-circle" title="PromQL: sum(rate(container_network_transmit_bytes_total{pod=~svc.*}[5m]))"></i></span>
              <span class="now">${fmtBps(n.txBytesPerSec)}</span>
            </div>
            <div class="sp2-cc-chart-body">${areaChart(d.series?.netTxBytes || [], 'bytes', '#f59e0b')}</div>
          </div>
        </div>`;
    },

    // ── Dependencies section (Datadog-style upstream → svc → downstream) ────
    // Renders three columns:
    //   • Left  — services that call THIS service (from d.app.upstream)
    //   • Center — the current service (highlighted)
    //   • Right — services / infra THIS service calls (from d.app.downstream)
    // Groups >4 same-protocol nodes into a single "N X Services" pill to keep
    // the layout compact (mirrors Datadog when a hub service fans out widely).
    // Curves between columns are drawn by _paintDepsGraph() after layout so
    // the paths track exact node positions even when counts differ per side.
    _dependencySection(d) {
      // Dependency numbers come from `rate(..._count[5m])` — always a 5-min
      // rolling average regardless of the range picker (that's a per-metric
      // avg / per-Grafana convention). Show that explicitly so users don't
      // wonder why the numbers don't change when they pick "6h".
      const winLbl = '5 min avg';
      const upstream   = d.app?.upstream   || [];
      const downstream = d.app?.downstream || [];

      // Map current SP inventory to know which node names we can navigate to.
      // Anything not in the inventory renders as a static (non-clickable) card.
      const knownServices = new Set((SP.suggestions || []).map(s => (s.service || '').toLowerCase()));
      const isKnown = (name) => knownServices.has(String(name || '').toLowerCase());

      const fmtReq = (v) => v == null ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtMs  = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(1) + 's' : v.toFixed(0) + 'ms');
      const errCls = (pct) => pct == null ? '' : pct >= 5 ? 'hot' : pct >= 1 ? 'warn' : '';
      const nodeCls = (row) => {
        const e = row.errorPct != null ? errCls(row.errorPct) : '';
        return e ? ' ' + e : '';
      };

      // Downstream: group by protocol, then collapse http groups >4 nodes.
      // Kept per-protocol so we still show 1 stack per transport (redis pile,
      // mongo pile, http pile) rather than one super-list.
      const dsByProto = {};
      for (const row of downstream) {
        const p = row.protocol || 'http';
        (dsByProto[p] = dsByProto[p] || []).push(row);
      }

      // Build one HTML card per downstream group entry. `serviceName` may be
      // empty for infra (redis/mongo/rabbit) — we then fall back to hostname.
      const dsGroupToNodes = (proto, rows) => {
        // For raw http, sort by rate desc and collapse tail into a grouped pill.
        rows.sort((a, b) => (b.rateTotal || 0) - (a.rateTotal || 0));
        const nodes = [];
        // Only http collapses — infra usually has 1 node per host (redis-01/02
        // are distinct addresses but semantically the same "cluster").
        const COLLAPSE_AT = proto === 'http' ? 4 : 8;
        const primary = rows.slice(0, COLLAPSE_AT);
        const rest    = rows.slice(COLLAPSE_AT);
        for (const row of primary) nodes.push(this._depNode(row, proto, {
          side: 'right',
          serviceName: row.targetService || _depsFallbackName(row.target),
          navName:     row.targetService || null,
          isKnown,
          fmtReq, fmtMs,
        }));
        if (rest.length) {
          const sumRate = rest.reduce((a, r) => a + (r.rateTotal || 0), 0);
          nodes.push(`
            <div class="sp2-deps-node grouped clickable"
                 data-dep-side="right" data-dep-proto="${proto}"
                 onclick="SP.openDrill('group', '', '${proto}')"
                 title="Click to see all ${rest.length} ${proto} services">
              <div class="row1">
                <span class="ico"><i data-icon="package"></i></span>
                <span class="name">${rest.length} ${proto === 'http' ? 'HTTP Services' : (proto + ' hosts')}</span>
              </div>
              <div class="row2">
                <span class="req">${fmtReq(sumRate)}<span style="color:var(--sp-text-soft);font-weight:400"> req/s total</span></span>
              </div>
            </div>`);
        }
        return nodes.join('');
      };

      // Protocol render order — infra first, generic http last so it doesn't
      // dominate visually.
      const PROTO_ORDER = ['redis','mongo','rabbitmq','kafka','mysql','postgres','oracle','sql','search','http'];
      let downstreamHtml = '';
      for (const p of PROTO_ORDER) {
        if (!dsByProto[p]?.length) continue;
        downstreamHtml += dsGroupToNodes(p, dsByProto[p]);
      }
      // Any protocol we didn't enumerate (defensive)
      for (const [p, rows] of Object.entries(dsByProto)) {
        if (PROTO_ORDER.includes(p)) continue;
        downstreamHtml += dsGroupToNodes(p, rows);
      }
      if (!downstreamHtml) downstreamHtml = `<div class="sp2-deps-empty">no downstream calls detected</div>`;

      // Upstream: single "http" group (Micrometer HTTP client), sorted by rate.
      const upSorted = upstream.slice().sort((a, b) => (b.rateTotal || 0) - (a.rateTotal || 0));
      const UP_COLLAPSE_AT = 6;
      const upPrimary = upSorted.slice(0, UP_COLLAPSE_AT);
      const upRest    = upSorted.slice(UP_COLLAPSE_AT);
      let upstreamHtml = upPrimary.map(row => this._depNode(row, 'http', {
        side: 'left',
        serviceName: row.service,
        navName:     row.service,
        isKnown,
        fmtReq, fmtMs,
      })).join('');
      if (upRest.length) {
        const sumRate = upRest.reduce((a, r) => a + (r.rateTotal || 0), 0);
        upstreamHtml += `
          <div class="sp2-deps-node grouped clickable"
               data-dep-side="left" data-dep-proto="http"
               onclick="SP.openDrill('group-upstream', '', 'http')"
               title="Click to see all ${upRest.length} additional callers">
            <div class="row1">
              <span class="ico"><i data-icon="package"></i></span>
              <span class="name">${upRest.length} more callers</span>
            </div>
            <div class="row2">
              <span class="req">${fmtReq(sumRate)}<span style="color:var(--sp-text-soft);font-weight:400"> req/s total</span></span>
            </div>
          </div>`;
      }
      if (!upstreamHtml) upstreamHtml = `<div class="sp2-deps-empty">no upstream callers detected</div>`;

      // Center card totals — sum across each side.
      const totalIn  = upstream.reduce((a, r)   => a + (r.rateTotal || 0), 0);
      const totalOut = downstream.reduce((a, r) => a + (r.rateTotal || 0), 0);

      // Circuit breakers card — right below Dependencies since breakers guard
      // the downstream edges the dep graph shows. Only rendered when the
      // service actually declares Resilience4j beans. Two view modes:
      // "List" (compact table, all breakers at once) and "Chart" (state timeline
      // per breaker + failure rate + call rate lines). Time-range comes from
      // the top range picker — since this card renders inside the detail
      // response, a range change refetches it automatically.
      const cb = d.app?.circuitBreakers;
      const cbCard = (cb && cb.total > 0) ? this._circuitBreakerCard(cb) : '';

      return `
        <div class="sp2-card sp2-deps-card">
          <div class="sp2-card-head">
            <div class="sp2-card-title">
              Dependencies <span style="color:var(--sp-text-soft);font-weight:400;font-size:11px">· ${winLbl}</span>
              <i class="sp2-help-icon" data-icon="help-circle" title="แสดงว่ามี service ไหนเรียก ${esc(d.service)} (ซ้าย) และ ${esc(d.service)} เรียกใครบ้าง (ขวา)&#10;&#10;ข้อมูลมาจาก Micrometer http_client_requests_seconds_count — เห็นเฉพาะ traffic HTTP ที่ผ่าน RestTemplate/WebClient/SCG&#10;&#10;infra (redis/mongo/rabbit) แยกด้วย protocol tag; group เมื่อมี >4 nodes&#10;&#10;คลิกที่ node ชื่อ service เพื่อ jump ไปดู detail"></i>
            </div>
            <div style="margin-left:auto;font-size:11px;color:var(--sp-text-soft)">
              ${upstream.length} caller${upstream.length !== 1 ? 's' : ''} ·
              ${downstream.length} callee${downstream.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div class="sp2-deps-body" id="sp2-deps-body">
            <svg class="sp2-deps-svg" id="sp2-deps-svg" preserveAspectRatio="xMinYMin meet"></svg>
            <div class="sp2-deps-col left">
              <div class="sp2-deps-collbl">CALLED BY (${upstream.length})</div>
              ${upstreamHtml}
            </div>
            <div class="sp2-deps-col center">
              <div class="sp2-deps-center-card">
                <div class="sp2-deps-center-name">${esc(d.service)}</div>
                <div class="sp2-deps-center-stat">
                  <span>incoming: <b>${fmtReq(totalIn)}</b> req/s</span>
                  <span>outgoing: <b>${fmtReq(totalOut)}</b> req/s</span>
                </div>
              </div>
            </div>
            <div class="sp2-deps-col right">
              <div class="sp2-deps-collbl">CALLS (${downstream.length})</div>
              ${downstreamHtml}
            </div>
          </div>
        </div>
        ${cbCard}`;
    },

    // ── Circuit breakers card (List + Chart modes) ────────────────────
    // Toggle in the header flips between the compact table (default) and a
    // chart view: state timeline (Gantt bars per breaker over the window) +
    // failure/slow rate lines + call rate lines. Time filtering rides on the
    // top range picker — series data lives inside app.circuitBreakers.items[].series.
    _circuitBreakerCard(cb) {
      const stateColor = (st) => (st === 'open' || st === 'forced_open') ? 'var(--hot)'
                              : st === 'half_open' ? 'var(--warn)'
                              : st === 'closed'    ? 'var(--ok)'
                              : 'var(--sp-text-soft)';
      const stateLbl = { closed: 'CLOSED', open: 'OPEN', half_open: 'HALF-OPEN', forced_open: 'FORCED', disabled: 'DISABLED', metrics_only: 'METRICS' };
      const fmtR = (v) => v == null || v === 0 ? '—' : (v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtP = (v) => v == null ? '—' : v.toFixed(1) + '%';
      const rows = cb.items.map(b => {
        const col = stateColor(b.state);
        const failCls = (b.failRate || 0) >= 50 ? 'hot' : (b.failRate || 0) >= 10 ? 'warn' : '';
        const blockedCls = (b.callsBlocked || 0) > 0 ? 'hot' : '';
        return `
          <tr>
            <td class="mono" style="font-size:11.5px">${esc(b.name)}</td>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:color-mix(in srgb,${col} 15%,transparent);color:${col};font-size:10.5px;font-weight:600;letter-spacing:.02em">${stateLbl[b.state] || b.state.toUpperCase()}</span></td>
            <td class="right ${failCls}">${fmtP(b.failRate)}</td>
            <td class="right">${fmtP(b.slowRate)}</td>
            <td class="right mono" style="color:var(--ok)">${fmtR(b.callsOk)}</td>
            <td class="right mono" style="color:var(--hot)">${fmtR(b.callsFail)}</td>
            <td class="right mono ${blockedCls}">${fmtR(b.callsBlocked)}</td>
          </tr>`;
      }).join('');

      // Chart view: state timeline (Gantt) + 2 charts (failure/slow rate + call rate)
      const chartBlocks = cb.items.map(b => this._cbBreakerChartRow(b, stateColor, stateLbl)).join('');
      const chartView = `
        <div class="sp2-cb-chart-view" style="padding:8px 4px;display:none">
          <div style="font-size:11px;color:var(--sp-text-soft);margin-bottom:8px;line-height:1.5">
            <b style="color:var(--text)">State timeline</b> = Gantt bar สีตาม state ที่ active ณ เวลานั้น (แดง = open · เหลือง = half_open · เขียว = closed) ·
            <b>Failure/Slow %</b> = sliding-window ตอนนั้น · <b>Calls</b> = อัตราต่อวินาที (rolling 5m)
          </div>
          ${chartBlocks || '<div style="padding:20px;text-align:center;color:var(--sp-text-soft)">ไม่มีข้อมูล time-series</div>'}
        </div>`;
      const listView = `
        <div class="sp2-cb-list-view" style="padding:6px 4px">
          <table class="sp2-ep-tbl">
            <thead><tr><th>Breaker</th><th>State</th><th class="right">Fail %</th><th class="right">Slow %</th><th class="right">OK /s</th><th class="right">Fail /s</th><th class="right">Blocked /s</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

      return `
        <div class="sp2-card sp2-cb-card" data-cb-view="list" style="margin-top:12px">
          <div class="sp2-card-head">
            <div class="sp2-card-title">
              Circuit breakers <span style="color:var(--sp-text-soft);font-weight:400;font-size:11px">· ${cb.total} bean${cb.total !== 1 ? 's' : ''}</span>
              <i class="sp2-help-icon" data-icon="help-circle" title="Resilience4j circuit breakers — downstream guards&#10;&#10;• Fail % / Slow % จาก sliding window (config ต่อ bean)&#10;• Successful/Failed/Blocked = req/sec ใน 5m rolling&#10;• Blocked >0 = breaker OPEN, request โดน fail-fast ทันที (ไม่ยิง downstream)&#10;&#10;List = สแนปช็อตปัจจุบัน · Chart = timeline ตาม range picker ด้านบน&#10;&#10;ถ้า state = OPEN → ดู Dependencies ด้านบนหา downstream ที่ตาย&#10;ถ้า Slow % สูงแต่ยัง CLOSED → downstream ช้าแต่ยังไม่ trip (config threshold อาจกว้างไป)"></i>
            </div>
            <div style="margin-left:auto;display:flex;gap:12px;align-items:center">
              <div style="font-size:11px">
                ${cb.open > 0 ? `<span style="color:var(--hot);font-weight:600">${cb.open} OPEN</span>` : ''}
                ${cb.halfOpen > 0 ? `<span style="color:var(--warn);font-weight:600;margin-left:8px">${cb.halfOpen} HALF-OPEN</span>` : ''}
                ${cb.open === 0 && cb.halfOpen === 0 ? `<span style="color:var(--ok);font-weight:600">all closed</span>` : ''}
              </div>
              <div class="sp2-cb-toggle" role="tablist" style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;font-size:11px">
                <button type="button" class="sp2-cb-toggle-btn on" data-cb-view="list" onclick="SP.setCbView(this,'list')" style="padding:4px 10px;background:var(--bg-card);color:var(--text);border:0;cursor:pointer;font-weight:500">List</button>
                <button type="button" class="sp2-cb-toggle-btn" data-cb-view="chart" onclick="SP.setCbView(this,'chart')" style="padding:4px 10px;background:transparent;color:var(--sp-text-soft);border:0;border-left:1px solid var(--border);cursor:pointer;font-weight:500">Chart</button>
              </div>
            </div>
          </div>
          ${listView}
          ${chartView}
        </div>`;
    },

    // One horizontal row per breaker in the Chart view. Layout:
    //   • Left column: name + current state badge
    //   • Right column: state timeline SVG (thin Gantt bar) + 2 mini charts
    // Timeline uses window bounds (start/end) from d.series to keep x-axis
    // aligned with the other charts on the page.
    _cbBreakerChartRow(b, stateColor, stateLbl) {
      const s = b.series || {};
      const col = stateColor(b.state);
      const timelineSvg = this._cbStateTimelineSvg(s.stateTimeline || [], stateColor);
      const areaFail = areaChart(s.failRate || [], 'reqs', 'var(--hot)');
      const areaSlow = areaChart(s.slowRate || [], 'reqs', 'var(--warn)');
      const areaOk   = areaChart(s.callsOk   || [], 'reqs', 'var(--ok)');
      const areaFailC= areaChart(s.callsFail || [], 'reqs', 'var(--hot)');
      const areaBlk  = areaChart(s.callsBlocked || [], 'reqs', 'var(--sp-text-soft)');
      return `
        <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px;background:color-mix(in srgb,${col} 4%,transparent)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span class="mono" style="font-size:12px;font-weight:600">${esc(b.name)}</span>
            <span style="display:inline-block;padding:2px 8px;border-radius:10px;background:color-mix(in srgb,${col} 15%,transparent);color:${col};font-size:10px;font-weight:600;letter-spacing:.02em">${stateLbl[b.state] || b.state.toUpperCase()}</span>
            <span style="margin-left:auto;font-size:10.5px;color:var(--sp-text-soft)">
              Fail ${b.failRate == null ? '—' : b.failRate.toFixed(1) + '%'} ·
              Slow ${b.slowRate == null ? '—' : b.slowRate.toFixed(1) + '%'} ·
              OK ${b.callsOk.toFixed(2)}/s · Fail ${b.callsFail.toFixed(2)}/s · Blocked ${b.callsBlocked.toFixed(2)}/s
            </span>
          </div>
          <div style="font-size:10px;color:var(--sp-text-soft);margin-bottom:2px">State timeline</div>
          ${timelineSvg}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
            <div>
              <div style="font-size:10px;color:var(--sp-text-soft);margin-bottom:2px">Failure rate (%) <span style="color:var(--hot)">■</span> · Slow rate <span style="color:var(--warn)">■</span></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <div>${areaFail}</div>
                <div>${areaSlow}</div>
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--sp-text-soft);margin-bottom:2px">Calls (req/s) — OK <span style="color:var(--ok)">■</span> · Fail <span style="color:var(--hot)">■</span> · Blocked <span style="color:var(--sp-text-soft)">■</span></div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
                <div>${areaOk}</div>
                <div>${areaFailC}</div>
                <div>${areaBlk}</div>
              </div>
            </div>
          </div>
        </div>`;
    },

    // State timeline as an inline horizontal SVG bar. Each timestamp gets a
    // colored segment based on the active state at that sample. Gap detection:
    // if two adjacent samples are >2 steps apart, we render a gray "no data"
    // gap between them so a scrape outage doesn't appear as a continuous state.
    _cbStateTimelineSvg(pts, stateColor) {
      if (!pts || pts.length < 2) {
        return `<div style="height:22px;display:flex;align-items:center;justify-content:center;font-size:10.5px;color:var(--sp-text-soft);background:color-mix(in srgb,var(--sp-text-soft) 8%,transparent);border-radius:4px">no state samples in window</div>`;
      }
      const H = 22;
      const t0 = pts[0][0];
      const tN = pts[pts.length - 1][0];
      const span = Math.max(1, tN - t0);
      // Median step to detect gaps (scrape drops)
      const steps = [];
      for (let i = 1; i < pts.length; i++) steps.push(pts[i][0] - pts[i-1][0]);
      steps.sort((a, b) => a - b);
      const median = steps[Math.floor(steps.length / 2)] || 30;
      const gapThresh = median * 2.5;
      const rects = [];
      for (let i = 0; i < pts.length; i++) {
        const [t, st] = pts[i];
        const nextT = i < pts.length - 1 ? pts[i+1][0] : t + median;
        const isGap = (nextT - t) > gapThresh;
        const endT  = isGap ? t + median : nextT;
        const x  = ((t    - t0) / span) * 100;
        const w  = ((endT - t)  / span) * 100;
        const c  = stateColor(st);
        rects.push(`<rect x="${x.toFixed(3)}%" y="0" width="${w.toFixed(3)}%" height="${H}" fill="${c}"><title>${new Date(t*1000).toLocaleTimeString()} — ${st}</title></rect>`);
        if (isGap) {
          const gx = ((t + median - t0) / span) * 100;
          const gw = ((nextT - t - median) / span) * 100;
          rects.push(`<rect x="${gx.toFixed(3)}%" y="0" width="${gw.toFixed(3)}%" height="${H}" fill="color-mix(in srgb,var(--sp-text-soft) 20%,transparent)"><title>no data</title></rect>`);
        }
      }
      const fmt = (u) => new Date(u*1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div style="position:relative">
          <svg width="100%" height="${H}" style="display:block;border-radius:4px;overflow:hidden">${rects.join('')}</svg>
          <div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--sp-text-soft);margin-top:2px">
            <span>${fmt(t0)}</span><span>${fmt(tN)}</span>
          </div>
        </div>`;
    },

    // Toggle handler wired from the CB card header buttons.
    setCbView(btn, view) {
      const card = btn.closest('.sp2-cb-card');
      if (!card) return;
      card.dataset.cbView = view;
      card.querySelectorAll('.sp2-cb-toggle-btn').forEach(el => {
        const on = el.dataset.cbView === view;
        el.classList.toggle('on', on);
        el.style.background = on ? 'var(--bg-card)' : 'transparent';
        el.style.color      = on ? 'var(--text)'    : 'var(--sp-text-soft)';
      });
      const list  = card.querySelector('.sp2-cb-list-view');
      const chart = card.querySelector('.sp2-cb-chart-view');
      if (list)  list.style.display  = view === 'list'  ? '' : 'none';
      if (chart) chart.style.display = view === 'chart' ? '' : 'none';
      // Charts painted on demand — force redraw when switching to chart mode
      // since hidden SVGs had 0 width and skipped their first paint pass.
      if (view === 'chart' && typeof paintCharts === 'function') {
        // Clear the cached paint dims so paintCharts() re-renders at real width
        card.querySelectorAll('.sp2-chart-slot').forEach(s => {
          delete s.dataset.paintedW;
          delete s.dataset.paintedH;
        });
        requestAnimationFrame(() => paintCharts());
      }
    },

    // Build one node card. Shared between upstream + downstream sides — same
    // fields (rate + error% + latency), only side-specific label differs.
    // Click behaviour: opens the drill-down side panel with URI-level detail
    // for THIS edge. The panel has its own "Open service →" button for full
    // navigation, so a plain click never navigates immediately.
    _depNode(row, proto, opts) {
      const { side, serviceName, navName, isKnown, fmtReq, fmtMs } = opts;
      const drillTarget = navName || serviceName || row.target || '';
      // Only enable drill when we have a concrete target name to feed the API
      // regex — infra hosts like "cache-mas.truemoney.com" pass through as
      // fallback (won't match app_name-scoped queries but at least won't
      // silently do nothing on click).
      const clickable = !!drillTarget;
      const errPct = row.errorPct;
      const errCls = errPct == null || errPct === 0 ? '' : errPct >= 5 ? 'hot' : errPct >= 1 ? 'warn' : '';
      const borderCls = errCls;
      // side="left"  = upstream node → drill kind=upstream, caller=this node, target=current service
      // side="right" = downstream node → drill kind=downstream, caller=current service, target=this node
      const clickAttr = clickable
        ? `role="button" tabindex="0" onclick="SP.openDrill('${side === 'left' ? 'upstream' : 'downstream'}', ${JSON.stringify(drillTarget).replace(/"/g,'&quot;')}, ${JSON.stringify(proto).replace(/"/g,'&quot;')})"`
        : '';
      const iconMap = {
        redis:'database', mongo:'database', mysql:'database', postgres:'database', oracle:'database', sql:'database',
        rabbitmq:'inbox', kafka:'inbox', search:'search',
        http:'globe',
      };
      const icon = iconMap[proto] || 'globe';
      return `
        <div class="sp2-deps-node ${clickable ? 'clickable' : ''} ${borderCls}"
             data-dep-side="${side}" data-dep-proto="${proto}" ${clickAttr}
             title="${clickable ? 'Click for URI-level drill-down' : esc(serviceName || row.target || '')}">
          <div class="row1">
            <span class="ico"><i data-icon="${icon}"></i></span>
            <span class="name">${esc(serviceName || row.target || '(unknown)')}</span>
            <span class="sp2-deps-proto ${proto}">${proto}</span>
          </div>
          <div class="row2">
            <span class="req">${fmtReq(row.rateTotal)}<span style="color:var(--sp-text-soft);font-weight:400"> r/s</span></span>
            ${row.errorPct != null && row.errorPct > 0 ? `<span class="err ${errCls}">${row.errorPct.toFixed(2)}% err</span>` : ''}
            ${row.latencyMs != null ? `<span class="lat">${fmtMs(row.latencyMs)}</span>` : ''}
          </div>
        </div>`;
    },

    // Full-navigate to a service's detail (used by the drill panel's
    // "Open service →" button, or programmatically). Uses SP.select() so
    // input + dropdown state stay in sync.
    navToDep(name) {
      if (!name) return;
      const sugg = (this.suggestions || []).find(s => (s.service || '').toLowerCase() === String(name).toLowerCase());
      if (sugg) this.select(sugg);
      else this.loadDetail(name);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // ── In-page drill navigation ─────────────────────────────────────
    // No slide panel — clicking a node HIDES the main detail area and
    // renders the drill inline where the detail used to be. Multi-level
    // stack: analysis → group → service is a natural back-back navigation.
    //   kind='downstream'     → caller = current service, target = node
    //   kind='upstream'       → caller = node,           target = current
    //   kind='group'          → grouped-downstream list (proto = protocol)
    //   kind='group-upstream' → grouped-upstream list
    _navStack: [],

    async openDrill(kind, target, proto) {
      const current = this.currentService;
      if (!current) return;
      const caller = (kind === 'upstream') ? target : current;
      const tgt    = (kind === 'upstream') ? current : target;
      // Push CURRENT view onto stack before we replace it. The stack stores
      // enough state to re-open the previous drill from scratch (or restore
      // the main analysis view when back reaches the bottom).
      const currentState = this._drillState
        ? { ...this._drillState, scrollY: window.scrollY }
        : { kind: 'analysis', scrollY: window.scrollY };
      this._navStack.push(currentState);
      this._drillState = { kind, caller, target: tgt, proto };

      // Hide main detail, show drill container.
      $('sp2-detail').style.display = 'none';
      const drill = $('sp2-drill');
      drill.classList.remove('back');
      drill.classList.add('on');
      this._showDrillShell(kind, caller, tgt, proto);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      if (kind === 'group') {
        this._renderDrillGroup(proto, 'downstream');
        return;
      }
      if (kind === 'group-upstream') {
        this._renderDrillGroup(proto, 'upstream');
        return;
      }
      if (typeof API?.servicePerformance?.depDrill !== 'function') {
        $('sp2-drill-body').innerHTML = `<div class="sp2-drill-card sp2-drill-error">
          Browser ยัง cache <code>api.js</code> ตัวเก่าที่ยังไม่มี drill endpoint.<br><br>
          กด <b>Cmd+Shift+R</b> (Mac) หรือ <b>Ctrl+F5</b> (Windows) เพื่อ force reload
        </div>`;
        return;
      }
      $('sp2-drill-body').innerHTML = `<div class="sp2-drill-card">
        <div class="sp2-skel" style="height:80px;margin-bottom:10px"></div>
        <div class="sp2-skel" style="height:22px;margin-bottom:6px"></div>
        <div class="sp2-skel" style="height:22px;margin-bottom:6px"></div>
        <div class="sp2-skel" style="height:22px"></div>
      </div>`;
      try {
        const res = await API.servicePerformance.depDrill(kind, caller, tgt);
        // Race guard.
        if (!this._drillState || this._drillState.kind !== kind
            || this._drillState.caller !== caller || this._drillState.target !== tgt) return;
        if (!res?.ok || !res?.data?.data) throw new Error(res?.data?.message || 'load failed');
        this._renderDrillRows(res.data.data);
      } catch (e) {
        $('sp2-drill-body').innerHTML = `<div class="sp2-drill-card sp2-drill-error">
          โหลดไม่สำเร็จ · ${esc(e.message || e)}
        </div>`;
      }
    },

    // Pop one nav level. Bottom of stack → restore main analysis view.
    navBack() {
      const prev = this._navStack.pop();
      const drill = $('sp2-drill');
      if (!prev || prev.kind === 'analysis') {
        // Back to main service detail.
        drill.classList.remove('on');
        this._drillState = null;
        $('sp2-detail').style.display = '';
        window.scrollTo({ top: (prev && prev.scrollY) || 0, behavior: 'auto' });
        return;
      }
      // Otherwise re-open the previous drill (fetches fresh — cheap since
      // the backend caches). Don't push again since we're popping.
      this._drillState = null;
      this._navStack.push({ kind: 'analysis', scrollY: (this._navStack[0]?.scrollY) || 0 });
      drill.classList.add('back');
      setTimeout(() => drill.classList.remove('back'), 300);
      // Recompute the "target" the openDrill signature expects (it converts
      // upstream vs downstream internally).
      const t = (prev.kind === 'upstream') ? prev.caller : prev.target;
      // openDrill would push another entry; pop it after the call so stack
      // depth stays correct.
      this.openDrill(prev.kind, t, prev.proto).then(() => {
        this._navStack.pop();  // remove the extra push
      });
    },

    // Backwards-compat alias — old code paths call closeDrill(); redirect
    // to navBack so the ESC keyboard shortcut still works.
    closeDrill() { this.navBack(); },

    // ── Metrics documentation modal ─────────────────────────────────
    // Full-viewport dialog listing every UI section on this page with the
    // exact PromQL, source metric, and datasource. Values here mirror the
    // queries in detail.php / dep-drill.php — update BOTH when queries change.
    openDocs() {
      const body = $('sp2-docs-body');
      if (!body._rendered) {
        body.innerHTML = this._buildDocsHtml();
        body._rendered = true;
      }
      $('sp2-docs').classList.add('on');
      document.body.style.overflow = 'hidden';
    },
    closeDocs() {
      $('sp2-docs').classList.remove('on');
      document.body.style.overflow = '';
    },

    // ── Chart expand modal ────────────────────────────────────────────
    // Grafana-style "View panel" — reads the clicked slot's data + config,
    // opens the modal with a full-width re-render plus min/max/avg/latest
    // stats and a scrollable data table. Works for both `area` (single
    // series) and `multi` (per-pod) slots. All data comes from the DOM
    // dataset the paintCharts() pipeline already set — no extra fetch.
    expandChart(slotEl) {
      if (!slotEl) return;
      const kind  = slotEl.dataset.chart || 'area';
      const unitTag = slotEl.dataset.unit || 'cores';
      const color   = slotEl.dataset.color || 'var(--cool)';
      // Best-effort title: walk up to the nearest card and grab its title.
      let title = 'Chart';
      const card = slotEl.closest('.sp2-cc-chart-card, .sp2-sub-chart-card, .sp2-card, .sp2-perpod-card');
      if (card) {
        const t = card.querySelector('.sp2-cc-chart-head .lbl, .sp2-sub-chart-title span, .sp2-card-title, .sp2-perpod-head .lbl');
        if (t) title = (t.textContent || '').trim();
      }

      // Build stats + table according to kind.
      let statsHtml = '';
      let tableHtml = '';
      let slotAttrs = '';
      let series = [];   // used only for CSV export

      const fmtByTag = {
        cores: (v) => (typeof v === 'number' ? v.toFixed(v >= 1 ? 2 : 3) : v),
        bytes: (v) => (typeof v === 'number' ? fmtBytes(v) : v),
        reqs:  (v) => (typeof v === 'number' ? (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) : v),
        ms:    (v) => (typeof v === 'number' ? (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms') : v),
      };
      const fmt = fmtByTag[unitTag] || fmtByTag.cores;
      const dtFmt = (ts) => {
        const d = new Date(ts * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };

      if (kind === 'multi') {
        // Per-pod: one column per pod + a synthesised "time" column
        const multi = JSON.parse(slotEl.dataset.series);
        series = multi;
        slotAttrs = `data-chart="multi" data-series='${slotEl.dataset.series.replace(/'/g, '&#39;')}' data-unit="${unitTag}"`;
        // Stats: per-pod min/max/avg over the window
        const podStats = multi.map(s => {
          const vals = (s.values || []).map(p => +p[1]).filter(v => isFinite(v));
          if (!vals.length) return { pod: s.pod, min: null, max: null, avg: null, last: null };
          const min = Math.min(...vals), max = Math.max(...vals);
          const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
          return { pod: s.pod, min, max, avg, last: vals[vals.length-1] };
        });
        statsHtml = `
          <div class="sp2-cx-stats">
            <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">Series</div><div class="sp2-cx-stat-val">${multi.length}</div></div>
            <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">Samples/series</div><div class="sp2-cx-stat-val">${multi[0]?.values?.length || 0}</div></div>
            <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">Range max</div><div class="sp2-cx-stat-val">${podStats.length ? fmt(Math.max(...podStats.map(p => p.max || 0))) : '—'}</div></div>
            <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">Range min</div><div class="sp2-cx-stat-val">${podStats.length ? fmt(Math.min(...podStats.filter(p=>p.min!=null).map(p => p.min))) : '—'}</div></div>
          </div>`;
        // Per-pod summary table (compact — one row per pod)
        tableHtml = `
          <div class="sp2-cx-tbl-toolbar">
            <span>Per-series summary · ${multi.length} pod${multi.length !== 1 ? 's' : ''}</span>
            <span style="margin-left:auto"></span>
            <button type="button" class="sp2-cx-btn" onclick="SP._downloadChartCsv(this)" data-mode="multi">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download CSV
            </button>
          </div>
          <div class="sp2-cx-tbl-wrap">
            <table class="sp2-cx-tbl">
              <thead><tr><th>Pod</th><th class="right">Min</th><th class="right">Max</th><th class="right">Avg</th><th class="right">Last</th></tr></thead>
              <tbody>${podStats.map(p => `
                <tr>
                  <td class="mono">${esc(p.pod)}</td>
                  <td class="right">${p.min == null ? '—' : fmt(p.min)}</td>
                  <td class="right">${p.max == null ? '—' : fmt(p.max)}</td>
                  <td class="right">${p.avg == null ? '—' : fmt(p.avg)}</td>
                  <td class="right">${p.last == null ? '—' : fmt(p.last)}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`;
      } else {
        // Single series: min/max/avg/last + time-value table
        const points = JSON.parse(slotEl.dataset.points);
        series = points;
        // Preserve the min/max band (if any) so the expanded view keeps the
        // envelope + hover reveals max/min at each timestamp.
        const bandAttr = slotEl.dataset.band
          ? ` data-band='${slotEl.dataset.band.replace(/'/g, '&#39;')}'`
          : '';
        slotAttrs = `data-chart="area" data-points='${slotEl.dataset.points.replace(/'/g, '&#39;')}' data-color="${color}" data-unit="${unitTag}"${bandAttr}`;
        const vals = points.map(p => +p[1]).filter(v => isFinite(v));
        if (vals.length) {
          // If a min/max band is present, use its true extents (max-pod ever
          // vs min-pod ever) instead of just the avg's ups/downs — that's
          // what "Max"/"Min" in the header actually means to the user.
          const bandDataset = slotEl.dataset.band ? JSON.parse(slotEl.dataset.band) : null;
          const bandMaxArr = bandDataset?.max || [];
          const bandMinArr = bandDataset?.min || [];
          const avgMin = Math.min(...vals), avgMax = Math.max(...vals);
          const max = bandMaxArr.length ? Math.max(...bandMaxArr.map(p => +p[1]).filter(v => isFinite(v))) : avgMax;
          const min = bandMinArr.length ? Math.min(...bandMinArr.map(p => +p[1]).filter(v => isFinite(v))) : avgMin;
          const avg = vals.reduce((a,b)=>a+b, 0) / vals.length;
          const last = vals[vals.length - 1];
          const maxLbl = bandMaxArr.length ? 'Max (worst pod)' : 'Max';
          const minLbl = bandMinArr.length ? 'Min (best pod)'  : 'Min';
          statsHtml = `
            <div class="sp2-cx-stats">
              <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">Latest</div><div class="sp2-cx-stat-val">${fmt(last)}</div></div>
              <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">Average</div><div class="sp2-cx-stat-val">${fmt(avg)}</div></div>
              <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">${maxLbl}</div><div class="sp2-cx-stat-val">${fmt(max)}</div></div>
              <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">${minLbl}</div><div class="sp2-cx-stat-val">${fmt(min)}</div></div>
              <div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">Samples</div><div class="sp2-cx-stat-val">${points.length}</div></div>
            </div>`;
        } else {
          statsHtml = '<div class="sp2-cx-stats"><div class="sp2-cx-stat"><div class="sp2-cx-stat-lbl">No data</div><div class="sp2-cx-stat-val">—</div></div></div>';
        }
        // Full time-value table (scrollable). Order newest-first so the latest
        // sample sits at the top — matches Grafana Inspect default.
        const rows = [...points].reverse().map((p, i) => `
          <tr>
            <td class="right" style="color:var(--sp-text-soft)">${points.length - i}</td>
            <td class="mono">${dtFmt(+p[0])}</td>
            <td class="right">${fmt(+p[1])}</td>
            <td class="right" style="color:var(--sp-text-soft)">${(+p[1]).toFixed(6)}</td>
          </tr>`).join('');
        tableHtml = `
          <div class="sp2-cx-tbl-toolbar">
            <span>Data · ${points.length} samples (newest first)</span>
            <span style="margin-left:auto"></span>
            <button type="button" class="sp2-cx-btn" onclick="SP._downloadChartCsv(this)" data-mode="area">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download CSV
            </button>
          </div>
          <div class="sp2-cx-tbl-wrap">
            <table class="sp2-cx-tbl">
              <thead><tr><th class="right">#</th><th>Time (local)</th><th class="right">Value</th><th class="right">Raw</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--sp-text-soft)">ไม่มีข้อมูล</td></tr>'}</tbody>
            </table>
          </div>`;
      }

      // Assemble modal body. Chart slot re-uses the same dataset attrs so
      // paintCharts() picks it up automatically. `data-expand-source=…` is a
      // back-reference for the CSV downloader.
      $('sp2-cx-title').textContent = title;
      $('sp2-cx-body').innerHTML = `
        ${statsHtml}
        <div class="sp2-cx-chart-holder">
          <div class="sp2-chart-slot" ${slotAttrs} style="min-height:380px;height:380px"></div>
        </div>
        ${tableHtml}`;
      // Stash the data source for CSV export (title + unit for the header row).
      $('sp2-cx-body').dataset.title = title;
      $('sp2-cx-body').dataset.unitTag = unitTag;
      $('sp2-cx-modal').classList.add('on');
      document.body.style.overflow = 'hidden';
      // Re-paint so the newly-injected slot renders at its actual (larger) width.
      requestAnimationFrame(() => paintCharts());
      if (window.Icons?.replaceAll) window.Icons.replaceAll(document.getElementById('sp2-cx-modal'));
    },

    closeChart() {
      $('sp2-cx-modal').classList.remove('on');
      $('sp2-cx-body').innerHTML = '';
      document.body.style.overflow = '';
    },

    // CSV export — reads the modal body's active chart slot + mode so the
    // filename + rows match what the user is looking at.
    _downloadChartCsv(btn) {
      const body = $('sp2-cx-body');
      const slot = body.querySelector('.sp2-chart-slot');
      if (!slot) return;
      const title = (body.dataset.title || 'chart').replace(/[^a-z0-9._-]+/gi, '_');
      const mode  = btn.dataset.mode;
      let csv = '';
      if (mode === 'multi') {
        const series = JSON.parse(slot.dataset.series || '[]');
        // Wide format: one column per pod + timestamp column
        const timeSet = new Map();  // ts → { pod: value, ... }
        series.forEach(s => {
          (s.values || []).forEach(p => {
            const ts = +p[0];
            if (!timeSet.has(ts)) timeSet.set(ts, {});
            timeSet.get(ts)[s.pod] = +p[1];
          });
        });
        const sortedTimes = [...timeSet.keys()].sort((a,b) => a-b);
        const pods = series.map(s => s.pod);
        csv = 'timestamp,' + pods.map(p => `"${p.replace(/"/g,'""')}"`).join(',') + '\n';
        sortedTimes.forEach(ts => {
          const row = timeSet.get(ts);
          csv += new Date(ts * 1000).toISOString() + ',' + pods.map(p => row[p] ?? '').join(',') + '\n';
        });
      } else {
        const points = JSON.parse(slot.dataset.points || '[]');
        csv = 'timestamp,value\n';
        points.forEach(p => {
          csv += new Date((+p[0]) * 1000).toISOString() + ',' + (+p[1]) + '\n';
        });
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${title}.csv`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    },
    async _copyDocsQuery(btn, expr) {
      try {
        await navigator.clipboard.writeText(expr);
        btn.classList.add('copied');
        const svg = btn.querySelector('svg');
        const orig = svg.innerHTML;
        svg.innerHTML = '<path d="M20 6 9 17l-5-5"/>';
        setTimeout(() => {
          btn.classList.remove('copied');
          svg.innerHTML = orig;
        }, 1400);
      } catch (_) { /* clipboard denied — silent */ }
    },

    _buildDocsHtml() {
      const ic = {
        cmd:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20v14H2z"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>',
        chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m18 9-5 5-2-2-4 4"/></svg>',
        deps:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h6a3 3 0 0 1 3 3v6"/></svg>',
        eps:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        out:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
        pod:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>',
      };
      // Sections + metrics. `src`: 'kube' (kube-state / cAdvisor) or 'jvm'
      // (Micrometer via jvmDsUid). Keep in sync with detail.php queries.
      const sections = [
        {
          icon: ic.chart,
          title: 'ฟีเจอร์ใหม่ (2026-08) — Interaction & Correlation',
          desc: `ระบบ monitoring หน้านี้ถูกอัปเกรดใหญ่รอบล่าสุด — เพิ่ม 4 เครื่องมือหลักสำหรับ incident response
                 ให้เร็วขึ้น. ทั้งหมดเปิดใช้อัตโนมัติในทุก service ที่มี Micrometer / cAdvisor data.`,
          metrics: [
            { lbl: '① Min-Max Band (ทุกกราฟหลัก)', src: 'kube',
              desc: `<b>แถบสีจางๆ ครอบเส้น avg</b> ที่เห็นในทุกกราฟหลัก คือช่วง <b>min-max ต่อ pod / ต่อ scrape</b>
                     ณ​ แต่ละ​ timestamp.<br>
                     <b>Upper band</b> (จางเข้ม) = "worst pod / worst request" — ใช้จับ pod เดี๋ยวที่ hot กว่าคนอื่น
                     หรือ request เดี่ยวๆ ที่ค้าง (tail latency).<br>
                     <b>Lower band</b> (จางกว่า) = "best pod / calmest observation" — ใช้เทียบว่า pod ที่ปกติทำได้เท่าไหร่.<br>
                     ถ้า upper กับ lower <b>ห่างกันมาก</b> = load balancer skew หรือ pod ผิดปกติ.<br>
                     <b>Avg latency chart</b> ใช้ <code>http_server_requests_seconds_max</code> เป็น upper band
                     → จะเห็น spike 5-30s ที่ avg-ratio กลบไป`,
              q: '# CPU / MEM (per-pod reduce)\nmax(rate(container_cpu_usage_seconds_total{...}[10m]))\nmin(rate(container_cpu_usage_seconds_total{...}[10m]))\n\n# Latency (real per-scrape max from Micrometer _max gauge)\nmax(http_server_requests_seconds_max{app_name="<svc>"}) * 1000\n\n# Endpoint / Dependency drill (per-URI)\nmax by (method, uri) (http_server_requests_seconds_max{...}) * 1000' },
            { lbl: '② Shared Crosshair (hover-to-correlate)', src: 'kube',
              desc: `<b>Hover จุดไหนก็ได้บนกราฟใดๆ</b> → ทุกกราฟอื่นบนหน้าจะขึ้น crosshair ที่ timestamp เดียวกัน
                     พร้อม tooltip แสดงค่า.<br>
                     <b>ใช้ทำอะไร:</b> เจอ Latency spike 15:32 → hover จุดนั้น → เห็น GC pause = 4.2s, Tomcat busy = 195/200,
                     Outbound = 3.1s ทันที = <b>correlation ทำได้ในการ hover ครั้งเดียว</b> ไม่ต้อง scroll เทียบ chart.<br>
                     Source chart (ตัวที่กำลัง hover) แสดง crosshair opacity เต็ม, chart อื่นแสดง 0.55 (จาง) เพื่อให้รู้ว่าใครคุมอยู่.<br>
                     Chart ที่ timestamp อยู่นอก range (subsystem ไม่มี data ตรงนั้น) จะไม่แสดง.`,
              q: '# Implementation:\n# 1. mousemove บน overlay dispatches CustomEvent("sp2-crosshair", {ts, source})\n# 2. Global listener paints mirror crosshair บนทุก .sp2-chart-slot อื่น\n# 3. mouseleave → dispatches "sp2-crosshair-off" → clear ทุกตัว' },
            { lbl: '③ Brush Zoom (ลาก = zoom)', src: 'kube',
              desc: `<b>ลาก mouse ข้ามส่วนไหนของกราฟ</b> → ปล่อย → <b>ทุกกราฟบนหน้า zoom ไปที่ช่วงที่ลาก</b>.<br>
                     ทำงานผ่าน <code>SP.setCustomRange(startTs, endTs)</code> เดียวกับ Custom picker → refetch ทุก series + subsystem.<br>
                     <b>Safety:</b> drag &lt; 6px → treat as click (ปุ่ม expand ยังทำงาน). Time span &lt; 30s → skip
                     (finer than Thanos scrape resolution). Drag ที่จบนอก chart ก็ commit (แก้ overshoot).<br>
                     <b>Zoom กลับ:</b> คลิก preset pill (15m / 30m / 1h ...) หรือ Custom pill.`,
              q: '# UI hint: "ลากบนกราฟ = zoom เข้า" ใต้ Range picker\n# Implementation: mousedown → draw SVG <rect class="sp2-brush"> \n# → mouseup → SP.setCustomRange(startTs, endTs)' },
            { lbl: '④ Max/Min Badges ในหัวกราฟ', src: 'kube',
              desc: `ใต้ค่า "now" ในหัวการ์ดกราฟ มี sub-line เล็กๆ แสดง <b>peak max</b> กับ <b>peak min</b>
                     ตลอด window ที่เลือก.<br>
                     ตัวอย่าง: <code>112m · 6.2%</code> (avg ล่าสุด) + <code>max 480m · min 78m</code> (ช่วงสุด/ต่ำสุดใน 30m).<br>
                     Latency badge <b>เปลี่ยนสีอัตโนมัติ</b>: max ≥ 3000ms = สีแดง, ≥ 1000ms = เหลือง, ต่ำกว่า = จาง.<br>
                     Auto-populate จาก band data — ไม่มี band ก็ไม่แสดง.`,
              q: '# Runs after every paintCharts()\n# Reads data-band from each .sp2-chart-slot\n# Injects <div class="sp2-mm-badge"> below .now element' },
            { lbl: '⑤ SLO Threshold Lines (dashed overlays)', src: 'kube',
              desc: `<b>เส้นประนอน</b> บนกราฟหลักบอกระดับ warn (สีเหลือง) + critical (สีแดง). เห็นทันทีว่า
                     ค่าปัจจุบันเข้าใกล้ threshold แค่ไหน ไม่ต้องเปรียบเทียบตัวเลขเอง.<br>
                     <b>Defaults ที่ใช้:</b><br>
                     • Avg latency: warn 500ms / crit 1000ms<br>
                     • CPU avg/pod: warn 60% / crit 80% ของ limit<br>
                     • MEM avg/pod: warn 75% / crit 85% ของ limit<br>
                     • GC pause max: warn 100ms / crit 500ms<br>
                     • Tomcat busy: warn 70% / crit 90% ของ max threads<br>
                     • Hikari active: warn 70% / crit 90% ของ pool max<br>
                     <b>Auto-clip:</b> ถ้า SLO อยู่สูงกว่าข้อมูลปัจจุบัน &gt; 2 เท่า → เส้นซ่อน (กัน axis distort).<br>
                     <b>Override per-service:</b> เพิ่มคอลัมน์ <code>sloLatencyMsWarn</code>, <code>sloCpuPctCrit</code>, ...
                     ใน CSV inventory ได้ในอนาคต (currently hardcoded default)`,
              q: '// SLO_DEFAULTS constant (service-performance.html)\nSLO_DEFAULTS = {\n  latencyMs: { warn: 500, crit: 1000 },\n  cpuPct:    { warn: 0.60, crit: 0.80 },\n  memPct:    { warn: 0.75, crit: 0.85 },\n  gcPauseMs: { warn: 100, crit: 500 },\n  tomcatBusyPct: { warn: 0.70, crit: 0.90 },\n  hikariActivePct: { warn: 0.70, crit: 0.90 },\n};' },
            { lbl: '⑥ Timeline Annotations (pod restart / deploy markers)', src: 'kube',
              desc: `<b>วงกลม R (สีส้ม)</b> / <b>D (สีน้ำเงิน)</b> ที่ขอบบนของทุก chart = event ที่เกิดในช่วงเวลาที่แสดง
                     + เส้นประแนวตั้งลากลงตลอด plot area = timestamp ของ event นั้น.<br>
                     <b>R = Restart</b>: pod ตายและ Kubernetes สร้างใหม่ (crash, OOM, liveness probe fail)<br>
                     <b>D = Deploy</b>: pod ใหม่ถูกสร้าง (rollout, scale out, replace)<br>
                     <b>Hover</b> วงกลม → tooltip แสดง pod name + timestamp เต็ม<br>
                     <b>Use case:</b> เห็น latency spike ที่ 15:32 → เห็นวง R ตรงเดียวกัน = ยืนยัน "pod ตาย/restart
                     ทำให้ request ค้าง 30s รอ handover ให้ pod ใหม่".<br>
                     <b>Group:</b> ถ้ามี event หลายตัวใน pixel เดียว → merge เป็นวงเดียว, tooltip list ครบทุก event`,
              q: '# Restarts (changes on restart counter):\nchanges(kube_pod_container_status_restarts_total{namespace="<ns>",pod=~"<svc>.*",container="<svc>"}[<step>s])\n\n# Deploys (pod creation timestamp within window):\nkube_pod_created{namespace="<ns>",pod=~"<svc>.*"}\n# → filter where value >= start AND value <= end' },
            { lbl: '⑦ Alerts ↗ link (Grafana Alerting UI)', src: 'kube',
              desc: `ปุ่ม <b>Alerts ↗</b> ที่ header actions → เปิด Grafana Alerting page filtered ด้วย service name.<br>
                     Link format: <code>&lt;grafanaUrl&gt;/alerting/list?search=&lt;service&gt;</code><br>
                     เห็น <b>firing / pending / no-data</b> rules ที่เกี่ยวกับ service นี้ในหน้าเดียว.<br>
                     <b>Future upgrade</b>: ถ้ามี Grafana API token → sync live → แสดง badge สีแดงบน chart ถ้ามี
                     active alert (ไม่ต้องคลิกออก)`,
              q: '// Simple link-out — no API call required\n<a href="{grafanaUrl}/alerting/list?search={service}" target="_blank">Alerts ↗</a>' },
            { lbl: '⑧ Auto-hide empty subsystem sections', src: 'jvm',
              desc: `Service ที่ไม่ใช่ Spring Boot / ไม่มี HikariCP → section DB Pool / Tomcat / Runtime / Transaction
                     จะ <b>หายไปพร้อมกับ nav pill</b> อัตโนมัติหลังโหลด (ไม่โผล่ skeleton ค้าง).<br>
                     Timeout ที่ 10s (frontend Promise.race) — backend ค้างเกินจะ hide เอง.<br>
                     Console log <code>[sp2] subsystem X load failed</code> ถ้ามี error หรือ timeout สำหรับ debug.`,
              q: '# _subsystemIsEmpty(sec):\n#   ตรวจว่าทุก KPI = null AND ทุก series ว่าง → true → hide\n# _hideSubsystemSection(tab):\n#   ลบทั้ง <section> + nav pill + rerun scroll-spy' },
          ],
          notes: `<b>สรุป workflow แนะนำสำหรับ incident:</b> (1) เปิดหน้า service → เห็น Overview + Live status.
                  (2) ถ้าเจอเลข abnormal → scroll หาก raph ที่เกี่ยว. (3) เจอ spike → <b>hover ที่ spike นั้น</b>
                  → correlate GC / DB pool / threads / outbound พร้อมกัน. (4) <b>ลาก brush zoom</b> ที่ช่วง spike
                  เพื่อขยายดูละเอียด. (5) คลิก endpoint / dep node ให้เห็น max latency per URI (จาก <code>_max</code> gauge).`,
        },
        {
          icon: ic.cmd,
          title: 'Command Center · CPU / MEM / Pods (Live status)',
          desc: 'การ์ดสรุปด้านซ้ายของ detail — เลข "avg/pod" หมายถึงเฉลี่ยข้าม pod ที่ยังรันอยู่. ทั้งหมดใช้ container metrics จาก cAdvisor + kube-state-metrics.',
          metrics: [
            { lbl: 'CPU avg/pod (cores + % of limit)', src: 'kube',
              desc: 'ค่า CPU เฉลี่ยที่ pod หนึ่งใช้อยู่. ถ้ามี CPU limit ตั้งไว้ จะแสดง % ด้วย.',
              q: 'avg by (namespace) (\n  rate(container_cpu_usage_seconds_total{\n    namespace="<ns>",pod=~"<svc>.*",container="<svc>",container!="POD"\n  }[2m])\n)' },
            { lbl: 'MEM avg/pod (bytes + % of limit)', src: 'kube',
              desc: 'ค่า memory เฉลี่ยที่ pod หนึ่งใช้ (working_set = memory ที่ kernel นับว่า in-use).',
              q: 'avg by (namespace) (\n  container_memory_working_set_bytes{\n    namespace="<ns>",pod=~"<svc>.*",container="<svc>",container!="POD"\n  }\n)' },
            { lbl: 'CPU / MEM limits (per pod)', src: 'kube',
              desc: 'limit ที่ตั้งไว้ในแต่ละ pod — ใช้เป็นตัวหารในการคำนวณ %',
              q: 'max(kube_pod_container_resource_limits{\n  namespace="<ns>",pod=~"<svc>.*",container="<svc>",resource=~"cpu|memory"\n}) by (pod, resource)' },
            { lbl: 'Running pods (count + target)', src: 'kube',
              desc: 'จำนวน pod ที่ Kubernetes report ว่า Running. target มาจาก inventory CSV (คอลัมน์ replicasProd).',
              q: 'count(kube_pod_status_phase{\n  namespace="<ns>",pod=~"<svc>.*",phase="Running"\n})' },
          ],
        },
        {
          icon: ic.chart,
          title: 'Charts · CPU / MEM aggregate + per-pod',
          desc: 'กราฟ area (aggregate) กับ multi-line (per-pod) ตรงกลาง Command Center. Range เลือกได้จาก pill ด้านบน — เปลี่ยน range → query_range window เปลี่ยนตาม.',
          metrics: [
            { lbl: 'CPU aggregate (time-series)', src: 'kube',
              desc: 'เส้นเดียว = CPU avg/pod ต่อเวลา. query_range พร้อม step 30-60s ตาม window',
              q: 'avg by (namespace) (\n  rate(container_cpu_usage_seconds_total{\n    namespace="<ns>",pod=~"<svc>.*",container="<svc>"\n  }[2m])\n)' },
            { lbl: 'MEM aggregate (time-series)', src: 'kube',
              desc: 'เส้นเดียว = memory avg/pod ต่อเวลา',
              q: 'avg by (namespace) (\n  container_memory_working_set_bytes{\n    namespace="<ns>",pod=~"<svc>.*",container="<svc>"\n  }\n)' },
            { lbl: 'CPU / MEM per-pod (multi-line)', src: 'kube',
              desc: 'หลายเส้น (1 เส้น = 1 pod) — ใช้ตรวจว่า pod ตัวไหน hot กว่าตัวอื่น. group by (pod) เพื่อไม่รวม',
              q: 'sum by (pod) (\n  rate(container_cpu_usage_seconds_total{\n    namespace="<ns>",pod=~"<svc>.*",container="<svc>"\n  }[2m])\n)' },
          ],
        },
        {
          icon: ic.chart,
          title: 'TXN rate · Avg latency (Spring Boot Micrometer)',
          desc: 'แสดงเฉพาะ service ที่ expose <code>/actuator/prometheus</code>. Non-Spring service (Node.js/Go/static) จะไม่มี card นี้.',
          metrics: [
            { lbl: 'TXN rate (req/s total)', src: 'jvm',
              desc: 'อัตรารับ HTTP request รวมทั้ง workload (sum ข้ามทุก pod)',
              q: 'sum(rate(http_server_requests_seconds_count{\n  app_name="<svc>", cluster="<cluster>"\n}[5m]))' },
            { lbl: 'Avg latency (ms/request) — เข้าใจ 2 ตัวเลข', src: 'jvm',
              desc: `<b>เส้น avg</b> = <code>sum(rate(_sum))/sum(rate(_count)) × 1000</code> = ค่าเฉลี่ยต่อ request ตลอด workload.
                     <b>Smoothed</b> — ไม่เห็น spike ระดับ request เดี่ยว.<br>
                     <b>Upper band (max)</b> = <code>max(http_server_requests_seconds_max) × 1000</code> = <b>duration ของ request ที่ช้าที่สุด</b>
                     ที่ Micrometer จับได้ใน 1 scrape interval (~1 นาที). <b>Reset ทุก scrape</b>.<br>
                     <b>สำคัญมาก:</b> Avg อาจ = 170ms แต่ max อาจ = 12s — <b>ทั้งคู่จริง</b> เพราะ:
                     Avg = mean ของทุก request (1000 requests × 100ms + 1 request × 10s ≈ 110ms).
                     Max = ตัวเดียวที่ 10s.<br>
                     <b>ทำไมไม่มี min:</b> Micrometer summary metric ไม่มี true min per-scrape.
                     ถ้า service เปิด <code>publishPercentileHistogram</code> จะได้ p50/p95/p99 (แม่นกว่า max)`,
              q: '# Avg (workload weighted mean):\n(\n  sum(rate(http_server_requests_seconds_sum{app_name="<svc>"}[5m]))\n  /\n  sum(rate(http_server_requests_seconds_count{app_name="<svc>"}[5m]))\n) * 1000\n\n# Max band (real per-scrape worst request):\nmax(http_server_requests_seconds_max{app_name="<svc>"}) * 1000' },
            { lbl: 'TXN rate min/max band (pod-spread)', src: 'jvm',
              desc: `<b>Primary line</b> = <code>sum(rate(count))</code> = TPS รวมทั้ง workload<br>
                     <b>Upper band</b> = <code>max(sum by (pod) (rate(count)))</code> = pod ที่รับ request มากสุด<br>
                     <b>Lower band</b> = <code>min(sum by (pod) (rate(count)))</code> = pod ที่รับน้อยสุด<br>
                     <b>ใช้ทำอะไร:</b> band กว้าง = <b>load balancer skew</b> — พบใน sticky session,
                     bad load balancing algorithm, หรือ endpoint ที่มี hot key`,
              q: '# Primary:\nsum(rate(http_server_requests_seconds_count{...}[5m]))\n\n# Upper (busiest pod):\nmax(sum by (pod) (rate(http_server_requests_seconds_count{...}[5m])))\n\n# Lower (idlest pod):\nmin(sum by (pod) (rate(http_server_requests_seconds_count{...}[5m])))' },
            { lbl: 'JVM heap % (gauge)', src: 'jvm',
              desc: 'formula เดียวกับ Grafana dashboard core-service เพื่อไม่ให้เลข diverge',
              q: 'avg(jvm_memory_used_bytes{app_name="<svc>", cluster="<cluster>"})\n/\navg(jvm_memory_max_bytes{app_name="<svc>", cluster="<cluster>"})\n* 100' },
          ],
        },
        {
          icon: ic.cmd,
          title: 'Health chips (ท้าย Command Center ซ้าย)',
          desc: 'แถว pill สั้นๆ ที่บอก health ของ subsystem 5 ตัว (DB Pool / Tomcat / GC / Threads / Heap) แบบเห็นสีเดียวก็รู้. คลิก chip → jump ไป tab ที่ตรง. ค่ามาจาก <code>subsystems.php?sections=chips</code> ทุก instant query — refresh อัตโนมัติเมื่อเปลี่ยน range picker.',
          metrics: [
            { lbl: 'DB Pool chip', src: 'jvm',
              desc: 'สี: <b>hot</b> = timeoutRate&gt;0.05 หรือ pending&gt;0 หรือ active/max ≥ 90%. <b>warn</b> = timeout&gt;0 หรือ ≥ 70%. <b>ok</b> = ต่ำกว่านั้น',
              q: 'sum(hikaricp_connections_active{app_name="<svc>"})\nmax(hikaricp_connections_max{app_name="<svc>"})\nsum(hikaricp_connections_pending{app_name="<svc>"})\nsum(rate(hikaricp_connections_timeout_total{app_name="<svc>"}[5m]))' },
            { lbl: 'Tomcat chip', src: 'jvm',
              desc: 'สีตาม busy/max ratio: ≥90% hot, ≥70% warn. รองรับทั้ง <code>tomcat_threads_busy_threads</code> (Micrometer) และ <code>Tomcat_ThreadPool_currentThreadsBusy</code> (JMX)',
              q: 'max(tomcat_threads_busy_threads{app_name="<svc>"} or Tomcat_ThreadPool_currentThreadsBusy{app_name="<svc>"})\nmax(tomcat_threads_config_max_threads{app_name="<svc>"} or Tomcat_ThreadPool_maxThreads{app_name="<svc>"})' },
            { lbl: 'GC chip', src: 'jvm',
              desc: 'ดู <code>jvm_gc_pause_seconds_max</code>. ≥500ms hot, ≥100ms warn — pause ยาวเป็นสาเหตุ latency spike ที่คน debug มักมองข้าม',
              q: 'max(jvm_gc_pause_seconds_max{app_name="<svc>"}) * 1000\nsum(rate(jvm_gc_pause_seconds_count{app_name="<svc>"}[5m]))' },
            { lbl: 'Threads / Heap chip', src: 'jvm',
              desc: 'Threads ≥500 = warn (thread leak signal). Heap ≥85% hot, ≥70% warn',
              q: 'max(jvm_threads_live_threads{app_name="<svc>"} or jvm_threads_current{app_name="<svc>"})\navg(jvm_memory_used_bytes{app_name="<svc>",area="heap"}) / avg(jvm_memory_max_bytes{app_name="<svc>",area="heap"}) * 100' },
          ],
          notes: '<b>Non-Java service</b> (Node.js/Go/static) chip row ว่างเปล่า เพราะ source ไม่มี <code>jvmDsUid</code> — ไม่ใช่ bug',
        },
        {
          icon: ic.chart,
          title: 'Section: DB Pool (Hikari) — connection pool ของ Spring/JDBC',
          desc: `<b>ทำไมสำคัญ:</b> เวลา service ช้า / latency spike ทั้งที่ CPU/MEM ปกติ — สาเหตุ #1 คือ DB pool เต็ม
                 (pending&gt;0, timeoutRate&gt;0). Section นี้ชี้ขาด incident แบบ "app ปกติแต่ตอบช้า".<br>
                 <b>ทุกกราฟ</b> มี min-max band แสดง <b>pod ที่มี connection มากสุด vs น้อยสุด</b> ณ​ แต่ละ timestamp
                 → ถ้า band กว้าง = pool usage ไม่กระจาย (pod หนึ่งกินหมด หรือมี hot partition).<br>
                 <b>Hikari</b> = library JDBC pool ที่ Spring Boot ใช้ default. Metric prefix: <code>hikaricp_connections_*</code>.`,
          metrics: [
            { lbl: 'Active / Idle / Pending — คืออะไร', src: 'jvm',
              desc: `<b>Active</b> = connection ที่ borrow อยู่ (มี thread ถือใช้ query อยู่)<br>
                     <b>Idle</b> = connection ว่างใน pool (พร้อมให้ borrow)<br>
                     <b>Pending</b> = <b>thread ที่รอ connection</b> (pool หมด → ต่อคิว) — <b>ต้อง 0 เสมอ!</b><br>
                     Pending&gt;0 ต่อเนื่อง = pool เล็กไป → ต้องเพิ่ม <code>spring.datasource.hikari.maximum-pool-size</code>
                     หรือ tune query ให้เร็วขึ้น (ถือ conn สั้นลง).<br>
                     <b>Total = Active + Idle</b> (Hikari grows pool ตาม load จนถึง max)`,
              q: '# Primary series (workload sum):\nsum(hikaricp_connections_active{app_name="<svc>"})\nsum(hikaricp_connections_idle{app_name="<svc>"})\nsum(hikaricp_connections_pending{app_name="<svc>"})\n\n# Min-max band per pod:\nmax(hikaricp_connections_active{...})  # busiest pod\nmin(hikaricp_connections_active{...})  # idlest pod' },
            { lbl: 'Max / Min (pool config)', src: 'jvm',
              desc: 'จำนวน connection สูงสุด/ต่ำสุดที่ตั้งไว้ใน HikariConfig (spring.datasource.hikari.maximum-pool-size)',
              q: 'max(hikaricp_connections_max{app_name="<svc>"})\nmax(hikaricp_connections_min{app_name="<svc>"})' },
            { lbl: 'Timeout rate (/sec)', src: 'jvm',
              desc: 'connection request ที่ timeout เพราะรอนาน. &gt;0 = pool ตันจริง → error โผล่ไปที่ client',
              q: 'sum(rate(hikaricp_connections_timeout_total{app_name="<svc>"}[5m]))' },
            { lbl: 'Acquire max / Usage max / Create max (ms) — 3 มิติวินิจฉัย', src: 'jvm',
              desc: `<b>Acquire max</b> (สำคัญสุด) = ระยะเวลาที่ thread รอ borrow connection จาก pool.
                     ค่าปกติ &lt; 5 ms. ถ้า &gt; 100 ms = pool contention. &gt; 1000 ms = pool ตันจริง (มี Pending ด้วย)<br>
                     <b>Usage max</b> = ระยะเวลาที่ thread ถือ connection ก่อนคืน.
                     ค่าสูง = query ช้า / transaction ยาว → hold conn นาน → คนอื่นรอ.
                     ถ้า Usage max พุ่ง = ดู DB slow query log<br>
                     <b>Create max</b> = ระยะเวลาสร้าง connection ใหม่ (network → DB handshake).
                     สูงตอน pool grow (cold start) หรือ DB restart. ปกติ ~50-200 ms<br>
                     <b>Min band</b> = pod ที่ acquire/usage เร็วสุด — เทียบให้เห็นว่า pod หนึ่งเดี๋ยวหรือทั้ง fleet เจอ`,
              q: '# Primary (worst pod at each timestamp):\nmax(hikaricp_connections_acquire_seconds_max{...}) * 1000\nmax(hikaricp_connections_usage_seconds_max{...}) * 1000\nmax(hikaricp_connections_creation_seconds_max{...}) * 1000\n\n# Min band (calmest pod):\nmin(hikaricp_connections_acquire_seconds_max{...}) * 1000\nmin(hikaricp_connections_usage_seconds_max{...}) * 1000' },
            { lbl: 'Usage rate (queries/sec ประมาณการ)', src: 'jvm',
              desc: 'rate ของ usage count = จำนวนครั้งที่ conn ถูก borrow → คร่าวๆ = DB queries/sec',
              q: 'sum(rate(hikaricp_connections_usage_seconds_count{app_name="<svc>"}[5m]))' },
          ],
        },
        {
          icon: ic.chart,
          title: 'Tab: Tomcat — HTTP thread pool ของ embedded server',
          desc: '<b>ทำไมสำคัญ:</b> Tomcat เต็ม → HTTP request queue → 503 / long tail latency. รวม config table (max threads, timeout, accept count) ที่มาจาก JMX exporter',
          metrics: [
            { lbl: 'Busy threads — "worker ที่ใช้งานอยู่ตอนนี้"', src: 'jvm',
              desc: `<b>Tomcat thread pool</b> = worker pool ที่รับ HTTP request. ทุก request 1 ตัว = ยึด 1 thread จนกว่าจะตอบเสร็จ.<br>
                     <b>Busy = thread ที่กำลัง handle request</b> (executing code). ต่างจาก idle (พร้อมใช้แต่ยังว่าง).<br>
                     <b>เกณฑ์:</b> busy/max ≥ 90% ต่อเนื่อง = ต้องเพิ่ม <code>server.tomcat.threads.max</code> (default 200) หรือ scale out.<br>
                     <b>Primary series = max ต่อ pod</b> (Tomcat แต่ละ pod มี pool แยก, เอา pod ที่ busy สุดขึ้นมาโชว์).
                     <b>Min band</b> = pod ที่ busy น้อยสุด. band กว้าง = load balancer skew — บาง pod ถูกยิงหนัก บาง pod ว่าง.<br>
                     <b>ผลกระทบตอน pool เต็ม:</b> request ใหม่จะเข้า accept queue → รอ (latency spike) → ถ้ารอเกิน connection timeout → 503`,
              q: '# Primary (worst pod = busiest):\nmax(tomcat_threads_busy_threads{...} or Tomcat_ThreadPool_currentThreadsBusy{...})\n\n# Min band:\nmin(tomcat_threads_busy_threads{...} or Tomcat_ThreadPool_currentThreadsBusy{...})' },
            { lbl: 'Current threads — "pool size ปัจจุบัน"', src: 'jvm',
              desc: `<b>Current = จำนวน thread ที่ pool alloc ไว้ตอนนี้</b> (busy + idle).<br>
                     Tomcat จะ grow pool อัตโนมัติตาม load — เริ่มจาก <code>server.tomcat.threads.min-spare</code>
                     (default 10) แล้วเพิ่มไปจน <code>max</code> (default 200).<br>
                     <b>Idle thread = Current - Busy</b> = buffer สำหรับ burst traffic.<br>
                     ถ้า Current ค่อยๆ growing ตลอด = load เพิ่มต่อเนื่อง (ไม่ scale down เอง).<br>
                     <b>Min band</b> = pod ที่ pool เล็กสุด — pod เก่าที่ warm up แล้วมักมี pool ใหญ่กว่า pod ใหม่`,
              q: '# Primary:\nmax(tomcat_threads_current_threads{...} or Tomcat_ThreadPool_currentThreadCount{...})\n\n# Min band:\nmin(tomcat_threads_current_threads{...} or Tomcat_ThreadPool_currentThreadCount{...})' },
            { lbl: 'Max threads (config)', src: 'jvm',
              desc: 'เพดาน pool. Default Spring Boot = 200. ตั้งใน <code>server.tomcat.threads.max</code>',
              q: 'max(tomcat_threads_config_max_threads{app_name="<svc>"})\nor\nmax(Tomcat_ThreadPool_maxThreads{app_name="<svc>"})' },
            { lbl: 'Connection count / max connections', src: 'jvm',
              desc: 'จำนวน active TCP connection (JMX only). Max = <code>server.tomcat.max-connections</code>',
              q: 'max(Tomcat_ThreadPool_connectionCount{app_name="<svc>"})\nmax(Tomcat_ThreadPool_maxConnections{app_name="<svc>"})' },
            { lbl: 'Accept count / keep-alive / connection timeout', src: 'jvm',
              desc: 'Config ที่มีผลตอน pool ตัน — accept count = queue depth ก่อน reject, keep-alive = ค้าง conn ไว้กี่ ms',
              q: 'max(Tomcat_ThreadPool_acceptCount{app_name="<svc>"})\nmax(Tomcat_ThreadPool_keepAliveTimeout{app_name="<svc>"})\nmax(Tomcat_ThreadPool_connectionTimeout{app_name="<svc>"})' },
          ],
          notes: '<code>tomcat_threads_*</code> = Micrometer (Spring Boot ≥ 2.0). <code>Tomcat_ThreadPool_*</code> = JMX exporter (ต้อง config เพิ่มใน pom). Tab นี้ merge ทั้ง 2 แหล่ง — อันไหน emit อันนั้นชนะ',
        },
        {
          icon: ic.chart,
          title: 'Tab: Runtime (JVM detail) — heap pools + GC + threads + system',
          desc: 'เจาะลึก JVM internal — <b>heap pool table</b> (Eden/Old/Survivor + Metaspace/CodeCache แยก) + <b>GC pause chart</b> (สาเหตุ latency spike) + system CPU/load + file descriptor. ครอบคลุมทั้ง JVM row ของ Grafana',
          metrics: [
            { lbl: 'Heap pools (Eden / Old Gen / Survivor)', src: 'jvm',
              desc: '<b>Old Gen เต็ม</b> = memory leak signal. Eden churn สูง = allocation rate สูง → tune generation size',
              q: 'avg by (id, area) (\n  jvm_memory_used_bytes{app_name="<svc>", area="heap"}\n)\nmin by (id, area) (\n  jvm_memory_max_bytes{app_name="<svc>", area="heap"}\n)' },
            { lbl: 'Non-heap pools (Metaspace / Code Cache / Compressed Class)', src: 'jvm',
              desc: '<b>Metaspace เต็ม</b> = classloader leak (พบใน hot-reload / dynamic proxy). Code Cache เต็ม → JIT disable → ช้า',
              q: 'avg by (id) (\n  jvm_memory_used_bytes{app_name="<svc>", area="nonheap"}\n)' },
            { lbl: 'GC pause max / rate — สาเหตุ latency spike #1', src: 'jvm',
              desc: `<b>GC (Garbage Collection)</b> = JVM หยุด application เพื่อเคลียร์ memory ที่ไม่ใช้แล้ว.
                     "Stop-the-world" = ทุก user request ค้างระหว่าง GC pause.<br>
                     <b>Pause max (ms)</b> = pause ยาวสุดต่อ scrape. เกณฑ์:<br>
                     • &lt; 100 ms = ok (user แทบไม่รู้สึก)<br>
                     • 100-500 ms = warn (request ที่โดน pause จะช้าตาม)<br>
                     • &gt; 500 ms = hot (timeout signal — ใหญ่มากๆ อาจ 5-30s สำหรับ Full GC)<br>
                     <b>Rate (ms/s)</b> = เวลาที่ JVM หยุดสะสมต่อวินาที. เช่น 20 ms/s = 2% ของเวลา JVM หยุดอยู่.
                     ปกติ &lt; 10 ms/s.<br>
                     <b>เทียบกับ Avg latency chart:</b> hover ที่ GC spike → เห็นว่า latency chart ก็ spike ตรงกันไหม
                     → ยืนยัน GC pause = สาเหตุ.<br>
                     <b>Min band</b> = calmest pod ต่อ pause — bufferช่วยดูว่าเป็น pod เดียวหรือทั้ง fleet`,
              q: '# Primary (worst pod):\nmax(jvm_gc_pause_seconds_max{...}) * 1000\nsum(rate(jvm_gc_pause_seconds_sum{...}[5m])) * 1000\n\n# Min band:\nmin(jvm_gc_pause_seconds_max{...}) * 1000' },
            { lbl: 'Threads (live / peak / daemon)', src: 'jvm',
              desc: `<b>Live</b> = thread ที่ยังทำงาน (Runnable + Waiting + Timed_Waiting + Blocked)<br>
                     <b>Peak</b> = จำนวนสูงสุดตั้งแต่ JVM start (ไม่ลดลง). Peak เพิ่มเรื่อยๆ = <b>thread leak signal</b>
                     — ต้อง restart pod เพื่อ recover<br>
                     <b>Daemon</b> = background thread (GC, JIT, Netty EventLoop). ปกติเป็นสัดส่วนใหญ่ของ live<br>
                     <b>เกณฑ์เตือน:</b> live &gt; 500 = สงสัย leak. Spring Boot ปกติ ~100-300 threads<br>
                     <b>Min band</b> = pod ที่ threads น้อยสุด — ถ้า band กว้าง = pod เก่ากับใหม่ต่างกันมาก`,
              q: '# Primary:\nmax(jvm_threads_live_threads{...} or jvm_threads_current{...})\nmax(jvm_threads_peak_threads{...})\n\n# Min band (per-pod min):\nmin(jvm_threads_live_threads{...})' },
            { lbl: 'System CPU / Process CPU / Load 1m — 3 มุมมอง CPU', src: 'jvm',
              desc: `<b>System CPU %</b> = CPU ที่ node ทั้ง node ใช้ (0-100%). ถ้าสูง = node แออัด
                     (neighbor pod กิน CPU เยอะ) → คน pod เราจะช้าตามด้วย<br>
                     <b>Process CPU %</b> = CPU เฉพาะ JVM ของเรา. ต่างจาก container_cpu_usage ตรงที่วัดจาก
                     inside JVM (ไม่รวม cgroup overhead)<br>
                     <b>Load 1m</b> = Linux load average (จำนวน process ที่ต้องการ CPU + I/O).
                     ปกติ &lt; core count. Load = 4 บน node 2-core = overload<br>
                     <b>Min-max band</b> = pod ที่กิน CPU มากสุด vs น้อยสุด — <b>band กว้างมาก = load balancer skew</b>
                     (บาง pod รับ traffic มากผิดปกติ)`,
              q: '# Primary (workload avg):\navg(system_cpu_usage{...}) * 100\navg(process_cpu_usage{...}) * 100\navg(system_load_average_1m{...})\n\n# Min-max band (per-pod):\nmax(system_cpu_usage{...}) * 100\nmin(system_cpu_usage{...}) * 100' },
            { lbl: 'Open file descriptors — FD leak detector', src: 'jvm',
              desc: `<b>FD (File Descriptor)</b> = ตัวชี้ resource ที่ OS จัดสรรให้ process เช่น socket, file, pipe.
                     Linux default max ต่อ process = 1024-65536.<br>
                     <b>FD ที่เพิ่มขึ้นเรื่อยๆ ไม่ลด</b> = โค้ดไม่ปิด resource (forgot .close() / try-with-resources).
                     เช่น HttpClient connection ไม่ release, file input stream ไม่ปิด.<br>
                     <b>ถึง max → OS reject accept()</b> = "Too many open files" exception → service ตอบไม่ได้เลย<br>
                     <b>Min band</b> = pod ที่ FD ต่ำสุด — ถ้า band กว้างมาก = pod เก่าไม่ leak, pod ใหม่ leak
                     (หรือกลับกัน) — help isolate ปัญหา`,
              q: '# Primary:\nmax(process_files_open_files{...} or process_files_open{...})\n\n# Min band:\nmin(process_files_open_files{...} or process_files_open{...})' },
          ],
        },
        {
          icon: ic.chart,
          title: 'Tab: Transaction — Peak values ตลอดช่วง window',
          desc: 'ทุกค่าคำนวณด้วย <code>max_over_time(...)[&lt;window&gt;:15s]</code> = <b>peak ตลอดช่วงเวลาที่เลือก</b>. เหมาะกับการ "ดูว่าช่วงนี้พีคเท่าไหร่" เช่น หา peak load หลัง release. เปลี่ยน range → refresh อัตโนมัติ',
          metrics: [
            { lbl: 'Peak TPS (server / client)', src: 'jvm',
              desc: 'server = HTTP รับเข้า · client = HTTP ที่ยิงออก (outbound rate). เทียบให้เห็นว่า service เป็น "ตัวรับ" หรือ "ตัวยิงต่อ"',
              q: 'max_over_time(\n  sum(rate(http_server_requests_seconds_count{app_name="<svc>"}[1m]))\n[<window>:15s])\nmax_over_time(\n  sum(rate(http_client_requests_seconds_count{app_name="<svc>"}[1m]))\n[<window>:15s])' },
            { lbl: 'Latency max / Client RT max (ms)', src: 'jvm',
              desc: 'p-max ของ Micrometer histogram (ไม่ใช่ p99 — เป็น max จริงๆ). ≥500ms warn / ≥1000ms hot',
              q: 'max_over_time(max(http_server_requests_seconds_max{app_name="<svc>"})[<window>:15s]) * 1000\nmax_over_time(max(http_client_requests_seconds_max{app_name="<svc>"})[<window>:15s]) * 1000' },
            { lbl: 'Peak DB (active / total / max / min)', src: 'jvm',
              desc: 'Peak DB conn ตลอด window. เทียบกับ Max pool → ถ้าใกล้ 100% ตอน peak = ควรเพิ่ม pool',
              q: 'max_over_time(max(hikaricp_connections_active{app_name="<svc>"})[<window>:15s])\nmax(hikaricp_connections_max{app_name="<svc>"})' },
            { lbl: 'Peak Tomcat threads / connections', src: 'jvm',
              desc: 'Peak busy threads + peak connectionCount ตลอด window',
              q: 'max_over_time(\n  max(tomcat_threads_busy_threads{app_name="<svc>"}\n    or Tomcat_ThreadPool_currentThreadsBusy{app_name="<svc>"}\n  )\n[<window>:15s])' },
            { lbl: 'Peak JVM threads / Heap %', src: 'jvm',
              desc: 'Peak live threads + peak heap util % ตลอด window — bug capacity planning',
              q: 'max_over_time(( avg(jvm_memory_used_bytes{app_name="<svc>",area="heap"}) / avg(jvm_memory_max_bytes{app_name="<svc>",area="heap"}) * 100 )[<window>:15s])' },
          ],
          notes: 'ทุก query ใช้ subquery <code>[window:15s]</code> — step 15s เพื่อให้แม่นแต่ยังไม่ระเบิด Thanos ตอน window ยาว (30d)',
        },
        {
          icon: ic.deps,
          title: 'Dependencies (Upstream · Downstream)',
          desc: '<strong>Upstream</strong> = ใครเรียก service นี้ · <strong>Downstream</strong> = service นี้เรียกใคร. Rate ที่แสดงเป็น <strong>5-min rolling average</strong> (ไม่ตาม range picker).',
          metrics: [
            { lbl: 'Upstream (HTTP client · snake_case)', src: 'jvm',
              desc: 'หา service ต้นทางที่ยิงมาที่ service นี้. Label <code>client_name</code> ใช้ใน Spring Boot ≥ 2.6',
              q: 'sum by (app_name, outcome) (\n  rate(http_client_requests_seconds_count{\n    client_name=~"^<svc>$|^<svc>\\\\..*"\n  }[5m])\n)' },
            { lbl: 'Upstream (HTTP client · camelCase)', src: 'jvm',
              desc: 'variant สำหรับ Spring Boot ≤ 2.5 ที่ยัง emit <code>clientName</code>. Merge กับตัวบนใน PHP',
              q: 'sum by (app_name, outcome) (\n  rate(http_client_requests_seconds_count{\n    clientName=~"^<svc>$|^<svc>\\\\..*"\n  }[5m])\n)' },
            { lbl: 'Upstream (Spring Cloud Gateway)', src: 'jvm',
              desc: 'SCG-based caller (เช่น <code>tmn-mobile-gateway</code>) ไม่ emit http_client → match ที่ routeUri แทน',
              q: 'sum by (app_name, outcome) (\n  rate(spring_cloud_gateway_requests_seconds_count{\n    routeUri=~".*//<svc>\\\\..*"\n  }[5m])\n)' },
            { lbl: 'Downstream (HTTP client, both labels)', src: 'jvm',
              desc: 'service นี้ยิง HTTP call ไปไหนบ้าง. group by ทั้ง <code>client_name</code> + <code>clientName</code> ครอบคลุมทั้ง 2 variant',
              q: 'sum by (uri, method, status, client_name, clientName) (\n  rate(http_client_requests_seconds_count{\n    app_name="<svc>", cluster="<cluster>"\n  }[5m])\n)' },
            { lbl: 'Downstream (SCG routes)', src: 'jvm',
              desc: 'สำหรับ gateway app: routes ที่ต่อไปยัง backend',
              q: 'sum by (routeId, routeUri, httpMethod, httpStatusCode) (\n  rate(spring_cloud_gateway_requests_seconds_count{\n    app_name="<svc>", cluster="<cluster>"\n  }[5m])\n)' },
          ],
          notes: '<b>ข้อจำกัด:</b> RabbitMQ / DB caller ไม่ปรากฏ (คนละ metric family). Upstream regex ใช้ <code>^svc$|^svc\\\\..*</code> — service ที่ถูกเรียกผ่าน DNS alias อื่นจะไม่ match',
        },
        {
          icon: ic.deps,
          title: 'Dependencies Drill (คลิก node → per-URI detail)',
          desc: `เมื่อคลิก node ใน Dependencies graph → drawer เปิดข้าง ๆ แสดง <b>ทุก URI ที่เดินผ่าน edge นั้น</b>
                 พร้อม breakdown per status code + latency avg + latency max + error rate.<br>
                 ใช้เจาะลึกจาก "service A ช้า" → "endpoint /balance ของ A ช้า" → เอา URI ไปหา trace / log ต่อ`,
          metrics: [
            { lbl: 'Per-URI rate + avg + max latency', src: 'jvm',
              desc: `แต่ละแถวใน drill = 1 (method, uri, status) รวมกัน.<br>
                     <b>avg latency</b> = <code>sum(rate(_sum))/sum(rate(_count)) × 1000</code> per URI<br>
                     <b>max latency</b> = <code>max(http_client_requests_seconds_max)</code> per URI = <b>worst single request</b> ที่ Micrometer จับได้<br>
                     Support ทั้ง <code>client_name</code> (snake_case) และ <code>clientName</code> (camelCase) —
                     merge เข้าด้วยกันใน PHP<br>
                     SCG-based deps ใช้ <code>spring_cloud_gateway_requests_seconds_max</code> แทน`,
              q: '# HTTP client (both label variants):\nmax by (method, uri) (http_client_requests_seconds_max{caller,client_name~pat}) * 1000\nmax by (method, uri) (http_client_requests_seconds_max{caller,clientName~pat}) * 1000\n\n# SCG:\nmax by (httpMethod, routeUri) (spring_cloud_gateway_requests_seconds_max{caller,routeUri~pat}) * 1000' },
            { lbl: 'Peak max stat (drill panel header)', src: 'jvm',
              desc: `<b>Peak max</b> = ค่า max ที่สูงที่สุดในแถวทั้งหมดของ edge นี้ = "request ที่ช้าที่สุดใน edge นี้ตลอด 5 นาทีล่าสุด".<br>
                     สีตาม threshold เดียวกับ endpoint max badge (แดง ≥3s / เหลือง ≥1s)<br>
                     Answer คำถาม: "edge นี้เคยช้าสุดกี่วิ?" ได้ในบรรทัดเดียว`,
              q: '# JS-side aggregation:\nMath.max(...rows.map(r => r.latencyMaxMs || 0))' },
            { lbl: 'Grouped by status code (bucketed)', src: 'jvm',
              desc: `Row แต่ละอันขยายเป็น sub-row per status code (200, 400, 500, ...) จาก <code>statusBreakdown[]</code>.
                     Bucket → 5xx (สีแดง), 4xx (เหลือง), 3xx (info), 2xx (ok).<br>
                     Sort หลัก: 5xx → 4xx → 3xx → 2xx (errors bubble up).<br>
                     2xx group collapsed by default (healthy chatter — คลิกกาง)`,
              q: 'sum by (method, uri, status) (rate(http_client_requests_seconds_count{...}[5m]))' },
          ],
          notes: `<b>Cache:</b> dep-drill.php cache 60s ต่อ (caller, target, kind) → refresh drawer ใหม่จะได้ข้อมูลเดิมภายใน 60s`,
        },
        {
          icon: ic.eps,
          title: 'API endpoints (Spring Boot inbound)',
          desc: 'ทุก URI ที่ service นี้รับ request. แยก mapped (จริง) กับ unmapped (UNKNOWN / NOT_FOUND / wildcards ที่ Micrometer aggregate)',
          metrics: [
            { lbl: 'Requests by method + uri + status', src: 'jvm',
              desc: 'aggregate ต่อ endpoint. rate2xx / rate4xx / rate5xx คำนวณโดยจัดกลุ่มใน PHP',
              q: 'sum by (method, uri, status) (\n  rate(http_server_requests_seconds_count{\n    app_name="<svc>", cluster="<cluster>"\n  }[5m])\n)' },
            { lbl: 'Avg latency per endpoint + max sub-line', src: 'jvm',
              desc: `<b>Avg</b> (ตัวเลขใหญ่) = <code>sum(rate(_sum)) / sum(rate(_count)) × 1000</code> per (method, uri).<br>
                     <b>max Xs</b> (บรรทัดเล็กใต้ avg) = <code>max by (method, uri) (http_server_requests_seconds_max) × 1000</code>
                     = duration ของ request ที่ช้าที่สุด <b>ต่อ URI</b> ในช่วง scrape interval.<br>
                     <b>สีของ max badge:</b><br>
                     • สีแดง = max ≥ 3s (มี request จริงค้างเกิน 3 วิ — ops-critical)<br>
                     • สีเหลือง = max ≥ 1s (watch)<br>
                     • สีจาง = max &lt; 1s (healthy)<br>
                     <b>Use case:</b> ตาราง sort by rateTotal desc — URI ที่ traffic เยอะ+max แดง = priority แก้ก่อน`,
              q: '# Avg (per URI):\nsum by (method, uri) (rate(http_server_requests_seconds_sum{...}[5m]))\n/\n(sum by (method, uri) (rate(http_server_requests_seconds_count{...}[5m])) > 0)\n* 1000\n\n# Max (real per-URI worst request from Micrometer _max):\nmax by (method, uri) (http_server_requests_seconds_max{...}) * 1000' },
          ],
        },
        {
          icon: ic.out,
          title: 'Outbound calls (Downstream table)',
          desc: 'ตารางเต็มของทุก HTTP call ที่ service นี้ยิงออก. รวมทั้ง Spring Cloud Gateway routes (source=scg) และ RestTemplate/WebClient (source=http)',
          metrics: [
            { lbl: 'HTTP client per (uri, method, status)', src: 'jvm',
              desc: 'เหมือน Downstream ใน Dependencies section แต่ table format พร้อม latency + status breakdown',
              q: 'sum by (uri, method, status, client_name) (\n  rate(http_client_requests_seconds_count{\n    app_name="<svc>"\n  }[5m])\n)' },
            { lbl: 'SCG routes per (routeId, target, method, status)', src: 'jvm',
              desc: 'จับ dynamic route ที่ routeId เป็น UUID — collapse ตาม routeUri เพื่อไม่ให้ table แน่นเกินไป',
              q: 'sum by (routeId, routeUri, httpMethod, httpStatusCode) (\n  rate(spring_cloud_gateway_requests_seconds_count{\n    app_name="<svc>"\n  }[5m])\n)' },
          ],
        },
        {
          icon: ic.pod,
          title: 'Per pod detail (CPU / MEM per pod + pod table)',
          desc: 'กราฟ multi-line 1 เส้น/pod + ตาราง pod รายตัว. ใช้ตรวจว่า pod ตัวไหนเสียของ (spike / hot pod) ก่อน average จะเห็น',
          metrics: [
            { lbl: 'CPU per pod (time-series)', src: 'kube',
              desc: 'sum by (pod) rate → CPU ของแต่ละ pod ต่อเวลา',
              q: 'sum by (pod) (\n  rate(container_cpu_usage_seconds_total{\n    namespace="<ns>",pod=~"<svc>.*",container="<svc>"\n  }[2m])\n)' },
            { lbl: 'MEM per pod (time-series)', src: 'kube',
              desc: 'group by (pod) → memory ต่อ pod',
              q: 'avg by (pod) (\n  container_memory_working_set_bytes{\n    namespace="<ns>",pod=~"<svc>.*",container="<svc>"\n  }\n)' },
            { lbl: 'Pod table (name / CPU / MEM / phase)', src: 'kube',
              desc: 'instant query — snapshot ปัจจุบันของแต่ละ pod',
              q: 'kube_pod_info{namespace="<ns>",pod=~"<svc>.*"}' },
          ],
        },
        {
          icon: ic.pod,
          title: 'Meta / Runway / Inventory',
          desc: 'ข้อมูล service ที่ไม่ได้มาจาก Prometheus — CSV inventory (uploaded ผ่าน admin) และ runway config',
          metrics: [
            { lbl: 'BU / Team / Severity / Owner', src: 'kube',
              desc: 'อ่านจาก <code>data/sm/service-inventory.csv</code> (SM-shared) — upload ผ่าน <code>admin/service-inventory.html</code>',
              q: '# ไม่ใช่ PromQL — CSV columns: service,bu,team,severity,replicasProd,cpuLimit,memLimit,...' },
            { lbl: 'Runway auto-detect', src: 'kube',
              desc: 'ทดลอง query ทุก source (EKS TMN / EKS NANO / OCP TH) — ตัวไหนเจอ pod matching prefix ก่อน ชนะ',
              q: 'kube_pod_info{\n  namespace=~"<nsRegex>",\n  pod=~"<svc>.*",\n  cluster=~"<clusterRegex>"\n}' },
          ],
        },
      ];
      const dsBadge = (src) => src === 'jvm'
        ? `<span class="sp2-docs-metric-src jvm">jvmDsUid (Thanos OnPrem)</span>`
        : `<span class="sp2-docs-metric-src kube">dsUid (Thanos main)</span>`;
      const renderMetric = (m) => `
        <div class="sp2-docs-metric">
          <div class="sp2-docs-metric-head">
            <span class="sp2-docs-metric-lbl">${esc(m.lbl)}</span>
            ${dsBadge(m.src)}
          </div>
          <div class="sp2-docs-metric-desc">${m.desc}</div>
          <div class="sp2-docs-query">
            <button type="button" class="sp2-docs-copy" title="Copy query"
              onclick="SP._copyDocsQuery(this, ${JSON.stringify(m.q).replace(/"/g,'&quot;')})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            ${esc(m.q)}
          </div>
        </div>`;
      return `
        <div style="padding:10px 12px;background:var(--sp-bg-subtle);border-radius:8px;font-size:11.5px;color:var(--text-muted);line-height:1.6;margin-bottom:16px">
          <strong style="color:var(--text)">Data flow ทั่วไป:</strong> Browser →
          <code>/api/service-performance/detail.php</code> → curl_multi parallel → Grafana datasource proxy
          (<code>&lt;grafanaUrl&gt;/api/datasources/proxy/uid/&lt;dsUid&gt;/api/v1/query</code>) → Thanos.
          Response cache 60s ต่อ (service, range, cluster) ที่ <code>data/sm/service-performance/cache/detail/</code>.
          <br><br>
          <strong style="color:var(--text)">Datasource</strong>:
          <span style="color:var(--emerald)">dsUid</span> = Thanos main (kube-state-metrics + cAdvisor) ·
          <span style="color:var(--violet)">jvmDsUid</span> = Thanos OnPrem (Micrometer /actuator/prometheus)
          <br><br>
          <code>&lt;svc&gt;</code> = ชื่อ service ที่ค้นหา · <code>&lt;ns&gt;</code> = namespace ที่ auto-detect ·
          <code>&lt;cluster&gt;</code> = cluster ที่ pin ไว้ (ผ่าน picker หรือ backend เลือก largest cluster)
        </div>
        ${sections.map(s => `
          <div class="sp2-docs-section">
            <div class="sp2-docs-section-head">
              <span class="icon">${s.icon}</span>
              <span class="sp2-docs-section-title">${esc(s.title)}</span>
            </div>
            <div class="sp2-docs-section-desc">${s.desc}</div>
            ${(s.metrics || []).map(renderMetric).join('')}
            ${s.notes ? `<div class="sp2-docs-notes">${s.notes}</div>` : ''}
          </div>`).join('')}`;
    },

    // Common drill header: kind badge + title + subtitle showing the edge
    // direction (caller → target). Also toggles the "Open service →" button.
    _showDrillShell(kind, caller, target, proto) {
      // sp2-drill container already had `.on` added by openDrill(); this
      // helper only updates the head bar contents.
      const kindLbl = kind === 'upstream'       ? 'UPSTREAM · เรียกโดย'
                    : kind === 'downstream'     ? 'DOWNSTREAM · service นี้เรียก'
                    : kind === 'group-upstream' ? 'GROUP · caller อื่นที่ซ่อนอยู่'
                    :                             'GROUP · ' + (proto || 'http') + ' hosts';
      $('sp2-drill-kind').textContent = kindLbl;
      if (kind === 'group' || kind === 'group-upstream') {
        $('sp2-drill-title').textContent = kind === 'group-upstream'
          ? 'Additional callers'
          : (proto || 'http') + ' downstreams';
        $('sp2-drill-sub').innerHTML = kind === 'group-upstream'
          ? `<span style="opacity:.6">Callers hidden from the graph — click one to drill into its per-URI detail</span>`
          : `${esc(this.currentService)} <span class="arrow">→</span> <span style="opacity:.6">(collapsed nodes from the graph)</span>`;
        $('sp2-drill-open').style.display = 'none';
      } else {
        $('sp2-drill-title').textContent = kind === 'upstream' ? caller : target;
        $('sp2-drill-sub').innerHTML = `${esc(caller)} <span class="arrow">→</span> ${esc(target)}`;
        // Nav button opens the "other end" of the edge (the one that's NOT
        // the currently-loaded service).
        const other = (kind === 'upstream') ? caller : target;
        const knownServices = new Set((SP.suggestions || []).map(s => (s.service || '').toLowerCase()));
        if (knownServices.has(String(other).toLowerCase())) {
          $('sp2-drill-open').style.display = '';
          $('sp2-drill-open').textContent   = 'Open ' + other + ' →';
          $('sp2-drill-open').dataset.svc   = other;
        } else {
          $('sp2-drill-open').style.display = 'none';
        }
      }
    },

    _drillOpenService(ev) {
      ev?.preventDefault?.();
      const svc = $('sp2-drill-open').dataset.svc;
      if (!svc) return;
      this.closeDrill();
      this.navToDep(svc);
    },

    // ── Renderers for the three drill kinds ───────────────────────────

    // Downstream / upstream: per-URI rows from the API. Same shape either way
    // (the caller/target labels differ but the rows table is identical).
    _renderDrillRows(data) {
      const rows = data.rows || [];
      if (!rows.length) {
        $('sp2-drill-body').innerHTML = `<div class="sp2-drill-card sp2-drill-empty">ไม่พบ URI detail สำหรับ edge นี้ในช่วง 5 นาทีล่าสุด</div>`;
        return;
      }
      const totalRate = rows.reduce((a, r) => a + (r.rateTotal || 0), 0);
      const total5xx  = rows.reduce((a, r) => a + (r.rate5xx   || 0), 0);
      const total4xx  = rows.reduce((a, r) => a + (r.rate4xx   || 0), 0);
      const errPct    = totalRate > 0 ? ((total4xx + total5xx) / totalRate * 100) : 0;
      const fmtR = (v) => v == null || v === 0 ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtM = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms');
      const methodColors = {
        GET:'var(--cool)', POST:'var(--emerald)', PUT:'var(--warn)',
        PATCH:'var(--warn)', DELETE:'var(--hot)', HEAD:'var(--sp-text-soft)', OPTIONS:'var(--sp-text-soft)',
      };
      const errClass = errPct >= 5 ? 'hot' : errPct >= 1 ? 'warn' : '';
      const statPills = errPct === 0 ? '' :
        `<div class="sp2-drill-stat ${errClass}"><div class="lbl">Error %</div><div class="val">${errPct.toFixed(2)}%</div></div>`;
      // ── Explode into per-(endpoint × status) entries + bucket by severity.
      // Each row from the backend has a `statusBreakdown[]` — we FLATTEN so
      // one endpoint appears once per HTTP status. Errors bubble to the top
      // of the panel naturally when we render 5xx → 4xx → 3xx → 2xx.
      const buckets = { hot: [], warn: [], info: [], ok: [] };
      rows.forEach(r => {
        const method = r.method || '?';
        const uri    = r.uri;
        const lat    = r.latencyMs;
        const src    = r.source;
        const sbd    = (r.statusBreakdown || []).filter(s => s.rate > 0);
        // If backend didn't send a breakdown, fall back to whichever bucket
        // has non-zero rate — better a single row per endpoint than nothing.
        const latMax = r.latencyMaxMs;
        if (sbd.length === 0 && r.rateTotal > 0) {
          const bucket = r.rate5xx > 0 ? 'hot' : r.rate4xx > 0 ? 'warn' : 'ok';
          buckets[bucket].push({ code: '—', method, uri, rate: r.rateTotal, lat, latMax, src });
          return;
        }
        sbd.forEach(s => {
          const code = parseInt(s.status, 10);
          const bucket = code >= 500 ? 'hot'
                       : code >= 400 ? 'warn'
                       : code >= 300 ? 'info'
                       :                'ok';
          buckets[bucket].push({ code: s.status, method, uri, rate: s.rate, lat, latMax, src });
        });
      });
      // Sort each bucket by rate desc so the loudest offender sits at the top.
      Object.values(buckets).forEach(b => b.sort((a, b) => b.rate - a.rate));

      // Row renderer + method color reused from the header helpers. Shows
      // `avg latency · max latency` on the right — max comes from Micrometer
      // `_max` gauge so 5-30s tail spikes are visible (avg alone smooths
      // them into the mean).
      const renderRow = (item, bucketCls) => {
        const mc = methodColors[item.method] || 'var(--sp-text-soft)';
        const maxCls = item.latMax == null ? '' : item.latMax >= 3000 ? 'hot' : item.latMax >= 1000 ? 'warn' : '';
        const maxColor = maxCls === 'hot' ? 'var(--hot)' : maxCls === 'warn' ? 'var(--warn)' : 'var(--sp-text-soft)';
        const maxHtml = item.latMax != null
          ? ` <span style="color:${maxColor};font-weight:${maxCls ? 600 : 400}" title="Worst single request observed (Micrometer _max gauge) — surfaces spikes the avg hides">max ${fmtM(item.latMax)}</span>`
          : '';
        return `<div class="sp2-drill-erow">
          <span class="code ${bucketCls}">${esc(String(item.code))}</span>
          <span class="method-pill" style="background:color-mix(in srgb, ${mc} 15%, transparent); color:${mc}">${esc(item.method)}</span>
          <span class="uri" title="${esc(item.uri)}">${esc(item.uri)}${item.src === 'scg' ? '<span style="font-size:9.5px;color:var(--sp-text-soft);margin-left:6px">(SCG)</span>' : ''}</span>
          <span class="metrics"><b>${fmtR(item.rate)}</b>/s · avg ${fmtM(item.lat)}${maxHtml}</span>
        </div>`;
      };

      const chev = '<svg class="sp2-drill-group-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

      // Group header + body builder. `collapsed`=true renders a preview
      // sentence (top URIs + total) instead of the full list.
      const buildGroup = (bucket, label, items, opts) => {
        opts = opts || {};
        const total = items.reduce((a, x) => a + (x.rate || 0), 0);
        // Empty group: still show header with "clear ✓" so users can see
        // WHY there's no 5xx list (nothing to worry about) instead of just
        // omitting the section entirely.
        if (!items.length) {
          return `<div class="sp2-drill-group ${bucket}">
            <div class="sp2-drill-group-head">
              <span class="swatch"></span>
              <span class="sp2-drill-group-title">${esc(label)}</span>
              <span class="sp2-drill-group-meta">
                <span>0 endpoints · <b style="color:var(--ok)">clear ✓</b></span>
              </span>
            </div>
          </div>`;
        }
        const collapseCls = opts.collapsed ? 'collapsed' : '';
        const bodyHtml = items.map(item => renderRow(item, bucket)).join('');
        // Collapsed preview: top-3 endpoints + total rate. Enough for
        // eyeballing without expanding the whole 2xx list on healthy services.
        const previewHtml = opts.collapsed
          ? `<div class="sp2-drill-group-collapsed-preview">
              รวม <b>${fmtR(total)} req/s</b> · top: ${items.slice(0, 3).map(x => '<code>' + esc(x.method) + ' ' + esc(x.uri.slice(0, 40)) + (x.uri.length > 40 ? '…' : '') + '</code> (' + fmtR(x.rate) + '/s)').join(', ')}
              — คลิก header เพื่อกาง
            </div>` : '';
        return `<div class="sp2-drill-group ${bucket} ${collapseCls}">
          <div class="sp2-drill-group-head" onclick="this.parentNode.classList.toggle('collapsed')">
            <span class="swatch"></span>
            <span class="sp2-drill-group-title">${esc(label)}</span>
            <span class="sp2-drill-group-meta">
              <span>${items.length} endpoint${items.length !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span><b style="color:var(--text)">${fmtR(total)}</b>/s</span>
              ${chev}
            </span>
          </div>
          ${previewHtml}
          <div class="sp2-drill-group-body">${bodyHtml}</div>
        </div>`;
      };

      // 5xx + 4xx: always expanded (users NEED to see these).
      // 3xx: expanded if present (usually small).
      // 2xx: collapsed by default (healthy chatter — expand on demand).
      const groupsHtml = `
        <div class="sp2-drill-groups">
          ${buildGroup('hot',  '5xx errors',    buckets.hot,  { collapsed: false })}
          ${buildGroup('warn', '4xx errors',    buckets.warn, { collapsed: false })}
          ${buckets.info.length ? buildGroup('info', '3xx redirect', buckets.info, { collapsed: false }) : ''}
          ${buildGroup('ok',   '2xx healthy',   buckets.ok,   { collapsed: buckets.ok.length > 0 })}
        </div>`;

      // Peak max across all URIs of this edge — the single worst-case
      // request timing observed. Coloured hot/warn using the same threshold
      // as the individual row max badges for consistency.
      const peakMax = rows.reduce((a, r) => Math.max(a, r.latencyMaxMs || 0), 0);
      const peakCls = peakMax >= 3000 ? 'hot' : peakMax >= 1000 ? 'warn' : '';
      const peakColor = peakCls === 'hot' ? 'var(--hot)' : peakCls === 'warn' ? 'var(--warn)' : 'var(--text)';
      const peakStat = peakMax > 0
        ? `<div class="sp2-drill-stat ${peakCls}" title="Worst single request across all URIs of this edge (Micrometer _max gauge)"><div class="lbl">Peak max</div><div class="val" style="color:${peakColor}">${fmtM(peakMax)}</div></div>`
        : '';
      $('sp2-drill-body').innerHTML = `
        <div class="sp2-drill-card">
          <div class="sp2-drill-stats">
            <div class="sp2-drill-stat"><div class="lbl">Total rate</div><div class="val">${fmtR(totalRate)}<span style="font-size:11px;color:var(--sp-text-soft);font-weight:500"> /s</span></div></div>
            <div class="sp2-drill-stat"><div class="lbl">Endpoints</div><div class="val">${rows.length}</div></div>
            <div class="sp2-drill-stat"><div class="lbl">Avg latency</div><div class="val">${fmtM(rows.reduce((a, r) => a + (r.latencyMs || 0) * (r.rateTotal || 0), 0) / (totalRate || 1))}</div></div>
            ${peakStat}
            ${statPills || `<div class="sp2-drill-stat"><div class="lbl">Errors</div><div class="val" style="color:var(--ok)">none</div></div>`}
          </div>
          ${groupsHtml}
          ${data.fromCache ? '<div style="text-align:right;margin-top:12px;font-size:10.5px;color:var(--sp-text-soft)">served from 60s cache</div>' : ''}
        </div>`;
    },

    // Grouped-pill drill: no fetch needed — we already have all the rows in
    // d.app.downstream or d.app.upstream, they were just hidden from the
    // graph. Direction toggles which list we filter + which columns show.
    _renderDrillGroup(proto, direction) {
      const d = this._lastDetail;
      if (!d) { $('sp2-drill-body').innerHTML = `<div class="sp2-drill-empty">no data</div>`; return; }
      // Upstream group: single flat list of caller services (all "http" for
      // now since RabbitMQ/DB callers can't be detected from HTTP metrics).
      if (direction === 'upstream') {
        const upSorted = (d.app?.upstream || []).slice().sort((a, b) => (b.rateTotal || 0) - (a.rateTotal || 0));
        const fmtR = (v) => v == null || v === 0 ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
        const total = upSorted.reduce((a, r) => a + (r.rateTotal || 0), 0);
        const rowsHtml = upSorted.map(r => {
          const errCls = r.errorPct == null || r.errorPct === 0 ? '' : r.errorPct >= 5 ? 'hot' : r.errorPct >= 1 ? 'warn' : '';
          // Drill is unconditional — needs just the caller name string;
          // no inventory match required. Inventory only gates the panel's
          // "Open service →" nav button.
          return `<tr onclick="SP.openDrill('upstream', ${JSON.stringify(r.service).replace(/"/g,'&quot;')}, 'http')" style="cursor:pointer" title="Click to drill URI-level detail">
            <td><span class="name" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px">${esc(r.service)}</span></td>
            <td class="right" style="width:80px"><b>${fmtR(r.rateTotal)}</b><span style="color:var(--sp-text-soft);font-size:10.5px"> /s</span></td>
            <td class="right" style="width:70px">${r.errorPct > 0 ? `<span style="color:var(${errCls === 'hot' ? '--hot' : errCls === 'warn' ? '--warn' : '--text-muted'});font-weight:600">${r.errorPct.toFixed(1)}%</span>` : '<span style="color:var(--sp-text-soft)">—</span>'}</td>
          </tr>`;
        }).join('') || `<tr><td colspan="3" style="text-align:center;color:var(--sp-text-soft);padding:20px">no rows</td></tr>`;
        $('sp2-drill-body').innerHTML = `
          <div class="sp2-drill-card">
            <div class="sp2-drill-stats">
              <div class="sp2-drill-stat"><div class="lbl">Callers</div><div class="val">${upSorted.length}</div></div>
              <div class="sp2-drill-stat"><div class="lbl">Total rate</div><div class="val">${fmtR(total)}<span style="font-size:11px;color:var(--sp-text-soft);font-weight:500"> /s</span></div></div>
              <div class="sp2-drill-stat"><div class="lbl">Direction</div><div class="val" style="font-size:12px">upstream</div></div>
              <div class="sp2-drill-stat"><div class="lbl">Errors</div><div class="val" style="color:var(${upSorted.some(r => (r.errorPct||0) >= 1) ? '--warn' : '--ok'})">${upSorted.filter(r => (r.errorPct||0) >= 1).length}</div></div>
            </div>
            <div class="sp2-drill-groupbar">คลิกแต่ละ row เพื่อ drill ต่อ (URI-level detail ของ caller นั้น)</div>
            <table class="sp2-drill-tbl">
              <thead><tr><th>Caller service</th><th class="right">Rate</th><th class="right">Err %</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>`;
        return;
      }
      // Downstream group: filter by protocol, then collapse per target
      // service (multiple URIs to the same target collapse into one row).
      const rows = (d.app?.downstream || [])
        .filter(r => (r.protocol || 'http') === proto)
        .sort((a, b) => (b.rateTotal || 0) - (a.rateTotal || 0));
      // Group by service (so multiple URIs to the same target collapse into
      // one row here). The "individual nodes" step already showed the top-K
      // per service — here we present ALL of them sorted.
      const perSvc = new Map();
      for (const r of rows) {
        const key = (r.targetService || _depsFallbackName(r.target) || r.target || '(unknown)').toLowerCase();
        if (!perSvc.has(key)) perSvc.set(key, { name: r.targetService || _depsFallbackName(r.target), target: r.target, rate: 0, uris: 0, err5xx: 0, err4xx: 0 });
        const agg = perSvc.get(key);
        agg.rate   += r.rateTotal || 0;
        agg.uris   += 1;
        agg.err5xx += r.rate5xx || 0;
        agg.err4xx += r.rate4xx || 0;
      }
      const svcRows = [...perSvc.values()].sort((a, b) => b.rate - a.rate);
      const fmtR = (v) => v == null || v === 0 ? '—' : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const totalRate = svcRows.reduce((a, r) => a + r.rate, 0);
      const rowsHtml = svcRows.map(r => {
        const errPct = r.rate > 0 ? ((r.err4xx + r.err5xx) / r.rate * 100) : 0;
        const errCls = errPct >= 5 ? 'hot' : errPct >= 1 ? 'warn' : '';
        // Drill is always available — it just needs a service-name string
        // to feed the regex on the backend. Inventory match only decides
        // whether the "Open service →" nav button appears IN the panel.
        return `<tr onclick="SP.openDrill('downstream', ${JSON.stringify(r.name).replace(/"/g,'&quot;')}, '${esc(proto)}')" style="cursor:pointer" title="Click to drill URI-level detail">
          <td>
            <span class="name" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px">${esc(r.name)}</span>
            <span style="color:var(--sp-text-soft);font-size:10.5px;margin-left:6px">${r.uris} URI${r.uris !== 1 ? 's' : ''}</span>
          </td>
          <td class="right" style="width:80px"><b>${fmtR(r.rate)}</b><span style="color:var(--sp-text-soft);font-size:10.5px"> /s</span></td>
          <td class="right" style="width:70px">${errPct > 0 ? `<span style="color:var(${errCls === 'hot' ? '--hot' : errCls === 'warn' ? '--warn' : '--text-muted'});font-weight:600">${errPct.toFixed(1)}%</span>` : '<span style="color:var(--sp-text-soft)">—</span>'}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="3" style="text-align:center;color:var(--sp-text-soft);padding:20px">no rows</td></tr>`;
      $('sp2-drill-body').innerHTML = `
        <div class="sp2-drill-card">
          <div class="sp2-drill-stats">
            <div class="sp2-drill-stat"><div class="lbl">Services</div><div class="val">${svcRows.length}</div></div>
            <div class="sp2-drill-stat"><div class="lbl">Total rate</div><div class="val">${fmtR(totalRate)}<span style="font-size:11px;color:var(--sp-text-soft);font-weight:500"> /s</span></div></div>
            <div class="sp2-drill-stat"><div class="lbl">Protocol</div><div class="val" style="font-size:12px">${esc(proto)}</div></div>
            <div class="sp2-drill-stat"><div class="lbl">Total URIs</div><div class="val">${svcRows.reduce((a, r) => a + r.uris, 0)}</div></div>
          </div>
          <div class="sp2-drill-groupbar">คลิกแต่ละ row เพื่อ drill ต่อ (URI-level detail ของ service นั้น)</div>
          <table class="sp2-drill-tbl">
            <thead><tr><th>Service</th><th class="right">Rate</th><th class="right">Err %</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;
    },

    // Common HTTP status text (kept minimal — only codes we actually see in
    // TrueMoney backends). Fallback returns empty so the pill stays compact
    // when we hit an unusual code.
    _statusText(code) {
      const map = {
        200:'OK', 201:'Created', 202:'Accepted', 204:'No Content',
        301:'Moved', 302:'Found', 304:'Not Modified',
        400:'Bad Request', 401:'Unauthorized', 403:'Forbidden', 404:'Not Found',
        405:'Method Not Allowed', 409:'Conflict', 422:'Unprocessable', 429:'Too Many Requests',
        500:'Internal Error', 501:'Not Implemented', 502:'Bad Gateway',
        503:'Service Unavailable', 504:'Gateway Timeout',
      };
      return map[parseInt(code, 10)] || '';
    },

    // Build sub-rows for a row's statusBreakdown[]. Each status code becomes
    // its own indented row with its own rate, share of endpoint total, and
    // (optional) per-status Explore link. The parent row above shows just the
    // aggregate — so users see the endpoint total first, then the individual
    // status codes contributing to it broken out separately.
    _statusSubRows(row, promqlBuilder) {
      const items = (row.statusBreakdown || []).filter(s => s.rate > 0);
      if (!items.length) return '';
      const totalRate = row.rateTotal || items.reduce((a, s) => a + s.rate, 0);
      return items.map(s => {
        const code = parseInt(s.status, 10);
        const cls  = code >= 500 ? 'hot' : code >= 400 ? 'warn' : code >= 300 ? 'info' : 'ok';
        const pct  = totalRate > 0 ? (s.rate / totalRate * 100) : 0;
        const rateFmt = s.rate >= 10 ? s.rate.toFixed(1) : s.rate.toFixed(2);
        const desc = this._statusText(s.status);
        const explore = promqlBuilder ? promqlBuilder(s.status) : '';
        return `<tr class="sp2-ep-sub ${cls}">
          <td class="sp2-ep-sub-cell">
            <span class="sp2-ep-sub-connector"></span>
            <span class="sp2-ep-status-pill ${cls}">${esc(s.status)}</span>
            <span class="sp2-ep-sub-desc">${esc(desc)}</span>
            <span class="sp2-ep-sub-bar">
              <span class="sp2-ep-sub-bar-fill ${cls}" style="width:${pct.toFixed(1)}%"></span>
            </span>
          </td>
          <td class="right mono">${rateFmt}<span style="color:var(--sp-text-soft);font-size:10.5px"> /s</span></td>
          <td class="right mono" style="color:var(--sp-text-soft);font-size:11px">${pct.toFixed(0)}%</td>
          <td class="right" style="width:32px">
            ${explore ? `<a class="sp2-ep-explore" href="${esc(explore)}" target="_blank" rel="noopener" title="Explore just this status (${s.status})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </a>` : ''}
          </td>
        </tr>`;
      }).join('');
    },

    // ── Per-endpoint request breakdown (Spring Boot) ───────────────────────
    // Full-width table listing every HTTP path the service is handling.
    // Split into:
    //   • Mapped endpoints — real controller routes (main table, always visible)
    //   • Unmapped noise  — UNKNOWN/NOT_FOUND/wildcards, collapsed by default
    //                       because scanners generate a lot of 404 traffic that
    //                       isn't actionable for the app team
    // Each row shows the per-status-code breakdown as pills, so instead of a
    // single "4xx: 40.36" cell you see "400 × 30 · 404 × 10.36".
    _endpointsSection(endpoints, service, runway) {
      const winLbl = this.customStart
        ? fmtCustomRange(this.customStart, this.customEnd)
        : 'last ' + fmtWindow(this.windowMinutes);
      const fmtRate = (v) => v == null || v === 0 ? '—' : (v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtMs   = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms');
      const methodColors = {
        GET:'var(--cool)', POST:'var(--emerald)', PUT:'var(--warn)',
        PATCH:'var(--warn)', DELETE:'var(--hot)', HEAD:'var(--sp-text-soft)', OPTIONS:'var(--sp-text-soft)',
      };
      // Micrometer aggregates unmapped requests to these synthetic labels.
      // Split them out so the main table stays actionable.
      const NOISE = new Set(['UNKNOWN', 'NOT_FOUND', '/**', '/*', '']);
      const mapped   = endpoints.filter(e => !NOISE.has(e.uri));
      const unmapped = endpoints.filter(e =>  NOISE.has(e.uri));

      // Each endpoint gets its own <tbody> so we can collapse parent + subs
      // as one unit (`.sp2-ep-tbody.on` = expanded). Parent row is a click
      // target — the whole row toggles, not just the chevron, since 4xx/5xx
      // rows are the ones ops want to dig into fastest.
      const rowHtml = (ep, epIdx) => {
        const rowCls = ep.rate5xx > 0 ? 'sp2-ep-row hot'
                     : ep.rate4xx > 0 ? 'sp2-ep-row warn'
                     : 'sp2-ep-row';
        const mc = methodColors[ep.method] || 'var(--sp-text-soft)';
        // Build a per-endpoint Explore link that jumps to Grafana Explore with
        // a query filtered to this exact method + uri. Uses jvmDsUid because
        // the metric lives on the JVM datasource.
        const exprUri    = ep.uri.replace(/"/g, '\\"');
        const exprMethod = ep.method.replace(/"/g, '\\"');
        const cluster    = this.currentCluster || runway?.cluster || '';
        const clusterSel = cluster.includes('|') ? `cluster=~"${cluster}"` : `cluster="${cluster}"`;
        const baseSel    = `app_name="${service}",${clusterSel},method="${exprMethod}",uri="${exprUri}"`;
        const promql        = `sum by (status) (rate(http_server_requests_seconds_count{${baseSel}}[5m]))`;
        const latencyExprs  = [
          { expr: `sum(rate(http_server_requests_seconds_sum{${baseSel}}[5m])) / sum(rate(http_server_requests_seconds_count{${baseSel}}[5m])) * 1000`, legend: 'avg (ms)' },
          { expr: `max(http_server_requests_seconds_max{${baseSel}}) * 1000`, legend: 'max (ms)' },
        ];
        const exploreUrl        = runway?.jvmDsUid ? this._buildExploreUrl(runway, service, null, promql, runway.jvmDsUid) : '';
        const exploreLatencyUrl = runway?.jvmDsUid ? this._buildExploreUrl(runway, service, null, latencyExprs, runway.jvmDsUid) : '';
        // Per-status Explore link factory — used by _statusSubRows
        const subPromqlBuilder = runway?.jvmDsUid ? (status) => {
          const st = String(status).replace(/"/g, '\\"');
          const q = `rate(http_server_requests_seconds_count{app_name="${service}",${clusterSel},method="${exprMethod}",uri="${exprUri}",status="${st}"}[5m])`;
          return this._buildExploreUrl(runway, service, null, q, runway.jvmDsUid);
        } : null;
        const hasSubs = (ep.statusBreakdown || []).filter(s => s.rate > 0).length > 0;
        const parentRow = `<tr class="${rowCls} sp2-ep-parent" onclick="SP.toggleEndpoint(this)">
          <td>
            <span class="sp2-ep-chev" title="${hasSubs ? 'Click to expand status breakdown' : 'No status breakdown available'}">
              ${hasSubs ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' : ''}
            </span>
            <span class="sp2-ep-method" style="background:color-mix(in srgb,${mc} 15%,transparent);color:${mc}">${esc(ep.method || '?')}</span>
            <span class="sp2-ep-uri mono" title="${esc(ep.uri)}">${esc(ep.uri)}</span>
          </td>
          <td class="right mono"><b>${fmtRate(ep.rateTotal)}</b><span style="color:var(--sp-text-soft);font-size:10.5px"> /s</span></td>
          <td class="right mono sp2-ep-lat-cell">
            ${fmtMs(ep.latencyMs)}
            ${(ep.latencyP95Ms != null || ep.latencyP99Ms != null) ? `
              <div style="font-size:10px;color:var(--sp-text-soft);margin-top:1px;line-height:1.2" title="Percentiles from histogram buckets (histogram_quantile)&#10;p95 = 95% of requests finished under this&#10;p99 = 99% of requests finished under this&#10;&#10;SLO-friendly: 'p99 < 500ms' is the metric ops usually own">
                ${ep.latencyP95Ms != null ? `p95 <span style="color:${ep.latencyP95Ms >= 1000 ? 'var(--hot)' : ep.latencyP95Ms >= 500 ? 'var(--warn)' : 'var(--text)'};font-weight:${ep.latencyP95Ms >= 500 ? 600 : 500}">${fmtMs(ep.latencyP95Ms)}</span>` : ''}
                ${ep.latencyP95Ms != null && ep.latencyP99Ms != null ? ' · ' : ''}
                ${ep.latencyP99Ms != null ? `p99 <span style="color:${ep.latencyP99Ms >= 2000 ? 'var(--hot)' : ep.latencyP99Ms >= 1000 ? 'var(--warn)' : 'var(--text)'};font-weight:${ep.latencyP99Ms >= 1000 ? 600 : 500}">${fmtMs(ep.latencyP99Ms)}</span>` : ''}
              </div>` : ''}
            ${ep.latencyMaxMs != null ? `
              <div style="font-size:10px;color:${ep.latencyMaxMs >= 3000 ? 'var(--hot)' : ep.latencyMaxMs >= 1000 ? 'var(--warn)' : 'var(--sp-text-soft)'};font-weight:${ep.latencyMaxMs >= 1000 ? 600 : 400};margin-top:1px;line-height:1.2" title="Worst single request observed (Micrometer http_server_requests_seconds_max) — surfaces spikes the avg hides">
                max ${fmtMs(ep.latencyMaxMs)}
              </div>` : ''}
          </td>
          <td class="right sp2-ep-explore-cell" style="width:56px;white-space:nowrap">
            ${exploreUrl ? `<a class="sp2-ep-explore" href="${esc(exploreUrl)}" target="_blank" rel="noopener" title="Grafana Explore · Total req/s by status" onclick="event.stopPropagation()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </a>` : ''}
            ${exploreLatencyUrl ? `<a class="sp2-ep-explore" href="${esc(exploreLatencyUrl)}" target="_blank" rel="noopener" title="Grafana Explore · Avg + Max latency (ms)" onclick="event.stopPropagation()" style="margin-left:4px">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
            </a>` : ''}
          </td>
        </tr>`;
        return `<tbody class="sp2-ep-tbody">${parentRow}${this._statusSubRows(ep, subPromqlBuilder)}</tbody>`;
      };

      const mappedRows   = mapped.map(rowHtml).join('')
        || `<tbody><tr><td colspan="4" style="padding:20px;text-align:center;color:var(--sp-text-soft)">no mapped endpoints</td></tr></tbody>`;
      const unmappedRows = unmapped.map(rowHtml).join('');

      // Summary badges — count endpoints with any error
      const total5xx = mapped.filter(e => e.rate5xx > 0).length + unmapped.filter(e => e.rate5xx > 0).length;
      const total4xx = mapped.filter(e => e.rate4xx > 0 && e.rate5xx === 0).length + unmapped.filter(e => e.rate4xx > 0 && e.rate5xx === 0).length;
      const badges = [];
      if (total5xx > 0) badges.push(`<span class="sp2-ep-badge hot">${total5xx} with 5xx</span>`);
      if (total4xx > 0) badges.push(`<span class="sp2-ep-badge warn">${total4xx} with 4xx</span>`);

      const headHtml = `
        <thead>
          <tr>
            <th>Endpoint <span style="color:var(--sp-text-soft);font-weight:400;font-size:10px;text-transform:none;letter-spacing:0">· status pills show 4xx/5xx breakdown</span></th>
            <th class="right" style="width:110px">Total</th>
            <th class="right" style="width:110px">Avg latency</th>
            <th class="right" style="width:56px"></th>
          </tr>
        </thead>`;

      // Unmapped section is a native <details> so it starts collapsed and the
      // user can expand without extra JS state management. Note: `mappedRows`
      // / `unmappedRows` already emit their own <tbody> per endpoint, so we
      // do NOT wrap them in an outer <tbody> here.
      const unmappedBlock = unmapped.length ? `
        <details class="sp2-ep-unmapped">
          <summary>
            <span class="sp2-ep-unmapped-title">Unmapped (${unmapped.length})</span>
            <span class="sp2-ep-unmapped-hint">UNKNOWN / NOT_FOUND / wildcards — Micrometer aggregates unmatched routes here to prevent cardinality blow-up. Mostly URL scanners; not actionable per-path.</span>
          </summary>
          <table class="sp2-tbl sp2-ep-tbl">${headHtml}${unmappedRows}</table>
        </details>` : '';

      return `
        <div class="sp2-card">
          <div class="sp2-card-head">
            <div class="sp2-card-title">API endpoints <span style="color:var(--sp-text-soft);font-weight:400;font-size:11px">· ${winLbl}</span></div>
            <div style="margin-left:auto;display:flex;gap:10px;align-items:center">
              ${badges.join('')}
              <span style="font-size:11px;color:var(--sp-text-soft)">${mapped.length} mapped · ${unmapped.length} unmapped</span>
              <button type="button" class="sp2-btn" style="padding:4px 10px;font-size:11px" onclick="SP.toggleAllEndpoints(this)" data-state="collapsed">Expand all</button>
            </div>
          </div>
          <table class="sp2-tbl sp2-ep-tbl">${headHtml}${mappedRows}</table>
          ${unmappedBlock}
        </div>`;
    },

    // Convenience: expand or collapse every endpoint tbody in a single click.
    // Toggles state on the button itself so the label reflects the next action.
    toggleAllEndpoints(btn) {
      const expand = btn.dataset.state !== 'expanded';
      document.querySelectorAll('.sp2-ep-tbody').forEach(tb => {
        tb.classList.toggle('on', expand);
        const p = tb.querySelector('.sp2-ep-parent');
        if (p) p.classList.toggle('on', expand);
      });
      btn.dataset.state = expand ? 'expanded' : 'collapsed';
      btn.textContent   = expand ? 'Collapse all' : 'Expand all';
    },

    // ── Downstream calls (outbound HTTP) ─────────────────────────────────
    // For gateway/proxy services, this is the ONLY view where you see the
    // real downstream URIs. Two data sources feed the same table:
    //   • source='scg'  — Spring Cloud Gateway routes (target=routeId,
    //                     path=routeUri which is the target base URL)
    //   • source='http' — Generic Spring HTTP client (target=client_name
    //                     host, path=uri which is the actual endpoint path)
    // Grouped by (target) so gateway routes clump together and you can see
    // which downstream service is failing per route.
    // ── Error Focus (standalone section) ────────────────────────────
    // Its own section (not nested inside Outbound calls) because SP2's
    // downstream aggregator often returns [] even when http_client
    // metrics exist — especially on OCP. We query Prometheus directly.
    _errorFocusSectionHtml(service) {
      const winLbl = this.customStart
        ? fmtCustomRange(this.customStart, this.customEnd)
        : 'last ' + fmtWindow(this.windowMinutes);
      return `
        <div class="sp2-card sp2-ef-card" data-ef-service="${esc(service)}">
          <div class="sp2-card-head">
            <div class="sp2-card-title">Error Focus <span id="sp2-ef-winlbl" style="color:var(--sp-text-soft);font-weight:400;font-size:11px">· ${winLbl} · grouped by (endpoint, status)</span><i class="sp2-help-icon" data-icon="help-circle" title="Downstream error breakdown — เห็น endpoint ไหนพัง status อะไร กี่ครั้ง&#10;&#10;ใช้ metric http_client_requests_seconds_count + intx_status (sub-code จาก INTX gateway)&#10;คลิก row ใดๆ เพื่อดู stacked chart รายนาที + Log Explorer deep-link"></i></div>
            <div class="sp2-ef-summary" id="sp2-ef-summary"><span class="sp2-ef-chip na"><span class="dot"></span>Loading…</span></div>
          </div>
          <div id="sp2-ef-body">
            <div class="sp2-ef-empty"><span class="sp2-skel" style="display:inline-block;height:12px;width:180px;vertical-align:middle;margin-right:8px"></span>fetching error breakdown…</div>
          </div>
        </div>`;
    },

    // Grabs http_client_requests error breakdown from
    // api/downstream-health/breakdown.php. Shares SP2's global range
    // (this.windowMinutes) so this card stays in sync with SP2 charts.
    async _loadErrorFocus() {
      const svc = this.currentService;
      const body = document.getElementById('sp2-ef-body');
      const sum  = document.getElementById('sp2-ef-summary');
      const lbl  = document.getElementById('sp2-ef-winlbl');
      if (!svc || !body) return;
      // Refresh title so range changes (esp. Custom picker) are visible.
      if (lbl) {
        const winLbl = (this.customStart && this.customEnd)
          ? fmtCustomRange(this.customStart, this.customEnd)
          : 'last ' + fmtWindow(this.windowMinutes);
        lbl.textContent = ' · ' + winLbl + ' · grouped by (endpoint, status)';
      }
      // Track a token so a stale response from a previous service can't
      // overwrite the current view (fast service switches would otherwise
      // race and paint the wrong data).
      this._efGen = (this._efGen || 0) + 1;
      const myGen = this._efGen;

      const range = String(this.windowMinutes || 60); // minutes → dhParseRange
      // Pass absolute window when SP2's Custom picker is active — otherwise
      // this card would always show relative-to-now data and diverge from the
      // rest of the page (charts, chips) which honour customStart/customEnd.
      const opts = (this.customStart && this.customEnd)
        ? { start: this.customStart, end: this.customEnd }
        : {};
      try {
        const res = await API.downstreamHealth.breakdown(svc, range, opts);
        if (myGen !== this._efGen) return;
        const d = (res && res.data && res.data.data) ? res.data.data : ((res && res.data) ? res.data : res);
        this._efData = d;
        this._renderErrorFocus(d);
      } catch (e) {
        if (myGen !== this._efGen) return;
        body.innerHTML = `<div class="sp2-ef-empty">Error: ${esc(String(e.message || e))}</div>`;
        if (sum) sum.innerHTML = '<span class="sp2-ef-chip na"><span class="dot"></span>error</span>';
      }
    },

    _renderErrorFocus(d) {
      const body = document.getElementById('sp2-ef-body');
      const sum  = document.getElementById('sp2-ef-summary');
      if (!body) return;
      // No http_client metrics at all → the section adds noise. Hide it
      // and its nav pill (mirrors _hideSubsystemSection behaviour).
      if (!d || !d.found) { this._hideErrorFocusSection(); return; }
      const endpoints = d.endpoints || [];
      // No outbound errors AND no traffic → hide (nothing to show).
      // Some traffic but 0 errors → keep visible (green chip is useful).
      const anyTraffic = endpoints.some(e => (e.total || 0) > 0);
      if (!anyTraffic) { this._hideErrorFocusSection(); return; }
      if (!endpoints.length) {
        body.innerHTML = `<div class="sp2-ef-empty">No outbound calls observed in the last ${esc(d.range || '')}</div>`;
        if (sum) sum.innerHTML = '<span class="sp2-ef-chip ok"><span class="dot"></span>0 errors</span>';
        return;
      }
      // Aggregate summary
      let totalErr = 0, totalReq = 0, hot = 0;
      endpoints.forEach(e => {
        totalErr += e.errorCount || 0;
        totalReq += e.total || 0;
        if ((e.errorRate || 0) >= 5) hot++;
      });
      const rate = totalReq > 0 ? (totalErr / totalReq * 100) : 0;
      const rateCls = rate >= 5 ? 'hot' : (rate >= 1 ? 'wr' : 'ok');
      if (sum) {
        sum.innerHTML = [
          hot > 0 ? `<span class="sp2-ef-chip hot"><span class="dot"></span>${hot} hot</span>` : '',
          `<span class="sp2-ef-chip na"><span class="dot"></span>${_efFmt(totalErr)} errors / ${_efFmt(totalReq)} total</span>`,
          `<span class="sp2-ef-chip ${rateCls}"><span class="dot"></span>${_efPct(rate)} error rate</span>`,
        ].filter(Boolean).join('');
      }
      // Rows
      const rowsHtml = endpoints.map(e => this._efRow(e)).join('');
      body.innerHTML = `
        <table class="sp2-ef-tbl">
          <thead>
            <tr>
              <th style="width:56%">Endpoint</th>
              <th style="width:14%;text-align:right">Errors</th>
              <th style="width:14%;text-align:right">Total</th>
              <th style="width:16%;text-align:right">Error rate</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
      // Wire clicks (delegated)
      body.querySelectorAll('tr.ef-row').forEach(tr =>
        tr.addEventListener('click', () => this._toggleErrorFocusRow(tr)));
    },

    _efRow(e) {
      const badgeCls = e.errorRate == null ? 'na'
                     : e.errorRate >= 5 ? ''
                     : e.errorRate >= 1 ? 'wr' : 'ok';
      return `
        <tr class="ef-row" data-ep="${esc(e.endpoint)}">
          <td>
            <div class="sp2-ef-ep">
              <svg class="sp2-ef-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>
              <span>${esc(e.endpoint)}</span>
            </div>
          </td>
          <td class="num"><strong>${_efFmt(e.errorCount)}</strong></td>
          <td class="num">${_efFmt(e.total)}</td>
          <td class="num"><span class="sp2-ef-badge ${badgeCls}">${_efPct(e.errorRate)}</span></td>
        </tr>`;
    },

    async _toggleErrorFocusRow(tr) {
      const next = tr.nextElementSibling;
      // Already open → collapse
      if (next && next.classList.contains('sp2-ef-sub')) {
        next.remove();
        tr.classList.remove('open');
        return;
      }
      // One-at-a-time: close any other open row + its sub-row
      const table = tr.closest('table');
      table.querySelectorAll('tr.sp2-ef-sub').forEach(n => n.remove());
      table.querySelectorAll('tr.ef-row.open').forEach(n => n.classList.remove('open'));
      tr.classList.add('open');

      const ep = tr.dataset.ep;
      const ep0 = (this._efData?.endpoints || []).find(x => x.endpoint === ep);
      const sub = document.createElement('tr');
      sub.className = 'sp2-ef-sub';
      sub.innerHTML = `<td colspan="4"><div class="sp2-ef-empty"><span class="sp2-skel" style="display:inline-block;height:12px;width:120px;vertical-align:middle;margin-right:8px"></span>loading detail…</div></td>`;
      tr.parentNode.insertBefore(sub, tr.nextSibling);

      let ts = null;
      const tsOpts = (this.customStart && this.customEnd)
        ? { start: this.customStart, end: this.customEnd }
        : {};
      try {
        const res = await API.downstreamHealth.timeseries(
          this.currentService, ep, String(this.windowMinutes || 60), tsOpts);
        ts = (res && res.data && res.data.data) ? res.data.data : ((res && res.data) ? res.data : res);
      } catch (e) {
        ts = { series: [], error: String(e.message || e) };
      }
      // Build sub-row content with SP2-native chart slot (auto-painted).
      const statusRows = (ep0?.statuses || []).map(s => {
        // Micrometer emits `exception="none"` when the call succeeded at the
        // transport layer — surface it only when it's a real exception name.
        const excStr = String(s.exception || '').trim();
        const showExc = excStr && excStr.toLowerCase() !== 'none';
        const exc = showExc ? ` <span style="color:var(--sp-text-soft);font-size:10.5px">(${esc(excStr)})</span>` : '';
        return `<tr><td><span class="sp2-ef-badge">${esc(s.status)}</span>${exc}</td><td class="n">${_efFmt(s.count)}</td></tr>`;
      }).join('');
      // Transform timeseries points into the sp2-chart-slot "multi" format:
      // each series: { pod: <status label>, points: [[unixMs, val], ...] }
      const chartSeries = (ts?.series || []).map(s => ({
        pod: s.status || '?',
        points: (s.points || []).map(p => [p[0] * 1000, p[1]]),
      })).filter(s => s.points.length);
      const chartJson = JSON.stringify(chartSeries).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
      const chartHtml = chartSeries.length
        ? `<div class="sp2-chart-slot" data-chart="multi" data-series='${chartJson}' data-unit="reqs" style="height:200px"></div>`
        : `<div class="sp2-ef-empty" style="padding:14px 0">No error time-series in this range.</div>`;

      const logUrl = `log-explorer.html?service=${encodeURIComponent(this.currentService)}&path=${encodeURIComponent(ep)}&range=${encodeURIComponent(String(this.windowMinutes || 60) + 'm')}`;

      sub.querySelector('td').innerHTML = `
        <div class="sp2-ef-sub-grid">
          <div>
            <div class="sp2-ef-chart-head">By status</div>
            <table class="sp2-ef-status-tbl">${statusRows || '<tr><td colspan="2" style="color:var(--sp-text-soft)">No error rows</td></tr>'}</table>
            <a class="sp2-ef-drill" href="${logUrl}">Open in Log Explorer →</a>
          </div>
          <div>
            <div class="sp2-ef-chart-head">Errors per minute · stacked by status</div>
            ${chartHtml}
          </div>
        </div>`;
      // Trigger SP2 chart paint for the freshly-inserted slot.
      if (chartSeries.length && typeof paintCharts === 'function') paintCharts();
    },

    _reloadErrorFocusIfOpen() {
      if (document.getElementById('sp2-ef-body')) this._loadErrorFocus();
    },

    // Hide the whole Error Focus section (card + nav pill). Called when
    // Prometheus returns no http_client_requests data for the service.
    _hideErrorFocusSection() {
      const sec = document.getElementById('sp2-la-sec-error-focus');
      if (sec) sec.remove();
      const nav = document.querySelector('.sp2-la-nav-btn[data-la-nav="error-focus"]');
      if (nav) nav.remove();
      if (this._setupScrollSpy) this._setupScrollSpy();
    },

    _downstreamSection(rows, service, runway) {
      const winLbl = this.customStart
        ? fmtCustomRange(this.customStart, this.customEnd)
        : 'last ' + fmtWindow(this.windowMinutes);
      const fmtRate = (v) => v == null || v === 0 ? '—' : (v >= 10 ? v.toFixed(1) : v.toFixed(2));
      const fmtMs   = (v) => v == null ? '—' : (v >= 1000 ? (v/1000).toFixed(2) + ' s' : v.toFixed(0) + ' ms');
      const methodColors = {
        GET:'var(--cool)', POST:'var(--emerald)', PUT:'var(--warn)',
        PATCH:'var(--warn)', DELETE:'var(--hot)', HEAD:'var(--sp-text-soft)', OPTIONS:'var(--sp-text-soft)',
      };
      // Truncate very long URIs from the middle so both host and endpoint remain visible
      const truncatePath = (p, max = 62) => {
        if (!p || p.length <= max) return p;
        const head = Math.ceil(max * 0.55);
        const tail = max - head - 1;
        return p.slice(0, head) + '…' + p.slice(-tail);
      };

      // Extract "hostname:port" from a URL for compact display when the full
      // URI is too long. Keeps protocol + host + port only.
      const shortHost = (url) => {
        if (!url) return url;
        const m = url.match(/^(https?:\/\/)([^\/]+)/i);
        return m ? m[2] : url;
      };

      const rowHtml = (r) => {
        const rowCls = r.rate5xx > 0 ? 'sp2-ep-row hot'
                     : r.rate4xx > 0 ? 'sp2-ep-row warn'
                     : 'sp2-ep-row';
        const mc = methodColors[r.method] || 'var(--sp-text-soft)';
        // "Source" mini-tag distinguishes SCG routes from raw http_client calls
        const srcTag = r.source === 'scg'
          ? `<span class="sp2-ds-src scg" title="Spring Cloud Gateway route (proxy routing config)">SCG</span>`
          : `<span class="sp2-ds-src http" title="Spring HTTP client (RestTemplate / WebClient outbound call)">HTTP</span>`;
        // Grouped rows carry the routeUri as target. Render a clearer label:
        //   • "hostname · N dynamic routes"
        //   • path underneath = full URL for hover
        const isGrouped = r.grouped && r.dynamicCount > 1;
        const targetLabel = isGrouped
          ? `${esc(shortHost(r.target))} <span class="sp2-ds-dynamic-tag" title="${r.dynamicCount} dynamically-registered SCG routes all target this host — routeIds are UUIDs so they were merged into one row for readability">${r.dynamicCount} dynamic routes</span>`
          : esc(r.target || '—');
        // Explore per-row link — different metric per source
        const cluster    = this.currentCluster || runway?.cluster || '';
        const clusterSel = cluster.includes('|') ? `cluster=~"${cluster}"` : `cluster="${cluster}"`;
        let promql = '';
        let statusLabel = '';   // label used in the per-status query builder
        let statusField = '';   // "status" or "httpStatusCode"
        let metricName  = '';   // metric to filter
        let extraSel    = '';   // additional label selector unique to source
        if (r.source === 'scg') {
          statusField = 'httpStatusCode';
          metricName  = 'spring_cloud_gateway_requests_seconds_count';
          if (isGrouped) {
            const uri = r.path.replace(/"/g, '\\"');
            const method = r.method.replace(/"/g, '\\"');
            promql = `sum by (httpStatusCode) (rate(${metricName}{app_name="${service}",${clusterSel},routeUri="${uri}",httpMethod="${method}"}[5m]))`;
            extraSel = `,routeUri="${uri}",httpMethod="${method}"`;
          } else {
            const rid = r.target.replace(/"/g, '\\"');
            promql = `sum by (httpStatusCode) (rate(${metricName}{app_name="${service}",${clusterSel},routeId="${rid}"}[5m]))`;
            extraSel = `,routeId="${rid}"`;
          }
        } else {
          statusField = 'status';
          metricName  = 'http_client_requests_seconds_count';
          const rp = r.path.replace(/"/g, '\\"');
          const rm = r.method.replace(/"/g, '\\"');
          promql = `sum by (status) (rate(${metricName}{app_name="${service}",${clusterSel},method="${rm}",uri="${rp}"}[5m]))`;
          extraSel = `,method="${rm}",uri="${rp}"`;
        }
        const exploreUrl = runway?.jvmDsUid ? this._buildExploreUrl(runway, service, null, promql, runway.jvmDsUid) : '';
        // Per-status Explore builder for the sub-rows
        const subPromqlBuilder = runway?.jvmDsUid ? (status) => {
          const st = String(status).replace(/"/g, '\\"');
          const q = `rate(${metricName}{app_name="${service}",${clusterSel}${extraSel},${statusField}="${st}"}[5m])`;
          return this._buildExploreUrl(runway, service, null, q, runway.jvmDsUid);
        } : null;
        const parentRow = `<tr class="${rowCls} sp2-ep-parent">
          <td>
            ${srcTag}
            <span class="sp2-ep-method" style="background:color-mix(in srgb,${mc} 15%,transparent);color:${mc}">${esc(r.method || '?')}</span>
            <div class="sp2-ds-path-wrap">
              <div class="sp2-ds-target mono" title="${esc(r.target)}">${targetLabel}</div>
              <div class="sp2-ds-path mono" title="${esc(r.path)}">${esc(truncatePath(r.path))}</div>
            </div>
          </td>
          <td class="right mono"><b>${fmtRate(r.rateTotal)}</b><span style="color:var(--sp-text-soft);font-size:10.5px"> /s</span></td>
          <td class="right mono">${fmtMs(r.latencyMs)}</td>
          <td class="right" style="width:32px">
            ${exploreUrl ? `<a class="sp2-ep-explore" href="${esc(exploreUrl)}" target="_blank" rel="noopener" title="Open in Grafana Explore (all statuses over time)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </a>` : ''}
          </td>
        </tr>`;
        return parentRow + this._statusSubRows(r, subPromqlBuilder);
      };

      const total5xx = rows.filter(r => r.rate5xx > 0).length;
      const total4xx = rows.filter(r => r.rate4xx > 0 && r.rate5xx === 0).length;
      const badges = [];
      if (total5xx > 0) badges.push(`<span class="sp2-ep-badge hot">${total5xx} with 5xx</span>`);
      if (total4xx > 0) badges.push(`<span class="sp2-ep-badge warn">${total4xx} with 4xx</span>`);

      const nSCG  = rows.filter(r => r.source === 'scg').length;
      const nHTTP = rows.filter(r => r.source === 'http').length;
      const srcSummary = [
        nSCG  ? `${nSCG} SCG route${nSCG !== 1 ? 's' : ''}` : '',
        nHTTP ? `${nHTTP} HTTP call${nHTTP !== 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' · ');

      // How many rows got grouped (UUID routeIds collapsed)?
      const groupedCount = rows.filter(r => r.grouped && r.dynamicCount > 1).length;
      const groupedNote = groupedCount > 0
        ? `<span style="font-size:10.5px;color:var(--sp-text-soft);font-style:italic">${groupedCount} row${groupedCount !== 1 ? 's' : ''} merge dynamic UUID routes</span>`
        : '';

      return `
        <div class="sp2-card">
          <div class="sp2-card-head">
            <div class="sp2-card-title">Outbound calls (downstream) <span style="color:var(--sp-text-soft);font-weight:400;font-size:11px">· ${winLbl}</span><i class="sp2-help-icon" data-icon="help-circle" title="HTTP requests ที่ service นี้ส่งออก ไปเรียก backend / service อื่นๆ&#10;&#10;ที่มา:&#10;• SCG (ม่วง) = Spring Cloud Gateway route แต่ละเส้น (proxy routing) — โชว์ routeId + routeUri (URL ปลายทาง)&#10;• HTTP (เทา) = โค้ดในแอปที่ใช้ RestTemplate/WebClient เรียก external API — โชว์ host + path จริง&#10;&#10;หมายเหตุ: Gateway ที่ dynamic add routes (route ID เป็น UUID) จะ merge เข้าด้วยกันตาม target host เพื่ออ่านง่าย"></i></div>
            <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
              ${badges.join('')}
              <span style="font-size:11px;color:var(--sp-text-soft)">${srcSummary}</span>
              ${groupedNote}
            </div>
          </div>
          <table class="sp2-tbl sp2-ep-tbl sp2-ds-tbl">
            <thead>
              <tr>
                <th>Downstream target / URL <span style="color:var(--sp-text-soft);font-weight:400;font-size:10px;text-transform:none;letter-spacing:0">· pills = 4xx/5xx codes returned by downstream</span></th>
                <th class="right" style="width:110px">Requests</th>
                <th class="right" style="width:110px">Avg latency</th>
                <th class="right" style="width:32px"></th>
              </tr>
            </thead>
            <tbody>${rows.map(rowHtml).join('')}</tbody>
          </table>
        </div>`;
    },

    _perPodSection(d) {
      const cpuSeries = d.series?.cpuPerPod || [];
      const memSeries = d.series?.memPerPod || [];
      const winLbl = this.customStart
        ? fmtCustomRange(this.customStart, this.customEnd)
        : 'last ' + fmtWindow(this.windowMinutes);

      const legend = (series) => series.map((s, i) => `
        <span class="sp2-pod-legend-item" data-pod-idx="${i}" title="${esc(s.pod)}">
          <span class="dot" style="background:${POD_PALETTE[i % POD_PALETTE.length]}"></span>
          <span class="pod">${esc(s.pod)}</span>
        </span>`).join('');

      const card = (metric, title, series, unitType) => `
        <div class="sp2-perpod-card" data-metric="${metric}">
          <div class="sp2-perpod-head">
            <span class="lbl">${title} · ${winLbl}</span>
            <span class="cnt">${series.length} pod${series.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="sp2-perpod-body">${multiLineChart(series, unitType)}</div>
          ${series.length ? `<div class="sp2-pod-legend">${legend(series)}</div>` : ''}
        </div>`;

      return `
        <div class="sp2-perpod-grid">
          ${card('cpu-per-pod', 'CPU per pod', cpuSeries, 'cores')}
          ${card('mem-per-pod', 'MEM per pod', memSeries, 'bytes')}
        </div>`;
    },

    // Build the pod-selector shared by every explore query for a service.
    _selectorFor(rw, service, namespace) {
      const cluster = rw.cluster || '';
      const ns = namespace && namespace !== '.+' ? namespace : (rw.namespaceRegex || '');
      const nsSel = ns
        ? (ns.includes('*') || ns.includes('|') ? `namespace=~"${ns}"` : `namespace="${ns}"`)
        : '';
      const parts = [];
      if (cluster) parts.push(`cluster="${cluster}"`);
      if (nsSel)   parts.push(nsSel);
      parts.push(`pod=~"${service}.*"`);
      return parts.join(',');
    },

    // Set of canned PromQL queries offered in the Explore menu.
    // Each entry can carry its own `dsUid` — cadvisor/kube-state queries hit
    // the main dsUid, JVM/HTTP queries hit rw.jvmDsUid (Micrometer Thanos
    // which is a SEPARATE datasource on OCP TH). Without per-query dsUid
    // routing, Explore links land on the wrong datasource and return empty.
    _exploreQueriesFor(rw, service, namespace) {
      const sel = this._selectorFor(rw, service, namespace);
      // JVM/app-metric selector uses the exact-pinned cluster if we have one,
      // otherwise falls back to rw.cluster which may be a regex like a-th2p|b-th1p.
      const cluster = (this.currentCluster || rw.cluster || '');
      const clusterSel = cluster.includes('|') ? `cluster=~"${cluster}"` : `cluster="${cluster}"`;
      const jvmSel = `app_name="${service}",${clusterSel}`;
      const infra = [
        { key: 'pods',    label: '<i data-icon="clipboard"></i> Pod list',        expr: `kube_pod_info{${sel}}`,  dsUid: rw.dsUid },
        { key: 'cpu',     label: '<i data-icon="zap"></i> CPU usage',             expr: `sum by (pod) (rate(container_cpu_usage_seconds_total{${sel},container!="",container!="POD"}[5m]))`, dsUid: rw.dsUid },
        { key: 'mem',     label: '<i data-icon="save"></i> Memory usage',         expr: `sum by (pod) (container_memory_working_set_bytes{${sel},container!="",container!="POD"})`, dsUid: rw.dsUid },
        { key: 'restart', label: '<i data-icon="refresh-cw"></i> Restart count',  expr: `sum by (pod) (increase(kube_pod_container_status_restarts_total{${sel}}[1h]))`, dsUid: rw.dsUid },
        { key: 'limit',   label: '<i data-icon="settings"></i> CPU/MEM limits',   expr: `sum by (pod, resource) (kube_pod_container_resource_limits{${sel}})`, dsUid: rw.dsUid },
      ];
      // JVM/HTTP queries only listed when the source has a jvmDsUid configured.
      // Non-JVM services on such a source will just return empty in Explore.
      const jvm = rw.jvmDsUid ? [
        { key: 'txn',     label: '<i data-icon="activity"></i> TXN rate (req/sec)',   expr: `sum(rate(http_server_requests_seconds_count{${jvmSel}}[5m]))`, dsUid: rw.jvmDsUid },
        { key: 'latency', label: '<i data-icon="clock"></i> Avg latency (ms)',        expr: `(sum(rate(http_server_requests_seconds_sum{${jvmSel}}[5m])) / sum(rate(http_server_requests_seconds_count{${jvmSel}}[5m]))) * 1000`, dsUid: rw.jvmDsUid },
        { key: 'heap',    label: '<i data-icon="database"></i> JVM heap %',           expr: `avg(jvm_memory_used_bytes{${jvmSel}}) / avg(jvm_memory_max_bytes{${jvmSel}}) * 100`, dsUid: rw.jvmDsUid },
      ] : [];
      return infra.concat(jvm);
    },

    // Grafana Explore deep-link for a SINGLE PromQL query. Uses the legacy
    // `?left=` schema which every Grafana version from v8→v10+ still parses.
    // The newer `?panes=` schema is v10-only, so instances running v9 (like
    // this Thanos deployment) silently drop it and fall back to the built-in
    // `-- Grafana --` TestData source → "Random walk" default query.
    // `orgId` intentionally goes BEFORE `left=` so Grafana processes the org
    // switch before parsing the query payload (otherwise the redirect drops
    // it and the wrong org's datasource list is searched for the UID).
    _buildExploreUrl(rw, service, namespace, expr, dsUidOverride) {
      // Per-query datasource: JVM/HTTP queries route to rw.jvmDsUid, all
      // others to rw.dsUid (cadvisor). Fallback keeps back-compat with the
      // old 4-arg call sites (default dropdown link).
      // `expr` may be a string (single query) or an array of {expr, legend}
      // for multi-series Explore panes (e.g. avg + max latency on one chart).
      const dsUid = dsUidOverride || rw?.dsUid;
      if (!rw?.grafanaUrl || !dsUid || !expr) return '';
      const ds = { type: 'prometheus', uid: dsUid };
      const list = Array.isArray(expr)
        ? expr.filter(q => q && q.expr)
        : [{ expr, legend: '__auto' }];
      if (!list.length) return '';
      const queries = list.map((q, i) => ({
        refId: String.fromCharCode(65 + i),
        datasource: ds,
        expr: q.expr,
        range: true,
        instant: false,
        editorMode: 'code',
        legendFormat: q.legend || '__auto',
      }));
      const left = {
        datasource: dsUid,
        queries,
        range: { from: 'now-1h', to: 'now' },
      };
      return `${rw.grafanaUrl}/explore?orgId=${rw.orgId || 1}&left=${encodeURIComponent(JSON.stringify(left))}`;
    },

    // Backwards-compat wrapper: first-query URL (used as the primary Explore
    // link in the header if the dropdown isn't rendered).
    _defaultExploreUrl(rw, service, namespace) {
      const qs = this._exploreQueriesFor(rw, service, namespace);
      return this._buildExploreUrl(rw, service, namespace, qs[0]?.expr || '');
    },

    // Toggle the Explore menu (positioned under the header actions row).
    toggleExploreMenu(ev) {
      ev?.stopPropagation();
      const m = $('sp2-explore-menu');
      if (!m) return;
      m.classList.toggle('on');
      if (m.classList.contains('on')) {
        // Close on outside click.
        setTimeout(() => document.addEventListener('click', SP._closeMenuOnce, { once: true }), 0);
      }
    },
    _closeMenuOnce() { $('sp2-explore-menu')?.classList.remove('on'); },

    // Copy an arbitrary string to clipboard with a tiny toast confirmation.
    async copyToClipboard(text, ev) {
      ev?.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        this._flashToast('Copied PromQL to clipboard');
      } catch (_) {
        this._flashToast('Copy failed — select manually', true);
      }
    },
    // Copy the current deep-link URL (already kept in sync by the boot
    // wrapper) so users can paste it in Slack / tickets and land teammates
    // on the exact same service / range / cluster state.
    async copyShareLink(btnEl) {
      try {
        await navigator.clipboard.writeText(location.href);
        this._flashToast('Link copied · paste ในแชท / ticket ได้เลย');
        // Brief visual confirm on the button itself.
        if (btnEl) {
          const orig = btnEl.innerHTML;
          btnEl.innerHTML = `<i data-icon="check" style="width:12px;height:12px;vertical-align:-1px;margin-right:5px"></i>Copied`;
          if (window.Icons?.replaceAll) window.Icons.replaceAll(btnEl);
          setTimeout(() => { btnEl.innerHTML = orig; if (window.Icons?.replaceAll) window.Icons.replaceAll(btnEl); }, 1500);
        }
      } catch (_) { this._flashToast('Copy failed — copy จาก address bar แทน', true); }
    },

    _flashToast(msg, err = false) {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = `position:fixed;top:18px;right:18px;z-index:2000;padding:10px 14px;font-size:12.5px;border-radius:10px;background:var(--bg-card);border:1px solid var(--border);box-shadow:var(--sp-shadow-md);border-left:3px solid ${err ? 'var(--hot)' : 'var(--ok)'};color:var(--text)`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 1800);
    },

    // [Legacy — retained but unreferenced after Command Center redesign.
    //  Kept in-place so external calls from older snapshots don't crash.]
    _driftCard(inv, live, target, podDrift) {
      if (!inv || !Object.keys(inv).length) return '';

      // ── Parse CSV values ──
      // CPU: "1500m" → 1.5 cores, "1.5" → 1.5 cores, "500" → 0.5 cores (bare
      // integers are millicores in this CSV per the app's convention).
      const parseCpu = (v) => {
        if (!v) return null;
        const s = String(v).trim().toLowerCase();
        const m = s.match(/^(\d+(?:\.\d+)?)(m?)$/);
        if (!m) return null;
        const n = parseFloat(m[1]);
        if (m[2] === 'm') return n / 1000;
        return n >= 10 ? n / 1000 : n;  // 500 → 0.5 cores; 1.5 → 1.5 cores
      };

      const declaredReplicas = parseInt((inv.replicasProd || '').trim(), 10);
      const declaredCpuLimit = parseCpu(inv.cpuLimit);
      const declaredCpuReq   = parseCpu(inv.cpuRequest);
      const livePerPodCpuLim = live.perPodCpuLimit   || 0;
      const livePerPodCpuReq = live.perPodCpuRequest || 0;

      const badge = (state, text) => {
        const map = {
          ok:      { color: 'var(--ok)',      label: text || 'match' },
          drift:   { color: 'var(--warn)',    label: text || 'drift' },
          missing: { color: 'var(--sp-text-soft)', label: text || 'not declared' },
        };
        const p = map[state] || map.missing;
        return `<span class="sp2-tag" style="color:${p.color};border-color:currentColor;background:color-mix(in srgb,${p.color} 8%,transparent)">${esc(p.label)}</span>`;
      };

      // Compare two floats with 5% tolerance so a `1.5 cores` declared vs
      // `1499m` live doesn't false-positive as drift.
      const cmpNum = (declared, live, unit) => {
        if (declared == null || declared === 0) {
          return { state: 'missing', declaredTxt: '—', liveTxt: unit(live) };
        }
        if (live === 0) {
          return { state: 'drift', declaredTxt: unit(declared), liveTxt: unit(live), diff: 'live is 0' };
        }
        const rel = Math.abs(declared - live) / declared;
        const state = rel <= 0.05 ? 'ok' : 'drift';
        return { state, declaredTxt: unit(declared), liveTxt: unit(live) };
      };

      const rowsData = [];

      // Replicas (Prod)
      if (Number.isFinite(declaredReplicas) && declaredReplicas > 0) {
        rowsData.push({
          label: 'Replicas (Prod)',
          declared: String(declaredReplicas),
          live: String(live.pods || 0),
          state: (live.pods === declaredReplicas ? 'ok' : 'drift'),
          note: live.pods !== declaredReplicas ? `${live.pods > declaredReplicas ? '+' : ''}${live.pods - declaredReplicas}` : '',
        });
      } else {
        rowsData.push({ label: 'Replicas (Prod)', declared: '—', live: String(live.pods || 0), state: 'missing', note: '' });
      }

      // CPU limit per-pod
      const cpuLimCmp = cmpNum(declaredCpuLimit, livePerPodCpuLim, fmtCores);
      rowsData.push({ label: 'CPU limit / pod', declared: cpuLimCmp.declaredTxt, live: cpuLimCmp.liveTxt, state: cpuLimCmp.state, note: '' });

      // CPU request per-pod
      const cpuReqCmp = cmpNum(declaredCpuReq, livePerPodCpuReq, fmtCores);
      rowsData.push({ label: 'CPU request / pod', declared: cpuReqCmp.declaredTxt, live: cpuReqCmp.liveTxt, state: cpuReqCmp.state, note: '' });

      // Drift summary (short reason if any)
      const driftCount = rowsData.filter(r => r.state === 'drift').length;
      const headerBadge = driftCount === 0
        ? `<span class="sp2-tag" style="color:var(--ok);border-color:currentColor;background:color-mix(in srgb,var(--ok) 8%,transparent)">all in sync</span>`
        : `<span class="sp2-tag" style="color:var(--warn);border-color:currentColor;background:color-mix(in srgb,var(--warn) 8%,transparent)">${driftCount} drift</span>`;

      return `
        <div class="sp2-card">
          <div class="sp2-card-head">
            <div class="sp2-card-title">Configuration vs Live</div>
            <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
              ${headerBadge}
              <span style="font-size:11px;color:var(--sp-text-soft)">CSV inventory ↔ Grafana</span>
            </div>
          </div>
          <table class="sp2-tbl">
            <thead>
              <tr>
                <th>Field</th>
                <th>Declared (CSV)</th>
                <th>Actual (Grafana)</th>
                <th class="right" style="width:130px">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsData.map(r => `
                <tr>
                  <td>${esc(r.label)}</td>
                  <td class="mono" style="font-size:12.5px">${esc(r.declared)}</td>
                  <td class="mono" style="font-size:12.5px">${esc(r.live)}${r.note ? ` <span style="color:var(--sp-text-soft);font-size:11px">(${esc(r.note)})</span>` : ''}</td>
                  <td class="right">${badge(r.state)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    },

    // Renders the "Service metadata" card from CSV inventory row. Fields are
    // shown in a definition-list; empty fields are skipped so the card stays
    // compact for services with sparse CSV data.
    _metaCard(inv, live, target, podDrift) {
      if (!inv || !Object.keys(inv).length) return '';
      const fmtBool = (v) => {
        const s = (v || '').toUpperCase().trim();
        if (s === 'TRUE'  || s === 'YES' || s === 'Y' || s === '1' || s === 'ENABLED')  return '<span class="sp2-tag" style="color:var(--emerald);border-color:currentColor">enabled</span>';
        if (s === 'FALSE' || s === 'NO'  || s === 'N' || s === '0' || s === 'DISABLED') return '<span class="sp2-tag">disabled</span>';
        return v ? esc(v) : '<span style="color:var(--sp-text-soft)">—</span>';
      };
      const link = (url, label) => {
        if (!url) return '<span style="color:var(--sp-text-soft)">—</span>';
        const short = label || url.replace(/^https?:\/\//, '').replace(/^www\./, '');
        return `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--cool);text-decoration:none;font-size:12.5px">${esc(short)} ↗</a>`;
      };
      const val = (v) => v ? `<span>${esc(v)}</span>` : '<span style="color:var(--sp-text-soft)">—</span>';
      const mono = (v) => v ? `<span class="mono" style="font-size:12px">${esc(v)}</span>` : '<span style="color:var(--sp-text-soft)">—</span>';

      // Live-vs-declared drift indicator for pod count.
      const replicaCell = inv.replicasProd
        ? `${mono(inv.replicasProd)} ${podDrift ? `<span class="sp2-tag" style="color:var(--warn);border-color:currentColor;margin-left:6px">running ${live.pods}</span>` : `<span class="sp2-tag" style="color:var(--emerald);border-color:currentColor;margin-left:6px">matches</span>`}`
        : val(inv.replicasProd);

      const rows = [
        ['App language',       val(inv.appLanguage)],
        ['Service group',      val(inv.serviceGroup)],
        ['Workload type',      val(inv.appWorkloadType)],
        ['Arch',               mono(inv.arch)],
        ['App port',           mono(inv.appPort)],
        ['Timezone',           mono(inv.timezone)],
        ['Route zone',         val(inv.routeZone)],
        ['Context path',       mono(inv.contextPath)],
        ['CPU request / limit', `${mono(inv.cpuRequest)} <span style="color:var(--sp-text-soft);margin:0 6px">/</span> ${mono(inv.cpuLimit)}`],
        ['Replicas (Prod)',    replicaCell],
        ['Cloudflare proxy',   fmtBool(inv.cloudflareProxyEnable)],
        ['SpringNative',       fmtBool(inv.springNativeEnable)],
        ['Sonarqube',          fmtBool(inv.sonarqube)],
        ['Datadog',            fmtBool(inv.datadogEnable)],
        ['Pipeline version',   mono(inv.pipelineVersion)],
        ['Middleware image',   mono(inv.middlewareImage)],
        ['URL Production',     link(inv.urlProduction)],
        ['Git repo',           link(inv.gitRepoUrl)],
      ];
      // Skip rows where value is the em-dash placeholder for both value and no extra badge
      const nonEmpty = rows.filter(([_, v]) => !/^<span style="color:var\(--text-soft\)">—<\/span>$/.test(v));
      if (!nonEmpty.length) return '';

      return `
        <div class="sp2-card">
          <div class="sp2-card-head">
            <div class="sp2-card-title">Service metadata</div>
            <div style="margin-left:auto;font-size:11px;color:var(--sp-text-soft)">from Service Inventory CSV</div>
          </div>
          <div class="sp2-card-body">
            <dl class="sp2-meta-dl">
              ${nonEmpty.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}
            </dl>
          </div>
        </div>`;
    },

    clear() {
      $('sp2-input').value = '';
      $('sp2-clear').classList.remove('on');
      this.suggestions = [];
      this.activeIndex = -1;
      this.closeDropdown();
      this.renderPlaceholder();
      $('sp2-input').focus();
    },

    // Placeholder scaffold — mirrors the real dashboard layout so the user
    // sees exactly which boxes will populate. loadDetail() overwrites this
    // once a service is selected.
    renderPlaceholder() {
      const statRow = (lbl) => `
        <div class="sp2-cc-stat">
          <span class="sp2-cc-stat-dot" style="background:var(--border);color:var(--border)"></span>
          <div class="sp2-cc-stat-body">
            <div class="sp2-cc-stat-lbl">${lbl}</div>
            <div class="sp2-cc-stat-val" style="color:var(--sp-text-soft)">—</div>
            <div class="sp2-cc-stat-sub">waiting for selection</div>
          </div>
        </div>`;
      const sumRow = (lbl, val = '—') => `
        <div class="sp2-cc-summary-row">
          <span class="sp2-cc-summary-lbl">${lbl}</span>
          <span class="sp2-cc-summary-val" style="color:var(--sp-text-soft)">${val}</span>
        </div>`;

      $('sp2-detail').innerHTML = `
        <!-- Header hero (placeholder) -->
        <div class="sp2-svc-head" style="--sp-pulse:var(--sp-text-soft)">
          <div class="sp2-svc-pulse">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </div>
          <div class="sp2-svc-info">
            <div class="sp2-svc-title" style="color:var(--text-muted)">Select a service</div>
            <div class="sp2-svc-meta1" style="color:var(--sp-text-soft);font-size:12px">พิมพ์ชื่อ service ในช่องด้านบน — เลือกจาก dropdown แล้ว dashboard จะโหลดข้อมูลจริงเข้าช่องเหล่านี้</div>
          </div>
        </div>

        <!-- Command Center scaffold -->
        <div class="sp2-cc-grid">
          <!-- LEFT -->
          <div class="sp2-cc-card sp2-cc-left">
            <div class="sp2-cc-section-title">Live status</div>
            <div class="sp2-cc-status-list">
              ${statRow('Running pods')}
              ${statRow('CPU used')}
              ${statRow('MEM used')}
            </div>
            <div class="sp2-cc-divider"></div>
            <div class="sp2-cc-section-title">
              <span>Config drift</span>
              <span style="font-size:10px;color:var(--sp-text-soft);font-weight:400;text-transform:none;letter-spacing:0">CSV vs Live</span>
            </div>
            <div class="sp2-cc-drift" style="color:var(--sp-text-soft);font-size:11.5px;font-style:italic;padding:8px 16px 16px">waiting for selection</div>
            <!-- Preview: subsystem health chip row (populated by _loadChips()
                 after a service is selected). Skeleton shimmer here shows
                 the user this row exists. -->
            <div class="sp2-chips">
              <span class="sp2-chip na sp2-chip-skel"><span class="sp2-chip-dot" style="background:currentColor"></span><span class="sp2-chip-name">DB Pool</span><span class="sp2-chip-val"></span></span>
              <span class="sp2-chip na sp2-chip-skel"><span class="sp2-chip-dot" style="background:currentColor"></span><span class="sp2-chip-name">Tomcat</span><span class="sp2-chip-val"></span></span>
              <span class="sp2-chip na sp2-chip-skel"><span class="sp2-chip-dot" style="background:currentColor"></span><span class="sp2-chip-name">GC</span><span class="sp2-chip-val"></span></span>
              <span class="sp2-chip na sp2-chip-skel"><span class="sp2-chip-dot" style="background:currentColor"></span><span class="sp2-chip-name">Threads</span><span class="sp2-chip-val"></span></span>
              <span class="sp2-chip na sp2-chip-skel"><span class="sp2-chip-dot" style="background:currentColor"></span><span class="sp2-chip-name">Heap</span><span class="sp2-chip-val"></span></span>
            </div>
          </div>

          <!-- CENTER -->
          <div class="sp2-cc-card sp2-cc-center">
            <div class="sp2-cc-chart-card" style="border-bottom:1px solid var(--border)">
              <div class="sp2-cc-chart-head">
                <span class="lbl">CPU · last 30 min</span>
                <span class="now" style="color:var(--sp-text-soft)">—</span>
              </div>
              <div class="sp2-cc-chart-body"><div class="sp2-chart-empty">waiting for selection</div></div>
            </div>
            <div class="sp2-cc-chart-card">
              <div class="sp2-cc-chart-head">
                <span class="lbl">MEM · last 30 min</span>
                <span class="now" style="color:var(--sp-text-soft)">—</span>
              </div>
              <div class="sp2-cc-chart-body"><div class="sp2-chart-empty">waiting for selection</div></div>
            </div>
          </div>

          <!-- RIGHT -->
          <div class="sp2-cc-right">
            <div class="sp2-cc-card">
              <div class="sp2-cc-section-title">Running pods</div>
              <div class="sp2-cc-gauge-body">
                <div class="sp2-cc-gauge">
                  <svg viewBox="0 0 150 150">
                    <circle cx="75" cy="75" r="58" fill="none" stroke="var(--border)" stroke-width="12"/>
                  </svg>
                  <div class="sp2-cc-gauge-inner">
                    <div class="sp2-cc-gauge-val" style="color:var(--sp-text-soft)">—</div>
                    <div class="sp2-cc-gauge-lbl">Pods</div>
                  </div>
                </div>
                <div style="font-size:11px;color:var(--sp-text-soft);text-align:center">waiting for selection</div>
              </div>
            </div>
            <div class="sp2-cc-card">
              <div class="sp2-cc-section-title">Summary</div>
              <div class="sp2-cc-summary">
                ${sumRow('Fetched')}
                ${sumRow('Source')}
                ${sumRow('Namespace')}
                <div class="sp2-cc-summary-row" style="margin-top:4px">
                  <span class="sp2-cc-summary-lbl">Config</span>
                  <span class="sp2-cc-summary-badge" style="color:var(--sp-text-soft);background:var(--sp-bg-subtle)">no service</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Preview: tab bar (will populate after service selection) —
             ผู้ใช้จะเห็นว่ามี tab แยกอะไรบ้างก่อนกดค้นหา -->
        <div class="sp2-tabs" role="tablist" style="opacity:.55">
          <button type="button" class="sp2-tab on" disabled><span>Overview</span></button>
          <button type="button" class="sp2-tab" disabled><span>Dependencies</span></button>
          <button type="button" class="sp2-tab" disabled><span>API endpoints</span></button>
          <button type="button" class="sp2-tab" disabled><span>Per pod</span></button>
          <button type="button" class="sp2-tab" disabled><span>DB Pool</span></button>
          <button type="button" class="sp2-tab" disabled><span>Tomcat</span></button>
          <button type="button" class="sp2-tab" disabled><span>Runtime</span></button>
          <button type="button" class="sp2-tab" disabled><span>Transaction</span></button>
        </div>
        <div style="font-size:11.5px;color:var(--sp-text-soft);padding:6px 4px 14px;line-height:1.65">
          <b style="color:var(--text)">คู่มือย่อ:</b>
          <span style="color:var(--violet);font-weight:600">DB Pool</span> = Hikari connection (active / pending / timeout) ·
          <span style="color:var(--warn);font-weight:600">Tomcat</span> = thread pool + config ·
          <span style="color:var(--cool);font-weight:600">Runtime</span> = JVM heap pools + GC + threads ·
          <span style="color:var(--emerald);font-weight:600">Transaction</span> = peak TPS/DB/latency ตลอด window
          &nbsp;·&nbsp; กด <i data-icon="help-circle" style="width:12px;height:12px;vertical-align:-2px"></i> ที่มุมขวาบน = คู่มือ metric ทั้งหมด
        </div>

        <!-- Pod detail scaffold -->
        <div class="sp2-card">
          <div class="sp2-card-head">
            <div class="sp2-card-title">Pod detail</div>
            <div style="margin-left:auto;font-size:11px;color:var(--sp-text-soft)">— pods</div>
          </div>
          <table class="sp2-tbl sp2-tbl-sortable">
            <thead><tr>
              <th data-sort-col="pod" onclick="SP._sortPodTable(this)">POD <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="cpuCores" onclick="SP._sortPodTable(this)">CPU <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="cpuPct" onclick="SP._sortPodTable(this)">CPU % <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="memBytes" onclick="SP._sortPodTable(this)">MEM <span class="sp2-sort-icon"></span></th>
              <th class="right" data-sort-col="memPct" onclick="SP._sortPodTable(this)">MEM % <span class="sp2-sort-icon"></span></th>
            </tr></thead>
            <tbody><tr><td colspan="5" style="padding:24px;text-align:center;color:var(--sp-text-soft)">waiting for selection</td></tr></tbody>
          </table>
        </div>`;
      // Re-render icon placeholders (the <i data-icon="..."> inside the
      // guide line above needs Icons.replaceAll to swap to real SVG).
      if (window.Icons?.replaceAll) window.Icons.replaceAll(document.getElementById('sp2-detail'));
    },

    _sortPodTable(th) {
      const col = th.dataset.sortCol;
      const tbl = th.closest('table');
      const tbody = tbl.querySelector('tbody[data-pods]');
      if (!tbody) return;
      const pods = JSON.parse(tbody.dataset.pods || '[]');
      const cur = th.dataset.sortDir || '';
      const dir = cur === 'asc' ? 'desc' : 'asc';
      tbl.querySelectorAll('th[data-sort-col]').forEach(h => {
        h.dataset.sortDir = '';
        h.querySelector('.sp2-sort-icon').textContent = '';
        h.classList.remove('sp2-sort-asc', 'sp2-sort-desc');
      });
      th.dataset.sortDir = dir;
      th.querySelector('.sp2-sort-icon').textContent = dir === 'asc' ? '↑' : '↓';
      th.classList.add(dir === 'asc' ? 'sp2-sort-asc' : 'sp2-sort-desc');
      const sorted = [...pods].sort((a, b) => {
        if (col === 'pod') {
          const av = a.pod || '', bv = b.pod || '';
          return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        const av = a[col] ?? -Infinity, bv = b[col] ?? -Infinity;
        return dir === 'asc' ? av - bv : bv - av;
      });
      tbody.innerHTML = sorted.map(p => `
        <tr>
          <td><div class="mono" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;max-width:340px;white-space:nowrap" title="${esc(p.pod)}">${esc(p.pod)}</div></td>
          <td class="right mono">${fmtCores(p.cpuCores)}</td>
          <td class="right">${pctBar(p.cpuPct)}</td>
          <td class="right mono">${fmtBytes(p.memBytes)}</td>
          <td class="right">${pctBar(p.memPct)}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--sp-text-soft)">no pods</td></tr>';
    },
  };

  // ── Per-pod focus: click legend item to isolate one pod's line ─────
  // Uses event delegation on document so it works after any innerHTML rebuild.
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.sp2-pod-legend-item[data-pod-idx]');
    if (!item) return;
    if (!item.closest('.sp2-perpod-card')) return;
    const idx = item.dataset.podIdx;
    const alreadyFocused = item.classList.contains('pod-hi');

    // Apply the same focus state across ALL perpod cards so CPU + MEM stay in sync.
    document.querySelectorAll('.sp2-perpod-card').forEach(card => {
      card.classList.remove('pod-focused');
      card.querySelectorAll('.sp2-pod-line, .sp2-pod-legend-item').forEach(el => el.classList.remove('pod-hi'));
      if (!alreadyFocused) {
        card.classList.add('pod-focused');
        card.querySelectorAll(`.sp2-pod-line[data-pod-idx="${idx}"]`).forEach(el => el.classList.add('pod-hi'));
        card.querySelectorAll(`.sp2-pod-legend-item[data-pod-idx="${idx}"]`).forEach(el => el.classList.add('pod-hi'));
      }
    });

    e.stopPropagation();
  });

  // ── Wire input ─────────────────────────────────────────────────
  let dtimer = null;
  $('sp2-input').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    $('sp2-clear').classList.toggle('on', q.length > 0);
    clearTimeout(dtimer);
    dtimer = setTimeout(() => SP.runSuggest(q), 150);
  });
  $('sp2-input').addEventListener('focus', () => {
    if (!SP.suggestions.length) SP.runSuggest($('sp2-input').value.trim());
    else SP.openDropdown();
  });
  $('sp2-input').addEventListener('keydown', (e) => {
    const n = SP.suggestions.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      SP.activeIndex = (SP.activeIndex + 1) % n;
      SP._renderDropdown();
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      SP.activeIndex = (SP.activeIndex - 1 + n) % n;
      SP._renderDropdown();
    } else if (e.key === 'Enter' && SP.activeIndex >= 0) {
      e.preventDefault();
      SP.select(SP.suggestions[SP.activeIndex]);
    } else if (e.key === 'Escape') {
      SP.closeDropdown();
      e.target.blur();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.sp2-searchbox')) SP.closeDropdown?.();
  });
  // Escape closes the custom-range picker when it's open.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('sp2-picker').classList.contains('on')) SP.closeCustomPicker();
  });
  $('sp2-clear').addEventListener('click', () => SP.clear());

  SP.renderPlaceholder();
  SP.initSuggest();

  // ── Deep-link boot ─────────────────────────────────────────────────
  // Parse URL params so `?service=X&window=Y` (or `&start=…&end=…`, or
  // `&cluster=Z`) auto-loads the same view. Users can bookmark / share
  // links straight to a specific service + range. Falls through silently
  // if `service` is missing → user sees the placeholder as before.
  (function bootFromUrl() {
    const p = new URLSearchParams(location.search);
    const svc = p.get('service');
    // Deep-link from the global "My Alerts" top-bar button on other pages —
    // opens the alerts drawer as soon as the SP module is ready.
    if (p.get('openAlerts') === '1') {
      setTimeout(() => SP.Alerts?.open(svc || ''), 400);
    }
    if (!svc) return;
    // Restore cluster BEFORE loadDetail so the initial fetch pins the right one.
    const cluster = p.get('cluster');
    if (cluster) SP.currentCluster = cluster;
    // Restore range: prefer absolute start+end (custom range), else preset window.
    const startS = parseInt(p.get('start') || '', 10);
    const endS   = parseInt(p.get('end')   || '', 10);
    if (Number.isFinite(startS) && Number.isFinite(endS) && endS > startS) {
      SP.customStart = startS; SP.customEnd = endS;
      SP.windowMinutes = Math.round((endS - startS) / 60);
    } else {
      const win = parseInt(p.get('window') || '', 10);
      if (Number.isFinite(win) && win >= 5) SP.windowMinutes = win;
    }
    // Reflect it in the search box so the user sees what URL asked for.
    const input = $('sp2-input');
    if (input) input.value = svc;
    const clr = $('sp2-clear'); if (clr) clr.classList.add('on');
    // Kick off the fetch. loadDetail replaces the placeholder with the
    // real dashboard once the response lands.
    SP.loadDetail(svc);
  })();

  // ── URL sync on state changes ──────────────────────────────────────
  // Whenever the user picks a different service / preset / custom range /
  // cluster, we push a matching URL via replaceState so the browser back
  // button doesn't fill with intermediate states but the current URL
  // stays copy-pasteable. Wraps the four SP mutation entry points.
  function syncUrl() {
    // Cleared search → wipe params so the URL doesn't carry ghost state.
    if (!SP.currentService) {
      if (location.search) history.replaceState(null, '', location.pathname + location.hash);
      return;
    }
    const p = new URLSearchParams();
    p.set('service', SP.currentService);
    if (SP.customStart && SP.customEnd) {
      p.set('start', String(SP.customStart));
      p.set('end',   String(SP.customEnd));
    } else if (SP.windowMinutes && SP.windowMinutes !== 30) {
      p.set('window', String(SP.windowMinutes));
    }
    if (SP.currentCluster) p.set('cluster', SP.currentCluster);
    const next = location.pathname + '?' + p.toString() + location.hash;
    if (next !== location.pathname + location.search + location.hash) {
      history.replaceState(null, '', next);
    }
  }
  // Wrap mutating methods. Each keeps its original behavior and appends
  // a URL sync at the end. Using setTimeout to run AFTER the method's
  // async work commits state (loadDetail sets currentService inside its
  // body; setWindow / setCustomRange are synchronous updates).
  ['loadDetail', 'setWindow', 'setCustomRange', 'switchCluster', 'clear'].forEach(name => {
    const orig = SP[name];
    if (typeof orig !== 'function') return;
    SP[name] = function(...args) {
      const r = orig.apply(this, args);
      setTimeout(syncUrl, 0);
      return r;
    };
  });

  // Close the drill-down panel on Escape — matches user expectation for any
  // modal/side sheet. Ignored while typing in an input so it doesn't disrupt
  // search + custom-range editing.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ($('sp2-cx-modal')?.classList.contains('on')) { SP.closeChart(); return; }
    if ($('sp2-docs')?.classList.contains('on'))  { SP.closeDocs(); return; }
    if ($('sp2-drill')?.classList.contains('on')) SP.navBack();
  });


/* ── next inline block ── */


(function () {
  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Team check: SM-only. sm_user and sm_admin/lead all have team === 'sm'.
  function _isSm() {
    try {
      const u = Auth.getUser?.();
      return (u?.team === 'sm') || u?.role === 'super_admin';
    } catch { return false; }
  }

  // Button injected into detail actions row. Returns '' for non-SM.
  SP._logViewerBtn = function (service, namespace) {
    if (!_isSm()) return '';
    return `<button class="sp2-btn" onclick="SP.LogViewer.open('${esc(service)}', '${esc(namespace || '')}')" title="Search logs in OpenSearch for this service">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="12" y1="17" y2="17"/></svg>
      View Logs
    </button>`;
  };

  const LV = SP.LogViewer = {
    service:    '',
    namespace:  '',
    endpoints:  [],
    defaults:   { size: 200, max_size: 1000, default_time_range_min: 15 },
    lastResult: null,
    lastQuery:  null,
    traceCid:   '',
    _busy:      false,
    _endpointsLoaded: false,
    _userCreds:  {},   // { endpoint_id: { username } } cached from API
    _credsLoaded: false,
    // Client-side filter chip: 'ok' | 'warn' | 'err' | 'other' | 'unknown' | null.
    _statusFilter: null,
    // Override the range dropdown with an explicit {start,end} from clicking
    // a histogram bar. Chip strip shows this + gives an X to revert.
    _bucketRange: null,
    // Client-side "most found" REST pattern filter
    _restFilter: null,
    _mostFound: [],   // [{ key, count }] top repeated REST snippets

    async open(service, namespace, opts) {
      opts = opts || {};
      this.service   = service;
      this.namespace = namespace || '';
      this.traceCid  = '';
      this._statusFilter = null;
      // Optional caller-supplied time range (e.g. from a chart-crosshair
      // deep-link). Falls through to admin default when not given.
      this._bucketRange  = (opts.start && opts.end)
        ? { start: opts.start, end: opts.end, label: opts.label || 'from chart' }
        : null;
      $('lv-svc').textContent = service;
      $('lv-ovl').classList.add('on');
      $('lv-cid').value = '';
      $('lv-q').value   = '';
      $('lv-lvl').value = '';
      $('lv-trace').style.display = 'none';
      $('lv-side').classList.remove('on');
      $('lv-active').classList.remove('on');
      $('lv-body').innerHTML = `<div class="lv-msg"><span class="lv-spinner"></span> Loading endpoints…</div>`;
      if (!this._endpointsLoaded) {
        const res = await API.opensearch.endpoints();
        if (!res?.ok) {
          $('lv-body').innerHTML = `<div class="lv-msg err">Cannot load OpenSearch endpoints: ${esc(res?.data?.message || 'unknown')}. Ask an admin to configure one in <a href="admin/opensearch-config.html" target="_blank">admin/opensearch-config.html</a>.</div>`;
          return;
        }
        this.endpoints = res.data?.data?.endpoints || [];
        this.defaults  = res.data?.data?.defaults  || this.defaults;
        this._endpointsLoaded = true;
        // Load user's saved creds status (fire-and-forget — cred bar updates when it resolves)
        if (!this._credsLoaded) {
          API.opensearch.userCreds.list().then(r => {
            if (r?.ok) {
              (r.data?.data?.endpoints || []).forEach(e => {
                if (e.has_creds) this._userCreds[e.endpoint_id] = { username: e.username };
              });
            }
            this._credsLoaded = true;
            this._renderCredStatus();
          });
        }
      }
      if (!this.endpoints.length) {
        $('lv-body').innerHTML = `<div class="lv-msg">No OpenSearch endpoints configured yet. <a href="admin/opensearch-config.html" target="_blank" style="color:#3b82f6">Add one</a> in the admin panel first.</div>`;
        return;
      }
      const epSel = $('lv-endpoint');
      epSel.innerHTML = this.endpoints.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
      epSel.value = this.endpoints[0].id;
      this._onEndpointChange();

      // Preset range default from admin config
      const mm = this.defaults.default_time_range_min || 15;
      const preset = mm <= 5 ? 'last_5m' : mm <= 15 ? 'last_15m' : mm <= 30 ? 'last_30m'
                   : mm <= 60 ? 'last_1h' : mm <= 240 ? 'last_4h' : 'last_24h';

      // Caller-supplied time range (chart deep-link) wins over the admin
      // preset. We drive it through the SAME "custom" pathway the range
      // dropdown uses so there's one code path — instead of relying on
      // `_bucketRange` surviving async endpoints-load in every future
      // refactor. Populate the custom start/end pickers + flip the
      // dropdown so the UI reflects what actually got queried.
      if (opts.start && opts.end) {
        $('lv-range').value = 'custom';
        // Convert ISO → local YYYY-MM-DDTHH:MM for datetime-local input
        const isoToLocal = (iso) => {
          const d = new Date(iso);
          const pad = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };
        const cs = $('lv-custom-start'), ce = $('lv-custom-end');
        if (cs) { cs.value = isoToLocal(opts.start); cs.style.display = ''; }
        if (ce) { ce.value = isoToLocal(opts.end);   ce.style.display = ''; }
        // Keep _bucketRange too — chip strip reads from it for the visible
        // "Bucket: spike @ …" hint above the log list.
        this._bucketRange = { start: opts.start, end: opts.end, label: opts.label || 'from chart' };
      } else {
        $('lv-range').value = preset;
      }

      // Kick off first search
      this.search();
    },

    close() {
      $('lv-ovl').classList.remove('on');
    },

    _onEndpointChange() {
      const e = this.endpoints.find(x => x.id === $('lv-endpoint').value);
      const idxSel = $('lv-index');
      const patterns = (e?.index_patterns?.length ? e.index_patterns : [e?.default_index_pattern]).filter(Boolean);
      idxSel.innerHTML = patterns.map(p => `<option value="${esc(p)}" ${p === e.default_index_pattern ? 'selected' : ''}>${esc(p)}</option>`).join('');
      this._renderCredStatus();
    },

    _params(extra = {}) {
      const p = {
        endpoint_id:   $('lv-endpoint').value,
        index_pattern: $('lv-index').value,
        module:        this.service || undefined,
        log_level:     $('lv-lvl').value || undefined,
        q:             $('lv-q').value.trim() || undefined,
        correlation_id:$('lv-cid').value.trim() || undefined,
        regexp_rest:   this._parseRegexpInput($('lv-regexp').value) || undefined,
        size:          this.defaults.size,
      };
      if (this._bucketRange) {
        p.start = this._bucketRange.start;
        p.end   = this._bucketRange.end;
      } else if ($('lv-range').value === 'custom') {
        const s = $('lv-custom-start').value;
        const e = $('lv-custom-end').value;
        if (s && e) { p.start = new Date(s).toISOString(); p.end = new Date(e).toISOString(); }
        else        { p.range = 'last_15m'; } // fallback if pickers not filled
      } else {
        p.range = $('lv-range').value;
      }
      Object.assign(p, extra);
      Object.keys(p).forEach(k => p[k] === undefined && delete p[k]);
      return p;
    },

    async search(opts = {}) {
      if (this._busy) return;
      this._busy = true;
      $('lv-run').disabled = true;
      const body = $('lv-body');
      body.innerHTML = `<div class="lv-msg"><span class="lv-spinner"></span> Querying OpenSearch…</div>`;
      const params = opts.params || this._params();
      this.lastQuery = params;
      const res = await API.opensearch.search(params);
      this._busy = false;
      $('lv-run').disabled = false;
      if (!res?.ok) {
        // No per-user credentials saved → show inline credential prompt
        if (res?.data?.message === 'no_user_creds') {
          this._renderCredPrompt(params.endpoint_id);
          return;
        }
        body.innerHTML = `<div class="lv-msg err">Search failed: ${esc(res?.data?.message || 'unknown')}</div>`;
        this._renderSummary(null);
        this._renderHistogram(null);
        return;
      }
      const d = res.data?.data || {};
      this.lastResult = d;
      this._restFilter = null;
      this._computeMostFound(d.hits || []);
      this._renderSummary(d);
      this._renderHistogram(d);
      this._renderSide(d);
      this._renderTable(d);
      this._renderActiveFilters();
    },

    _renderSummary(d) {
      if (!d) {
        $('lv-sum-total').textContent = '—';
        $('lv-sum-took').textContent  = '—';
        $('lv-sum-ok').textContent    = '2xx · 0';
        $('lv-sum-warn').textContent  = '4xx · 0';
        $('lv-sum-err').textContent   = '5xx · 0';
        $('lv-sum-unknown').textContent = 'no status · 0';
        $('lv-sum-lat').textContent   = 'latency —';
        return;
      }
      const tr = d.total_relation === 'gte' ? '≥' : '';
      $('lv-sum-total').innerHTML = `<b>${tr}${d.total.toLocaleString()}</b> hits · <span style="opacity:.7">${d.returned} shown</span>`;
      $('lv-sum-took').textContent = `${d.took_ms} ms`;
      const s = d.summary?.status || {};
      $('lv-sum-ok').textContent      = `2xx · ${s.ok || 0}`;
      $('lv-sum-warn').textContent    = `4xx · ${s.warn || 0}`;
      $('lv-sum-err').textContent     = `5xx · ${s.error || 0}`;
      $('lv-sum-unknown').textContent = `no status · ${s.unknown || 0}`;
      // 3xx/1xx "other" — only show chip when > 0
      const otherEl = $('lv-sum-other');
      if (otherEl) { const n = s.other || 0; otherEl.textContent = `3xx · ${n}`; otherEl.style.display = n > 0 ? '' : 'none'; }
      const la = d.summary?.latency_avg, lm = d.summary?.latency_max;
      $('lv-sum-lat').textContent = la != null ? `latency avg ${la}ms · max ${lm}ms (n=${d.summary.latency_n})` : 'latency —';
      ['ok','warn','err','other','unknown'].forEach(k => {
        const map = {ok:'lv-sum-ok', warn:'lv-sum-warn', err:'lv-sum-err', other:'lv-sum-other', unknown:'lv-sum-unknown'};
        const el = $(map[k]); if (el) el.classList.toggle('active', this._statusFilter === k);
      });
    },

    // Client-side status class filter for the log table. Toggles the same
    // class off when clicked twice, and swaps to the new class otherwise.
    _pickStatus(kind) {
      this._statusFilter = this._statusFilter === kind ? null : kind;
      // Re-render summary (for active-chip styling) + table + active-strip.
      this._renderSummary(this.lastResult);
      this._renderTable(this.lastResult);
      this._renderActiveFilters();
    },

    // Drill into a single histogram bucket → re-search bounded to that
    // bucket's time window. Backend accepts absolute {start,end}.
    _pickBucket(i) {
      const d = this.lastResult;
      const b = d?.histogram?.[i];
      if (!b) return;
      const intervalMs = this._parseIntervalMs(d?.time?.interval);
      const startIso = new Date(b.time).toISOString();
      const endIso   = new Date(b.time + intervalMs).toISOString();
      this._bucketRange = { start: startIso, end: endIso, label: this._bucketLabel(b.time, b.time + intervalMs) };
      // Drop any client-side status filter so drill shows the raw bucket.
      this._statusFilter = null;
      const params = { ...this._params(), start: startIso, end: endIso };
      delete params.range;
      this.search({ params });
    },

    _bucketLabel(gteMs, lteMs) {
      const f = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `${f(gteMs)} → ${f(lteMs)}`;
    },

    _visibleHits() {
      return (this.lastResult?.hits || []).filter(h => this._matches(h));
    },

    _renderActiveFilters() {
      const strip = $('lv-active');
      const parts = [];
      // Module lock is the primary filter — clicking × removes the service
      // name so search sweeps every module in the index pattern.
      if (this.service) {
        parts.push(`<span class="chip">Module: ${esc(this.service)}<button type="button" title="Remove module filter" onclick="SP.LogViewer._clearModule()">×</button></span>`);
      }
      if (this._bucketRange) {
        parts.push(`<span class="chip">Bucket: ${esc(this._bucketRange.label)}<button type="button" title="Revert to range dropdown" onclick="SP.LogViewer._clearBucket()">×</button></span>`);
      }
      if (this._statusFilter) {
        const label = { ok: '2xx only', warn: '4xx only', err: '5xx only', other: '3xx/1xx only', unknown: 'no status only' }[this._statusFilter];
        parts.push(`<span class="chip status-${esc(this._statusFilter)}">${esc(label)}<button type="button" onclick="SP.LogViewer._pickStatus('${esc(this._statusFilter)}')">×</button></span>`);
      }
      if (this._restFilter) {
        const short = this._restFilter.length > 30 ? this._restFilter.slice(0,30)+'…' : this._restFilter;
        parts.push(`<span class="chip">Most repeated: ${esc(short)}<button type="button" onclick="SP.LogViewer._pickRestFilter('${esc(this._restFilter)}')">×</button></span>`);
      }
      const qVal = $('lv-q').value.trim();
      if (qVal) {
        parts.push(`<span class="chip">Text: ${esc(qVal.length > 32 ? qVal.slice(0, 32) + '…' : qVal)}<button type="button" onclick="SP.LogViewer._clearFilter('q')">×</button></span>`);
      }
      const rxVal = this._parseRegexpInput($('lv-regexp').value);
      if (rxVal) {
        parts.push(`<span class="chip">Regexp: <code style="font-family:ui-monospace,monospace;font-size:10.5px">${esc(rxVal.length > 28 ? rxVal.slice(0,28)+'…' : rxVal)}</code><button type="button" onclick="SP.LogViewer._clearFilter('regexp')">×</button></span>`);
      }
      const cidVal = $('lv-cid').value.trim();
      if (cidVal) {
        parts.push(`<span class="chip">Correlation: ${esc(cidVal.slice(0, 20))}${cidVal.length > 20 ? '…' : ''}<button type="button" onclick="SP.LogViewer._clearFilter('cid')">×</button></span>`);
      }
      const lvlVal = $('lv-lvl').value;
      if (lvlVal) {
        parts.push(`<span class="chip">Level: ${esc(lvlVal)}<button type="button" onclick="SP.LogViewer._clearFilter('lvl')">×</button></span>`);
      }

      if (!parts.length) { strip.classList.remove('on'); strip.innerHTML = ''; return; }
      strip.innerHTML = `<span class="h">Active filters</span>${parts.join('')}<button class="clearall" onclick="SP.LogViewer._clearAllFilters()">Clear all</button>`;
      strip.classList.add('on');
    },

    _clearModule()  { this.service = ''; $('lv-svc').textContent = '(all modules)'; this.search(); },
    _clearBucket()  { this._bucketRange = null; this.search(); },
    _clearFilter(k) {
      if (k === 'q')      $('lv-q').value = '';
      if (k === 'cid')    $('lv-cid').value = '';
      if (k === 'lvl')    $('lv-lvl').value = '';
      if (k === 'regexp') $('lv-regexp').value = '';
      this.search();
    },
    _clearAllFilters() {
      this._statusFilter = null; this._bucketRange = null; this._restFilter = null;
      $('lv-q').value = ''; $('lv-cid').value = ''; $('lv-lvl').value = ''; $('lv-regexp').value = '';
      this.search();
    },

    _renderHistogram(d) {
      const hist = $('lv-hist');
      const buckets = d?.histogram || [];
      if (!buckets.length) { hist.innerHTML = '<div class="lv-hist-empty">no data</div>'; return; }

      const LEVEL_COLOR = { ERROR: '#ef4444', WARN: '#f59e0b', INFO: '#3b82f6', DEBUG: '#8b5cf6' };
      // Stack order — bottom to top in the visual (INFO at base, ERROR on top)
      const STACK_ORDER = ['INFO', 'DEBUG', 'WARN', 'ERROR'];
      const UNKNOWN_COLOR = '#9ca3af';

      const chartH   = 80;  // svg viewBox height
      const maxC     = Math.max(1, ...buckets.map(b => b.count));
      const w        = 100 / buckets.length;

      // Build stacked segments per bucket. Draw from the baseline (y=chartH)
      // upward — `drawn` tracks how much of the stack we've laid down. Each
      // rect's top edge is at (chartH - drawn - h), height h.
      const barsSvg = buckets.map((b, i) => {
        const totalH = Math.max(1, (b.count / maxC) * chartH);
        const segs   = [];
        const levels = b.levels || [];
        let drawn = 0;
        for (const lvl of STACK_ORDER) {
          const found = levels.find(l => l.key === lvl);
          if (!found || found.count === 0) continue;
          const h = (found.count / b.count) * totalH;
          const y = chartH - drawn - h;
          segs.push(`<rect class="lv-hist-bar" x="${(i*w).toFixed(3)}%" y="${y.toFixed(2)}" width="${Math.max(w-0.15, 0.4)}%" height="${h.toFixed(2)}" fill="${LEVEL_COLOR[lvl]}" data-i="${i}"/>`);
          drawn += h;
        }
        // UNKNOWN / unclassified sits on top of the stack (grey cap).
        const known = levels.filter(l => STACK_ORDER.includes(l.key)).reduce((s, l) => s + l.count, 0);
        const unknown = b.count - known;
        if (unknown > 0) {
          const h = (unknown / b.count) * totalH;
          const y = chartH - drawn - h;
          segs.push(`<rect class="lv-hist-bar" x="${(i*w).toFixed(3)}%" y="${y.toFixed(2)}" width="${Math.max(w-0.15, 0.4)}%" height="${h.toFixed(2)}" fill="${UNKNOWN_COLOR}" opacity="0.7" data-i="${i}"/>`);
        }
        // Transparent hit target covers the whole column so tooltip triggers
        // even in the empty space above a short bar.
        segs.push(`<rect class="lv-hist-hit" x="${(i*w).toFixed(3)}%" y="0" width="${w.toFixed(3)}%" height="${chartH}" data-i="${i}"/>`);
        return segs.join('');
      }).join('');

      // X-axis labels — evenly-spaced (max 8 for readability)
      const labelCount = Math.min(8, buckets.length);
      const labelStep  = Math.max(1, Math.round((buckets.length - 1) / (labelCount - 1)));
      const xLabels = [];
      for (let i = 0; i < buckets.length; i += labelStep) {
        const t = new Date(buckets[i].time);
        const pctSpanH = (i * w + w / 2);
        xLabels.push(`<span style="left:${pctSpanH.toFixed(2)}%">${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>`);
      }
      // Ensure the final bucket's time also gets a label
      const lastI = buckets.length - 1;
      if (lastI % labelStep !== 0) {
        const t = new Date(buckets[lastI].time);
        const pctSpanH = (lastI * w + w / 2);
        xLabels.push(`<span style="left:${pctSpanH.toFixed(2)}%">${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>`);
      }

      // Meta line — total range + interval
      const t = d.time || {};
      const gtStr = t.gte ? new Date(t.gte).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
      const ltStr = t.lte ? new Date(t.lte).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '';
      const rangeStr = gtStr && ltStr ? `${gtStr} → ${ltStr}` : '';

      // Legend — show levels that actually appear anywhere in the data
      const seen = new Set();
      buckets.forEach(b => (b.levels || []).forEach(l => { if (l.count > 0) seen.add(l.key); }));
      const legendItems = STACK_ORDER
        .filter(l => seen.has(l))
        .map(l => `<span class="li"><span class="sw" style="background:${LEVEL_COLOR[l]}"></span>${l}</span>`).join('');

      hist.innerHTML = `
        <div class="lv-hist-yaxis">
          <span class="y-max">${maxC.toLocaleString()}</span>
          <span class="y-lbl">max</span>
        </div>
        <div class="lv-hist-wrap">
          <svg class="lv-hist-svg" viewBox="0 0 100 ${chartH}" preserveAspectRatio="xMinYMin meet" id="lv-hist-svg">
            ${barsSvg}
          </svg>
        </div>
        <div class="lv-hist-xaxis">${xLabels.join('')}</div>
        <div class="lv-hist-meta">
          <span>${esc(rangeStr)}</span>
          <span class="lv-hist-legend">${legendItems}</span>
          <span>bucket: ${esc(t.interval || '?')}</span>
        </div>
      `;

      // Wire hover tooltip (single global tooltip element created lazily)
      let tt = document.getElementById('lv-hist-tt');
      if (!tt) {
        tt = document.createElement('div');
        tt.id = 'lv-hist-tt';
        tt.className = 'lv-hist-tt';
        document.body.appendChild(tt);
      }
      const intervalMs = this._parseIntervalMs(t.interval);
      const svg = document.getElementById('lv-hist-svg');
      const onMove = (ev) => {
        const target = ev.target.closest('[data-i]');
        if (!target) { tt.classList.remove('on'); return; }
        const i = +target.dataset.i;
        const b = buckets[i];
        if (!b) { tt.classList.remove('on'); return; }
        const from = new Date(b.time);
        const to   = new Date(b.time + intervalMs);
        const fmt  = (dt) => dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        const rows = STACK_ORDER.map(lvl => {
          const lb = (b.levels || []).find(l => l.key === lvl);
          if (!lb || lb.count === 0) return '';
          return `<div class="lvl-row"><span class="lvl-dot" style="background:${LEVEL_COLOR[lvl]}"></span><span>${lvl}</span><span class="lvl-n">${lb.count.toLocaleString()}</span></div>`;
        }).join('');
        const known = (b.levels || []).filter(l => STACK_ORDER.includes(l.key)).reduce((s, l) => s + l.count, 0);
        const unknown = b.count - known;
        const unkRow = unknown > 0 ? `<div class="lvl-row"><span class="lvl-dot" style="background:${UNKNOWN_COLOR}"></span><span>OTHER</span><span class="lvl-n">${unknown.toLocaleString()}</span></div>` : '';
        tt.innerHTML = `
          <div class="head">${fmt(from)} → ${fmt(to)}</div>
          <div class="total">Total: <b>${b.count.toLocaleString()}</b> hits</div>
          ${rows}${unkRow}
        `;
        tt.classList.add('on');
        // Position — flip to the left if too close to right edge
        const pad = 14;
        const ttRect = tt.getBoundingClientRect();
        let x = ev.clientX + pad;
        let y = ev.clientY + pad;
        if (x + ttRect.width > window.innerWidth - 8) x = ev.clientX - ttRect.width - pad;
        if (y + ttRect.height > window.innerHeight - 8) y = ev.clientY - ttRect.height - pad;
        tt.style.left = Math.max(4, x) + 'px';
        tt.style.top  = Math.max(4, y) + 'px';
      };
      svg.addEventListener('mousemove', onMove);
      svg.addEventListener('mouseleave', () => tt.classList.remove('on'));
      // Click a bar → drill into that bucket's time window.
      svg.addEventListener('click', (ev) => {
        const target = ev.target.closest('[data-i]');
        if (!target) return;
        this._pickBucket(+target.dataset.i);
      });
    },

    _parseIntervalMs(s) {
      if (!s) return 60000;
      const m = /^(\d+)(ms|s|m|h|d)$/.exec(String(s));
      if (!m) return 60000;
      const n = +m[1];
      const unit = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
      return n * unit;
    },

    _renderSide(d) {
      const side = $('lv-side');
      const parts = [];
      // Most-found REST patterns (client-side)
      if (this._mostFound?.length) {
        parts.push(`<span class="h">Most repeated</span>`);
        this._mostFound.forEach(m => {
          const on = this._restFilter === m.key ? ' active' : '';
          const label = m.key.length > 40 ? m.key.slice(0, 40) + '…' : m.key;
          parts.push(`<span class="lv-chip${on}" title="${esc(m.key)}" onclick="SP.LogViewer._pickRestFilter('${esc(m.key)}')">${esc(label)} <span class="n">×${m.count}</span></span>`);
        });
      }
      if (d?.top_correlations?.length) {
        if (parts.length) parts.push(`<span style="opacity:.4">·</span>`);
        parts.push(`<span class="h">Top correlations</span>`);
        d.top_correlations.slice(0, 5).forEach(c => {
          parts.push(`<span class="lv-chip" onclick="SP.LogViewer._pickCid('${esc(c.key)}')">${esc(c.key.slice(0, 32))}${c.key.length>32?'…':''} <span class="n">${c.count}</span></span>`);
        });
      }
      if (d?.top_pods?.length) {
        if (parts.length) parts.push(`<span style="opacity:.4">·</span>`);
        parts.push(`<span class="h">Top pods</span>`);
        d.top_pods.slice(0, 5).forEach(p => {
          const short = p.key.split('-').slice(-2).join('-');
          parts.push(`<span class="lv-chip" title="${esc(p.key)}">${esc(short)} <span class="n">${p.count}</span></span>`);
        });
      }
      side.innerHTML = parts.join('');
      side.classList.toggle('on', parts.length > 0);
    },

    // Smart regexp input parser: accepts either a bare pattern OR the full
    // OpenSearch/Kibana DSL JSON ({"query":{"regexp":{"REST":{"value":"..."}}}}),
    // and always returns just the pattern string (or empty string).
    _parseRegexpInput(raw) {
      const s = (raw || '').trim();
      if (!s) return '';
      if (s.startsWith('{')) {
        try {
          const obj = JSON.parse(s);
          // Accept both {"query":{"regexp":{"REST":{"value":"..."}}}} and {"value":"..."}
          const val = obj?.query?.regexp?.REST?.value
                   ?? obj?.regexp?.REST?.value
                   ?? obj?.value
                   ?? null;
          if (val && typeof val === 'string') return val;
        } catch {}
        return ''; // malformed JSON → ignore silently
      }
      return s;
    },

    // Highlight search terms inside a REST log line.
    // Handles free-text (q) — strips DQL operators and highlights each word.
    // Returns HTML-safe string with <mark> spans around matched segments.
    _highlightRest(text, q, rx) {
      if (!text) return '';
      // Collect patterns to highlight
      const patterns = [];
      if (q) {
        // Extract plain words from DQL — drop operators/quotes for highlight purposes
        const words = q.replace(/[():]/g, ' ').trim().split(/\s+/)
          .filter(w => w.length >= 2 && !/^(AND|OR|NOT)$/i.test(w))
          .map(w => w.replace(/\*/g, '').replace(/^["']|["']$/g, '').trim())
          .filter(w => w.length >= 2);
        words.forEach(w => { try { patterns.push(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } catch {} });
      }
      if (rx) { try { new RegExp(rx); patterns.push(rx); } catch {} }
      if (!patterns.length) return esc(text);
      try {
        const combined = new RegExp(`(${patterns.join('|')})`, 'gi');
        const parts = []; let last = 0; let m;
        while ((m = combined.exec(text)) !== null) {
          if (m.index > last) parts.push(esc(text.slice(last, m.index)));
          parts.push(`<mark style="background:color-mix(in srgb,#f59e0b 40%,transparent);color:inherit;border-radius:2px;padding:0 2px;font-weight:700">${esc(m[0])}</mark>`);
          last = m.index + m[0].length;
          if (m[0].length === 0) { last++; } // guard infinite loop on zero-width match
        }
        if (last < text.length) parts.push(esc(text.slice(last)));
        return parts.join('');
      } catch { return esc(text); }
    },

    _renderTable(d) {
      const hits = d?.hits || [];
      const body = $('lv-body');
      if (!hits.length) {
        body.innerHTML = `<div class="lv-msg">No log entries matched the filters. Try widening the time range or removing filters.</div>`;
        return;
      }
      const visibleIndices = [];
      // Row `data-i` MUST stay tied to the original hits[] index so
      // _toggleRow(i) can look up the full source via this.lastResult.hits[i].
      const rows = hits.map((h, i) => {
        if (!this._matches(h)) return '';
        visibleIndices.push(i);
        const t = h.timestamp ? new Date(h.timestamp).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
        }) : '—';
        const lvl = (h.log_level || '').toUpperCase();
        const statusBadge = (() => {
          if (h.status_code == null) return '';
          const cls = h.status_code >= 500 ? 'err' : h.status_code >= 400 ? 'warn' : 'ok';
          return `<span class="lv-status-badge ${cls}">${h.status_code}</span>`;
        })();
        const lat = h.latency_ms != null ? `<span class="lv-lat">${h.latency_ms}ms</span>` : '';
        const cid = h.correlation_id
          ? `<a href="#" class="lv-cid" onclick="event.preventDefault();event.stopPropagation();SP.LogViewer._enterTrace('${esc(h.correlation_id)}')" title="Show all services for this correlation">${esc(h.correlation_id)}</a>`
          : '';
        const restKey = (h.rest || '').slice(0, 120);
        const freq = this._mostFound.find(m => m.key === restKey);
        const freqBadge = freq ? `<span style="display:inline-flex;align-items:center;padding:0 5px;border-radius:3px;font-size:9.5px;font-weight:700;background:color-mix(in srgb,#f26419 18%,transparent);color:#f26419;margin-right:5px;font-family:inherit">×${freq.count}</span>` : '';
        const rowBg = freq ? ' style="background:color-mix(in srgb,#f26419 5%,transparent)"' : '';
        const qTerm = $('lv-q').value.trim();
        const rxTerm = $('lv-regexp').value.trim();
        const restHtml = this._highlightRest(h.rest, qTerm, rxTerm);
        return `<tr data-i="${i}"${rowBg} onclick="SP.LogViewer._toggleRow(${i})">
          <td class="lv-time">${t}</td>
          <td><span class="lv-mod" title="${esc(h.module)}">${esc(h.module)}</span></td>
          <td><span class="lv-lvl ${lvl}">${esc(lvl || '—')}</span></td>
          <td class="lv-rest">${freqBadge}${statusBadge}${lat}<span style="color:var(--text)">${restHtml}</span></td>
          <td>${cid}</td>
        </tr>`;
      }).filter(Boolean).join('');

      // Empty-after-filter case: something matched the server query but
      // nothing survives the client-side status filter. Give a clear hint
      // rather than falling through to the raw table with 0 rows.
      if (!rows) {
        body.innerHTML = `<div class="lv-msg">
          No rows match the active filters (client-side).
          <div style="margin-top:8px;font-size:12px">
            <button class="lv-btn" style="display:inline-flex" onclick="SP.LogViewer._clearAllFilters()">Clear all filters</button>
          </div>
        </div>`;
        return;
      }

      const filterNote = this._statusFilter
        ? `<div style="padding:6px 12px;font-size:11.5px;color:var(--text-muted);background:color-mix(in srgb,var(--text-muted) 6%,transparent);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:3">
            Showing <b style="color:var(--text)">${visibleIndices.length}</b> of ${hits.length} loaded rows · filter: <b style="color:var(--text)">${esc(this._statusFilter)}</b> ·
            <a href="#" onclick="event.preventDefault();SP.LogViewer._pickStatus('${esc(this._statusFilter)}')" style="color:#3b82f6">clear</a>
          </div>` : '';

      body.innerHTML = `${filterNote}<table class="lv-tbl">
        <thead>
          <tr>
            <th style="width:110px">Time</th>
            <th style="width:220px">Module</th>
            <th style="width:60px">Level</th>
            <th>REST</th>
            <th style="width:220px">Correlation</th>
          </tr>
        </thead>
        <tbody id="lv-tbody">${rows}</tbody>
      </table>`;
    },

    _matches(h) {
      const sc = h.status_code;
      const sf = this._statusFilter;
      if (sf) {
        if (sf === 'ok'      && !(sc >= 200 && sc < 300)) return false;
        if (sf === 'warn'    && !(sc >= 400 && sc < 500)) return false;
        if (sf === 'err'     && !(sc >= 500))              return false;
        if (sf === 'other'   && !(sc != null && (sc < 200 || (sc >= 300 && sc < 400)))) return false;
        if (sf === 'unknown' && sc != null)                return false;
      }
      if (this._restFilter && !h.rest?.includes(this._restFilter)) return false;
      return true;
    },

    _computeMostFound(hits) {
      const freq = new Map();
      hits.forEach(h => {
        const key = (h.rest || '').slice(0, 120);
        if (key) freq.set(key, (freq.get(key) || 0) + 1);
      });
      this._mostFound = [...freq.entries()]
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([key, count]) => ({ key, count }));
    },

    _pickRestFilter(key) {
      this._restFilter = (this._restFilter === key) ? null : key;
      this._renderTable(this.lastResult);
      this._renderSide(this.lastResult);
      this._renderActiveFilters();
    },

    _toggleRow(i) {
      const tbody = $('lv-tbody');
      const tr = tbody.querySelector(`tr[data-i="${i}"]`);
      if (!tr) return;
      const next = tr.nextElementSibling;
      if (next?.classList.contains('detail')) {
        next.remove();
        tr.classList.remove('expanded');
        return;
      }
      const h = this.lastResult?.hits?.[i];
      if (!h) return;
      tr.classList.add('expanded');
      const dtl = document.createElement('tr');
      dtl.className = 'detail';
      dtl.innerHTML = `<td colspan="5"><pre class="lv-detail-pre">${esc(JSON.stringify(h.source, null, 2))}</pre></td>`;
      tr.after(dtl);
    },

    _pickCid(cid) {
      $('lv-cid').value = cid;
      this.search();
    },

    async _enterTrace(cid) {
      this.traceCid = cid;
      // Drop any client-side status filter — trace mode is about seeing the
      // full request path, so filtering out rows would defeat the purpose.
      this._statusFilter = null;
      $('lv-active').classList.remove('on');
      $('lv-trace').style.display = '';
      $('lv-trace-cid').textContent = cid;
      $('lv-body').innerHTML = `<div class="lv-msg"><span class="lv-spinner"></span> Loading trace…</div>`;
      const res = await API.opensearch.trace({
        endpoint_id:    $('lv-endpoint').value,
        index_pattern:  $('lv-index').value,
        correlation_id: cid,
        range:          $('lv-range').value,
        // Cap at max_size from admin config so an over-broad trace can't
        // exhaust the backend; trace requests are typically <=1k lines.
        size:           Math.min(1000, this.defaults.max_size || 1000),
      });
      if (!res?.ok) {
        $('lv-body').innerHTML = `<div class="lv-msg err">Trace failed: ${esc(res?.data?.message || 'unknown')}</div>`;
        return;
      }
      const d = res.data?.data || {};
      // Reuse the same summary/histogram but simulate a search result shape
      this.lastResult = { hits: d.hits, total: d.total, total_relation: d.total_relation || 'eq', returned: d.returned, took_ms: d.took_ms, shards: d.shards || null, summary: { status: {ok:0,warn:0,error:0,unknown:0}, latency_avg: null, latency_max: null, latency_n: 0 }, histogram: [], top_correlations: [], top_pods: [] };
      // Recompute summary from these hits (trace mode has no histogram)
      const s = { ok:0, warn:0, error:0, unknown:0 };
      d.hits.forEach(h => {
        if (h.status_code == null) s.unknown++;
        else if (h.status_code >= 500) s.error++;
        else if (h.status_code >= 400) s.warn++;
        else s.ok++;
      });
      this.lastResult.summary.status = s;
      // Cache the module list so the "All" chip and single-module filter can
      // re-render the side bar without another network call.
      this._traceModules   = d.modules || [];
      this._traceModFilter = null;
      this._renderSummary(this.lastResult);
      // Diagnostic hint: partial results OR fewer returned than total OR shard
      // failures — all things that explain "why does count differ from OpenSearch?"
      const hintParts = [`${d.modules.length} service${d.modules.length!==1?'s':''} touched this request`];
      if (d.total > d.returned) {
        hintParts.push(`<span style="color:var(--warn,#f59e0b)">returned ${d.returned} of ${d.total}${d.total_relation === 'gte' ? '+' : ''} — bump size to see more</span>`);
      }
      if (d.shards && d.shards.failed > 0) {
        hintParts.push(`<span style="color:var(--hot,#ef4444)">${d.shards.failed}/${d.shards.total} shards failed — result may be partial</span>`);
      }
      $('lv-hist').innerHTML = `<div class="lv-hist-empty">Trace mode · ${hintParts.join(' · ')}</div>`;
      this._renderTraceModules();
      this._renderTable(this.lastResult);
    },

    _renderTraceModules() {
      const mods = this._traceModules || [];
      if (!mods.length) { $('lv-side').classList.remove('on'); return; }
      const total = mods.reduce((s, m) => s + m.count, 0);
      const cur = this._traceModFilter;
      const allChip = `<span class="lv-chip${cur ? '' : ' active'}" onclick="SP.LogViewer._filterModuleInTrace(null)" title="Show every module (default view)">All <span class="n">${total}</span></span>`;
      const modChips = mods.map(m => {
        const on = cur === m.module ? ' active' : '';
        return `<span class="lv-chip${on}" onclick="SP.LogViewer._filterModuleInTrace('${esc(m.module)}')" title="Filter this trace by module">${esc(m.module)} <span class="n">${m.count}</span></span>`;
      }).join('');
      $('lv-side').innerHTML = `<span class="h">Modules in this trace</span>${allChip}${modChips}`;
      $('lv-side').classList.add('on');
    },

    _filterModuleInTrace(mod) {
      if (!this.lastResult) return;
      // null = "All"; clicking the currently-selected chip toggles back to All.
      const next = (mod === this._traceModFilter) ? null : mod;
      this._traceModFilter = next;
      this._renderTraceModules();
      const hits = next
        ? this.lastResult.hits.filter(h => h.module === next)
        : this.lastResult.hits;
      this._renderTable({ hits });
    },

    _exitTrace() {
      this.traceCid = '';
      $('lv-trace').style.display = 'none';
      this.search();
    },

    // Re-run trace for the same CORRELATION_ID — useful when the initial
    // trace ran before slow-arriving logs (timeouts, error paths) had time
    // to be shipped/indexed.
    _refreshTrace() {
      if (this.traceCid) this._enterTrace(this.traceCid);
    },

    // ── Per-user credential management ────────────────────────────────────
    // Show inline credential form when the proxy returns no_user_creds.
    _renderCredPrompt(endpointId) {
      const epName = this.endpoints.find(e => e.id === endpointId)?.name || endpointId;
      $('lv-body').innerHTML = `
        <div class="lv-msg" style="text-align:left;max-width:420px;margin:0 auto;padding:32px 20px">
          <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px">OpenSearch credentials required</div>
          <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:20px">
            Enter your personal credentials for <b style="color:var(--text)">${esc(epName)}</b>.
            These are stored encrypted and are yours only — other users cannot see them.
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px">Username</label>
              <input id="lv-cred-user" type="text" placeholder="OpenSearch username" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit;font-size:13px" />
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px">Password</label>
              <input id="lv-cred-pass" type="password" placeholder="Password" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit;font-size:13px" />
            </div>
            <button id="lv-cred-save" class="lv-btn primary" style="margin-top:4px;justify-content:center"
              onclick="SP.LogViewer._saveCredentials('${esc(endpointId)}')">Save &amp; Search</button>
            <div id="lv-cred-err" style="font-size:12px;color:#ef4444;display:none"></div>
            <div style="font-size:11px;color:var(--text-muted)">
              You can manage your saved credentials in
              <a href="log-explorer.html" style="color:#3b82f6">Log Explorer</a>.
            </div>
          </div>
        </div>`;
      document.getElementById('lv-cred-pass')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._saveCredentials(endpointId);
      });
    },

    async _saveCredentials(endpointId) {
      const user = document.getElementById('lv-cred-user')?.value.trim();
      const pass = document.getElementById('lv-cred-pass')?.value;
      const errEl = document.getElementById('lv-cred-err');
      const btn   = document.getElementById('lv-cred-save');
      if (!user || !pass) {
        if (errEl) { errEl.textContent = 'Username and password are required'; errEl.style.display = ''; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      const res = await API.opensearch.userCreds.save({ endpoint_id: endpointId, username: user, password: pass });
      if (!res?.ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Save & Search'; }
        if (errEl) { errEl.textContent = res?.data?.message || 'Failed to save credentials'; errEl.style.display = ''; }
        return;
      }
      // Credentials saved — update local cache and retry search
      this._userCreds[endpointId] = { username: user };
      this._renderCredStatus();
      this.search();
    },

    // Update the small cred chip in the modal header (shows "Logged in as X" or "Setup")
    _renderCredStatus() {
      const epId = $('lv-endpoint')?.value;
      if (!epId) return;
      const cred = this._userCreds[epId];
      const bar  = $('lv-cred-bar');
      if (!bar) return;
      if (cred?.username) {
        bar.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">Logged in as <b style="color:var(--text)">${esc(cred.username)}</b></span>
          <button style="margin-left:6px;font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;padding:0" onclick="SP.LogViewer._promptChangeCredentials()">Change</button>`;
      } else {
        bar.innerHTML = `<button style="font-size:11px;color:#f59e0b;background:none;border:none;cursor:pointer;padding:0;font-weight:600"
          onclick="SP.LogViewer._renderCredPrompt('${esc(epId)}')">&#x26A0; No credentials — click to setup</button>`;
      }
    },

    _promptChangeCredentials() {
      const epId = $('lv-endpoint')?.value;
      if (!epId) return;
      this._renderCredPrompt(epId);
    },

    // ── End credential management ──────────────────────────────────────────
    async exportCsv() {
      const hits = this.lastResult?.hits || [];
      if (!hits.length) { await SOMDialog.alert('No rows to export', { title: 'แจ้งเตือน', icon: 'info' }); return; }
      const rows = [['timestamp','module','log_level','status_code','latency_ms','correlation_id','pod','rest']];
      hits.forEach(h => rows.push([
        h.timestamp || '', h.module || '', h.log_level || '',
        h.status_code ?? '', h.latency_ms ?? '',
        h.correlation_id || '', h.pod || '',
        (h.rest || '').replace(/\r?\n/g, ' ')
      ]));
      const csv = rows.map(r => r.map(c => {
        const s = String(c);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logs_${this.service}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },

    async openInOpenSearch() {
      const res = await API.opensearch.deeplink(this._params());
      if (!res?.ok) { await SOMDialog.alert(res?.data?.message || 'Deeplink failed', { title: 'เกิดข้อผิดพลาด', icon: 'danger' }); return; }
      window.open(res.data.data.url, '_blank', 'noopener');
    },
  };

  // Enter in filter inputs re-runs the search.
  ['lv-q', 'lv-cid', 'lv-regexp'].forEach(id => {
    $(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); LV.search(); }
    });
  });
  ['lv-endpoint', 'lv-index', 'lv-range', 'lv-lvl'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      if (id === 'lv-range') {
        LV._bucketRange = null;
        const isCustom = $('lv-range').value === 'custom';
        $('lv-custom-start').style.display = isCustom ? '' : 'none';
        $('lv-custom-end').style.display   = isCustom ? '' : 'none';
        if (isCustom) { $('lv-custom-start').focus(); return; } // don't auto-search until dates filled
      }
      LV.search();
    });
  });
  // Run search when custom date inputs change (both must be filled)
  ['lv-custom-start', 'lv-custom-end'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      if ($('lv-custom-start').value && $('lv-custom-end').value) LV.search();
    });
  });

  // Esc closes the overlay (except while typing in a filter input — Esc there clears).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('lv-ovl')?.classList.contains('on')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    LV.close();
  });
})();


/* ── next inline block ── */


(function(){
  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtDur = (secs) => secs >= 3600 ? Math.round(secs/3600)+'h' : secs >= 60 ? Math.round(secs/60)+'m' : secs+'s';
  const fmtAgo = (ts) => {
    if (!ts) return '—';
    const d = Math.max(0, Math.floor(Date.now()/1000) - ts);
    if (d < 60) return d + 's ago';
    if (d < 3600) return Math.floor(d/60) + 'm ago';
    if (d < 86400) return Math.floor(d/3600) + 'h ago';
    return Math.floor(d/86400) + 'd ago';
  };
  const fmtValue = (v, unit) => {
    if (v === null || v === undefined) return '—';
    if (unit === 'ms')    return v >= 1000 ? (v/1000).toFixed(2)+'s' : v.toFixed(0)+'ms';
    if (unit === 'pct')   return v.toFixed(1)+'%';
    if (unit === 'bytes') return v >= 1073741824 ? (v/1073741824).toFixed(2)+' GB' : (v/1048576).toFixed(0)+' MB';
    if (unit === 'cores') return v >= 1 ? v.toFixed(2)+' cores' : Math.round(v*1000)+' m';
    return v.toFixed(2);
  };

  const Alerts = window.SP.Alerts = {
    service:  '',
    rules:    [],
    metrics:  {},
    editing:  null,   // rule being edited (or null for new)
    channels: {},     // cached webhook config (keyed by channel name)
    _mode:    null,   // 'rule' | 'config' — drives which Save handler runs
    // Single dispatched save so we don't play games with onclick reassignment
    // (that pattern silently broke when the user opened config → new-alert
    // in sequence because the Save button was still bound to _saveConfig).
    _dispatchSave() {
      if (this._mode === 'config') return this._saveConfig();
      return this.save();
    },

    async open(service) {
      this.service = service || '';
      $('sa-svc-name').textContent = this.service || '(all services)';
      $('sa-overlay').classList.add('on');
      await this.refresh();
      // Drawer ticker — while open, refresh state every 15s (server tick is
      // 30s throttled; 15s poll ensures we see freshly-changed states within
      // one server cycle) + tick the "Next in …" countdown every second.
      this._startTicker();
    },
    close() {
      $('sa-overlay').classList.remove('on');
      this._stopTicker();
    },

    _startTicker() {
      this._stopTicker();
      // 1s tick — updates only the countdown text (no network).
      this._countdownT = setInterval(() => this._tickCountdowns(), 1000);
      // 15s refresh — pulls fresh state (fires, notifyOk transitions).
      this._refreshT = setInterval(() => { if ($('sa-overlay').classList.contains('on')) this.refresh(); }, 15000);
    },
    _stopTicker() {
      if (this._countdownT) { clearInterval(this._countdownT); this._countdownT = null; }
      if (this._refreshT)   { clearInterval(this._refreshT);   this._refreshT   = null; }
    },
    // Update every "Next in …" span with the remaining seconds until the
    // next scheduled re-fire. When it hits 0 the server-side tick.php will
    // pick it up on its next 30s cycle; UI just says "any moment now".
    _tickCountdowns() {
      const now = Math.floor(Date.now() / 1000);
      document.querySelectorAll('.sa-next-fire').forEach(el => {
        const nextTs = +el.dataset.nextFire;
        if (!nextTs) return;
        const rem = nextTs - now;
        if (rem <= 0) {
          el.textContent = 'Next fire: any moment (rechecked ทุก 30s)';
          el.style.color = 'var(--hot)';
        } else {
          const mm = Math.floor(rem / 60);
          const ss = rem % 60;
          el.textContent = mm > 0
            ? `Next fire in ${mm}m ${String(ss).padStart(2,'0')}s`
            : `Next fire in ${ss}s`;
        }
      });
    },

    async refresh() {
      const body = $('sa-body');
      // First open shows skeleton so the summary strip + a few rule cards
      // are in place immediately. Silent refresh (called by the 15s
      // background poll) skips the flash — dims the body slightly instead.
      const isFirstLoad = !this.rules.length;
      if (isFirstLoad) {
        body.innerHTML = `
          <div class="sa-summary">
            <div class="sa-sum-card"><div class="da-skel" style="height:22px;width:40%"></div><div class="lbl">Firing</div></div>
            <div class="sa-sum-card"><div class="da-skel" style="height:22px;width:40%"></div><div class="lbl">Pending</div></div>
            <div class="sa-sum-card"><div class="da-skel" style="height:22px;width:40%"></div><div class="lbl">OK</div></div>
            <div class="sa-sum-card"><div class="da-skel" style="height:22px;width:40%"></div><div class="lbl">Total</div></div>
          </div>
          ${[1,2,3].map(() => `
            <div class="sa-rule">
              <div class="da-skel" style="width:34px;height:34px;border-radius:9px"></div>
              <div style="flex:1">
                <div class="da-skel" style="height:14px;width:60%"></div>
                <div class="da-skel" style="height:10px;width:80%;margin-top:6px"></div>
              </div>
              <div class="da-skel" style="height:22px;width:60px;border-radius:99px"></div>
            </div>`).join('')}`;
      } else {
        body.style.opacity = '0.6';
        body.style.transition = 'opacity .15s';
      }
      try {
        const res = await API.alerts.list(this.service);
        if (!res?.ok) throw new Error(res?.data?.message || 'load failed');
        this.rules   = res.data?.data?.rules   || [];
        this.metrics = res.data?.data?.metrics || {};
        this._render();
      } catch (e) {
        body.innerHTML = `<div class="sa-empty" style="color:var(--hot)">โหลด rules ไม่สำเร็จ: ${esc(e.message)}</div>`;
      } finally {
        body.style.opacity = '';
      }
    },

    _render() {
      const body = $('sa-body');
      // Metric icons — shared with the New Alert modal picker so the same
      // visual identity carries across the whole feature.
      // Metric icons — use SVG icon names (rendered via <i data-icon>) so
      // the drawer stays emoji-free per the "no emoji in HTML sinks" rule.
      const METRIC_ICONS = {
        cpu: 'zap', cpu_pod_max: 'zap', mem: 'database', mem_pod_max: 'layers',
        heap_pct: 'package', dbpool_active: 'server',
        error_rate: 'alert-triangle', latency: 'clock', latency_max: 'flame', gc_pause: 'recycle',
        txn_rate: 'bar-chart', restarts: 'refresh-cw', oom_killed: 'skull',
      };
      const METRIC_COLORS = {
        cpu: '#8b5cf6', cpu_pod_max: '#dc2626', mem: '#10b981', mem_pod_max: '#ef4444',
        heap_pct: '#8b5cf6', dbpool_active: '#06b6d4',
        error_rate: '#ef4444', latency: '#f59e0b', latency_max: '#dc2626', gc_pause: '#f59e0b',
        txn_rate: '#8b5cf6', restarts: '#f59e0b', oom_killed: '#dc2626',
      };
      if (!this.rules.length) {
        const emptyLabel = this.service
          ? `ยังไม่มี alert สำหรับ <b>${esc(this.service)}</b>`
          : 'ยังไม่มี alert เลย';
        body.innerHTML = `
          <div class="sa-empty">
            <div class="icon"><i data-icon="bell" style="width:26px;height:26px"></i></div>
            <div>${emptyLabel}</div>
            <div style="margin-top:10px;font-size:12px">คลิก <b>+ New alert</b> ที่มุมขวาบนเพื่อสร้างกฎแรก</div>
          </div>`;
        if (window.Icons?.replaceAll) window.Icons.replaceAll(body);
        return;
      }
      // Summary strip — quick counts by state so users see the fleet
      // health at a glance without scanning the list.
      const counts = { firing:0, pending:0, ok:0, unknown:0 };
      for (const r of this.rules) counts[r.state] = (counts[r.state] || 0) + 1;
      const summaryHtml = `
        <div class="sa-summary">
          <div class="sa-sum-card firing"><div class="val">${counts.firing || 0}</div><div class="lbl">Firing</div></div>
          <div class="sa-sum-card"><div class="val">${counts.pending || 0}</div><div class="lbl">Pending</div></div>
          <div class="sa-sum-card ok"><div class="val">${counts.ok || 0}</div><div class="lbl">OK</div></div>
          <div class="sa-sum-card"><div class="val">${this.rules.length}</div><div class="lbl">Total</div></div>
        </div>`;
      // Group by service when viewing "all" — makes it easier to scan a
      // long list. Same-service view keeps flat layout (cleaner).
      const showServiceHeaders = !this.service;
      const bySvc = new Map();
      for (const r of this.rules) {
        const k = r.service || '(unknown)';
        if (!bySvc.has(k)) bySvc.set(k, []);
        bySvc.get(k).push(r);
      }
      const renderRule = (r) => {
        const m = this.metrics[r.metric] || { label: r.metric, unit: '' };
        const stateLabel = { ok:'OK', pending:'PENDING', firing:'FIRING', unknown:'UNKNOWN' }[r.state] || 'OK';
        // Notify status pill — only meaningful if the rule has fired at
        // least once. notifyOk true=sent, false=failed, null=never tried.
        let notifyPill = '';
        if (r.notifyOk === true)  notifyPill = `<span class="sa-rule-state ok" title="Last transition sent successfully">✓ sent</span>`;
        if (r.notifyOk === false) notifyPill = `<span class="sa-rule-state firing" title="${esc(r.notifyError || 'unknown error')}">✕ send failed</span>`;
        // Repeat / next-fire hint. When firing:
        //   • repeat=0 → "🔇 no repeat" (single-fire per outage, default)
        //   • repeat>0 → countdown "Next in Xm Ys" (auto-tick every second
        //     via data-nextfire attribute the drawer poller updates).
        // When not firing, show the configured repeat interval so users can
        // see whether the rule is even set up to nag.
        let repeatLine = '';
        const repeat = +(r.repeatIntervalSec || 0);
        if (r.state === 'firing') {
          if (repeat > 0 && r.lastFireTs) {
            const nextTs = r.lastFireTs + repeat;
            repeatLine = ` · <span class="sa-next-fire" data-next-fire="${nextTs}" style="color:var(--warn);font-weight:600">Next in …</span>`;
          } else {
            // Single-fire mode = current default for rules made before the
            // repeat feature. Make it a call-to-action link so the user can
            // enable re-notify without hunting through Edit → Repeat dropdown.
            repeatLine = ` · <a href="#" onclick='event.preventDefault(); SP.Alerts.edit(${JSON.stringify(r.id)})' title="Click to open Edit and pick a repeat interval — silent by default" style="color:var(--warn);text-decoration:underline;text-decoration-style:dotted;cursor:pointer">ไม่ยิงซ้ำ · คลิกเพื่อเปิด repeat</a>`;
          }
        } else if (repeat > 0) {
          repeatLine = ` · <span style="color:var(--sp-text-soft)">repeat every ${fmtDur(repeat)}</span>`;
        }
        const iconName = METRIC_ICONS[r.metric] || 'circle';
        const iconCol  = METRIC_COLORS[r.metric] || '#6b7280';
        // Clean metric label — drop the " — …" tail (which we show elsewhere).
        const metricName = (m.label || r.metric).replace(/\s*—.*$/, '');
        return `
        <div class="sa-rule ${r.enabled ? '' : 'disabled'}" data-state="${esc(r.state)}">
          <div class="ico" style="background:color-mix(in srgb, ${iconCol} 15%, transparent);color:${iconCol}"><i data-icon="${iconName}" style="width:16px;height:16px"></i></div>
          <div style="min-width:0">
            <div class="sa-rule-title">
              ${esc(metricName)}
              <span class="op-badge">${r.op} ${m.compareAs === 'pct' ? r.threshold+'%' : esc(fmtValue(r.threshold, m.unit))}</span>
              <span style="color:var(--text-muted);font-weight:500;font-size:11.5px">for ${fmtDur(r.durationSec)}</span>
              ${r.uriPattern ? `<span class="mono" style="font-size:10.5px;color:var(--cool);background:color-mix(in srgb,var(--cool) 12%,transparent);padding:2px 6px;border-radius:4px;margin-left:4px" title="Per-endpoint scope (regex): ${esc(r.uriPattern)}">${esc(r.uriPattern.length > 32 ? r.uriPattern.substring(0, 30) + '…' : r.uriPattern)}</span>` : ''}
            </div>
            <div class="sa-rule-sub">
              Current: <b>${esc(fmtValue(r.lastValue, m.unit))}</b> ·
              checked ${fmtAgo(r.lastCheck)} ·
              ${r.lastFireTs ? `fired ${fmtAgo(r.lastFireTs)}` : 'never fired'}
              ${r.channel ? ' · ch <code>' + esc(r.channel) + '</code>' : ''}
              ${repeatLine}
              ${r.notifyOk === false && r.notifyError ? '<br><span style="color:var(--hot)">⚠ ' + esc(r.notifyError) + '</span>' : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="sa-rule-state ${esc(r.state)}">● ${stateLabel}</span>
            ${notifyPill}
            <div class="sa-rule-actions">
              <button class="sa-rule-btn" onclick='SP.Alerts.test(${JSON.stringify(r.id)}, this)' title="Send a test Google Chat card now — verify webhook works" style="color:var(--cool)">Test</button>
              <button class="sa-rule-btn" onclick='SP.Alerts.toggle(${JSON.stringify(r.id)})' title="${r.enabled ? 'Disable' : 'Enable'}">
                ${r.enabled ? 'On' : 'Off'}
              </button>
              <button class="sa-rule-btn" onclick='SP.Alerts.edit(${JSON.stringify(r.id)})' title="Edit">Edit</button>
              <button class="sa-rule-btn" onclick='SP.Alerts.del(${JSON.stringify(r.id)})' title="Delete" style="color:var(--hot)">✕</button>
            </div>
          </div>
        </div>`;
      };
      // Compose final HTML — summary strip + optional service headers.
      const parts = [summaryHtml];
      for (const [svc, rules] of bySvc.entries()) {
        if (showServiceHeaders) {
          parts.push(`<div class="sa-svc-header" onclick="SP.Alerts.open('${esc(svc)}')" title="Filter to this service only">
            <span style="color:var(--brand,#f26419)">▸</span>
            <span>${esc(svc)}</span>
            <span class="count">${rules.length} rule${rules.length!==1?'s':''}</span>
          </div>`);
        }
        parts.push(rules.map(renderRule).join(''));
      }
      body.innerHTML = parts.join('');
      if (window.Icons?.replaceAll) window.Icons.replaceAll(body);
    },

    async openForm(rule) {
      this.editing = rule || null;
      this._mode   = 'rule';
      // Reset the "initialized" flag so _metricChanged() knows the next
      // call is the FIRST render (skip auto-fill so we keep rule's value).
      this._metricInitialized = false;
      const svcCtx = rule?.service || this.service;
      $('sa-modal-title').textContent = rule ? 'Edit alert' : (svcCtx ? 'New alert for ' + svcCtx : 'New alert');
      $('sa-save-btn').textContent = 'Save alert';
      // Fetch channels so the dropdown lists real webhooks (created via ⚙).
      // Silently falls back to a single "default" option if the config load
      // fails or the user hasn't set any up yet.
      try {
        const cfgRes = await API.alerts.notifyConfig.get();
        this.channels = cfgRes?.data?.data?.channels || {};
      } catch { this.channels = {}; }
      const channelNames = Object.keys(this.channels);
      if (!channelNames.length) channelNames.push('default');
      const metrics = this.metrics || {};
      const r = rule || { metric:'cpu', op:'>', threshold:80, durationSec:60, channel:channelNames[0], enabled:true, note:'' };
      // Group options by their `groupLabel` — puts % metrics together,
      // latency metrics together, etc. Users pick the RIGHT group first
      // (unit type) then the specific metric within.
      const groups = {};
      Object.entries(metrics).forEach(([k, m]) => {
        const g = m.groupLabel || m.label || 'Other';
        if (!groups[g]) groups[g] = [];
        groups[g].push([k, m]);
      });
      // Per-metric icon + accent color for the picker card. Uses simple
      // unicode symbols (no icon-font dep) with themed background chip.
      // Metric icons — use SVG icon names (rendered via <i data-icon>) so
      // the drawer stays emoji-free per the "no emoji in HTML sinks" rule.
      const METRIC_ICONS = {
        cpu: 'zap', mem: 'database', heap_pct: 'package', dbpool_active: 'server',
        error_rate: 'alert-triangle', latency: 'clock', latency_max: 'flame', gc_pause: 'recycle',
        txn_rate: 'bar-chart', restarts: 'refresh-cw',
        // Alerts+ Phase 1
        cpu_throttled: 'zap', http_pool_pending: 'link', http_pool_util: 'link',
        cb_open: 'shield-off', latency_p95: 'clock', dbpool_pending: 'server',
        // Alerts+ Phase 2
        hpa_max: 'trending-up', thread_blocked: 'lock', downstream_error: 'link',
        tomcat_busy: 'cpu', fd_pct: 'file-text', gc_freq: 'recycle',
      };
      const METRIC_ICON_BG = {
        cpu: '#8b5cf6', mem: '#10b981', heap_pct: '#8b5cf6', dbpool_active: '#06b6d4',
        error_rate: '#ef4444', latency: '#f59e0b', latency_max: '#dc2626', gc_pause: '#f59e0b',
        txn_rate: '#8b5cf6', restarts: '#f59e0b',
        // Alerts+ Phase 1
        cpu_throttled: '#dc2626', http_pool_pending: '#dc2626', http_pool_util: '#f59e0b',
        cb_open: '#dc2626', latency_p95: '#f59e0b', dbpool_pending: '#dc2626',
        // Alerts+ Phase 2
        hpa_max: '#06b6d4', thread_blocked: '#dc2626', downstream_error: '#ef4444',
        tomcat_busy: '#f59e0b', fd_pct: '#f59e0b', gc_freq: '#f59e0b',
      };
      // Preset threshold chips per metric — 1-click quick values.
      const PRESETS = {
        cpu: [50, 70, 80, 90], mem: [70, 80, 85, 90], heap_pct: [70, 80, 85, 90],
        dbpool_active: [70, 80, 90, 95], error_rate: [0.5, 1, 5, 10],
        latency: [200, 500, 1000, 2000], latency_max: [1000, 3000, 5000, 10000],
        gc_pause: [100, 300, 500, 1000], txn_rate: [100, 500, 1000, 5000],
        restarts: [1, 2, 3, 5],
        // Alerts+ Phase 1
        cpu_throttled: [1, 5, 15, 25], http_pool_pending: [1, 5, 10, 20],
        http_pool_util: [70, 80, 90, 95], cb_open: [1, 2, 3, 5],
        latency_p95: [200, 500, 1000, 2000], dbpool_pending: [1, 3, 5, 10],
        // Alerts+ Phase 2
        hpa_max: [80, 90, 95, 100], thread_blocked: [1, 5, 10, 20],
        downstream_error: [0.5, 1, 5, 10], tomcat_busy: [70, 80, 90, 95],
        fd_pct: [60, 75, 85, 95], gc_freq: [0.3, 0.5, 1, 2],
      };
      Alerts._presets = PRESETS;   // stash so _pickMetric can read

      const metricGridHtml = Object.entries(groups).map(([groupLabel, items]) => `
        <div class="sa-metric-group-title">${esc(groupLabel)}</div>
        <div class="sa-metric-grid">
          ${items.map(([k, m]) => `
            <button type="button" class="sa-metric-card ${k===r.metric?'on':''}" data-metric="${esc(k)}"
                    data-unit="${esc(m.unit)}" data-cmp="${esc(m.compareAs)}"
                    data-suggested="${esc(m.suggested ?? '')}"
                    data-agg="${esc(m.aggregation ?? '')}"
                    data-desc="${esc(m.description ?? '')}"
                    data-supports-uri="${m.supportsUri ? '1' : '0'}"
                    data-bypod="${m.byPod ? '1' : '0'}"
                    data-source="${esc(m.source ?? '')}"
                    onclick="SP.Alerts._pickMetric('${esc(k)}')">
              <div class="top">
                <span class="ico" style="background:color-mix(in srgb, ${METRIC_ICON_BG[k] || '#6b7280'} 15%, transparent);color:${METRIC_ICON_BG[k] || '#6b7280'}"><i data-icon="${METRIC_ICONS[k] || 'circle'}" style="width:14px;height:14px"></i></span>
                <span class="name">${esc(m.label.replace(/\s*—.*$/, ''))}</span>
              </div>
              <div class="agg">${esc((m.aggregation || '').substring(0, 60))}</div>
            </button>`).join('')}
        </div>
      `).join('');
      // Service picker — visible when we don't already know which service
      // this rule targets (top-bar new-alert flow). Preloaded with the full
      // inventory so the user sees the whole list on focus without typing.
      // Falls back to typeahead if the list is huge (browser handles filter).
      const svcPickerHtml = (!rule && !this.service) ? `
        <div class="sa-field">
          <label>Service</label>
          <input type="text" id="sa-f-service" placeholder="Click to browse or type to filter..." list="sa-f-service-list" autocomplete="off">
          <datalist id="sa-f-service-list"></datalist>
          <div class="hint" id="sa-f-service-hint">Loading services…</div>
        </div>
      ` : '';
      // Hidden inputs mirror the visual pickers so save() reads from
      // single input IDs (keeps save() untouched). Visual state = source
      // of truth; hidden input updated by _pickOp / _pickDur / _pickRepeat.
      $('sa-modal-body').innerHTML = `
        ${svcPickerHtml}

        <div class="sa-sect">
          <div class="sa-sect-title">
            <span class="step">1</span>
            <span class="lbl">เลือก metric ที่ต้องการ monitor</span>
          </div>
          ${metricGridHtml}
          <div class="sa-metric-detail" id="sa-metric-detail">Select a metric above to see what it watches</div>
        </div>

        <div class="sa-sect">
          <div class="sa-sect-title">
            <span class="step">2</span>
            <span class="lbl">ตั้ง threshold — เมื่อค่าเกินตรงนี้ = fire</span>
          </div>
          <div class="sa-op-group" role="radiogroup" aria-label="Comparison operator">
            ${['>', '>=', '<', '<='].map(op =>
              `<button type="button" class="sa-op-btn ${op===r.op?'on':''}" data-op="${op}" onclick="SP.Alerts._pickOp('${op}')">${op}</button>`
            ).join('')}
          </div>
          <div class="sa-thresh-row">
            <div class="sa-thresh-input-wrap">
              <input type="number" step="any" id="sa-f-threshold" value="${esc(r.threshold)}" oninput="SP.Alerts._updatePreview(); SP.Alerts._updatePreviewDebounced()">
              <span class="sa-thresh-unit" id="sa-thresh-unit">—</span>
            </div>
            <div class="sa-preset-chips" id="sa-preset-chips"></div>
          </div>
          <div class="hint" id="sa-f-threshold-hint"></div>
          <input type="hidden" id="sa-f-op" value="${esc(r.op)}">
        </div>

        <div class="sa-sect" id="sa-uri-sect" style="display:none">
          <div class="sa-sect-title">
            <span class="step" style="background:color-mix(in srgb,var(--brand,#f26419) 15%,transparent);color:var(--brand,#f26419)">•</span>
            <span class="lbl">Per-endpoint scope <span style="font-weight:400;color:var(--sp-text-soft);font-size:11px">(optional)</span></span>
          </div>
          <div class="sa-field">
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:none;letter-spacing:0">
              URI pattern (regex) — จำกัด rule ให้ตรวจเฉพาะบาง endpoint. เว้นว่าง = ทั้ง workload
            </label>
            <input type="text" id="sa-f-uri-pattern" value="${esc(r.uriPattern || '')}" placeholder='เช่น  /api/withdraw  หรือ  /api/v[12]/.*'
                   style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px">
            <div class="hint" style="font-size:11px;color:var(--sp-text-soft);margin-top:4px;line-height:1.5">
              💡 ตัวอย่าง: <code>/api/withdraw</code> = URI ตรงตัว · <code>/api/v[12]/.*</code> = v1 หรือ v2 ทั้งหมด · <code>/api/(withdraw|deposit)</code> = 2 endpoint<br>
              รองรับเฉพาะ metric: <b>error_rate · latency · latency_max · latency_p95 · txn_rate</b>
            </div>
          </div>
        </div>

        <div class="sa-sect">
          <div class="sa-sect-title">
            <span class="step">3</span>
            <span class="lbl">Timing — รอกี่วินาที + ยิงซ้ำหรือไม่</span>
          </div>
          <div class="sa-field">
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:none;letter-spacing:0">
              Duration — ต้อง breach ต่อเนื่องอย่างน้อยเท่านี้จึงยิง (กัน false positive)
            </label>
            <div class="sa-chip-picker" id="sa-dur-picker">
              ${[[30,'30 sec'],[60,'1 min'],[120,'2 min'],[300,'5 min'],[600,'10 min']].map(([v,lbl]) =>
                `<button type="button" class="sa-chip ${r.durationSec==v?'on':''}" data-dur="${v}" onclick="SP.Alerts._pickDur(${v})">${lbl}</button>`
              ).join('')}
            </div>
            <input type="hidden" id="sa-f-dur" value="${r.durationSec}">
          </div>
          <div class="sa-field">
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:none;letter-spacing:0">
              Repeat — ยิงซ้ำทุก ... ระหว่างที่ยัง firing (Once = ยิง 1 ครั้ง ไม่ spam)
            </label>
            <div class="sa-chip-picker" id="sa-repeat-picker">
              ${[[0,'Once only'],[300,'Every 5m'],[900,'Every 15m'],[1800,'Every 30m'],[3600,'Every 1h'],[14400,'Every 4h']].map(([v,lbl]) =>
                `<button type="button" class="sa-chip ${(+r.repeatIntervalSec||0)===v?'on':''}" data-repeat="${v}" onclick="SP.Alerts._pickRepeat(${v})">${lbl}</button>`
              ).join('')}
            </div>
            <input type="hidden" id="sa-f-repeat" value="${r.repeatIntervalSec||0}">
          </div>
        </div>

        <div class="sa-sect">
          <div class="sa-sect-title">
            <span class="step">4</span>
            <span class="lbl">แจ้งเตือนไปที่ไหน</span>
          </div>
          <div class="sa-field">
            <label>Google Chat channel</label>
            <select id="sa-f-channel" onchange="SP.Alerts._updatePreview()">
              ${channelNames.map(n => {
                const ch = this.channels[n] || {};
                const noteBit = ch.note ? ' — ' + esc(ch.note) : '';
                const warnBit = ch.webhook_url ? '' : ' · ⚠ no webhook set';
                return `<option value="${esc(n)}" ${n===r.channel?'selected':''}>${esc(n)}${noteBit}${warnBit}</option>`;
              }).join('')}
            </select>
            <div class="hint">คลิก ⚙ ที่หัว drawer เพื่อเพิ่ม/แก้ webhook URL</div>
          </div>
          <div class="sa-field">
            <label>Note (optional — แสดงใน Chat card ตอน fire)</label>
            <input type="text" id="sa-f-note" value="${esc(r.note||'')}" placeholder="เช่น: escalate to L2 on fire · owner ทีม payment">
          </div>
          <label style="display:flex;gap:10px;align-items:center;font-size:13px;color:var(--text);padding:6px 0;cursor:pointer">
            <input type="checkbox" id="sa-f-enabled" ${r.enabled!==false?'checked':''} onchange="SP.Alerts._updatePreview()" style="width:16px;height:16px;cursor:pointer">
            <span><b>Enabled</b> — uncheck to save as draft (won't be evaluated)</span>
          </label>
        </div>

        <div class="sa-preview" id="sa-preview">
          <div class="hd">Preview — สรุปว่าจะเกิดอะไรขึ้น</div>
          <div id="sa-preview-body">เลือก metric ด้านบนก่อน</div>
        </div>
      `;
      $('sa-modal').classList.add('on');
      this._metricChanged();
      // Service-picker: preload the entire inventory into the datalist so
      // browsing works with zero typing (browser filters on input). Cache
      // between opens so re-opening the drawer doesn't re-fetch.
      const svcInput = $('sa-f-service');
      if (svcInput) {
        // When user picks a service (input change), refresh live preview so
        // the chart on the right pulls data for the new service. `change`
        // fires when a datalist option is selected or the input is blurred.
        svcInput.addEventListener('change', () => {
          this._detailCache = null;       // force refetch for new service
          this._updatePreview();
          this._updatePreviewDebounced();
        });
        const paintList = (items) => {
          const list = $('sa-f-service-list');
          list.innerHTML = items.map(s => {
            const name = s.service || s.name || s;
            const label = s.bu || s.team ? ` — ${s.bu || ''}${s.team ? ' · ' + s.team : ''}` : '';
            return `<option value="${esc(name)}">${esc(name + label)}</option>`;
          }).join('');
          const hint = $('sa-f-service-hint');
          if (hint) hint.textContent = `${items.length} services · click ช่อง input เพื่อดูรายการเต็ม, พิมพ์เพื่อ filter`;
        };
        if (Alerts._svcListCache) {
          paintList(Alerts._svcListCache);
        } else {
          try {
            // Empty query + big limit returns the first N services
            // alphabetically (suggestions.php default when q='').
            const r = await API.servicePerformance.suggest('', 500);
            const items = r?.data?.data?.suggestions || [];
            Alerts._svcListCache = items;
            paintList(items);
          } catch {
            $('sa-f-service-hint').textContent = 'Failed to load service list — พิมพ์ชื่อเต็มเอง';
          }
        }
      }
    },
    closeForm() {
      $('sa-modal').classList.remove('on');
      this.editing = null;
      this._mode   = null;
    },

    // ── Card-grid picker handlers (redesigned form) ────────────────────
    // Each picker updates the visual "on" class on its card + hidden input
    // for save() + calls _updatePreview() so the live "will fire when…"
    // line stays in sync.
    _pickMetric(key) {
      // Toggle .on class on the cards.
      document.querySelectorAll('.sa-metric-card').forEach(c =>
        c.classList.toggle('on', c.dataset.metric === key));
      const card = document.querySelector(`.sa-metric-card[data-metric="${key}"]`);
      if (!card) return;
      const unit = card.dataset.unit || '';
      const cmp  = card.dataset.cmp  || 'abs';
      const desc = card.dataset.desc || '';
      const agg  = card.dataset.agg  || '';
      const suggested = card.dataset.suggested || '';
      // Update the metric detail card — richer than before, uses innerHTML
      // so <code> tags in `description` render as monospace.
      const unitLbl = cmp === 'pct'
        ? '<b>% ของ limit</b> — ค่า threshold = 0-100 (percent)'
        : { ms: '<b>milliseconds</b> (ms)', pct: '<b>percent</b> (%)', reqs: '<b>count</b> (req/s หรือจำนวน)', bytes: '<b>bytes</b>', cores: '<b>CPU cores</b>' }[unit] || '<b>raw value</b>';
      $('sa-metric-detail').innerHTML = `
        <div>${desc}</div>
        <div class="kv">
          <span><b>Aggregation:</b> ${esc(agg || '—')}</span>
          <span>📏 <b>Unit:</b> ${unitLbl}</span>
        </div>`;
      // Threshold unit suffix inside the input wrapper.
      $('sa-thresh-unit').textContent = cmp === 'pct' ? '%' :
        { ms: 'ms', pct: '%', reqs: 'req/s', bytes: 'bytes', cores: 'cores' }[unit] || '';
      // Per-endpoint URI input — only meaningful for HTTP server-side metrics
      // whose PromQL groups by uri. Backend catalog flags these with supportsUri.
      const uriSect = document.getElementById('sa-uri-sect');
      if (uriSect) uriSect.style.display = card.dataset.supportsUri === '1' ? '' : 'none';
      $('sa-f-threshold-hint').textContent = cmp === 'pct'
        ? 'ค่าเป็น percent — เช่น 80 = 80% ของ limit'
        : `หน่วย: ${unitLbl.replace(/<[^>]+>/g, '')}`;
      // Preset chips (1-click quick thresholds) from module-level PRESETS map.
      const presets = (this._presets && this._presets[key]) || [];
      const cur = parseFloat($('sa-f-threshold').value);
      $('sa-preset-chips').innerHTML = presets.map(v =>
        `<button type="button" class="sa-preset-chip ${cur===v?'on':''}" data-val="${v}" onclick="SP.Alerts._pickPreset(${v})">${v}${cmp === 'pct' ? '%' : (unit==='ms' && v>=1000 ? '  ('+(v/1000)+'s)' : '')}</button>`
      ).join('');
      // Auto-fill suggested threshold on metric SWITCH (not on initial open —
      // Edit should preserve the rule's saved value).
      if (suggested && this._metricInitialized) {
        $('sa-f-threshold').value = suggested;
        // Repaint preset chips to highlight the new value.
        $('sa-preset-chips').querySelectorAll('.sa-preset-chip').forEach(c =>
          c.classList.toggle('on', +c.dataset.val === +suggested));
      }
      this._metricInitialized = true;
      this._updatePreview();
      this._updatePreviewDebounced();
    },

    _pickOp(op) {
      document.querySelectorAll('.sa-op-btn').forEach(b =>
        b.classList.toggle('on', b.dataset.op === op));
      $('sa-f-op').value = op;
      this._updatePreview();
      this._updatePreviewDebounced();
    },
    _pickDur(sec) {
      document.querySelectorAll('#sa-dur-picker .sa-chip').forEach(c =>
        c.classList.toggle('on', +c.dataset.dur === sec));
      $('sa-f-dur').value = sec;
      this._updatePreview();
    },
    _pickRepeat(sec) {
      document.querySelectorAll('#sa-repeat-picker .sa-chip').forEach(c =>
        c.classList.toggle('on', +c.dataset.repeat === sec));
      $('sa-f-repeat').value = sec;
      this._updatePreview();
    },
    _pickPreset(v) {
      $('sa-f-threshold').value = v;
      document.querySelectorAll('.sa-preset-chip').forEach(c =>
        c.classList.toggle('on', +c.dataset.val === +v));
      this._updatePreview();
      this._updatePreviewDebounced();
    },

    // Live-updating preview strip — natural-language summary of the rule.
    // Fires on every picker/input change so users see the effect of a
    // choice before clicking Save.
    _updatePreview() {
      const body = $('sa-preview-body');
      if (!body) return;
      const metricCard = document.querySelector('.sa-metric-card.on');
      if (!metricCard) { body.innerHTML = 'เลือก metric ด้านบนก่อน'; return; }
      const metricLabel = metricCard.querySelector('.name')?.textContent || '?';
      const cmp = metricCard.dataset.cmp || 'abs';
      const unit = metricCard.dataset.unit || '';
      const unitTxt = cmp === 'pct' ? '%' : { ms: 'ms', pct: '%', reqs: 'req/s', bytes: 'bytes', cores: 'cores' }[unit] || '';
      const op = $('sa-f-op').value;
      const t  = $('sa-f-threshold').value;
      const dur = +$('sa-f-dur').value;
      const rep = +$('sa-f-repeat').value;
      const ch  = $('sa-f-channel').value;
      const enabled = $('sa-f-enabled').checked;
      const svc = this.editing?.service || $('sa-f-service')?.value.trim() || this.service || '<em>(pick service)</em>';
      const fmtSec = (s) => s >= 3600 ? Math.round(s/3600)+'h' : s >= 60 ? Math.round(s/60)+'m' : s+'s';
      const repLine = rep > 0
        ? `<br>ยิงซ้ำทุก <b>${fmtSec(rep)}</b> ระหว่างที่ยังไม่คลาย`
        : `<br>ยิง <b>1 ครั้ง</b> ต่อ outage (ไม่ spam)`;
      const enabledLine = enabled ? '' : '<br><span style="color:var(--warn)">⚠ Draft mode — จะไม่ถูก evaluate จนกว่าจะเปิด Enabled</span>';
      body.innerHTML = `
        เมื่อ <b>${esc(svc)}</b> มี <b>${esc(metricLabel)}</b>
        <b>${esc(op)} ${esc(t)}${esc(unitTxt)}</b> ต่อเนื่อง <b>${fmtSec(dur)}</b>
        → ยิง Google Chat ที่ channel <b>${esc(ch)}</b>
        ${repLine}
        ${enabledLine}`;
    },

    // Compat: old `_metricChanged` was called on the old <select> onchange.
    // Redirect to the new picker path so any stale handler still works.
    _metricChanged() {
      const card = document.querySelector('.sa-metric-card.on');
      if (card) this._pickMetric(card.dataset.metric);
    },

    _previewWindowMin: 60,

    _toggleExpand() {
      const card = document.querySelector('.sa-modal-card');
      if (!card) return;
      const on = card.classList.toggle('sa-expanded');
      const icon = $('sa-expand-icon');
      if (icon) { icon.dataset.icon = on ? 'minimize-2' : 'maximize-2'; if (window.Icons?.replace) window.Icons.replace(icon); }
    },

    _onPreviewRangeChange(val) {
      this._previewWindowMin = parseInt(val, 10) || 60;
      this._detailCache      = null;
      this._previewByPodCache = null;
      this._updateChartPreview();
    },

    // ── Live preview panel (right side of New Alert modal) ──────────────
    // For byPod metrics: calls api/alerts/preview.php which runs per-pod
    // PromQL range queries → renders one line per pod + legend.
    // For scalar metrics: uses api/alerts/preview.php when range ≠ 60m,
    // otherwise reuses detail.php cache so switching metrics is instant.
    //
    // Debounced to 250ms so rapid typing doesn't spam requests.
    _updatePreviewDebounced() {
      clearTimeout(this._previewT);
      this._previewT = setTimeout(() => this._updateChartPreview(), 250);
    },

    async _updateChartPreview() {
      const panel = $('sa-preview-content');
      if (!panel) return;
      const card = document.querySelector('.sa-metric-card.on');
      if (!card) return;
      const key    = card.dataset.metric;
      const unit   = card.dataset.unit  || '';
      const cmp    = card.dataset.cmp   || 'abs';
      const byPod  = card.dataset.bypod === '1';
      const svc    = this.editing?.service || $('sa-f-service')?.value.trim() || this.service;
      const winMin = this._previewWindowMin || 60;
      const cluster = SP.currentCluster || '';

      if (!svc) {
        panel.innerHTML = `<div class="sa-preview-chart"><div class="empty">เลือก service ก่อน</div></div>`;
        return;
      }

      // Cache key includes window so range changes trigger a fresh fetch.
      const cacheKey = svc + '|' + key + '|' + winMin;
      if (this._previewCache?.key !== cacheKey) {
        panel.innerHTML = `
          <div class="sa-preview-current">
            <div class="lbl">Current value</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
              <span class="da-spinner"></span>
              <span class="da-skel" style="height:22px;width:80px"></span>
            </div>
            <div class="da-skel" style="height:10px;width:160px;margin-top:8px"></div>
          </div>
          <div class="da-chart-skel" style="padding:14px 16px">
            <div class="da-skel" style="height:11px;width:35%;margin-bottom:12px"></div>
            <div class="da-skel" style="height:${byPod ? 180 : 140}px"></div>
          </div>
          <div class="sa-preview-stats">
            <div class="stat"><div class="lbl">avg</div><div class="da-skel" style="height:14px;width:60%;margin-top:4px"></div></div>
            <div class="stat"><div class="lbl">max</div><div class="da-skel" style="height:14px;width:60%;margin-top:4px"></div></div>
            <div class="stat"><div class="lbl">min</div><div class="da-skel" style="height:14px;width:60%;margin-top:4px"></div></div>
          </div>`;
      } else {
        panel.style.opacity = '0.75';
        panel.style.transition = 'opacity .15s';
      }

      const fmtV = (v) => {
        if (v == null) return '—';
        if (unit === 'ms')              return v >= 1000 ? (v/1000).toFixed(2)+'s' : v.toFixed(0)+'ms';
        if (unit === 'pct' || cmp === 'pct') return v.toFixed(1)+'%';
        if (unit === 'bytes')           return v >= 1e9 ? (v/1e9).toFixed(2)+'GB' : (v/1e6).toFixed(0)+'MB';
        if (unit === 'cores')           return v >= 1 ? v.toFixed(2) : (v*1000).toFixed(0)+'m';
        return v >= 100 ? v.toFixed(0) : v.toFixed(2);
      };
      const winLabel = winMin >= 1440 ? '24h' : winMin >= 360 ? '6h' : winMin >= 180 ? '3h' : winMin >= 60 ? '1h' : winMin+'m';

      // ── byPod path: call preview.php → render per-pod multi-line chart ─
      if (byPod) {
        let previewData;
        try {
          const qs = `service=${encodeURIComponent(svc)}&metric=${encodeURIComponent(key)}&windowMin=${winMin}&cluster=${encodeURIComponent(cluster)}`;
          const res = await API.get('/alerts/preview.php?' + qs);
          if (!res?.ok) throw new Error(res?.data?.message || 'preview load failed');
          previewData = res.data?.data;
        } catch (e) {
          panel.innerHTML = `<div class="sa-preview-chart"><div class="empty" style="color:var(--hot)">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</div></div>`;
          panel.style.opacity = '';
          return;
        }

        const pods = previewData?.pods || {};
        const podNames = Object.keys(pods);
        const threshold = parseFloat($('sa-f-threshold').value);
        const op = $('sa-f-op').value;
        const check = (v) => {
          if (v == null || !Number.isFinite(threshold)) return false;
          switch(op) { case '>': return v>threshold; case '>=': return v>=threshold; case '<': return v<threshold; case '<=': return v<=threshold; }
          return false;
        };

        // Pod color palette (distinct, accessible)
        const POD_COLORS = ['#f26419','#3b82f6','#10b981','#a855f7','#f59e0b','#ec4899','#06b6d4','#84cc16','#ef4444','#8b5cf6'];

        // Current value = worst pod
        const worstCurrent = podNames.length
          ? Math.max(...podNames.map(p => pods[p].current ?? 0))
          : null;
        const violatingNow = check(worstCurrent);

        // Current value card
        const currentCard = `
          <div class="sa-preview-current">
            <div class="lbl">Worst pod — current value</div>
            <div class="val ${violatingNow ? 'will-fire' : (worstCurrent != null ? 'ok' : '')}">${fmtV(worstCurrent)}</div>
            <div class="cmp">${violatingNow
              ? `<b style="color:var(--hot)">⚠ Would fire</b> — ${fmtV(worstCurrent)} ${esc(op)} ${fmtV(threshold)}`
              : (worstCurrent != null && Number.isFinite(threshold)
                  ? `<span style="color:var(--ok)">✓ Not breaching</span> — ${fmtV(worstCurrent)} not ${esc(op)} ${fmtV(threshold)}`
                  : 'Set threshold to see comparison')}
            </div>
          </div>`;

        // Multi-line SVG chart
        const W = 340, H = 180, PL = 44, PR = 10, PT = 12, PB = 22;
        let chartHtml = '';
        if (podNames.length) {
          // Gather all values across all pods for axis range
          let allYs = [];
          podNames.forEach(p => { (pods[p].series || []).forEach(pt => { if (Number.isFinite(pt[1])) allYs.push(pt[1]); }); });
          if (Number.isFinite(threshold)) { allYs.push(threshold); }
          let yMax = allYs.length ? Math.max(...allYs) : 100;
          let yMin = allYs.length ? Math.min(...allYs) : 0;
          const yPad = (yMax - yMin) * 0.1 || 1;
          yMin = Math.max(0, yMin - yPad); yMax = yMax + yPad;

          // X range from first pod with data
          const allXs = []; podNames.forEach(p => (pods[p].series||[]).forEach(pt => allXs.push(pt[0])));
          const xMin = allXs.length ? Math.min(...allXs) : 0;
          const xMax = allXs.length ? Math.max(...allXs) : 1;

          const sx = (x) => PL + ((x-xMin)/(xMax-xMin||1))*(W-PL-PR);
          const sy = (y) => H - PB - ((y-yMin)/(yMax-yMin||1))*(H-PT-PB);

          // Y grid ticks
          let yTicks = '';
          for (let i=0; i<=2; i++) {
            const yv = yMin + (yMax-yMin)*(i/2);
            const yy = sy(yv);
            yTicks += `<line x1="${PL}" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
            yTicks += `<text x="${PL-4}" y="${yy}" font-size="9" fill="var(--sp-text-soft)" text-anchor="end" dominant-baseline="middle">${fmtV(yv)}</text>`;
          }

          // One polyline per pod
          let polylines = '';
          podNames.forEach((p, i) => {
            const color = POD_COLORS[i % POD_COLORS.length];
            const pts = (pods[p].series || []).filter(pt => Number.isFinite(pt[1]));
            if (pts.length < 2) return;
            const d = pts.map((pt, j) => (j?'L':'M')+sx(pt[0]).toFixed(1)+','+sy(pt[1]).toFixed(1)).join(' ');
            polylines += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" opacity="${check(pods[p].current) ? '1' : '0.6'}"/>`;
          });

          // Threshold line
          let threshLine = '';
          if (Number.isFinite(threshold) && threshold >= yMin && threshold <= yMax) {
            const ty = sy(threshold);
            const labelTxt = `threshold ${fmtV(threshold)}`;
            const labelW = labelTxt.length * 5.4 + 12;
            const flipBelow = ty - PT < 20;
            const pillY = flipBelow ? ty+3 : ty-15;
            const textY = flipBelow ? ty+13 : ty-5;
            threshLine = `
              <line x1="${PL}" x2="${W-PR}" y1="${ty}" y2="${ty}" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 4"/>
              <rect x="${(W-PR-labelW).toFixed(1)}" y="${pillY.toFixed(1)}" width="${labelW}" height="14" fill="#dc2626" rx="3"/>
              <text x="${W-PR-6}" y="${textY.toFixed(1)}" font-size="10" font-weight="700" fill="#fff" text-anchor="end">${labelTxt}</text>`;
          }

          const totalSamples = podNames.length && pods[podNames[0]]?.series?.length || 0;
          chartHtml = `
            <div class="sa-preview-chart">
              <div class="chart-lbl">Last ${winLabel} · ${totalSamples} samples/pod · ${podNames.length} pods</div>
              <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
                ${yTicks}${polylines}${threshLine}
              </svg>
            </div>`;
        } else {
          chartHtml = `<div class="sa-preview-chart"><div class="empty">ไม่พบ pod สำหรับ service นี้</div></div>`;
        }

        // Pod legend with per-pod current value
        let legendHtml = '';
        if (podNames.length) {
          const rows = podNames.map((p, i) => {
            const color  = POD_COLORS[i % POD_COLORS.length];
            const curVal = pods[p].current;
            const breach = check(curVal);
            const shortName = p.replace(/^.*-([a-z0-9]+-[a-z0-9]+)$/, '…-$1');
            return `<div class="sa-pod-legend-row">
              <span class="sa-pod-legend-dot" style="background:${color}"></span>
              <span class="sa-pod-legend-name" title="${esc(p)}">${esc(shortName)}</span>
              <span class="sa-pod-legend-val ${breach ? 'sa-pod-legend-breach' : ''}">${fmtV(curVal)}</span>
            </div>`;
          }).join('');
          legendHtml = `<div class="sa-pod-legend">${rows}</div>`;
        }

        // Violation count across all pods
        let hitsCard = '';
        if (podNames.length && Number.isFinite(threshold)) {
          const breachingPods = podNames.filter(p => check(pods[p].current));
          if (breachingPods.length) {
            hitsCard = `<div class="sa-preview-hits">
              <b>${breachingPods.length} / ${podNames.length} pods</b> กำลังเกิน threshold ตอนนี้
            </div>`;
          } else {
            hitsCard = `<div class="sa-preview-hits" style="background:color-mix(in srgb,var(--ok) 6%,var(--bg-card));border-color:color-mix(in srgb,var(--ok) 25%,transparent)">
              <b style="color:var(--ok)">✓ ทุก pod ไม่เกิน threshold</b> ตอนนี้ (${podNames.length} pods)
            </div>`;
          }
        }

        panel.innerHTML = currentCard + chartHtml + legendHtml + hitsCard;
        panel.style.opacity = '';
        this._previewCache = { key: cacheKey };
        if (window.Icons?.replaceAll) window.Icons.replaceAll(panel);
        return;
      }

      // ── Scalar path ─────────────────────────────────────────────────────
      let d;
      try {
        if (this._detailCache?.svc === svc && (Date.now() - this._detailCache.ts) < 30000) {
          d = this._detailCache.data;
        } else {
          const res = await API.servicePerformance.detail(svc, '', { windowMin: winMin });
          if (!res?.ok) throw new Error(res?.data?.message || 'load failed');
          d = res.data?.data;
          this._detailCache = { svc, ts: Date.now(), data: d };
        }
      } catch (e) {
        panel.innerHTML = `<div class="sa-preview-chart"><div class="empty" style="color:var(--hot)">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</div></div>`;
        panel.style.opacity = '';
        return;
      }

      const seriesMap = d?.series || {};
      const s   = d?.summary || {};
      const app = d?.app     || {};
      const jvm = d?.jvm     || {};
      let series = null, currentValue = null, limitValue = null;
      const asPct = (v, lim) => (lim && v != null) ? (v / lim) * 100 : v;
      switch (key) {
        case 'cpu':
          currentValue = asPct(s.cpuCores, s.cpuLimit); limitValue = s.cpuLimit;
          series = (seriesMap.cpu || []).map(p => [p[0], asPct(p[1], s.cpuLimit)]); break;
        case 'mem':
          currentValue = asPct(s.memBytes, s.memLimit); limitValue = s.memLimit;
          series = (seriesMap.mem || []).map(p => [p[0], asPct(p[1], s.memLimit)]); break;
        case 'mem_pod_max':
          currentValue = asPct(s.memBytes, s.memLimit); limitValue = s.memLimit;
          series = (seriesMap.mem || []).map(p => [p[0], asPct(p[1], s.memLimit)]); break;
        case 'oom_killed':
          currentValue = (s.restarts != null && s.restarts > 0) ? 1 : 0; break;
        case 'latency':
          currentValue = app.procTimeMs; series = seriesMap.procMs || []; break;
        case 'latency_max':
          currentValue = (seriesMap.procMsMax || []).slice(-1)[0]?.[1];
          series = seriesMap.procMsMax || []; break;
        case 'txn_rate':
          currentValue = app.txnRate; series = seriesMap.txnRate || []; break;
        case 'heap_pct':
          currentValue = jvm?.pct; break;
        case 'cpu_throttled':
          currentValue = s.cpuThrottledPct; series = seriesMap.cpuThrottledPct || []; break;
        case 'cb_open':
          currentValue = app.circuitBreakers?.open; break;
        case 'hpa_max':
          currentValue = (d?.hpa?.current != null && d?.hpa?.max)
            ? (d.hpa.current / d.hpa.max) * 100 : null; break;
        case 'latency_p95':
          if (app.endpoints?.length) {
            const p95s = app.endpoints.map(e => e.latencyP95Ms).filter(v => v != null);
            if (p95s.length) currentValue = Math.max(...p95s);
          }
          break;
        default: break;
      }

      // Subsystems-only metrics
      const SUBSYS_MAP = {
        http_pool_pending: { section: 'httppool', get: (sec) => ({ currentValue: sec.kpis?.pending, series: sec.series?.pending || [] })},
        http_pool_util: { section: 'httppool', get: (sec) => {
          const cap = sec.kpis?.max || 0;
          return { currentValue: sec.kpis?.utilPct, series: (sec.series?.leased || []).map(p => [p[0], cap > 0 ? (p[1]/cap)*100 : p[1]]) };
        }},
        dbpool_pending: { section: 'hikari',  get: (sec) => ({ currentValue: sec.kpis?.pending, series: sec.series?.pending || [] })},
        dbpool_active:  { section: 'hikari',  get: (sec) => {
          const m = sec.kpis?.max || 0;
          return { currentValue: m > 0 ? (sec.kpis.active/m)*100 : sec.kpis?.active, series: (sec.series?.active || []).map(p => [p[0], m > 0 ? (p[1]/m)*100 : p[1]]) };
        }},
        thread_blocked: { section: 'jvm', get: (sec) => ({ currentValue: sec.threads?.byState?.blocked ?? 0, series: sec.series?.threadsByState?.blocked || [] })},
        tomcat_busy: { section: 'tomcat', get: (sec) => {
          const maxT = sec.kpis?.maxThreads || 0;
          return { currentValue: maxT > 0 ? (sec.kpis.busy/maxT)*100 : sec.kpis?.busy, series: (sec.series?.busy || []).map(p => [p[0], maxT > 0 ? (p[1]/maxT)*100 : p[1]]) };
        }},
        fd_pct:   { section: 'jvm', get: (sec) => {
          const maxF = sec.files?.max || 0;
          return { currentValue: maxF > 0 ? (sec.files.open/maxF)*100 : sec.files?.open, series: (sec.series?.filesOpen || []).map(p => [p[0], maxF > 0 ? (p[1]/maxF)*100 : p[1]]) };
        }},
        gc_freq:  { section: 'jvm', get: (sec) => ({ currentValue: sec.gc?.countPerSec, series: sec.series?.gcPauseRate || [] })},
        gc_pause: { section: 'jvm', get: (sec) => ({ currentValue: sec.gc?.pauseMaxMs, series: sec.series?.gcPauseMaxMs || [] })},
      };
      const subMap = SUBSYS_MAP[key];
      if (subMap && d?.runway?.slug && d?.runway?.jvmDsUid) {
        this._previewSubCache = this._previewSubCache || {};
        const subCacheKey = svc + '|' + subMap.section + '|' + winMin;
        const cached = this._previewSubCache[subCacheKey];
        const fresh  = cached && (Date.now() - cached.ts) < 60_000;
        let sec = fresh ? cached.data : null;
        if (!sec) {
          try {
            const res2 = await API.servicePerformance.subsystems(svc, d.runway.slug, subMap.section, { windowMin: winMin, cluster: cluster });
            sec = res2?.data?.data?.sections?.[subMap.section];
            if (sec && !sec.error) this._previewSubCache[subCacheKey] = { ts: Date.now(), data: sec };
          } catch (_) {}
        }
        if (sec && !sec.error) {
          const ex = subMap.get(sec);
          if (ex.currentValue != null) currentValue = ex.currentValue;
          if (ex.series?.length)      series       = ex.series;
        }
      }

      const threshold = parseFloat($('sa-f-threshold').value);
      const op = $('sa-f-op').value;
      const check = (v) => {
        if (v == null || !Number.isFinite(threshold)) return false;
        switch(op) { case '>': return v>threshold; case '>=': return v>=threshold; case '<': return v<threshold; case '<=': return v<=threshold; }
        return false;
      };
      const violations   = series ? series.filter(p => check(p[1])).length : 0;
      const totalPts     = series?.length || 0;
      const violatingNow = check(currentValue);
      const metaSrc  = (this.metrics[key] || {}).source  || '';
      const metaPod2 = !!(this.metrics[key] || {}).byPod;
      const noDataMsg = metaPod2
        ? 'Preview แสดงค่า <b>avg ทั้ง workload</b> เพื่อดู trend<br>Alert จริงประเมิน <b>ทีละ pod</b> ใน tick cycle'
        : (metaSrc === 'kube'
            ? 'ไม่มีข้อมูล series สำหรับ metric นี้<br>(kube metric — alert ยังทำงานได้ปกติ)'
            : 'ไม่มี metric นี้สำหรับ service นี้<br>(อาจเป็น non-JVM / ไม่ได้ export)');

      const ys = (series || []).map(p => p[1]).filter(v => Number.isFinite(v));

      const currentCard = `
        <div class="sa-preview-current">
          <div class="lbl">Current value</div>
          <div class="val ${violatingNow ? 'will-fire' : (currentValue != null ? 'ok' : '')}">${fmtV(currentValue)}</div>
          <div class="cmp">${violatingNow
            ? `<b style="color:var(--hot)">⚠ Would fire</b> — ${fmtV(currentValue)} ${esc(op)} ${fmtV(threshold)}`
            : (currentValue != null && Number.isFinite(threshold)
                ? `<span style="color:var(--ok)">✓ Not breaching</span> — ${fmtV(currentValue)} not ${esc(op)} ${fmtV(threshold)}`
                : 'Set threshold to see comparison')}
          </div>
        </div>`;

      let chartHtml = '';
      if (series && series.length >= 2) {
        const W = 340, H = 160, PL = 44, PR = 10, PT = 12, PB = 22;
        const xs = series.map(p => p[0]);
        const xMin = xs[0], xMax = xs[xs.length-1];
        let yMax = Math.max(...ys), yMin = Math.min(...ys);
        if (Number.isFinite(threshold)) { if (threshold>yMax) yMax=threshold; if (threshold<yMin) yMin=threshold; }
        const yPad = (yMax-yMin)*0.1||1; yMin=Math.max(0,yMin-yPad); yMax=yMax+yPad;
        const sx = (x) => PL+((x-xMin)/(xMax-xMin||1))*(W-PL-PR);
        const sy = (y) => H-PB-((y-yMin)/(yMax-yMin||1))*(H-PT-PB);
        const path = series.map((p,i)=>(i?'L':'M')+sx(p[0]).toFixed(1)+','+sy(p[1]).toFixed(1)).join(' ');
        const area = path+` L${sx(xMax).toFixed(1)},${(H-PB).toFixed(1)} L${sx(xMin).toFixed(1)},${(H-PB).toFixed(1)} Z`;
        let yTicks = '';
        for (let i=0; i<=2; i++) {
          const yv = yMin+(yMax-yMin)*(i/2);
          const yy = sy(yv);
          yTicks += `<line x1="${PL}" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
          yTicks += `<text x="${PL-4}" y="${yy}" font-size="9" fill="var(--sp-text-soft)" text-anchor="end" dominant-baseline="middle">${fmtV(yv)}</text>`;
        }
        let threshLine = '';
        if (Number.isFinite(threshold) && threshold>=yMin && threshold<=yMax) {
          const ty = sy(threshold);
          const labelTxt = `⚠ threshold ${fmtV(threshold)}`;
          const labelW   = labelTxt.length*5.6+12;
          const flipBelow = ty-PT < 20;
          const pillY = flipBelow ? ty+3 : ty-15;
          const textY = flipBelow ? ty+13 : ty-5;
          threshLine = `
            <line x1="${PL}" x2="${W-PR}" y1="${ty}" y2="${ty}" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 4" stroke-opacity="1"/>
            <rect x="${(W-PR-labelW).toFixed(1)}" y="${pillY.toFixed(1)}" width="${labelW}" height="14" fill="#dc2626" rx="3"/>
            <text x="${W-PR-6}" y="${textY.toFixed(1)}" font-size="10" font-weight="700" fill="#ffffff" text-anchor="end">${labelTxt}</text>`;
        }
        chartHtml = `
          <div class="sa-preview-chart">
            <div class="chart-lbl">Last ${winLabel} · ${totalPts} samples</div>
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
              ${yTicks}
              <path d="${area}" fill="var(--brand,#f26419)" fill-opacity=".12"/>
              <path d="${path}" fill="none" stroke="var(--brand,#f26419)" stroke-width="1.75" stroke-linejoin="round"/>
              ${threshLine}
            </svg>
          </div>`;
      } else {
        const hasNow = currentValue != null;
        chartHtml = `<div class="sa-preview-chart"><div class="empty">${hasNow
          ? 'Metric นี้อ่าน <b>snapshot ปัจจุบัน</b> เท่านั้น (subsystem-only)<br>ดูค่าล่าสุด + เทียบ threshold ด้านล่าง'
          : noDataMsg
        }</div></div>`;
      }

      let statsCard = '';
      if (ys && ys.length) {
        const avg = ys.reduce((a,b)=>a+b,0)/ys.length;
        const mx  = Math.max(...ys), mn = Math.min(...ys);
        statsCard = `
          <div class="sa-preview-stats">
            <div class="stat"><div class="lbl">${winLabel} avg</div><div class="val">${fmtV(avg)}</div></div>
            <div class="stat"><div class="lbl">${winLabel} max</div><div class="val" style="color:${mx>threshold?'var(--hot)':'var(--text)'}">${fmtV(mx)}</div></div>
            <div class="stat"><div class="lbl">${winLabel} min</div><div class="val">${fmtV(mn)}</div></div>
          </div>`;
      }

      let hitsCard = '';
      if (totalPts > 0 && Number.isFinite(threshold)) {
        const pct = (violations/totalPts*100).toFixed(0);
        if (violations > 0) {
          hitsCard = `<div class="sa-preview-hits">
            <b>${violations} / ${totalPts}</b> samples would fire (~${pct}% of ${winLabel}) with this threshold
            ${violations===totalPts ? '<br>⚠ Threshold too low — always firing' : ''}
            ${(violations/totalPts)>0.3 ? '<br>⚠ Very noisy — consider raising threshold or increasing duration' : ''}
          </div>`;
        } else {
          hitsCard = `<div class="sa-preview-hits" style="background:color-mix(in srgb,var(--ok) 6%,var(--bg-card));border-color:color-mix(in srgb,var(--ok) 25%,transparent)">
            <b style="color:var(--ok)">✓ Quiet threshold</b> — no samples in the last ${winLabel} would fire this rule
          </div>`;
        }
      }

      panel.innerHTML = currentCard + chartHtml + statsCard + hitsCard;
      panel.style.opacity = '';
      this._previewCache = { key: cacheKey };
      if (window.Icons?.replaceAll) window.Icons.replaceAll(panel);
    },

    // Send a test notification from within the New Alert modal — before
    // saving. Builds a temp rule object and hits test.php via a new endpoint
    // that accepts inline rule (not just rule id).
    async _testFromForm() {
      // For now: require Save first (test.php needs a rule id in storage).
      // Show hint pointing to the Test button in the drawer list.
      this._flashModal('Save rule ก่อน แล้วคลิก "Test" ในรายการเพื่อยิง test card', 'ok');
    },

    async save() {
      const btn = $('sa-save-btn'); btn.disabled = true;
      // Service source priority: editing rule → picker input → this.service.
      // Picker only exists in the top-bar new-alert flow.
      const picker = $('sa-f-service');
      const svc = this.editing?.service || (picker?.value.trim()) || this.service;
      if (!svc) { btn.disabled = false; this._flashModal('Service required', 'err'); return; }
      const rule = {
        id:          this.editing?.id || undefined,
        service:     svc,
        metric:      document.querySelector('.sa-metric-card.on')?.dataset.metric || 'cpu',
        op:          $('sa-f-op').value,
        threshold:   parseFloat($('sa-f-threshold').value),
        durationSec: parseInt($('sa-f-dur').value, 10),
        repeatIntervalSec: parseInt($('sa-f-repeat').value, 10),
        channel:     $('sa-f-channel').value.trim() || 'default',
        note:        $('sa-f-note').value.trim(),
        enabled:     $('sa-f-enabled').checked,
        cluster:     SP.currentCluster || '',
        // Per-endpoint URI scope — only submitted when the input has content
        // (empty = watch entire workload, same as before).
        uriPattern:  ($('sa-f-uri-pattern')?.value || '').trim(),
      };
      try {
        const res = await API.alerts.save(rule);
        if (!res?.ok) throw new Error(res?.data?.message || res?.data?.data?.message || 'save failed');
        this._flashModal('Alert saved', 'ok');
        setTimeout(async () => { this.closeForm(); await this.refresh(); }, 700);
      } catch (e) {
        this._flashModal('Save failed: ' + e.message, 'err');
      } finally { btn.disabled = false; }
    },

    async toggle(id) {
      const r = this.rules.find(x => x.id === id); if (!r) return;
      r.enabled = !r.enabled;
      await API.alerts.save(r);
      await this.refresh();
    },
    edit(id) {
      const r = this.rules.find(x => x.id === id); if (!r) return;
      this.openForm(r);
    },
    async del(id) {
      const r = this.rules.find(x => x.id === id); if (!r) return;
      if (!confirm(`ลบ alert นี้? (${r.metric} ${r.op} ${r.threshold})`)) return;
      await API.alerts.del(id);
      await this.refresh();
    },

    // Manual test — hits test.php which sends a distinctly-labelled "TEST"
    // Google Chat card and returns diagnostics (HTTP code, response body).
    // Shows result inline on the button so the user can debug bad webhooks
    // without hunting through server logs.
    async test(id, btnEl) {
      const orig = btnEl.textContent; btnEl.disabled = true; btnEl.textContent = '…';
      try {
        const res = await API.alerts.test(id);
        const d = res?.data?.data || {};
        if (d.ok) {
          btnEl.textContent = '✓ Sent';
          btnEl.style.color = 'var(--ok)';
          this._toast('Test card ส่งแล้ว · เช็ค Google Chat ในช่อง "' + (d.channelKey || '?') + '"', 'ok');
        } else {
          btnEl.textContent = '✕ Fail';
          btnEl.style.color = 'var(--hot)';
          this._toast('Test ล้มเหลว: ' + (d.reason || 'unknown'), 'err', d.responseBody);
        }
      } catch (e) {
        btnEl.textContent = '✕ Err';
        btnEl.style.color = 'var(--hot)';
        this._toast('Test error: ' + e.message, 'err');
      } finally {
        setTimeout(() => { btnEl.disabled = false; btnEl.textContent = orig; btnEl.style.color = ''; }, 2500);
      }
    },

    // Toast in the corner (survives drawer close, unlike _flashModal which
    // lives inside the modal body). Shows response body as expandable
    // <pre> so users can copy Google Chat's error message directly.
    _toast(msg, kind, detail) {
      const t = document.createElement('div');
      t.style.cssText = `position:fixed;top:20px;right:20px;z-index:9999;
        max-width:420px;padding:12px 16px;border-radius:10px;
        background:var(--bg-card);border:1px solid var(--border);
        box-shadow:0 8px 24px rgba(0,0,0,.18);
        border-left:4px solid ${kind==='err' ? 'var(--hot)' : 'var(--ok)'};
        color:var(--text);font-size:12.5px;line-height:1.5;`;
      t.innerHTML = `<div style="font-weight:600;margin-bottom:${detail ? '6px' : '0'}">${esc(msg)}</div>` +
        (detail ? `<pre style="margin:0;font-size:10.5px;color:var(--text-muted);white-space:pre-wrap;word-break:break-all;max-height:120px;overflow-y:auto">${esc(detail)}</pre>` : '');
      document.body.appendChild(t);
      setTimeout(() => t.remove(), kind === 'err' ? 8000 : 3500);
    },

    async openConfig() {
      this._mode = 'config';
      $('sa-modal-title').textContent = 'Notification channels';
      $('sa-save-btn').textContent    = 'Save channels';
      const res = await API.alerts.notifyConfig.get();
      const cfg = res?.data?.data || { channels: {} };
      const channels = cfg.channels || {};
      this.channels = channels;   // keep cache in sync
      const names = Object.keys(channels);
      if (!names.length) names.push('default');
      const rowHtml = (name) => `
        <div class="sa-field sa-cfg-row" data-channel="${esc(name)}">
          <label>
            ${esc(name)}
            <button class="sa-rule-btn" style="float:right;color:var(--hot)" onclick="SP.Alerts._removeChannel(this)">✕</button>
          </label>
          <input type="text" class="sa-cfg-url" placeholder="https://chat.googleapis.com/v1/spaces/..." value="${esc(channels[name]?.webhook_url || '')}">
          <input type="text" class="sa-cfg-note" placeholder="Note (optional)" value="${esc(channels[name]?.note || '')}">
        </div>`;
      $('sa-modal-body').innerHTML = `
        <div class="hint" style="font-size:11px;color:var(--sp-text-soft);line-height:1.6">
          เพิ่ม Google Chat webhook URL ต่อ channel. Rules ต่างๆ อ้าง channel ด้วยชื่อ (key ซ้ายมือ).
          <br>ดู URL ได้จาก Google Chat → space → Apps &amp; integrations → Webhooks → Add webhook → copy URL
        </div>
        <div id="sa-cfg-rows">${names.map(rowHtml).join('')}</div>
        <button class="sa-btn" onclick="SP.Alerts._addChannel()" style="align-self:flex-start">+ Add channel</button>`;
      $('sa-modal').classList.add('on');
    },
    _addChannel() {
      const name = (prompt('Channel key (short name, e.g. sm-alerts):') || '').trim();
      if (!name) return;
      if (!/^[a-z0-9_-]+$/i.test(name)) { alert('Use letters/digits/dash/underscore only'); return; }
      const rows = $('sa-cfg-rows');
      if (rows.querySelector(`[data-channel="${name}"]`)) { alert('Channel already exists'); return; }
      const div = document.createElement('div');
      div.className = 'sa-field sa-cfg-row';
      div.dataset.channel = name;
      div.innerHTML = `<label>${esc(name)}
        <button class="sa-rule-btn" style="float:right;color:var(--hot)" onclick="SP.Alerts._removeChannel(this)">✕</button>
      </label>
        <input type="text" class="sa-cfg-url" placeholder="https://chat.googleapis.com/v1/spaces/...">
        <input type="text" class="sa-cfg-note" placeholder="Note (optional)">`;
      rows.appendChild(div);
    },
    _removeChannel(btn) {
      const row = btn.closest('.sa-cfg-row'); if (!row) return;
      if (!confirm(`ลบ channel "${row.dataset.channel}"?`)) return;
      row.remove();
    },
    async _saveConfig() {
      const channels = {};
      // Scope to the config rows only — previous `[data-channel]` selector
      // was too broad, grabbing zero rows if any other DOM element got the
      // same attribute (which is easy to break by accident).
      document.querySelectorAll('#sa-cfg-rows .sa-cfg-row').forEach(row => {
        const name = row.dataset.channel;
        const url  = row.querySelector('.sa-cfg-url')?.value.trim() || '';
        const note = row.querySelector('.sa-cfg-note')?.value.trim() || '';
        if (name) channels[name] = { webhook_url: url, note };   // save even w/o URL so admin can save intent
      });
      try {
        const res = await API.alerts.notifyConfig.save({ channels });
        if (!res?.ok) throw new Error(res?.data?.message || res?.data?.data?.message || 'save failed');
        this.channels = channels;
        this._flashModal('Saved · ' + Object.keys(channels).length + ' channel(s)', 'ok');
        setTimeout(() => this.closeForm(), 900);
      } catch (e) {
        this._flashModal('Save failed: ' + e.message, 'err');
      }
    },
    // Small in-modal status pill instead of alert() — less jarring, doesn't
    // block the click while user reads it.
    _flashModal(msg, kind) {
      const body = $('sa-modal-body');
      let el = body.querySelector('.sa-flash');
      if (!el) { el = document.createElement('div'); el.className = 'sa-flash'; body.prepend(el); }
      el.style.cssText = `padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:8px;
        background:${kind==='err' ? 'color-mix(in srgb,var(--hot) 12%,transparent)' : 'color-mix(in srgb,var(--ok) 12%,transparent)'};
        color:${kind==='err' ? 'var(--hot)' : 'var(--ok)'};`;
      el.textContent = msg;
      setTimeout(() => el.remove(), 3500);
    },
  };

  // Close on Esc so it feels like every other modal on the page.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('sa-modal')?.classList.contains('on')) return SP.Alerts.closeForm();
    if ($('sa-overlay')?.classList.contains('on')) SP.Alerts.close();
  });
})();


/* ── next inline block ── */


(function(){
  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtAgo = (ts) => {
    const d = Math.max(0, Math.floor(Date.now()/1000) - ts);
    if (d < 60)    return d + 's ago';
    if (d < 3600)  return Math.floor(d/60) + 'm ago';
    if (d < 86400) return Math.floor(d/3600) + 'h ago';
    return Math.floor(d/86400) + 'd ago';
  };
  const fmtTs = (ts) => new Date(ts*1000).toLocaleString('en-GB', {
    day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false
  });
  const fmtMs = (v) => v == null ? '—' :
    (v >= 1000 ? (v/1000).toFixed(2) + 's' : v.toFixed(0) + 'ms');
  const fmtPct = (v) => v == null ? '—' : v.toFixed(1) + '%';
  const fmtDelta = (delta) => {
    if (delta == null || !isFinite(delta)) return '—';
    const sign = delta >= 0 ? '+' : '';
    return sign + delta.toFixed(1) + '%';
  };

  const DA = window.SP.DeepAnalysis = {
    service: '',
    windowMin: 720,   // default 12h for deep analysis (more historical context)
    customStart: null,   // unix seconds; when set, overrides windowMin
    customEnd:   null,
    // Presets shown in the header. Skipped 15m/30m — most DA signals
    // (regression vs yesterday, deploy correlation) need >=1h to be useful.
    RANGES: [
      { min: 60,   label: '1h'  },
      { min: 180,  label: '3h'  },
      { min: 360,  label: '6h'  },
      { min: 720,  label: '12h' },
      { min: 1440, label: '24h' },
      { min: 4320, label: '3d'  },
    ],
    _rendering: false,   // guard for concurrent re-render clicks

    async open(service) {
      this.service = service;
      // Inherit outer graph range if it's a supported preset; otherwise
      // fall back to 12h. Custom absolute ranges aren't carried over —
      // DA has its own picker now, so the modal owns its window.
      const outer = SP.windowMinutes || 720;
      this.windowMin = this.RANGES.some(r => r.min === outer) ? outer : 720;
      this.customStart = null;
      this.customEnd   = null;
      $('da-svc').textContent = service;
      this._paintRange();
      $('da-overlay').classList.add('on');
      document.body.style.overflow = 'hidden';
      this._render(); // async but fire-and-forget
    },
    close() {
      $('da-overlay').classList.remove('on');
      document.body.style.overflow = '';
    },

    /** Compact "Aug 28 09:00 → Aug 28 15:00" for the Custom pill label.
     *  Local copy — the outer fmtCustomRange lives in SP's IIFE scope. */
    _fmtCustom(s, e) {
      const opts = { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' };
      const fs = new Date(s * 1000).toLocaleString('en-GB', opts);
      const fe = new Date(e * 1000).toLocaleString('en-GB', opts);
      return `${fs} → ${fe}`;
    },

    /** Repaint the header pill row. Called after open() and after every setWindow(). */
    _paintRange() {
      const el = $('da-range'); if (!el) return;
      const isCustom = this.customStart !== null;
      const presets = this.RANGES.map(r => `
        <button type="button" class="da-range-btn ${!isCustom && r.min === this.windowMin ? 'on' : ''}"
                data-min="${r.min}"
                ${this._rendering ? 'disabled' : ''}
                onclick="SP.DeepAnalysis.setWindow(${r.min})">${r.label}</button>`).join('');
      // Custom pill last — dashed border when idle, solid when a custom
      // range is active. Shows formatted range in-place so users see what
      // they picked without opening the modal again.
      const customLbl = isCustom ? esc(this._fmtCustom(this.customStart, this.customEnd)) : 'Custom…';
      const customBtn = `
        <button type="button" class="da-range-btn da-range-custom ${isCustom ? 'on' : ''}"
                ${this._rendering ? 'disabled' : ''}
                title="Pick a specific date/time range"
                onclick="SP.openCustomPicker('da')">${customLbl}</button>`;
      el.innerHTML = presets + customBtn;
    },

    /** Switch analysis window and re-fire the entire modal. No-op when the
     *  chosen range matches the current one or a render is already in flight. */
    setWindow(min) {
      if (this._rendering) return;
      if (min === this.windowMin && this.customStart === null) return;
      this.windowMin   = min;
      this.customStart = null;
      this.customEnd   = null;
      this._paintRange();
      this._render();
    },

    /** Called by SP.applyCustomPicker when the picker was opened from DA. */
    setCustomRange(s, e) {
      if (this._rendering) return;
      this.customStart = s;
      this.customEnd   = e;
      this.windowMin   = Math.max(60, Math.round((e - s) / 60));   // used for deploys API which only accepts minutes
      this._paintRange();
      this._render();
    },

    async _render() {
      this._rendering = true;
      this._paintRange();   // disables pills while fetching
      const body = $('da-body');
      // Skeleton preview — shows 5 empty section shells that will be
      // replaced when data lands. Feels far snappier than a plain spinner
      // because the layout is already in place.
      body.innerHTML = `
        <div class="da-loading-inline" style="justify-content:center;padding:8px 0 16px">
          <span class="da-spinner"></span>
          <span>Analyzing service · fetching detail + baseline + deploys…</span>
        </div>
        ${[1,2,3,4,5].map(() => `
          <div class="da-sect">
            <div class="da-sect-hd">
              <div class="da-skel" style="width:32px;height:32px;border-radius:9px"></div>
              <div class="da-skel" style="height:14px;width:180px"></div>
            </div>
            <div class="da-skel" style="height:60px"></div>
          </div>`).join('')}`;
      // Fire all fetches in parallel — modal shows loading skeleton until
      // every request settles, then paints all sections at once.
      const svc = this.service;
      const win = this.windowMin;
      const cluster = SP.currentCluster || '';
      // Absolute range wins over relative window (mirrors detail.php's own
      // precedence). Falls back to windowMin when no custom pick is active.
      const isCustom = this.customStart !== null && this.customEnd !== null;
      const detailOpts = isCustom
        ? { start: this.customStart, end: this.customEnd, cluster }
        : { windowMin: win, cluster };
      const [deploysRes, detailRes] = await Promise.all([
        // deploys.php only accepts window minutes — for custom ranges we
        // pass the span so the deploy timeline covers the same period.
        API.servicePerformance.deploys(svc, win, cluster).catch(() => null),
        // detail(service, runway, opts) — cluster goes INSIDE opts, runway
        // stays empty so backend auto-picks the source.
        API.servicePerformance.detail(svc, '', detailOpts).catch(() => null),
      ]);
      const deploys = deploysRes?.data?.data?.deploys || [];
      const detail  = detailRes?.data?.data || {};
      // Fetch baseline (SAME span, shifted 24h back) for regression detection.
      // For a custom range this preserves the exact window shape so hour-of-day
      // comparisons stay apples-to-apples.
      const now = Math.floor(Date.now()/1000);
      const endSec   = isCustom ? this.customEnd   : now;
      const startSec = isCustom ? this.customStart : (now - win*60);
      const baselineRes = await API.servicePerformance.detail(svc, '', {
        start: startSec - 86400, end: endSec - 86400, cluster,
      }).catch(() => null);
      const baseline = baselineRes?.data?.data || {};

      // Compute all sections client-side, then paint.
      const sections = [
        this._sectDeploys(deploys, detail),
        this._sectAnomalies(detail, deploys),
        this._sectRegression(detail, baseline),
        this._sectCorrelation(detail),
        this._sectSuggestions(detail, deploys, baseline),
      ];
      body.innerHTML = sections.join('');
      if (window.Icons?.replaceAll) window.Icons.replaceAll(body);
      this._rendering = false;
      this._paintRange();   // re-enable pills
    },

    // ── Section 1 · Deploy Timeline ────────────────────────────────
    _sectDeploys(deploys, detail) {
      const items = (deploys || []).slice().reverse();   // newest first
      const rowsHtml = items.length ? items.map(d => {
        const verLine = d.version ? `<span class="ver">v${esc(d.version)}</span>` : `<span class="ver">${esc(d.podsRecreated || '?')}/${esc(d.totalPods || '?')} pods</span>`;
        const source = d.source === 'both' ? 'pod recreate + version label'
                     : d.source === 'version-label' ? 'version label'
                     : `${d.podsRecreated || '?'}/${d.totalPods || '?'} pods rolled (${(d.ratio*100).toFixed(0)}%)`;
        return `<div class="da-deploy-row">
          <div class="marker"><i data-icon="rocket" style="width:17px;height:17px"></i></div>
          <div>${verLine}<div class="meta">${esc(source)}</div></div>
          <div class="ts">${fmtTs(d.ts)}<span class="ago">${fmtAgo(d.ts)}</span></div>
          <span class="conf ${esc(d.confidence)}">${esc(d.confidence)}</span>
        </div>`;
      }).join('') : `<div class="da-empty">No deploy events detected in this window.</div>`;
      return `
        <section class="da-sect">
          <div class="da-sect-hd">
            <div class="icon" style="background:color-mix(in srgb,#f26419 15%,transparent);color:#f26419"><i data-icon="rocket" style="width:16px;height:16px"></i></div>
            <div class="title">Deploy Timeline</div>
            <div class="count">${items.length}</div>
          </div>
          ${rowsHtml}
        </section>`;
    },

    // ── Section 2 · Anomalies Detected ─────────────────────────────
    // Client-side detection: for each metric with time-series data, mark
    // any sample where value > 3× median. Post-deploy anomalies (within
    // 10 min after a deploy) are down-classified to "post-deploy" (yellow).
    _sectAnomalies(detail, deploys) {
      const s = detail?.series || {};
      const anomalies = [];
      // Metric list to scan. Each entry: [key, label, unit, fmt].
      const scans = [
        ['procMsMax', 'Latency MAX',  'ms', fmtMs],
        ['procMs',    'Avg latency',  'ms', fmtMs],
        ['cpu',       'CPU',          'cores', v => v >= 1 ? v.toFixed(2)+' cores' : Math.round(v*1000)+'m'],
        ['mem',       'MEM',          'bytes', v => v >= 1e9 ? (v/1e9).toFixed(2)+' GB' : (v/1e6).toFixed(0)+' MB'],
      ];
      const deployTimes = (deploys || []).map(d => d.ts);
      for (const [key, label, , fmt] of scans) {
        const series = s[key];
        if (!Array.isArray(series) || series.length < 10) continue;
        const values = series.map(p => p[1]).filter(v => Number.isFinite(v)).sort((a,b) => a-b);
        const median = values[Math.floor(values.length/2)];
        if (!median || median <= 0) continue;
        const threshold = median * 3;
        // Cluster consecutive anomaly samples into single "events"
        let curStart = null, curMax = 0, curEnd = 0;
        for (const [ts, v] of series) {
          if (v > threshold) {
            if (curStart == null) { curStart = ts; curMax = v; }
            else if (v > curMax) curMax = v;
            curEnd = ts;
          } else {
            if (curStart != null) {
              anomalies.push({ metric: label, start: curStart, end: curEnd, peak: curMax, baseline: median, fmt });
              curStart = null; curMax = 0;
            }
          }
        }
        if (curStart != null) anomalies.push({ metric: label, start: curStart, end: curEnd, peak: curMax, baseline: median, fmt });
      }
      anomalies.sort((a, b) => b.start - a.start);
      const top = anomalies.slice(0, 8);
      const rowsHtml = top.length ? top.map(a => {
        const durMin = Math.max(1, Math.round((a.end - a.start) / 60));
        const postDeploy = deployTimes.some(dts => a.start >= dts && a.start <= dts + 600);
        const cls = postDeploy ? 'post-deploy' : '';
        const badge = postDeploy ? '<span style="font-size:10px;color:var(--warn);font-weight:700;margin-left:6px">POST-DEPLOY</span>' : '';
        return `<div class="da-anom-row ${cls}">
          <div class="icon"><i data-icon="${postDeploy ? 'zap' : 'target'}" style="width:16px;height:16px"></i></div>
          <div>
            <div class="desc">${esc(a.metric)} spike @ ${fmtTs(a.start)} ${badge}</div>
            <div class="sub">${a.fmt(a.peak)} (baseline ${a.fmt(a.baseline)}, ${(a.peak/a.baseline).toFixed(1)}× normal) · ${durMin} min · ${fmtAgo(a.start)}</div>
          </div>
          <div class="val">${a.fmt(a.peak)}</div>
        </div>`;
      }).join('') : `<div class="da-empty">No anomalies detected (all samples within 3× baseline).</div>`;
      const total = anomalies.length;
      return `
        <section class="da-sect">
          <div class="da-sect-hd">
            <div class="icon" style="background:color-mix(in srgb,var(--hot) 15%,transparent);color:var(--hot)"><i data-icon="target" style="width:16px;height:16px"></i></div>
            <div class="title">Anomalies Detected</div>
            <div class="count">${total}${total > top.length ? ' (top ' + top.length + ')' : ''}</div>
          </div>
          ${rowsHtml}
        </section>`;
    },

    // ── Section 3 · Regression Detector ────────────────────────────
    // Compare current window's avg to yesterday's same window. Delta > 20%
    // = worse (red), < -20% = better (green), between = neutral.
    _sectRegression(detail, baseline) {
      const cur = detail?.series || {};
      const base = baseline?.series || {};
      // Compare these 4 metrics with their friendly names + unit formatters.
      const scans = [
        { key: 'procMs',    label: 'Avg latency', worseIfHigher: true,  fmt: v => v.toFixed(0)+'ms' },
        { key: 'procMsMax', label: 'Latency MAX', worseIfHigher: true,  fmt: v => v >= 1000 ? (v/1000).toFixed(2)+'s' : v.toFixed(0)+'ms' },
        { key: 'txnRate',   label: 'TXN rate',    worseIfHigher: false, fmt: v => v.toFixed(1)+' req/s' },
        { key: 'cpu',       label: 'CPU',         worseIfHigher: true,  fmt: v => v >= 1 ? v.toFixed(2)+' cores' : Math.round(v*1000)+'m' },
      ];
      const cards = scans.map(({ key, label, worseIfHigher, fmt }) => {
        const cs = cur[key] || [], bs = base[key] || [];
        const cAvg = cs.length ? cs.reduce((a, p) => a + p[1], 0) / cs.length : null;
        const bAvg = bs.length ? bs.reduce((a, p) => a + p[1], 0) / bs.length : null;
        if (cAvg == null || bAvg == null || bAvg === 0) {
          return `<div class="da-reg-card">
            <div class="lbl">${esc(label)}</div>
            <div class="val neutral">—</div>
            <div class="cmp">insufficient data</div>
          </div>`;
        }
        const delta = ((cAvg - bAvg) / bAvg) * 100;
        const cls = Math.abs(delta) < 10 ? 'neutral'
                  : (worseIfHigher ? delta > 0 : delta < 0) ? 'worse' : 'better';
        const arrow = delta > 0 ? '↑' : (delta < 0 ? '↓' : '·');
        return `<div class="da-reg-card">
          <div class="lbl">${esc(label)} vs yesterday</div>
          <div class="val ${cls}">${arrow} ${fmtDelta(delta)}</div>
          <div class="cmp">was ${esc(fmt(bAvg))} → now ${esc(fmt(cAvg))}</div>
        </div>`;
      }).join('');
      return `
        <section class="da-sect">
          <div class="da-sect-hd">
            <div class="icon" style="background:color-mix(in srgb,var(--cool,#6366f1) 15%,transparent);color:var(--cool,#6366f1)"><i data-icon="bar-chart" style="width:16px;height:16px"></i></div>
            <div class="title">Regression Detector</div>
            <div class="count">vs yesterday</div>
          </div>
          <div class="da-reg-grid">${cards}</div>
        </section>`;
    },

    // ── Section 4 · Cross-metric correlation ───────────────────────
    // Multi-line SVG showing top-3 metrics normalised to 0-100 range so
    // spike alignment is visible even when scales differ (ms vs bytes).
    _sectCorrelation(detail) {
      const s = detail?.series || {};
      const picks = [
        ['procMs',    'Avg latency', '#f59e0b'],
        ['cpu',       'CPU',         '#8b5cf6'],
        ['procMsMax', 'Latency MAX', '#dc2626'],
      ].filter(([k]) => Array.isArray(s[k]) && s[k].length >= 5);
      if (!picks.length) return '';
      const W = 900, H = 220, PL = 40, PR = 12, PT = 12, PB = 28;
      // Global x-range from union of all series
      let xMin = Infinity, xMax = -Infinity;
      for (const [k] of picks) for (const [x] of s[k]) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
      const sx = (x) => PL + ((x - xMin) / (xMax - xMin || 1)) * (W - PL - PR);
      // Normalise each series to 0-100 by its own min/max so they overlay
      const paths = picks.map(([k, , color]) => {
        const series = s[k];
        const values = series.map(p => p[1]).filter(v => Number.isFinite(v));
        const yMin = Math.min(...values), yMax = Math.max(...values);
        const range = (yMax - yMin) || 1;
        const norm = (v) => (v - yMin) / range;   // 0-1
        const sy = (v) => H - PB - norm(v) * (H - PT - PB);
        const d = series.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" opacity=".85"/>`;
      }).join('');
      // Time axis labels (start, mid, end)
      const fmtT = (ts) => new Date(ts*1000).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
      const xLabels = [xMin, (xMin+xMax)/2, xMax].map(x =>
        `<text x="${sx(x).toFixed(1)}" y="${H-8}" font-size="10" fill="var(--sp-text-soft)" text-anchor="middle">${fmtT(x)}</text>`
      ).join('');
      const legend = picks.map(([, lbl, color]) =>
        `<span class="item"><span class="dot" style="background:${color}"></span>${esc(lbl)}</span>`
      ).join('');
      return `
        <section class="da-sect">
          <div class="da-sect-hd">
            <div class="icon" style="background:color-mix(in srgb,var(--emerald,#10b981) 15%,transparent);color:var(--emerald,#10b981)"><i data-icon="trending-up" style="width:16px;height:16px"></i></div>
            <div class="title">Cross-metric Correlation</div>
            <div class="count">${picks.length} metrics · normalised</div>
          </div>
          <div class="da-corr-chart">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
              ${paths}
              ${xLabels}
            </svg>
            <div class="da-corr-legend">${legend}</div>
          </div>
        </section>`;
    },

    // ── Section 5 · Suggested Investigation ────────────────────────
    // Rule-based triage cards — structured "signal / evidence / action"
    // layout (not a chat-style paragraph). Each card: severity badge +
    // one-line signal + factual evidence + jump buttons for next step.
    _sectSuggestions(detail, deploys, baseline) {
      const s = detail?.series || {};
      const bs = baseline?.series || {};
      const svc = this.service;
      const now = Math.floor(Date.now()/1000);
      const findings = [];
      // Rule: latency spike after deploy
      if (deploys && deploys.length) {
        const latestDeploy = deploys[deploys.length-1];
        const latPost = (s.procMs || []).filter(p => p[0] > latestDeploy.ts);
        const latPre  = (s.procMs || []).filter(p => p[0] <= latestDeploy.ts && p[0] > latestDeploy.ts - 3600);
        if (latPost.length > 5 && latPre.length > 5) {
          const avgPost = latPost.reduce((a,p)=>a+p[1],0) / latPost.length;
          const avgPre  = latPre.reduce((a,p)=>a+p[1],0) / latPre.length;
          if (avgPre > 0 && avgPost / avgPre > 1.3) {
            findings.push({
              severity: 'critical', badge: 'Regression',
              signal: `Latency degraded after deploy${latestDeploy.version ? ' v' + latestDeploy.version : ''}`,
              evidence: `Before deploy: <code>${fmtMs(avgPre)}</code> avg &nbsp;→&nbsp; after: <code>${fmtMs(avgPost)}</code> avg &nbsp;(<code>+${((avgPost/avgPre - 1)*100).toFixed(0)}%</code>)`,
              actions: [
                { label: 'View deploy details', href: `#`, onclick: `document.querySelector('.da-sect [class*="deploy-row"]')?.scrollIntoView({behavior:'smooth'})` },
              ],
            });
          }
        }
      }
      // Rule: latency max very high but avg normal = tail latency issue
      const lmax = (s.procMsMax || []).map(p => p[1]).filter(Number.isFinite);
      const lavg = (s.procMs || []).map(p => p[1]).filter(Number.isFinite);
      if (lmax.length && lavg.length) {
        const mxPeak = Math.max(...lmax);
        const avgMean = lavg.reduce((a,b)=>a+b,0) / lavg.length;
        if (mxPeak > avgMean * 20 && mxPeak > 2000) {
          const peakIdx = (s.procMsMax || []).findIndex(p => p[1] === mxPeak);
          const peakTs = peakIdx >= 0 ? s.procMsMax[peakIdx][0] : now;
          findings.push({
            severity: 'warn', badge: 'Tail latency',
            signal: 'Small number of requests are hanging',
            evidence: `Workload avg <code>${fmtMs(avgMean)}</code> but worst single request reached <code>${fmtMs(mxPeak)}</code> &nbsp;(<code>${(mxPeak/avgMean).toFixed(0)}× of avg</code>)`,
            actions: [
              { label: 'Open Log Explorer at spike', href: '#',
                onclick: `SP.LogViewer?.open('${esc(svc)}', SP._lastDetail?.namespace || '', { start: '${new Date((peakTs-300)*1000).toISOString()}', end: '${new Date((peakTs+300)*1000).toISOString()}', label: 'tail-latency spike' }); SP.DeepAnalysis.close();` },
            ],
          });
        }
      }
      // Rule: CPU regression vs yesterday
      const cCur = s.cpu || [], cBase = bs.cpu || [];
      if (cCur.length && cBase.length) {
        const curAvg = cCur.reduce((a,p)=>a+p[1],0) / cCur.length;
        const baseAvg = cBase.reduce((a,p)=>a+p[1],0) / cBase.length;
        if (baseAvg > 0 && curAvg / baseAvg > 1.5) {
          findings.push({
            severity: 'warn', badge: 'CPU regression',
            signal: `CPU usage up ${((curAvg/baseAvg - 1)*100).toFixed(0)}% vs yesterday same time`,
            evidence: `Yesterday avg <code>${curAvg >= 1 ? baseAvg.toFixed(2) + ' cores' : Math.round(baseAvg*1000) + 'm'}</code> &nbsp;→&nbsp; today <code>${curAvg >= 1 ? curAvg.toFixed(2) + ' cores' : Math.round(curAvg*1000) + 'm'}</code>. Check for traffic spike, bulk job, or code change`,
            actions: [
              { label: 'Compare with sibling services', href: '#',
                onclick: `SP.DeepAnalysis.close(); setTimeout(() => SP.Compare?.open('${esc(svc)}'), 250);` },
            ],
          });
        }
      }
      // Rule: pods restarted a lot in window
      const restartEvents = (detail?.events || []).filter(e => e.type === 'restart');
      if (restartEvents.length > 3) {
        findings.push({
          severity: 'critical', badge: 'Crash loop',
          signal: `${restartEvents.length} pod restarts detected in this window`,
          evidence: `Pod restarts within a short period often indicate OOM, liveness probe failures, or repeated crashes`,
          actions: [
            { label: 'Open Restart Analyzer', href: `restart-analyzer.html?service=${encodeURIComponent(svc)}&range=6h`, target: '_blank' },
          ],
        });
      }
      // Nothing unusual — healthy card
      if (!findings.length) {
        findings.push({
          severity: 'ok', badge: 'All clear',
          signal: 'Nothing unusual detected in this window',
          evidence: `No deploys, no anomalies, no regression vs yesterday. Service is behaving normally`,
          actions: [],
        });
      }
      const rowsHtml = findings.map(f => {
        const actionsHtml = f.actions.length
          ? `<div class="da-sugg-actions">${f.actions.map(a =>
              a.onclick
                ? `<button type="button" onclick="${a.onclick}"><i data-icon="external-link" style="width:10px;height:10px"></i>${esc(a.label)}</button>`
                : `<a href="${esc(a.href)}"${a.target ? ' target="' + esc(a.target) + '"' : ''}><i data-icon="external-link" style="width:10px;height:10px"></i>${esc(a.label)}</a>`
            ).join('')}</div>`
          : '';
        return `<div class="da-sugg-item ${esc(f.severity)}">
          <div class="da-sugg-hd">
            <span>${esc(f.signal)}</span>
            <span class="badge ${esc(f.severity)}" style="margin-left:auto">${esc(f.badge)}</span>
          </div>
          <div class="da-sugg-evidence">${f.evidence}</div>
          ${actionsHtml}
        </div>`;
      }).join('');
      return `
        <section class="da-sect">
          <div class="da-sect-hd">
            <div class="icon" style="background:color-mix(in srgb,var(--cool,#6366f1) 15%,transparent);color:var(--cool,#6366f1)"><i data-icon="lightbulb" style="width:16px;height:16px"></i></div>
            <div class="title">Suggested Investigation</div>
            <div class="count">${findings.length}</div>
          </div>
          <div class="da-sugg-list">${rowsHtml}</div>
        </section>`;
    },
  };

  // Esc closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('da-overlay')?.classList.contains('on')) {
      DA.close();
    }
  });
})();


/* ── next inline block ── */


(function(){
  const $  = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const PALETTE = ['#8b5cf6', '#f59e0b', '#10b981', '#06b6d4', '#ec4899', '#f43f5e', '#84cc16', '#eab308'];
  const RANGES = [
    { min: 30, label: '30m' }, { min: 60, label: '1h' }, { min: 180, label: '3h' },
    { min: 360, label: '6h' }, { min: 720, label: '12h' }, { min: 1440, label: '24h' }, { min: 4320, label: '3d' },
  ];
  const CHART_SPECS = [
    { key: 'cpu',        label: 'CPU · avg per pod',       unit: 'cores', pick: d => d.series?.cpu     || [] },
    { key: 'mem',        label: 'MEM · avg per pod',       unit: 'bytes', pick: d => d.series?.mem     || [] },
    { key: 'txnRate',    label: 'TXN rate',                unit: 'reqs',  pick: d => d.series?.txnRate || [] },
    { key: 'procMs',     label: 'Avg latency',             unit: 'ms',    pick: d => d.series?.procMs  || [] },
    { key: 'procMsMax',  label: 'Latency MAX (worst req)', unit: 'ms',    pick: d => d.series?.procMsMax || [] },
  ];

  const CM = window.SP.Compare = {
    services:  [],
    windowMin: 60,
    _svcList:  null,

    async open(initialService) {
      // Boot from URL if the drawer was opened via ?compare=1 deep-link,
      // otherwise seed with the current SP service (or the one passed in).
      const p = new URLSearchParams(location.search);
      const urlSvcs = (p.get('compareServices') || '').split(',').map(x => x.trim()).filter(Boolean);
      const seed = urlSvcs.length ? urlSvcs : (initialService ? [initialService] : []);
      this.services = seed.slice(0, 8).map((name, i) => ({ name, color: PALETTE[i % PALETTE.length], data: null }));
      // Range: URL > current SP window > 1h default. Compare metrics are
      // usually more meaningful over 1h+ (short windows too noisy).
      const wp = parseInt(p.get('compareWindow') || '', 10);
      this.windowMin = Number.isFinite(wp) && wp >= 5 ? wp : Math.max(60, SP.windowMinutes || 60);
      $('cm-overlay').classList.add('on');
      document.body.style.overflow = 'hidden';
      this._paintRange();
      this._paintChips();
      this._syncUrl();
      // Prefetch service list for the typeahead so the datalist is warm.
      if (!this._svcList) {
        try {
          const r = await API.servicePerformance.suggest('', 500);
          this._svcList = r?.data?.data?.suggestions || [];
        } catch { this._svcList = []; }
        this._paintChips();
      }
      if (this.services.length) this._load();
      else this._renderEmpty();
    },

    close() {
      $('cm-overlay').classList.remove('on');
      document.body.style.overflow = '';
      // Clean the URL — user is back on the main SP view.
      const p = new URLSearchParams(location.search);
      p.delete('compare'); p.delete('compareServices'); p.delete('compareWindow');
      const q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    },

    copyLink() {
      navigator.clipboard.writeText(location.href).catch(() => {});
      // Little visual confirmation via toast helper (SP.Alerts has one).
      if (SP.Alerts?._flashToast) SP.Alerts._flashToast('Compare link copied', 'ok');
    },

    _addService(name) {
      if (this.services.length >= 8) return alert('Max 8 services');
      if (this.services.some(s => s.name === name)) return;
      const color = PALETTE[this.services.length % PALETTE.length];
      this.services.push({ name, color, data: null });
      this._paintChips();
      this._syncUrl();
      this._load();
    },
    _removeService(name) {
      this.services = this.services.filter(s => s.name !== name);
      this.services.forEach((s, i) => s.color = PALETTE[i % PALETTE.length]);
      this._paintChips();
      this._syncUrl();
      if (this.services.length) this._renderCharts();
      else this._renderEmpty();
    },

    _paintRange() {
      const wrap = $('cm-range');
      const lbl = wrap.querySelector('.cm-range-lbl');
      wrap.innerHTML = ''; wrap.appendChild(lbl);
      RANGES.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'cm-range-btn' + (r.min === this.windowMin ? ' on' : '');
        btn.textContent = r.label;
        btn.onclick = () => { this.windowMin = r.min; this._paintRange(); this._syncUrl(); this._load(); };
        wrap.appendChild(btn);
      });
    },

    _paintChips() {
      const row = $('cm-svc-row');
      const chipsHtml = this.services.map(s => `
        <span class="cm-svc-chip">
          <span class="dot" style="background:${s.color}"></span>
          <span class="name">${esc(s.name)}</span>
          <button class="rm" onclick="SP.Compare._removeService('${esc(s.name)}')" title="Remove">✕</button>
        </span>`).join('');
      const adderHtml = this.services.length < 8 ? `
        <span class="cm-add-wrap">
          <input class="cm-add-input" id="cm-add" list="cm-add-list"
                 placeholder="+ พิมพ์ชื่อ service แล้ว Enter (add up to ${8 - this.services.length} more)">
          <datalist id="cm-add-list">${(this._svcList || [])
            .filter(s => !this.services.some(x => x.name === (s.service || s)))
            .map(s => `<option value="${esc(s.service || s)}"></option>`).join('')}
          </datalist>
        </span>` : '';
      row.innerHTML = chipsHtml + adderHtml;
      const inp = $('cm-add');
      if (inp) {
        inp.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          const v = inp.value.trim();
          if (v) { this._addService(v); inp.value = ''; }
        });
        setTimeout(() => inp.focus(), 50);
      }
    },

    _syncUrl() {
      const p = new URLSearchParams(location.search);
      p.set('compare', '1');
      if (this.services.length) p.set('compareServices', this.services.map(s => s.name).join(','));
      else p.delete('compareServices');
      if (this.windowMin !== 60) p.set('compareWindow', String(this.windowMin));
      else p.delete('compareWindow');
      history.replaceState(null, '', location.pathname + '?' + p.toString() + location.hash);
    },

    async _load() {
      if (!this.services.length) return this._renderEmpty();
      // Skeleton grid — one shimmering card per chart spec so the layout
      // is in place before real data lands. Feels much faster than a
      // single centered spinner.
      const chartSkelHtml = CHART_SPECS.map(() => `
        <div class="da-chart-skel">
          <div class="da-skel lbl-skel"></div>
          <div class="da-skel body-skel"></div>
        </div>`).join('');
      $('cm-content').innerHTML = `
        <div class="da-loading-inline" style="justify-content:center;padding:6px 0 14px">
          <span class="da-spinner"></span>
          <span>Fetching ${this.services.length} service${this.services.length!==1?'s':''}…</span>
        </div>
        <div class="cm-grid">${chartSkelHtml}</div>`;
      const win = this.windowMin;
      const cluster = SP.currentCluster || '';
      await Promise.all(this.services.map(async (s) => {
        try {
          const res = await API.servicePerformance.detail(s.name, '', { windowMin: win, cluster });
          s.data = (res?.ok && res.data?.data?.found) ? res.data.data : null;
        } catch { s.data = null; }
      }));
      this._renderCharts();
    },

    _renderEmpty() {
      $('cm-content').innerHTML = `
        <div class="cm-empty">
          <div class="icon"><i data-icon="bar-chart" style="width:26px;height:26px"></i></div>
          พิมพ์ชื่อ service ในช่องด้านบน → Enter → เพิ่มได้สูงสุด 8 services
        </div>`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll($('cm-content'));
    },

    _renderCharts() {
      const anyOk = this.services.some(s => s.data);
      if (!anyOk) {
        $('cm-content').innerHTML = `<div class="cm-empty" style="color:var(--hot)">โหลด service ทั้งหมดไม่สำเร็จ — ลอง refresh หรือเช็คชื่อ service</div>`;
        return;
      }
      const chartsHtml = CHART_SPECS.map(spec => this._renderChart(spec)).join('');
      const rankHtml = this._renderRank();
      $('cm-content').innerHTML = `<div class="cm-grid">${chartsHtml}</div>${rankHtml}`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll($('cm-content'));
    },

    _renderChart(spec) {
      const seriesList = this.services
        .map(s => ({ name: s.name, color: s.color, values: s.data ? spec.pick(s.data) : [] }))
        .filter(x => x.values.length >= 2);
      if (!seriesList.length) {
        return `<div class="cm-chart-card">
          <div class="cm-chart-title"><span class="lbl">${esc(spec.label)}</span></div>
          <div class="cm-chart-empty">ไม่มีข้อมูล metric นี้สำหรับ service ที่เลือก</div>
        </div>`;
      }
      let xMin=Infinity, xMax=-Infinity, yMax=-Infinity, yMin=Infinity;
      for (const s of seriesList) for (const [x, y] of s.values) {
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y > yMax) yMax = y; if (y < yMin) yMin = y;
      }
      const W = 480, H = 180, PL = 52, PR = 12, PT = 12, PB = 22;
      const yRange = yMax - yMin;
      if (yRange <= 0) { yMin = Math.max(0, yMax * 0.9); yMax = yMax * 1.1 || 1; }
      else { const pad = yRange * 0.1; yMin = Math.max(0, yMin - pad); yMax = yMax + pad; }
      const sx = (x) => PL + ((x - xMin) / (xMax - xMin || 1)) * (W - PL - PR);
      const sy = (y) => H - PB - ((y - yMin) / (yMax - yMin || 1)) * (H - PT - PB);
      const fmt = (v) => this._fmt(v, spec.unit);
      let yTicks = '';
      for (let i = 0; i <= 2; i++) {
        const yv = yMin + (yMax - yMin) * (i / 2);
        const yy = sy(yv);
        yTicks += `<line x1="${PL}" x2="${W-PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
        yTicks += `<text x="${PL-6}" y="${yy}" font-size="9.5" fill="var(--sp-text-soft)" text-anchor="end" dominant-baseline="middle">${fmt(yv)}</text>`;
      }
      const fmtT = (ts) => new Date(ts*1000).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
      const xLabels = [xMin, (xMin+xMax)/2, xMax].map(x =>
        `<text x="${sx(x).toFixed(1)}" y="${H-6}" font-size="9.5" fill="var(--sp-text-soft)" text-anchor="middle">${fmtT(x)}</text>`).join('');
      const paths = seriesList.map(s => {
        const d = s.values.map((p, i) => (i?'L':'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.75" stroke-linejoin="round" opacity=".9"/>`;
      }).join('');
      const legend = seriesList.map(s => {
        const last = s.values[s.values.length-1]?.[1];
        return `<span class="item"><span class="dot" style="background:${s.color}"></span>${esc(s.name)} · <b style="color:${s.color}">${fmt(last)}</b></span>`;
      }).join('');
      return `<div class="cm-chart-card">
        <div class="cm-chart-title">
          <span class="lbl">${esc(spec.label)}</span>
          <span class="hint">${seriesList.length} of ${this.services.length} services</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
          ${yTicks}${paths}${xLabels}
        </svg>
        <div class="cm-legend">${legend}</div>
      </div>`;
    },

    _renderRank() {
      const rows = [];
      for (const spec of CHART_SPECS) {
        const vals = this.services
          .map(s => {
            const series = s.data ? spec.pick(s.data) : [];
            const last = series.length ? series[series.length-1][1] : null;
            return { name: s.name, color: s.color, last };
          })
          .filter(x => x.last != null);
        if (vals.length < 2) continue;
        vals.sort((a, b) => b.last - a.last);
        const top = vals[0], bot = vals[vals.length-1];
        const spread = bot.last > 0 ? (top.last / bot.last) : 1;
        const cls = spread >= 3 ? 'hot' : spread >= 2 ? 'warn' : '';
        rows.push(`<tr>
          <td>${esc(spec.label)}</td>
          <td class="dot"><span class="col-dot" style="background:${top.color}"></span></td>
          <td class="svc">${esc(top.name)}</td>
          <td class="right">${esc(this._fmt(top.last, spec.unit))}</td>
          <td class="dot"><span class="col-dot" style="background:${bot.color}"></span></td>
          <td class="svc">${esc(bot.name)}</td>
          <td class="right">${esc(this._fmt(bot.last, spec.unit))}</td>
          <td class="right ${cls}">${spread.toFixed(1)}×</td>
        </tr>`);
      }
      if (!rows.length) return '';
      return `<div class="cm-rank">
        <h3><i data-icon="bar-chart" style="width:14px;height:14px;color:var(--cool,#6366f1)"></i> Ranking — ค่าปัจจุบันของแต่ละ metric · เห็น service ที่กิน resource มากสุด vs น้อยสุด</h3>
        <table>
          <thead><tr>
            <th>Metric</th>
            <th colspan="3">Highest</th>
            <th colspan="3">Lowest</th>
            <th>Spread</th>
          </tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
    },

    _fmt(v, unit) {
      if (v == null || !isFinite(v)) return '—';
      if (unit === 'ms')    return v >= 1000 ? (v/1000).toFixed(2) + 's' : v.toFixed(0) + 'ms';
      if (unit === 'bytes') return v >= 1e9 ? (v/1e9).toFixed(2) + 'GB' : (v/1e6).toFixed(0) + 'MB';
      if (unit === 'cores') return v >= 1 ? v.toFixed(2) + ' cores' : Math.round(v*1000) + 'm';
      if (unit === 'reqs')  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
      return v.toFixed(2);
    },
  };

  // Esc closes the modal.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('cm-overlay')?.classList.contains('on')) CM.close();
  });

  // Deep-link boot: if URL has ?compare=1, open the modal automatically on
  // page load (after SP is ready). Reads compareServices/compareWindow.
  window.addEventListener('load', () => {
    const p = new URLSearchParams(location.search);
    if (p.get('compare') === '1') {
      setTimeout(() => CM.open(SP.currentService || ''), 600);
    }
  });
})();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_attachCrosshair", { configurable: true, get: () => _attachCrosshair, set: (v) => { _attachCrosshair = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_buildAreaSvg", { configurable: true, get: () => _buildAreaSvg, set: (v) => { _buildAreaSvg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_buildMultiLineSvg", { configurable: true, get: () => _buildMultiLineSvg, set: (v) => { _buildMultiLineSvg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_buildXAxis", { configurable: true, get: () => _buildXAxis, set: (v) => { _buildXAxis = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_depsFallbackName", { configurable: true, get: () => _depsFallbackName, set: (v) => { _depsFallbackName = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_escSvg", { configurable: true, get: () => _escSvg, set: (v) => { _escSvg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_fmtChartTime", { configurable: true, get: () => _fmtChartTime, set: (v) => { _fmtChartTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_logSafe", { configurable: true, get: () => _logSafe, set: (v) => { _logSafe = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_paintAnnotations", { configurable: true, get: () => _paintAnnotations, set: (v) => { _paintAnnotations = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_paintDepsGraph", { configurable: true, get: () => _paintDepsGraph, set: (v) => { _paintDepsGraph = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_paintHeaderMinMax", { configurable: true, get: () => _paintHeaderMinMax, set: (v) => { _paintHeaderMinMax = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_paintLinkedCrosshair", { configurable: true, get: () => _paintLinkedCrosshair, set: (v) => { _paintLinkedCrosshair = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setupSharedCrosshair", { configurable: true, get: () => _setupSharedCrosshair, set: (v) => { _setupSharedCrosshair = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_sloLines", { configurable: true, get: () => _sloLines, set: (v) => { _sloLines = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_slotKey", { configurable: true, get: () => _slotKey, set: (v) => { _slotKey = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "animateGauges", { configurable: true, get: () => animateGauges, set: (v) => { animateGauges = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "areaChart", { configurable: true, get: () => areaChart, set: (v) => { areaChart = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtBytes", { configurable: true, get: () => fmtBytes, set: (v) => { fmtBytes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtCores", { configurable: true, get: () => fmtCores, set: (v) => { fmtCores = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtCustomRange", { configurable: true, get: () => fmtCustomRange, set: (v) => { fmtCustomRange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtWindow", { configurable: true, get: () => fmtWindow, set: (v) => { fmtWindow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "multiLineChart", { configurable: true, get: () => multiLineChart, set: (v) => { multiLineChart = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "observeChartSlots", { configurable: true, get: () => observeChartSlots, set: (v) => { observeChartSlots = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "paintCharts", { configurable: true, get: () => paintCharts, set: (v) => { paintCharts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pctBar", { configurable: true, get: () => pctBar, set: (v) => { pctBar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "podGauge", { configurable: true, get: () => podGauge, set: (v) => { podGauge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "runwayColor", { configurable: true, get: () => runwayColor, set: (v) => { runwayColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sevClass", { configurable: true, get: () => sevClass, set: (v) => { sevClass = v; } }); } catch (e) {}
})();
