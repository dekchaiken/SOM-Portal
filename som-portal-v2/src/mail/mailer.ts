// som-portal-v2/src/mail/mailer.ts
//
// v2 equivalent of v1 `api/mail/_mailer.php::sendMailInternal()`.
// Returns v1's shape — `{ ok, error }` — so call sites read identically.
//
// SAFETY: the transport is injectable. Tests MUST call `__setMailTransport()`
// with a mock (see src/mail/mailer.test.ts); nothing here opens a socket until
// a real transport is built, and `MAIL_DRY_RUN=1` / dev-mode short-circuits to
// a console log instead of SMTP (v1's forgot-password had no such escape, so
// this is additive).

import { appendMailLog } from './logs';
import { wrapEmailHtml } from './branding';
import { resolveMailConfig, resolveSmtpPassword, type MailConfig } from './mail-config';

export interface SendMailArgs {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string | string[];
  /** Extra headers, e.g. In-Reply-To and References for a reply. */
  headers?: Record<string, string>;
  /** Team whose mail_config.json should be used. Server-derived only. */
  team?: string | null;
  /** v1 log metadata — kept for parity with sendMailInternal's $opts. */
  sent_by?: string;
  sent_by_name?: string;
  log_type?: string;
  log_meta?: Record<string, unknown>;
}

export interface SendMailResult {
  ok: boolean;
  error: string | null;
  /** True when the message was logged instead of sent (dev / dry-run). */
  dryRun?: boolean;
  messageId?: string;
}

export interface MailTransport {
  send(message: {
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    html: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string }>;
}

let injected: MailTransport | null = null;

/** Test seam. Pass `null` to restore the real nodemailer transport. */
export function __setMailTransport(t: MailTransport | null): void {
  injected = t;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseList(value: string | string[] | undefined): string[] {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr.map((e) => e.trim()).filter((e) => EMAIL_RE.test(e));
}

export function isDryRun(): boolean {
  if (process.env.MAIL_DRY_RUN === '1') return true;
  if (process.env.NODE_ENV === 'test') return true;
  // Brief: "Dev mode: log reset link to console instead of email".
  return process.env.NODE_ENV !== 'production';
}

async function buildNodemailerTransport(cfg: MailConfig): Promise<MailTransport> {
  const nodemailer = await import('nodemailer');
  const secure = String(cfg.smtp_encryption).toLowerCase() === 'ssl' || cfg.smtp_port === 465;
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port) || 587,
    secure,
    requireTLS: String(cfg.smtp_encryption).toLowerCase() === 'tls',
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: resolveSmtpPassword(cfg) } : undefined,
  });
  return {
    async send(message) {
      const info = await transporter.sendMail(message);
      return { messageId: info.messageId };
    },
  };
}

/** Send, then record the attempt in the team's mail log (v1 parity). Logging never fails the send. */
export async function sendMail(args: SendMailArgs): Promise<SendMailResult> {
  const result = await deliver(args);
  try {
    await appendMailLog(args.team ?? null, {
      to: normaliseList(args.to),
      cc: normaliseList(args.cc),
      subject: args.subject ?? '',
      type: args.log_type ?? 'transactional',
      status: result.ok ? 'sent' : 'failed',
      error: result.error ?? '',
      sent_by: args.sent_by ?? '',
      sent_by_name: args.sent_by_name ?? '',
    });
  } catch (e) {
    console.error('[mail] could not write mail log', e);
  }
  return result;
}

async function deliver(args: SendMailArgs): Promise<SendMailResult> {
  const { config, configured } = await resolveMailConfig(args.team ?? null);
  // Team branding (header and footer) wraps every mail, as in v1 _branding.php.
  const branded = config.brand_enabled
    ? wrapEmailHtml(args.html, args.subject, {
        appName: config.from_name || 'SOM-Portal',
        brandColor: config.brand_color,
        headerText: config.header_text,
        footerText: config.footer_text,
      })
    : args.html;

  const to = normaliseList(args.to);
  if (to.length === 0) return { ok: false, error: 'No valid recipient' };
  if (!args.subject || !args.html) {
    return { ok: false, error: 'Subject and body are required' };
  }
  if (!configured) {
    return { ok: false, error: 'This team has no mailbox set up. Ask a team admin to fill in Mail Config.' };
  }

  const cc = normaliseList(args.cc ?? config.global_cc);
  const from = `${config.from_name || 'SOM-Portal'} <${config.from_email}>`;

  if (injected) {
    const info = await injected.send({ from, to, cc, subject: args.subject, html: branded, headers: args.headers });
    return { ok: true, error: null, messageId: info.messageId };
  }

  if (isDryRun()) {
    console.info(
      `[mail:dry-run] to=${to.join(',')} subject=${JSON.stringify(args.subject)} ` +
        `type=${args.log_type ?? 'transactional'}`,
    );
    return { ok: true, error: null, dryRun: true };
  }

  try {
    const transport = await buildNodemailerTransport(config);
    const info = await transport.send({ from, to, cc, subject: args.subject, html: branded, headers: args.headers });
    return { ok: true, error: null, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'SMTP send failed' };
  }
}
