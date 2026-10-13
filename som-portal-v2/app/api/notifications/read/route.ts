// POST: mark notification(s) as read
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { markRead, markAllRead } from '@/notifications/store';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await jsonBody(req);
    const id = (body.id as string) ?? 'all';

    if (id === 'all') {
      await markAllRead(session.sub);
    } else {
      await markRead(session.sub, id);
    }

    return okJson({ marked: id });
  } catch (e) {
    return errorJson(e);
  }
}
