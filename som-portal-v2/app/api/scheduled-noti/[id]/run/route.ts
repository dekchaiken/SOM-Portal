// POST: manually trigger a scheduled job
import { type NextRequest } from 'next/server';
import { runJob } from '@/scheduled-noti/runner';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const result = await runJob(id);
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}
