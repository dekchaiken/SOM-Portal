// som-portal-v2/src/mail/mail-config.ts
//
// SMTP settings come from v1 `mail_config.json` (api/mail-config/index.php,
// consumed by api/mail/_mailer.php::sendMailInternal). Field names are v1's.
//
// Team resolution note: v1's forgot-password.php runs UNAUTHENTICATED, so
// `$GLOBALS['_current_team']` is null and readJson() resolves the ROOT
// `data/mail_config.json`. v2 improves on that without breaking it: we prefer
// the *target user's* team config (`data/<team>/mail_config.json`) and fall
// back to the root file, exactly like v1, when the team has none. The team
// slug comes from the stored user record — never from the request body — so
// this cannot be used to read another team's SMTP credentials.

import { z } from 'zod';
import { getDataAdapter } from '@/data/json-adapter';

export const MAIL_CONFIG_FILE = 'mail_config.json';

export const MailConfigSchema = z
  .object({
    smtp_host: z.string().default(''),
    smtp_port: z.coerce.number().default(587),
    smtp_encryption: z.string().default('tls'),
    smtp_user: z.string().default(''),
    smtp_password: z.string().default(''),
    from_name: z.string().default('SOM-Portal'),
    from_email: z.string().default(''),
    global_cc: z.array(z.string()).default([]),
    email_signature: z.string().default(''),
  })
  .passthrough();

export type MailConfig = z.infer<typeof MailConfigSchema>;

export interface ResolvedMailConfig {
  config: MailConfig;
  /** `null` when it came from the v1 root fallback. */
  team: string | null;
  configured: boolean;
}

async function readAt(team: string): Promise<unknown> {
  return getDataAdapter().read<unknown>({ team }, MAIL_CONFIG_FILE);
}

export async function resolveMailConfig(team?: string | null): Promise<ResolvedMailConfig> {
  let raw: unknown = null;
  let source: string | null = null;

  if (team) {
    // Each team sends only from its own mailbox. A team without a mailbox is not
    // configured. It never falls back to another team's file.
    raw = await readAt(team);
    source = team;
  } else {
    // No team is known (legacy unauthenticated path): v1 root data/mail_config.json.
    raw = await readAt('.');
    source = null;
  }

  const parsed = MailConfigSchema.safeParse(raw ?? {});
  const config = parsed.success ? parsed.data : MailConfigSchema.parse({});
  // v1 guard: `if (empty($cfg['smtp_host']) || empty($cfg['from_email']))`.
  const configured = Boolean(config.smtp_host) && Boolean(config.from_email);
  return { config, team: source, configured };
}
