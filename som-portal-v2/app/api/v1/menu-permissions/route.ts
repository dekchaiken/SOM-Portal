// som-portal-v2/app/api/v1/menu-permissions/route.ts
//
// v1 source: api/menu-permissions/index.php
//   GET            → raw config + known_menus + known_roles + sub_pages (ADMIN_ROLES)
//   GET ?resolve=1 → the CURRENT USER's resolved menu list (any role)
//   PATCH / PUT    → replace the config (ADMIN_ROLES)
//
// The file is team-scoped: data/<team>/menu-permissions.json.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireRole, ADMIN_ROLES } from "@/auth/policy";
import { okJson, errorJson, jsonBody } from "@/admin/route-helpers";
import { AppError } from "@/lib/errors";
import { logActivity } from "@/logging/activity";
import { logSecurity } from "@/logging/security";
import { CORE_MENUS, SUB_PAGE_MAP, KNOWN_ROLES, DEFAULT_ALWAYS_VISIBLE } from "@/config/menu-catalog";
import {
  resolveUserMenus,
  wouldLockOutSelf,
  type MenuPermissionsConfig,
} from "@/config/permissions";
import { readMenuPermissions, writeMenuPermissions } from "@/perms/store";
import { readPermUser } from "@/perms/store";
import type { MenuPermissionsFile } from "@/perms/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mirrors the v1 sanitiser: each role value is `"*"` or a string array. */
const PatchSchema = z.object({
  roles: z.record(z.string(), z.union([z.literal("*"), z.boolean(), z.array(z.string())])),
  always_visible: z.array(z.string()).optional(),
  /** super_admin may target another team's file; everyone else edits their own. */
  team: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();

    // ── ?resolve=1 — any role, no escalation (v1 parity) ──────────────────
    if (req.nextUrl.searchParams.has("resolve")) {
      const cfg = await readMenuPermissions();
      const user = await readPermUser(session.sub);
      const r = resolveUserMenus(
        cfg as MenuPermissionsConfig,
        session.role,
        CORE_MENUS,
        user?.menu_permissions ?? null,
      );
      return okJson({
        allowed: r.allowed,
        mode: r.mode,
        role: session.role,
        team: session.team,
        known_menus: CORE_MENUS,
        sub_pages: SUB_PAGE_MAP,
      });
    }

    // ── Everything below is admin-only ───────────────────────────────────
    await requireRole(...ADMIN_ROLES);
    const team = req.nextUrl.searchParams.get("team") ?? undefined;
    const cfg = await readMenuPermissions(team);
    return okJson({
      config: cfg,
      known_menus: CORE_MENUS,
      known_roles: KNOWN_ROLES,
      sub_pages: SUB_PAGE_MAP,
      team: team ?? session.team,
    });
  } catch (e) {
    return errorJson(e);
  }
}

async function save(req: NextRequest) {
  const session = await requireRole(...ADMIN_ROLES);
  const body = PatchSchema.parse(await jsonBody(req));

  // v1 sanitise loop: '*' | true → '*', array → unique strings, else [].
  const roles: Record<string, "*" | string[]> = {};
  for (const [role, val] of Object.entries(body.roles)) {
    if (val === "*" || val === true) roles[role] = "*";
    else if (Array.isArray(val)) roles[role] = [...new Set(val.map(String))];
    else roles[role] = [];
  }

  const next: MenuPermissionsFile = {
    version: 1,
    roles,
    always_visible: body.always_visible ?? [...DEFAULT_ALWAYS_VISIBLE],
    updated_at: Math.floor(Date.now() / 1000), // v1 writes time() in seconds
  };

  // Lock-out guard: never let an admin strip their own role's access to the
  // admin surfaces they need to undo the change.
  const missing = wouldLockOutSelf(next as MenuPermissionsConfig, session.role, ["admin"]);
  if (missing.length > 0) {
    await logSecurity({
      user: session.sub,
      team: session.team,
      event: "menu_permissions_lockout_blocked",
      meta: { role: session.role, missing },
    });
    throw new AppError(
      `Refusing to save: this would remove your own access to ${missing.join(", ")}`,
      "self_lockout",
      400,
    );
  }

  await writeMenuPermissions(next, body.team);
  await logActivity({
    user: session.sub,
    team: body.team ?? session.team,
    action: "menu_permissions_update",
    meta: { roles: Object.keys(roles) },
  });
  await logSecurity({
    user: session.sub,
    team: body.team ?? session.team,
    event: "menu_permissions_update",
    meta: { roles: Object.keys(roles) },
  });
  return okJson(next);
}

export async function PATCH(req: NextRequest) {
  try {
    return await save(req);
  } catch (e) {
    return errorJson(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    return await save(req);
  } catch (e) {
    return errorJson(e);
  }
}
