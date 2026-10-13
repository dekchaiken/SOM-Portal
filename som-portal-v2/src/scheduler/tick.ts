// som-portal-v2/src/scheduler/tick.ts
// One scheduler pass: scheduled notification jobs, then the daily Restart
// Monitor run at 09:00 Bangkok (v1 cron/restart-monitor-run-all.php).
import { readRawReport } from '@/restart-monitor/raw-store';
import { readWebhooks, sendRestartWebhook } from '@/restart-monitor/webhooks';
import { listRunways } from '@/restart-monitor/runways';
import type { Session } from '@/auth/session';
import { bangkokClock, type BangkokClock } from './clock';
import { isJobDue } from './due';
import { acquireTickLock } from './lock';
import { hasFired, markFired } from './state';
import { executeJob } from '@/scheduled-noti/runner';
import { listTeamsWithJobs, readTeamJobs, recordJobRun } from '@/scheduled-noti/jobs';

const RESTART_DAILY_TIME = '09:00';
const SYSTEM_TEAM = 'sm';

export const SYSTEM_SESSION: Session = {
  sub: 'system:scheduler',
  username: 'scheduler',
  role: 'super_admin',
  team: SYSTEM_TEAM,
};

function log(message: string, meta?: unknown): void {
  console.info(`[scheduler] ${message}`, meta ?? '');
}

async function runDueScheduledJobs(clock: BangkokClock): Promise<void> {
  for (const team of await listTeamsWithJobs()) {
    for (const job of await readTeamJobs(team)) {
      if (!isJobDue(job, clock)) continue;
      const key = `noti:${team}:${job.id}:${clock.date}:${clock.hhmm}`;
      if (await hasFired(key)) continue;
      await markFired(key);
      let ok = false;
      try {
        const result = await executeJob(job);
        ok = result.ok;
        log(`job ${job.id} (${job.type}) ${ok ? 'ok' : 'failed'}`, result.message);
      } catch (e) {
        log(`job ${job.id} threw`, String(e));
      }
      await recordJobRun(team, job.id, ok ? 'ok' : 'failed');
    }
  }
}

async function runRestartDaily(clock: BangkokClock): Promise<void> {
  if (clock.hhmm !== RESTART_DAILY_TIME) return;
  const key = `restart-daily:${clock.date}`;
  if (await hasFired(key)) return;
  await markFired(key);

  const { triggerFetch } = await import('@/restart-monitor/service');
  const { results } = await triggerFetch(SYSTEM_SESSION, undefined, clock.date);
  const config = await readWebhooks();
  const runways = await listRunways();

  for (const r of results) {
    if (r.status !== 'done') {
      log(`restart ${r.runway}: ${r.status}`, r.reason);
      continue;
    }
    const runway = runways.find((x) => x.name === r.runway);
    if (!runway) continue;
    const url =
      (runway.chatWebhookEnv ? process.env[runway.chatWebhookEnv] : undefined) ??
      config.webhooks[runway.slug] ??
      config.webhooks[runway.name] ??
      '';
    const report = await readRawReport(SYSTEM_TEAM, runway.slug, clock.date);
    if (!report) continue;
    const sent = await sendRestartWebhook(url, report);
    log(`restart ${runway.name} notify`, sent);
  }
}

export async function tick(now: Date = new Date()): Promise<void> {
  const release = await acquireTickLock();
  if (!release) return;
  try {
    const clock = bangkokClock(now);
    await runDueScheduledJobs(clock);
    await runRestartDaily(clock);
  } finally {
    await release();
  }
}
