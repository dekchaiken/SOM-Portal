// som-portal-v2/app/(admin)/admin/mail-logs/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { MailLogsClient } from "./_components/MailLogsClient";

export const metadata = { title: "Mail Logs - Admin - SOM Portal" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/mail-logs");
  const gated = canSeePage("admin-mail-logs", { role: session.role as Role, team: session.team, isGenz: session.is_genz });
  if (!gated) {
    return (
      <div className="glass rounded-[var(--radius-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">This page requires an admin role.</p>
      </div>
    );
  }
  return <MailLogsClient />;
}
