// som-portal-v2/src/inbox/service.ts
// Team inbox: every call uses the signed-in user's team mailbox. No other team's
// mailbox is reachable from here, and a team without a mailbox gets a clear message.
import type { Session } from '@/auth/session';
import { ValidationError } from '@/lib/errors';
import { resolveMailConfig, resolveSmtpPassword } from '@/mail/mail-config';
import { sendMail } from '@/mail/mailer';
import { createImapClient, type FlagName, type ListResult, type MailboxClient, type MessageDetail } from './mailbox';
import { sanitizeLessonHtml } from '@/learn/sanitize';
import { parseRecipients } from '@/mail/recipients';

/** Recipients typed in a form. Throws a clear message when one address is not valid. */
export function parseRecipientsOrThrow(input: string): string[] {
  const { valid, invalid } = parseRecipients(input);
  if (invalid.length) throw new ValidationError(`Not a valid address: ${invalid.join(', ')}`);
  if (valid.length === 0) throw new ValidationError('Add at least one recipient');
  return valid;
}

const DEFAULT_FOLDER = 'INBOX';
const DASHBOARD_ITEMS = 5;

let injected: MailboxClient | null = null;

/** Test seam: unit tests pass a fake mailbox. Pass null to restore the real IMAP client. */
export function __setMailboxClient(c: MailboxClient | null): void {
  injected = c;
}

async function withTeamMailbox<T>(session: Session, fn: (c: MailboxClient) => Promise<T>): Promise<T> {
  if (injected) return fn(injected);
  const { config, configured } = await resolveMailConfig(session.team);
  if (!configured) {
    throw new ValidationError('This team has no mailbox set up. Ask a team admin to fill in Mail Config.');
  }
  const password = resolveSmtpPassword(config);
  if (!password) {
    throw new ValidationError('The mailbox password is not saved yet. Ask a team admin to save it in Mail Config.');
  }
  return fn(createImapClient(config, password));
}

export async function listFolders(session: Session) {
  return withTeamMailbox(session, (c) => c.folders());
}

export async function listInbox(
  session: Session,
  opts: { folder?: string; limit?: number; offset?: number; unreadOnly?: boolean },
): Promise<ListResult> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  return withTeamMailbox(session, (c) =>
    c.list(opts.folder || DEFAULT_FOLDER, { limit, offset, unreadOnly: Boolean(opts.unreadOnly) }),
  );
}

export interface MessageView extends Omit<MessageDetail, 'html'> {
  /** Sanitised HTML. Still shown only in a sandboxed frame. */
  html_safe: string;
}

/** Opening a message marks it as read, as in v1. */
export async function readMessage(session: Session, folder: string, uid: number): Promise<MessageView | null> {
  return withTeamMailbox(session, async (c) => {
    const msg = await c.read(folder || DEFAULT_FOLDER, uid);
    if (!msg) return null;
    if (!msg.seen) await c.setFlag(folder || DEFAULT_FOLDER, uid, 'seen', true).catch(() => {});
    const { html, ...rest } = msg;
    return { ...rest, seen: true, html_safe: sanitizeLessonHtml(html) };
  });
}

export async function setFlag(session: Session, folder: string, uid: number, flag: FlagName, on: boolean): Promise<void> {
  return withTeamMailbox(session, (c) => c.setFlag(folder || DEFAULT_FOLDER, uid, flag, on));
}

const ARCHIVE_NAMES = ['[Gmail]/All Mail', 'Archive', 'All Mail'];
const TRASH_NAMES = ['[Gmail]/Trash', 'Trash', 'Deleted Items', 'Deleted'];

/**
 * Move a message. The target is a folder path, or the keyword "archive" or "trash".
 * Keywords use the folder set in Mail Config, else the first common name that exists.
 */
