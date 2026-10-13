// som-portal-v2/app/api/v1/search/route.ts
// Global search across the board and Jira templates. Each source is gated by
// the same access check its own page uses, so a team only sees what it can open.
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { requireBoardRead } from '@/board/access';
import { listPosts } from '@/board/service';
import { requireJiraRead } from '@/jira/access';
import { listTemplates } from '@/jira/templates';
import { handle, jsonErr, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 10;

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return jsonErr('Type at least 2 characters', 400);

    const needle = q.toLowerCase();
    const board = await (async () => {
      try {
        const access = await requireBoardRead();
        const { items } = await listPosts(access, {
          search: q,
          status: undefined,
          board_type: '',
          author_id: '',
          starred: false,
          limit: LIMIT,
          offset: 0,
        });
        return items.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          author: p.author_name ?? '',
          created_at: p.created_at ?? '',
        }));
      } catch {
        return [];
      }
    })();

    const templates = await (async () => {
      try {
        await requireJiraRead();
        const all = await listTemplates();
        return all
          .filter((t) => `${t.name} ${t.summary ?? ''}`.toLowerCase().includes(needle))
          .slice(0, LIMIT)
          .map((t) => ({ id: t.id, name: t.name, category: t.category ?? '' }));
      } catch {
        return [];
      }
    })();

    return jsonOk({ q, board, templates });
  });
}
