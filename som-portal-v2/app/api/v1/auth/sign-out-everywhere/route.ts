// som-portal-v2/app/api/v1/auth/sign-out-everywhere/route.ts
//
// v1 has NO server-side session store (JWTs are stateless and PHP never
// consults a revocation list), so there is no v1 endpoint to mirror. This is
// a v2-only, best-effort revocation:
//   • stamps `sessions_revoked_at` in the team-scoped user-prefs record
//   • clears this browser's session + mirror cookies
// Tokens already minted elsewhere stay cryptographically valid until they
// expire — see the caveat rendered in the Settings → Sessions tab.

import { type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/auth/policy';
import { SESSION_COOKIE, USER_COOKIE, LEGACY_COOKIE } from '@/auth/session';
import { revokeUserSessions } from '@/account/user-prefs';
import { clientIp, jsonFromError, jsonOk } from '@/account/http';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';

export const runtime = 'nodejs';

const COOKIE_PATH = '/v2';

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  try {
    const sess = await requireAuth();
    const prefs = await revokeUserSessions(sess.sub);

    const jar = await cookies();
    for (const name of [SESSION_COOKIE, USER_COOKIE, LEGACY_COOKIE]) {
      jar.set(name, '', { path: COOKIE_PATH, expires: new Date(0) });
    }

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'sign_out_everywhere',
      meta: { ip },
    });
    await logSecurity({
      user: sess.sub,
      team: sess.team,
      event: 'sessions_revoked',
      ip,
      meta: { at: prefs.sessions_revoked_at },
    });

    return jsonOk({
      revoked_at: prefs.sessions_revoked_at,
      message: 'Signed out on this device; other sessions expire with their token.',
    });
  } catch (e) {
    return jsonFromError(e);
  }
}
