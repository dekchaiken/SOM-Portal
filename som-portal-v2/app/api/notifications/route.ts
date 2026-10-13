// GET: list notifications for current user
import { requireAuth } from '@/auth/policy';
import { listForUser } from '@/notifications/store';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    const result = await listForUser(session.sub);
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}
