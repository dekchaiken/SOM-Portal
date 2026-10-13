// GET /api/v1/ma-services/jenkins-status — poll single Jenkins build status
// Port of api/ma-services/jenkins-status.php
// Reuses existing src/jenkins/ proxy infrastructure.
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { jenkinsServers, jenkinsRequestFull } from '@/jenkins/client';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    const q = new URL(req.url).searchParams;
    const serverId = (q.get('server') ?? '').trim();
    const queuePath = (q.get('queue') ?? '').trim();
    const jobPath = q.get('job') ?? '';
    let buildNo = q.has('build') ? Number(q.get('build')) : 0;

    const servers = await jenkinsServers();
    if (!serverId || !servers[serverId]) {
      return jsonErr('Unknown server', 404);
    }
    const server = servers[serverId]!;
    const base = (server.base_url ?? '').replace(/\/+$/, '');

    const out: Record<string, unknown> = {
      phase: 'unknown',
      queue: null,
      build: null,
      done: false,
    };

    // Phase 1: queue polling
    if (queuePath && !buildNo) {
      if (!/^\/queue\/item\/\d+\/?$/.test(queuePath)) {
        return jsonErr('Invalid queue path', 400);
      }
      const r = await jenkinsRequestFull(server, `${base}${queuePath.replace(/\/$/, '')}/api/json`);
      if (r.err) return jsonErr(`Jenkins error: ${r.err}`, 502);
      if (r.code === 404) return jsonOk({ ...out, phase: 'done', done: true });
      if (r.code !== 200) return jsonErr(`Jenkins HTTP ${r.code}`, 502);

      const d = JSON.parse(r.body) as Record<string, unknown>;
      if ((d as { cancelled?: boolean }).cancelled) {
        return jsonOk({
          ...out,
          phase: 'done',
          done: true,
          queue: { why: String(d.why ?? ''), cancelled: true },
        });
      }
      const exe = d.executable as Record<string, unknown> | undefined;
      if (exe?.number) {
        buildNo = Number(exe.number);
      } else {
        return jsonOk({
          ...out,
          phase: 'queued',
          queue: { why: String(d.why ?? 'waiting in queue'), cancelled: false },
        });
      }
    }

    // Phase 2: build polling
    if (!jobPath || !buildNo) {
      return jsonErr('Missing job/build after queue resolve', 400);
    }

    const url = `${base}${jobPath}/${buildNo}/api/json`;
    const r = await jenkinsRequestFull(server, url);
    if (r.err) return jsonErr(`Jenkins error: ${r.err}`, 502);
    if (r.code === 404) return jsonErr('Build not found', 404);
    if (r.code !== 200) return jsonErr(`Jenkins HTTP ${r.code}`, 502);

    const d = JSON.parse(r.body) as Record<string, unknown>;
    const building = Boolean(d.building);
    const estimated = Math.max(1, Number(d.estimatedDuration ?? 0));
    const ts = Number(d.timestamp ?? 0);
    const elapsedMs = ts > 0 ? Math.max(0, Date.now() - ts) : 0;
    const percent = building ? Math.min(99, Math.floor((elapsedMs / estimated) * 100)) : 100;

    return jsonOk({
      phase: building ? 'building' : 'done',
      done: !building,
      queue: null,
      build: {
        number: buildNo,
        url: String(d.url ?? ''),
        job_path: jobPath,
        building,
        duration: Number(d.duration ?? 0),
        estimated,
        elapsed: elapsedMs,
        percent,
        result: String(d.result ?? ''),
      },
    });
  });
}
