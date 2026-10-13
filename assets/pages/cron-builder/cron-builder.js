// cron-builder — page script, extracted from cron-builder.html.
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

/* ══════════════════════════════════════════════════════════
   Cron Builder  |  Quartz 7-field
   Seconds  Minutes  Hours  Day-of-Month  Month  [DOW=?]  Year
   ══════════════════════════════════════════════════════════ */
const CronBuilder = (() => {
  const TABS = ['seconds','minutes','hours','dom','month','year'];
  const CY   = new Date().getFullYear();

  const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  /* ── State ─────────────────────────────────────── */
  const defaultState = () => ({
    tab: 'seconds',
    seconds: { mode:'specific', specific:new Set([0]),   everyN:5,  everyStart:0,  rangeFrom:0,  rangeTo:59 },
    minutes: { mode:'specific', specific:new Set([0]),   everyN:5,  everyStart:0,  rangeFrom:0,  rangeTo:59 },
    hours:   { mode:'specific', specific:new Set([0]),   everyN:2,  everyStart:0,  rangeFrom:0,  rangeTo:23 },
    dom:     { mode:'specific', specific:new Set([1]),   everyN:2,  everyStart:1,  rangeFrom:1,  rangeTo:31, nearestWeekday:1 },
    month:   { mode:'specific', specific:new Set([1]),   everyN:2,  everyStart:1,  rangeFrom:1,  rangeTo:12 },
    year:    { mode:'specific', specific:new Set([CY]),  everyN:2,  everyStart:CY, rangeFrom:CY, rangeTo:CY+1 },
  });

  let state = defaultState();

  /* ── Expression generation ──────────────────────── */
  const fieldExpr = (key) => {
    const s = state[key];
    switch (s.mode) {
      case 'every':          return '*';
      case 'everyN':         return `${s.everyStart}/${s.everyN}`;
      case 'last':           return 'L';
      case 'nearestWeekday': return `${s.nearestWeekday}W`;
      case 'specific': {
        if (!s.specific.size) return '*';
        const sorted = [...s.specific].sort((a,b) => a - b);
        if (key === 'month') return sorted.map(v => MONTH_NAMES[v-1]).join(',');
        return sorted.join(',');
      }
      case 'range': {
        if (key === 'month') return `${MONTH_NAMES[s.rangeFrom-1]}-${MONTH_NAMES[s.rangeTo-1]}`;
        return `${s.rangeFrom}-${s.rangeTo}`;
      }
      default: return '*';
    }
  };

  const generate = () => [
    fieldExpr('seconds'), fieldExpr('minutes'), fieldExpr('hours'),
    fieldExpr('dom'), fieldExpr('month'), '?', fieldExpr('year'),
  ].join(' ');

  const humanReadable = () => {
    const [sec, min, hr, dom, mon, , yr] = generate().split(' ');
    let desc = '';
    if (sec === '*' && min === '*' && hr === '*') desc = 'Every second';
    else if (sec === '0' && min === '*' && hr === '*') desc = 'Every minute at second 0';
    else if (sec === '0' && min === '0' && hr === '*') desc = 'Every hour at :00:00';
    else desc = `At second ${sec}, minute ${min}, hour ${hr}`;
    if (dom !== '*') desc += `, day ${dom} of month`;
    if (mon !== '*') desc += `, in ${mon}`;
    if (yr  !== '*') desc += `, year ${yr}`;
    return desc;
  };

  /* ── DOM helpers ────────────────────────────────── */
  const $   = id => document.getElementById(id);
  const rng = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
  const pad = v => String(v).padStart(2, '0');
  const opts = (vals, lFn, cur) =>
    vals.map(v => `<option value="${v}"${cur === v ? ' selected' : ''}>${lFn(v)}</option>`).join('');

  /* ── Checkbox grid ──────────────────────────────── */
  const chkGrid = (key, vals, lFn, gCls) => {
    const s = state[key];
    const items = vals.map(v =>
      `<div class="cb-chk${s.specific.has(v) ? ' on' : ''}" data-field="${key}" data-v="${v}">${lFn(v)}</div>`
    ).join('');
    return `
      <div class="cb-chk-bar">
        <button class="cb-mini-btn" data-action="all"  data-field="${key}">Select All</button>
        <button class="cb-mini-btn" data-action="none" data-field="${key}">Clear</button>
      </div>
      <div class="cb-chk-grid ${gCls}">${items}</div>`;
  };

  /* ── Option row ─────────────────────────────────── */
  const row = (key, mode, label, ctrls = '', extra = '') => {
    const active = state[key].mode === mode;
    return `
      <div class="cb-option${active ? ' sel' : ''}" data-mode="${mode}" data-field="${key}">
        <input type="radio" class="cb-radio" name="r-${key}"${active ? ' checked' : ''}>
        <div class="cb-opt-body">
          <div class="cb-opt-text">${label}</div>
          ${active && ctrls ? `<div class="cb-ctrls">${ctrls}</div>` : ''}
          ${active && extra ? `<div class="cb-grid-wrap">${extra}</div>` : ''}
        </div>
      </div>`;
  };

  /* ── Panel renderers ────────────────────────────── */
  const renderSimple = (key) => {
    const s      = state[key];
    const maxVal = key === 'hours' ? 23 : 59;
    const vals   = rng(0, maxVal);
    const cols   = key === 'hours' ? 'g8' : 'g10';
    const unit   = { seconds:'second', minutes:'minute', hours:'hour' }[key];
    const evNO   = opts(rng(2, Math.min(30, maxVal)), v => v, s.everyN);
    const stO    = opts(vals, pad, s.everyStart);
    const rfO    = opts(vals, pad, s.rangeFrom);
    const rtO    = opts(vals, pad, s.rangeTo);
    const evNC   = `Every <select class="cb-sel" data-attr="everyN" data-field="${key}">${evNO}</select>
                    ${unit}(s) starting at ${unit}
                    <select class="cb-sel" data-attr="everyStart" data-field="${key}">${stO}</select>`;
    const rngC   = `Every ${unit} between ${unit}
                    <select class="cb-sel" data-attr="rangeFrom" data-field="${key}">${rfO}</select>
                    and ${unit}
                    <select class="cb-sel" data-attr="rangeTo" data-field="${key}">${rtO}</select>`;
    return [
      row(key, 'every',    `Every ${unit}`),
      row(key, 'everyN',   `Every N ${unit}(s) starting at…`, evNC),
      row(key, 'specific', `Specific ${unit} (choose one or many)`, '',
          s.mode === 'specific' ? chkGrid(key, vals, pad, cols) : ''),
      row(key, 'range',    `Every ${unit} between…`, rngC),
    ].join('');
  };

  const renderDom = () => {
    const s  = state.dom;
    const v  = rng(1, 31);
    const eN = opts(rng(2, 15), x => x, s.everyN);
    const st = opts(v, x => x, s.everyStart);
    const rf = opts(v, x => x, s.rangeFrom);
    const rt = opts(v, x => x, s.rangeTo);
    const nw = opts(v, x => x, s.nearestWeekday);
    return [
      row('dom','every',         'Every day'),
      row('dom','everyN',        'Every N day(s) starting at…',
          `Every <select class="cb-sel" data-attr="everyN" data-field="dom">${eN}</select> day(s) starting at day <select class="cb-sel" data-attr="everyStart" data-field="dom">${st}</select>`),
      row('dom','specific',      'Specific day of month (choose one or many)', '',
          s.mode === 'specific' ? chkGrid('dom', v, x => x, 'g10') : ''),
      row('dom','range',         'Every day between…',
          `Every day between day <select class="cb-sel" data-attr="rangeFrom" data-field="dom">${rf}</select> and day <select class="cb-sel" data-attr="rangeTo" data-field="dom">${rt}</select>`),
      row('dom','last',          'Last day of the month'),
      row('dom','nearestWeekday','Nearest weekday (Mon–Fri) to the…',
          `Nearest weekday to the <select class="cb-sel" data-attr="nearestWeekday" data-field="dom">${nw}</select> of the month`),
    ].join('');
  };

  const renderMonth = () => {
    const s  = state.month;
    const v  = rng(1, 12);
    const mL = x => MONTH_NAMES[x-1];
    const eN = opts(rng(2, 6), x => x, s.everyN);
    const st = opts(v, mL, s.everyStart);
    const rf = opts(v, mL, s.rangeFrom);
    const rt = opts(v, mL, s.rangeTo);
    return [
      row('month','every',    'Every month'),
      row('month','everyN',   'Every N month(s) starting in…',
          `Every <select class="cb-sel" data-attr="everyN" data-field="month">${eN}</select> month(s) starting in <select class="cb-sel" data-attr="everyStart" data-field="month">${st}</select>`),
      row('month','specific', 'Specific month (choose one or many)', '',
          s.mode === 'specific' ? chkGrid('month', v, mL, 'g6') : ''),
      row('month','range',    'Every month between…',
          `Every month between <select class="cb-sel" data-attr="rangeFrom" data-field="month">${rf}</select> and <select class="cb-sel" data-attr="rangeTo" data-field="month">${rt}</select>`),
    ].join('');
  };

  const renderYear = () => {
    const s  = state.year;
    const v  = rng(CY, CY + 20);
    const eN = opts(rng(2, 5), x => x, s.everyN);
    const st = opts(v, x => x, s.everyStart);
    const rf = opts(v, x => x, s.rangeFrom);
    const rt = opts(v, x => x, s.rangeTo);
    return [
      row('year','every',    'Every year'),
      row('year','everyN',   'Every N year(s) starting in…',
          `Every <select class="cb-sel" data-attr="everyN" data-field="year">${eN}</select> year(s) starting in <select class="cb-sel" data-attr="everyStart" data-field="year">${st}</select>`),
      row('year','specific', 'Specific year (choose one or many)', '',
          s.mode === 'specific' ? chkGrid('year', v, x => x, 'g6') : ''),
      row('year','range',    'Every year between…',
          `Every year between <select class="cb-sel" data-attr="rangeFrom" data-field="year">${rf}</select> and <select class="cb-sel" data-attr="rangeTo" data-field="year">${rt}</select>`),
    ].join('');
  };

  const renderPanel = (tab) => {
    const el = $(`panel-${tab}`);
    if (!el) return;
    const fn = {
      seconds: () => renderSimple('seconds'),
      minutes: () => renderSimple('minutes'),
      hours:   () => renderSimple('hours'),
      dom:  renderDom, month: renderMonth, year: renderYear,
    }[tab];
    if (fn) el.innerHTML = fn();
  };

  /* ── Output ─────────────────────────────────────── */
  const renderOutput = () => {
    const expr  = generate();
    const parts = expr.split(' ');
    $('cb-expr').textContent = expr;
    $('cb-desc').textContent = humanReadable();
    ['seconds','minutes','hours','dom','month','year'].forEach((k, i) => {
      const td = $(`bk-${k}`);
      if (td) { td.textContent = parts[i] || ''; td.className = k === state.tab ? 'hi' : ''; }
    });
  };

  /* ── Switch tab ─────────────────────────────────── */
  const switchTab = (tab) => {
    state.tab = tab;
    TABS.forEach(t => {
      const p  = $(`panel-${t}`);
      const tb = document.querySelector(`.cb-tab[data-tab="${t}"]`);
      if (p)  p.style.display = t === tab ? '' : 'none';
      if (tb) tb.classList.toggle('active', t === tab);
    });
    renderPanel(tab);
    renderOutput();
  };

  /* ── Clipboard ──────────────────────────────────── */
  const copyText = (text, cb) => {
    const done = () => { if (cb) cb(); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => { fb(text); done(); });
    else { fb(text); done(); }
  };
  const fb = t => {
    const ta = Object.assign(document.createElement('textarea'), { value: t });
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  };

  /* ── Event handling ─────────────────────────────── */
  const handleClick = (e) => {
    const tabEl = e.target.closest('.cb-tab[data-tab]');
    if (tabEl) { switchTab(tabEl.dataset.tab); return; }

    if (e.target.closest('#cb-copy-btn')) {
      const btn = $('cb-copy-btn');
      copyText(generate(), () => {
        btn.innerHTML = '<i data-icon="check"></i> Copied!'; btn.classList.add('ok');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 2000);
      });
      return;
    }

    if (e.target.closest('#cb-reset-btn')) { state = defaultState(); switchTab('seconds'); return; }

    const mini = e.target.closest('.cb-mini-btn[data-action][data-field]');
    if (mini) {
      const { action, field } = mini.dataset;
      const lim = { seconds:{a:0,z:59}, minutes:{a:0,z:59}, hours:{a:0,z:23},
                    dom:{a:1,z:31}, month:{a:1,z:12}, year:{a:CY,z:CY+20} }[field];
      if (!lim) return;
      if (action === 'all') for (let i = lim.a; i <= lim.z; i++) state[field].specific.add(i);
      else state[field].specific.clear();
      renderPanel(state.tab); renderOutput(); return;
    }

    const chk = e.target.closest('.cb-chk[data-field][data-v]');
    if (chk) {
      const { field, v } = chk.dataset; const val = Number(v);
      if (state[field].mode !== 'specific') state[field].mode = 'specific';
      if (state[field].specific.has(val)) state[field].specific.delete(val);
      else state[field].specific.add(val);
      renderPanel(state.tab); renderOutput(); return;
    }

    if (!e.target.closest('.cb-sel') && !e.target.closest('.cb-mini-btn')) {
      const opt = e.target.closest('.cb-option[data-mode][data-field]');
      if (opt && state[opt.dataset.field].mode !== opt.dataset.mode) {
        state[opt.dataset.field].mode = opt.dataset.mode;
        renderPanel(state.tab); renderOutput();
      }
    }
  };

  const handleChange = (e) => {
    const sel = e.target.closest('.cb-sel[data-attr][data-field]');
    if (!sel) return;
    state[sel.dataset.field][sel.dataset.attr] = Number(sel.value);
    renderOutput();
  };

  /* ── Init ───────────────────────────────────────── */
  const init = () => {
    TABS.forEach(t => renderPanel(t));
    switchTab('seconds');
    document.addEventListener('click',  handleClick);
    document.addEventListener('change', handleChange);
  };

  return { init };
})();

if (!Auth.requireAuth()) {}
Layout.render('cron-builder');
CronBuilder.init();

})();
