// POST: send webhook or channel notification (SM team only)
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { ForbiddenError } from "@/lib/errors";
import { ok, err } from "@/lib/result";
import { NotifyChannelSchema, WebhookSendSchema } from "@/incident-launcher/types";
import { sendWebhook, validateWebhookUrl } from "@/incident-launcher/webhook";
import { getChannelById, sendToChannel } from "@/incident-launcher/channels";
import { logActivity } from "@/logging/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const sess = await requireAuth();
    if (sess.team !== "sm") throw new ForbiddenError("SM team only");

    const raw = await req.json();

    // Detect whether this is a direct webhook or a channel notification
    if (raw.url && raw.text) {
      // Legacy single-webhook proxy
      const parsed = WebhookSendSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(err(parsed.error.issues[0]?.message ?? "Validation error"), { status: 400 });
      }
      if (!validateWebhookUrl(parsed.data.url)) {
        return NextResponse.json(err("URL must be a Google Chat webhook"), { status: 400 });
      }
      await sendWebhook(parsed.data.url, parsed.data.text);

      await logActivity({
        user: sess.sub,
        team: sess.team,
        action: "incident_launcher_webhook",
        meta: { url_prefix: parsed.data.url.slice(0, 60) },
      });

      return NextResponse.json(ok({ ok: true }));
    }

    // Channel notification
    const parsed = NotifyChannelSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.issues[0]?.message ?? "Validation error"), { status: 400 });
    }

    const channel = await getChannelById(parsed.data.channel_id);
    const result = await sendToChannel(channel, parsed.data.message, parsed.data.thread_key || undefined);

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: "incident_launcher_channel_notify",
      meta: { channel: channel.name, platform: channel.platform },
    });

    return NextResponse.json(ok({ ok: true, manual: result.manual }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(msg), { status });
  }
}
