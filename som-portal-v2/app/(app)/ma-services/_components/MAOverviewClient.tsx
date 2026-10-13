"use client";

// som-portal-v2/app/(app)/ma-services/_components/MAOverviewClient.tsx
// MA Overview: the landing for MA Services. Numbers come from the year's Jira stats
// and the usecase and cut-off registries (see src/ma/overview.ts).
import * as React from "react";
import Link from "next/link";
import { Icon } from "@/icons";

interface JiraTicket { key: string; summary: string }
interface Jira {
  year: number;
  total: number;
  tmn: { count: number; percent: number };
  nano: { count: number; percent: number };
  byMonth: { month: string; count: number }[];
  byDomain: { key: string; label?: string; count: number; percent?: number }[];
  pipeline: { total: number; todo: number; inProgress: number; items: JiraTicket[] };
  updatedAt: string;
  fromCache: boolean;
}
interface Overview {
  year: number;
  jira: Jira | null;
  usecases: { total: number; byDomain: Record<string, number> };
  cutoffs: { total: number; bySiteType: Record<string, number> };
}

const TMN = "#F26419";
const NANO = "#6366f1";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS = [2024, 2025, 2026];

async function load(year: number): Promise<Overview> {
  const res = await fetch(`/v2/api/v1/ma/overview?year=${year}`, { credentials: "include" });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? "Could not load MA overview");
  return json.data as Overview;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`glass rounded-[var(--radius-card)] p-5 ${className}`}>{children}</section>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">{children}</div>;
}

