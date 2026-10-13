// som-portal-v2/app/(admin)/admin/menu-permissions/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { ADMIN_ROLES } from "@/auth/policy";
import { readMenuPermissions } from "@/perms/store";
import { CORE_MENUS, SUB_PAGE_MAP, KNOWN_ROLES } from "@/config/menu-catalog";
import { MenuPermsEditor } from "./_components/MenuPermsEditor";

export const metadata = { title: "Menu Permissions · Admin · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function MenuPermissionsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/menu-permissions");

  const gated = canSeePage("admin-menu-permissions", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!gated || !(ADMIN_ROLES as readonly string[]).includes(session.role)) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Menu permissions require an admin role.
        </p>
      </div>
    );
  }

  const config = await readMenuPermissions();

  return (
    <MenuPermsEditor
      config={config}
      knownMenus={CORE_MENUS}
      knownRoles={KNOWN_ROLES}
      subPages={SUB_PAGE_MAP}
      team={session.team}
      selfRole={session.role}
    />
  );
}
