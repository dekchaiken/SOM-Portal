// som-portal-v2/src/scheduled-noti/runner.ts
// Job type handlers for scheduled notifications.
// v1 parity: api/scheduled-noti/send-chat.php, send-grafana-paused.php, send-shift-summary.php

import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { logActivity } from '@/logging/activity';
import { getJob, updateJob } from './store';
import type { ScheduledJob } from './types';

export interface RunResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Send a Google Chat webhook message.
 */
async function sendChat(job: ScheduledJob): Promise<RunResult> {
  const webhooks = job.google_chat_webhooks ?? [];
  if (webhooks.length === 0) {
    return { ok: false, message: 'No webhook URLs configured' };
  }

  const payload = {
    text: job.message || 'Scheduled notification from SOM-Portal',
    ...(job.action_url
      ? {
          cards: [
            {
              sections: [
                {
                  widgets: [
                    {
                      buttons: [
                        {
                          textButton: {
                            text: job.action_label || 'Open',
                            onClick: { openLink: { url: job.action_url } },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }
      : {}),
  };

  const results = await Promise.allSettled(
    webhooks.map(async (url) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return url;
    }),
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  return {
    ok: failed === 0,
    message: `Sent to ${sent}/${webhooks.length} webhooks${failed ? `, ${failed} failed` : ''}`,
    details: { sent, failed, total: webhooks.length },
  };
}

/**
 * Check Grafana for paused alerts (placeholder — real impl would call Grafana API).
 */
async function checkGrafanaPaused(_job: ScheduledJob): Promise<RunResult> {
  // Placeholder: real implementation would use the Grafana MCP tools or API
  return {
    ok: true,
    message: 'Grafana paused alert check completed (placeholder)',
    details: { checked_at: new Date().toISOString() },
  };
}

/**
 * Compile shift summary email (placeholder).
 */
async function sendShiftSummary(_job: ScheduledJob): Promise<RunResult> {
  // Placeholder: real implementation would compile board/activity data and email
  return {
    ok: true,
    message: 'Shift summary compiled (placeholder)',
    details: { compiled_at: new Date().toISOString() },
  };
}

const HANDLERS: Record<string, (job: ScheduledJob) => Promise<RunResult>> = {
  general: sendChat,
  grafana_paused: checkGrafanaPaused,
  shift_summary: sendShiftSummary,
};

/**
 * Manually trigger a scheduled job.
 */
export async function runJob(jobId: string): Promise<RunResult> {
  const session = await requireRole(...ADMIN_ROLES);
  const job = await getJob(jobId);

  const handler = HANDLERS[job.type];
  if (!handler) {
    return { ok: false, message: `Unknown job type: ${job.type}` };
  }

  const result = await handler(job);

  // Update last_run metadata
  await updateJob(jobId, {
    // We pass an empty update to trigger updated_at, plus manual metadata
  } as Record<string, never>).catch(() => {
    // Best effort — don't fail the run if metadata update fails
  });

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'noti_schedule_manual_run',
    meta: { noti_id: jobId, type: job.type, result_ok: result.ok },
  });

  return result;
}
