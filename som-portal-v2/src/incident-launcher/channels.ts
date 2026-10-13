// som-portal-v2/src/incident-launcher/channels.ts
// Send to configured notification channels from incident-launcher-config.json.

import { AppError } from "@/lib/errors";
import { getIncidentConfig } from "./config-store";
import type { Channel } from "./types";

/** Look up a channel by id from the config. */
export async function getChannelById(channelId: string): Promise<Channel> {
  const cfg = await getIncidentConfig();
  const ch = cfg.channels.find((c) => c.id === channelId);
  if (!ch) throw new AppError("Channel not found", "channel_not_found", 404);
  return ch;
}

/** Send a notification to a specific channel. Returns true if sent, false if manual-only. */
export async function sendToChannel(
  channel: Channel,
  message: string,
  threadKey?: string,
): Promise<{ sent: boolean; manual: boolean }> {
  if (channel.platform === "manual") {
    return { sent: false, manual: true };
  }
  if (!channel.auth) {
    throw new AppError("No webhook / token configured for this channel", "channel_no_auth", 400);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8_000);
  try {
    switch (channel.platform) {
      case "googlechat": {
        let url = channel.auth;
        const body: Record<string, unknown> = { text: message };
        if (threadKey) {
          const sep = url.includes("?") ? "&" : "?";
          url += `${sep}messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;
          body.thread = { threadKey };
        }
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        if (!res.ok) {
          throw new AppError(`Google Chat HTTP ${res.status}`, "channel_send_error", 502);
        }
        break;
      }
      case "dingtalk": {
        const res = await fetch(channel.auth, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msgtype: "text", text: { content: message } }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          throw new AppError(`DingTalk HTTP ${res.status}`, "channel_send_error", 502);
        }
        break;
      }
      case "line": {
        const res = await fetch("https://notify-api.line.me/api/notify", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Bearer ${channel.auth}`,
          },
          body: new URLSearchParams({ message: `\n${message}` }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          throw new AppError(`LINE HTTP ${res.status}`, "channel_send_error", 502);
        }
        break;
      }
      default:
        throw new AppError(`Unknown platform: ${channel.platform}`, "unknown_platform", 400);
    }
    return { sent: true, manual: false };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(`Channel send failed: ${(e as Error).message}`, "channel_unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
}
