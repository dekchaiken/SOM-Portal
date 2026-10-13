// som-portal-v2/app/(app)/inbox/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { PulseHeader } from "@/ui/PulseHeader";
import { InboxClient } from "./_components/InboxClient";

export const metadata = { title: "Team Inbox · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ uid?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/inbox");
  const { uid } = await searchParams;
  const initialUid = uid && /^\d+$/.test(uid) ? Number(uid) : null;
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="Team Inbox" subtitle="Mail for your team, from the team mailbox" />
      <InboxClient initialUid={initialUid} />
    </div>
  );
}
