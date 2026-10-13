// GET: list the team inbox (v1 api/inbox/list.php)
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { listInbox } from '@/inbox/service';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const q = new URL(req.url).searchParams;
    const result = await listInbox(session, {
      folder: q.get('folder') ?? undefined,
      limit: Number(q.get('limit')) || 25,
      offset: Number(q.get('offset')) || 0,
      unreadOnly: q.get('filter') === 'unread',
    });
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}
