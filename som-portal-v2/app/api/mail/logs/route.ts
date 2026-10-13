// GET: mail logs (admin only)
import { type NextRequest } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { listMailLogs } from '@/mail/logs';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireRole(...ADMIN_ROLES);
    const url = new URL(req.url);
    const result = await listMailLogs({
      search: url.searchParams.get('search') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      limit: Number(url.searchParams.get('limit')) || 50,
      offset: Number(url.searchParams.get('offset')) || 0,
    });
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}
