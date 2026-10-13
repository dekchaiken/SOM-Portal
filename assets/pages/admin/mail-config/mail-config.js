// admin/mail-config — page script, extracted from admin/mail-config.html.
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

if (!Auth.requireAdmin()) {}
Layout.render('admin');

let globalCc = [];
let _pwVisible = false;

// ── Load config ────────────────────────────────────────────
async function load() {
  const res = await API.mailConfig.get();
  if (!res?.ok) { Toast.error('โหลด config ไม่ได้'); return; }
  const c = res.data.data || {};

  document.getElementById('smtp-host').value  = c.smtp_host  || '';
  document.getElementById('smtp-port').value  = c.smtp_port  || 587;
  document.getElementById('smtp-enc').value   = c.smtp_encryption || 'tls';
  document.getElementById('smtp-user').value  = c.smtp_user  || '';
  document.getElementById('smtp-pass').value  = '';   // never pre-fill password
  document.getElementById('from-name').value  = c.from_name  || '';
  document.getElementById('from-email').value = c.from_email || '';
  document.getElementById('email-sig').value  = c.email_signature || '';
  document.getElementById('brand-title').value = c.email_brand_title || 'TechOps · Service Monitoring Center';
  const colors = Array.isArray(c.email_brand_colors) && c.email_brand_colors.length === 4
    ? c.email_brand_colors
    : ['#fde047','#fb923c','#ec4899','#a855f7'];
  document.getElementById('brand-c1').value = colors[0];
  document.getElementById('brand-c2').value = colors[1];
  document.getElementById('brand-c3').value = colors[2];
  document.getElementById('brand-c4').value = colors[3];
  document.getElementById('ft-title').value   = c.email_footer_title   || 'Service Monitoring Center (SMC)';
  document.getElementById('ft-contact').value = c.email_footer_contact || 'Service Management Center, Ascend Money | M +66 91 6969 885 | sm@ascendcorp.com';
  document.getElementById('ft-address').value = c.email_footer_address || '101 True Digital Park, Phoenix Building 7th Floor, Sukhumvit Road, Bang Chak, Phra Khanong, Bangkok 10260';
  document.getElementById('ft-website').value = c.email_footer_website || 'www.ascendmoneygroup.com';
  document.getElementById('ft-public-url').value = c.email_public_base_url || '';

  // Footer style — pick from saved value; gate 'typewriter' behind team allow-list.
  const styleAvail = Array.isArray(c._footer_styles_available) ? c._footer_styles_available : ['classic'];
  const twCard = document.getElementById('ft-style-typewriter');
  if (twCard) {
    if (styleAvail.includes('typewriter')) {
      twCard.classList.remove('is-disabled');
      const badge = twCard.querySelector('.fs-card-badge');
      if (badge) { badge.className = 'fs-card-badge sm-only'; badge.textContent = 'SM ONLY'; }
    } else {
      twCard.classList.add('is-disabled');
      const badge = twCard.querySelector('.fs-card-badge');
      if (badge) { badge.className = 'fs-card-badge lock'; badge.innerHTML = '<i data-icon="lock"></i> SM TEAM ONLY'; }
    }
  }
  let savedStyle = c.email_footer_style || 'classic';
  if (savedStyle === 'typewriter' && !styleAvail.includes('typewriter')) savedStyle = 'classic';
  setFooterStyle(savedStyle);

  // Header style — same team allow-list as footer.
  const hdTwCard = document.getElementById('hd-style-typewriter');
  if (hdTwCard) {
    if (styleAvail.includes('typewriter')) {
      hdTwCard.classList.remove('is-disabled');
      const badge = hdTwCard.querySelector('.fs-card-badge');
      if (badge) { badge.className = 'fs-card-badge sm-only'; badge.textContent = 'SM ONLY'; }
    } else {
      hdTwCard.classList.add('is-disabled');
      const badge = hdTwCard.querySelector('.fs-card-badge');
      if (badge) { badge.className = 'fs-card-badge lock'; badge.innerHTML = '<i data-icon="lock"></i> SM TEAM ONLY'; }
    }
  }
  let savedHdStyle = c.email_header_style || 'classic';
  if (savedHdStyle === 'typewriter' && !styleAvail.includes('typewriter')) savedHdStyle = 'classic';
  setHeaderStyle(savedHdStyle);

  // Header Typewriter palette (defaults = dark Bauhaus)
  setTwColor('hd-tw-bg',     c.email_header_tw_bg     || '#111111');
  setTwColor('hd-tw-text',   c.email_header_tw_text   || '#f4f1eb');
  setTwColor('hd-tw-accent', c.email_header_tw_accent || '#F26419');

  // Size settings
  const sz = c.email_brand_sizes || {};
  document.getElementById('sz-hdr-pad').value     = sz.hdr_pad    ?? 44;
  document.getElementById('sz-hdr-title').value   = sz.hdr_title  ?? 26;
  document.getElementById('sz-hdr-sub').value     = sz.hdr_sub    ?? 14;
  document.getElementById('sz-divider').value     = sz.divider    ?? 4;
  document.getElementById('sz-ft-pad').value      = sz.ft_pad     ?? 30;
  document.getElementById('sz-ft-title').value    = sz.ft_title   ?? 18;
  document.getElementById('sz-ft-contact').value  = sz.ft_contact ?? 11.5;
  document.getElementById('sz-ft-addr').value     = sz.ft_addr    ?? 11;
  const ftBg = sz.ft_bg || '#0f172a';
  document.getElementById('sz-ft-bg').value       = ftBg;
  document.getElementById('sz-ft-bg-label').textContent = ftBg;

  updateBrandPreview();

  // SMTP status badge
  const hasSmtp = c.smtp_host && c.from_email;
  const st = document.getElementById('smtp-status');
  const stTxt = document.getElementById('smtp-status-txt');
  st.className = 'cfg-status ' + (hasSmtp ? 'ok' : 'bad');
  stTxt.textContent = hasSmtp
    ? (c.smtp_password_set ? 'ตั้งค่าแล้ว <i data-icon="check"></i>' : 'ตั้งค่าแล้ว (ไม่มี password)')
    : 'ยังไม่ตั้งค่า';

  globalCc = Array.isArray(c.global_cc) ? c.global_cc : [];
  renderCcChips();
}

