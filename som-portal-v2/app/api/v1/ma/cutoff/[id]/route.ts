// PUT: change one cut-off service. DELETE: remove one (SM team only)
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { deleteCutoff, updateCutoff } from '@/ma/cutoff-store';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await ctx.params;
    return okJson(await updateCutoff(Number(id), await jsonBody(req)));
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await ctx.params;
    await deleteCutoff(Number(id));
    return okJson({ deleted: true });
  } catch (e) {
    return errorJson(e);
  }
}
