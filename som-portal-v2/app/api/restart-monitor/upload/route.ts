// app/api/restart-monitor/upload/route.ts
// POST: manual upload of restart data (admin only)
// Matches v1 api/restart-monitor/upload.php (JWT-auth variant)
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { listRunways } from '@/restart-monitor/runways';
import { writeRawReport } from '@/restart-monitor/raw-store';
import { RawReport } from '@/restart-monitor/types';
import { logActivity } from '@/logging/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const session = await requireRole(...ADMIN_ROLES);
    const body = await req.json();
    const { runway, date, data } = body as {
      runway?: string;
      date?: string;
      data?: unknown;
    };

    // Validate required fields
    if (!runway) {
      return NextResponse.json(
        { success: false, message: 'runway is required' },
        { status: 400 },
      );
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, message: 'date is required (YYYY-MM-DD)' },
        { status: 400 },
      );
    }
    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        { success: false, message: 'data object is required' },
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

    // Merge runway/date into data and validate against RawReport schema
    const reportData = {
      ...(data as Record<string, unknown>),
      date,
      runway: rw.name,
      source: (data as Record<string, unknown>).source ?? 'manual-upload',
      generatedAt:
        (data as Record<string, unknown>).generatedAt ?? new Date().toISOString(),
    };

    const parsed = RawReport.safeParse(reportData);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Data validation failed',
          errors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    // Write to raw store
    await writeRawReport(session.team, rw.slug, date, parsed.data);

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'restart_monitor_upload',
      meta: {
        date,
        runway: rw.name,
        totalPods: parsed.data.totalPods,
        totalRestarts: parsed.data.totalRestarts,
        source: parsed.data.source,
        uploadedBy: session.username,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        date,
        runway: rw.name,
        totalPods: parsed.data.totalPods,
        totalRestarts: parsed.data.totalRestarts,
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
