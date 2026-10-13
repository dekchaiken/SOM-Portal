// som-portal-v2/app/(app)/incident-launcher/page.tsx
// Server component — gates on SM roles, then renders the client wizard.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { SkeletonList } from "@/ui/Skeleton";
import { IncidentLauncherClient } from "./IncidentLauncherClient";

export const metadata = { title: "Incident Launcher - SOM Portal" };
export const dynamic = "force-dynamic";

const SM_ROLES = ["sm_user", "sm_lead", "sm_admin", "super_admin"];

function AccessDenied() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
        <p className="text-sm font-medium">
          Incident Launcher is available to SM team only.
        </p>
        <p className="max-w-md text-xs text-[var(--text-muted)]">
          Roles: sm_user, sm_lead, sm_admin, super_admin
        </p>
      </CardContent>
    </Card>
  );
}

export default async function IncidentLauncherPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/incident-launcher");

  if (!SM_ROLES.includes(session.role)) return <AccessDenied />;

  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <IncidentLauncherClient />
    </Suspense>
  );
}
