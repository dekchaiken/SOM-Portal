// src/restart-monitor/webhooks.ts
// Read webhook config and send Google Chat notifications on restart spikes.
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { WebhookConfig, type RawReport } from './types';

export async function readWebhooks(): Promise<WebhookConfig> {
  return readTeamFile('restart-monitor-webhooks.json', WebhookConfig);
}

export async function writeWebhooks(config: WebhookConfig): Promise<void> {
  await writeTeamFile('restart-monitor-webhooks.json', config, WebhookConfig);
}

/**
 * Send a Google Chat webhook notification for a restart spike.
 */
export async function sendRestartWebhook(
  webhookUrl: string,
  report: RawReport,
): Promise<{ sent: boolean; error?: string }> {
  if (!webhookUrl) return { sent: false, error: 'no webhook URL' };

  const oomCount = report.reasonSummary['OOMKilled'] ?? 0;
  const critCount = report.severitySummary.critical;
  const topPods = report.pods
    .slice(0, 5)
    .map((p) => `- ${p.pod}: ${p.restartCount}x (${p.terminationReason ?? 'unknown'})`)
    .join('\n');

  const text = [
    `*Restart Monitor - ${report.runway}*`,
    `Date: ${report.date}`,
    `Total restarts: *${report.totalRestarts}* across *${report.totalPods}* pods`,
    critCount > 0 ? `Critical: ${critCount}` : '',
    oomCount > 0 ? `OOMKilled: ${oomCount}` : '',
    '',
    'Top restarting pods:',
    topPods,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { sent: false, error: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}
