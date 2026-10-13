/* ══════════════════════════════════════════════════
   date-utils.js  |  Date utilities for Weekly Report
   Week starts on Tuesday (day 2)
   ══════════════════════════════════════════════════ */

const WeeklyDateUtils = {
  /**
   * Get the Tuesday of the week for a given date
   */
  getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon, 2=Tue
    const diff = day >= 2 ? day - 2 : day + 5;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  /**
   * Format date as YYYY-MM-DD
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Parse YYYY-MM-DD string to Date
   */
  parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  },

  /**
   * Get current week identifier (week-YYYY-MM-DD)
   */
  getCurrentWeek() {
    const weekStart = this.getWeekStart();
    return `week-${this.formatDate(weekStart)}`;
  },

  /**
   * Format week range display (e.g., "Apr 22 - Apr 28, 2026")
   */
  formatWeekRange(weekId) {
    const dateStr = weekId.replace('week-', '');
    const startDate = this.parseDate(dateStr);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);

    const options = { month: 'short', day: 'numeric' };
    const startStr = startDate.toLocaleDateString('en-US', options);
    const endStr = endDate.toLocaleDateString('en-US', options);
    const year = startDate.getFullYear();

    return `${startStr} - ${endStr}, ${year}`;
  },

  /**
   * Get previous week
   */
  getPreviousWeek(weekId) {
    const dateStr = weekId.replace('week-', '');
    const date = this.parseDate(dateStr);
    date.setDate(date.getDate() - 7);
    return `week-${this.formatDate(this.getWeekStart(date))}`;
  },

  /**
   * Get next week
   */
  getNextWeek(weekId) {
    const dateStr = weekId.replace('week-', '');
    const date = this.parseDate(dateStr);
    date.setDate(date.getDate() + 7);
    return `week-${this.formatDate(this.getWeekStart(date))}`;
  },

  /**
   * Check if week is current week
   */
  isCurrentWeek(weekId) {
    return weekId === this.getCurrentWeek();
  },

  /**
   * Get last N weeks
   */
  getLastNWeeks(n, fromDate = new Date()) {
    const weeks = [];
    let d = this.getWeekStart(fromDate);
    for (let i = 0; i < n; i++) {
      weeks.push(`week-${this.formatDate(d)}`);
      d = new Date(d);
      d.setDate(d.getDate() - 7);
    }
    return weeks;
  }
};
