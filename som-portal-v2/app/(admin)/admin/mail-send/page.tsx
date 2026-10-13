// som-portal-v2/app/(admin)/admin/mail-send/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { SendMailClient } from "./_components/SendMailClient";

export const metadata = { title: "Send Email - Admin - SOM Portal" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/mail-send");
  const gated = canSeePage("admin-mail-send", { role: session.role as Role, team: session.team, isGenz: session.is_genz });
  if (!gated) {
    return (
      <div className="glass rounded-[var(--radius-card)] p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">This page requires an admin role.</p>
      </div>
    );
  }
  return <SendMailClient />;
}
