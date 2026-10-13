// som-portal-v2/app/(app)/dashboard/page.tsx
import { getSession } from "@/auth/session";
import { PulseHeader } from "@/ui/PulseHeader";
import { KpiCard } from "@/ui/KpiCard";
import { StatusChip } from "@/ui/StatusChip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card";
import { Button } from "@/ui/shadcn/button";
import { Icon } from "@/icons";

export const metadata = { title: "Dashboard · SOM Portal" };
export const dynamic = "force-dynamic";

function greet(hour: number): string {
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Working late";
}

export default async function DashboardPage() {
  const session = await getSession();
  // Bangkok time for greeting — the users are here.
  const bkkHour = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }),
  ).getHours();
  const first = session?.username?.split(".")[0] ?? "there";
  const niceName = first.charAt(0).toUpperCase() + first.slice(1);

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting header */}
      <header className="stagger-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {greet(bkkHour)}, {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
            Hi, {niceName}{" "}
            <span className="text-[var(--text-muted)]">
              — here's what's happening
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--state-success)" }}
          />
          <span>All systems operational</span>
        </div>
      </header>

      {/* Pulse header (page banner) */}
      <div className="stagger-in" style={{ animationDelay: "40ms" }}>
        <PulseHeader
          title="Service Operations"
          subtitle="Live service health across SM team surfaces"
          live
          actions={
            <>
              <Button variant="secondary" size="sm">
                <Icon name="refresh" size={14} /> Refresh
              </Button>
              <Button size="sm">
                <Icon name="plus" size={14} /> New Post
              </Button>
            </>
          }
        />
      </div>

      {/* KPI row */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {[
          { label: "Open Incidents", value: "4", icon: "alert-triangle", tone: "warning", deltaPct: -33.3, deltaLabel: "vs yesterday" },
          { label: "Resolved Today", value: "18", icon: "check-circle", tone: "success", deltaPct: 12.5, deltaLabel: "vs yesterday" },
          { label: "Active Builds", value: "7", icon: "hammer", deltaPct: 0, deltaLabel: "steady" },
          { label: "SLA Breach Risk", value: "2", icon: "flag", tone: "danger", deltaPct: 100 },
        ].map((k, i) => (
          <div
            key={k.label}
            className="stagger-in"
            style={{ animationDelay: `${80 + i * 60}ms` }}
          >
            <KpiCard
              label={k.label}
              value={k.value}
              icon={k.icon as never}
              tone={k.tone as never}
              deltaPct={k.deltaPct}
              deltaLabel={k.deltaLabel}
            />
          </div>
        ))}
      </div>

      {/* Content row */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className="stagger-in" style={{ animationDelay: "320ms" }}>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm">Recent Board Activity</CardTitle>
                  <CardDescription>
                    Latest 5 posts across your team's service board
                  </CardDescription>
                </div>
                <a
                  href="/v2/board"
                  className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Open board →
                </a>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-[var(--border)]">
                {[
                  { title: "Deploy failing on wallet-api v2.14.1", status: "open" as const, meta: "3m ago · Jenkins" },
                  { title: "Payment gateway latency spike mitigated", status: "resolved" as const, meta: "22m ago · SP2" },
                  { title: "User-service pod restart loop", status: "in_progress" as const, meta: "1h ago · Restart Monitor" },
                  { title: "Weekly MA window — Thursday 02:00", status: "pending" as const, meta: "today · MA Calendar" },
                  { title: "DRP drill: DNS cooldown rehearsal", status: "resolved" as const, meta: "yesterday · Ops" },
                ].map((row, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
                  >
                    <StatusChip status={row.status} />
                    <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                    <span className="shrink-0 text-xs text-[var(--text-subtle)]">
                      {row.meta}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="stagger-in" style={{ animationDelay: "380ms" }}>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm">My Quick Access</CardTitle>
                  <CardDescription>Pinned tools & your stars</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))]">
                {[
                  { label: "Service Performance", href: "/v2/service-performance", icon: "activity" as const, tag: "monitor" },
                  { label: "Jira Templates", href: "/v2/jira-templates", icon: "file" as const, tag: "ops" },
                  { label: "Jenkins Build", href: "/v2/jenkins-build", icon: "hammer" as const, tag: "ops" },
                  { label: "Log Explorer", href: "/v2/log-explorer", icon: "search" as const, tag: "monitor" },
                  { label: "MA Status", href: "/v2/ma-status", icon: "shield" as const, tag: "ma" },
                  { label: "Incident Launcher", href: "/v2/incident-launcher", icon: "flag" as const, tag: "automation" },
                ].map((t) => (
                  <a
                    key={t.label}
                    href={t.href}
                    className="group flex items-center gap-3 rounded-[var(--radius-md)] border bg-[var(--bg-raised)] p-3 transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white"
                      style={{
                        background:
                          "linear-gradient(135deg, oklch(0.72 0.18 42), oklch(0.6 0.19 38))",
                      }}
                    >
                      <Icon name={t.icon} size={16} />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium">
                        {t.label}
                      </span>
                      <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">
                        {t.tag}
                      </span>
                    </div>
                    <Icon
                      name="arrow-right"
                      size={14}
                      className="ml-auto text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
                    />
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Service health placeholder */}
      <div className="stagger-in" style={{ animationDelay: "460ms" }}>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Service Health</CardTitle>
            <CardDescription>Thanos aggregates · last 15 minutes</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="flex h-48 items-center justify-center rounded-[var(--radius)] border border-dashed text-xs text-[var(--text-muted)]"
              style={{ borderColor: "var(--border)" }}
            >
              Chart placeholder — wired to Grafana Thanos in Phase 2
            </div>
          </CardContent>
        </Card>
      </div>

      <style>{`
        .stagger-in {
          animation: s-in 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes s-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .stagger-in { animation: none; }
        }
      `}</style>
    </div>
  );
}
