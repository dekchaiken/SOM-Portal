// som-portal-v2/app/api/v1/users/[id]/route.ts
// v1 counterpart: api/users/index.php PUT (?id=) and DELETE (?id=).
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { deleteUser, updateUser, UpdateUserInput } from '@/admin/users-service';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireAuth();
    const { id } = await ctx.params;
    const patch = UpdateUserInput.parse(await jsonBody(req));
    return okJson(await updateUser(session, id, patch));
  } catch (e) {
    return errorJson(e);
  }
}

// Alias so a v1-shaped client (which uses PUT) keeps working.
export const PUT = PATCH;

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireAuth();
    const { id } = await ctx.params;
    const hard = req.nextUrl.searchParams.get('hard') === '1';
    return okJson(await deleteUser(session, id, { hard }));
  } catch (e) {
    return errorJson(e);
  }
}
