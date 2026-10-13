/**
 * CSRF Token Management
 * 
 * Automatically includes CSRF token in all mutating requests
 * (POST, PUT, DELETE, PATCH)
 */

class CsrfManager {
  constructor() {
    this.token = null;
    this.cookieName = 'csrf_token';
  }

  /**
   * Read the current CSRF token from the double-submit cookie.
   * The cookie is populated by api.js's _csrfEnsure() or the first call to
   * /api/csrf/generate.php — we do NOT hardcode a URL here (used to be a
   * `/centralize-som/…` path from an old deploy, which 404'd on root installs
   * and left this.token null, causing 403 on any raw fetch()).
   */
  _readTokenFromCookie() {
    const m = document.cookie.match(/(?:^|; )csrf_token=([^;]+)/);
    this.token = m ? decodeURIComponent(m[1]) : null;
    return this.token;
  }

  /**
   * Initialize — pick up whatever token is already in the cookie. If the
   * cookie is empty, ask the server to mint one. Uses a path relative to
   * where this script lives so it works on any deploy root.
   */
  async init() {
    if (this._readTokenFromCookie()) return;
    try {
      // Resolve /api/csrf/generate.php relative to this script's location,
      // so it works whether the app is served at "/" or under a subpath.
      const script = document.querySelector('script[src*="csrf.js"]');
      const base = script ? script.src.replace(/assets\/js\/csrf\.js.*$/, '') : '/';
      const response = await fetch(base + 'api/csrf/generate.php', {
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.success && data?.data?.token) this.token = data.data.token;
      // Cookie will now be set by the server; keep in sync.
      this._readTokenFromCookie();
    } catch { /* silent — the cookie fallback below still works */ }
  }

  /**
   * Get current token
   */
  getToken() {
    return this._readTokenFromCookie();
  }

  /**
   * Add CSRF token to fetch options
   */
  addTokenToFetch(options = {}) {
    // Always re-read the cookie so a rotated token (login/logout) is picked up.
    this._readTokenFromCookie();
    if (!this.token) {
      // Silently skip if token not available (endpoint might not exist yet)
      return options;
    }

    // Only add for mutating methods
    const method = (options.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return options;
    }

    // Add to headers
    options.headers = options.headers || {};
    options.headers['X-CSRF-Token'] = this.token;

    // Also add to body if JSON
    if (options.body && typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body);
        body.csrf_token = this.token;
        options.body = JSON.stringify(body);
      } catch (e) {
        // Not JSON, skip
      }
    }

    return options;
  }

  /**
   * Wrap fetch to automatically include CSRF token
   */
  fetch(url, options = {}) {
    options = this.addTokenToFetch(options);
    return fetch(url, options);
  }

  /**
   * Rotate token (call after login/logout)
   */
  async rotate() {
    await this.init();
  }
}

// Global instance
window.csrfManager = new CsrfManager();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.csrfManager.init();
});

// Override global fetch to include CSRF token
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  // Only intercept API calls — matches any URL containing "/api/" so it
  // works regardless of the deploy folder name.
  if (typeof url === 'string' && url.includes('/api/')) {
    options = window.csrfManager.addTokenToFetch(options);
  }
  return originalFetch(url, options);
};
