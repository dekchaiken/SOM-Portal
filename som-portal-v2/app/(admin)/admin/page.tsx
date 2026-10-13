// som-portal-v2/app/(admin)/admin/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { NAV_BY_GROUP, type Role } from "@/config/nav";
import { canSeePage } from "@/config/permissions";
import { readUsers, readTeams, readSystemSettings } from "@/board/global-data";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card";
import { Icon, type IconName } from "@/icons";

export const metadata = { title: "Admin · SOM Portal" };
export const dynamic = "force-dynamic";

interface Kpi {
  label: string;
  value: string;
  icon: IconName;
  href: string;
  sub?: string;
}

async function loadKpis(team: string): Promise<Kpi[]> {
  const [users, teams, settings] = await Promise.all([
    readUsers().catch(() => []),
    readTeams().catch(() => []),
    readSystemSettings().catch(() => null),
  ]);

  const activeUsers = users.filter(
    (u) =>
      !(u as Record<string, unknown>).deleted_at &&
      !(u as Record<string, unknown>).is_deleted,
  );
  const teamUsers = activeUsers.filter((u) => u.team === team);

  return [
    {
      label: "Users",
      value: String(teamUsers.length),
      icon: "users",
      href: "/admin/users",
      sub: `${activeUsers.length} total across ${teams.length} team${teams.length === 1 ? "" : "s"}`,
    },
    {
      label: "Teams",
      value: String(teams.length),
      icon: "boxes",
      href: "/admin/super-team-permissions",
    },
    {
      label: "Session timeout",
      value: settings
        ? `${(settings as Record<string, unknown>).session_timeout_hours ?? 8}h`
        : "8h",
      icon: "clock",
      href: "/admin/system-settings",
    },
  ];
}

export default async function AdminOverview() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");

  const allowed = canSeePage("admin-overview", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!allowed) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Admin overview requires an admin role.
        </p>
      </div>
    );
  }

  const kpis = await loadKpis(session.team);
  const tiles = NAV_BY_GROUP.admin.filter((item) => item.id !== "admin-overview");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">Admin Overview</h1>
        <p className="text-sm text-[var(--text-muted)]">
          System-wide stats and quick access to admin surfaces.
        </p>
      </header>

      {/* KPI row */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))]">
        {kpis.map((kpi) => (
          <Link key={kpi.label} href={kpi.href}>
            <Card className="h-full transition-[background-color] hover:bg-[var(--bg-raised)]">
              <CardContent className="flex items-start gap-3 pt-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                  <Icon name={kpi.icon} size={18} />
                </div>
                <div className="flex flex-col">
                  <span className="text-2xl font-semibold leading-tight text-[var(--text-strong)]">
                    {kpi.value}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {kpi.label}
                  </span>
                  {kpi.sub ? (
                    <span className="mt-0.5 text-[11px] text-[var(--text-subtle)]">
                      {kpi.sub}
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick nav */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-[var(--text-muted)]">
          Admin modules
        </h2>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          {tiles.map((item) => (
            <Link key={item.id} href={item.path}>
              <Card className="h-full transition-[background-color] hover:bg-[var(--bg-raised)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Icon name={item.icon} size={16} />
                    {item.label}
                  </CardTitle>
                  <CardDescription>Open {item.label.toLowerCase()}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Icon name="arrow-right" size={12} />
                    Manage
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
