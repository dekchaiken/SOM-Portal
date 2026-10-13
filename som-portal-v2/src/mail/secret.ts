// som-portal-v2/src/mail/secret.ts
// AES-256-GCM for team mailbox app passwords. The key comes from MAIL_CREDS_KEY on
// the server (any string of 32+ characters, hashed with SHA-256 to 256 bits).
// Stored form: "enc:v1:" + base64(iv(12) | tag(16) | ciphertext).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const MIN_KEY_LENGTH = 32;

export class MailKeyError extends Error {}

function keyBytes(): Buffer {
  const raw = process.env.MAIL_CREDS_KEY ?? '';
  if (raw.length < MIN_KEY_LENGTH) {
    throw new MailKeyError(
      `MAIL_CREDS_KEY is not set or shorter than ${MIN_KEY_LENGTH} characters. Set it on the server before saving a mailbox password.`,
    );
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function hasMailKey(): boolean {
  return (process.env.MAIL_CREDS_KEY ?? '').length >= MIN_KEY_LENGTH;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Returns the plain text, or throws MailKeyError / Error when the key is wrong or the value was changed. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error('Not an encrypted mail secret');
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (buf.length < 12 + 16) throw new Error('Mail secret is truncated');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}
