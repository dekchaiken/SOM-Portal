// som-portal-v2/app/(app)/jenkins-build/page.tsx
//
// Server component. Gates on nav/role via canSeePage('jenkins-build') then
// renders the existing client. The client fetches its own servers through
// /api/v1/jenkins-servers (team-scoped), so no props are needed.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { SkeletonList } from "@/ui/Skeleton";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { JenkinsBuildClient } from "./JenkinsBuildClient";

export const metadata = { title: "Jenkins Build · SOM Portal" };
export const dynamic = "force-dynamic";

function AccessDenied({ team }: { team: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
        <p className="text-sm font-medium">
          Your team ({team}) does not have access to Jenkins Build.
        </p>
        <p className="max-w-md text-xs text-[var(--text-muted)]">
          Access is granted per team via the <code>jenkins-build</code> feature.
        </p>
      </CardContent>
    </Card>
  );
}

export default async function JenkinsBuildPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/jenkins-build");

  const allowed = canSeePage("jenkins-build", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!allowed) return <AccessDenied team={session.team} />;

  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <JenkinsBuildClient />
    </Suspense>
  );
}
