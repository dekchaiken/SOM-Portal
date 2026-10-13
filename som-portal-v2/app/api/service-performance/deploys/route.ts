// app/api/service-performance/deploys/route.ts
// GET ?service=X&runway=Y: deploy history for a service
// Matches v1 api/service-performance/deploys.php
// v2 does not have Grafana annotation queries yet, so this returns an empty array.
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

    // v2 does not query Grafana deploy annotations yet.
    // Return empty deploys array so the frontend contract is satisfied.
    return NextResponse.json({
      success: true,
      data: {
        service,
        runway: detail.runway,
        deploys: [],
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
