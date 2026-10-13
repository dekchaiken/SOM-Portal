/* ══════════════════════════════════════════════════
   api.js  |  API communication for Weekly Report
   ══════════════════════════════════════════════════ */

const WeeklyReportAPI = {
  get baseURL() {
    // Auto-detect if we're in admin folder
    const inAdmin = /\/admin\//.test(window.location.pathname);
    return inAdmin ? '../api/weekly-report/' : './api/weekly-report/';
  },

  /**
   * Generic request wrapper
   */
  async request(endpoint, options = {}) {
    try {
      const response = await fetch(this.baseURL + endpoint, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.ok && data.error) {
        throw new Error(data.error);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  },

  /**
   * List all available weeks
   */
  async listWeeks() {
    return await this.request('list.php');
  },

  /**
   * Get week data (creates template if not exists)
   */
  async getWeek(weekId) {
    return await this.request(`get.php?week=${encodeURIComponent(weekId)}`);
  },

  /**
   * Save entry data
   */
  async saveEntry(payload) {
    return await this.request('save.php', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  /**
   * Delete week data
   */
  async deleteWeek(weekId) {
    return await this.request('delete.php', {
      method: 'POST',
      body: JSON.stringify({ week: weekId })
    });
  },

  /**
   * Get report data (monthly/yearly)
   */
  async getReport(params) {
    const query = new URLSearchParams(params);
    return await this.request(`report.php?${query}`);
  },

  /**
   * Get activity logs
   */
  async getLogs(filters = {}) {
    const params = new URLSearchParams(filters);
    return await this.request(`logs.php?${params}`);
  },

  /**
   * Log activity
   */
  async logActivity(activity) {
    return await this.request('logs.php', {
      method: 'POST',
      body: JSON.stringify(activity)
    });
  }
};
