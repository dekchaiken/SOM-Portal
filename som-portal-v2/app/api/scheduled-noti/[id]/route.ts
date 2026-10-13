// PUT/DELETE: update/remove a scheduled job
import { type NextRequest } from 'next/server';
import { updateJob, deleteJob } from '@/scheduled-noti/store';
import { UpdateScheduledJobSchema } from '@/scheduled-noti/types';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await jsonBody(req);
    const parsed = UpdateScheduledJobSchema.parse(body);
    const result = await updateJob(id, parsed);
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteJob(id);
    return okJson({ deleted: true });
  } catch (e) {
    return errorJson(e);
  }
}
