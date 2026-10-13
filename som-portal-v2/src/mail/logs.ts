// som-portal-v2/src/mail/logs.ts
// Mail log viewer — v1 parity with api/mail/logs.php

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { readTeamFile } from '@/team/scope';
import { getDataAdapter } from '@/data/json-adapter';

const MAIL_LOGS_FILE = 'mail_logs.json';
/** v1 keeps the newest 2000 entries (api/mail/_mailer.php). */
const MAX_LOG_ENTRIES = 2000;

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


export interface ListMailLogsOpts {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listMailLogs(opts: ListMailLogsOpts = {}) {
  // One unreadable v1 row must not hide the rest, so rows are parsed one by one.
  const raw = await readTeamFile(MAIL_LOGS_FILE, z.array(z.unknown()));
  let logs = raw.flatMap((r) => {
    const parsed = MailLogEntrySchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
  logs = logs.reverse(); // newest first

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

export type NewMailLog = Omit<MailLogEntry, 'id' | 'sent_at'>;

/**
 * Append one send attempt to the team's mail_logs.json (v1 _mailer.php behaviour).
 * Locked read-modify-write. Rows this schema cannot read are kept as they are.
 */
export async function appendMailLog(team: string | null, entry: NewMailLog): Promise<void> {
  const row: MailLogEntry = {
    id: 'mlog_' + randomBytes(6).toString('hex'),
    sent_at: new Date().toISOString(),
    ...entry,
  };
  await getDataAdapter().update<unknown[]>({ team: team ?? '.' }, MAIL_LOGS_FILE, (raw) => {
    const rows = Array.isArray(raw) ? raw : [];
    return [...rows, row].slice(-MAX_LOG_ENTRIES);
  });
}
