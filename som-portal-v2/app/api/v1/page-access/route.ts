// som-portal-v2/app/api/v1/page-access/route.ts
//
// Server-side probe of the effective gate: `GET /api/v1/page-access?page=<id>`
// → 200 when the session may open that page, 403 (with the deny reason) when it
// may not. Same code path as the page guards, so it is a faithful proof that
// the gate is enforced on the server and not merely hidden in the nav.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/auth/policy";
import { errorJson } from "@/admin/route-helpers";
import { err, ok } from "@/lib/result";
import { logSecurity } from "@/logging/security";
import { buildPermissionContext } from "@/perms/context";
import { explainPage, getPageMode } from "@/config/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const page = req.nextUrl.searchParams.get("page");
    if (!page) {
      return NextResponse.json(err("page query param required", "bad_request"), { status: 400 });
    }
    const ctx = await buildPermissionContext(session);
    const decision = explainPage(page, ctx);
    if (!decision.allowed) {
      await logSecurity({
        user: session.sub,
        team: session.team,
        event: "page_access_denied",
        meta: { page, role: session.role, reason: decision.reason ?? "unknown" },
      });
      return NextResponse.json(
        err(`Denied: ${decision.reason ?? "unknown"}`, decision.reason ?? "forbidden"),
        { status: 403 },
      );
    }
    return NextResponse.json(
      ok({ page, allowed: true, mode: getPageMode(page, ctx), role: ctx.role, team: ctx.team }),
    );
  } catch (e) {
    return errorJson(e);
  }
}