// ── Password show/hide ─────────────────────────────────────
document.getElementById('pw-toggle').addEventListener('click', () => {
  _pwVisible = !_pwVisible;
  document.getElementById('smtp-pass').type = _pwVisible ? 'text' : 'password';
  document.getElementById('pw-toggle').querySelector('svg').innerHTML = _pwVisible
    ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
});

// ── CC Chips ───────────────────────────────────────────────
function renderCcChips() {
  const field = document.getElementById('cc-field');
  const input = document.getElementById('cc-input');
  field.querySelectorAll('.chip').forEach(c => c.remove());
  globalCc.forEach(email => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escHtml(email)}<button class="chip-x" data-email="${escHtml(email)}" title="ลบ">×</button>`;
    field.insertBefore(chip, input);
  });
}

document.getElementById('cc-field').addEventListener('click', e => {
  const btn = e.target.closest('.chip-x');
  if (!btn) return;
  globalCc = globalCc.filter(x => x !== btn.dataset.email);
  renderCcChips();
});

function addCcEmail() {
  const input  = document.getElementById('cc-input');
  const raw    = input.value.trim().replace(/,\s*$/, '');
  if (!raw) return;
  const emails = parseEmailList(raw);
  if (!emails.length && raw.includes('@')) emails.push(raw);
  if (!emails.length) { Toast.warning('รูปแบบ email ไม่ถูกต้อง'); return; }
  emails.forEach(em => { if (!globalCc.includes(em)) globalCc.push(em); });
  renderCcChips();
  input.value = '';
}

document.getElementById('cc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCcEmail(); }
  if (e.key === 'Backspace' && !e.target.value && globalCc.length) {
    globalCc.pop();
    renderCcChips();
  }
});
document.getElementById('cc-input').addEventListener('blur', addCcEmail);
document.getElementById('cc-input').addEventListener('paste', e => {
  e.preventDefault();
  const pasted = (e.clipboardData || window.clipboardData).getData('text');
  if (!pasted) return;
  const emails = parseEmailList(pasted);
  if (!emails.length) { document.getElementById('cc-input').value = pasted; return; }
  let added = 0;
  emails.forEach(em => { if (!globalCc.includes(em)) { globalCc.push(em); added++; } });
  if (added) { renderCcChips(); Toast.success(`เพิ่ม ${added} email แล้ว`); }
});

// ── Save SMTP ──────────────────────────────────────────────
document.getElementById('btn-save-smtp').addEventListener('click', async function() {
  const host      = document.getElementById('smtp-host').value.trim();
  const fromEmail = document.getElementById('from-email').value.trim();
  if (!host)      { Toast.warning('กรอก SMTP Host ก่อน'); return; }
  if (!fromEmail) { Toast.warning('กรอก From Email ก่อน'); return; }

  this.disabled = true; this.textContent = '⏳…';
  const payload = {
    smtp_host:       host,
    smtp_port:       parseInt(document.getElementById('smtp-port').value) || 587,
    smtp_encryption: document.getElementById('smtp-enc').value,
    smtp_user:       document.getElementById('smtp-user').value.trim(),
    smtp_password:   document.getElementById('smtp-pass').value,
    from_name:       document.getElementById('from-name').value.trim(),
    from_email:      fromEmail,
  };
  const res = await API.mailConfig.save(payload);
  if (res?.ok) { Toast.success('บันทึก SMTP แล้ว'); await load(); }
  else Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
  this.disabled = false; this.innerHTML = '<i data-icon="save"></i> บันทึก SMTP';
});

// ── Save CC ────────────────────────────────────────────────
document.getElementById('btn-save-cc').addEventListener('click', async function() {
  addCcEmail();   // flush any pending input
  this.disabled = true; this.textContent = '⏳…';
  const res = await API.mailConfig.save({ global_cc: globalCc });
  if (res?.ok) { Toast.success('บันทึก CC แล้ว'); }
  else Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
  this.disabled = false; this.innerHTML = '<i data-icon="save"></i> บันทึก CC';
});

// ── Save Signature ─────────────────────────────────────────
document.getElementById('btn-save-sig').addEventListener('click', async function() {
  this.disabled = true; this.textContent = '⏳…';
  const res = await API.mailConfig.save({ email_signature: document.getElementById('email-sig').value });
  if (res?.ok) { Toast.success('บันทึก Signature แล้ว'); }
  else Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
  this.disabled = false; this.innerHTML = '<i data-icon="save"></i> บันทึก Signature';
});

// ── Branded Template: presets, preview, save ───────────────
const BRAND_PRESETS = {
  warm:   ['#fde047', '#fb923c', '#ec4899', '#a855f7'],
  ocean:  ['#a5f3fc', '#38bdf8', '#3b82f6', '#1e40af'],
  forest: ['#fef9c3', '#bef264', '#22c55e', '#14532d'],
  mono:   ['#e2e8f0', '#94a3b8', '#475569', '#0f172a'],
};

// Hex → "r,g,b"
function hexToRgb(hex) {
  hex = hex.replace('#','');
  const n = parseInt(hex, 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}
// Mix hex with white by ratio (0..1) → returns hex
function lighten(hex, ratio) {
  const [r,g,b] = hexToRgb(hex);
  const m = (v) => Math.round(v + (255 - v) * ratio);
  return '#' + [m(r),m(g),m(b)].map(v => v.toString(16).padStart(2,'0')).join('');
}

function getBrandColors() {
  return [
    document.getElementById('brand-c1').value,
    document.getElementById('brand-c2').value,
    document.getElementById('brand-c3').value,
    document.getElementById('brand-c4').value,
  ];
}

function getSizeSettings() {
  return {
    hdr_pad:    parseFloat(document.getElementById('sz-hdr-pad').value)    || 44,
    hdr_title:  parseFloat(document.getElementById('sz-hdr-title').value)  || 26,
    hdr_sub:    parseFloat(document.getElementById('sz-hdr-sub').value)    || 14,
    divider:    parseFloat(document.getElementById('sz-divider').value)    || 4,
    ft_pad:     parseFloat(document.getElementById('sz-ft-pad').value)     || 30,
    ft_title:   parseFloat(document.getElementById('sz-ft-title').value)   || 18,
    ft_contact: parseFloat(document.getElementById('sz-ft-contact').value) || 11.5,
    ft_addr:    parseFloat(document.getElementById('sz-ft-addr').value)    || 11,
    ft_bg:      document.getElementById('sz-ft-bg').value                  || '#0f172a',
  };
}

function updateBrandPreview() {
  const t = document.getElementById('brand-title').value.trim() || 'TechOps · Service Monitoring Center';

  const sz = getSizeSettings();

  // Header — style-aware (classic pastel gradient / typewriter terminal for SM only)
  const hdrEl = document.getElementById('brand-preview-header');
  const c = getBrandColors();
  const pastel = c.map(h => lighten(h, 0.78));
  const hdStyle = getHeaderStyle();
  const d1 = document.getElementById('brand-preview-divider1');
  const d2 = document.getElementById('brand-preview-divider2');

  if (hdStyle === 'typewriter') {
    // Two-row terminal header — palette-driven bg/text/accent + auto title-bar
    const pal = getTwPalette();
    const barBg = shiftLuma(pal.bg, 12);
    hdrEl.setAttribute('style', `padding:0;background:${pal.bg}`);
    hdrEl.innerHTML = `
      <div style="background:${barBg};padding:9px 16px">
        <span style="width:11px;height:11px;background:#ff5f57;border-radius:50%;display:inline-block;vertical-align:middle;margin-right:6px"></span>
        <span style="width:11px;height:11px;background:#febc2e;border-radius:50%;display:inline-block;vertical-align:middle;margin-right:6px"></span>
        <span style="width:11px;height:11px;background:#28c840;border-radius:50%;display:inline-block;vertical-align:middle"></span>
      </div>
      <div style="padding:${sz.hdr_pad}px 28px;background:${pal.bg};color:${pal.text};font-family:JetBrains Mono,IBM Plex Sans Thai,monospace">
        <div style="font-size:${sz.hdr_title}px;font-weight:800;color:${pal.text};line-height:1.25;letter-spacing:-.01em">${escHtml(t)}</div>
        <div style="height:4px;width:72px;background:${pal.accent};margin-top:16px"></div>
      </div>
    `;
    // Solid accent divider matches the header's accent
    d1.style.background = pal.accent;
    d1.style.height     = sz.divider + 'px';
  } else {
    // Classic pastel gradient header
    hdrEl.setAttribute('style', `padding:${sz.hdr_pad}px 28px;background:linear-gradient(135deg, ${pastel[0]} 0%, ${pastel[1]} 35%, ${pastel[2]} 68%, ${pastel[3]} 100%)`);
    hdrEl.innerHTML = `<div id="brand-preview-title" style="font-size:${sz.hdr_title}px;font-weight:700;color:#0f172a;line-height:1.3">${escHtml(t)}</div>`;
    const dividerCss = `linear-gradient(90deg, ${c[0]} 0%, ${c[1]} 35%, ${c[2]} 70%, ${c[3]} 100%)`;
    d1.style.background = dividerCss;
    d1.style.height     = sz.divider + 'px';
  }

  // Bottom divider always follows the gradient (below body → footer)
  const bottomDividerCss = `linear-gradient(90deg, ${c[0]} 0%, ${c[1]} 35%, ${c[2]} 70%, ${c[3]} 100%)`;
  d2.style.background = bottomDividerCss;
  d2.style.height     = sz.divider + 'px';

  // Footer
  const ftTitle   = document.getElementById('ft-title').value.trim()   || 'Service Monitoring Center (SMC)';
  const ftContact = document.getElementById('ft-contact').value.trim() || 'Service Management Center, Ascend Money | M +66 91 6969 885 | sm@ascendcorp.com';
  const ftAddr    = document.getElementById('ft-address').value.trim() || '101 True Digital Park, Phoenix Building 7th Floor, Sukhumvit Road, Bang Chak, Phra Khanong, Bangkok 10260';
  const ftWeb     = document.getElementById('ft-website').value.trim() || 'www.ascendmoneygroup.com';

  const footerEl = document.getElementById('brand-preview-footer');
  const style = getFooterStyle();

  if (style === 'typewriter') {
    // Render the Typewriter footer preview (static — matches _footerRowTypewriter in _branding.php)
    const webDsp = ftWeb.replace(/^https?:\/\//, '');
    const contactLinked = escHtml(ftContact)
      .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<span style="color:#F26419">$1</span>')
      .replace(/ \| /g, ' &nbsp;|&nbsp; ');
    footerEl.setAttribute('style', 'background:#111;color:#e2e8f0;padding:22px 28px;font-family:JetBrains Mono,monospace;text-align:left');
    footerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px">
        <img src="../uploads/sm-logo-typewriter.gif?v=3" width="300" height="85" alt="SM · Service Monitoring"
             style="display:block;border:0;max-width:300px;height:auto">
        <div style="flex:1"></div>
        <div style="background:#22c55e;color:#111;padding:3px 9px;font-size:9px;font-weight:800;letter-spacing:.12em;border-radius:2px">● ONLINE</div>
      </div>
      <div style="height:1px;background:#333;margin:12px 0"></div>
      <div style="font-size:10.5px;line-height:1.85">
        <div><span style="color:#F26419;font-weight:800">▸ MAIL &nbsp;</span> <span>${contactLinked}</span></div>
        <div><span style="color:#F26419;font-weight:800">▸ OFC &nbsp;&nbsp;</span> <span style="color:#94a3b8">${escHtml(ftAddr)}</span></div>
        <div><span style="color:#F26419;font-weight:800">▸ WEB &nbsp;&nbsp;</span> <a href="#" style="color:#fcd34d;text-decoration:none">${escHtml(webDsp)}</a></div>
        <div style="margin-top:6px;color:#666;font-size:9.5px;font-family:'IBM Plex Sans Thai',monospace">— ${escHtml(ftTitle)}</div>
      </div>
    `;
    return;
  }

  // Classic footer (default) — restore the original preview markup then hydrate.
  footerEl.setAttribute('style', `padding:${sz.ft_pad}px 28px;background:${sz.ft_bg};text-align:center`);
  footerEl.innerHTML = `
    <div id="ft-preview-title" style="font-size:${sz.ft_title}px;font-weight:700;color:#fcd34d;margin-bottom:6px"></div>
    <div id="ft-preview-contact" style="font-size:${sz.ft_contact}px;color:#cbd5e1;line-height:1.7"></div>
    <div id="ft-preview-address" style="font-size:${sz.ft_addr}px;color:#94a3b8;line-height:1.7;margin-top:5px"></div>
    <div id="ft-preview-website" style="font-size:${sz.ft_addr}px;color:#fcd34d;margin-top:3px"></div>
  `;
  document.getElementById('ft-preview-title').textContent = ftTitle;
  const ftContactHtml = escHtml(ftContact)
    .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<span style="color:#fcd34d">$1</span>')
    .replace(/ \| /g, ' &nbsp;|&nbsp; ');
  document.getElementById('ft-preview-contact').innerHTML = ftContactHtml;
  document.getElementById('ft-preview-address').textContent = ftAddr;
  document.getElementById('ft-preview-website').textContent = ftWeb.replace(/^https?:\/\//, '');
}

