// som-portal-v2/app/(admin)/admin/system-settings/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import {
  getSettings,
  ADMIN_ROLES,
  SUPER_ADMIN_ONLY_KEYS,
  INT_KEYS,
} from "@/admin/system-settings-service";
import { SettingsClient } from "./_components/SettingsClient";

export const metadata = { title: "System Settings · Admin · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/system-settings");

  const gated = canSeePage("admin-system-settings", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!gated || !(ADMIN_ROLES as readonly string[]).includes(session.role)) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          System settings require an admin role.
        </p>
      </div>
    );
  }

  const settings = await getSettings();
  const isSuper = session.role === "super_admin";

  return (
    <SettingsClient
      initial={settings as unknown as Record<string, unknown>}
      lockedKeys={isSuper ? [] : [...SUPER_ADMIN_ONLY_KEYS]}
      ranges={INT_KEYS as unknown as Record<string, [number, number]>}
      isSuperAdmin={isSuper}
    />
  );
}
