// som-portal-v2/app/(admin)/admin/nav-groups/page.tsx
//
// Server page: resolves session, loads data/<team>/nav-groups.json (or default)
// and the menu catalog, then renders the client editor.
// Role gate: sm_admin, dev_sm, super_admin (v1 `api/nav-groups/index.php` PATCH).

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { SM_ADMIN, DEV_SM, SUPER_ADMIN } from "@/auth/policy";
import { readNavGroups } from "@/perms/store";
import { CORE_MENUS } from "@/config/menu-catalog";
import { NavGroupsEditor } from "./_components/NavGroupsEditor";

export const metadata = { title: "Nav Groups · Admin · SOM Portal" };
export const dynamic = "force-dynamic";

const WRITE_ROLES: readonly string[] = [SM_ADMIN, DEV_SM, SUPER_ADMIN];

export default async function NavGroupsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/nav-groups");

  const gated = canSeePage("admin-nav-groups", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!gated || !WRITE_ROLES.includes(session.role)) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Managing nav groups requires sm_admin, dev_sm, or super_admin.
        </p>
      </div>
    );
  }

  const file = await readNavGroups();

  return (
    <NavGroupsEditor
      initial={file}
      knownMenus={CORE_MENUS}
      team={session.team}
    />
  );
}
