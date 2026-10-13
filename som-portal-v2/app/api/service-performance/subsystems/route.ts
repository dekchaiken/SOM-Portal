// app/api/service-performance/subsystems/route.ts
// GET ?service=X&runway=Y: subsystem grouping hierarchy for a service
// Matches v1 api/service-performance/subsystems.php
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

    // Build subsystem breakdown from pod data if available.
    // Group pods by their workload prefix (before the pod hash) as subsystems.
    const subsystemMap = new Map<string, {
      name: string;
      pods: number;
      cpuCores: number;
      cpuLimitCores: number;
      memBytes: number;
      memLimitBytes: number;
    }>();

    for (const pod of detail.pods) {
      // Use the service name itself as the subsystem key —
      // v2 does not yet have dedicated subsystem metadata from inventory.
      const subsystem = service;
      const existing = subsystemMap.get(subsystem);
      if (existing) {
        existing.pods += 1;
        existing.cpuCores += pod.cpuCores;
        existing.cpuLimitCores += pod.cpuLimitCores;
        existing.memBytes += pod.memBytes;
        existing.memLimitBytes += pod.memLimitBytes;
      } else {
        subsystemMap.set(subsystem, {
          name: subsystem,
          pods: 1,
          cpuCores: pod.cpuCores,
          cpuLimitCores: pod.cpuLimitCores,
          memBytes: pod.memBytes,
          memLimitBytes: pod.memLimitBytes,
        });
      }
    }

    const subsystems = Array.from(subsystemMap.values()).map((s) => ({
      ...s,
      cpuCores: Math.round(s.cpuCores * 10000) / 10000,
      cpuLimitCores: Math.round(s.cpuLimitCores * 10000) / 10000,
      cpuPct: s.cpuLimitCores > 0
        ? Math.round(((s.cpuCores / s.cpuLimitCores) * 100) * 10) / 10
        : null,
      memBytes: Math.round(s.memBytes),
      memLimitBytes: Math.round(s.memLimitBytes),
      memPct: s.memLimitBytes > 0
        ? Math.round(((s.memBytes / s.memLimitBytes) * 100) * 10) / 10
        : null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        service,
        runway: detail.runway,
        subsystems,
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
