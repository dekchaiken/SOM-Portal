// app/api/restart-monitor/backfill/route.ts
// POST: backfill historical restart data for a date range (admin only)
// Matches v1 api/restart-monitor/backfill.php (web-callable subset)
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { triggerFetch } from '@/restart-monitor/service';
import { listRunways } from '@/restart-monitor/runways';
import { logActivity } from '@/logging/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Iterate calendar dates from start to end (inclusive), YYYY-MM-DD strings. */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00+07:00`);
  const last = new Date(`${end}T00:00:00+07:00`);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const session = await requireRole(...ADMIN_ROLES);
    const body = await req.json();
    const { runway, start_date, end_date, force } = body as {
      runway?: string;
      start_date?: string;
      end_date?: string;
      force?: boolean;
    };

    // Validate required fields
    if (!runway) {
      return NextResponse.json(
        { success: false, message: 'runway is required' },
        { status: 400 },
      );
    }
    if (!start_date || !end_date) {
      return NextResponse.json(
        { success: false, message: 'start_date and end_date are required (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(start_date) || !dateRe.test(end_date)) {
      return NextResponse.json(
        { success: false, message: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 },
      );
    }

    if (start_date > end_date) {
      return NextResponse.json(
        { success: false, message: 'start_date must be <= end_date' },
        { status: 400 },
      );
    }

    // Verify runway exists
    const runways = await listRunways();
    const rw = runways.find((r) => r.name === runway || r.slug === runway);
    if (!rw) {
      return NextResponse.json(
        { success: false, message: `Unknown runway: ${runway}` },
        { status: 400 },
      );
    }

    // Cap range to 90 days to avoid runaway requests
    const dates = dateRange(start_date, end_date);
    if (dates.length > 90) {
      return NextResponse.json(
        { success: false, message: 'Date range too large (max 90 days)' },
        { status: 400 },
      );
    }

    // Iterate each date and call triggerFetch
    const results: { date: string; status: string; reason?: string }[] = [];
    let doneCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const dateStr of dates) {
      try {
        const fetchResult = await triggerFetch(session, rw.name, dateStr, force ?? false);
        const r = fetchResult.results[0];
        if (r) {
          results.push({ date: dateStr, status: r.status, reason: r.reason });
          if (r.status === 'done') doneCount++;
          else if (r.status === 'already_done' || r.status === 'skip') skipCount++;
          else errorCount++;
        }
      } catch (e) {
        results.push({ date: dateStr, status: 'error', reason: (e as Error).message });
        errorCount++;
      }
    }

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'restart_monitor_backfill',
      meta: {
        runway: rw.name,
        start_date,
        end_date,
        totalDates: dates.length,
        done: doneCount,
        skipped: skipCount,
        errors: errorCount,
        triggeredBy: session.username,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        runway: rw.name,
        start_date,
        end_date,
        totalDates: dates.length,
        done: doneCount,
        skipped: skipCount,
        errors: errorCount,
        results,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
