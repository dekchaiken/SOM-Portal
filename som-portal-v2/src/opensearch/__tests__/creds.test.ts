// som-portal-v2/src/opensearch/__tests__/creds.test.ts
// AES-256-CBC crypto tests — round-trip, v1 interop, and short/garbage guard.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, createCipheriv } from 'node:crypto';

// We test the raw functions, not the CRUD (which needs readTeamFile mocks).
// Import from the module directly.
import { encryptCreds, decryptCreds } from '../creds';

// The env must have JWT_SECRET set for the key derivation to work.
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-16-characters-long-ok';
});

describe('opensearch creds crypto', () => {
  it('round-trips a password through encrypt then decrypt', () => {
    const plain = 'p@ssw0rd-example-!@#$%^&*()';
    const enc = encryptCreds(plain);
    // Must be valid base64
    expect(enc).toMatch(/^[A-Za-z0-9+/=]+$/);
    const dec = decryptCreds(enc);
    expect(dec).toBe(plain);
  });

  it('round-trips unicode passwords', () => {
    const plain = 'สวัสดีครับ-test123';
    const enc = encryptCreds(plain);
    expect(decryptCreds(enc)).toBe(plain);
  });

  it('round-trips empty string', () => {
    const enc = encryptCreds('');
    // Empty plaintext still produces ciphertext (PKCS#7 pads to 16 bytes)
    expect(enc).toBeTruthy();
    expect(decryptCreds(enc)).toBe('');
  });

  it('returns null for short / garbage input (v1 len<17 guard)', () => {
    expect(decryptCreds('aGk=')).toBeNull(); // 2 bytes decoded
    expect(decryptCreds('!!!not-base64!!!')).toBeNull();
    expect(decryptCreds('')).toBeNull();
  });

  it('returns null when the secret is wrong (bad padding catch)', () => {
    const enc = encryptCreds('hello');
    // Temporarily change secret
    const orig = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'different-secret-not-the-same-one';
    // Must reset env cache
    const envMod = require('@/lib/env');
    envMod.__resetEnvCache();
    expect(decryptCreds(enc)).toBeNull();
    // Restore
    process.env.JWT_SECRET = orig;
    envMod.__resetEnvCache();
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const a = encryptCreds('same-text');
    const b = encryptCreds('same-text');
    expect(a).not.toBe(b);
    // But both decrypt to the same thing
    expect(decryptCreds(a)).toBe('same-text');
    expect(decryptCreds(b)).toBe('same-text');
  });

  it('v1 interop: a blob encrypted with the v1 PHP algorithm decrypts correctly', () => {
    // Simulate PHP: hash('sha256', JWT_SECRET, true) for key, known IV, AES-256-CBC
    const secret = 'test-secret-at-least-16-characters-long-ok';
    const key = createHash('sha256').update(secret).digest();
    const iv = Buffer.alloc(16, 0xAB); // Known IV for this test
    const plaintext = 'my-opensearch-password';

    // PHP openssl_encrypt with OPENSSL_RAW_DATA equivalent
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const envelope = Buffer.concat([iv, ct]).toString('base64');

    // Our decrypt should handle this exactly
    const result = decryptCreds(envelope);
    expect(result).toBe(plaintext);
  });
});
