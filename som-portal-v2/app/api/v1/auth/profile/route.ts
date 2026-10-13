// som-portal-v2/app/api/v1/auth/profile/route.ts
//
// Port of v1 `api/auth/profile.php` (GET + PATCH). Same editable field set,
// same validation limits, same returned DTO keys, same logActivity action
// name ('profile_update'). Writes always target the session's OWN record.

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import {
  findUserById,
  sameTeam,
  toProfileDto,
  updateOwnProfile,
} from '@/account/users-store';
import { clientIp, jsonErr, jsonFromError, jsonOk, readJsonBody } from '@/account/http';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const sess = await requireAuth();
    const user = await findUserById(sess.sub);
    if (!user) return jsonErr('User not found', 404, 'not_found');
    if (!sameTeam(user, sess.team, sess.role)) {
      return jsonErr('Forbidden', 403, 'forbidden');
    }
    return jsonOk(toProfileDto(user));
  } catch (e) {
    return jsonFromError(e);
  }
}

const PatchSchema = z
  .object({
    name: z.string().optional(),
    nickname: z.string().optional(),
    email: z.string().optional(),
    avatar_url: z.string().optional(),
    name_th: z.string().optional(),
    emp_id: z.string().optional(),
    phone: z.string().optional(),
    tmn_id: z.string().optional(),
    net_home: z.string().optional(),
    net_mobile: z.string().optional(),
  })
  .strict();

export async function PATCH(req: NextRequest) {
  const ip = clientIp(req);
  try {
    const sess = await requireAuth();
    const parsed = PatchSchema.safeParse((await readJsonBody(req)) ?? {});
    if (!parsed.success) return jsonErr('Invalid request body', 400, 'validation');

    const result = await updateOwnProfile(sess.sub, parsed.data, sess.team, sess.role);
    if (!result.ok) {
      if (result.status === 403) {
        await logSecurity({
          user: sess.sub,
          team: sess.team,
          event: 'profile_update_cross_team_blocked',
          ip,
        });
      }
      return jsonErr(result.error, result.status, 'profile_update_failed');
    }

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'profile_update',
      meta: { changed: result.changed, ip },
    });

    return jsonOk({ ...toProfileDto(result.user), message: 'Profile updated' });
  } catch (e) {
    return jsonFromError(e);
  }
}
