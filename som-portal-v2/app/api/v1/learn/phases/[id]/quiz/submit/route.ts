// som-portal-v2/app/api/v1/learn/phases/[id]/quiz/submit/route.ts
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { submitPhaseQuiz } from '@/learn/service';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ answers: z.record(z.string(), z.unknown()) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonErr('answers must be an object', 400);
    return jsonOk(await submitPhaseQuiz(session, id, parsed.data.answers));
  });
}
