// GET: teams that can have their own mailbox (super_admin only; used by the team picker)
import { requireRole, SUPER_ADMIN } from '@/auth/policy';
import { loadTeams } from '@/team/features';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireRole(SUPER_ADMIN);
    const teams = await loadTeams();
    return okJson(teams.map((t) => ({ slug: t.slug, name: t.name ?? t.slug })));
  } catch (e) {
    return errorJson(e);
  }
}
