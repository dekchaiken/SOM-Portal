// som-portal-v2/src/auth/auth-config.ts
// Keycloak SSO settings, stored in the global data/auth-config.json and edited by the
// superadmin. The client secret is encrypted with the same AES-256-GCM helper as mailbox
// passwords (MAIL_CREDS_KEY), so the file never holds a plain secret.
//
// Server only. Never send `client_secret_enc` to the browser; use publicAuthConfig().
import { z } from 'zod';
import { readGlobalFile, updateGlobalFile } from '@/data/global-scope';
import { decryptSecret, encryptSecret, hasMailKey } from '@/mail/secret';

export const AUTH_CONFIG_FILE = 'auth-config.json';
export const DEFAULT_SSO_LABEL = 'เข้าสู่ระบบด้วย Keycloak';

export const AuthConfigSchema = z
  .object({
    sso_enabled: z.boolean().default(false),
    sso_label: z.string().max(80).default(DEFAULT_SSO_LABEL),
    issuer: z.string().default(''),
    client_id: z.string().default(''),
    client_secret_enc: z.string().default(''),
    updated_at: z.string().optional(),
    updated_by: z.string().optional(),
  })
  .passthrough();
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export interface PublicAuthConfig {
  sso_enabled: boolean;
  sso_label: string;
  issuer: string;
  client_id: string;
  client_secret_set: boolean;
  key_configured: boolean;
  /** True only when every field needed by the SSO provider is present. */
  sso_ready: boolean;
}

export interface SsoRuntime {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export async function readAuthConfig(): Promise<AuthConfig> {
  const raw = await readGlobalFile<unknown>(AUTH_CONFIG_FILE, {});
  const parsed = AuthConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AuthConfigSchema.parse({});
}

export function toPublicAuthConfig(cfg: AuthConfig): PublicAuthConfig {
  const keyConfigured = hasMailKey();
  const secretSet = cfg.client_secret_enc.length > 0;
  return {
    sso_enabled: cfg.sso_enabled,
    sso_label: cfg.sso_label,
    issuer: cfg.issuer,
    client_id: cfg.client_id,
    client_secret_set: secretSet,
    key_configured: keyConfigured,
    sso_ready: Boolean(cfg.issuer && cfg.client_id && secretSet && keyConfigured),
  };
}

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  return toPublicAuthConfig(await readAuthConfig());
}

/** The provider settings, or null when SSO is off or not fully configured. */
export async function getSsoRuntime(): Promise<SsoRuntime | null> {
  const cfg = await readAuthConfig();
  if (!cfg.sso_enabled || !cfg.issuer || !cfg.client_id || !cfg.client_secret_enc) return null;
  if (!hasMailKey()) return null;
  try {
    return { issuer: cfg.issuer, clientId: cfg.client_id, clientSecret: decryptSecret(cfg.client_secret_enc) };
  } catch {
    return null;
  }
}

export interface AuthConfigPatch {
  sso_enabled?: boolean;
  sso_label?: string;
  issuer?: string;
  client_id?: string;
  /** Empty string keeps the stored secret. A non-empty value replaces it. */
  client_secret?: string;
}

export async function saveAuthConfig(patch: AuthConfigPatch, actorId: string): Promise<PublicAuthConfig> {
  if (patch.client_secret && !hasMailKey()) {
    throw new Error('MAIL_CREDS_KEY must be set on the server (32+ characters) before saving a client secret.');
  }
  const next = await updateGlobalFile<AuthConfig>(AUTH_CONFIG_FILE, AuthConfigSchema.parse({}), (current) => {
    const base = AuthConfigSchema.parse(current ?? {});
    const merged: AuthConfig = {
      ...base,
      ...(patch.sso_enabled !== undefined ? { sso_enabled: patch.sso_enabled } : {}),
      ...(patch.sso_label !== undefined ? { sso_label: patch.sso_label.trim() || DEFAULT_SSO_LABEL } : {}),
      ...(patch.issuer !== undefined ? { issuer: patch.issuer.trim() } : {}),
      ...(patch.client_id !== undefined ? { client_id: patch.client_id.trim() } : {}),
      ...(patch.client_secret ? { client_secret_enc: encryptSecret(patch.client_secret) } : {}),
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    };
    return merged;
  });
  return toPublicAuthConfig(next);
}
