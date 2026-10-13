// POST: reply to a message from the team mailbox (v1 api/inbox/send.php, reply path)
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { replyToMessage } from '@/inbox/service';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  folder: z.string().default('INBOX'),
  uid: z.number().int().positive(),
  body: z.string().min(1).max(20000),
  all: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const b = Body.parse(await jsonBody(req));
    return okJson(await replyToMessage(session, b));
  } catch (e) {
    return errorJson(e);
  }
}
