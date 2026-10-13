// som-portal-v2/app/api/v1/user-prefs/route.ts
//
// GET / PATCH the signed-in user's preferences.
//
// New in v2 (v1 kept the theme in localStorage), but strictly TEAM-SCOPED:
// readUserPrefs/patchUserPrefs go through readTeamFile/writeTeamFile, so the
// file resolved is always `data/<jwt.team>/user-prefs.json`. The user id used
// as the record key comes from the verified JWT `sub`, never the body, so one
// user cannot write another's prefs.

import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { patchUserPrefs, readUserPrefs } from '@/account/user-prefs';
import { UserPrefsPatchSchema } from '@/data/schemas/user-prefs';
import { jsonErr, jsonFromError, jsonOk, readJsonBody } from '@/account/http';
import { logActivity } from '@/logging/activity';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const sess = await requireAuth();
    const prefs = await readUserPrefs(sess.sub);
    return jsonOk(prefs);
  } catch (e) {
    return jsonFromError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sess = await requireAuth();
    const parsed = UserPrefsPatchSchema.safeParse((await readJsonBody(req)) ?? {});
    if (!parsed.success) {
      return jsonErr('Invalid preferences payload', 400, 'validation');
    }

    const next = await patchUserPrefs(sess.sub, parsed.data);
    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'user_prefs_update',
      meta: { fields: Object.keys(parsed.data) },
    });
    return jsonOk(next);
  } catch (e) {
    return jsonFromError(e);
  }
}
