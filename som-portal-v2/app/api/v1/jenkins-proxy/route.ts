// som-portal-v2/app/api/v1/jenkins-proxy/route.ts
//
// Port of api/jenkins-proxy/index.php.
//
//   GET  ?list=1                        → enabled servers (id/display/base_url/job_rules)
//   GET  ?server=X&path=/…/api/json     → proxy a read, creds injected server-side
//   POST ?action=build  { server, path, params? }  → trigger a build
//
// Gates: authenticated + the caller's team must hold the `jenkins` feature
// (teams.json). Server ids resolve against the CALLER'S TEAM file only, so a
// team can never proxy through another team's credentials.
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { requireTeamFeature } from '@/team/features';
import { logActivity } from '@/logging/activity';
import { jenkinsServers, toListItems, proxyRead, triggerBuild } from '@/jenkins/client';
import { handle, jsonErr, jsonOk } from '@/jenkins/route-helpers';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Feature key gating every Jenkins surface in v1 (layout.js `feature: 'jenkins'`). */
const JENKINS_FEATURE = 'jenkins';

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const sess = await requireAuth();
    await requireTeamFeature(sess, JENKINS_FEATURE);

    const q = new URL(req.url).searchParams;
    const servers = await jenkinsServers();

    if (q.has('list')) return jsonOk(toListItems(servers));

    const serverId = (q.get('server') ?? '').trim();
    const server = serverId ? servers[serverId] : undefined;
    if (!server) return jsonErr('Unknown server', 404);

    const depthRaw = q.get('depth');
    const res = await proxyRead(server, q.get('path') ?? '/api/json', {
      tree: q.get('tree') ?? undefined,
      depth: depthRaw ? Number(depthRaw) : undefined,
    });
    if ('error' in res) return jsonErr(res.error, res.status);
    return jsonOk(res.data);
  });
}

const BuildSchema = z.object({
  // `server`/`path` are v1's names; `serverId`/`jobPath` are the brief's. Accept both.
  server: z.string().trim().optional(),
  serverId: z.string().trim().optional(),
  path: z.string().trim().optional(),
  jobPath: z.string().trim().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullish(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const sess = await requireAuth();
    await requireTeamFeature(sess, JENKINS_FEATURE);

    const action = (new URL(req.url).searchParams.get('action') ?? '').trim();
    if (action !== 'build') return jsonErr('Unknown POST action', 400);

    const body = BuildSchema.parse(await req.json());
    const serverId = body.server ?? body.serverId ?? '';
    const jobPath = body.path ?? body.jobPath ?? '';

    const servers = await jenkinsServers();
    const server = serverId ? servers[serverId] : undefined;
    if (!server) return jsonErr('Unknown server', 404);

    const params = body.params
      ? Object.fromEntries(Object.entries(body.params).map(([k, v]) => [k, String(v)]))
      : null;

    const res = await triggerBuild(server, jobPath, params);
    if ('error' in res) return jsonErr(res.error, res.status);

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'jenkins_build_trigger',
      meta: { server: serverId, job: jobPath, queue_id: res.queue_id },
    });
    return jsonOk(res);
  });
}
