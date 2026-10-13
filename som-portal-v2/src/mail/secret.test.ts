import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hasMailKey, MailKeyError } from './secret';

const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);

describe('mail secret', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.MAIL_CREDS_KEY;
    process.env.MAIL_CREDS_KEY = KEY_A;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MAIL_CREDS_KEY;
    else process.env.MAIL_CREDS_KEY = saved;
  });

  it('round-trips a password and never stores it in plain text', () => {
    const stored = encryptSecret('app-password-123');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain('app-password-123');
    expect(decryptSecret(stored)).toBe('app-password-123');
  });

  it('uses a fresh IV, so the same password gives different values', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('refuses to decrypt with another key', () => {
    const stored = encryptSecret('secret');
    process.env.MAIL_CREDS_KEY = KEY_B;
    expect(() => decryptSecret(stored)).toThrow();
  });

  it('detects a changed value (GCM tag)', () => {
    const stored = encryptSecret('secret');
    const tampered = stored.slice(0, -2) + (stored.endsWith('AA') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('refuses to encrypt when the key is missing or too short', () => {
    process.env.MAIL_CREDS_KEY = 'short';
    expect(hasMailKey()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(MailKeyError);
    delete process.env.MAIL_CREDS_KEY;
    expect(() => encryptSecret('x')).toThrow(MailKeyError);
  });
});
