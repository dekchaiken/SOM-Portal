// begin-grafana — page script, extracted from begin-grafana.html.
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
    Layout.render('begin-grafana');
  

/* ── next inline block ── */


  (function() {
    const S = {
      service: '',
      window: 30,
      endpoints: [],
      runway: null,
    };

    const $ = (id) => document.getElementById(id);
    const input = $('bg2Input');
    const rangeEl = $('bg2Range');

    let inputTimer = null;
    input.addEventListener('input', () => {
      const v = input.value.trim();
      clearTimeout(inputTimer);
      if (v.length < 3) return;
      inputTimer = setTimeout(() => { S.service = v; load(); }, 400);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim();
        if (v) { S.service = v; load(); }
      }
    });

    rangeEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-w]');
      if (!btn) return;
      rangeEl.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      S.window = parseInt(btn.dataset.w, 10);
      if (S.service) load();
    });

    const unwrap = (res) => (res && res.data && res.data.data) ? res.data.data : (res && res.data) ? res.data : res;

    function epKey(ep) { return ep.method + '__' + ep.uri.replace(/[^a-z0-9]+/gi, '_'); }

    async function load() {
      if (!S.service) return;
      $('bg2Empty').style.display = 'none';
      $('bg2Stack').style.display = '';
      $('bg2Custom').style.display = '';
      $('bg2Summary').style.display = 'none';
      $('bg2Stack').innerHTML = '<div class="bg2-empty"><span class="bg2-spinner"></span> Loading endpoints…</div>';
      $('bg2Custom').innerHTML = '<div class="bg2-empty"><span class="bg2-spinner"></span> Discovering business metrics…</div>';
      loadCustom();

      try {
        const res = await API.beginGrafana.endpoints(S.service, { window: S.window });
        const d = unwrap(res);
        if (!d.found) {
          const probes = (d.probes || []).map(p => {
            const hits = (p.labelsFound && p.labelsFound.length)
              ? '<div style="padding-left:16px; margin-top:2px; color:var(--warn); font-size:11px;">↳ similar labels found: ' + p.labelsFound.map(escapeHtml).join(', ') + '</div>' : '';
            return (
              '<div style="margin-top:6px; font-size:11px; text-align:left; padding-left:20px;">' +
                '• <b>' + escapeHtml(p.name || p.slug || '?') + '</b> ' +
                '(tried: ' + (p.triedLabels || []).join(', ') + ') → ' +
                (p.error ? '<span style="color:var(--hot)">' + escapeHtml(p.error) + '</span>'
                         : (p.seriesReturned || 0) + ' series') +
              '</div>' + hits
            );
          }).join('');
          $('bg2Stack').innerHTML =
            '<div class="bg2-card"><div class="bg2-empty">' +
            '<div><strong>No metrics found</strong> for <span class="mono">' + escapeHtml(S.service) + '</span>.</div>' +
            '<div style="margin-top:8px; font-size:12px;">' + escapeHtml(d.reason || '') + '</div>' +
            (probes ? '<div style="margin-top:10px; text-align:left; display:inline-block;">' + probes + '</div>' : '') +
            '</div></div>';
          return;
        }
        S.endpoints = d.endpoints || [];
        S.runway = d.runway || null;
        renderSummary(d);
        renderStack();
      } catch (e) {
        $('bg2Stack').innerHTML = '<div class="bg2-empty">Error: ' + escapeHtml(String(e.message || e)) + '</div>';
      }
    }

    function renderSummary(d) {
      const c = d.summary.counts || {};
      const runway = d.runway ? (d.runway.name || d.runway.slug) + (d.runway.cluster ? ' · ' + d.runway.cluster : '') : '';
      const html = [
        chipHtml('ok',  c.healthy || 0,  'Healthy'),
        chipHtml('wr',  c.degraded || 0, 'Degraded'),
        chipHtml('hot', c.failing || 0,  'Failing'),
        chipHtml('na',  c.idle || 0,     'Idle'),
        '<span class="bg2-chip na"><span class="dot"></span>' + (d.summary.totalRps || 0).toFixed(2) + ' req/s total</span>',
        runway ? '<span class="bg2-chip na"><span class="dot"></span>' + escapeHtml(runway) + '</span>' : '',
      ].join('');
      $('bg2Summary').innerHTML = html;
      $('bg2Summary').style.display = 'flex';
    }
    function chipHtml(cls, n, label) {
      return '<span class="bg2-chip ' + cls + '"><span class="dot"></span>' + n + ' ' + label + '</span>';
    }

    // ── Business Metrics section ──────────────────────────────
    async function loadCustom() {
      try {
        const res = await API.beginGrafana.customList(S.service);
        const d = unwrap(res);
        if (!d || !d.found || !d.metrics || !d.metrics.length) {
          const appL = d && d.appLabel ? d.appLabel : 'app_name';
          $('bg2Custom').innerHTML =
            '<div class="bg2-section-hd"><h3>Business Metrics</h3>' +
            '<span class="cnt">no <span class="mono">*_total</span> counters scraped from <span class="mono">' + appL + '="' + escapeHtml(S.service) + '"</span> (excluding standard JVM/Micrometer families)</span></div>';
          return;
        }
        const appL = d.appLabel || 'app_name';
        let html = '<div class="bg2-section-hd"><h3>Business Metrics</h3>' +
          '<span class="cnt">' + d.metricCount + ' counter' + (d.metricCount === 1 ? '' : 's') +
          ' scraped from <span class="mono">' + appL + '="' + escapeHtml(S.service) + '"</span></span></div>';
        html += d.metrics.map((m, i) => bmCardShell(m, i)).join('');
        $('bg2Custom').innerHTML = html;
        // Wire copy buttons
        $('bg2Custom').querySelectorAll('.bg2-q-copy').forEach(btn => {
          btn.addEventListener('click', async () => {
            const txt = document.getElementById(btn.dataset.t).textContent;
            try {
              await navigator.clipboard.writeText(txt);
              btn.textContent = 'Copied ✓'; btn.classList.add('ok');
              setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1200);
            } catch (e) { btn.textContent = 'Failed'; }
          });
        });
        // Fetch series for every metric in parallel. When status_code is
        // absent we skip success/fail (would be empty) and load one Total
        // chart instead. scoped=false for metrics with no app_name label.
        d.metrics.forEach((m, i) => {
          const ns = m.narrowSel || '';
          if (m.hasStatusCode) {
            loadBmSeries(i, m.name, 'success', ns);
            loadBmSeries(i, m.name, 'fail',    ns);
          } else {
            loadBmSeries(i, m.name, 'total', ns);
          }
        });
      } catch (e) {
        $('bg2Custom').innerHTML = '<div class="bg2-empty">Business metrics error: ' + escapeHtml(String(e.message || e)) + '</div>';
      }
    }

    function bmCardShell(m, i) {
      const q = m.queries || {};
      const labels = {
        success:      { l: 'Success (200-*)',      cls: 'suc' },
        fail:         { l: 'Fail (non-200)',       cls: 'fal' },
        fail_rate_1m: { l: 'Fail rate (per-sec)',  cls: 'fal' },
        total_1m:     { l: 'Total (1m increase)',  cls: 'na'  },
        rate_5m:      { l: 'Rate (5m)',            cls: 'na'  },
      };
      const tags = [];
      if (m.hasService)    tags.push('<span class="bg2-bm-tag">has service</span>');
      if (m.hasStatusCode) tags.push('<span class="bg2-bm-tag">has status_code</span>');
      let queriesHtml = '';
      Object.keys(labels).forEach(k => {
        if (!q[k]) return;
        const id = 'bmq_' + i + '_' + k;
        queriesHtml += (
          '<div class="bg2-q">' +
            '<div class="bg2-q-hd">' +
              '<span>' + labels[k].l + '</span>' +
              '<button class="bg2-q-copy" data-t="' + id + '">Copy</button>' +
            '</div>' +
            '<div class="bg2-q-code" id="' + id + '">' + escapeHtml(q[k]) + '</div>' +
          '</div>'
        );
      });
      const explore = m.grafanaExploreUrl
        ? '<a class="bg2-ec-explore" target="_blank" rel="noopener" href="' + escapeAttr(m.grafanaExploreUrl) + '">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v7H3V3h7"/></svg>' +
            'Open in Grafana Explore</a>'
        : '';
      let leftBlock, rightBlock;
      if (m.hasStatusCode) {
        leftBlock =
          '<div class="bg2-bm-chart">' +
            '<div class="bg2-bm-chart-hd suc"><span class="dot"></span> Success (200-*) by service · status_code</div>' +
            '<svg id="bm_' + i + '_success" viewBox="0 0 800 180" preserveAspectRatio="none"><text x="400" y="90" text-anchor="middle" fill="#888" font-size="12">Loading…</text></svg>' +
            '<div class="bg2-bm-legend" id="bm_' + i + '_success_lg"></div>' +
          '</div>';
        rightBlock =
          '<div class="bg2-bm-chart">' +
            '<div class="bg2-bm-chart-hd fal"><span class="dot"></span> Fail (non-200) by service · status_code</div>' +
            '<svg id="bm_' + i + '_fail" viewBox="0 0 800 180" preserveAspectRatio="none"><text x="400" y="90" text-anchor="middle" fill="#888" font-size="12">Loading…</text></svg>' +
            '<div class="bg2-bm-legend" id="bm_' + i + '_fail_lg"></div>' +
          '</div>';
      } else {
        // No status_code — show a single Total chart spanning both columns
        leftBlock =
          '<div class="bg2-bm-chart" style="grid-column:1 / span 2;">' +
            '<div class="bg2-bm-chart-hd"><span class="dot" style="background:var(--cool);"></span> Total rate (metric has no status_code label)</div>' +
            '<svg id="bm_' + i + '_total" viewBox="0 0 800 180" preserveAspectRatio="none"><text x="400" y="90" text-anchor="middle" fill="#888" font-size="12">Loading…</text></svg>' +
            '<div class="bg2-bm-legend" id="bm_' + i + '_total_lg"></div>' +
          '</div>';
        rightBlock = '';
      }
      return (
        '<div class="bg2-bm">' +
          '<div class="bg2-bm-hd">' +
            '<span class="bg2-bm-name">' + escapeHtml(m.name) + '</span>' +
            tags.join('') +
          '</div>' +
          '<div class="bg2-bm-body">' +
            '<div class="bg2-bm-charts">' + leftBlock + rightBlock + '</div>' +
            '<div class="bg2-bm-queries">' + queriesHtml + explore + '</div>' +
          '</div>' +
        '</div>'
      );
    }

    async function loadBmSeries(i, metric, mode, narrowSel) {
      const svgEl = document.getElementById('bm_' + i + '_' + mode);
      const lgEl  = document.getElementById('bm_' + i + '_' + mode + '_lg');
      if (!svgEl) return;
      try {
        const res = await API.beginGrafana.customSeries(S.service, metric, mode, S.window, narrowSel || '');
        const d = unwrap(res);
        drawStacked(svgEl, lgEl, (d && d.series) || [], mode);
      } catch (e) {
        svgEl.innerHTML = '<text x="400" y="90" text-anchor="middle" fill="#c33" font-size="12">' + escapeHtml(String(e.message || e)) + '</text>';
      }
    }

    // Categorical stacked-area chart for business metrics. Uses a fixed palette
    // cycling through the series list — same colours as the Grafana screenshot.
    function drawStacked(svgEl, legendEl, series, mode) {
      const W = 800, H = 180, P = { l: 44, r: 12, t: 10, b: 24 };
      const cw = W - P.l - P.r, ch = H - P.t - P.b;
      // Cap series shown to avoid a 40-legend blowout on high-cardinality metrics
      series = (series || []).slice(0, 12);
      let allPts = [];
      series.forEach(s => allPts = allPts.concat((s.points || []).filter(p => p[1] !== null)));
      if (!allPts.length) {
        svgEl.innerHTML = '<text x="400" y="90" text-anchor="middle" fill="#888" font-size="12">No data in window</text>';
        if (legendEl) legendEl.innerHTML = '';
        return;
      }
      const tMin = Math.min(...allPts.map(p => p[0]));
      const tMax = Math.max(...allPts.map(p => p[0]));
      // Stacked total per timestamp
      const stackAt = {};
      series.forEach(s => (s.points || []).forEach(p => { stackAt[p[0]] = (stackAt[p[0]] || 0) + (p[1] || 0); }));
      let vMax = Math.max(1e-9, ...Object.values(stackAt));
      vMax = vMax > 0 ? vMax * 1.1 : 1;
      const x = t => P.l + ((t - tMin) / Math.max(1, (tMax - tMin))) * cw;
      const y = v => P.t + ch - (v / vMax) * ch;

      // Palette — greens/olives for success, reds/oranges for fail
      const paletteSuc = ['#a3a537', '#7fa03a', '#5c8f3a', '#3d7c3d', '#8fb84d', '#c3c96b', '#e6d55c', '#4ea36a'];
      const paletteFal = ['#dc2626', '#ef6a4b', '#f59e0b', '#ee7a53', '#a63636', '#c94a3f', '#f0865f', '#e6522c'];
      const paletteNa  = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#6b7280', '#a855f7'];
      const palette = mode === 'success' ? paletteSuc : mode === 'fail' ? paletteFal : paletteNa;

      // Stacked area draw (bottom-up)
      const stackAcc = {};
      let paths = ''; let legendHtml = '';
      series.forEach((s, si) => {
        const color = palette[si % palette.length];
        const pts = (s.points || []).map(p => {
          const prev = stackAcc[p[0]] || 0;
          const top  = prev + (p[1] || 0);
          stackAcc[p[0]] = top;
          return { t: p[0], v0: prev, v1: top };
        });
        if (!pts.length) return;
        const top = pts.map((p, k) => (k ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v1).toFixed(1)).join(' ');
        const bot = pts.slice().reverse().map(p => 'L' + x(p.t).toFixed(1) + ' ' + y(p.v0).toFixed(1)).join(' ');
        paths += '<path d="' + top + ' ' + bot + ' Z" fill="' + color + '" fill-opacity=".75" stroke="' + color + '" stroke-width="1"/>';
        legendHtml += '<span><span class="sw" style="background:' + color + ';"></span>' + escapeHtml(s.name || '?') + '</span>';
      });
      // Axes
      let axis = '';
      [0, vMax/2, vMax].forEach(v => {
        const yy = y(v);
        axis += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yy + '" y2="' + yy + '" stroke="currentColor" stroke-opacity=".08"/>';
        axis += '<text x="' + (P.l - 6) + '" y="' + (yy + 3) + '" text-anchor="end" fill="currentColor" fill-opacity=".55" font-size="10">' + fmtAxis(v, '') + '</text>';
      });
      [tMin, (tMin + tMax) / 2, tMax].forEach((t, k) => {
        axis += '<text x="' + x(t) + '" y="' + (H - 6) + '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '" fill="currentColor" fill-opacity=".55" font-size="10">' + fmtTime(t) + '</text>';
      });
      svgEl.innerHTML = axis + paths;
      if (legendEl) legendEl.innerHTML = legendHtml;
    }

    // ── Render one card per endpoint ──────────────────────────
    function renderStack() {
      if (!S.endpoints.length) {
        $('bg2Stack').innerHTML = '<div class="bg2-card"><div class="bg2-empty">No endpoints returned.</div></div>';
        return;
      }
      // Skeleton HTML per card — chart + PromQL fill in as async fetches complete.
      $('bg2Stack').innerHTML =
        '<div class="bg2-section-hd"><h3>HTTP Endpoints</h3>' +
        '<span class="cnt">' + S.endpoints.length + ' endpoint' + (S.endpoints.length === 1 ? '' : 's') +
        ' via <span class="mono">http_server_requests_seconds_*</span></span></div>' +
        S.endpoints.map((ep, i) => cardShell(ep, i)).join('');

      // Wire tab clicks per card
      $('bg2Stack').querySelectorAll('.bg2-ec-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
          const card = btn.closest('.bg2-ec');
          const metric = btn.dataset.metric;
          card.querySelectorAll('.bg2-ec-tabs button').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          card.dataset.metric = metric;
          const i = parseInt(card.dataset.i, 10);
          loadCardSeries(i, metric);
        });
      });

      // Fetch series (status) + promql for every endpoint IN PARALLEL.
      S.endpoints.forEach((ep, i) => {
        loadCardSeries(i, 'status');
        loadCardPromql(i);
      });
    }

    function cardShell(ep, i) {
      const key = epKey(ep);
      const rpsTxt = ep.rps > 0 ? fmtRate(ep.rps) + '/s' : '— /s';
      const s2 = ep.rps > 0 ? ((ep.rate2xx / ep.rps) * 100).toFixed(1) : '0.0';
      const s4 = ep.rps > 0 ? ((ep.rate4xx / ep.rps) * 100).toFixed(1) : '0.0';
      const s5 = ep.rps > 0 ? ((ep.rate5xx / ep.rps) * 100).toFixed(1) : '0.0';
      const pills = (ep.statusBreakdown || []).slice(0, 8).map(sb => {
        const c = String(sb.status).charAt(0);
        const cls = c === '2' ? 's2' : c === '3' ? 's3' : c === '4' ? 's4' : c === '5' ? 's5' : '';
        return '<span class="bg2-pill ' + cls + '">' + sb.status + ' · ' + fmtRate(sb.rate) + '/s</span>';
      }).join('');
      return (
        '<div class="bg2-ec" id="ec_' + i + '" data-i="' + i + '" data-metric="status">' +
          '<div class="bg2-ec-hd">' +
            '<div class="bg2-ec-title">' +
              '<span class="bg2-method ' + ep.method + '">' + escapeHtml(ep.method) + '</span>' +
              '<span class="bg2-uri mono">' + escapeHtml(ep.uri) + '</span>' +
              '<span class="bg2-ec-verd ' + ep.verdict + '">' + ep.verdict + '</span>' +
            '</div>' +
            '<div class="bg2-ec-metrics">' +
              '<span><b>' + rpsTxt + '</b></span>' +
              '<span>avg <b>' + (ep.avgMs !== null ? Math.round(ep.avgMs) + ' ms' : '—') + '</b></span>' +
              '<span>max <b>' + (ep.maxMs !== null ? fmtMs(ep.maxMs) : '—') + '</b></span>' +
              '<span>2xx <b>' + s2 + '%</b></span>' +
              '<span>4xx <b>' + s4 + '%</b></span>' +
              '<span>5xx <b>' + s5 + '%</b></span>' +
            '</div>' +
          '</div>' +
          '<div class="bg2-ec-body">' +
            '<div class="bg2-ec-charts">' +
              '<div class="bg2-ec-tabs">' +
                '<button class="on" data-metric="status">Status Breakdown</button>' +
                '<button data-metric="rps">RPS</button>' +
                '<button data-metric="latency">Latency</button>' +
              '</div>' +
              '<div class="bg2-ec-chart"><svg id="chart_' + i + '" viewBox="0 0 800 200" preserveAspectRatio="none"><text x="400" y="100" text-anchor="middle" fill="#888" font-size="12">Loading chart…</text></svg></div>' +
              '<div class="bg2-ec-legend" id="legend_' + i + '"></div>' +
              (pills ? '<div style="margin-top:10px; display:flex; gap:4px; flex-wrap:wrap;">' + pills + '</div>' : '') +
              '<div style="margin-top:8px; font-size:11px; color:var(--text-muted);">' + escapeHtml(ep.verdictReason || '') + '</div>' +
            '</div>' +
            '<div class="bg2-ec-pql">' +
              '<div class="bg2-ec-pql-hd">PromQL Queries</div>' +
              '<div id="pql_' + i + '"><div style="font-size:11px; color:var(--text-muted);"><span class="bg2-spinner"></span> Building…</div></div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    async function loadCardSeries(i, metric) {
      const ep = S.endpoints[i];
      if (!ep) return;
      const chartEl = document.getElementById('chart_' + i);
      const legendEl = document.getElementById('legend_' + i);
      if (!chartEl) return;
      chartEl.innerHTML = '<text x="400" y="100" text-anchor="middle" fill="#888" font-size="12">Loading…</text>';
      try {
        const res = await API.beginGrafana.series(S.service, ep.method, ep.uri, metric, { window: S.window });
        const d = unwrap(res);
        drawChart(chartEl, legendEl, (d && d.series) || [], metric);
      } catch (e) {
        chartEl.innerHTML = '<text x="400" y="100" text-anchor="middle" fill="#c33" font-size="12">' + escapeHtml(String(e.message || e)) + '</text>';
      }
    }

    async function loadCardPromql(i) {
      const ep = S.endpoints[i];
      if (!ep) return;
      const wrap = document.getElementById('pql_' + i);
      if (!wrap) return;
      try {
        const res = await API.beginGrafana.promql(S.service, ep.method, ep.uri);
        const d = unwrap(res);
        wrap.innerHTML = buildPqlHtml(d, i);
        wrap.querySelectorAll('.bg2-q-copy').forEach(btn => {
          btn.addEventListener('click', async () => {
            const txt = document.getElementById(btn.dataset.t).textContent;
            try {
              await navigator.clipboard.writeText(txt);
              btn.textContent = 'Copied ✓'; btn.classList.add('ok');
              setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1200);
            } catch (e) { btn.textContent = 'Failed'; }
          });
        });
      } catch (e) {
        wrap.innerHTML = '<div style="font-size:11px; color:var(--hot);">Error: ' + escapeHtml(String(e.message || e)) + '</div>';
      }
    }

    function buildPqlHtml(d, i) {
      const labels = {
        rps:              'RPS (req/s)',
        rps_by_status:    'RPS by status',
        p50:              'p50 latency (s)',
        p95:              'p95 latency (s)',
        p99:              'p99 latency (s)',
        avg_latency_ms:   'Avg latency (ms)',
        max_latency_ms:   'Max latency (ms)',
        error_ratio:      'Error ratio (5xx / total)',
        success_ratio:    'Success ratio (2xx / total)',
        '4xx_ratio':      '4xx ratio',
      };
      let html = '';
      Object.keys(labels).forEach(k => {
        const q = (d.queries || {})[k];
        if (!q) return;
        const id = 'q_' + i + '_' + k;
        html += (
          '<div class="bg2-q">' +
            '<div class="bg2-q-hd">' +
              '<span>' + labels[k] + '</span>' +
              '<button class="bg2-q-copy" data-t="' + id + '">Copy</button>' +
            '</div>' +
            '<div class="bg2-q-code" id="' + id + '">' + escapeHtml(q) + '</div>' +
          '</div>'
        );
      });
      if (d.grafanaExploreUrl) {
        html += '<a class="bg2-ec-explore" target="_blank" rel="noopener" href="' + escapeAttr(d.grafanaExploreUrl) + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v7H3V3h7"/></svg>' +
          'Open in Grafana Explore</a>';
      }
      return html;
    }

    function drawChart(svgEl, legendEl, series, metric) {
      const W = 800, H = 200, P = { l: 44, r: 12, t: 10, b: 24 };
      const cw = W - P.l - P.r, ch = H - P.t - P.b;
      let allPts = [];
      series.forEach(s => allPts = allPts.concat((s.points || []).filter(p => p[1] !== null)));
      if (!allPts.length) {
        svgEl.innerHTML = '<text x="400" y="100" text-anchor="middle" fill="#888" font-size="12">No data in window</text>';
        legendEl.innerHTML = '';
        return;
      }
      const tMin = Math.min(...allPts.map(p => p[0]));
      const tMax = Math.max(...allPts.map(p => p[0]));
      let vMax = Math.max(...allPts.map(p => p[1]));
      if (metric === 'status') {
        // stacked → recompute max on stacked sums
        const stackAt = {};
        series.forEach(s => (s.points || []).forEach(p => { stackAt[p[0]] = (stackAt[p[0]] || 0) + (p[1] || 0); }));
        vMax = Math.max(1e-9, ...Object.values(stackAt));
      }
      vMax = vMax > 0 ? vMax * 1.1 : 1;

      const x = t => P.l + ((t - tMin) / Math.max(1, (tMax - tMin))) * cw;
      const y = v => P.t + ch - (v / vMax) * ch;

      const palette = {
        RPS:  '#2563eb',
        P50:  '#2563eb', P95:  '#d97706', P99:  '#dc2626', AVG: '#7c3aed',
        '2xx':'#16a34a', '3xx':'#2563eb', '4xx':'#d97706', '5xx':'#dc2626', 'other':'#6b7280',
      };

      let paths = '';
      let legend = '';
      if (metric === 'status') {
        // Stacked areas — draw bottom→top
        const stackAcc = {}; // ts → cumulative
        const stacked = series.map(s => {
          const pts = (s.points || []).map(p => {
            const prev = stackAcc[p[0]] || 0;
            const top = prev + (p[1] || 0);
            stackAcc[p[0]] = top;
            return { t: p[0], v0: prev, v1: top };
          });
          return { name: s.name, pts };
        });
        stacked.forEach(s => {
          if (!s.pts.length) return;
          const color = palette[s.name] || '#888';
          const top = s.pts.map((p, i) => (i ? 'L' : 'M') + x(p.t) + ' ' + y(p.v1)).join(' ');
          const bot = s.pts.slice().reverse().map(p => 'L' + x(p.t) + ' ' + y(p.v0)).join(' ');
          paths += '<path d="' + top + ' ' + bot + ' Z" fill="' + color + '" fill-opacity=".7" stroke="' + color + '" stroke-width="1"/>';
          legend += '<span><span class="sw" style="background:' + color + ';"></span>' + s.name + '</span>';
        });
      } else {
        series.forEach(s => {
          const color = palette[s.name] || '#2563eb';
          const pts = (s.points || []).filter(p => p[1] !== null);
          if (!pts.length) return;
          const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]) + ' ' + y(p[1])).join(' ');
          paths += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8"/>';
          legend += '<span><span class="sw" style="background:' + color + ';"></span>' + s.name + '</span>';
        });
      }

      // Y-axis ticks (3 levels)
      const ticks = [0, vMax/2, vMax];
      let axis = '';
      ticks.forEach(v => {
        const yy = y(v);
        axis += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yy + '" y2="' + yy + '" stroke="currentColor" stroke-opacity=".08"/>';
        axis += '<text x="' + (P.l - 6) + '" y="' + (yy + 3) + '" text-anchor="end" fill="currentColor" fill-opacity=".55" font-size="10">' + fmtAxis(v, metric) + '</text>';
      });
      // X-axis: 3 timestamps
      const xTicks = [tMin, (tMin + tMax) / 2, tMax];
      xTicks.forEach((t, i) => {
        const xx = x(t);
        axis += '<text x="' + xx + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '" fill="currentColor" fill-opacity=".55" font-size="10">' + fmtTime(t) + '</text>';
      });

      svgEl.innerHTML = axis + paths;
      legendEl.innerHTML = legend;
    }

    // ── Formatters ────────────────────────────────────────────
    function fmtRate(v) { if (v == null) return '—'; if (v >= 100) return v.toFixed(0); if (v >= 10) return v.toFixed(1); return v.toFixed(2); }
    function fmtMs(v)   { if (v == null) return '—'; if (v >= 1000) return (v / 1000).toFixed(2) + ' s'; return v.toFixed(0) + ' ms'; }
    function fmtTime(unix) { const d = new Date(unix * 1000); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); }
    function fmtAxis(v, m) {
      if (m === 'latency') return v >= 1 ? v.toFixed(1) : v.toFixed(3);
      return v >= 10 ? v.toFixed(0) : v.toFixed(2);
    }
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
    function escapeAttr(s) { return escapeHtml(s); }

    // ── Bootstrap from ?service= ──────────────────────────────
    const urlSvc = new URLSearchParams(location.search).get('service');
    if (urlSvc) { input.value = urlSvc; S.service = urlSvc; setTimeout(load, 200); }
  })();

})();
