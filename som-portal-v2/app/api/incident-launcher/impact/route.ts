// GET: impact analysis (SM team only) — delegates to impact analyzer
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { ForbiddenError } from "@/lib/errors";
import { ok, err } from "@/lib/result";
import { emptyImpactResult } from "@/incident-launcher/impact-analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const sess = await requireAuth();
    if (sess.team !== "sm") throw new ForbiddenError("SM team only");

    const q = new URL(req.url).searchParams;
    const from = q.get("from") ?? "";
    const to = q.get("to") ?? "";
    if (!from) {
      return NextResponse.json(err("from required (ISO datetime)"), { status: 400 });
    }

    // During dual-run, the full Prometheus query logic stays in v1.
    // Return a placeholder that the frontend can use or proxy to v1.
    const result = emptyImpactResult(from, to || new Date().toISOString());
    return NextResponse.json(ok(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(msg), { status });
  }
}
