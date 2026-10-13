// som-portal-v2/app/api/v1/teams/[id]/route.ts
//
// v1 source: api/teams/index.php PATCH — super_admin ONLY.
// This is the critical boundary of the A5 module: it decides which TEAM gets
// which tool. `writeTeams()` re-checks the role, so the gate holds even if this
// handler is ever called from elsewhere.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole, SUPER_ADMIN_ONLY } from "@/auth/policy";
import { okJson, errorJson, jsonBody } from "@/admin/route-helpers";
import { NotFoundError } from "@/lib/errors";
import { logActivity } from "@/logging/activity";
import { logSecurity } from "@/logging/security";
import { readTeams, writeTeams } from "@/perms/store";
import { DEFAULT_FEATURES } from "@/config/menu-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  active: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  feature_pages: z
    .record(
      z.string(),
      z.object({
        user_pages: z.array(z.string()).optional(),
        admin_pages: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  page_modes: z.record(z.string(), z.string()).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole(...SUPER_ADMIN_ONLY);
    const { id } = await params;
    const body = PatchSchema.parse(await jsonBody(req));

    const teams = await readTeams();
    const idx = teams.findIndex((t) => t.id === id);
    if (idx === -1) throw new NotFoundError("Team not found");

    const prev = teams[idx]!;
    const next = { ...prev };
    if (body.name !== undefined) next.name = body.name.trim();
    if (body.description !== undefined) next.description = body.description.trim();
    if (body.color !== undefined) next.color = body.color;
    if (body.active !== undefined) next.active = body.active;

    if (body.features !== undefined) {
      // v1 never lets DEFAULT_FEATURES be revoked — they are always-on.
      next.features = [...new Set([...DEFAULT_FEATURES, ...body.features])];
    }
    // PHP serialises an empty map as [], so keep {} to stay readable by v1's JS.
    if (body.feature_pages !== undefined) next.feature_pages = body.feature_pages;
    if (body.page_modes !== undefined) next.page_modes = body.page_modes;

    teams[idx] = next;
    await writeTeams(teams); // re-asserts super_admin

    const added = (next.features ?? []).filter((f) => !(prev.features ?? []).includes(f));
    const removed = (prev.features ?? []).filter((f) => !(next.features ?? []).includes(f));

    await logActivity({
      user: session.sub,
      team: session.team,
      action: "team_permissions_updated",
      meta: { team_id: id, slug: next.slug, fields: Object.keys(body) },
    });
    await logSecurity({
      user: session.sub,
      team: session.team,
      event: "team_permissions_updated",
      meta: { team_id: id, slug: next.slug, features_added: added, features_removed: removed },
    });
    return okJson({ team: next, features_added: added, features_removed: removed });
  } catch (e) {
    return errorJson(e);
  }
}
