// som-portal-v2/app/api/v1/nav/route.ts
//
// The effective nav for the current session — the v2 equivalent of v1's
// `Layout._getFilteredNavItems()`, except resolved on the SERVER so the client
// never decides its own visibility.
//
// `?locked=1` keeps soft-denied entries flagged `locked: true`, which is how
// the v1 sidebar renders a "No Access" badge instead of hiding the row.

import type { NextRequest } from "next/server";
import { requireAuth } from "@/auth/policy";
import { okJson, errorJson } from "@/admin/route-helpers";
import { buildPermissionContext } from "@/perms/context";
import { getEffectiveNav, explainPage } from "@/config/permissions";
import { visibleNavGroups } from "@/config/permissions";
import { readNavGroups } from "@/perms/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const showLocked = req.nextUrl.searchParams.has("locked");
    const ctx = await buildPermissionContext(session);
    const items = getEffectiveNav(ctx, showLocked);

    // Group ordering/labels come from the team's nav-groups.json (v1 parity).
    const navGroups = await readNavGroups();
    const groups = visibleNavGroups(
      navGroups.groups,
      items.map((i) => i.menuId ?? i.id),
    );

    const probe = req.nextUrl.searchParams.get("explain");
    return okJson({
      role: ctx.role,
      team: ctx.team,
      items: items.map((i) => ({
        id: i.id,
        menuId: i.menuId ?? null,
        path: i.path,
        label: i.label,
        group: i.group,
        locked: i.locked ?? false,
      })),
      groups,
      ...(probe ? { explain: { page: probe, ...explainPage(probe, ctx) } } : {}),
    });
  } catch (e) {
    return errorJson(e);
  }
}
