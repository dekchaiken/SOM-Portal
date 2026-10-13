// app/api/service-performance/suggestions/route.ts
// GET ?service=X&runway=Y: auto-suggestions for a service
// Matches v1 api/service-performance/suggestions.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ALL_STAFF_ROLES } from '@/auth/policy';
import { getServiceDetail } from '@/service-performance/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireRole(...ALL_STAFF_ROLES);
    const q = new URL(req.url).searchParams;
    const service = q.get('service') ?? '';
    const runway = q.get('runway') ?? '';

    if (!service) {
      return NextResponse.json(
        { success: false, message: 'service query parameter is required' },
        { status: 400 },
      );
    }

    const detail = await getServiceDetail({ service, runway: runway || undefined });
    if (detail.error) {
      return NextResponse.json(
        { success: false, message: detail.error },
        { status: 404 },
      );
    }

    const { totals } = detail;
    const suggestions: Array<{
      type: string;
      severity: 'info' | 'warning' | 'critical';
      message: string;
    }> = [];

    if (totals.cpuPct != null && totals.cpuPct >= 80) {
      suggestions.push({
        type: 'cpu',
        severity: totals.cpuPct >= 95 ? 'critical' : 'warning',
        message: `CPU usage is at ${totals.cpuPct}% — consider scaling or optimizing CPU-intensive operations`,
      });
    }

    if (totals.memPct != null && totals.memPct >= 80) {
      suggestions.push({
        type: 'memory',
        severity: totals.memPct >= 95 ? 'critical' : 'warning',
        message: `Memory usage is at ${totals.memPct}% — consider increasing memory limits or investigating leaks`,
      });
    }

    if (totals.pods <= 1) {
      suggestions.push({
        type: 'availability',
        severity: 'warning',
        message: 'Running with only 1 pod — consider scaling to at least 2 for high availability',
      });
    }

    return NextResponse.json({
      success: true,
      data: { service, suggestions },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