document.getElementById('brand-title').addEventListener('input', updateBrandPreview);
['brand-c1','brand-c2','brand-c3','brand-c4'].forEach(id =>
  document.getElementById(id).addEventListener('input', updateBrandPreview));
['ft-title','ft-contact','ft-address','ft-website'].forEach(id =>
  document.getElementById(id).addEventListener('input', updateBrandPreview));

// Size settings → live preview
['sz-hdr-pad','sz-hdr-title','sz-hdr-sub','sz-divider',
 'sz-ft-pad','sz-ft-title','sz-ft-contact','sz-ft-addr'].forEach(id =>
  document.getElementById(id).addEventListener('input', updateBrandPreview));

// Footer BG color — also update hex label
document.getElementById('sz-ft-bg').addEventListener('input', function() {
  document.getElementById('sz-ft-bg-label').textContent = this.value;
  updateBrandPreview();
});

document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = BRAND_PRESETS[btn.dataset.preset];
    if (!p) return;
    document.getElementById('brand-c1').value = p[0];
    document.getElementById('brand-c2').value = p[1];
    document.getElementById('brand-c3').value = p[2];
    document.getElementById('brand-c4').value = p[3];
    updateBrandPreview();
  });
});

// ── Footer style picker (Classic / Typewriter-SM-only) ───
function getFooterStyle() {
  const el = document.querySelector('input[name="ft-style"]:checked');
  return el ? el.value : 'classic';
}
function setFooterStyle(style) {
  document.querySelectorAll('#ft-style-grid .fs-card').forEach(card => {
    const active = card.dataset.style === style;
    card.classList.toggle('is-active', active);
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = active;
  });
  // Public URL field only makes sense for the Typewriter footer.
  const pubRow = document.getElementById('pub-url-row');
  if (pubRow) pubRow.style.display = (style === 'typewriter') ? '' : 'none';
  applyThemeLocks();
  updateBrandPreview();
}
document.querySelectorAll('#ft-style-grid .fs-card').forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('is-disabled')) return;
    setFooterStyle(card.dataset.style);
  });
});

