// restart-analyzer — page script, extracted from restart-analyzer.html.
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
  Layout.render('restart-analyzer');

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const richText = (s) => esc(s)
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
  const fmtTime = (ts) => ts ? new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const fmtBytes = (n) => { if (n == null || n <= 0) return '—'; const u=['B','KB','MB','GB','TB']; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++;} return v.toFixed(v>=100?0:v>=10?1:2)+' '+u[i]; };
  const fmtDur  = (sec) => sec == null ? '—' : sec < 60 ? sec + 'วิ' : sec < 3600 ? Math.round(sec/60) + 'นาที' : Math.round(sec/3600) + 'ชม.';

  // ── Chart primitives (shared for main timeline + drill-down) ───────
  // Renders a responsive area chart with:
  //   • container-measured width (no viewBox distortion)
  //   • hover crosshair line + tooltip synced to the nearest data point
  //   • optional restart event markers (vertical lines with pod-count label)
  //   • auto Y range (min/max padded 10%)
  // Data shape: series = [{ name, points:[[ts,val],...], color, unit }, ...]
  function paintChart(slot, series, markers, opts) {
    if (!slot) return;
    opts = opts || {};
    const w = Math.max(320, slot.clientWidth || 720);
    const h = opts.height || 240;
    const PL = 52, PR = 14, PT = 14, PB = 32;
    slot.innerHTML = '';

    const withPts = series.filter(s => (s.points || []).length >= 2);
    if (!withPts.length) {
      slot.innerHTML = `<div style="padding:40px;text-align:center;color:var(--ra-text-soft);font-size:12px">ไม่มีข้อมูลกราฟในช่วงเวลานี้</div>`;
      return;
    }

    // X extents.
    let xMin = Infinity, xMax = -Infinity;
    for (const s of withPts) for (const [x] of s.points) {
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    }
    // Y — single 0-100 scale when all series are '%' (memory + cpu); else
    // pad by 15%.
    const allPct = series.every(s => (s.unit || '') === '%');
    let yMax;
    if (allPct) {
      const raw = Math.max(20, ...withPts.flatMap(s => s.points.map(p => p[1] || 0)));
      yMax = Math.min(105, raw * 1.15);
    } else {
      const raw = Math.max(...withPts.flatMap(s => s.points.map(p => p[1] || 0)));
      yMax = raw > 0 ? raw * 1.15 : 1;
    }
    const sx = (x) => PL + ((x - xMin) / (xMax - xMin || 1)) * (w - PL - PR);
    const sy = (y) => h - PB - Math.min(1, Math.max(0, y / yMax)) * (h - PT - PB);

    // Grid + Y axis labels.
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const yv = (yMax / 4) * i;
      const yy = sy(yv);
      grid += `<line x1="${PL}" x2="${w - PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 3"/>`;
      const lbl = allPct ? yv.toFixed(0) + '%' : (opts.unitFmt ? opts.unitFmt(yv) : yv.toFixed(0));
      grid += `<text x="${PL - 6}" y="${yy}" font-size="10.5" fill="var(--ra-text-soft)" text-anchor="end" dominant-baseline="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${lbl}</text>`;
    }

    // X-axis labels — density scales with width.
    const usableW = w - PL - PR;
    const nTicks = Math.max(3, Math.min(8, Math.floor(usableW / 100)));
    const spanSec = xMax - xMin;
    const fmtTs = (ts) => {
      const d = new Date(ts * 1000);
      const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      if (spanSec < 86400) return { line1: time, line2: null };
      const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      return { line1: day, line2: time };
    };
    let xLabels = '';
    for (let i = 0; i < nTicks; i++) {
      const ts = xMin + spanSec * (i / (nTicks - 1));
      const x = sx(ts).toFixed(1);
      const anchor = i === 0 ? 'start' : i === nTicks - 1 ? 'end' : 'middle';
      const lbl = fmtTs(ts);
      if (lbl.line2) {
        xLabels += `<text x="${x}" y="${h - 18}" font-size="10" fill="var(--ra-text-soft)" text-anchor="${anchor}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${lbl.line1}</text>`;
        xLabels += `<text x="${x}" y="${h - 6}"  font-size="10" fill="var(--ra-text-soft)" text-anchor="${anchor}" opacity=".8" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${lbl.line2}</text>`;
      } else {
        xLabels += `<text x="${x}" y="${h - 8}" font-size="10.5" fill="var(--ra-text-soft)" text-anchor="${anchor}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${lbl.line1}</text>`;
      }
    }

    // Series paths (area fill + line).
    const gradsById = {};
    const paths = withPts.map((s, si) => {
      const pts = s.points;
      const gid = 'ragrad-' + Math.random().toString(36).slice(2, 8);
      gradsById[gid] = s.color;
      const line = pts.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ');
      const area = line + ` L${sx(pts[pts.length - 1][0]).toFixed(1)},${(h - PB).toFixed(1)} L${sx(pts[0][0]).toFixed(1)},${(h - PB).toFixed(1)} Z`;
      return `<path d="${area}" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${s.color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
    const defs = `<defs>${Object.entries(gradsById).map(([id, c]) =>
      `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c}" stop-opacity=".22"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;

    // Restart-event markers — cluster within 30 s so a burst renders as ONE
    // vertical line with a "×N" count.
    let markerHtml = '';
    const clustered = [];
    (markers || []).slice().sort((a, b) => a.ts - b.ts).forEach(m => {
      const t = m.ts;
      if (clustered.length && t - clustered[clustered.length - 1].max <= 30) {
        clustered[clustered.length - 1].max = t;
        clustered[clustered.length - 1].count++;
        clustered[clustered.length - 1].pods.push(m);
      } else {
        clustered.push({ min: t, max: t, count: 1, pods: [m] });
      }
    });
    clustered.forEach(c => {
      if (c.max < xMin || c.min > xMax) return;
      const midTs = (c.min + c.max) / 2;
      const x = sx(midTs).toFixed(1);
      markerHtml += `<line x1="${x}" x2="${x}" y1="${PT}" y2="${h - PB}" stroke="var(--hot)" stroke-width="2" stroke-dasharray="3 3" opacity=".85"/>`;
      const cnt = c.count > 1 ? `×${c.count}` : '×1';
      markerHtml += `<rect x="${parseFloat(x) + 3}" y="${PT + 2}" width="26" height="14" rx="3" fill="var(--hot)"/>`;
      markerHtml += `<text x="${parseFloat(x) + 16}" y="${PT + 12}" font-size="9.5" fill="#fff" text-anchor="middle" font-weight="700" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${cnt}</text>`;
    });

    // Crosshair line + one focus dot per series + overlay rect.
    const cxLine = `<line class="ra-cx-line" x1="0" x2="0" y1="${PT}" y2="${h - PB}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
    const cxDots = withPts.map((s, i) => `<circle class="ra-cx-dot" data-si="${i}" cx="0" cy="0" r="4" fill="${s.color}" stroke="var(--bg-card)" stroke-width="2" opacity="0"/>`).join('');
    const overlay = `<rect class="ra-cx-overlay" x="${PL}" y="${PT}" width="${w - PL - PR}" height="${h - PT - PB}"/>`;

    slot.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs}${grid}${paths}${xLabels}${markerHtml}${cxLine}${cxDots}${overlay}</svg><div class="ra-cx-tip"></div>`;

    // Wire crosshair interaction.
    _wireCrosshair(slot, withPts, clustered, sx, sy, PL, PT, PR, PB, w, h, allPct, opts);
  }

  // Move crosshair + tooltip to nearest data point on mousemove. Reads slot
  // rect for pointer-to-svg conversion so it stays accurate under CSS scale.
  function _wireCrosshair(slot, series, markers, sx, sy, PL, PT, PR, PB, w, h, allPct, opts) {
    const svg     = slot.querySelector('svg');
    const overlay = slot.querySelector('.ra-cx-overlay');
    const line    = slot.querySelector('.ra-cx-line');
    const dots    = slot.querySelectorAll('.ra-cx-dot');
    const tip     = slot.querySelector('.ra-cx-tip');
    if (!svg || !overlay || !tip) return;

    const nearestIdx = (arr, x) => {
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid][0] < x) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && Math.abs(arr[lo - 1][0] - x) < Math.abs(arr[lo][0] - x)) lo--;
      return lo;
    };
    // Global x extent from first series (all series share the same range in
    // this chart since backend queries the same window).
    const xs = series[0].points;
    const xMin = xs[0][0], xMax = xs[xs.length - 1][0];

    overlay.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width ? svg.viewBox.baseVal.width / rect.width : 1;
      const px = (ev.clientX - rect.left) * scaleX;
      if (px < PL || px > w - PR) return;
      const t = (px - PL) / (w - PL - PR);
      const targetTs = xMin + t * (xMax - xMin);

      // Update line + dots + gather tooltip rows.
      const rows = [];
      let cursorX = null;
      series.forEach((s, si) => {
        const i = nearestIdx(s.points, targetTs);
        const p = s.points[i];
        const cx = sx(p[0]);
        const cy = sy(p[1]);
        const dot = dots[si];
        if (dot) {
          dot.setAttribute('cx', cx.toFixed(1));
          dot.setAttribute('cy', cy.toFixed(1));
          dot.setAttribute('opacity', '1');
        }
        if (cursorX == null) cursorX = cx;
        const val = allPct ? p[1].toFixed(1) + '%'
                  : (opts.unitFmt ? opts.unitFmt(p[1]) : p[1].toFixed(2));
        rows.push({ name: s.name, color: s.color, val });
      });
      if (cursorX != null) {
        line.setAttribute('x1', cursorX.toFixed(1));
        line.setAttribute('x2', cursorX.toFixed(1));
        line.setAttribute('opacity', '1');
      }
      // Detect if hovering near a restart marker cluster.
      const cursorTs = xMin + t * (xMax - xMin);
      const nearMarker = (markers || []).find(m => Math.abs(cursorTs - (m.min + m.max) / 2) < (xMax - xMin) * 0.02);

      const timeStr = new Date(cursorTs * 1000).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      const rowsHtml = rows.map(r => `
        <div class="t-row">
          <span class="t-dot" style="background:${r.color}"></span>
          <span class="t-lbl">${esc(r.name)}</span>
          <span class="t-val">${r.val}</span>
        </div>`).join('');
      const markerHtml = nearMarker
        ? `<div class="t-markers">⚠ ${nearMarker.count} pod restart · ${nearMarker.pods.slice(0,3).map(p => (p.pod || '').split('-').slice(-1)[0]).join(', ')}${nearMarker.pods.length > 3 ? '…' : ''}</div>`
        : '';
      tip.innerHTML = `<div class="t-time">${timeStr}</div>${rowsHtml}${markerHtml}`;

      // Position tip.
      const slotRect = slot.getBoundingClientRect();
      const px2 = ev.clientX - slotRect.left;
      const py2 = ev.clientY - slotRect.top;
      const tipW = tip.offsetWidth || 180;
      const tipH = tip.offsetHeight || 60;
      let tx = px2, ty = py2 - 6;
      tx = Math.max(tipW / 2 + 4, Math.min(slotRect.width - tipW / 2 - 4, tx));
      if (py2 - tipH - 12 < 0) ty = py2 + tipH + 18;
      tip.style.left = tx + 'px';
      tip.style.top  = ty + 'px';
      slot.classList.add('cx-on');
    });
    overlay.addEventListener('mouseleave', () => {
      slot.classList.remove('cx-on');
      if (line) line.setAttribute('opacity', '0');
      dots.forEach(d => d.setAttribute('opacity', '0'));
    });
  }

  const RA = window.RA = {
    range: '1h',
    // Absolute range in unix seconds — null when using preset shortcut.
    customStart: null,
    customEnd:   null,
    _lastData: null,

    setRange(range) {
      this.range = range;
      this.customStart = null;
      this.customEnd   = null;
      document.querySelectorAll('.ra-range button').forEach(b => {
        if (b.dataset.custom === '1') { b.classList.remove('on'); b.textContent = 'Custom…'; }
        else b.classList.toggle('on', b.dataset.range === range);
      });
    },

    setCustomRange(startSec, endSec) {
      if (!startSec || !endSec || endSec <= startSec) return;
      this.customStart = startSec;
      this.customEnd   = endSec;
      this.range = 'custom';
      const fmt = (t) => new Date(t * 1000).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      document.querySelectorAll('.ra-range button').forEach(b => {
        if (b.dataset.custom === '1') { b.classList.add('on'); b.textContent = fmt(startSec) + ' → ' + fmt(endSec); }
        else b.classList.remove('on');
      });
    },

    async analyze() {
      const service = $('ra-input').value.trim();
      if (!service || !/^[a-z0-9._-]+$/i.test(service)) {
        $('ra-results').innerHTML = `<div class="ra-empty" style="color:var(--hot)">ชื่อ service ไม่ถูกต้อง (letters / digits / . _ - เท่านั้น)</div>`;
        return;
      }
      // Reflect service + range in URL so the analysis is shareable/bookmarkable.
      const _rp = new URLSearchParams({ service });
      if (this.range && this.range !== 'custom') _rp.set('range', this.range);
      history.replaceState(null, '', '?' + _rp.toString());
      $('ra-go').disabled = true;
      $('ra-results').innerHTML = this._skeleton();
      const opts = (this.customStart && this.customEnd)
        ? { start: this.customStart, end: this.customEnd }
        : { range: this.range };
      try {
        const res = await API.restartAnalyzer.analyze(service, opts);
        if (!res?.ok || !res?.data?.data) throw new Error(res?.data?.message || 'load failed');
        this._render(res.data.data);
      } catch (e) {
        $('ra-results').innerHTML = `<div class="ra-empty" style="color:var(--hot)">โหลดไม่สำเร็จ · ${esc(e.message || e)}</div>`;
      } finally {
        $('ra-go').disabled = false;
      }
    },

    // ── Custom range picker ─────────────────────────────
    openPicker() {
      const from = $('ra-picker-from');
      const to   = $('ra-picker-to');
      $('ra-picker-err').textContent = '';
      let s, e;
      if (this.customStart && this.customEnd) { s = this.customStart; e = this.customEnd; }
      else {
        e = Math.floor(Date.now() / 1000);
        s = e - ({ '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 }[this.range] || 3600);
      }
      const toInput = (u) => {
        const d = new Date(u * 1000), pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      from.value = toInput(s); to.value = toInput(e);
      $('ra-picker').classList.add('on');
      setTimeout(() => from.focus(), 30);
    },
    closePicker() { $('ra-picker').classList.remove('on'); },
    _pickerPreset(kind) {
      const now = new Date();
      const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
      let s, e;
      if      (kind === 'today')     { s = midnight;                          e = now; }
      else if (kind === 'yesterday') { e = midnight; s = new Date(midnight); s.setDate(s.getDate() - 1); }
      else if (kind === 'last3d')    { e = now; s = new Date(e - 3  * 86400e3); }
      else if (kind === 'last7d')    { e = now; s = new Date(e - 7  * 86400e3); }
      else if (kind === 'last30d')   { e = now; s = new Date(e - 30 * 86400e3); }
      else return;
      const toInput = (d) => { const pad=(n)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
      $('ra-picker-from').value = toInput(s);
      $('ra-picker-to').value   = toInput(e);
      $('ra-picker-err').textContent = '';
    },
    applyPicker() {
      const err = $('ra-picker-err');
      const parse = (str) => str ? Math.floor(new Date(str).getTime() / 1000) : null;
      const s = parse($('ra-picker-from').value);
      const e = parse($('ra-picker-to').value);
      if (!s || !e)         { err.textContent = 'กรอกทั้งจากและถึง'; return; }
      if (e <= s)           { err.textContent = 'ถึง ต้องอยู่หลัง จาก'; return; }
      const span = (e - s) / 60;
      if (span < 5)         { err.textContent = 'ช่วงต้อง ≥ 5 นาที'; return; }
      if (span > 30 * 1440) { err.textContent = 'ช่วงต้อง ≤ 30 วัน'; return; }
      this.closePicker();
      this.setCustomRange(s, e);
      this.analyze();
    },

    // ── Docs modal ─────────────────────────────────────
    openDocs() {
      const body = $('ra-docs-body');
      if (!body._rendered) { body.innerHTML = this._buildDocsHtml(); body._rendered = true; }
      $('ra-docs').classList.add('on');
      document.body.style.overflow = 'hidden';
    },
    closeDocs() {
      $('ra-docs').classList.remove('on');
      document.body.style.overflow = '';
    },
    async _copyDocsQuery(btn, expr) {
      try {
        await navigator.clipboard.writeText(expr);
        btn.classList.add('copied');
        const svg = btn.querySelector('svg');
        const orig = svg.innerHTML;
        svg.innerHTML = '<path d="M20 6 9 17l-5-5"/>';
        setTimeout(() => { btn.classList.remove('copied'); svg.innerHTML = orig; }, 1400);
      } catch (_) { /* clipboard denied */ }
    },
    _buildDocsHtml() {
      // Sections keyed to what's shown on the page. src='kube' (kube-state-
      // metrics/cAdvisor) or 'jvm' (Micrometer via jvmDsUid).
      const sections = [
        {
          title: 'สรุปสิ่งที่เครื่องมือทำ (Verdict logic v4)',
          desc: 'ระบบทำอะไรบ้าง · จับสัญญาณอะไร · ให้คะแนนยังไง · ตัดสิน verdict ตามลำดับความน่าจะเป็นอย่างไร',
          metrics: [
            { lbl: '10 phase ที่ตรวจ (ทุกรอบ)', src: 'kube',
              desc: '<strong>เก็บหลักฐาน 25+ signal ขนานกัน</strong> ในคำขอเดียว (curl_multi) แล้ววิเคราะห์ครบทุกด้าน:<br>' +
                    '1) มี restart มั้ย · 2) memory เต็ม/failcnt · 3) CPU throttle · 4) app crash exit · 5) network err/drop · ' +
                    '6) K8s waiting state · 7) coordinated timing · 8) node event · 9) downstream 5xx · 10) app self 5xx + JVM heap/thread/GC · ' +
                    '11) hot pod (pod ตัวเดียวครองครองการ restart) · 12) HPA scale event · 13) disk pressure · 14) uptime-before-death · 15) fresh nodes',
              q: '# 25+ queries ยิงขนานกัน — ดู 10 phase ถัดไปสำหรับ PromQL แต่ละตัว' },
            { lbl: 'Verdict priority (v4)', src: 'kube',
              desc: '<strong>เรียงจากเจาะจงที่สุด → ทั่วไปที่สุด</strong>. หยุดที่เงื่อนไขแรกที่ตรง — ไม่ได้ให้คะแนน อยู่นอกเหนือ candidates:<br>' +
                    '1. <code>oom</code> — OOMKilled ตรงๆ ≥ 1 pod<br>' +
                    '2. <code>app-crash</code> — CrashLoopBackOff (fleet-wide)<br>' +
                    '3. <code>app-crash</code> — exit code Error ≥ Completed<br>' +
                    '4. <code>hot-pod</code> + <strong>self-5xx ≥ 0.5/s</strong><br>' +
                    '5. <code>hot-pod</code> — pod เดียวครอง ≥ 50% ของ restart<br>' +
                    '6. <code>internal-overload</code> — self-5xx ≥ 1/s + failcnt ≥ 100k<br>' +
                    '7. <code>internal-overload</code> — self-5xx ≥ 1/s<br>' +
                    '8. <code>downstream-failure</code> — downstream 5xx ≥ 1/s + coordinated<br>' +
                    '9. <code>traffic-spike</code> — HPA scale + overload signal<br>' +
                    '10. <code>external-sigterm</code> — coordinated + graceful<br>' +
                    '11. <code>individual-restart</code> — fallback',
              q: '# ดู source: api/restart-analyzer/index.php บล็อค "// สรุปผลรวม"' },
            { lbl: 'Candidate scoring (ให้คะแนน 7 สมมติฐาน 0-100)', src: 'kube',
              desc: '<strong>Sort desc → return top-5</strong>. Signal ที่ boost คะแนนพร้อมกันหลายอันจะดันสมมติฐานที่รวมสัญญาณให้ขึ้นอันดับ:<br>' +
                    '• <strong>oom</strong>: OOMKilled=95 · failcnt≥100k=75 · failcnt≥10k=55 · memPeak≥95%=60<br>' +
                    '• <strong>hot-pod</strong>: dominant pod ≥5 restarts + ≥50% share=70 (≥10 restarts=85) · +10 ถ้า CrashLoopBackOff · +8 ถ้า self-5xx<br>' +
                    '• <strong>internal-overload</strong>: self-5xx≥1/s=78 · +10 ถ้า failcnt≥100k · +8 ถ้า CPU≥85% · +8 ถ้า HPA scale<br>' +
                    '• <strong>downstream-failure</strong>: downstream 5xx≥5/s=85 · ≥1/s=60 · +10 ถ้า Completed + downstream>0<br>' +
                    '• <strong>external-sigterm</strong>: Completed + coord ≤120s=70 · +15 no-pressure · +10 no-downstream · +5 mixed-nodes<br>' +
                    '• <strong>node-event</strong>: fresh-nodes hosting us > 0 = 70 · restart clustered=45 · mixed nodes → 5 (ตัดออก)<br>' +
                    '• <strong>cpu-starvation</strong>: throttle ≥10%=75 · ≥5%=45 · CPU peak ≥95%=30<br>' +
                    '• <strong>traffic-spike</strong>: HPA scale=40 · +25 self-5xx · +15 CPU≥85% · +10 failcnt≥100k',
              q: '# api/restart-analyzer/index.php → "// สมมติฐาน:" blocks' },
            { lbl: 'Evidence bundle (v4 addition)', src: 'kube',
              desc: '<strong>ทุก stat ที่แสดงบนหน้า</strong> ระบบเก็บ raw PromQL + computed value + sample rows ไว้ในตัวเดียว. เปิดการ์ด "ดูหลักฐานทั้งหมด" ใต้ verdict banner เพื่อ verify ทุกเลข · หรือคลิก "ดูหลักฐาน" ใต้ cascade step แต่ละข้อเพื่อดูเฉพาะที่ใช้ตัดสินข้อนั้น',
              q: '# ดู data.evidence ใน response — key = restartCount, memPeak, memFailcnt, cpuPeak, hotPod, selfErr, downstreamErr, hpa, nodes, coord, network, jvm' },
          ],
        },
        {
          title: 'Phase 1 · Restart trigger',
          desc: 'ตรวจจับว่า restart เกิดขึ้นเมื่อไหร่ กี่ pod และ exit reason อะไร',
          metrics: [
            { lbl: 'Restart count (total)', src: 'kube',
              desc: '<strong>รวมทุก pod</strong> ของ service ในช่วงเวลาที่เลือก',
              q: 'sum(increase(kube_pod_container_status_restarts_total{\n  pod=~"<svc>.*"\n}[<range>]))' },
            { lbl: 'Per-pod restart list', src: 'kube',
              desc: 'ระบุว่า pod ไหน restart กี่ครั้ง — filter > 0 เพื่อโชว์เฉพาะที่มี event',
              q: 'sum by (pod, namespace) (increase(\n  kube_pod_container_status_restarts_total{pod=~"<svc>.*"}[<range>]\n)) > 0' },
            { lbl: 'Last-terminated reason', src: 'kube',
              desc: 'reason ที่ kubelet report: <code>OOMKilled</code>, <code>Error</code>, <code>Completed</code>',
              q: 'sum by (pod, reason) (\n  kube_pod_container_status_last_terminated_reason{pod=~"<svc>.*"} > 0\n)' },
            { lbl: 'Container start time (per pod)', src: 'kube',
              desc: 'unix timestamp ที่ container ล่าสุดของ pod เริ่ม — ใช้จับ timing coordination',
              q: 'container_start_time_seconds{\n  pod=~"<svc>.*",container!="POD",container!=""\n}' },
          ],
        },
        {
          title: 'Phase 2 · Memory pressure',
          desc: 'เช็ค OOM / peak memory / kernel-level allocation failures',
          metrics: [
            { lbl: 'Peak memory per pod', src: 'kube',
              desc: 'max ของ working_set ต่อ pod ในช่วงเวลาที่เลือก',
              q: 'max(max_over_time(container_memory_working_set_bytes{\n  pod=~"<svc>.*",container!="POD"\n}[<range>])) by (pod)' },
            { lbl: 'Memory limit per pod', src: 'kube',
              desc: 'ตัวหารในการคำนวณ % ใช้ในการเทียบว่าใกล้ OOM มั้ย',
              q: 'max(kube_pod_container_resource_limits{\n  pod=~"<svc>.*",resource="memory"\n}) by (pod)' },
            { lbl: 'Memory allocation failures (failcnt)', src: 'kube',
              desc: 'kernel counter — เพิ่มขึ้นตอน pod เกือบจะ OOM (ใน kernel รุ่นที่รองรับ). failcnt > 0 = warning',
              q: 'sum(increase(container_memory_failures_total{\n  pod=~"<svc>.*",container!="POD"\n}[<range>]))' },
          ],
        },
        {
          title: 'Phase 3 · CPU throttling',
          desc: 'CPU limit ไม่พอ → kernel throttle → app ตอบ liveness ไม่ทัน → restart',
          metrics: [
            { lbl: 'CPU throttled seconds total', src: 'kube',
              desc: 'จำนวน CPU-second ที่โดน throttle (ทั้งช่วง)',
              q: 'sum(increase(container_cpu_cfs_throttled_seconds_total{\n  pod=~"<svc>.*",container!="POD"\n}[<range>]))' },
            { lbl: 'CPU throttle %', src: 'kube',
              desc: '% ของ CFS periods ที่โดน throttle — > 5% = pod ถูก starve บ่อย',
              q: 'sum(increase(container_cpu_cfs_throttled_periods_total{...}[<range>]))\n/\nsum(increase(container_cpu_cfs_periods_total{...}[<range>])) * 100' },
            { lbl: 'CPU peak % of limit', src: 'kube',
              desc: 'max ของ rate CPU ÷ limit — โชว์ว่า pod ใช้ CPU สูงสุดกี่ % ของ limit',
              q: 'max(max_over_time(rate(container_cpu_usage_seconds_total{...}[2m])[<range>:2m]))\n/ on(pod) group_left max(kube_pod_container_resource_limits{...}) * 100' },
          ],
        },
        {
          title: 'Phase 4 · Network health',
          desc: 'packet drops / TX-RX errors — บอกว่า NIC / CNI / VPC มีปัญหา',
          metrics: [
            { lbl: 'RX / TX errors', src: 'kube',
              desc: '2 counters รวมกัน — > 0 = สงสัยได้',
              q: 'sum(increase(container_network_receive_errors_total{pod=~"<svc>.*"}[<range>]))\nsum(increase(container_network_transmit_errors_total{pod=~"<svc>.*"}[<range>]))' },
            { lbl: 'RX / TX packet drops', src: 'kube',
              desc: 'noise เล็กน้อย (< 1000) เป็นเรื่องปกติ — > 1000 = network stressed',
              q: 'sum(increase(container_network_receive_packets_dropped_total{...}[<range>]))' },
          ],
        },
        {
          title: 'Phase 5 · K8s waiting reasons',
          desc: 'CrashLoopBackOff / ImagePullBackOff / ContainerCreating stuck',
          metrics: [
            { lbl: 'Waiting reason per pod', src: 'kube',
              desc: '> 0 = pod อยู่ใน waiting state. CrashLoopBackOff = crash ซ้ำๆ, ImagePullBackOff = ดึง image ไม่ได้',
              q: 'sum by (pod, reason) (\n  kube_pod_container_status_waiting_reason{pod=~"<svc>.*"} > 0\n)' },
          ],
        },
        {
          title: 'Phase 6 · Downstream health (Spring Boot)',
          desc: 'ถ้า downstream 5xx spike ก่อน restart → probability ว่าเป็น cascade failure สูง',
          metrics: [
            { lbl: 'Downstream 5xx rate (snake_case)', src: 'jvm',
              desc: 'สำหรับ Spring Boot ≥ 2.6 (label = client_name)',
              q: 'topk(6, sum by (client_name, status) (rate(\n  http_client_requests_seconds_count{app_name="<svc>",status=~"5.."}[<range>]\n)) > 0)' },
            { lbl: 'Downstream 5xx rate (camelCase)', src: 'jvm',
              desc: 'สำหรับ Spring Boot ≤ 2.5 (label = clientName) — merge กับตัวบน',
              q: 'topk(6, sum by (clientName, status) (rate(\n  http_client_requests_seconds_count{app_name="<svc>",status=~"5.."}[<range>]\n)) > 0)' },
            { lbl: 'Self-served 5xx', src: 'jvm',
              desc: 'service เองส่ง 5xx ให้ caller — ทำให้ caller\'s liveness fail ด้วย',
              q: 'topk(6, sum by (uri, status) (rate(\n  http_server_requests_seconds_count{app_name="<svc>",status=~"5.."}[<range>]\n)) > 0)' },
          ],
        },
        {
          title: 'Phase 7 · Node placement',
          desc: 'restarted-pods vs sibling non-restarted pods ที่อยู่ node เดียวกัน = ไม่ใช่ node event',
          metrics: [
            { lbl: 'Pod → node mapping', src: 'kube',
              desc: 'ใช้จับว่า node ไหน host pod ตัวไหน',
              q: 'kube_pod_info{pod=~"<svc>.*"}' },
            { lbl: 'Fresh node age', src: 'kube',
              desc: 'node ที่เพิ่งสร้าง (< ช่วงเวลาที่เลือก) → น่าจะโดน karpenter consolidation',
              q: 'min by (node) (time() - kube_node_created{})' },
          ],
        },
        {
          title: 'Phase 8 · HPA / Deployment scale',
          desc: 'ตรวจว่าระหว่างช่วงนี้ deployment scale-up/down มั้ย — scale-down ทำให้ pod ถูก drain',
          metrics: [
            { lbl: 'Deployment replica min / max ในช่วง', src: 'kube',
              desc: 'ถ้า max − min ≥ 2 → มี scale event ในช่วงนี้',
              q: 'min(min_over_time(kube_deployment_status_replicas{deployment=~"<svc>.*"}[<range>]))\nmax(max_over_time(kube_deployment_status_replicas{deployment=~"<svc>.*"}[<range>]))' },
          ],
        },
        {
          title: 'Phase 9 · Post-restart recovery',
          desc: 'หลัง restart pod กลับมา Ready ครบมั้ย? — บอกว่า incident อยู่หรือหายแล้ว',
          metrics: [
            { lbl: 'Ready pods (right now)', src: 'kube',
              desc: 'pod ที่ผ่าน readinessProbe ทั้งหมด',
              q: 'sum(kube_pod_status_ready{pod=~"<svc>.*",condition="true"} == 1)' },
            { lbl: 'Total Running pods', src: 'kube',
              desc: 'หาร ready ÷ total = % healthy',
              q: 'sum(kube_pod_status_phase{pod=~"<svc>.*",phase="Running"})' },
          ],
        },
        {
          title: 'Phase 10 · Uptime-before-death + Disk pressure',
          desc: 'อายุ pod ก่อนตาย (สั้น = crash loop) + disk write pressure',
          metrics: [
            { lbl: 'Disk write bytes/sec', src: 'kube',
              desc: 'สูงมาก (>100 MB/s) → filesystem cache push memory pressure ได้',
              q: 'sum(rate(container_fs_writes_bytes_total{\n  pod=~"<svc>.*",container!="POD"\n}[5m]))' },
            { lbl: 'Pod age (client-side calc)', src: 'kube',
              desc: 'evalTime − kube_pod_start_time = อายุ pod ก่อนตาย',
              q: '<evalTime> - kube_pod_start_time{pod=~"<svc>.*"}' },
          ],
        },
        {
          title: 'Timeline chart · Range queries',
          desc: 'กราฟหลักที่แสดงพร้อม restart markers',
          metrics: [
            { lbl: 'Memory % timeline', src: 'kube',
              desc: 'query_range · step 30-60s · max ข้ามทุก pod ÷ limit × 100',
              q: 'max(container_memory_working_set_bytes{pod=~"<svc>.*"}) by ()\n/ on() group_left max(kube_pod_container_resource_limits{pod=~"<svc>.*",resource="memory"}) * 100' },
            { lbl: 'CPU % timeline', src: 'kube',
              desc: 'query_range · rate CPU ÷ limit × 100',
              q: 'max(rate(container_cpu_usage_seconds_total{pod=~"<svc>.*"}[2m])) by ()\n/ on() group_left max(kube_pod_container_resource_limits{pod=~"<svc>.*",resource="cpu"}) * 100' },
            { lbl: 'Restart rate timeline', src: 'kube',
              desc: 'rate × 60 = restarts per minute (สำหรับ marker บนกราฟ)',
              q: 'sum(rate(kube_pod_container_status_restarts_total{pod=~"<svc>.*"}[5m])) * 60' },
          ],
        },
        {
          title: 'Per-pod detail drill',
          desc: 'เจาะกราฟ 40 นาที ก่อน–หลัง pod ตัวเดียวตาย',
          metrics: [
            { lbl: 'Per-pod memory time-series', src: 'kube',
              desc: 'endpoint: <code>/api/restart-analyzer/pod-detail.php</code> · centered on restartedAt · window ±10 min',
              q: 'max(container_memory_working_set_bytes{pod="<pod>",container!="POD"})' },
            { lbl: 'Per-pod CPU time-series', src: 'kube',
              desc: 'rate 1m · แสดงเป็น % ของ limit',
              q: 'sum(rate(container_cpu_usage_seconds_total{pod="<pod>",container!="POD"}[1m]))' },
          ],
        },
      ];
      const dsBadge = (src) => src === 'jvm'
        ? `<span class="ra-docs-metric-src jvm">jvmDsUid (Thanos OnPrem)</span>`
        : `<span class="ra-docs-metric-src kube">dsUid (Thanos main)</span>`;
      const renderMetric = (m) => `
        <div class="ra-docs-metric">
          <div class="ra-docs-metric-head">
            <span class="ra-docs-metric-lbl">${esc(m.lbl)}</span>
            ${dsBadge(m.src)}
          </div>
          <div class="ra-docs-metric-desc">${m.desc}</div>
          <div class="ra-docs-query">
            <button type="button" class="ra-docs-copy" title="Copy query"
              onclick="RA._copyDocsQuery(this, ${JSON.stringify(m.q).replace(/"/g,'&quot;')})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            ${esc(m.q)}
          </div>
        </div>`;
      return `
        <div style="padding:10px 12px;background:var(--ra-bg-subtle);border-radius:8px;font-size:11.5px;color:var(--text-muted);line-height:1.6;margin-bottom:16px">
          <strong style="color:var(--text)">Data flow:</strong> Browser →
          <code>/api/restart-analyzer/index.php</code> → curl_multi (25+ queries ขนานกัน) → Grafana proxy → Thanos.
          Response cache 60s ต่อ (service, range). Custom range รอบใหม่ ยิงใหม่ทุกครั้ง.
          <br><br>
          <strong style="color:var(--text)">Verdict logic:</strong> เก็บหลักฐาน 10+ signals → ให้คะแนน 0-100 ต่อ hypothesis
          (OOM / App crash / Downstream fail / SIGTERM / Node event / CPU starvation / HPA scale) → sort desc → return top 5.
          <br><br>
          <code>&lt;svc&gt;</code> = ชื่อ service · <code>&lt;range&gt;</code> = PromQL range vector (เช่น <code>1h</code>, <code>21600s</code>)
        </div>
        ${sections.map(s => `
          <div class="ra-docs-section">
            <div class="ra-docs-section-title">${esc(s.title)}</div>
            <div class="ra-docs-section-desc">${esc(s.desc)}</div>
            ${(s.metrics || []).map(renderMetric).join('')}
          </div>`).join('')}`;
    },

    _skeleton() {
      return `<div class="ra-loading">
        <div class="ra-card"><div class="ra-skel" style="height:80px"></div></div>
        <div class="ra-stats">${Array(6).fill('<div class="ra-stat"><div class="ra-skel" style="height:48px"></div></div>').join('')}</div>
        <div class="ra-card"><div class="ra-skel" style="height:240px"></div></div>
        <div class="ra-grid">
          <div class="ra-card"><div class="ra-skel" style="height:400px"></div></div>
          <div class="ra-card"><div class="ra-skel" style="height:400px"></div></div>
        </div>
      </div>`;
    },

    // Verdict icon + labels (Thai) ─────────────────────
    _verdictIcon(v) {
      const icons = {
        'no-restart':          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        'oom':                 '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
        'app-crash':           '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>',
        'hot-pod':             '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
        'internal-overload':   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>',
        'downstream-failure':  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
        'traffic-spike':       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
        'external-sigterm':    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
        'individual-restart':  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
      };
      return icons[v] || icons['no-restart'];
    },
    _verdictLabel(v) {
      return {
        'no-restart':         'ทำงานปกติ · ไม่มี pod restart',
        'oom':                'memory เต็ม (โดนฆ่าเพราะใช้เกินโควต้า)',
        'app-crash':          'app พังเอง (crash ข้างในตัวเอง)',
        'hot-pod':            'pod ตัวเดียวรับภาระเกิน / พังซ้ำๆ',
        'internal-overload':  'app ประมวลผลไม่ทัน (thread pool / DB pool / GC)',
        'downstream-failure': 'ระบบที่เราเรียกใช้พัง แล้วเราตายตาม',
        'traffic-spike':      'traffic ทะลัก HPA ต้อง scale up',
        'external-sigterm':   'มีคน / สคริปต์สั่ง restart',
        'individual-restart': 'pod แต่ละตัว restart แยกกัน (ไม่พร้อมกัน)',
      }[v] || 'สรุปไม่ได้แน่ชัด';
    },

    // Cascade titles — plain Thai. Backend passes ID, this decides Thai
    // wording (backend already uses Thai titles too, this override kept as
    // safety net if backend ever falls back to English).
    _cascadeTitleTh(id, en) {
      return {
        'trigger':         'มีการ restart เกิดขึ้นมั้ย',
        'memory':          'memory ที่ใช้ ถึง limit มั้ย',
        'cpu':             'CPU พอใช้มั้ย ไม่โดนจำกัดใช่มั้ย',
        'crash':           'app crash เองมั้ย',
        'network':         'เน็ตเวิร์กมีปัญหามั้ย',
        'waiting':         'pod ค้างสถานะอะไรมั้ย',
        'coordinated':     'pod ตายพร้อมกันหลายตัวมั้ย',
        'node-event':      'server (node) ที่ pod อยู่ มีปัญหามั้ย',
        'downstream-5xx':  'ระบบที่เราเรียกใช้ ตอบ error กลับมั้ย',
        'self-5xx':        'service ของเราเอง ตอบ error กลับให้คนเรียกใช้มั้ย',
        'jvm':             'ภายในของ app (Java heap / thread / GC)',
      }[id] || en || id;
    },

    _nextSteps(v, d) {
      const ns = d.namespace || 'default';
      const items = {
        'oom': [
          `เพิ่ม memory limit ใน deployment (peak ${d.memPeakPct}% ของ limit${d.memFailcnt ? ' · ' + d.memFailcnt + ' failcnt' : ''})`,
          `หา memory leak: heap dump / <code>jmap -histo:live</code> ตอนก่อน crash`,
          `ดู cache size, connection pool ที่ไม่ evict`,
          `รัน <code>kubectl describe pod &lt;name&gt; -n ${ns}</code> ดู Last State: reason + message`,
        ],
        'app-crash': [
          `ดู application log ใน Elasticsearch / OpenSearch ของ pod ที่ list ด้านล่าง หา stacktrace`,
          `<code>kubectl logs &lt;pod&gt; --previous -n ${ns}</code> ดู log ก่อน crash`,
          `เช็คว่าเพิ่ง deploy version ใหม่มั้ย — rollback ถ้าใช่`,
          `ดู downstream ที่อาจดาวน์แล้วทำให้ app throw fatal`,
        ],
        'downstream-failure': [
          `**สาเหตุจริงอยู่ที่ downstream ไม่ใช่ service นี้** — เข้าไปดู service ที่ list ใน "Downstream 5xx" ด้านล่าง`,
          `เช็ค downstream health (uptime, DB status, network path)`,
          `เพิ่ม circuit breaker / timeout ใน HTTP client เพื่อไม่ให้ probe fail cascade`,
          `พิจารณา relax liveness probe threshold ให้ทนต่อ downstream hiccup ได้`,
        ],
        'hot-pod': [
          `**kill pod ที่มีปัญหาทิ้งเลย** — <code>kubectl delete pod ${d.hotPod || '<pod-name>'} -n ${ns}</code> เพื่อให้ Kubernetes สร้างใหม่`,
          `ถ้าเกิดซ้ำที่ pod ใหม่ → rollout restart deployment ทั้งหมด: <code>kubectl rollout restart deployment/${d.service} -n ${ns}</code>`,
          `ดู log ของ pod ที่ตายซ้ำๆ: <code>kubectl logs ${d.hotPod || '<pod>'} -n ${ns} --previous</code>`,
          `เช็ค thread dump / connection pool status ตอน pod ยังใช้งานได้ (จะได้เห็น deadlock / stuck request)`,
          `ตรวจ pattern: มี request ใดที่ยิงเข้ามาซ้ำๆ ที่ทำให้ pod นี้ stuck (sticky session? shard routing?)`,
        ],
        'internal-overload': [
          `เปิด application log ดู <code>SocketTimeoutException</code>, <code>connection pool exhausted</code>, <code>ThreadPoolTaskExecutor</code> rejected`,
          `ดู DB connection pool config (HikariCP maxPoolSize) — พอมั้ยกับ concurrent request?`,
          `ดู thread pool ของ Tomcat / undertow (<code>server.tomcat.threads.max</code>) — pool ที่ default 200 อาจไม่พอ`,
          `เช็ค GC log — full GC pause นานมั้ย? heap ต้องเพิ่มมั้ย?`,
          `ถ้ามี <code>self-5xx</code> pattern เดียวกันทุกครั้งที่ traffic spike → คำนวณ capacity แล้วเพิ่ม replica หรือปรับ HPA scale-up policy ให้เร็วขึ้น`,
        ],
        'traffic-spike': [
          `ดู traffic pattern จาก Service Performance page — เกิด spike จริงมั้ย? มาจากไหน?`,
          `ตรวจ HPA config: <code>--horizontal-pod-autoscaler-sync-period</code> (default 15s) — scale up ช้าเกินมั้ย?`,
          `เพิ่ม min replicas ให้ทนต่อ baseline traffic ที่สูงขึ้น`,
          `พิจารณา pre-scale ก่อนช่วง peak (ถ้ารู้เวลา peak)`,
          `เช็ค pod startup time — ถ้า pod ใหม่ boot ช้า จะ scale up ทันมั้ย?`,
        ],
        'external-sigterm': [
          `<code>kubectl get events -n ${ns} --sort-by='.lastTimestamp' | grep -E "(Killing|Unhealthy|Liveness)"</code> รอบเวลา restart`,
          `ดู EKS audit log หา <code>kubectl exec</code> / <code>delete pod</code> ที่ยิงจาก user / service account`,
          `ตรวจ liveness probe config: threshold ต่ำเกินอาจฟาดหลาย pod พร้อมกันเมื่อ downstream ช้า`,
          `ดู CI/CD tool logs (Jenkins/ArgoCD/Flux) หา job ที่ trigger restart`,
        ],
        'individual-restart': [
          `ตรวจว่า app มี self-restart logic (memory checkpoint, connection age, batch cycle)`,
          `ดู <code>process.exit(0)</code> / <code>System.exit(0)</code> ใน source code`,
          `ถ้าเป็น Node.js: PM2 auto-restart on memory threshold?`,
        ],
        'no-restart': [
          `ไม่มี restart ในช่วงนี้ — ลองขยายช่วงเวลาเป็น 6 ชม. / 24 ชม. / 7 วัน`,
          `เช็ค alert อ้างชื่อ service ตรงกันมั้ย (deployment name อาจต่างจาก pod prefix)`,
        ],
      };
      const list = items[v] || [];
      if (!list.length) return '';
      return `<div class="ra-next">
        <div class="ra-next-title">ต่อไปควรทำอะไร</div>
        <ul>${list.map(x => '<li>' + richText(x) + '</li>').join('')}</ul>
      </div>`;
    },

    // Cascade render — vertical evidence timeline. Each step now includes
    // a "▾ ดูหลักฐาน" toggle when the backend attached evidenceRefs.
    _cascadeHtml(cascade, evidence) {
      if (!cascade?.length) return '';
      const badgeChar = (v) => ({ pass: '✓', clear: '✓', warn: '!', triggered: '!', fail: '✕', inconclusive: '?' }[v] || '?');
      const verdictTh = (v) => ({ pass: 'ปกติดี', clear: 'ปกติดี', warn: 'ต้องดูให้ดี', triggered: 'พบสัญญาณ', fail: 'มีปัญหา', inconclusive: 'ข้อมูลไม่พอ' }[v] || v);
      return `<div class="ra-cascade">
        ${cascade.map((s, i) => {
          const refs = (s.evidenceRefs || []).filter(k => evidence && evidence[k]);
          const evHtml = refs.length ? `
            <details class="ra-cascade-ev">
              <summary>ดูหลักฐานที่ใช้ตัดสิน (${refs.length})</summary>
              <div class="ra-ev-list">${refs.map(k => this._evidenceItemHtml(k, evidence[k])).join('')}</div>
            </details>` : '';
          return `
            <div class="ra-cascade-item">
              <div class="ra-cascade-badge ${s.verdict}">${badgeChar(s.verdict)}</div>
              <div>
                <div class="ra-cascade-title">
                  <span>${i+1}. ${esc(this._cascadeTitleTh(s.id, s.title))}</span>
                  <span class="verdict-tag ${s.verdict}">${verdictTh(s.verdict)}</span>
                </div>
                <div class="ra-cascade-narrative">${richText(s.narrative)}</div>
                ${s.evidence ? `<div class="ra-cascade-evidence">${esc(s.evidence)}</div>` : ''}
                ${evHtml}
              </div>
            </div>`;
        }).join('')}
      </div>`;
    },

    // Render one evidence entry (metric block): label + computed value +
    // exact PromQL + sample table. Shared between the cascade toggle and
    // the top-level "หลักฐานทั้งหมด" card.
    _evidenceItemHtml(key, ev) {
      if (!ev) return '';
      const samples = ev.samples || [];
      let tableHtml = '';
      if (samples.length) {
        // Union of all sample keys → columns.
        const cols = [...new Set(samples.flatMap(s => Object.keys(s)))];
        tableHtml = `
          <span class="ra-ev-samples">ตัวอย่างข้อมูลจริงที่ดึงมา (${samples.length} row)</span>
          <table class="ra-ev-sample-tbl">
            <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${samples.slice(0, 20).map(s => '<tr>' + cols.map(c => `<td title="${esc(String(s[c] ?? ''))}">${esc(String(s[c] ?? '—'))}</td>`).join('') + '</tr>').join('')}</tbody>
          </table>
          ${samples.length > 20 ? `<div style="margin-top:6px;font-size:10.5px;color:var(--ra-text-soft)">+ ${samples.length - 20} row เพิ่มเติม</div>` : ''}`;
      }
      return `
        <div class="ra-ev-item" data-ev-key="${esc(key)}">
          <div class="ra-ev-head">
            <span class="ra-ev-label">${esc(ev.label || key)}</span>
            <span class="ra-ev-value">${esc(ev.value ?? '—')}</span>
            <span class="ra-ev-unit">${esc(ev.unit || '')}</span>
          </div>
          ${ev.promql ? `
            <div class="ra-ev-query">
              <span class="lbl">PromQL ที่ใช้</span>
              <button type="button" class="ra-ev-copy" title="Copy query"
                onclick="RA._copyDocsQuery(this, ${JSON.stringify(ev.promql).replace(/"/g,'&quot;')})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              ${esc(ev.promql)}
            </div>` : ''}
          ${tableHtml}
        </div>`;
    },

    // Top-level "หลักฐานทั้งหมด" card — collapsible; shows every metric.
    _evidenceAllHtml(evidence) {
      if (!evidence || !Object.keys(evidence).length) return '';
      const keys = Object.keys(evidence);
      return `
        <details class="ra-evidence-card">
          <summary>
            <span>ดูหลักฐานทั้งหมด · raw data ที่ใช้ในการวิเคราะห์</span>
            <span class="hint">${keys.length} metric · คลิกเพื่อกาง · แต่ละอันมี PromQL + ค่าจริง + samples</span>
          </summary>
          <div class="ra-ev-list">
            ${keys.map(k => this._evidenceItemHtml(k, evidence[k])).join('')}
          </div>
        </details>`;
    },

    _downstreamHtml(ds) {
      if (!ds || !ds.length) {
        return `<div style="padding:20px;text-align:center;color:var(--ra-text-soft);font-size:12px">ไม่พบ downstream 5xx — dependencies ปกติ หรือ service นี้ไม่มี HTTP client instrumentation</div>`;
      }
      const shortName = (fqdn) => (fqdn || '').split('.')[0] || fqdn;
      return ds.map(row => `
        <div class="ra-ds-row">
          <div>
            <div class="ra-ds-target" title="${esc(row.target)}">${esc(shortName(row.target))}</div>
            <div class="ra-ds-statuses">${(row.statusBreakdown || []).map(s => `<span class="ra-ds-pill">${esc(s.status)} × ${s.rate.toFixed(2)}/s</span>`).join('')}</div>
          </div>
          <div class="ra-ds-rate">${row.rate5xx.toFixed(2)}<span style="color:var(--ra-text-soft);font-size:10px;font-weight:500"> /s</span></div>
          <div class="ra-ds-lat">${row.latencyPeakMs != null ? row.latencyPeakMs + 'ms' : '—'}</div>
        </div>`).join('');
    },

    // ── Main render ─────────────────────────────────────
    _render(d) {
      this._lastData = d;
      const verdict = d.finalVerdict || 'no-restart';
      const affected = d.affectedPods || [];

      const memCls = d.memPeakPct >= 90 ? 'hot' : d.memPeakPct >= 75 ? 'warn' : 'ok';
      const cpuCls = d.cpuThrottlePct >= 5 ? 'warn' : (d.cpuPeakPct >= 85 ? 'warn' : 'ok');
      const netTotal = (d.netTotals?.rxErr || 0) + (d.netTotals?.txErr || 0) + (d.netTotals?.rxDrop || 0) + (d.netTotals?.txDrop || 0);
      const netCls = netTotal === 0 ? 'ok' : (netTotal < 1000 ? 'warn' : 'hot');
      const coordCls = d.coordSpanSec != null && d.coordSpanSec <= 120 ? 'warn' : '';
      const coordLbl = d.coordSpanSec == null ? '—' : (d.coordSpanSec <= 60 ? d.coordSpanSec + 'วิ' : Math.round(d.coordSpanSec / 60) + 'นาที');
      const dsCls = d.downstreamErrRate > 0 ? 'hot' : 'ok';

      const statsHtml = `<div class="ra-stats">
        <div class="ra-stat"><div class="lbl">Restart รวม</div><div class="val ${affected.length ? 'warn' : 'ok'}">${d.restartCount || 0}</div><div class="sub">${affected.length} pod</div></div>
        <div class="ra-stat"><div class="lbl">Peak memory</div><div class="val ${memCls}">${d.memPeakPct}%</div><div class="sub">${d.memFailcnt || 0} failcnt</div></div>
        <div class="ra-stat"><div class="lbl">CPU throttle</div><div class="val ${cpuCls}">${d.cpuThrottlePct}%</div><div class="sub">peak ${d.cpuPeakPct}%</div></div>
        <div class="ra-stat"><div class="lbl">Restart ช่วง</div><div class="val ${coordCls}">${coordLbl}</div><div class="sub">เริ่ม ${fmtTime(d.coordFirstAt)}</div></div>
        <div class="ra-stat"><div class="lbl">Downstream 5xx</div><div class="val ${dsCls}">${d.downstreamErrRate || 0}<span style="font-size:12px;color:var(--ra-text-soft);font-weight:500">/s</span></div><div class="sub">${(d.downstreamErrors || []).length} ปลายทาง</div></div>
        <div class="ra-stat"><div class="lbl">Network</div><div class="val ${netCls}">${netTotal}</div><div class="sub">err + drops</div></div>
      </div>`;

      const restartEvents = affected.map(p => ({ ts: p.restartedAtUnix, pod: p.pod, count: 1 })).filter(m => m.ts);

      const verdictHtml = `<div class="ra-verdict ${verdict}">
        <div class="ra-verdict-ico">${this._verdictIcon(verdict)}</div>
        <div>
          <div class="ra-verdict-lbl">สรุปผลการตรวจ · ${esc(d.service)}${d.isCustom ? ' · ช่วงเวลาที่กำหนดเอง' : ' · ' + esc(d.range) + ' ล่าสุด'}${d.namespace ? ' · ' + esc(d.namespace) : ''}</div>
          <div class="ra-verdict-title">${this._verdictLabel(verdict)}</div>
          <div class="ra-verdict-sub">${richText(d.summary)}</div>
        </div>
        <div class="ra-verdict-stat">
          <div class="n">${d.restartCount || 0}</div>
          <div class="l">restart รวม</div>
        </div>
      </div>`;

      const podRows = affected.map(p => `
        <div class="ra-pod" onclick="RA.openPodDrill(${JSON.stringify(p.pod).replace(/"/g,'&quot;')}, ${JSON.stringify(p.namespace || '').replace(/"/g,'&quot;')}, ${p.restartedAtUnix || 0}, ${JSON.stringify(p.reason).replace(/"/g,'&quot;')})" title="คลิกเพื่อดูกราฟรายละเอียดก่อน pod ตาย">
          <div>
            <div class="ra-pod-name" title="${esc(p.pod)}">${esc(p.pod)}</div>
            <div class="ra-pod-sub">
              ${p.node ? `<span>${esc(p.node)}</span>` : ''}
              <span class="drill">→ ดูกราฟก่อนตาย</span>
            </div>
          </div>
          <div class="ra-pod-time">${fmtTime(p.restartedAtUnix)}</div>
          <div class="ra-pod-reason ${p.reason}">${esc(p.reason)}</div>
        </div>`).join('') || `<div style="padding:20px;text-align:center;color:var(--ra-text-soft);font-size:12px">ไม่มี pod restart ในช่วงนี้</div>`;

      // "สาเหตุที่น่าจะเป็น" — ranked hypotheses. Ranks translated to plain
      // Thai words (น่าจะเป็นที่สุด / รองลงมา / อาจเป็นได้) so users don't
      // stare at raw score numbers. Only show when we actually have data.
      const likelihoodWord = (i, score) => {
        if (i === 0) return score >= 70 ? 'น่าจะเป็นที่สุด' : 'น่าจะใช่';
        if (i === 1) return 'รองลงมา';
        if (i === 2) return 'อาจเป็นได้';
        return 'เป็นไปได้น้อย';
      };
      const rankLabel = (i) => ['1', '2', '3', '4', '5'][i] || (i + 1);
      const candidatesHtml = (d.candidates && d.candidates.length && affected.length)
        ? `<div class="ra-card">
            <div class="ra-card-title">สาเหตุที่น่าจะเป็น <span class="count">${d.candidates.length} สมมติฐาน</span></div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.5">
              จากหลักฐานที่รวบรวมทั้งหมด ระบบเรียงสมมติฐานตามความเป็นไปได้ให้ดังนี้
            </div>
            <div class="ra-candidates">
              ${d.candidates.map((c, i) => `
                <div class="ra-candidate ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}">
                  <span class="ra-cand-marker">
                    <span class="badge">${rankLabel(i)}</span>
                    ${esc(likelihoodWord(i, c.score))}
                  </span>
                  <div class="ra-cand-body">
                    <div class="ra-cand-title">${esc(c.label)}</div>
                    <div class="ra-cand-reason">${richText(c.reason)}</div>
                    ${c.evidence && c.evidence.length ? `<div class="ra-cand-evidence">${c.evidence.map(e => '<span>' + esc(e) + '</span>').join('')}</div>` : ''}
                  </div>
                  <div class="ra-cand-side">
                    <div class="ra-cand-likelihood">${c.score}/100</div>
                    <div class="ra-cand-bar"><span style="width:${c.score}%"></span></div>
                  </div>
                </div>`).join('')}
            </div>
          </div>` : '';

      // Deep-signal stat tiles.
      const deepStats = affected.length ? `
        <div class="ra-stats">
          <div class="ra-stat"><div class="lbl">Uptime ก่อนตาย</div><div class="val">${d.uptimeStats ? fmtDur(d.uptimeStats.avgSec) : '—'}</div><div class="sub">avg · min ${d.uptimeStats ? fmtDur(d.uptimeStats.minSec) : '—'}</div></div>
          <div class="ra-stat"><div class="lbl">Ready ตอนนี้</div><div class="val ${d.notReadyPods > 0 ? 'warn' : 'ok'}">${d.readyPods}/${d.totalPodsNow}</div><div class="sub">${d.notReadyPods > 0 ? d.notReadyPods + ' not ready' : 'ครบแล้ว'}</div></div>
          <div class="ra-stat"><div class="lbl">Self 5xx</div><div class="val ${d.selfErrRateTotal >= 1 ? 'hot' : d.selfErrRateTotal > 0 ? 'warn' : 'ok'}">${d.selfErrRateTotal || 0}<span style="font-size:11px;color:var(--ra-text-soft);font-weight:500">/s</span></div><div class="sub">${d.selfErrRateTotal > 0 ? 'ตอบ error ให้ caller' : 'ไม่มี'}</div></div>
          <div class="ra-stat"><div class="lbl">HPA scale</div><div class="val ${d.hpaScaleEvent ? 'warn' : ''}">${d.hpaMin}→${d.hpaMax}</div><div class="sub">${d.hpaScaleEvent ? 'มี scale event' : 'ไม่เปลี่ยน'}</div></div>
          <div class="ra-stat"><div class="lbl">Hot pod</div><div class="val ${d.isHotPod ? 'hot' : 'ok'}">${d.isHotPod ? d.hotPodRestarts + '×' : '—'}</div><div class="sub">${d.isHotPod ? Math.round(d.hotPodShare) + '% ของ restart' : 'กระจาย'}</div></div>
          <div class="ra-stat"><div class="lbl">Disk write</div><div class="val ${d.diskPressure ? 'warn' : ''}">${fmtBytes(d.diskWriteBps)}<span style="font-size:11px;color:var(--ra-text-soft);font-weight:500">/s</span></div><div class="sub">${d.diskPressure ? 'สูงผิดปกติ' : 'ปกติ'}</div></div>
        </div>` : '';

      $('ra-results').innerHTML = `
        ${verdictHtml}
        ${this._nextSteps(verdict, d)}
        ${candidatesHtml}
        ${this._evidenceAllHtml(d.evidence)}
        ${statsHtml}
        ${deepStats}
        <div class="ra-card">
          <div class="ra-card-title">Timeline · Memory / CPU / ช่วงเวลาที่ restart <span class="count">ช่วง ${d.isCustom ? 'custom' : d.range}</span></div>
          <div id="ra-tl-slot" class="ra-chart-slot"></div>
          <div class="ra-chart-legend">
            <span class="lg"><span class="dot" style="background:var(--info)"></span>Memory %</span>
            <span class="lg"><span class="dot" style="background:var(--warn)"></span>CPU %</span>
            <span class="lg dashed"><span class="dot"></span>ช่วงเวลา restart</span>
            <span style="font-size:11px;color:var(--ra-text-soft)">· วางเมาส์ที่กราฟเพื่อดูค่าเป๊ะ</span>
          </div>
        </div>
        <div class="ra-grid">
          <div class="ra-card">
            <div class="ra-card-title">ระบบตรวจสอบทีละข้อ · ลำดับหลักฐาน <span class="count">${(d.cascade || []).length} ข้อ</span></div>
            <div style="font-size:11.5px;color:var(--ra-text-soft);margin-bottom:10px">แต่ละข้อคลิก "ดูหลักฐาน" เพื่อดู PromQL + ค่าจริงที่ใช้ตัดสิน</div>
            ${this._cascadeHtml(d.cascade, d.evidence)}
          </div>
          <div>
            <div class="ra-card" style="margin-bottom:12px">
              <div class="ra-card-title">Pod ที่ได้รับผลกระทบ <span class="count">${affected.length}</span></div>
              <div style="font-size:11px;color:var(--ra-text-soft);margin-bottom:6px">คลิกที่แต่ละ pod เพื่อ zoom เข้าไปดูกราฟก่อน pod ตาย (memory / CPU / throttling)</div>
              ${podRows}
            </div>
            <div class="ra-card">
              <div class="ra-card-title">Downstream 5xx surge <span class="count">${(d.downstreamErrors || []).length}</span></div>
              ${this._downstreamHtml(d.downstreamErrors)}
            </div>
            ${d.appMetrics ? `
              <div class="ra-card" style="margin-top:12px">
                <div class="ra-card-title">JVM self-metrics</div>
                <div style="font-size:12.5px; line-height:1.7">
                  <div>Heap usage: <b>${d.appMetrics.heapPct != null ? d.appMetrics.heapPct + '%' : '—'}</b></div>
                  <div>Live threads: <b>${d.appMetrics.liveThreads ?? '—'}</b></div>
                  <div>GC pause รวม (ในช่วง): <b>${d.appMetrics.gcSecondsInWindow ?? '—'}s</b></div>
                </div>
              </div>` : ''}
          </div>
        </div>
        ${d.fromCache ? '<div style="text-align:right;font-size:11px;color:var(--ra-text-soft)">served from 60s cache</div>' : ''}`;

      // Paint the main timeline chart AFTER DOM commit so container width is measured.
      requestAnimationFrame(() => {
        paintChart($('ra-tl-slot'), [
          { name: 'Memory %', color: 'var(--info)', unit: '%', points: d.timeline?.mem || [] },
          { name: 'CPU %',    color: 'var(--warn)', unit: '%', points: d.timeline?.cpu || [] },
        ], restartEvents);
      });
    },

    // ── In-page navigation stack ─────────────────────────────
    // Instead of a slide-in panel, drilling into a pod REPLACES the results
    // area with the pod-detail view and pushes the previous view onto a
    // stack. Back button pops back to the analysis. Keeps user on the same
    // page — better flow for hopping between pods without losing context.
    _navStack: [],

    async openPodDrill(pod, namespace, restartedAt, reason) {
      if (!pod || !restartedAt) return;
      // Snapshot current view (analysis or previous pod-detail) before we
      // push. Storing outerHTML would lose event listeners; we only rely on
      // it as a re-render key + scroll position, so a shallow object is
      // enough — the actual re-render uses cached _lastData.
      this._navStack.push({ kind: 'analysis', scrollY: window.scrollY });

      // Render loading state immediately (feels responsive even before fetch).
      $('ra-results').innerHTML = `
        <div class="ra-nav-view">
          ${this._navHead(pod, `${namespace ? esc(namespace) + ' · ' : ''}restart เมื่อ <b>${fmtTime(restartedAt)}</b> · reason: <b>${esc(reason)}</b>`)}
          <div class="ra-loading">
            <div class="ra-detail-stats">${Array(3).fill('<div class="ra-detail-stat"><div class="ra-skel" style="height:44px"></div></div>').join('')}</div>
            <div class="ra-card"><div class="ra-skel" style="height:280px"></div></div>
          </div>
        </div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });

      try {
        const res = await API.restartAnalyzer.podDetail(pod, namespace, restartedAt, 600);
        if (!res?.ok || !res?.data?.data) throw new Error(res?.data?.message || 'load failed');
        this._renderPodDetail(res.data.data, reason, pod, namespace);
      } catch (e) {
        $('ra-results').innerHTML = `
          <div class="ra-nav-view">
            ${this._navHead(pod, esc(namespace || ''))}
            <div style="padding:40px;text-align:center;color:var(--hot);font-size:12.5px">โหลดไม่สำเร็จ · ${esc(e.message || e)}</div>
          </div>`;
      }
    },

    // Shared nav-header renderer: back button + breadcrumb + main title.
    // Extracted so pod-detail (and future drill screens) all match visually.
    _navHead(main, sub) {
      return `
        <div class="ra-nav-head">
          <button type="button" class="ra-back-btn" onclick="RA.navBack()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <div class="ra-nav-title">
            <div class="ra-nav-crumb">ZOOM · pod detail</div>
            <div class="ra-nav-main" title="${esc(main)}">${esc(main)}</div>
            <div class="ra-nav-sub">${sub}</div>
          </div>
        </div>`;
    },

    // Pop the last view off the stack. For restart-analyzer there's only
    // ever ONE layer (analysis → pod-detail), so back = re-render analysis.
    navBack() {
      const prev = this._navStack.pop();
      if (!prev || !this._lastData) return;
      $('ra-results').innerHTML = '';
      $('ra-results').classList.add('ra-nav-view', 'back');
      this._render(this._lastData);
      // Restore scroll AFTER render commits.
      requestAnimationFrame(() => {
        window.scrollTo({ top: prev.scrollY || 0, behavior: 'auto' });
        setTimeout(() => $('ra-results').classList.remove('ra-nav-view', 'back'), 300);
      });
    },

    // Pod-detail view — same evidence as before, but rendered INTO the
    // results area with a nav-head instead of a slide panel.
    _renderPodDetail(d, reason, pod, namespace) {
      const memPct    = d.memPct || [];
      const cpuPct    = d.cpuPct || [];
      const memBytes  = d.memBytes || [];
      const restartTs = d.restartedAt;
      const nearestBefore = (arr, t) => {
        let last = null;
        for (const [ts, v] of arr) { if (ts <= t) last = { ts, v }; else break; }
        return last;
      };
      const memAtDeath  = nearestBefore(memPct, restartTs);
      const cpuAtDeath  = nearestBefore(cpuPct, restartTs);
      const bytesAtDeath= nearestBefore(memBytes, restartTs);
      const trend = (arr, endTs) => {
        const late  = arr.filter(p => p[0] >= endTs - 60  && p[0] <= endTs).map(p => p[1]);
        const early = arr.filter(p => p[0] >= endTs - 120 && p[0] <  endTs - 60).map(p => p[1]);
        if (!late.length || !early.length) return null;
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        return ((avg(late) - avg(early)) / (avg(early) || 1)) * 100;
      };
      const memTrend = trend(memPct, restartTs);
      const cpuTrend = trend(cpuPct, restartTs);

      const bits = [];
      if (memAtDeath)   bits.push(`memory <b>${memAtDeath.v.toFixed(1)}%</b> (${fmtBytes(bytesAtDeath?.v)})`);
      if (cpuAtDeath)   bits.push(`CPU <b>${cpuAtDeath.v.toFixed(1)}%</b>`);
      if (memTrend != null && Math.abs(memTrend) >= 15) bits.push(`memory ${memTrend > 0 ? '↑' : '↓'} ${Math.abs(memTrend).toFixed(0)}% ในนาทีสุดท้าย`);
      if (cpuTrend != null && Math.abs(cpuTrend) >= 30) bits.push(`CPU ${cpuTrend > 0 ? '↑' : '↓'} ${Math.abs(cpuTrend).toFixed(0)}% ในนาทีสุดท้าย`);
      const storySentence = bits.length
        ? `ตอน pod ตาย: ${bits.join(', ')}. ` + (reason === 'OOMKilled' ? 'ตรงกับ OOMKilled — memory ทะลุ limit จริง' : (memAtDeath?.v >= 90 ? 'memory ใกล้เต็ม — ถ้าไม่ OOM ก็เกือบแล้ว' : 'ทรัพยากรยังไม่ตึง — ต้นเหตุน่าจะอยู่ที่ downstream / signal ภายนอก'))
        : `ไม่มีข้อมูล mem/cpu ในช่วงก่อน pod ตาย (metric อาจไม่ครอบคลุมช่วงนี้)`;

      // Sibling pods list — show OTHER pods that restarted at similar times
      // so user can hop between them via the same page (Level 2 → Level 2).
      const siblings = (this._lastData?.affectedPods || []).filter(p => p.pod !== pod);
      const siblingsHtml = siblings.length
        ? `<div class="ra-card">
            <div class="ra-card-title">Pod อื่นที่ restart ในการสืบสวนนี้ <span class="count">${siblings.length}</span></div>
            <div style="font-size:11px;color:var(--ra-text-soft);margin-bottom:6px">คลิกเพื่อ zoom เข้า pod นั้นแทน (โดยไม่ต้องกดกลับ)</div>
            ${siblings.slice(0, 12).map(p => `
              <div class="ra-pod" onclick="RA.hopToPod(${JSON.stringify(p.pod).replace(/"/g,'&quot;')}, ${JSON.stringify(p.namespace || '').replace(/"/g,'&quot;')}, ${p.restartedAtUnix || 0}, ${JSON.stringify(p.reason).replace(/"/g,'&quot;')})">
                <div>
                  <div class="ra-pod-name" title="${esc(p.pod)}">${esc(p.pod)}</div>
                  ${p.node ? `<div class="ra-pod-sub"><span>${esc(p.node)}</span></div>` : ''}
                </div>
                <div class="ra-pod-time">${fmtTime(p.restartedAtUnix)}</div>
                <div class="ra-pod-reason ${p.reason}">${esc(p.reason)}</div>
              </div>`).join('')}
            ${siblings.length > 12 ? `<div style="text-align:center;color:var(--ra-text-soft);font-size:11px;padding-top:8px">+ ${siblings.length - 12} อื่นๆ · กลับหน้าหลักเพื่อดูทั้งหมด</div>` : ''}
          </div>`
        : '';

      $('ra-results').innerHTML = `
        <div class="ra-nav-view">
          ${this._navHead(pod, `${namespace ? esc(namespace) + ' · ' : ''}restart เมื่อ <b>${fmtTime(restartTs)}</b> · reason: <b>${esc(reason)}</b>`)}

          <div class="ra-detail-stats">
            <div class="ra-detail-stat"><div class="lbl">Memory ตอนตาย</div><div class="val">${memAtDeath ? memAtDeath.v.toFixed(1) + '%' : '—'}</div></div>
            <div class="ra-detail-stat"><div class="lbl">CPU ตอนตาย</div><div class="val">${cpuAtDeath ? cpuAtDeath.v.toFixed(1) + '%' : '—'}</div></div>
            <div class="ra-detail-stat"><div class="lbl">Memory ใช้</div><div class="val">${fmtBytes(bytesAtDeath?.v)}</div></div>
          </div>

          <div class="ra-card" style="margin-bottom:12px">
            <div style="padding:2px 0 12px; font-size:13px; color:var(--text); line-height:1.55">${richText(storySentence)}</div>
            <div class="ra-card-title" style="margin-bottom:8px">กราฟ 40 นาทีก่อน–หลัง pod ตาย</div>
            <div id="ra-pod-slot" class="ra-chart-slot"></div>
            <div class="ra-chart-legend">
              <span class="lg"><span class="dot" style="background:var(--info)"></span>Memory %</span>
              <span class="lg"><span class="dot" style="background:var(--warn)"></span>CPU %</span>
              <span class="lg dashed"><span class="dot"></span>เวลา pod ตาย</span>
            </div>
            <div style="margin-top:14px; padding:10px 12px; background:var(--ra-bg-subtle); border-radius:8px; font-size:11.5px; color:var(--text-muted); line-height:1.6">
              <b>อ่านกราฟยังไง:</b> เส้นสีม่วง = memory %, เส้นสีส้ม = CPU %, เส้นประแดง = จุดที่ pod ตาย.
              หา pattern: memory ขึ้นเรื่อยๆก่อนตาย = memory leak, CPU spike แล้วตาย = liveness probe fail จาก slow response,
              กราฟเรียบแล้วตายกะทันหัน = external signal (kubectl exec / node event / SIGTERM จากภายนอก).
            </div>
          </div>

          ${siblingsHtml}
        </div>`;

      requestAnimationFrame(() => {
        paintChart($('ra-pod-slot'), [
          { name: 'Memory %', color: 'var(--info)', unit: '%', points: memPct },
          { name: 'CPU %',    color: 'var(--warn)', unit: '%', points: cpuPct },
        ], [{ ts: restartTs, pod: d.pod, count: 1 }], { height: 280 });
      });
    },

    // Hop from one pod-detail to another WITHOUT going back to analysis
    // first. Same as openPodDrill but doesn't push the current pod-view
    // onto the stack (that would leak stack entries as user hops through).
    // Analysis view stays as the ONE entry in the stack.
    hopToPod(pod, namespace, restartedAt, reason) {
      if (!pod || !restartedAt) return;
      // Don't push — the analysis snapshot is already on the stack from the
      // first drill. Just re-fetch + re-render.
      $('ra-results').innerHTML = `
        <div class="ra-nav-view">
          ${this._navHead(pod, `${namespace ? esc(namespace) + ' · ' : ''}restart เมื่อ <b>${fmtTime(restartedAt)}</b>`)}
          <div class="ra-loading">
            <div class="ra-detail-stats">${Array(3).fill('<div class="ra-detail-stat"><div class="ra-skel" style="height:44px"></div></div>').join('')}</div>
            <div class="ra-card"><div class="ra-skel" style="height:280px"></div></div>
          </div>
        </div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      API.restartAnalyzer.podDetail(pod, namespace, restartedAt, 600)
        .then(res => {
          if (!res?.ok || !res?.data?.data) throw new Error(res?.data?.message || 'load failed');
          this._renderPodDetail(res.data.data, reason, pod, namespace);
        })
        .catch(e => {
          $('ra-results').innerHTML = `<div style="padding:40px;text-align:center;color:var(--hot);font-size:12.5px">โหลดไม่สำเร็จ · ${esc(e.message || e)}</div>`;
        });
    },
  };

  document.querySelectorAll('.ra-range button').forEach(btn => btn.addEventListener('click', () => RA.setRange(btn.dataset.range)));
  $('ra-go').addEventListener('click', () => RA.analyze());
  $('ra-input').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); RA.analyze(); } });

  // ESC priority: docs > picker > nav stack pop.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ($('ra-docs')?.classList.contains('on'))   { RA.closeDocs();   return; }
    if ($('ra-picker')?.classList.contains('on')) { RA.closePicker(); return; }
    if (RA._navStack.length > 0) RA.navBack();
  });

  // Repaint the main chart on resize (only if we've already loaded data).
  let _resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => {
      if (RA._lastData) {
        const d = RA._lastData;
        const restartEvents = (d.affectedPods || []).map(p => ({ ts: p.restartedAtUnix, pod: p.pod, count: 1 })).filter(m => m.ts);
        paintChart($('ra-tl-slot'), [
          { name: 'Memory %', color: 'var(--info)', unit: '%', points: d.timeline?.mem || [] },
          { name: 'CPU %',    color: 'var(--warn)', unit: '%', points: d.timeline?.cpu || [] },
        ], restartEvents);
      }
    }, 120);
  });

  // URL bootstrap.
  const qs = new URLSearchParams(location.search);
  if (qs.get('service')) {
    $('ra-input').value = qs.get('service');
    if (qs.get('range') && ['1h','6h','24h','7d'].includes(qs.get('range'))) RA.setRange(qs.get('range'));
    RA.analyze();
  }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_wireCrosshair", { configurable: true, get: () => _wireCrosshair, set: (v) => { _wireCrosshair = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "paintChart", { configurable: true, get: () => paintChart, set: (v) => { paintChart = v; } }); } catch (e) {}
})();
