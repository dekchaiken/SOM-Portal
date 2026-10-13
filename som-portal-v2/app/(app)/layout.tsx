// som-portal-v2/app/(app)/layout.tsx
import * as React from "react";
import { AppShell } from "./_components/AppShell";
import type { SessionLike } from "@/config/nav";

/**
 * App layout — assumes the user is authenticated.
 *
 * NOTE: real session loading comes from `@/auth/getSession()` (Agent A).
 * Until that lands, we fall back to a stub `sm_user` session so the preview
 * nav + layout render for development. Replace the fallback the moment
 * Agent A ships the server-side helper.
 */

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
    /* fall through to dev stub */
  }
  return {
    role: "sm_user",
    team: "sm",
    isGenz: false,
  };
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await loadSession();
  return <AppShell session={session}>{children}</AppShell>;
}
