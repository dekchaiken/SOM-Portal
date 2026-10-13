// som-portal-v2/app/(app)/batch-file-search/page.tsx
import { PulseHeader } from "@/ui/PulseHeader";
import { BatchFileSearchClient } from "./BatchFileSearchClient";

export const metadata = { title: "File → Job Lookup · SOM Portal" };
export const dynamic = "force-dynamic";

export default function BatchFileSearchPage() {
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title="File → Job Lookup"
        subtitle="Find which Jenkins job produced a batch file"
      />
      <BatchFileSearchClient />
    </div>
  );
}
