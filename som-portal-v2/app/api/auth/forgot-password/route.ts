// som-portal-v2/app/api/auth/forgot-password/route.ts
//
// Port of v1 `api/auth/forgot-password.php`. PUBLIC (middleware PUBLIC_PATHS).
//
// v1 parity:
//   • per-IP rate limit 3 / 15 min in the GLOBAL data/forgot_rate_limit.json,
//     incremented BEFORE the limit test, `Retry-After` header on 429
//   • lookup by USERNAME (case-insensitive) in the GLOBAL data/users.json
//   • identical generic success message in EVERY path — never leaks whether the
//     account, or its email, exists
//   • 24-hour token in data/password_reset_tokens.json via createResetToken()
//   • logSecurity on all six outcomes, using v1's event names

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  FORGOT_RL_MAX,
  FORGOT_RL_WINDOW_SEC,
  hitForgotRateLimit,
} from '@/account/forgot-rate-limit';
import {
  findUserByEmailGlobal,
  findUserByUsernameGlobal,
  type V1User,
} from '@/account/users-store';
import { createResetToken } from '@/account/reset-tokens';
import { clientIp, jsonErr, jsonFromError, jsonOk, readJsonBody } from '@/account/http';
import { buildResetPasswordEmail } from '@/mail/reset-password-email';
import { sendMail } from '@/mail/mailer';
import { resolveMailConfig } from '@/mail/mail-config';
import { logSecurity } from '@/logging/security';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * v1's identical-in-every-path response message. Must not vary — it is the
 * anti-enumeration guarantee.
 */
const GENERIC_MSG =
  'หากชื่อผู้ใช้นี้มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลของบัญชีนี้แล้ว กรุณาตรวจสอบกล่องอีเมล';

// v1 reads `username`. The A6 brief asks for an email field, so both are
// accepted and resolved against username first (v1 order), then email.
const BodySchema = z.object({
  username: z.string().max(64).optional(),
  email: z.string().max(120).optional(),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resetUrl(token: string): string {
  const base = env().BASE_URL.replace(/\/+$/, '');
  return `${base}/v2/reset-password?token=${token}`;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  try {
    const rl = await hitForgotRateLimit(ip, {
      max: FORGOT_RL_MAX,
      windowSec: FORGOT_RL_WINDOW_SEC,
    });
    if (!rl.allowed) {
      await logSecurity({
        user: null,
        team: null,
        event: 'forgot_password_rate_limited',
        ip,
        meta: { count: rl.count },
      });
      return jsonErr('คำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', 429, 'rate_limited');
    }

    const parsed = BodySchema.safeParse((await readJsonBody(req)) ?? {});
    const identifier = (parsed.success ? parsed.data.username || parsed.data.email : '') ?? '';
    const needle = identifier.trim();

    if (!needle || [...needle].length > 64) {
      await logSecurity({
        user: null,
        team: null,
        event: 'forgot_password_invalid_input',
        ip,
      });
      return jsonOk({ message: GENERIC_MSG });
    }

    let user: V1User | null = await findUserByUsernameGlobal(needle);
    if (!user && EMAIL_RE.test(needle)) user = await findUserByEmailGlobal(needle);

    if (!user) {
      await logSecurity({
        user: null,
        team: null,
        event: 'forgot_password_no_user',
        ip,
        meta: { username_tried: needle },
      });
      return jsonOk({ message: GENERIC_MSG });
    }

    const email = (user.email ?? '').trim();
    if (!email || !EMAIL_RE.test(email)) {
      await logSecurity({
        user: user.id,
        team: user.team ?? null,
        event: 'forgot_password_no_email',
        ip,
        meta: { username: user.username },
      });
      return jsonOk({ message: GENERIC_MSG });
    }

    const entry = await createResetToken(user.id, 24);
    const url = resetUrl(entry.token);

    const { config } = await resolveMailConfig(user.team ?? null);
    const mail = buildResetPasswordEmail(
      user.name ?? user.username,
      url,
      entry.expires_at,
      'forgot',
      config.from_name,
    );

    const sent = await sendMail({
      to: email,
      subject: mail.subject,
      html: mail.html,
      team: user.team ?? null,
      sent_by: 'system',
      sent_by_name: 'forgot-password',
      log_type: 'password_reset',
      log_meta: {
        target_user_id: user.id,
        username: user.username,
        reason: 'forgot',
        ip,
      },
    });

    if (!sent.ok) {
      // v1: never expose the SMTP error; log it and still answer generically.
      await logSecurity({
        user: user.id,
        team: user.team ?? null,
        event: 'forgot_password_email_failed',
        ip,
        meta: { username: user.username, error: sent.error },
      });
      return jsonOk({ message: GENERIC_MSG });
    }

    await logSecurity({
      user: user.id,
      team: user.team ?? null,
      event: 'forgot_password_sent',
      ip,
      meta: { username: user.username, dry_run: sent.dryRun ?? false },
    });

    return jsonOk({ message: GENERIC_MSG });
  } catch (e) {
    return jsonFromError(e);
  }
}
