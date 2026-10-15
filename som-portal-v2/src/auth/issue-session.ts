// som-portal-v2/src/auth/issue-session.ts
// Writes the portal session cookies. Shared by password login and the SSO completion
// route, so both sign-in methods end with the same session shape and cookies.
import type { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signSession, SESSION_COOKIE, USER_COOKIE } from './session';

export const STD_TTL = 8 * 60 * 60; // 8 h
export const REMEMBER_TTL = 30 * 24 * 60 * 60; // 30 d
const COOKIE_PATH = '/v2';

export interface SessionUser {
  id: string;
  username: string;
  role: string;
  name?: string;
  nickname?: string;
  is_genz?: boolean;
  dev_subteam?: string;
  avatar_url?: string;
}

export interface IssueOptions {
  team: string;
  ttl: number;
  pwChangeRequired: boolean;
}

/** Sets the session cookie and the public user mirror on a Next.js cookie jar. */
export async function issuePortalSession(user: SessionUser, opts: IssueOptions): Promise<{ expires: Date }> {
  const token = await signSession(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      team: opts.team,
      is_genz: user.is_genz,
      dev_subteam: user.dev_subteam,
      pw_change_required: opts.pwChangeRequired,
    },
    opts.ttl,
  );
  const expires = new Date(Date.now() + opts.ttl * 1000);
  const secure = process.env.NODE_ENV === 'production';

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: COOKIE_PATH, expires });
  jar.set(
    USER_COOKIE,
    JSON.stringify({
      id: user.id,
      username: user.username,
      role: user.role,
      team: opts.team,
      name: user.name,
      nickname: user.nickname,
      is_genz: user.is_genz ?? false,
      avatar_url: user.avatar_url,
    }),
    { httpOnly: false, secure, sameSite: 'lax', path: COOKIE_PATH, expires },
  );
  return { expires };
}

/** Removes the short-lived Auth.js handshake cookies after SSO has been converted. */
export function clearAuthJsCookies(res: NextResponse): void {
  for (const name of ['authjs.session-token', '__Secure-authjs.session-token', 'authjs.callback-url', 'authjs.csrf-token']) {
    res.cookies.set(name, '', { path: '/v2/api/auth', maxAge: 0 });
    res.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
}
