// app/api/restart-analyzer/pod-detail/route.ts
// GET ?pod=X&namespace=Y&restartedAt=Z&window=600: per-pod deep dive
// Matches v1 api/restart-analyzer/pod-detail.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ALL_STAFF_ROLES } from '@/auth/policy';
import { getPodDetail } from '@/restart-analyzer/pod-detail';
import { readTeamFile } from '@/team/scope';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GrafanaSourcesFile = z.object({
  sources: z.array(z.object({
    grafanaUrl: z.string(),
    dsUid: z.string(),
    orgId: z.union([z.string(), z.number()]),
    tokenEnv: z.string().optional().default(''),
    token: z.string().optional().default(''),
    enabled: z.boolean().optional().default(true),
  })).default([]),
});

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireRole(...ALL_STAFF_ROLES);
    const q = new URL(req.url).searchParams;
    const pod = (q.get('pod') ?? '').trim();
    const namespace = (q.get('namespace') ?? '').trim();
    const restartedAt = parseInt(q.get('restartedAt') ?? '0');
    const window = Math.max(120, Math.min(1800, parseInt(q.get('window') ?? '600')));

    if (!pod || !/^[a-z0-9._-]+$/i.test(pod)) {
      return NextResponse.json(
        { success: false, message: 'pod required' },
        { status: 400 },
      );
    }
    if (restartedAt < 1000000000) {
      return NextResponse.json(
        { success: false, message: 'restartedAt (unix seconds) required' },
        { status: 400 },
      );
    }

    const cfg = await readTeamFile('grafana_sources.json', GrafanaSourcesFile);
    const src = cfg.sources.find((s) => s.enabled && s.dsUid);
    if (!src) {
      return NextResponse.json(
        { success: false, message: 'No enabled Grafana source' },
        { status: 500 },
      );
    }

    const token = (src.tokenEnv ? process.env[src.tokenEnv] : src.token) ?? '';
    const result = await getPodDetail(
      { grafanaUrl: src.grafanaUrl, dsUid: src.dsUid, orgId: String(src.orgId), token },
      pod,
      namespace,
      restartedAt,
      window,
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
