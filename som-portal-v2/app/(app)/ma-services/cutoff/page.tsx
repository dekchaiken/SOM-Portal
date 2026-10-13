// som-portal-v2/app/(app)/ma-services/cutoff/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canEditMASharedData } from "@/ma/access";
import { CutoffClient } from "../_components/CutoffClient";

export const metadata = { title: "Cut-off Services · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function CutoffPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/ma-services/cutoff");
  return <CutoffClient canEdit={canEditMASharedData(session)} />;
}
