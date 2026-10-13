// app/api/service-performance/dep-drill/route.ts
// GET ?service=X&runway=Y: dependency drill-down for a service
// Matches v1 api/service-performance/dep-drill.php
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

    return NextResponse.json({
      success: true,
      data: {
        service,
        runway: detail.runway,
        namespace: detail.namespace,
        pods: detail.pods,
        totals: detail.totals,
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
