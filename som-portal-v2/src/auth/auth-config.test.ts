// som-portal-v2/src/auth/auth-config.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthConfigSchema, toPublicAuthConfig } from './auth-config';
import { encryptSecret } from '@/mail/secret';

const KEY = 'test-key-for-auth-config-0123456789abcdef';

describe('auth config', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.MAIL_CREDS_KEY;
    process.env.MAIL_CREDS_KEY = KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MAIL_CREDS_KEY;
    else process.env.MAIL_CREDS_KEY = saved;
  });

  it('defaults to SSO off with the standard label', () => {
    const cfg = AuthConfigSchema.parse({});
    expect(cfg.sso_enabled).toBe(false);
    expect(cfg.sso_label).toBe('เข้าสู่ระบบด้วย Keycloak');
  });

  it('never exposes the stored secret, only whether one is set', () => {
    const cfg = AuthConfigSchema.parse({
      sso_enabled: true,
      issuer: 'https://kc.example/realms/som',
      client_id: 'som-portal',
      client_secret_enc: encryptSecret('super-secret-value'),
    });
    const pub = toPublicAuthConfig(cfg);
    expect(pub.client_secret_set).toBe(true);
    expect(pub.sso_ready).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('super-secret-value');
    expect(JSON.stringify(pub)).not.toContain('client_secret_enc');
  });

  it('is not ready when any SSO field is missing', () => {
    const cfg = AuthConfigSchema.parse({ sso_enabled: true, issuer: 'https://kc.example/realms/som', client_id: 'som-portal' });
    expect(toPublicAuthConfig(cfg).sso_ready).toBe(false);
  });

  it('is not ready without the encryption key', () => {
    delete process.env.MAIL_CREDS_KEY;
    const cfg = AuthConfigSchema.parse({
      sso_enabled: true,
      issuer: 'https://kc.example/realms/som',
      client_id: 'som-portal',
      client_secret_enc: 'enc:v1:xxxx',
    });
    const pub = toPublicAuthConfig(cfg);
    expect(pub.key_configured).toBe(false);
    expect(pub.sso_ready).toBe(false);
  });
});
