// som-portal-v2/app/(admin)/admin/auth-access/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { getPublicAuthConfig } from "@/auth/auth-config";
import { readUsers } from "@/account/users-store";
import { toAccessUserView } from "@/auth/user-admin";
import { AuthAccessClient } from "./_components/AuthAccessClient";

export const metadata = { title: "Login Access · Admin · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function AuthAccessPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/auth-access");
  if (session.role !== "super_admin") {
    return (
      <div className="glass-card rounded-[var(--radius-lg)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Login access is managed by the superadmin only.</p>
      </div>
    );
  }

  const [config, users] = await Promise.all([getPublicAuthConfig(), readUsers()]);
  const rows = users.map(toAccessUserView).sort((a, b) => a.team.localeCompare(b.team) || a.username.localeCompare(b.username));
  return <AuthAccessClient initialConfig={config} initialUsers={rows} />;
}
