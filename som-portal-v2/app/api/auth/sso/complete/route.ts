// som-portal-v2/app/api/auth/sso/complete/route.ts
// Runs after Keycloak has signed the user in through Auth.js. It rechecks the portal
// user by verified email, issues the normal portal session, clears the Auth.js
// handshake cookies and redirects to the dashboard.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth/nextauth';
import { canUseSso } from '@/auth/sso-rules';
import { issuePortalSession, clearAuthJsCookies, STD_TTL } from '@/auth/issue-session';
import { findUserByEmailGlobal } from '@/account/users-store';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';

export const runtime = 'nodejs';

function fail(req: NextRequest, code: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/v2/login?sso=${code}`, req.url));
  clearAuthJsCookies(res);
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return fail(req, 'no_session');

  const user = await findUserByEmailGlobal(email);
  if (!user || user.active === false || !canUseSso(user)) {
    await logSecurity({ user: user?.id ?? null, team: user?.team ?? null, event: 'login.failed', meta: { method: 'sso', reason: 'not_allowed' } });
    return fail(req, 'denied');
  }

  const team = user.team ?? 'sm';
  await issuePortalSession(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      nickname: user.nickname as string | undefined,
      is_genz: user.is_genz,
      avatar_url: user.avatar_url as string | undefined,
      dev_subteam: user.dev_subteam,
    },
    { team, ttl: STD_TTL, pwChangeRequired: false },
  );
  await logActivity({ user: user.id, team, action: 'login', meta: { method: 'sso' } });

  const res = NextResponse.redirect(new URL('/v2/dashboard', req.url));
  clearAuthJsCookies(res);
  return res;
}
