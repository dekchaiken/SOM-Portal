// POST: update BO config (SM team only) — logActivity + logSecurity
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { ForbiddenError } from "@/lib/errors";
import { ok, err } from "@/lib/result";
import { BoUpdateSchema } from "@/incident-launcher/types";
import { boUpdate } from "@/incident-launcher/backoffice-bridge";
import { logActivity } from "@/logging/activity";
import { logSecurity } from "@/logging/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const sess = await requireAuth();
    if (sess.team !== "sm") throw new ForbiddenError("SM team only");

    const raw = await req.json();
    const parsed = BoUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.issues[0]?.message ?? "Validation error"), { status: 400 });
    }

    const { application, key, value, environment, profile } = parsed.data;
    const updatedBy = sess.username || sess.sub;

    try {
      await boUpdate(application, key, value, environment, profile, updatedBy);
    } catch (e) {
      await logActivity({
        user: sess.sub,
        team: sess.team,
        action: "bo_config_update",
        meta: { application, key, value_length: value.length, result: "error", error: (e as Error).message },
      });
      throw e;
    }

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: "bo_config_update",
      meta: { application, environment, profile, key, value_length: value.length, result: "ok" },
    });

    await logSecurity({
      user: sess.sub,
      team: sess.team,
      event: "bo_config_update",
      meta: { application, key, environment, profile },
    });

    return NextResponse.json(ok({ updated: true, application, key, new_value: value }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(msg), { status });
  }
}
