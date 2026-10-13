// som-portal-v2/src/scheduled-noti/store.ts
// CRUD for scheduled-noti.json — team-scoped. Admin only for writes.
// v1 parity: api/scheduled-noti/index.php

import { readTeamFile, writeTeamFile } from '@/team/scope';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { logActivity } from '@/logging/activity';
import { NotFoundError, ValidationError } from '@/lib/errors';
import {
  ScheduledJobsFileSchema,
  SCHEDULED_NOTI_FILE,
  type ScheduledJob,
  type ScheduledJobsFile,
  type CreateScheduledJob,
  type UpdateScheduledJob,
  CreateScheduledJobSchema,
  UpdateScheduledJobSchema,
} from './types';

function genId(): string {
  return 'noti_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface ListOpts {
  all?: boolean; // include disabled (admin only)
  isAdmin?: boolean;
}

/**
 * List scheduled jobs. Non-admin: only enabled, webhooks masked.
 */
export async function listJobs(opts: ListOpts = {}): Promise<ScheduledJob[]> {
  let items = await readTeamFile<ScheduledJobsFile>(SCHEDULED_NOTI_FILE, ScheduledJobsFileSchema);

  if (!opts.all) {
    items = items.filter((i) => i.enabled);
  }

  // Sort by time
  items.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  // Non-admin: mask webhook URLs
  if (!opts.isAdmin) {
    items = items.map((i) => ({
      ...i,
      google_chat_webhooks: [],
    }));
  }

  return items;
}

export async function getJob(id: string): Promise<ScheduledJob> {
  const items = await readTeamFile<ScheduledJobsFile>(SCHEDULED_NOTI_FILE, ScheduledJobsFileSchema);
  const found = items.find((i) => i.id === id);
  if (!found) throw new NotFoundError('Scheduled job not found');
  return found;
}

export async function createJob(input: CreateScheduledJob): Promise<ScheduledJob> {
  const session = await requireRole(...ADMIN_ROLES);
  const data = CreateScheduledJobSchema.parse(input);

  if (data.type === 'general' && !data.message) {
    throw new ValidationError('message is required for general type');
  }
  if (data.day_mode === 'monthly' && data.dates.length === 0) {
    throw new ValidationError('dates required for monthly mode');
  }

  const job: ScheduledJob = {
    ...data,
    id: genId(),
    shifts_today: data.shifts_today ?? [],
    shifts_tomorrow: data.shifts_tomorrow ?? [],
    created_at: new Date().toISOString(),
    created_by: session.username ?? session.sub,
  };

  const items = await readTeamFile<ScheduledJobsFile>(SCHEDULED_NOTI_FILE, ScheduledJobsFileSchema);
  items.push(job);
  await writeTeamFile(SCHEDULED_NOTI_FILE, items, ScheduledJobsFileSchema);

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'noti_schedule_created',
    meta: { noti_id: job.id, time: job.time, days: job.days.join(',') },
  });

  return job;
}

export async function updateJob(id: string, input: UpdateScheduledJob): Promise<ScheduledJob> {
  const session = await requireRole(...ADMIN_ROLES);
  const data = UpdateScheduledJobSchema.parse(input);

  const items = await readTeamFile<ScheduledJobsFile>(SCHEDULED_NOTI_FILE, ScheduledJobsFileSchema);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) throw new NotFoundError('Scheduled job not found');

  const item = items[idx];
  if (data.time !== undefined) item.time = data.time;
  if (data.day_mode !== undefined) item.day_mode = data.day_mode;
  if (data.days !== undefined) item.days = data.days;
  if (data.dates !== undefined) item.dates = data.dates;
  if (data.exclude_dates !== undefined) item.exclude_dates = data.exclude_dates;
  if (data.message !== undefined) item.message = data.message;
  if (data.action_label !== undefined) item.action_label = data.action_label;
  if (data.action_url !== undefined) item.action_url = data.action_url;
  if (data.google_chat_webhooks !== undefined) item.google_chat_webhooks = data.google_chat_webhooks;
  if (data.enabled !== undefined) item.enabled = data.enabled;
  if (data.shifts_today !== undefined) item.shifts_today = data.shifts_today;
  if (data.shifts_tomorrow !== undefined) item.shifts_tomorrow = data.shifts_tomorrow;
  item.updated_at = new Date().toISOString();
  item.updated_by = session.username ?? session.sub;

  items[idx] = item;
  await writeTeamFile(SCHEDULED_NOTI_FILE, items, ScheduledJobsFileSchema);

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'noti_schedule_updated',
    meta: { noti_id: id, fields: Object.keys(data).join(','), enabled: String(item.enabled) },
  });

  return item;
}

export async function deleteJob(id: string): Promise<void> {
  const session = await requireRole(...ADMIN_ROLES);
  const items = await readTeamFile<ScheduledJobsFile>(SCHEDULED_NOTI_FILE, ScheduledJobsFileSchema);
  const filtered = items.filter((i) => i.id !== id);
  if (filtered.length === items.length) throw new NotFoundError('Scheduled job not found');

  await writeTeamFile(SCHEDULED_NOTI_FILE, filtered, ScheduledJobsFileSchema);

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'noti_schedule_deleted',
    meta: { noti_id: id },
  });
}
