// Thin fetch wrapper. Token is kept in localStorage so the session survives reloads.
const API = {
  token: null,

  init() {
    try { this.token = localStorage.getItem('sr_token'); } catch { this.token = null; }
  },

  setToken(t) {
    this.token = t;
    try {
      if (t) localStorage.setItem('sr_token', t);
      else localStorage.removeItem('sr_token');
    } catch { /* storage blocked: session lasts for this page only */ }
  },

  async req(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get(url) { return this.req('GET', url); },
  post(url, body) { return this.req('POST', url, body ?? {}); },
  put(url, body) { return this.req('PUT', url, body ?? {}); },
  del(url) { return this.req('DELETE', url); },
};
