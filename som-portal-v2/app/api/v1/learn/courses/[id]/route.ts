// som-portal-v2/app/api/v1/learn/courses/[id]/route.ts
import { requireAuth } from '@/auth/policy';
import { getCourseDetail } from '@/learn/service';
import { handle, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    const { id } = await ctx.params;
    return jsonOk(await getCourseDetail(session, id));
  });
}
