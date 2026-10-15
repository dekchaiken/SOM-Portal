// som-portal-v2/app/api/v1/auth/legacy-close/route.ts
// Superadmin: give every legacy account its team default. Wealth BU, Jenkins Portal and
// SO Jenkins keep password. Everyone else moves to SSO only.
import { closeLegacyPasswordAccess } from '@/auth/user-admin';
import { jsonOk } from '@/account/http';
import { requireSuperAdmin, mapAuthAdminError } from '../_shared';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    const sess = await requireSuperAdmin();
    const result = await closeLegacyPasswordAccess(sess.sub);
    return jsonOk({ closed: result.closed, kept_password: result.kept_password });
  } catch (e) {
    return mapAuthAdminError(e);
  }
}
