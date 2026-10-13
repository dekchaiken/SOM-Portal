// som-portal-v2/src/scheduled-noti/types.ts
// Zod schemas for scheduled notification jobs — v1 parity with api/scheduled-noti/index.php

import { z } from 'zod';

export const ScheduledJobTypeSchema = z.enum(['general', 'shift_summary', 'grafana_paused']);
export type ScheduledJobType = z.infer<typeof ScheduledJobTypeSchema>;

export const DayModeSchema = z.enum(['weekly', 'monthly']);

export const ScheduledJobSchema = z.object({
  id: z.string(),
  type: ScheduledJobTypeSchema.default('general'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM'),
  day_mode: DayModeSchema.default('weekly'),
  days: z.array(z.string()).default(['mon', 'tue', 'wed', 'thu', 'fri']),
  dates: z.array(z.number().min(1).max(31)).default([]),
  exclude_dates: z.array(z.number().min(1).max(31)).default([]),
  message: z.string().default(''),
  action_label: z.string().default(''),
  action_url: z.string().default(''),
  google_chat_webhooks: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  shifts_today: z.array(z.unknown()).default([]),
  shifts_tomorrow: z.array(z.unknown()).default([]),
  last_run: z.string().optional(),
  last_run_status: z.string().optional(),
  created_at: z.string(),
  created_by: z.string().default(''),
  updated_at: z.string().optional(),
  updated_by: z.string().optional(),
});

export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

export const ScheduledJobsFileSchema = z.array(ScheduledJobSchema).default([]);
export type ScheduledJobsFile = z.infer<typeof ScheduledJobsFileSchema>;

export const SCHEDULED_NOTI_FILE = 'scheduled-noti.json';

export const CreateScheduledJobSchema = z.object({
  type: ScheduledJobTypeSchema.default('general'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM'),
  day_mode: DayModeSchema.default('weekly'),
  days: z.array(z.string()).default(['mon', 'tue', 'wed', 'thu', 'fri']),
  dates: z.array(z.number().min(1).max(31)).default([]),
  exclude_dates: z.array(z.number().min(1).max(31)).default([]),
  message: z.string().default(''),
  action_label: z.string().default(''),
  action_url: z.string().default(''),
  google_chat_webhooks: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  shifts_today: z.array(z.unknown()).optional(),
  shifts_tomorrow: z.array(z.unknown()).optional(),
});

export type CreateScheduledJob = z.infer<typeof CreateScheduledJobSchema>;

export const UpdateScheduledJobSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  day_mode: DayModeSchema.optional(),
  days: z.array(z.string()).optional(),
  dates: z.array(z.number().min(1).max(31)).optional(),
  exclude_dates: z.array(z.number().min(1).max(31)).optional(),
  message: z.string().optional(),
  action_label: z.string().optional(),
  action_url: z.string().optional(),
  google_chat_webhooks: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  shifts_today: z.array(z.unknown()).optional(),
  shifts_tomorrow: z.array(z.unknown()).optional(),
});

export type UpdateScheduledJob = z.infer<typeof UpdateScheduledJobSchema>;
