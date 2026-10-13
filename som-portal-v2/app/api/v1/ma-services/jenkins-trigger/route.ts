// POST /api/v1/ma-services/jenkins-trigger — trigger Jenkins build for an MA service
// Port of api/ma-services/jenkins-trigger.php
import { requireAuth, assertSmForShared } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { jenkinsServers, triggerBuild, isValidJobPath } from '@/jenkins/client';
import { JenkinsTriggerInput } from '@/ma/types';
import { getService, patchServiceRecord } from '@/ma/services-store';
import { logActivity } from '@/logging/activity';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { MAToggleRLSchema } from '@/ma/types';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RL_FILE = 'ma-jenkins-rl.json';

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    assertSmForShared(session);
    const body = await req.json();
    const parsed = JenkinsTriggerInput.safeParse(body);
    if (!parsed.success) {
      return jsonErr(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    }
    const input = parsed.data;

    // Anti-double-click: 3-second per user
    const now = Math.floor(Date.now() / 1000);
    const rl = await readTeamFile(RL_FILE, MAToggleRLSchema);
    if (rl[session.sub] && now - rl[session.sub]! < 3) {
      return jsonErr('Too fast -- wait a moment', 429);
    }
    rl[session.sub] = now;
    for (const [k, ts] of Object.entries(rl)) {
      if (now - ts > 3600) delete rl[k];
    }
    await writeTeamFile(RL_FILE, rl, MAToggleRLSchema);

    const svc = await getService(input.service_id);
    if (svc.tool_type !== 'Jenkins') {
      return jsonErr('Service tool_type is not Jenkins', 400);
    }

    const serverId = svc.jenkins_server_id.trim();
    const jobPath = '/' + svc.jenkins_job_path.trim().replace(/^\/+/, '');
    if (!serverId) return jsonErr('jenkins_server_id not set on this service', 400);
    if (!isValidJobPath(jobPath)) return jsonErr('Invalid jenkins_job_path', 400);

    const servers = await jenkinsServers();
    if (!servers[serverId]) return jsonErr('Unknown jenkins_server_id', 404);
    const server = servers[serverId]!;

    const params = Object.keys(input.params).length > 0 ? input.params : null;
    const result = await triggerBuild(server, jobPath, params);

    const activityMeta = {
      service_id: input.service_id,
      service_name: svc.service_name,
      server: serverId,
      job_path: jobPath,
      params: input.params,
      result: 'error' in result ? 'error' : 'ok',
    };

    if ('error' in result) {
      await logActivity({
        user: session.sub,
        team: session.team,
        action: 'ma_jenkins_trigger',
        meta: { ...activityMeta, error: result.error },
      });
      return jsonErr(result.error, result.status);
    }

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'ma_jenkins_trigger',
      meta: { ...activityMeta, queue: result.queue_url },
    });

    // Persist last-triggered stamp
    await patchServiceRecord(input.service_id, {
      last_jenkins_by: session.sub,
      last_jenkins_by_name: session.username ?? session.sub,
      last_jenkins_at: now,
      last_jenkins_params: input.params,
    });

    // Extract queue path from full URL
    const queuePath = result.queue_url
      ? result.queue_url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '')
      : '';

    return jsonOk({
      queue_path: queuePath,
      server: serverId,
      job_path: jobPath,
    });
  });
}
