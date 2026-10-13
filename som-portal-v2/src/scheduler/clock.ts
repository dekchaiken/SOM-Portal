// som-portal-v2/src/scheduler/clock.ts
// Schedules are written in Bangkok time, so the clock is read in that zone.

export interface BangkokClock {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  hhmm: string;
  /** mon, tue, ... */
  weekday: string;
  /** day of month, 1-31 */
  dom: number;
}

export function bangkokClock(now: Date = new Date()): BangkokClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${get('hour')}:${get('minute')}`,
    weekday: get('weekday').slice(0, 3).toLowerCase(),
    dom: Number(get('day')),
  };
}
