// som-portal-v2/app/api/v1/feature-flags/route.ts
//
// Per-team resolved feature list for the current session (brief: A5 APIs).
// Sources: teams.json features[] + feature_pages{} + page_modes{}, plus the
// always-on DEFAULT_FEATURES from helpers.php defaultFeatures().
//
// `features = null` means "global reader with no view-as team" — v1's
// Auth.getTeamFeatures() returns null there and the feature gate is skipped.

import type { NextRequest } from "next/server";
import { requireAuth } from "@/auth/policy";
import { okJson, errorJson } from "@/admin/route-helpers";
import { buildPermissionContext } from "@/perms/context";
import { DEFAULT_FEATURES, FEATURE_CATALOGUE } from "@/config/menu-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const viewAs = req.nextUrl.searchParams.get("team");
    const ctx = await buildPermissionContext(session, viewAs);

    const granted = ctx.teamFeatures;
    const resolved =
      granted === null ? null : [...new Set([...DEFAULT_FEATURES, ...granted])].sort();

    const flags: Record<string, boolean> = {};
    for (const key of Object.keys(FEATURE_CATALOGUE)) {
      flags[key] = resolved === null ? true : resolved.includes(key);
    }

    return okJson({
      team: ctx.team,
      role: ctx.role,
      features: resolved,
      flags,
      feature_pages: ctx.teamFeaturePages,
      page_modes: ctx.pageModes,
      default_features: DEFAULT_FEATURES,
    });
  } catch (e) {
    return errorJson(e);
  }
}
