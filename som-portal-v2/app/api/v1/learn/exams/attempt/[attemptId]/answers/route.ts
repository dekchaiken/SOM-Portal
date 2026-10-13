// som-portal-v2/app/api/v1/learn/exams/attempt/[attemptId]/answers/route.ts
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { saveAnswers } from '@/learn/exam-service';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ answers: z.record(z.string(), z.unknown()) });

export async function PUT(req: Request, ctx: { params: Promise<{ attemptId: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    const { attemptId } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonErr('answers must be an object', 400);
    return jsonOk(await saveAnswers(session, attemptId, parsed.data.answers));
  });
}
