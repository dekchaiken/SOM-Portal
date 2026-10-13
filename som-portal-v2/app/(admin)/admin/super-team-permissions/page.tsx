// som-portal-v2/app/(admin)/admin/super-team-permissions/page.tsx
//
// super_admin ONLY: per-team feature + page-mode matrix.
// Reads teams via `readTeams()`; writes via `PATCH /api/v1/teams/[id]` which
// re-asserts `requireRole(SUPER_ADMIN)` and logs activity/security.

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { SUPER_ADMIN } from "@/auth/policy";
import { readTeams } from "@/perms/store";
import {
  DEFAULT_FEATURES,
  FEATURE_CATALOGUE,
  PAGE_MODES,
} from "@/config/menu-catalog";
import { SuperTeamPermsEditor } from "./_components/SuperTeamPermsEditor";

export const metadata = { title: "Super Team Permissions · Admin · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function SuperTeamPermissionsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/super-team-permissions");

  const gated = canSeePage("admin-super-team-permissions", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!gated || session.role !== SUPER_ADMIN) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Super team permissions require super_admin.
        </p>
      </div>
    );
  }

  const teams = await readTeams();

  return (
    <SuperTeamPermsEditor
      teams={teams}
      defaultFeatures={DEFAULT_FEATURES}
      featureCatalogue={FEATURE_CATALOGUE}
      pageModes={PAGE_MODES}
    />
  );
}
