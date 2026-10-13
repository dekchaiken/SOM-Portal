// som-portal-v2/app/(app)/log-explorer/page.tsx
// Server component. Gates on SM team + denyRoles: ["super_viewer"].
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { LogExplorerClient } from "./LogExplorerClient";

export const metadata = { title: "Log Explorer · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function LogExplorerPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/log-explorer");

  const allowed = canSeePage("log-explorer", {
    role: session.role as Role,
    team: session.team,
  });

  if (!allowed) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
          <p className="text-sm font-medium">
            Log Explorer is available to SM team members only.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <LogExplorerClient />;
}
