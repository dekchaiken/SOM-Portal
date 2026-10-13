// GET: peek at BO config value (SM team only)
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { ForbiddenError } from "@/lib/errors";
import { ok, err } from "@/lib/result";
import { boPeek } from "@/incident-launcher/backoffice-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const sess = await requireAuth();
    if (sess.team !== "sm") throw new ForbiddenError("SM team only");

    const q = new URL(req.url).searchParams;
    const application = q.get("application") ?? "";
    const key = q.get("key") ?? "";
    if (!application || !key) {
      return NextResponse.json(err("application and key required"), { status: 400 });
    }

    const property = await boPeek(application, key);
    return NextResponse.json(ok({ property }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(err(msg), { status });
  }
}
