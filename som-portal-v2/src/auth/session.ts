// som-portal-v2/src/auth/session.ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { AuthError } from '@/lib/errors';
import type { Role } from '@/data/schemas/common';
import { SESSION_COOKIE, USER_COOKIE, LEGACY_COOKIE } from './cookies';

export { SESSION_COOKIE, USER_COOKIE, LEGACY_COOKIE };

export interface Session {
  sub: string; // user id
  username: string;
  role: Role | string;
  team: string;
  is_genz?: boolean;
  dev_subteam?: string;
  exp?: number;
  iat?: number;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export async function signSession(
  payload: Omit<Session, 'exp' | 'iat'>,
  ttlSeconds = 8 * 60 * 60,
): Promise<string> {
  const jwt = await new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
  return jwt;
}

export async function verifyToken(token: string): Promise<Session> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    const sess = payload as unknown as Session;
    if (!sess.sub || !sess.role || !sess.team) {
      throw new AuthError('Session missing required claims');
    }
    return sess;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('Invalid or expired session');
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value ?? jar.get(LEGACY_COOKIE)?.value;
  if (!raw) return null;
  try {
    return await verifyToken(raw);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthError();
  return s;
}
