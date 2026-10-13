// som-portal-v2/app/api/v1/learn/exams/attempt/[attemptId]/events/route.ts
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { recordEvent } from '@/learn/exam-service';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ type: z.string().min(1).max(40), meta: z.unknown().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ attemptId: string }> }): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    const { attemptId } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonErr('type is required', 400);
    return jsonOk(await recordEvent(session, attemptId, parsed.data.type, parsed.data.meta));
  });
}
