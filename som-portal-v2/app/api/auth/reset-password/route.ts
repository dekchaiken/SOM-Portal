// som-portal-v2/app/api/auth/reset-password/route.ts
//
// Port of v1 `api/auth/reset-password.php`. PUBLIC — the token IS the auth.
//
//   GET  ?token=…  → { valid, expires_at?, user_name_masked?, username_masked? }
//   POST { token, new_password, confirm_password } → { message }
//
// v1 parity: the same masking helpers, the same single-use consumeResetToken()
// ordering (consume BEFORE touching users.json), the same reuse checks against
// `password` + `password_history`, and the same cleared flags. Password policy
// is tightened per the A6 brief (min 10 + upper + digit vs v1's min 8), which
// is a strict superset of v1's rule.

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { consumeResetToken, verifyResetToken } from '@/account/reset-tokens';
import { findUserById, setUserPassword } from '@/account/users-store';
import { checkPasswordPolicy } from '@/account/password-policy';
import { hitForgotRateLimit, RESET_RL_MAX, RESET_RL_WINDOW_SEC } from '@/account/forgot-rate-limit';
import { clientIp, jsonErr, jsonFromError, jsonOk, readJsonBody } from '@/account/http';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';
import { maskName, maskUsername } from '@/auth/mask';

export const runtime = 'nodejs';



export async function GET(req: NextRequest) {
  try {
    const token = (req.nextUrl.searchParams.get('token') ?? '').trim();
    const hit = await verifyResetToken(token);
    if (!hit) return jsonOk({ valid: false });

    const user = await findUserById(hit.userId);
    if (!user) return jsonOk({ valid: false });

    return jsonOk({
      valid: true,
      expires_at: hit.expiresAt,
      user_name_masked: maskName(user.name ?? ''),
      username_masked: maskUsername(user.username ?? ''),
    });
  } catch (e) {
    return jsonFromError(e);
  }
}

const BodySchema = z.object({
  token: z.string().trim().min(1),
  new_password: z.string().max(256),
  confirm_password: z.string().max(256),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  try {
    // Brief: reset 5/hour/ip. Separate key prefix so it does not consume the
    // forgot-password budget even though it shares v1's store file.
    const rl = await hitForgotRateLimit(ip, {
      max: RESET_RL_MAX,
      windowSec: RESET_RL_WINDOW_SEC,
      keyPrefix: 'reset:',
    });
    if (!rl.allowed) {
      await logSecurity({ user: null, team: null, event: 'reset_password_rate_limited', ip, meta: { count: rl.count } });
      return jsonErr('คำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', 429, 'rate_limited');
    }

    const parsed = BodySchema.safeParse((await readJsonBody(req)) ?? {});
    if (!parsed.success) return jsonErr('Token is required', 400, 'validation');
    const { token, new_password, confirm_password } = parsed.data;

    const policy = checkPasswordPolicy(new_password);
    if (!policy.ok) return jsonErr(policy.errors[0]!, 400, 'weak_password');
    if (new_password !== confirm_password) {
      return jsonErr('Passwords do not match', 400, 'mismatch');
    }

    // Atomically consume the token (single-use) — v1 order.
    const userId = await consumeResetToken(token);
    if (!userId) {
      await logSecurity({
        user: null,
        team: null,
        event: 'reset_token_invalid',
        ip,
        meta: { token_prefix: token.slice(0, 8) },
      });
      return jsonErr(
        'ลิงก์รีเซ็ตรหัสผ่านนี้หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่',
        400,
        'token_invalid',
      );
    }

    const result = await setUserPassword({
      userId,
      newPassword: new_password,
      skipCurrentCheck: true,
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        await logSecurity({ user: userId, team: null, event: 'reset_token_orphan', ip });
        return jsonErr('User account no longer exists', 404, 'not_found');
      }
      if (result.reason === 'same_as_current') {
        return jsonErr(
          'New password cannot be the same as your current password',
          400,
          'same_as_current',
        );
      }
      if (result.reason === 'reused') {
        return jsonErr(
          `Cannot reuse one of your last ${result.historyCount} passwords. Please choose a different password.`,
          400,
          'password_reused',
        );
      }
      return jsonErr('Unable to reset password', 400, result.reason);
    }

    const team = result.user.team ?? null;
    await logActivity({
      user: userId,
      team,
      action: 'password_reset_via_token',
      meta: { ip },
    });
    await logSecurity({
      user: userId,
      team,
      event: 'password_reset_completed',
      ip,
    });

    return jsonOk({ message: 'รีเซ็ตรหัสผ่านสำเร็จ' });
  } catch (e) {
    return jsonFromError(e);
  }
}
