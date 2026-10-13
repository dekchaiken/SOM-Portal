// index — page script, extracted from index.html.
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

const _isExtendFlow = new URLSearchParams(window.location.search).get('reason') === 'extend';

  if (_isExtendFlow) {
    localStorage.removeItem(Auth.TOKEN_KEY);
    localStorage.removeItem(Auth.USER_KEY);
    localStorage.removeItem('csrf_token');
    document.getElementById('extend-notice').classList.add('show');
  }

  if (!_isExtendFlow && Auth.getToken() && !Auth.isTokenExpired(Auth.getToken())) {
    const user = Auth.getUser();
    window.location.href = user?.first_login ? './change-password.html' : Auth.homePath();
  }

  // ── Account Picker ─────────────────────────────────────────
  const AccountPicker = {
    STORAGE_KEY: 'som_saved_accounts',
    MAX: 5,
    _mode: 'full', // 'picker' | 'pw' | 'full'

    get() {
      try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); }
      catch { return []; }
    },

    save(username, name) {
      const list = this.get().filter(a => a.username !== username);
      const raw  = (name || username).trim();
      const initials = raw.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || username.slice(0, 2).toUpperCase();
      list.unshift({ username, name: raw, initials });
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list.slice(0, this.MAX)));
    },

    remove(username) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.get().filter(a => a.username !== username)));
    },

    _esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },

    init() {
      const accounts = this.get();
      if (!accounts.length) return;
      this._render(accounts);
      this._showPicker();

      document.getElementById('acct-another-btn').addEventListener('click', () => this._showFull());
      document.getElementById('acct-who-row').addEventListener('click', () => {
        this.get().length ? this._showPicker() : this._showFull();
      });
    },

    _render(accounts) {
      const list = document.getElementById('acct-list');
      list.innerHTML = '';
      accounts.forEach(acct => {
        const card = document.createElement('div');
        card.className = 'acct-card';
        card.innerHTML = `
          <div class="acct-avatar">${this._esc(acct.initials)}</div>
          <div class="acct-info">
            <div class="acct-name">${this._esc(acct.name)}</div>
            <div class="acct-user">${this._esc(acct.username)}</div>
          </div>
          <svg class="acct-arrow" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          <button type="button" class="acct-remove" title="Remove">✕</button>
        `;
        card.addEventListener('click', (e) => {
          if (e.target.closest('.acct-remove')) return;
          this._selectAccount(acct);
        });
        card.querySelector('.acct-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          this.remove(acct.username);
          const remaining = this.get();
          remaining.length ? this._render(remaining) : this._showFull();
        });
        list.appendChild(card);
      });
    },

    _selectAccount(acct) {
      document.getElementById('username').value           = acct.username;
      document.getElementById('acct-who-av').textContent   = acct.initials;
      document.getElementById('acct-who-name').textContent = acct.name;
      document.getElementById('acct-picker').style.display    = 'none';
      document.getElementById('username-field').style.display = 'none';
      document.getElementById('acct-who-row').style.display   = '';
      document.getElementById('login-form').style.display     = '';
      document.getElementById('login-sub').textContent = 'Enter your password to continue';
      document.getElementById('password').focus();
      this._mode = 'pw';
    },

    _showPicker() {
      this._render(this.get());
      document.getElementById('acct-picker').style.display    = '';
      document.getElementById('login-form').style.display     = 'none';
      document.getElementById('login-sub').textContent = 'Choose an account to continue';
      this._mode = 'picker';
    },

    _showFull() {
      document.getElementById('acct-picker').style.display    = 'none';
      document.getElementById('username-field').style.display = '';
      document.getElementById('acct-who-row').style.display   = 'none';
      document.getElementById('login-form').style.display     = '';
      document.getElementById('login-sub').textContent = 'Sign in to continue to your workspace';
      const _rem = localStorage.getItem('som_remember_user');
      document.getElementById('username').value      = _rem || '';
      document.getElementById('remember-me').checked = !!_rem;
      document.getElementById('username').focus();
      this._mode = 'full';
    },
  };

  AccountPicker.init();

  // Pre-fill remembered username only if no picker is active
  if (AccountPicker._mode === 'full') {
    const _remembered = localStorage.getItem('som_remember_user');
    if (_remembered) {
      document.getElementById('username').value      = _remembered;
      document.getElementById('remember-me').checked = true;
    }
  }

  // Eye toggle
  const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  const EYE_OFF  = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
  document.getElementById('pw-eye').addEventListener('click', () => {
    const inp  = document.getElementById('password');
    const show = inp.type === 'password';
    inp.type   = show ? 'text' : 'password';
    document.getElementById('pw-eye').querySelector('svg').innerHTML = show ? EYE_OFF : EYE_OPEN;
  });

  function showSuccess(name, dest) {
    document.getElementById('success-name').textContent = 'Welcome, ' + name;
    document.getElementById('success-overlay').classList.add('show');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById('success-bar').style.width = '100%';
    }));
    setTimeout(() => {
      document.body.style.transition = 'opacity .35s ease';
      document.body.style.opacity    = '0';
      try { sessionStorage.setItem('som_login_intro', '1'); } catch {}
      setTimeout(() => { window.location.href = dest; }, 360);
    }, 1600);
  }

  function showError(msg) {
    const alert = document.getElementById('login-alert');
    const card  = document.getElementById('login-card');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    alert.classList.remove('show');
    void alert.offsetWidth;
    alert.textContent = msg;
    alert.classList.add('show');
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn  = document.getElementById('login-btn');
    const text = document.getElementById('login-btn-text');
    const spin = document.getElementById('login-spinner');

    btn.disabled = true; text.textContent = 'Signing in...'; spin.classList.add('show');
    document.getElementById('login-alert').classList.remove('show');

    const res = await API.auth.login({
      username:    document.getElementById('username').value.trim(),
      password:    document.getElementById('password').value,
      remember_me: document.getElementById('remember-me').checked,
    });

    btn.disabled = false; text.textContent = 'Sign In'; spin.classList.remove('show');

    if (res?.ok) {
      const { token, user, csrf_token } = res.data.data;
      Auth.setSession(token, user);
      if (csrf_token) localStorage.setItem('csrf_token', csrf_token);

      if (document.getElementById('remember-me').checked) {
        localStorage.setItem('som_remember_user', document.getElementById('username').value.trim());
      } else {
        localStorage.removeItem('som_remember_user');
      }

      // Save account to picker list
      AccountPicker.save(
        document.getElementById('username').value.trim(),
        user.name || user.username
      );

      const _sp   = new URLSearchParams(window.location.search);
      const _ret  = _sp.get('return');
      const _dest = user.first_login
        ? './change-password.html'
        : (_ret && _ret.startsWith(window.location.origin) ? _ret : Auth.homePath());
      showSuccess(user.name || user.username, _dest);
    } else {
      showError(res?.data?.message || 'Invalid username or password.');
    }
  });

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "showError", { configurable: true, get: () => showError, set: (v) => { showError = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showSuccess", { configurable: true, get: () => showSuccess, set: (v) => { showSuccess = v; } }); } catch (e) {}
})();
