// GET /api/service-performance/detail?service=X&runway=Y — per-service detail
// Matches v1 GET /api/service-performance/detail.php
import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/auth/policy';
import { ALL_STAFF_ROLES } from '@/auth/policy';
import { getServiceDetail } from '@/service-performance/service';

export async function GET(req: NextRequest) {
  try {
    await requireRole(...ALL_STAFF_ROLES);
    const url = new URL(req.url);
    const service = url.searchParams.get('service')?.trim() ?? '';
    const runway = url.searchParams.get('runway')?.trim() ?? '';
    const cluster = url.searchParams.get('cluster')?.trim() ?? '';

    if (!service || !/^[a-z0-9._-]+$/i.test(service)) {
      return NextResponse.json(
        { success: false, message: 'service is required (letters/digits/._-)' },
        { status: 400 },
      );
    }

    const data = await getServiceDetail({ service, runway: runway || undefined, cluster: cluster || undefined });
    return NextResponse.json({ success: true, message: 'OK', data });
  } catch (e) {
    const status = e instanceof Error && 'status' in e ? (e as { status: number }).status : 500;
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ success: false, message }, { status });
  }
}
