// som-portal-v2/src/mail/mail-admin.ts
// SMTP config CRUD + test connection — admin only.
// v1 parity: api/mail-config/index.php, api/mail/test-connection.php

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
  smtp_host: z.string().optional(),
  smtp_port: z.coerce.number().min(1).max(65535).optional(),
  smtp_encryption: z.enum(['none', 'tls', 'ssl']).optional(),
  smtp_user: z.string().optional(),
  smtp_password: z.string().optional(),
  from_name: z.string().optional(),
  from_email: z.string().optional(),
  global_cc: z.array(z.string().email()).optional(),
  email_signature: z.string().optional(),
});

export type UpdateMailConfig = z.infer<typeof UpdateMailConfigSchema>;

/**
 * GET mail config — admin only. Password masked.
 */
export async function getMailConfig(): Promise<MailConfig & { smtp_password_set: boolean }> {
  const session = await requireRole(...ADMIN_ROLES);
  const cfg = await readTeamFile<MailConfig>(MAIL_CONFIG_FILE, MailConfigFileSchema);
  return {
    ...cfg,
    smtp_password: '',
    smtp_password_set: Boolean(cfg.smtp_password),
  };
}

/**
 * PUT mail config — admin only.
 */
export async function updateMailConfig(
  updates: UpdateMailConfig,
): Promise<MailConfig & { smtp_password_set: boolean }> {
  const session = await requireRole(...ADMIN_ROLES);
  const cfg = await readTeamFile<MailConfig>(MAIL_CONFIG_FILE, MailConfigFileSchema);

  if (updates.smtp_host !== undefined) cfg.smtp_host = updates.smtp_host;
  if (updates.smtp_port !== undefined) cfg.smtp_port = updates.smtp_port;
  if (updates.smtp_encryption !== undefined) cfg.smtp_encryption = updates.smtp_encryption;
  if (updates.smtp_user !== undefined) cfg.smtp_user = updates.smtp_user;
  // Only update password if non-empty value provided (v1 parity)
  if (updates.smtp_password !== undefined && updates.smtp_password.trim() !== '') {
    cfg.smtp_password = updates.smtp_password.trim();
  }
  if (updates.from_name !== undefined) cfg.from_name = updates.from_name;
  if (updates.from_email !== undefined) cfg.from_email = updates.from_email;
  if (updates.global_cc !== undefined) cfg.global_cc = updates.global_cc;
  if (updates.email_signature !== undefined) cfg.email_signature = updates.email_signature;

  await writeTeamFile(MAIL_CONFIG_FILE, cfg, MailConfigFileSchema);

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
    smtp_password_set: Boolean(cfg.smtp_password),
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
      auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_password } : undefined,
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
