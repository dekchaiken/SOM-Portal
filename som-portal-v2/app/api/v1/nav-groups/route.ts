// som-portal-v2/app/api/v1/nav-groups/route.ts
//
// v1 source: api/nav-groups/index.php
//   GET    → groups (any auth). Empty file → $defaultGroups with is_default:true
//   PATCH  → replace groups. v1 gate: ['sm_admin','dev_sm','super_admin']
//   DELETE → reset to default (v1 unlinks the team's file)
//
// Team-scoped: data/<team>/nav-groups.json.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireRole, SM_ADMIN, DEV_SM, SUPER_ADMIN } from "@/auth/policy";
import { okJson, errorJson, jsonBody } from "@/admin/route-helpers";
import { logActivity } from "@/logging/activity";
import { logSecurity } from "@/logging/security";
import { CORE_MENUS, sanitiseSlug, sanitiseGroupLabel } from "@/config/menu-catalog";
import { readNavGroups, writeNavGroups } from "@/perms/store";
import type { NavGroupsFile } from "@/perms/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** v1 write roles for nav-groups. */
export const NAV_GROUPS_WRITE_ROLES = [SM_ADMIN, DEV_SM, SUPER_ADMIN] as const;

const BodySchema = z.object({
  groups: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        icon: z.string().optional(),
        items: z.array(z.string()),
      }),
    )
    .min(1),
  team: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const team = req.nextUrl.searchParams.get("team") ?? undefined;
    const data = await readNavGroups(team);
    return okJson({ ...data, known_menus: CORE_MENUS, team: team ?? session.team });
  } catch (e) {
    return errorJson(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole(...NAV_GROUPS_WRITE_ROLES);
    const body = BodySchema.parse(await jsonBody(req));

    // v1 sanitiser, byte-for-byte: slugified id/icon, 32-char label, slugified items.
    const groups = body.groups.map((g) => ({
      id: sanitiseSlug(g.id),
      label: sanitiseGroupLabel(g.label),
      icon: sanitiseSlug(g.icon ?? "dashboard"),
      items: g.items.map((i) => sanitiseSlug(i)).filter((i) => i !== ""),
    }));

    const next: NavGroupsFile = {
      groups,
      updated_at: new Date().toISOString(), // v1 writes date('c')
      updated_by: session.username ?? session.sub,
    };

    await writeNavGroups(next, body.team);
    await logActivity({
      user: session.sub,
      team: body.team ?? session.team,
      action: "nav_groups_update",
      meta: { groups_count: groups.length },
    });
    await logSecurity({
      user: session.sub,
      team: body.team ?? session.team,
      event: "nav_groups_update",
      meta: { groups: groups.map((g) => g.id) },
    });
    return okJson(next);
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: NextRequest) {
  // v1 used POST for the save; keep both verbs so either client works.
  return PATCH(req);
}
