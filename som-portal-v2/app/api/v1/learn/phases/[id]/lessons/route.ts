// som-portal-v2/app/api/v1/learn/phases/[id]/lessons/route.ts
import { requireAuth } from '@/auth/policy';
import { getPhaseLessons } from '@/learn/service';
import { handle, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    const { id } = await ctx.params;
    return jsonOk(await getPhaseLessons(session, id));
  });
}
