// som-portal-v2/app/api/v1/batch-file-index/search/route.ts
//
// Port of api/batch-file-index/lookup.php, exposed as the brief's
// `GET /api/v1/batch-file-index/search?q=`. POST is accepted too, matching v1's
// `{ filename }` body, so the same handler serves both shapes.
//
// Gate: `batch-file-search` feature. The index is SM-shared (read-only for
// every granted team); SM keeps the crawler/write endpoints, which are not
// ported here.
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/auth/policy';
import { requireTeamFeature } from '@/team/features';
import { logActivity } from '@/logging/activity';
import { lookupFile } from '@/jenkins/file-index';
import { handle, jsonErr, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const FILE_SEARCH_FEATURE = 'batch-file-search';

async function run(sessPromise: ReturnType<typeof requireAuth>, filename: string) {
  const sess = await sessPromise;
  await requireTeamFeature(sess, FILE_SEARCH_FEATURE);
  if (filename.trim() === '') return jsonErr('filename required', 400);

  const result = await lookupFile(filename);
  await logActivity({
    user: sess.sub,
    team: sess.team,
    action: 'batch_file_index_lookup',
    meta: {
      filename_len: result.cleaned.length,
      normalized_len: result.normalized.length,
      tier: result.tier,
      match_count: result.total,
    },
  });
  return jsonOk(result);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    return run(requireAuth(), q.get('q') ?? q.get('filename') ?? '');
  });
}

const PostSchema = z.object({
  filename: z.string().optional(),
  q: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const body = PostSchema.parse(await req.json().catch(() => ({})));
    return run(requireAuth(), body.filename ?? body.q ?? '');
  });
}
