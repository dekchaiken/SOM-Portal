// Shared sample data for all schedule-mockup previews.
// Matches production data shape: shift1_tdpk / shift1_wah / shift2_wah = ARRAYS
// of user ids (0..N people). shift1_oncall / shift2_oncall = single string.
// Each day may have an `events` array (e.g. "eod", "DS-TCB Transfer", meetings).

window.SCHED_SAMPLE = (() => {
  const YEAR = 2026, MONTH = 8; // August

  // 8-person team — realistic size for an SM ops team
  const TEAM = [
    { id: 'somchai', name: 'Somchai P.',       short: 'SM', color: '#f26419' },
    { id: 'warapon', name: 'Warapon L. (you)', short: 'WL', color: '#8b5cf6', me: true },
    { id: 'nid',     name: 'Nid K.',           short: 'NK', color: '#22c55e' },
    { id: 'pond',    name: 'Pond S.',          short: 'PS', color: '#3b82f6' },
    { id: 'ann',     name: 'Ann M.',           short: 'AM', color: '#ec4899' },
    { id: 'boat',    name: 'Boat T.',          short: 'BT', color: '#14b8a6' },
    { id: 'mike',    name: 'Mike C.',          short: 'MC', color: '#eab308' },
    { id: 'jib',     name: 'Jib R.',           short: 'JR', color: '#f43f5e' },
  ];
  const ids = TEAM.map(t => t.id);

  const daysInMonth = new Date(YEAR, MONTH, 0).getDate();

  // Deterministic pseudo-rotation: distributes people across slots
  // realistically — 2-3 people per TDPK/W@H slot, 1 on-call.
  function pick(day, offset, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(ids[(day * 3 + offset + i * 2) % ids.length]);
    }
    // Dedupe (rotation can collide with i * 2 wrap)
    return [...new Set(out)];
  }

  const shifts = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(YEAR, MONTH - 1, d).getDay();
    const weekend = dow === 0 || dow === 6;

    const s1_tdpk = weekend ? [] : pick(d, 0, 2 + (d % 2));       // 0 (weekend) or 2-3
    const s1_wah  = weekend ? pick(d, 3, 3 + (d % 2)) : pick(d, 3, 2 + (d % 2)); // more on weekend
    const s1_oc   = pick(d, 7, 1)[0];
    const s2_wah  = pick(d, 10, 2 + (d % 2));                     // 2-3
    const s2_oc   = pick(d, 14, 1)[0];

    // Events — a few days have EOD, meetings, transfers
    const events = [];
    if (!weekend && d <= 5) events.push('DS-TCB Transfer');
    if (d === 1 || d === 31) events.push('EOD');
    if (d === 3) events.push('[Call] SOM Monthly Meeting');
    if (d === 15) events.push('Release freeze window');
    if (d === 20) events.push('OnCall handover · 09:00');

    shifts[d] = { s1_tdpk, s1_wah, s1_oc, s2_wah, s2_oc, events };
  }

  // A handful of leaves scattered through the month
  const leaves = {
    5:  ['ann'],
    8:  ['pond'],
    12: ['somchai'],
    19: ['nid'],
    22: ['warapon'],
    26: ['ann', 'pond'],
  };

  // Thai holidays (Aug has Mother's Day on 12)
  const holidays = { 12: 'วันแม่แห่งชาติ' };

  // Coverage gaps (days where a slot is unfilled or has fewer than expected)
  const gaps = {
    12: ['s1_tdpk'], // holiday, TDPK is empty
    26: ['s1_oc'],   // double-leave day, on-call gap
  };

  // "Today" — pretend it's Fri Aug 15
  const TODAY = { year: YEAR, month: MONTH, day: 15, dow: new Date(YEAR, MONTH - 1, 15).getDay() };

  const SLOT_META = {
    s1_tdpk: { label: 'Shift#1 TDPK', short:'S1·TDPK', time: '09:00–21:00', color: '#f26419', kind: 's1' },
    s1_wah:  { label: 'Shift#1 W@H',  short:'S1·W@H',  time: '09:00–21:00', color: '#f26419', kind: 's1' },
    s1_oc:   { label: 'Shift#1 On Call', short:'S1·OC', time: '09:00–21:00', color: '#f59e0b', kind: 'oc' },
    s2_wah:  { label: 'Shift#2 W@H',  short:'S2·W@H',  time: '21:00–09:00 (+1)', color: '#8b5cf6', kind: 's2' },
    s2_oc:   { label: 'Shift#2 On Call', short:'S2·OC', time: '21:00–09:00 (+1)', color: '#a855f7', kind: 'oc2' },
  };

  function person(id) {
    return TEAM.find(t => t.id === id) || { id, name: '—', short: '?', color: '#999' };
  }

  // Check if a person is assigned to a slot (arrays for team slots, string for oncall)
  function isAssigned(day, slot, pid) {
    const v = shifts[day]?.[slot];
    if (Array.isArray(v)) return v.includes(pid);
    return v === pid;
  }

  // Get list of people for a slot (always returns array)
  function slotPeople(day, slot) {
    const v = shifts[day]?.[slot];
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }

  // Get all shifts a person has on a day (returns array of slot keys)
  function personDayShifts(day, pid) {
    return ['s1_tdpk','s1_wah','s1_oc','s2_wah','s2_oc'].filter(slot => isAssigned(day, slot, pid));
  }

  // Monthly stats per person — count each slot participation as 1 unit
  function stats() {
    const rows = TEAM.map(t => ({ ...t, s1_tdpk:0, s1_wah:0, s1_oc:0, s2_wah:0, s2_oc:0, total:0, leave:0 }));
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    for (let d = 1; d <= daysInMonth; d++) {
      Object.keys(SLOT_META).forEach(slot => {
        slotPeople(d, slot).forEach(pid => {
          if (byId[pid] && !(leaves[d] || []).includes(pid)) {
            byId[pid][slot]++;
            byId[pid].total++;
          }
        });
      });
    }
    Object.entries(leaves).forEach(([d, ids]) => ids.forEach(id => { if (byId[id]) byId[id].leave++; }));
    return rows;
  }

  return {
    YEAR, MONTH, daysInMonth, TEAM,
    SLOTS: Object.keys(SLOT_META), SLOT_META,
    shifts, leaves, holidays, gaps, TODAY,
    person, isAssigned, slotPeople, personDayShifts, stats,
  };
})();
