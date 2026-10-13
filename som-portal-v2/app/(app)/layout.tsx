// som-portal-v2/app/(app)/layout.tsx
import * as React from "react";
import { AppShell } from "./_components/AppShell";
import { redirect } from "next/navigation";
import type { SessionLike } from "@/config/nav";

async function loadSession(): Promise<SessionLike | null> {
  try {
    const { getSession } = await import("@/auth/session");
    const sess = await getSession();
    if (sess) {
      // Per-team feature grants from teams.json (global file). Without these the
      // `feature:` gate in matchesSession() is skipped and every team would see
      // every ops page. Server-side route gates still enforce independently.
      const { teamFeatures } = await import("@/team/features");
      const granted = await teamFeatures(sess.team).catch(() => [] as string[]);
      return {
        role: sess.role as SessionLike["role"],
        team: sess.team,
        isGenz: sess.is_genz ?? false,
        features: Object.fromEntries(granted.map((f) => [f, true])),
        teamFeatures: granted,
      };
    }
  } catch {
    /* no usable session */
  }
  return null;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await loadSession();
  if (!session) redirect("/login");
  return <AppShell session={session}>{children}</AppShell>;
}
