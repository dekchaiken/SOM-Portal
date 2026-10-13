// som-portal-v2/app/(app)/settings/page.tsx
//
// Server component: resolves the session, the team-scoped user prefs and the
// user's own v1 profile row, then decides WHICH tabs/toggles this
// team+role may even see (canSeePage from config/permissions.ts — owned by A5,
// imported here, never re-implemented).

import * as React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { readUserPrefs } from "@/account/user-prefs";
import { findUserById, sameTeam, toProfileDto } from "@/account/users-store";
import { canSeePage } from "@/config/permissions";
import type { SessionLike, Role } from "@/config/nav";
import { SettingsClient, type NotificationChannel } from "./_components/SettingsClient";

export const dynamic = "force-dynamic";

/** Notification channel → the nav page it belongs to. Gated via canSeePage. */
const CHANNEL_PAGES: ReadonlyArray<{
  key: NotificationChannel;
  label: string;
  description: string;
  pageId: string;
}> = [
  {
    key: "board",
    label: "Service Board",
    description: "New posts, status changes and comments on the board",
    pageId: "board",
  },
  {
    key: "jira",
    label: "Jira",
    description: "Issues created from SOM templates",
    pageId: "jira-templates",
  },
  {
    key: "jenkins",
    label: "Jenkins",
    description: "Build results and pipeline health alerts",
    pageId: "jenkins",
  },
  {
    key: "incident",
    label: "Incident Launcher",
    description: "Incident declarations and task completion",
    pageId: "incident-launcher",
  },
];

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/settings");

  const sessionLike: SessionLike = {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz ?? false,
  };

  const prefs = await readUserPrefs(session.sub);

  const record = await findUserById(session.sub);
  const profile =
    record && sameTeam(record, session.team, session.role)
      ? toProfileDto(record)
      : {
          id: session.sub,
          name: "",
          nickname: "",
          username: session.username,
          email: "",
          role: session.role,
          avatar_url: "",
          name_th: "",
          emp_id: "",
          phone: "",
          tmn_id: "",
          net_home: "",
          net_mobile: "",
        };

  const channels = CHANNEL_PAGES.filter((c) =>
    canSeePage(c.pageId, sessionLike),
  ).map(({ key, label, description }) => ({ key, label, description }));

  return (
    <SettingsClient
      profile={profile}
      prefs={prefs}
      channels={channels}
      team={session.team}
      role={session.role}
      // GenZ overlay is an SM-only perk and requires the admin-granted flag.
      canUseGenzOverlay={Boolean(session.is_genz) && session.team === "sm"}
    />
  );
}
