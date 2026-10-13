// som-portal-v2/src/inbox/mailbox.ts
// IMAP access to a team mailbox (v1 api/inbox/_helpers.php inbox_connect). Each call
// connects, does its work, and logs out, as v1 does. The host is derived from the
// team's SMTP host (smtp.gmail.com -> imap.gmail.com). Port 993 over TLS.
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { MailConfig } from '@/mail/mail-config';

export const IMAP_TIMEOUT_MS = 20_000;

export interface MessageSummary {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
}

export interface ListResult {
  folder: string;
  total: number;
  unread: number;
  limit: number;
  offset: number;
  items: MessageSummary[];
}

export interface MessageDetail extends MessageSummary {
  to: string[];
  cc: string[];
  messageId: string;
  references: string[];
  /** Plain-text body. */
  text: string;
  /** Raw HTML body. Show it only inside a sandboxed frame. */
  html: string;
  attachments: { filename: string; size: number }[];
}

export interface FolderInfo {
  path: string;
  name: string;
}

export type FlagName = 'seen' | 'flagged' | 'answered';

export interface MailboxClient {
  folders(): Promise<FolderInfo[]>;
  list(folder: string, opts: { limit: number; offset: number; unreadOnly: boolean }): Promise<ListResult>;
  read(folder: string, uid: number): Promise<MessageDetail | null>;
  setFlag(folder: string, uid: number, flag: FlagName, on: boolean): Promise<void>;
  move(folder: string, uid: number, target: string): Promise<void>;
}

export class MailboxError extends Error {}

/** smtp.gmail.com -> imap.gmail.com. Other hosts follow the same smtp. -> imap. rule. */
export function imapHostFor(cfg: Pick<MailConfig, 'smtp_host'>): string {
  return cfg.smtp_host.trim().replace(/^smtp\./i, 'imap.');
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailboxError(`${label} timed out. The mail server did not answer.`)), IMAP_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function addr(list: { name?: string; address?: string }[] | undefined): string {
  const first = list?.[0];
  if (!first) return '';
  return first.name ? `${first.name} <${first.address ?? ''}>` : (first.address ?? '');
}

function summaryOf(m: FetchMessageObject): MessageSummary {
  const flags = m.flags ?? new Set<string>();
  return {
    uid: m.uid,
    subject: m.envelope?.subject ?? '(no subject)',
    from: addr(m.envelope?.from),
    date: new Date(m.internalDate ?? m.envelope?.date ?? 0).toISOString(),
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    answered: flags.has('\\Answered'),
  };
}

/** Real IMAP client for one team mailbox. */
export function createImapClient(cfg: MailConfig, password: string): MailboxClient {
  const host = imapHostFor(cfg);

  async function session<T>(work: (c: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host,
      port: 993,
      secure: true,
      auth: { user: cfg.smtp_user || cfg.from_email, pass: password },
      logger: false,
    });
    try {
      return await withTimeout(
        (async () => {
          await client.connect();
          return work(client);
        })(),
        'Connecting to the mailbox',
      );
    } catch (e) {
      if (e instanceof MailboxError) throw e;
      throw new MailboxError(`Could not read the team mailbox: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  return {
    async folders() {
      return session(async (c) => {
        const list = await c.list();
        return list.map((f) => ({ path: f.path, name: f.name }));
      });
    },

    async list(folder, { limit, offset, unreadOnly }) {
      return session(async (c) => {
        const lock = await c.getMailboxLock(folder);
        try {
          const found = await c.search(unreadOnly ? { seen: false } : { all: true }, { uid: true });
          const all = found === false ? [] : [...found].sort((a, b) => b - a);
          const pageUids = all.slice(offset, offset + limit);
          const items: MessageSummary[] = [];
          if (pageUids.length > 0) {
            for await (const m of c.fetch(pageUids, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true })) {
              items.push(summaryOf(m));
            }
          }
          items.sort((a, b) => b.uid - a.uid);
          const status = await c.status(folder, { unseen: true });
          return { folder, total: all.length, unread: status.unseen ?? 0, limit, offset, items };
        } finally {
          lock.release();
        }
      });
    },

    async read(folder, uid) {
      return session(async (c) => {
        const lock = await c.getMailboxLock(folder);
        try {
          const m = await c.fetchOne(String(uid), { uid: true, source: true, flags: true, envelope: true, internalDate: true }, { uid: true });
          if (!m || !m.source) return null;
          const parsed = await simpleParser(m.source);
          const summary = summaryOf(m);
          const toList = (v: typeof parsed.to): string[] => (v ? (Array.isArray(v) ? v : [v]).flatMap((x) => x.value.map((a) => a.address ?? '')) : []);
          return {
            ...summary,
            from: parsed.from?.text ?? summary.from,
            subject: parsed.subject ?? summary.subject,
            date: (parsed.date ?? new Date(summary.date)).toISOString(),
            to: toList(parsed.to),
            cc: toList(parsed.cc),
            messageId: parsed.messageId ?? '',
            references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
            text: parsed.text ?? '',
            html: typeof parsed.html === 'string' ? parsed.html : '',
            attachments: parsed.attachments.map((a: { filename?: string; size: number }) => ({ filename: a.filename ?? 'attachment', size: a.size })),
          };
        } finally {
          lock.release();
        }
      });
    },

    async setFlag(folder, uid, flag, on) {
      const name = flag === 'seen' ? '\\Seen' : flag === 'flagged' ? '\\Flagged' : '\\Answered';
      return session(async (c) => {
        const lock = await c.getMailboxLock(folder);
        try {
          if (on) await c.messageFlagsAdd(String(uid), [name], { uid: true });
          else await c.messageFlagsRemove(String(uid), [name], { uid: true });
        } finally {
          lock.release();
        }
      });
    },

    async move(folder, uid, target) {
      return session(async (c) => {
        const lock = await c.getMailboxLock(folder);
        try {
          await c.messageMove(String(uid), target, { uid: true });
        } finally {
          lock.release();
        }
      });
    },
  };
}