export async function moveMessage(session: Session, folder: string, uid: number, target: string): Promise<void> {
  if (!target) throw new ValidationError('Choose a folder to move to');
  const from = folder || DEFAULT_FOLDER;
  if (target !== 'archive' && target !== 'trash') {
    return withTeamMailbox(session, (c) => c.move(from, uid, target));
  }
  const { config } = await resolveMailConfig(session.team);
  const configured = target === 'archive' ? config.folder_archive : config.folder_trash;
  const names = configured ? [configured] : target === 'archive' ? ARCHIVE_NAMES : TRASH_NAMES;
  return withTeamMailbox(session, async (c) => {
    const existing = await c.folders();
    const hit = names
      .map((n) => existing.find((f) => f.path.toLowerCase() === n.toLowerCase() || f.name.toLowerCase() === n.toLowerCase()))
      .find(Boolean);
    if (!hit) throw new ValidationError(`No ${target} folder in this mailbox. Set one in Mail Config.`);
    await c.move(from, uid, hit.path);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ensureRe(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/**
 * Reply to a message from the team's own mailbox. The reply carries In-Reply-To and
 * References, so mail clients thread it. The original is marked as answered.
 */
export async function replyToMessage(
  session: Session,
  input: { folder: string; uid: number; body: string; all?: boolean },
): Promise<{ ok: boolean; error: string | null }> {
  const body = input.body.trim();
  if (!body) throw new ValidationError('The reply is empty');
  const folder = input.folder || DEFAULT_FOLDER;
  const original = await withTeamMailbox(session, (c) => c.read(folder, input.uid));
  if (!original) throw new ValidationError('The message no longer exists');
  const to = original.from.match(/<([^>]+)>/)?.[1] ?? original.from.trim();
  if (!to) throw new ValidationError('The message has no sender address');

  const refs = [...original.references, original.messageId].filter(Boolean);
  // Reply All: everyone on the original except the team's own mailbox address.
  const own = (await resolveMailConfig(session.team)).config.from_email.toLowerCase();
  const cc = input.all
    ? [...original.to, ...original.cc].filter((a) => a && a.toLowerCase() !== own && a.toLowerCase() !== to.toLowerCase())
    : [];
  const result = await sendMail({
    to: [to],
    cc,
    subject: ensureRe(original.subject),
    html: `<div style="font-family:inherit;white-space:pre-wrap">${escapeHtml(body)}</div>`,
    headers: {
      ...(original.messageId ? { 'In-Reply-To': original.messageId } : {}),
      ...(refs.length ? { References: refs.join(' ') } : {}),
    },
    team: session.team,
    sent_by: session.sub,
    sent_by_name: session.username,
    log_type: 'inbox_reply',
  });
  if (result.ok) {
    await withTeamMailbox(session, (c) => c.setFlag(folder, input.uid, 'answered', true)).catch(() => {});
  }
  return { ok: result.ok, error: result.error };
}

/** Forward: a new message to the given addresses, with the original quoted below the note. */
export async function forwardMessage(
  session: Session,
  input: { folder: string; uid: number; to: string[]; body: string },
): Promise<{ ok: boolean; error: string | null }> {
  const folder = input.folder || DEFAULT_FOLDER;
  const original = await withTeamMailbox(session, (c) => c.read(folder, input.uid));
  if (!original) throw new ValidationError('The message no longer exists');
  const quoted = (original.text || '').split('\n').map((l) => `> ${l}`).join('\n');
  const note = input.body.trim();
  const header = `---------- Forwarded message ----------\nFrom: ${original.from}\nDate: ${original.date}\nSubject: ${original.subject}\nTo: ${original.to.join(', ')}`;
  const text = [note, '', header, '', quoted].join('\n');
  const subject = /^fwd?:/i.test(original.subject.trim()) ? original.subject.trim() : `Fwd: ${original.subject.trim()}`;
  return sendMail({
    to: input.to,
    subject,
    html: `<div style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</div>`,
    team: session.team,
    sent_by: session.sub,
    sent_by_name: session.username,
    log_type: 'inbox_forward',
  }).then((r) => ({ ok: r.ok, error: r.error }));
}

export interface DashboardInbox {
  configured: boolean;
  unread: number;
  items: { uid: number; subject: string; from: string; date: string; seen: boolean }[];
  error: string | null;
}

/** Dashboard card: unread count and the newest messages. Never throws, so the page still renders. */
export async function dashboardInbox(session: Session): Promise<DashboardInbox> {
  try {
    const r = await listInbox(session, { limit: DASHBOARD_ITEMS });
    return { configured: true, unread: r.unread, items: r.items, error: null };
  } catch (e) {
    const configured = !(e instanceof ValidationError && /no mailbox set up/.test(e.message));
    return { configured, unread: 0, items: [], error: e instanceof Error ? e.message : 'Could not read the mailbox' };
  }
}
