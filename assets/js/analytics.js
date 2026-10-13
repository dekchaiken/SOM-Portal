/**
 * Analytics Tracking
 * 
 * Automatically tracks:
 * - Page views
 * - Button clicks (data-track attribute)
 * - Feature usage
 */

class AnalyticsClient {
  constructor() {
    this.enabled = true;
    this.sessionId = this.getOrCreateSessionId();
    this._dead = false; // stop after 401 (session expired)
  }

  /**
   * Track page view
   */
  trackPageView(page = window.location.pathname) {
    if (!this.enabled) return;

    console.log('[Analytics] Tracking page view:', page);

    this.track('page_view', {
      page: page,
      referrer: document.referrer,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track feature usage
   */
  trackFeature(feature, metadata = {}) {
    if (!this.enabled) return;

    this.track('feature_use', {
      feature: feature,
      page: window.location.pathname,
      ...metadata,
    });
  }

  /**
   * Track action
   */
  trackAction(action, context = {}) {
    if (!this.enabled) return;

    this.track('action', {
      action: action,
      page: window.location.pathname,
      ...context,
    });
  }

  /**
   * Track button click
   */
  trackClick(element, label) {
    if (!this.enabled) return;

    this.trackAction('button_click', {
      element: element,
      label: label,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send tracking event to server
   */
  async track(eventType, data) {
    if (this._dead) return;
    try {
      const token = this.getToken();
      if (!token) return;

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      };

      if (window.csrf && window.csrf.getToken) {
        headers['X-CSRF-Token'] = await window.csrf.getToken();
      }

      // API_BASE resolved by api.js — works with any deploy folder name.
      const response = await fetch(`${API_BASE}/analytics/track.php`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ event_type: eventType, data: data }),
      });

      if (response.status === 401) { this._dead = true; return; } // session expired — stop tracking
      await response.json();
    } catch (error) {
      console.debug('[Analytics] Tracking failed:', error);
    }
  }

  /**
   * Get or create session ID
   */
  getOrCreateSessionId() {
    let sessionId = sessionStorage.getItem('analytics_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('analytics_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Get auth token
   */
  getToken() {
    return localStorage.getItem('som_token') || '';
  }

  /**
   * Enable tracking
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable tracking
   */
  disable() {
    this.enabled = false;
  }
}

// Global instance
window.analytics = new AnalyticsClient();

// Auto-track page views
document.addEventListener('DOMContentLoaded', () => {
  window.analytics.trackPageView();
});

// Auto-track clicks on elements with data-track attribute
document.addEventListener('click', (e) => {
  const element = e.target.closest('[data-track]');
  if (element) {
    const label = element.dataset.track;
    const elementType = element.tagName.toLowerCase();
    window.analytics.trackClick(elementType, label);
  }
});

// Track navigation (for SPAs)
let lastPath = window.location.pathname;
setInterval(() => {
  if (window.location.pathname !== lastPath) {
    lastPath = window.location.pathname;
    window.analytics.trackPageView();
  }
}, 1000);
