// som-portal-v2/app/api/v1/auth/users/[id]/route.ts
// Superadmin: change which sign-in methods one user may use. Granting password issues a
// one-time setup link that the superadmin copies to the user.
import { type NextRequest } from 'next/server';
import { setAllowedMethods, MethodsPatchSchema } from '@/auth/user-admin';
import { jsonErr, jsonOk, readJsonBody } from '@/account/http';
import { requireSuperAdmin, mapAuthAdminError } from '../../_shared';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  try {
    const sess = await requireSuperAdmin();
    const { id } = await params;
    const parsed = MethodsPatchSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return jsonErr('Pick a valid list of sign-in methods', 400, 'validation');

    const result = await setAllowedMethods(id, parsed.data.allowed_methods, sess.sub);
    const setupUrl = result.setup_token
      ? `${req.nextUrl.origin}/v2/reset-password?token=${result.setup_token}`
      : null;
    return jsonOk({
      user: result.user,
      setup_url: setupUrl,
      setup_expires_at: result.setup_expires_at,
    });
  } catch (e) {
    return mapAuthAdminError(e);
  }
}
