// som-portal-v2/src/auth/session.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';
import { verifyToken, signSession } from './session';
import { __resetEnvCache } from '@/lib/env';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
  __resetEnvCache();
});

describe('session', () => {
  it('signs and verifies a round-trip token', async () => {
    const token = await signSession({
      sub: 'usr_1',
      username: 'alice',
      role: 'sm_user',
      team: 'sm',
    });
    const sess = await verifyToken(token);
    expect(sess.sub).toBe('usr_1');
    expect(sess.team).toBe('sm');
    expect(sess.role).toBe('sm_user');
  });

  it('rejects wrong-secret tokens', async () => {
    const bad = await new SignJWT({ sub: 'x', role: 'sm_user', team: 'sm', username: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret-at-least-16-chars'));
    await expect(verifyToken(bad)).rejects.toThrow();
  });

  it('rejects tokens missing required claims', async () => {
    const bad = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('test-secret-at-least-16-chars'));
    await expect(verifyToken(bad)).rejects.toThrow();
  });
});
