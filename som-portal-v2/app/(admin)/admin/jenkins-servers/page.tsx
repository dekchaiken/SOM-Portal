// som-portal-v2/app/(admin)/admin/jenkins-servers/page.tsx
import { PulseHeader } from "@/ui/PulseHeader";
import { JenkinsServersClient } from "./JenkinsServersClient";

export const metadata = { title: "Jenkins Servers · SOM Portal" };
export const dynamic = "force-dynamic";

export default function JenkinsServersPage() {
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="Jenkins Servers" subtitle="Connections the portal uses to read and trigger Jenkins jobs" />
      <JenkinsServersClient />
    </div>
  );
}
