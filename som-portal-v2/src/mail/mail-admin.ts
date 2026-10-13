// som-portal-v2/src/mail/mail-admin.ts
// SMTP config CRUD + test connection — admin only.
// v1 parity: api/mail-config/index.php, api/mail/test-connection.php

import { ValidationError } from '@/lib/errors';
import { hasMailKey, encryptSecret } from './secret';
import { resolveSmtpPassword } from './mail-config';
import { z } from 'zod';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { requireRole } from '@/auth/policy';
import { ADMIN_ROLES } from '@/auth/policy';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';
import { MailConfigSchema, MAIL_CONFIG_FILE, type MailConfig } from './mail-config';
import { sendMail } from './mailer';

const MailConfigFileSchema = MailConfigSchema.default({
  smtp_host: '',
  smtp_port: 587,
  smtp_encryption: 'tls',
  smtp_user: '',
  smtp_password: '',
  from_name: 'SOM-Portal',
  from_email: '',
  global_cc: [],
  email_signature: '',
});

export const UpdateMailConfigSchema = z.object({
  /** Which team's mailbox to change. Only super_admin may name another team. */
  team: z.string().optional(),
  smtp_host: z.string().optional(),
  smtp_port: z.coerce.number().min(1).max(65535).optional(),
  smtp_encryption: z.enum(['none', 'tls', 'ssl']).optional(),
  smtp_user: z.string().optional(),
  smtp_password: z.string().optional(),
  from_name: z.string().optional(),
  from_email: z.string().optional(),
  global_cc: z.array(z.string().email()).optional(),
  email_signature: z.string().optional(),
  brand_enabled: z.boolean().optional(),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  header_text: z.string().max(120).optional(),
  footer_text: z.string().max(2000).optional(),
});

export type UpdateMailConfig = z.infer<typeof UpdateMailConfigSchema>;

/**
 * GET mail config — admin only. Password masked.
 */
export async function getMailConfig(team?: string): Promise<MailConfig & { smtp_password_set: boolean; team: string }> {
  const session = await requireRole(...ADMIN_ROLES);
  const scope = team && team !== session.team ? { team } : undefined;
  const cfg = await readTeamFile<MailConfig>(MAIL_CONFIG_FILE, MailConfigFileSchema, scope);
  return {
    ...cfg,
    smtp_password: '',
    smtp_password_enc: '',
    smtp_password_set: Boolean(cfg.smtp_password_enc || cfg.smtp_password),
    team: scope?.team ?? session.team,
  };
}

/**
 * PUT mail config — admin only.
 */
export async function updateMailConfig(
  updates: UpdateMailConfig,
): Promise<MailConfig & { smtp_password_set: boolean }> {
  const session = await requireRole(...ADMIN_ROLES);
  const scope = updates.team && updates.team !== session.team ? { team: updates.team } : undefined;
  const cfg = await readTeamFile<MailConfig>(MAIL_CONFIG_FILE, MailConfigFileSchema, scope);

  if (updates.smtp_host !== undefined) cfg.smtp_host = updates.smtp_host;
  if (updates.smtp_port !== undefined) cfg.smtp_port = updates.smtp_port;
  if (updates.smtp_encryption !== undefined) cfg.smtp_encryption = updates.smtp_encryption;
  if (updates.smtp_user !== undefined) cfg.smtp_user = updates.smtp_user;
  // Only update password if non-empty value provided (v1 parity)
  if (updates.smtp_password !== undefined && updates.smtp_password.trim() !== '') {
    // Encrypted at rest. Without the server key nothing is saved, so the value is never stored in plain text.
    if (!hasMailKey()) {
      throw new ValidationError('MAIL_CREDS_KEY is not set on the server. Ask the server admin to set it, then save the password again.');
    }
    cfg.smtp_password_enc = encryptSecret(updates.smtp_password.trim());
    cfg.smtp_password = '';
  }
  if (updates.from_name !== undefined) cfg.from_name = updates.from_name;
  if (updates.from_email !== undefined) cfg.from_email = updates.from_email;
  if (updates.global_cc !== undefined) cfg.global_cc = updates.global_cc;
  if (updates.email_signature !== undefined) cfg.email_signature = updates.email_signature;
  if (updates.brand_enabled !== undefined) cfg.brand_enabled = updates.brand_enabled;
  if (updates.brand_color !== undefined) cfg.brand_color = updates.brand_color;
  if (updates.header_text !== undefined) cfg.header_text = updates.header_text;
  if (updates.footer_text !== undefined) cfg.footer_text = updates.footer_text;

  await writeTeamFile(MAIL_CONFIG_FILE, cfg, MailConfigFileSchema, scope);

  const changedKeys = Object.keys(updates).filter((k) => k !== 'smtp_password');
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'mail_config_updated',
    meta: { keys: changedKeys.join(',') },
  });
  await logSecurity({
    user: session.sub,
    team: session.team,
    event: 'mail_config_changed',
    meta: { keys: changedKeys.join(',') },
  });

  return {
    ...cfg,
    smtp_password: '',
    smtp_password_enc: '',
    smtp_password_set: Boolean(cfg.smtp_password_enc || cfg.smtp_password),
  };
}

export interface TestStep {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Test SMTP connection — uses nodemailer.verify().
 */
export async function testConnection(): Promise<{ ok: boolean; steps: TestStep[] }> {
  await requireRole(...ADMIN_ROLES);
  const cfg = await readTeamFile<MailConfig>(MAIL_CONFIG_FILE, MailConfigFileSchema);

  if (!cfg.smtp_host) {
    return {
      ok: false,
      steps: [{ label: 'Check config', ok: false, detail: 'SMTP host not configured' }],
    };
  }

  const steps: TestStep[] = [];
  try {
    const nodemailer = await import('nodemailer');
    const secure =
      String(cfg.smtp_encryption).toLowerCase() === 'ssl' || cfg.smtp_port === 465;
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: Number(cfg.smtp_port) || 587,
      secure,
      requireTLS: String(cfg.smtp_encryption).toLowerCase() === 'tls',
      auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: resolveSmtpPassword(cfg) } : undefined,
      connectionTimeout: 10000,
    });

    steps.push({ label: `Connect to ${cfg.smtp_host}:${cfg.smtp_port}`, ok: true, detail: 'TCP connection initiated' });

    await transporter.verify();
    steps.push({ label: 'SMTP handshake + auth', ok: true, detail: 'Connection verified successfully' });

    return { ok: true, steps };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    steps.push({ label: 'SMTP verify', ok: false, detail: msg });
    return { ok: false, steps };
  }
}

/**
 * Send a test email to a given recipient.
 */
export async function sendTestEmail(
  to: string,
): Promise<{ ok: boolean; error: string | null }> {
  const session = await requireRole(...ADMIN_ROLES);

  const result = await sendMail({
    to,
    subject: '[SOM-Portal] Test Email',
    html: `<div style="font-family:Arial,sans-serif;padding:20px">
      <h2>Test Email</h2>
      <p>This is a test email from SOM-Portal mail configuration.</p>
      <p>Sent by: ${session.username ?? session.sub}</p>
      <p>Time: ${new Date().toISOString()}</p>
    </div>`,
    team: session.team,
    sent_by: session.sub,
    log_type: 'test',
  });

  if (result.ok) {
    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'test_email_sent',
      meta: { to },
    });
  }

  return { ok: result.ok, error: result.error };
}
