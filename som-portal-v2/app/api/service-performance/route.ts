// GET /api/service-performance — overview (all runways, cached)
// Matches v1 GET /api/service-performance/index.php
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/auth/policy';
import { ALL_STAFF_ROLES } from '@/auth/policy';
import { getOverview } from '@/service-performance/service';

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(...ALL_STAFF_ROLES);
    const url = new URL(req.url);
    const runway = url.searchParams.get('runway') ?? 'all';
    const showAll = url.searchParams.get('showAll') === '1' || url.searchParams.get('show_all') === '1';

    const data = await getOverview({ runway, showAll });
    return NextResponse.json({ success: true, message: 'OK', data });
  } catch (e) {
    const status = e instanceof Error && 'status' in e ? (e as { status: number }).status : 500;
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ success: false, message }, { status });
  }
}
