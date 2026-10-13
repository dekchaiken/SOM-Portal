// som-portal-v2/src/incident-launcher/webhook.ts
// Google Chat webhook sender. URL must start with https://chat.googleapis.com/.

import { AppError } from "@/lib/errors";

const GOOGLE_CHAT_PREFIX = "https://chat.googleapis.com/";

export function validateWebhookUrl(url: string): boolean {
  return url.startsWith(GOOGLE_CHAT_PREFIX);
}

/** Send a message to a Google Chat webhook. */
export async function sendWebhook(url: string, text: string): Promise<void> {
  if (!validateWebhookUrl(url)) {
    throw new AppError("URL must be a Google Chat webhook", "invalid_webhook_url", 400);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AppError(`Webhook HTTP ${res.status}: ${body.slice(0, 200)}`, "webhook_error", 502);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(`Webhook failed: ${(e as Error).message}`, "webhook_unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Substitute template variables in a message string. */
export function substituteTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value);
  }
  return result;
}
