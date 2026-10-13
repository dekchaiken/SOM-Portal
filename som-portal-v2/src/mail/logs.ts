// som-portal-v2/src/mail/logs.ts
// Mail log viewer — v1 parity with api/mail/logs.php

import { z } from 'zod';
import { readTeamFile } from '@/team/scope';

const MAIL_LOGS_FILE = 'mail_logs.json';

export const MailLogEntrySchema = z.object({
  id: z.string(),
  sent_at: z.string(),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string().default(''),
  type: z.string().default('html'),
  status: z.string().default('sent'),
  error: z.string().default(''),
  sent_by: z.string().default(''),
  sent_by_name: z.string().default(''),
});

export type MailLogEntry = z.infer<typeof MailLogEntrySchema>;

const MailLogsFileSchema = z.array(MailLogEntrySchema).default([]);

export interface ListMailLogsOpts {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listMailLogs(opts: ListMailLogsOpts = {}) {
  let logs = await readTeamFile(MAIL_LOGS_FILE, MailLogsFileSchema);
  logs = [...logs].reverse(); // newest first

  const search = (opts.search ?? '').toLowerCase().trim();
  if (search) {
    logs = logs.filter(
      (l) =>
        l.subject.toLowerCase().includes(search) ||
        l.to.join(',').toLowerCase().includes(search) ||
        l.sent_by_name.toLowerCase().includes(search),
    );
  }

  if (opts.status) {
    logs = logs.filter((l) => l.status === opts.status);
  }

  const total = logs.length;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = logs.filter((l) => l.sent_at.startsWith(today)).length;
  const failedCount = logs.filter((l) => l.status === 'failed').length;

  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const page = logs.slice(offset, offset + limit);

  return { logs: page, total, today: todayCount, failed: failedCount, limit, offset };
}
