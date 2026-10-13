// GET /api/v1/ma-status — cached MA status dashboard data
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk } from '@/jenkins/route-helpers';
import { readStatusCache, readHidden, filterItems } from '@/ma/status-poller';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    const q = new URL(req.url).searchParams;
    const source = q.get('source') ?? undefined;

    const [cache, hidden] = await Promise.all([readStatusCache(), readHidden()]);
    const items = filterItems(cache, hidden, source);

    return jsonOk({
      ts: cache.ts,
      filter: cache.filter,
      sources: Object.keys(cache.payload.sources),
      items,
      total: items.length,
    });
  });
}
