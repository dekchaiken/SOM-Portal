// som-portal-v2/app/(app)/jenkins/page.tsx
// The Jenkins portal: browse servers, folders and jobs, and trigger builds.
// Gated by the `jenkins` team feature, which the Jenkins proxy also enforces.
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { teamFeatures } from "@/team/features";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { PulseHeader } from "@/ui/PulseHeader";
import { JenkinsBuildClient } from "../jenkins-build/JenkinsBuildClient";

export const metadata = { title: "Jenkins · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function JenkinsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/jenkins");
  const granted = await teamFeatures(session.team).catch(() => [] as string[]);

  if (!granted.includes("jenkins")) {
    return (
      <div className="flex flex-col gap-5">
        <PulseHeader title="Jenkins" subtitle="Access" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
            <p className="text-sm font-medium">Your team ({session.team}) does not have access to Jenkins.</p>
            <p className="max-w-md text-xs text-[var(--text-muted)]">Access is granted per team via the jenkins feature.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="Jenkins" subtitle="Browse servers, folders and jobs, and trigger builds" />
      <JenkinsBuildClient />
    </div>
  );
}
