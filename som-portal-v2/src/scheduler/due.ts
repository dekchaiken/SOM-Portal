// som-portal-v2/src/scheduler/due.ts
// Same rules as v1 assets/js/noti-scheduler.js _check().
import type { ScheduledJob } from '@/scheduled-noti/types';
import type { BangkokClock } from './clock';

export function isJobDue(job: ScheduledJob, clock: BangkokClock): boolean {
  if (!job.enabled) return false;
  if (job.time !== clock.hhmm) return false;
  if (job.day_mode === 'monthly') {
    if (!job.dates.includes(clock.dom)) return false;
  } else {
    const days = job.days.length ? job.days : ['mon', 'tue', 'wed', 'thu', 'fri'];
    if (!days.includes('all') && !days.includes(clock.weekday)) return false;
  }
  return !job.exclude_dates.includes(clock.dom);
}
