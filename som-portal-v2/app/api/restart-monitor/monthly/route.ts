// app/api/restart-monitor/monthly/route.ts
// GET: monthly aggregated report data. POST: send monthly report (admin only).
// Matches v1 api/restart-monitor/monthly.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ADMIN_ROLES, ALL_STAFF_ROLES } from '@/auth/policy';
import { listMonitorReports, getAggregatedStats } from '@/restart-monitor/service';
import { listRunways } from '@/restart-monitor/runways';
import { logActivity } from '@/logging/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const session = await requireRole(...ALL_STAFF_ROLES);
    const q = new URL(req.url).searchParams;
    const runway = q.get('runway') ?? '';

    const runways = await listRunways();
    const targetRunways = runway
      ? runways.filter((r) => r.name === runway || r.slug === runway)
      : runways;

    if (runway && targetRunways.length === 0) {
      return NextResponse.json(
        { success: false, message: `Unknown runway: ${runway}` },
        { status: 400 },
      );
    }

    const results: Record<string, unknown> = {};
    for (const rw of targetRunways) {
      results[rw.slug] = await getAggregatedStats(session, rw.slug);
    }

    return NextResponse.json({
      success: true,
      data: {
        runways: targetRunways.map((r) => ({
          name: r.name,
          slug: r.slug,
          color: r.color,
        })),
        stats: results,
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

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const session = await requireRole(...ADMIN_ROLES);
    const body = await req.json();
    const { runway, recipients } = body as {
      runway?: string;
      recipients?: string[];
    };

    if (!runway) {
      return NextResponse.json(
        { success: false, message: 'runway is required' },
        { status: 400 },
      );
    }

    const runways = await listRunways();
    const rw = runways.find((r) => r.name === runway || r.slug === runway);
    if (!rw) {
      return NextResponse.json(
        { success: false, message: `Unknown runway: ${runway}` },
        { status: 400 },
      );
    }

    const stats = await getAggregatedStats(session, rw.slug);

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'restart_monitor_monthly_send',
      meta: {
        runway: rw.name,
        recipientCount: recipients?.length ?? 0,
        triggeredBy: session.username,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        message: 'Monthly report generated',
        runway: rw.name,
        stats,
        recipientCount: recipients?.length ?? 0,
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
