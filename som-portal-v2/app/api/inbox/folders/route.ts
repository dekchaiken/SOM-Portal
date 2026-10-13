// GET: folders in the team mailbox
import { requireAuth } from '@/auth/policy';
import { listFolders } from '@/inbox/service';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return okJson(await listFolders(await requireAuth()));
  } catch (e) {
    return errorJson(e);
  }
}
