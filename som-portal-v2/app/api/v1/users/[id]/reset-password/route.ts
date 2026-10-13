// som-portal-v2/app/api/v1/users/[id]/reset-password/route.ts
// v1 counterpart: api/users/index.php PATCH (?id=) — admin-triggered reset.
// v1 mails a 24 h link; here the temp password is returned exactly once.
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { resetUserPassword } from '@/admin/users-service';
import { getSettings } from '@/admin/system-settings-service';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await ctx.params;
    const settings = await getSettings();
    return okJson(
      await resetUserPassword(session, id, Number(settings.password_history_count) || 5),
    );
  } catch (e) {
    return errorJson(e);
  }
}