// ── Header style picker (Classic / Typewriter-SM-only) ───
function getHeaderStyle() {
  const el = document.querySelector('input[name="hd-style"]:checked');
  return el ? el.value : 'classic';
}
function setHeaderStyle(style) {
  document.querySelectorAll('#hd-style-grid .fs-card').forEach(card => {
    const active = card.dataset.style === style;
    card.classList.toggle('is-active', active);
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = active;
  });
  // Palette section only makes sense when Typewriter header is picked
  const pal = document.getElementById('hd-tw-palette-row');
  if (pal) pal.style.display = (style === 'typewriter') ? '' : 'none';
  applyThemeLocks();
  updateBrandPreview();
}

// Small helper to update a color picker + its hex label in sync.
function setTwColor(id, hex) {
  const inp = document.getElementById(id);
  const lbl = document.getElementById(id + '-lbl');
  if (inp) inp.value = hex;
  if (lbl) lbl.textContent = hex;
}
function getTwPalette() {
  return {
    bg:     document.getElementById('hd-tw-bg').value,
    text:   document.getElementById('hd-tw-text').value,
    accent: document.getElementById('hd-tw-accent').value,
  };
}
// Same luminance shift as _shiftLuma() in _branding.php — keeps preview honest.
function shiftLuma(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  const d = luma < 128 ? amount : -amount;
  const c = v => Math.max(0, Math.min(255, v + d));
  return '#' + [c(r), c(g), c(b)].map(v => v.toString(16).padStart(2,'0')).join('');
}

