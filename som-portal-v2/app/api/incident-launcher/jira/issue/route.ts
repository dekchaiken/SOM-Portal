// GET ?key=X: fetch Jira issue info (SM team only)
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { ForbiddenError } from "@/lib/errors";
import { ok, err } from "@/lib/result";
import { JiraKeySchema } from "@/incident-launcher/types";
import { getIssue } from "@/incident-launcher/jira-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const sess = await requireAuth();
    if (sess.team !== "sm") throw new ForbiddenError("SM team only");

    const key = new URL(req.url).searchParams.get("key") ?? "";
    const parsed = JiraKeySchema.safeParse(key);
    if (!parsed.success) {
      return NextResponse.json(err("Invalid Jira key"), { status: 400 });
    }

    const issue = await getIssue(parsed.data);
    return NextResponse.json(ok({ issue }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(msg), { status });
  }
}
