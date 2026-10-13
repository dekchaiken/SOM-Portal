// som-portal-v2/app/(admin)/admin/mail-config/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { MailConfigClient } from "./_components/MailConfigClient";

export const metadata = { title: "Mail Config - Admin - SOM Portal" };
export const dynamic = "force-dynamic";

export default async function MailConfigPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/mail-config");

  const gated = canSeePage("admin-mail-config", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!gated) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Mail configuration requires an admin role.
        </p>
      </div>
    );
  }

  return <MailConfigClient />;
}
