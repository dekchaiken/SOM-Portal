// som-portal-v2/src/scheduled-noti/jobs.ts
// Session-free access to a team's scheduled jobs. Used by the scheduler, which
// has no user session. Writes go through the data adapter like the store does.
import { getDataAdapter } from '@/data/json-adapter';
import { ScheduledJobsFileSchema, SCHEDULED_NOTI_FILE, type ScheduledJob } from './types';

export async function readTeamJobs(team: string): Promise<ScheduledJob[]> {
  const raw = await getDataAdapter().read<unknown>({ team }, SCHEDULED_NOTI_FILE);
  const parsed = ScheduledJobsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export async function recordJobRun(team: string, id: string, status: string): Promise<void> {
  const items = await readTeamJobs(team);
  const at = new Date().toISOString();
  const next = items.map((j) => (j.id === id ? { ...j, last_run: at, last_run_status: status } : j));
  await getDataAdapter().write({ team }, SCHEDULED_NOTI_FILE, next);
}

export async function listTeamsWithJobs(): Promise<string[]> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const { dataDirAbsolute } = await import('@/lib/env');
  const dir = dataDirAbsolute();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const teams: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const ok = await fs.access(path.join(dir, e.name, SCHEDULED_NOTI_FILE)).then(() => true, () => false);
    if (ok) teams.push(e.name);
  }
  return teams;
}
