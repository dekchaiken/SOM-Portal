// som-portal-v2/app/api/internal/scheduler/tick/route.ts
// Called once a minute by the server cron (see COMPARE-V1-V2.md, Scheduler).
// Authenticated by SCHEDULER_TOKEN, not by a user session. Fails closed when unset.
import { NextResponse, type NextRequest } from 'next/server';
import { tick } from '@/scheduler/tick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.SCHEDULER_TOKEN ?? '';
  const header = req.headers.get('authorization') ?? '';
  if (!expected || header !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }
  try {
    await tick();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[scheduler] tick failed', e);
    return NextResponse.json({ ok: false, code: 'tick_failed' }, { status: 500 });
  }
}