// Preset buttons — populate all 3 colors + refresh preview
document.querySelectorAll('#hd-tw-presets [data-hd-preset]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const p = JSON.parse(btn.dataset.hdPreset);
    setTwColor('hd-tw-bg', p.bg);
    setTwColor('hd-tw-text', p.text);
    setTwColor('hd-tw-accent', p.accent);
    updateBrandPreview();
  });
});

// Color pickers — sync label + refresh preview on every change
['hd-tw-bg','hd-tw-text','hd-tw-accent'].forEach(id => {
  document.getElementById(id).addEventListener('input', function() {
    const lbl = document.getElementById(id + '-lbl');
    if (lbl) lbl.textContent = this.value;
    updateBrandPreview();
  });
});

// Disable brand-color pickers + presets when Typewriter is picked for either
// header or footer — the Typewriter theme uses fixed Bauhaus colors and the
// pastel gradient stops don't render anywhere the user can see.
function applyThemeLocks() {
  const hdTw = getHeaderStyle() === 'typewriter';
  const ftTw = getFooterStyle() === 'typewriter';
  const locked = hdTw || ftTw;

  // Brand-color inputs + preset buttons: the gradient is only used by
  // classic header + classic bottom divider, both bypassed when locked.
  const colorInputs = ['brand-c1','brand-c2','brand-c3','brand-c4']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  colorInputs.forEach(el => {
    el.disabled = locked;
    el.style.opacity = locked ? '.35' : '';
    el.style.cursor  = locked ? 'not-allowed' : '';
  });
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.disabled = locked;
    btn.style.opacity = locked ? '.35' : '';
    btn.style.pointerEvents = locked ? 'none' : '';
  });

  // Footer BG color picker — only used by Classic footer.
  const ftBg = document.getElementById('sz-ft-bg');
  if (ftBg) {
    ftBg.disabled = ftTw;
    ftBg.style.opacity = ftTw ? '.35' : '';
    ftBg.style.cursor  = ftTw ? 'not-allowed' : '';
  }

  // Lock indicator on the group headers
  const lockNote = document.getElementById('theme-lock-note');
  if (lockNote) lockNote.style.display = locked ? '' : 'none';
}
document.querySelectorAll('#hd-style-grid .fs-card').forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('is-disabled')) return;
    setHeaderStyle(card.dataset.style);
  });
});

