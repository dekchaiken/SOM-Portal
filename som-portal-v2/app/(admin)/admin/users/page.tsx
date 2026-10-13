// som-portal-v2/app/(admin)/admin/users/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { listUsers, type ListUsersResult } from "@/admin/users-service";
import { UsersClient } from "./_components/UsersClient";
import type { SafeUser } from "@/admin/users-schema";

export const metadata = { title: "Users · Admin · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/users");

  // Role gate + nav feature gate — never bypass either.
  const allowed = canSeePage("admin-users", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!allowed) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          User management requires an admin role.
        </p>
      </div>
    );
  }

  let initial: ListUsersResult;
  try {
    initial = await listUsers(session);
  } catch {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Forbidden</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your role cannot manage users.
        </p>
      </div>
    );
  }

  return (
    <UsersClient
      initialUsers={initial.users as SafeUser[]}
      teams={initial.teams}
      initialTeam={initial.team}
      assignableRoles={initial.assignable_roles}
      isSuperAdmin={session.role === "super_admin"}
      sessionUserId={session.sub}
      sessionTeam={session.team}
    />
  );
}
