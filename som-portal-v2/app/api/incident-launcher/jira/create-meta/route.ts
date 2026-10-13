// GET: createmeta for Incident issue type (SM team only)
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { ForbiddenError } from "@/lib/errors";
import { ok, err } from "@/lib/result";
import { getCreateMeta } from "@/incident-launcher/jira-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const sess = await requireAuth();
    if (sess.team !== "sm") throw new ForbiddenError("SM team only");

    const q = new URL(req.url).searchParams;
    const project = q.get("project") ?? "SMC";
    const issueType = q.get("issuetype") ?? "Incident";

    const fields = await getCreateMeta(project, issueType);
    return NextResponse.json(ok({ fields }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(msg), { status });
  }
}
