// som-portal-v2/app/api/v1/auth/change-password/route.ts
//
// Port of v1 `api/auth/change-password.php`.
//
// v1 parity: body fields `old_password` / `new_password` / `confirm_password`;
// the current password is required UNLESS the record is `first_login` or
// `must_reset_password`; reuse checks against `password` + `password_history`;
// bcrypt identical (cost 10, `$2b$`→`$2y$` tolerant); logActivity
// 'password_change'; a fresh JWT is issued with the reset flags cleared.
//
// Multi-team: the record is located in the GLOBAL data/users.json by the
// session's own `sub`, and `setUserPassword` additionally asserts the row's
// `team` matches the session team (super_admin excepted).

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { requireAuth } from '@/auth/policy';
import { signSession, SESSION_COOKIE } from '@/auth/session';
import { setUserPassword } from '@/account/users-store';
import { checkPasswordPolicy } from '@/account/password-policy';
import { clientIp, jsonErr, jsonFromError, jsonOk, readJsonBody } from '@/account/http';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';

export const runtime = 'nodejs';

const COOKIE_PATH = '/v2';
const STD_TTL = 8 * 60 * 60;

const BodySchema = z.object({
  old_password: z.string().max(256).optional().default(''),
  new_password: z.string().max(256),
  confirm_password: z.string().max(256),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  try {
    const sess = await requireAuth();
    const parsed = BodySchema.safeParse((await readJsonBody(req)) ?? {});
    if (!parsed.success) return jsonErr('Invalid request body', 400, 'validation');
    const { old_password, new_password, confirm_password } = parsed.data;

    const policy = checkPasswordPolicy(new_password);
    if (!policy.ok) return jsonErr(policy.errors[0]!, 400, 'weak_password');
    if (new_password !== confirm_password) {
      return jsonErr('Passwords do not match', 400, 'mismatch');
    }

    const result = await setUserPassword({
      userId: sess.sub,
      newPassword: new_password,
      currentPassword: old_password,
      team: sess.team,
      role: sess.role,
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'not_found':
          return jsonErr('User not found', 404, 'not_found');
        case 'wrong_team':
          await logSecurity({
            user: sess.sub,
            team: sess.team,
            event: 'password_change_cross_team_blocked',
            ip,
          });
          return jsonErr('Forbidden', 403, 'forbidden');
        case 'current_required':
          return jsonErr('Current password is required', 400, 'current_required');
        case 'current_incorrect':
          await logSecurity({
            user: sess.sub,
            team: sess.team,
            event: 'password_change_bad_current',
            ip,
          });
          return jsonErr('Current password is incorrect', 401, 'current_incorrect');
        case 'same_as_current':
          return jsonErr(
            'New password cannot be the same as your current password',
            400,
            'same_as_current',
          );
        case 'reused':
          return jsonErr(
            `Cannot reuse one of your last ${result.historyCount} passwords. Please choose a different password.`,
            400,
            'password_reused',
          );
      }
    }

    const user = result.user;

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'password_change',
      meta: { ip, first_login_reset: false, expired_reset: false },
    });
    await logSecurity({
      user: sess.sub,
      team: sess.team,
      event: 'password_change',
      ip,
      meta: { username: user.username },
    });

    // v1 issued a fresh token with the reset flags cleared. v2 keeps the
    // session in an HttpOnly cookie, so re-sign and re-set it instead of
    // handing the raw JWT back to the browser.
    const token = await signSession(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        team: user.team ?? sess.team,
        is_genz: user.is_genz,
        dev_subteam: user.dev_subteam,
      },
      STD_TTL,
    );
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: COOKIE_PATH,
      expires: new Date(Date.now() + STD_TTL * 1000),
    });

    return jsonOk({ message: 'Password changed successfully' });
  } catch (e) {
    return jsonFromError(e);
  }
}
