// POST: set or clear seen, flagged or answered (v1 api/inbox/flag.php)
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { setFlag } from '@/inbox/service';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  folder: z.string().default('INBOX'),
  uid: z.number().int().positive(),
  flag: z.enum(['seen', 'flagged', 'answered']),
  on: z.boolean(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const b = Body.parse(await jsonBody(req));
    await setFlag(session, b.folder, b.uid, b.flag, b.on);
    return okJson({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
