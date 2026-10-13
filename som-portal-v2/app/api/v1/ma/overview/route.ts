// GET: MA Overview numbers for a year (landing page)
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { getOverview } from '@/ma/overview';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const q = new URL(req.url).searchParams;
    const year = Number(q.get('year')) || new Date().getFullYear();
    return okJson(await getOverview(year));
  } catch (e) {
    return errorJson(e);
  }
}
