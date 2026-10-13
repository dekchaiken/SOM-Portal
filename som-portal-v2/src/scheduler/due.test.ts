import { describe, expect, it } from 'vitest';
import { bangkokClock } from './clock';
import { isJobDue } from './due';
import type { ScheduledJob } from '@/scheduled-noti/types';

const base: ScheduledJob = {
  id: 'noti_1',
  type: 'general',
  time: '09:00',
  day_mode: 'weekly',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  dates: [],
  exclude_dates: [],
  message: '',
  action_label: '',
  action_url: '',
  google_chat_webhooks: [],
  enabled: true,
  shifts_today: [],
  shifts_tomorrow: [],
  created_at: '2026-01-01T00:00:00Z',
  created_by: '',
};

// 2026-10-12 is a Monday; 02:00 UTC is 09:00 in Bangkok.
const mon0900 = bangkokClock(new Date('2026-10-12T02:00:00Z'));

describe('bangkokClock', () => {
  it('reads date, time, weekday and day of month in Asia/Bangkok', () => {
    expect(mon0900).toEqual({ date: '2026-10-12', hhmm: '09:00', weekday: 'mon', dom: 12 });
  });

  it('rolls over at Bangkok midnight, not UTC midnight', () => {
    const c = bangkokClock(new Date('2026-10-12T17:30:00Z'));
    expect(c.date).toBe('2026-10-13');
    expect(c.hhmm).toBe('00:30');
  });
});

describe('isJobDue', () => {
  it('fires a weekly job on a selected weekday at its time', () => {
    expect(isJobDue(base, mon0900)).toBe(true);
  });

  it('does not fire on an unselected weekday', () => {
    const sat = bangkokClock(new Date('2026-10-17T02:00:00Z'));
    expect(isJobDue(base, sat)).toBe(false);
  });

  it('does not fire at another minute', () => {
    expect(isJobDue(base, { ...mon0900, hhmm: '09:01' })).toBe(false);
  });

  it('fires a monthly job only on its dates', () => {
    const job = { ...base, day_mode: 'monthly' as const, dates: [12] };
    expect(isJobDue(job, mon0900)).toBe(true);
    expect(isJobDue({ ...job, dates: [1] }, mon0900)).toBe(false);
  });

  it('skips excluded day-of-month dates', () => {
    expect(isJobDue({ ...base, exclude_dates: [12] }, mon0900)).toBe(false);
  });

  it('never fires disabled jobs', () => {
    expect(isJobDue({ ...base, enabled: false }, mon0900)).toBe(false);
  });

  it('treats the "all" day token as every day', () => {
    const sat = bangkokClock(new Date('2026-10-17T02:00:00Z'));
    expect(isJobDue({ ...base, days: ['all'] }, sat)).toBe(true);
  });
});
