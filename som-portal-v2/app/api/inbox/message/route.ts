// GET: one message. Opening it marks it as read (v1 api/inbox/message.php)
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { readMessage } from '@/inbox/service';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const q = new URL(req.url).searchParams;
    const uid = Number(q.get('uid'));
    if (!Number.isInteger(uid) || uid < 1) return errorJson(new Error('uid is required'));
    const msg = await readMessage(session, q.get('folder') ?? 'INBOX', uid);
    if (!msg) return errorJson(new Error('Message not found'));
    return okJson(msg);
  } catch (e) {
    return errorJson(e);
  }
}