document.getElementById('btn-save-brand').addEventListener('click', async function() {
  this.disabled = true; this.textContent = '⏳…';
  const res = await API.mailConfig.save({
    email_brand_title:    document.getElementById('brand-title').value.trim(),
    email_brand_colors:   getBrandColors(),
    email_footer_title:   document.getElementById('ft-title').value.trim(),
    email_footer_contact: document.getElementById('ft-contact').value.trim(),
    email_footer_address: document.getElementById('ft-address').value.trim(),
    email_footer_website: document.getElementById('ft-website').value.trim(),
    email_brand_sizes:    getSizeSettings(),
    email_footer_style:   getFooterStyle(),
    email_header_style:   getHeaderStyle(),
    email_public_base_url: document.getElementById('ft-public-url').value.trim(),
    email_header_tw_bg:     document.getElementById('hd-tw-bg').value,
    email_header_tw_text:   document.getElementById('hd-tw-text').value,
    email_header_tw_accent: document.getElementById('hd-tw-accent').value,
  });
  if (res?.ok) { Toast.success('บันทึก Branded Template แล้ว'); }
  else Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
  this.disabled = false; this.innerHTML = '<i data-icon="save"></i> บันทึก Template';
});

// ── Test Connection ────────────────────────────────────────
document.getElementById('btn-test-conn').addEventListener('click', async function() {
  const stepsEl = document.getElementById('conn-steps');
  stepsEl.innerHTML = `<div class="conn-step" style="color:var(--text-muted)">
    <div class="conn-step-icon">⏳</div>
    <div class="conn-step-label">กำลังทดสอบ…</div>
    <div class="conn-step-detail">กำลังเชื่อมต่อ ${document.getElementById('smtp-host').value || '(ยังไม่ได้กรอก host)'}:${document.getElementById('smtp-port').value}</div>
  </div>`;
  stepsEl.classList.add('visible');
  this.disabled = true; this.textContent = '⏳ กำลังทดสอบ…';

  // Save current values first (without password change) so PHP reads latest values
  const res = await API.mail.testConnection();

  this.disabled = false; this.innerHTML = '<i data-icon="plug"></i> ทดสอบการเชื่อมต่อ';

  if (!res) {
    stepsEl.innerHTML = `<div class="conn-step err">
      <div class="conn-step-icon"><i data-icon="x-circle"></i></div>
      <div class="conn-step-label">Network Error</div>
      <div class="conn-step-detail">ไม่สามารถเรียก API ได้</div>
    </div>`;
    return;
  }

  const steps = res.data?.data?.steps || [];
  const allOk = res.data?.data?.ok;

  stepsEl.innerHTML = steps.map(s => `
    <div class="conn-step ${s.ok ? 'ok' : 'err'}">
      <div class="conn-step-icon">${s.ok ? '✅' : '❌'}</div>
      <div class="conn-step-label">${escHtml(s.label)}</div>
      <div class="conn-step-detail">${escHtml(s.detail || '')}</div>
    </div>`).join('');

  if (allOk) {
    stepsEl.innerHTML += `<div class="conn-step ok" style="font-weight:700">
      <div class="conn-step-icon"><i data-icon="sparkles"></i></div>
      <div class="conn-step-label">เชื่อมต่อสำเร็จ</div>
      <div class="conn-step-detail">SMTP พร้อมใช้งาน — กด "ส่งทดสอบ" เพื่อส่ง email จริง</div>
    </div>`;
  }
});

