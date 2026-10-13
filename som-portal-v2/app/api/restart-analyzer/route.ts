// app/api/restart-analyzer/route.ts
// GET ?service=X&range=1h|6h|24h|7d: service-level restart analysis
// Matches v1 api/restart-analyzer/index.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ALL_STAFF_ROLES } from '@/auth/policy';
import { analyzeService } from '@/restart-analyzer/analyzer';
import { readTeamFile } from '@/team/scope';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Grafana sources config — matches v1 grafana_sources.json
const GrafanaSourcesFile = z.object({
  sources: z.array(z.object({
    slug: z.string().optional(),
    grafanaUrl: z.string(),
    dsUid: z.string(),
    orgId: z.union([z.string(), z.number()]),
    tokenEnv: z.string().optional().default(''),
    token: z.string().optional().default(''),
    authMode: z.string().optional().default('token'),
    enabled: z.boolean().optional().default(true),
    jvmDsUid: z.string().optional().default(''),
  })).default([]),
});

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireRole(...ALL_STAFF_ROLES);
    const q = new URL(req.url).searchParams;
    const service = (q.get('service') ?? '').trim();
    const range = (q.get('range') ?? '1h').trim();

    if (!service || !/^[a-z0-9._-]+$/i.test(service)) {
      return NextResponse.json(
        { success: false, message: 'service is required (letters/digits/._-)' },
        { status: 400 },
      );
    }

    if (!['1h', '6h', '24h', '7d'].includes(range)) {
      return NextResponse.json(
        { success: false, message: 'range must be 1h/6h/24h/7d' },
        { status: 400 },
      );
    }

    // Load Grafana source config — pick first enabled with dsUid
    const cfg = await readTeamFile('grafana_sources.json', GrafanaSourcesFile);
    const src = cfg.sources.find((s) => s.enabled && s.dsUid);
    if (!src) {
      return NextResponse.json(
        { success: false, message: 'No enabled Grafana source with dsUid' },
        { status: 500 },
      );
    }

    const token = (src.tokenEnv ? process.env[src.tokenEnv] : src.token) ?? '';
    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Grafana token not configured' },
        { status: 500 },
      );
    }

    const result = await analyzeService(
      {
        grafanaUrl: src.grafanaUrl,
        dsUid: src.dsUid,
        orgId: String(src.orgId),
        token,
        jvmDsUid: src.jvmDsUid,
      },
      service,
      range,
    );

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
