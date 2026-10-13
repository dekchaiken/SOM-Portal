// POST: move a message to another folder (v1 api/inbox/move.php)
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { moveMessage } from '@/inbox/service';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ folder: z.string().default('INBOX'), uid: z.number().int().positive(), target: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const b = Body.parse(await jsonBody(req));
    await moveMessage(session, b.folder, b.uid, b.target);
    return okJson({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
