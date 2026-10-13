// POST: execute a Jira workflow transition (SM team only)
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { ForbiddenError } from "@/lib/errors";
import { ok, err } from "@/lib/result";
import { DoTransitionSchema } from "@/incident-launcher/types";
import { doTransition } from "@/incident-launcher/jira-bridge";
import { logActivity } from "@/logging/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const sess = await requireAuth();
    if (sess.team !== "sm") throw new ForbiddenError("SM team only");

    const raw = await req.json();
    const parsed = DoTransitionSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.issues[0]?.message ?? "Validation error"), { status: 400 });
    }

    const { key, transition_id, fields } = parsed.data;
    await doTransition(key, transition_id, fields);

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: "incident_launcher_jira_transition",
      meta: { key, transition: transition_id },
    });

    return NextResponse.json(ok({ key }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(msg), { status });
  }
}
