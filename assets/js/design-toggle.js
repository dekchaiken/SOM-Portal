/* ══════════════════════════════════════════════════════════════
   design-toggle.js  |  SOM Portal — TEMPORARY REVIEW TOOL
   ──────────────────────────────────────────────────────────────
   Adds a floating switch that disables/enables enterprise-refine.css
   live, so the new design can be judged against the old one on the
   real page with real data — no file edits, no reload.

   Remove this file and its <script> tag once the design is signed off.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'som_design_preview';

  function sheet() {
    return Array.prototype.find.call(
      document.querySelectorAll('link[rel="stylesheet"]'),
      function (l) { return /enterprise-refine\.css/.test(l.href); }
    );
  }

  function setOn(on) {
    var s = sheet();
    if (s) s.disabled = !on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    paint(on);
  }

  function isOn() {
    try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; }
  }

  var box, label, dot;

  function paint(on) {
    if (!box) return;
    label.textContent = on ? 'ดีไซน์ใหม่: เปิด' : 'ดีไซน์ใหม่: ปิด (ของเดิม)';
    dot.style.background = on ? '#22C55E' : '#9CA3AF';
    box.style.borderColor = on ? 'rgba(194,65,12,.55)' : 'rgba(0,0,0,.15)';
  }

  function build() {
    if (document.getElementById('som-design-toggle')) return;

    box = document.createElement('button');
    box.id = 'som-design-toggle';
    box.type = 'button';
    box.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483000',
      'display:inline-flex', 'align-items:center', 'gap:9px',
      'padding:10px 14px', 'border-radius:999px', 'cursor:pointer',
      'border:1.5px solid rgba(194,65,12,.55)',
      'background:#fff', 'color:#111',
      'font:600 12.5px/1 Inter, system-ui, sans-serif',
      'box-shadow:0 6px 22px -6px rgba(0,0,0,.35)',
      'transition:transform .14s ease'
    ].join(';');

    dot = document.createElement('span');
    dot.style.cssText = 'width:9px;height:9px;border-radius:50%;flex:0 0 auto;background:#22C55E';

    label = document.createElement('span');

    var hint = document.createElement('span');
    hint.textContent = 'คลิกเพื่อสลับ';
    hint.style.cssText = 'opacity:.5;font-weight:500;margin-left:2px';

    box.appendChild(dot);
    box.appendChild(label);
    box.appendChild(hint);

    // Stay readable when the app is in dark mode
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
      box.style.background = '#15181E';
      box.style.color = '#F2F4F8';
    }

    box.addEventListener('mouseenter', function () { box.style.transform = 'translateY(-2px)'; });
    box.addEventListener('mouseleave', function () { box.style.transform = 'none'; });
    box.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setOn(!isOn());
    });

    document.body.appendChild(box);
    setOn(isOn());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
