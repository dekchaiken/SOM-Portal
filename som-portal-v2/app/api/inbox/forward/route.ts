// POST: forward a message from the team mailbox
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { forwardMessage, parseRecipientsOrThrow } from '@/inbox/service';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  folder: z.string().default('INBOX'),
  uid: z.number().int().positive(),
  to: z.string().min(1),
  body: z.string().max(20000).default(''),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const b = Body.parse(await jsonBody(req));
    return okJson(await forwardMessage(session, { ...b, to: parseRecipientsOrThrow(b.to) }));
  } catch (e) {
    return errorJson(e);
  }
}
