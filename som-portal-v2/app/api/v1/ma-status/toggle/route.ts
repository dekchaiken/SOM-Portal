// POST /api/v1/ma-status/toggle — toggle MA enable/disable via backoffice
// Port of api/ma-services/backoffice-toggle.php
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { ToggleMAInput } from '@/ma/types';
import { getService, patchServiceRecord } from '@/ma/services-store';
import { toggleUseCase } from '@/ma/backoffice-client';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { MAToggleRLSchema } from '@/ma/types';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RL_FILE = 'ma-toggle-rl.json';
const RL_WINDOW_SEC = 3;

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();

    const body = await req.json();
    const parsed = ToggleMAInput.safeParse(body);
    if (!parsed.success) {
      return jsonErr(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    }
    const input = parsed.data;

    // Rate limit: 3-second anti-double-click per user (v1 parity)
    const now = Math.floor(Date.now() / 1000);
    const rl = await readTeamFile(RL_FILE, MAToggleRLSchema);
    if (rl[session.sub] && now - rl[session.sub]! < RL_WINDOW_SEC) {
      return jsonErr('Too fast -- wait a moment before toggling again', 429);
    }
    rl[session.sub] = now;
    // GC entries older than 1h
    for (const [k, ts] of Object.entries(rl)) {
      if (now - ts > 3600) delete rl[k];
    }
    await writeTeamFile(RL_FILE, rl, MAToggleRLSchema);

    // Find the service
    const svc = await getService(input.id);
    let useCaseId = svc.backoffice_use_case_id ?? 0;
    if (useCaseId <= 0 && input.use_case_id && input.use_case_id > 0) {
      useCaseId = input.use_case_id;
    }
    if (useCaseId <= 0) {
      return jsonErr('Service is not linked to an Admin Portal use_case_id', 400);
    }

    const enable = input.action === 'enable';
    const updatedBy = session.username ?? session.sub;
    const res = await toggleUseCase(useCaseId, enable, updatedBy);

    const activityMeta = {
      service_id: input.id,
      service_name: svc.service_name,
      use_case_id: useCaseId,
      action: input.action,
      reason: input.reason,
      result: res.ok ? 'ok' : 'error',
      upstream_code: res.code,
      upstream_error: res.error,
    };

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'ma_backoffice_toggle',
      meta: activityMeta,
    });

    if (!res.ok) {
      await logSecurity({
        user: session.sub,
        team: session.team,
        event: 'ma_backoffice_toggle_failed',
        meta: activityMeta,
      });
      return jsonErr(`Admin Portal error: ${res.error ?? 'unknown'}`, 502);
    }

    // Persist toggle stamp on the local record
    await patchServiceRecord(input.id, {
      backoffice_use_case_id: useCaseId > 0 ? useCaseId : svc.backoffice_use_case_id,
      last_toggled_action: input.action,
      last_toggled_by: session.sub,
      last_toggled_by_name: session.username ?? session.sub,
      last_toggled_reason: input.reason,
      last_toggled_at: now,
    });

    return jsonOk({
      service_id: input.id,
      use_case_id: useCaseId,
      action: input.action,
      ma_enable: enable,
      last_toggled: {
        by: session.username ?? session.sub,
        at: now,
        reason: input.reason,
      },
    });
  });
}
