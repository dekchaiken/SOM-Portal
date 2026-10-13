// som-portal-v2/app/api/v1/learn/exams/attempt/[attemptId]/route.ts
import { requireAuth } from '@/auth/policy';
import { getAttempt } from '@/learn/exam-service';
import { handle, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ attemptId: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    const { attemptId } = await ctx.params;
    return jsonOk(await getAttempt(session, attemptId));
  });
}
