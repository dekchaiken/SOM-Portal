// app/api/restart-monitor/route.ts
// GET: list reports. ?action=raw-list|raw-detail|detail|runways
// Matches v1 api/restart-monitor/index.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth, ALL_STAFF_ROLES, requireRole } from '@/auth/policy';
import { listMonitorReports, getReportDetail } from '@/restart-monitor/service';
import { listRunways } from '@/restart-monitor/runways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const session = await requireRole(...ALL_STAFF_ROLES);
    const q = new URL(req.url).searchParams;
    const action = q.get('action') ?? 'list';
    const runway = q.get('runway') ?? '';

    // action=runways — lightweight list
    if (action === 'runways') {
      const runways = await listRunways();
      return NextResponse.json({
        success: true,
        data: {
          runways: runways.map((r) => ({ name: r.name, slug: r.slug })),
        },
      });
    }

    // action=raw-detail or detail — single date report
    if (action === 'raw-detail' || action === 'detail') {
      const date = q.get('date') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json(
          { success: false, message: 'Invalid date format. Use YYYY-MM-DD' },
          { status: 400 },
        );
      }
      // Find runway slug
      let slug = q.get('slug') ?? '';
      if (!slug && runway) {
        const runways = await listRunways();
        const rw = runways.find((r) => r.name === runway);
        slug = rw?.slug ?? '';
      }
      if (!slug) {
        return NextResponse.json(
          { success: false, message: 'runway or slug required' },
          { status: 400 },
        );
      }
      const report = await getReportDetail(session, slug, date);
      if (!report) {
        return NextResponse.json(
          { success: false, message: `Report not found for ${date}` },
          { status: 404 },
        );
      }
      return NextResponse.json({ success: true, data: report });
    }

    // action=raw-list or list (default) — all reports
    const runways = await listRunways();
    let runwaySlug = '';
    if (runway) {
      const rw = runways.find((r) => r.name === runway);
      if (!rw) {
        return NextResponse.json(
          { success: false, message: `Unknown runway '${runway}'` },
          { status: 400 },
        );
      }
      runwaySlug = rw.slug;
    }

    const result = await listMonitorReports(session, runwaySlug || undefined);

    // Single-runway backward compat
    if (runwaySlug && result.byRunway[runwaySlug]) {
      return NextResponse.json({ success: true, data: result.byRunway[runwaySlug] });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
