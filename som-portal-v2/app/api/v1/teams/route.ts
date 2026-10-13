// som-portal-v2/app/api/v1/teams/route.ts
//
// v1 source: api/teams/index.php GET.
// Global-read roles (super_admin / super_viewer) see every team — they need the
// full list for the view-as switcher. Everyone else sees only their own team.

import { requireAuth, GLOBAL_READ_ROLES } from "@/auth/policy";
import { okJson, errorJson } from "@/admin/route-helpers";
import { readTeams } from "@/perms/store";
import { FEATURE_CATALOGUE, DEFAULT_FEATURES, PAGE_MODES } from "@/config/menu-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuth();
    const all = await readTeams();
    const globalRead: readonly string[] = GLOBAL_READ_ROLES;
    const teams = globalRead.includes(session.role)
      ? all
      : all.filter((t) => t.slug === session.team);
    return okJson({
      teams,
      // The admin matrix needs the vocabulary alongside the rows.
      default_features: DEFAULT_FEATURES,
      feature_catalogue: FEATURE_CATALOGUE,
      page_modes: PAGE_MODES,
    });
  } catch (e) {
    return errorJson(e);
  }
}
