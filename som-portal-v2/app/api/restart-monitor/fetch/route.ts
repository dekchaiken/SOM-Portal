// app/api/restart-monitor/fetch/route.ts
// POST: trigger Prometheus fetch for runway+date (admin only)
// Matches v1 api/restart-monitor/fetch.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { triggerFetch } from '@/restart-monitor/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const session = await requireRole(...ADMIN_ROLES);
    const q = new URL(req.url).searchParams;
    const runway = q.get('runway') ?? undefined;
    const date = q.get('date') ?? undefined;
    const force = q.has('force');

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, message: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const result = await triggerFetch(session, runway, date, force);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
