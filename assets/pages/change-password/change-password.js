// change-password — page script, extracted from change-password.html.
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

/* ── Guard ── */
  const _tok = Auth.getToken();
  if (!_tok || Auth.isTokenExpired(_tok)) window.location.href = './index.html';

  /* ── Detect reason & user state ── */
  const _reason       = new URLSearchParams(window.location.search).get('reason');
  const _isExpired    = _reason === 'expired';
  const _isAdminReset = _reason === 'admin_reset';
  const _decoded      = Auth.decodeToken(_tok);
  const _isFirstLogin = _decoded?.first_login === true;
  // old_password required for any non-first-login, non-admin-reset user
  const _needsOldPw   = !_isFirstLogin && !_isAdminReset;

  if (_isExpired) {
    document.getElementById('page-title').innerHTML  = 'Set new<br>password';
    document.getElementById('brand-sub').textContent = 'PASSWORD EXPIRED';
    document.getElementById('status-pill').classList.add('red');
    document.getElementById('pill-text').textContent  = 'รหัสผ่านหมดอายุแล้ว';
    document.getElementById('pw-btn-text').textContent = 'Change Password & Continue';
  } else if (_isAdminReset) {
    document.getElementById('page-title').innerHTML  = 'Reset<br>password';
    document.getElementById('brand-sub').textContent = 'RESET REQUIRED';
    document.getElementById('status-pill').classList.add('red');
    document.getElementById('pill-text').textContent  = 'Admin ขอให้เปลี่ยนรหัสผ่าน';
    document.getElementById('pw-btn-text').textContent = 'Set New Password';
  } else {
    document.getElementById('pill-text').textContent = _isFirstLogin ? 'First Login' : 'Change Password';
  }

  if (_needsOldPw) {
    document.getElementById('old-pw-field').style.display = '';
  }

  /* ── Eye toggle ── */
  const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  const EYE_OFF  = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;

  document.querySelectorAll('.auth-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp  = document.getElementById(btn.dataset.target);
      const show = inp.type === 'password';
      inp.type   = show ? 'text' : 'password';
      btn.querySelector('svg').innerHTML = show ? EYE_OFF : EYE_OPEN;
    });
  });

  /* ── Password strength ── */
  const COMMON = [
    'password','12345678','qwerty123','admin123','11111111','00000000',
    '1234abcd','letmein1','welcome1','iloveyou','abc12345','monkey123',
    'dragon12','baseball','football','password1','passw0rd'
  ];

  function calcStrength(pw) {
    if (!pw || pw.length < 4) return 0;
    if (COMMON.includes(pw.toLowerCase())) return 1;
    let s = 0;
    if (pw.length >= 8)  s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[a-z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(4, Math.floor(s / 1.5));
  }

  const LEVELS = [
    { label: '—',      color: '#d4d4d4', pct:  0,  hint: '' },
    { label: 'Weak',   color: '#ef4444', pct: 25,  hint: 'คาดเดาง่ายมาก' },
    { label: 'Fair',   color: '#f97316', pct: 50,  hint: 'ปลอดภัยพอใช้' },
    { label: 'Good',   color: '#F26419', pct: 75,  hint: 'รหัสดี <i data-icon="check"></i>' },
    { label: 'Strong', color: '#16a34a', pct: 100, hint: 'รหัสแข็งแรง' },
  ];

  function updateStrength(pw) {
    const score = calcStrength(pw);
    const lv    = LEVELS[score];
    const fill  = document.getElementById('str-fill');
    fill.style.width      = lv.pct + '%';
    fill.style.background = lv.color;
    const lbl = document.getElementById('str-label');
    lbl.textContent = lv.label;
    lbl.style.color = lv.color;
    document.getElementById('str-hint').textContent = pw ? lv.hint : '';
    setRule('rule-len',    pw.length >= 8);
    setRule('rule-alpha',  /[a-zA-Z]/.test(pw));
    setRule('rule-num',    /[0-9]/.test(pw));
    setRule('rule-unique', pw.length > 0 && !COMMON.includes(pw.toLowerCase()));
  }

  function setRule(id, ok) {
    const el = document.getElementById(id);
    el.classList.toggle('pass', ok);
    el.classList.toggle('fail', el.classList.contains('fail') ? !ok : false);
  }

  document.getElementById('new-pw').addEventListener('input', e => updateStrength(e.target.value));

  /* ── Submit ── */
  function showError(msg) {
    const al   = document.getElementById('pw-alert');
    const card = document.getElementById('pw-card');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    al.classList.remove('show');
    void al.offsetWidth;
    al.textContent = msg;
    al.classList.add('show');
  }

  document.getElementById('pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const newPw  = document.getElementById('new-pw').value;
    const confPw = document.getElementById('confirm-pw').value;
    document.getElementById('pw-alert').classList.remove('show');

    if (newPw.length < 8)                          { showError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (!/[a-zA-Z]/.test(newPw))                   { showError('รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว'); return; }
    if (!/[0-9]/.test(newPw))                       { showError('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว'); return; }
    if (COMMON.includes(newPw.toLowerCase()))        { showError('รหัสผ่านนี้คาดเดาง่ายเกินไป กรุณาเลือกใหม่'); return; }
    if (newPw !== confPw)                            { showError('รหัสผ่านไม่ตรงกัน กรุณาพิมอีกครั้ง'); return; }
    if (_needsOldPw && !document.getElementById('old-pw').value) {
      showError('กรุณากรอกรหัสผ่านปัจจุบัน'); return;
    }

    const btn  = document.getElementById('pw-btn');
    const text = document.getElementById('pw-btn-text');
    const spin = document.getElementById('pw-spinner');
    btn.disabled = true; text.textContent = 'Saving...'; spin.classList.add('show');

    const payload = { new_password: newPw, confirm_password: confPw };
    if (_needsOldPw) payload.old_password = document.getElementById('old-pw').value;

    const res = await API.auth.changePassword(payload);

    btn.disabled = false;
    text.textContent = _isExpired ? 'Change Password & Continue' : 'Set Password & Continue';
    spin.classList.remove('show');

    if (res?.ok) {
      const user     = Auth.getUser();
      const newToken = res.data?.data?.token;
      if (newToken) Auth.setSession(newToken, { ...user, first_login: false, password_expired: false, must_reset_password: false });
      else          Auth.updateUser({ first_login: false, password_expired: false, must_reset_password: false });

      const overlay = document.getElementById('success-overlay');
      overlay.classList.add('show');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.getElementById('success-bar').style.width = '100%';
      }));
      setTimeout(() => {
        document.body.style.transition = 'opacity .35s ease';
        document.body.style.opacity    = '0';
        setTimeout(() => { window.location.href = Auth.homePath(); }, 360);
      }, 1600);
    } else {
      showError(res?.data?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
  });

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "calcStrength", { configurable: true, get: () => calcStrength, set: (v) => { calcStrength = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setRule", { configurable: true, get: () => setRule, set: (v) => { setRule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showError", { configurable: true, get: () => showError, set: (v) => { showError = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStrength", { configurable: true, get: () => updateStrength, set: (v) => { updateStrength = v; } }); } catch (e) {}
})();
