// som-portal-v2/app/(app)/search/page.tsx
import { PulseHeader } from "@/ui/PulseHeader";
import { SearchClient } from "./SearchClient";

export const metadata = { title: "Search · SOM Portal" };
export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="Search" subtitle="Find board posts and Jira templates" />
      <SearchClient />
    </div>
  );
}