// ── Test Send ──────────────────────────────────────────────
document.getElementById('btn-test-send').addEventListener('click', async function() {
  const to = document.getElementById('test-to').value.trim();
  if (!to) { Toast.warning('ระบุ email ที่จะทดสอบส่ง'); return; }
  const resultEl = document.getElementById('test-result');
  resultEl.className = 'test-result';
  resultEl.textContent = '';
  this.disabled = true; this.textContent = '⏳ กำลังส่ง…';

  // Use API.mail.send with plain text
  const res = await API.mail.send({
    to:      [to],
    cc:      [],
    subject: '[TEST] SOM-Portal Mail Config Test',
    body:    'นี่คือ email ทดสอบจาก SOM-Portal\n\nถ้าได้รับ email นี้แสดงว่า SMTP ตั้งค่าถูกต้องแล้ว <i data-icon="check-circle"></i>\n\nทดสอบเมื่อ ' + new Date().toLocaleString('th-TH'),
    isHtml:  false  // Force plain text for testing
  });

  this.disabled = false; this.innerHTML = '<i data-icon="mail"></i> ทดสอบส่ง';
  if (res?.ok) {
    resultEl.className = 'test-result ok';
    resultEl.innerHTML = '<i data-icon="check-circle"></i> ส่งสำเร็จ! ตรวจสอบ inbox ของ ' + to + ' ในแถบ 1-2 นาที';
  } else {
    resultEl.className = 'test-result err';
    resultEl.innerHTML = '<i data-icon="x-circle"></i> ' + (res?.data?.message || res?.message || 'ส่งไม่สำเร็จ');
  }
});

// ── Advanced Email Tester ──────────────────────────────────
const advEditor = document.getElementById('adv-test-body');

// Formatting buttons
document.getElementById('adv-btn-bold').addEventListener('click', () => {
  document.execCommand('bold', false, null);
  advEditor.focus();
});

