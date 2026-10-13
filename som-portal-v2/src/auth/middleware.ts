// som-portal-v2/src/auth/middleware.ts
// Called from the root middleware.ts. Verifies the JWT and returns the
// decoded session or null. Uses the Edge-friendly jose entrypoint.
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import type { Session } from './session';
import { SESSION_COOKIE, LEGACY_COOKIE } from './cookies';

// Edge-safe: read JWT_SECRET directly from process.env to avoid pulling in
// node:path via @/lib/env. The Node runtime still validates env on first boot.
function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET missing or too short');
  }
  return new TextEncoder().encode(s);
}

export async function verifyRequestSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? req.cookies.get(LEGACY_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    const s = payload as unknown as Session;
    if (!s.sub || !s.role || !s.team) return null;
    return s;
  } catch {
    return null;
  }
}
