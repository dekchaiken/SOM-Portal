// som-portal-v2/app/(app)/batch-monitor/page.tsx
import { PulseHeader } from "@/ui/PulseHeader";
import { BatchMonitorClient } from "./BatchMonitorClient";

export const metadata = { title: "Batch Monitor · SOM Portal" };
export const dynamic = "force-dynamic";

export default function BatchMonitorPage() {
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="Batch Monitor" subtitle="Nightly batch runs reported by each team, by month" />
      <BatchMonitorClient />
    </div>
  );
}
