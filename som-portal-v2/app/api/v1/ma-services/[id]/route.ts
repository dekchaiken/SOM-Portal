// PUT /api/v1/ma-services/[id] — update MA service
// DELETE /api/v1/ma-services/[id] — delete MA service
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { updateService, deleteService } from '@/ma/services-store';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await req.json();
    const svc = await updateService({ ...body, id: Number(id) });
    return jsonOk(svc);
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    await deleteService(Number(id));
    return jsonOk({ deleted: true });
  });
}