export function MAOverviewClient() {
  const [year, setYear] = React.useState(new Date().getFullYear());
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pipeOpen, setPipeOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setData(null);
    try {
      setData(await load(year));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load MA overview");
    }
  }, [year]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const j = data?.jira ?? null;
  const maxMonth = Math.max(1, ...(j?.byMonth.map((m) => m.count) ?? [1]));
  const domainTotal = Math.max(1, j?.total ?? 1);
  const thisMonth = new Date().getMonth();

  return (
    <div className="flex flex-col gap-5">
      <div className="glass flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] px-5 py-3">
        <Icon name="activity" size={16} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-strong)]">MA Overview</span>
        <span className="rounded-full bg-[var(--bg-raised)] px-2.5 py-0.5 text-xs font-semibold">{year}</span>
        {j ? (
          <span className="text-xs text-[var(--text-subtle)]">
            {j.fromCache ? "cached" : "fresh"} · updated {new Date(j.updatedAt).toLocaleString()}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="glass-field h-9 rounded-[0.875rem] px-3 text-sm">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" onClick={refresh} className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3 text-xs font-medium">
            <Icon name="refresh" size={13} /> Refresh
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-[var(--state-danger)]">{error}</p> : null}
      {!data && !error ? <p className="py-16 text-center text-sm text-[var(--text-muted)]">Loading MA overview…</p> : null}

      {data ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <Label>Total closed · {year}</Label>
              <div className="mt-2 flex items-end gap-6">
                <div>
                  <div className="text-4xl font-semibold tabular-nums text-[var(--text-strong)]">{j?.total ?? 0}</div>
                  <div className="text-xs text-[var(--text-muted)]">tickets</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums" style={{ color: TMN }}>{j?.tmn.count ?? 0}</div>
                  <div className="text-xs text-[var(--text-muted)]">TrueMoney · {j?.tmn.percent ?? 0}%</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums" style={{ color: NANO }}>{j?.nano.count ?? 0}</div>
                  <div className="text-xs text-[var(--text-muted)]">Nano · {j?.nano.percent ?? 0}%</div>
                </div>
              </div>
              <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-raised)]">
                <div style={{ width: `${j?.tmn.percent ?? 0}%`, background: TMN }} />
                <div style={{ width: `${j?.nano.percent ?? 0}%`, background: NANO }} />
              </div>
            </Card>

            <Card>
              <button type="button" onClick={() => setPipeOpen((v) => !v)} className="flex w-full items-center justify-between text-left" aria-expanded={pipeOpen}>
                <span className="flex items-center gap-2">
                  <Icon name="layers" size={15} className="text-[var(--text-muted)]" />
                  <span className="text-sm font-semibold text-[var(--text-strong)]">Active pipeline</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  <span>{j?.pipeline.todo ?? 0} backlog</span>
                  <span>{j?.pipeline.inProgress ?? 0} in progress</span>
                  <span className="rounded-full bg-[var(--bg-raised)] px-2 py-0.5 font-semibold">total {j?.pipeline.total ?? 0}</span>
                  <Icon name="chevron-down" size={14} className={pipeOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                </span>
              </button>
              {pipeOpen ? (
                <ul className="mt-4 flex max-h-72 flex-col divide-y divide-[var(--border-subtle)] overflow-y-auto">
                  {(j?.pipeline.items ?? []).map((t) => (
                    <li key={t.key} className="flex items-start gap-3 py-2.5 text-sm">
                      <span className="shrink-0 font-mono text-xs text-[var(--accent)]">{t.key}</span>
                      <span className="text-[var(--text)]">{t.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <Label>By business domain</Label>
              <ul className="mt-4 flex flex-col gap-3">
                {(j?.byDomain ?? []).map((d) => (
                  <li key={d.key} className="grid grid-cols-[120px_minmax(0,1fr)_56px] items-center gap-3 text-sm">
                    <span className="truncate text-[var(--text)]">{d.label ?? d.key}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-[var(--bg-raised)]">
                      <span className="block h-full rounded-full" style={{ width: `${(d.count / domainTotal) * 100}%`, background: d.key === "TMN" ? TMN : d.key === "NNO" ? NANO : "var(--accent)" }} />
                    </span>
                    <span className="text-right tabular-nums text-[var(--text-strong)]">{d.count}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <Label>Monthly trend</Label>
              <div className="mt-4 flex h-44 items-end gap-2">
                {(j?.byMonth ?? []).map((m, i) => (
                  <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">{m.count || ""}</span>
                    <span
                      className="w-full rounded-t-md"
                      style={{
                        height: `${(m.count / maxMonth) * 120}px`,
                        minHeight: m.count ? 4 : 0,
                        background: i === thisMonth ? TMN : "color-mix(in srgb, var(--accent) 45%, transparent)",
                      }}
                    />
                    <span className="text-[10px] text-[var(--text-subtle)]">{MONTHS[i]}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label>Module 01</Label>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--text-strong)]">MA Usecases</h2>
                  <p className="text-xs text-[var(--text-muted)]">Manual action services that must be executed by process</p>
                </div>
                <span className="text-right">
                  <span className="block text-3xl font-semibold tabular-nums" style={{ color: TMN }}>{data.usecases.total}</span>
                  <span className="text-[11px] text-[var(--text-subtle)]">total services</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.usecases.byDomain).sort((a, b) => b[1] - a[1]).map(([d, n]) => (
                  <span key={d} className="glass-chip rounded-full px-3 py-1 text-xs font-medium text-[var(--text)]">
                    {d} <b className="ml-1 tabular-nums">{n}</b>
                  </span>
                ))}
              </div>
              <Link href="/ma-services/usecases" className="glass-btn glass-btn-primary mt-auto inline-flex h-10 w-fit items-center gap-2 rounded-[var(--radius)] px-5 text-sm font-semibold text-white">
                Open MA Usecases <Icon name="arrow-left" size={14} className="rotate-180" />
              </Link>
            </Card>

            <Card className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label>Module 02</Label>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--text-strong)]">Cut-off Services</h2>
                  <p className="text-xs text-[var(--text-muted)]">Cut-off time services that follow a timeline</p>
                </div>
                <span className="text-right">
                  <span className="block text-3xl font-semibold tabular-nums text-[var(--accent)]">{data.cutoffs.total}</span>
                  <span className="text-[11px] text-[var(--text-subtle)]">total services</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.cutoffs.bySiteType).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <span key={s} className="glass-chip rounded-full px-3 py-1 text-xs font-medium text-[var(--text)]">
                    {s} <b className="ml-1 tabular-nums">{n}</b>
                  </span>
                ))}
              </div>
              <Link href="/ma-services/cutoff" className="glass-btn glass-btn-primary mt-auto inline-flex h-10 w-fit items-center gap-2 rounded-[var(--radius)] px-5 text-sm font-semibold text-white">
                Open Cut-off Services <Icon name="arrow-left" size={14} className="rotate-180" />
              </Link>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