document.getElementById('adv-btn-italic').addEventListener('click', () => {
  document.execCommand('italic', false, null);
  advEditor.focus();
});

document.getElementById('adv-btn-underline').addEventListener('click', () => {
  document.execCommand('underline', false, null);
  advEditor.focus();
});

// Image upload
document.getElementById('adv-btn-image').addEventListener('click', () => {
  document.getElementById('adv-image-input').click();
});

document.getElementById('adv-image-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const imgHtml = `<img src="${ev.target.result}" style="max-width: 100%; height: auto; border-radius: 4px; margin: 6px 0;">`;
    document.execCommand('insertHTML', false, imgHtml);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
  advEditor.focus();
});

// Clear button
document.getElementById('btn-clear-adv-test').addEventListener('click', () => {
  document.getElementById('adv-test-to').value = '';
  document.getElementById('adv-test-subject').value = '[TEST] SOM-Portal Email Test';
  advEditor.innerHTML = '';
  advEditor.focus();
});

// Send button
document.getElementById('btn-send-adv-test').addEventListener('click', async function() {
  const to = document.getElementById('adv-test-to').value.trim();
  const subject = document.getElementById('adv-test-subject').value.trim();
  const body = advEditor.innerHTML.trim();
  const resultEl = document.getElementById('adv-test-result');

  if (!to) { Toast.warning('ระบุ email ที่จะทดสอบส่ง'); return; }
  if (!subject) { Toast.warning('ระบุ subject'); return; }
  if (!body) { Toast.warning('ระบุเนื้อหา'); return; }

  resultEl.className = 'test-result';
  resultEl.textContent = '';
  this.disabled = true;
  this.textContent = '⏳ กำลังส่ง…';

  // Get signature
  const cfg = await API.mailConfig.get();
  const sig = (cfg?.ok && cfg.data.data?.email_signature) ? cfg.data.data.email_signature : '';
  const sigHtml = sig ? '<br><br><p style="color: #000; font-size: 12px; white-space: pre-wrap;">' + escHtml(sig) + '</p>' : '';
  const finalBody = body + sigHtml;

  const res = await API.mail.send({
    to:     [to],
    cc:     [],
    subject: subject,
    body:   finalBody,
    isHtml: true
  });

  this.disabled = false;
  this.innerHTML = '<i data-icon="mail"></i> ส่งเมลทดสอบ';

  if (res?.ok) {
    resultEl.className = 'test-result ok';
    resultEl.innerHTML = '<i data-icon="check-circle"></i> ส่งสำเร็จ! ตรวจสอบ inbox ของ ' + to;
  } else {
    resultEl.className = 'test-result err';
    resultEl.innerHTML = '<i data-icon="x-circle"></i> ' + (res?.data?.message || 'ส่งไม่สำเร็จ');
  }
});

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addCcEmail", { configurable: true, get: () => addCcEmail, set: (v) => { addCcEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyThemeLocks", { configurable: true, get: () => applyThemeLocks, set: (v) => { applyThemeLocks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getBrandColors", { configurable: true, get: () => getBrandColors, set: (v) => { getBrandColors = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getFooterStyle", { configurable: true, get: () => getFooterStyle, set: (v) => { getFooterStyle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getHeaderStyle", { configurable: true, get: () => getHeaderStyle, set: (v) => { getHeaderStyle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getSizeSettings", { configurable: true, get: () => getSizeSettings, set: (v) => { getSizeSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getTwPalette", { configurable: true, get: () => getTwPalette, set: (v) => { getTwPalette = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexToRgb", { configurable: true, get: () => hexToRgb, set: (v) => { hexToRgb = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "lighten", { configurable: true, get: () => lighten, set: (v) => { lighten = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCcChips", { configurable: true, get: () => renderCcChips, set: (v) => { renderCcChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFooterStyle", { configurable: true, get: () => setFooterStyle, set: (v) => { setFooterStyle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setHeaderStyle", { configurable: true, get: () => setHeaderStyle, set: (v) => { setHeaderStyle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setTwColor", { configurable: true, get: () => setTwColor, set: (v) => { setTwColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "shiftLuma", { configurable: true, get: () => shiftLuma, set: (v) => { shiftLuma = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateBrandPreview", { configurable: true, get: () => updateBrandPreview, set: (v) => { updateBrandPreview = v; } }); } catch (e) {}
})();
