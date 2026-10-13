"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { cn } from "@/ui/cn";

interface Summary {
  id: string;
  timestamp: string;
  reporter: string;
  server: string;
  backfilled: boolean;
  total: number;
  success: number;
  failed: number;
  na: number;
  other: number;
  attention: { job: string; status: string; remark: string; folder: string }[];
}

interface ListData {
  month: string | null;
  summaries: Summary[];
}

const BASE = "/v2/api/v1/batch-records";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

export function BatchMonitorClient() {
  const [months, setMonths] = React.useState<string[] | null>(null);
  const [month, setMonth] = React.useState<string>("");
  const [data, setData] = React.useState<ListData | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getJson<string[]>(`${BASE}?action=months`)
      .then((list) => {
        setMonths(list);
        setMonth(list[list.length - 1] ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  React.useEffect(() => {
    if (!month) return;
    setData(null);
    getJson<ListData>(`${BASE}?action=list&month=${encodeURIComponent(month)}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [month]);

  if (error) {
    return (
      <p role="alert" className="glass-chip rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--state-danger)]">
        {error}
      </p>
    );
  }

  if (months && months.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">No batch reports yet.</CardContent>
      </Card>
    );
  }

  const summaries = data?.summaries ?? [];
  const totals = summaries.reduce(
    (acc, s) => ({
      runs: acc.runs + 1,
      success: acc.success + s.success,
      failed: acc.failed + s.failed,
    }),
    { runs: 0, success: 0, failed: 0 },
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          Month
          <select
            className="glass-field h-10 rounded-[0.875rem] px-3 text-sm text-[var(--text)]"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {(months ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Stat label="Reports" value={totals.runs} />
        <Stat label="Jobs succeeded" value={totals.success} tone="success" />
        <Stat label="Jobs failed" value={totals.failed} tone="danger" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Reports</CardTitle>
          <CardDescription>Select a row to see the jobs that need attention.</CardDescription>
        </CardHeader>
        <CardContent>
          {data === null ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : summaries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No reports this month.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {summaries.map((s) => {
                const expanded = open === s.id;
                return (
                  <li key={s.id} className="glass-chip rounded-[var(--radius-md)]">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : s.id)}
                      className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm"
                      aria-expanded={expanded}
                    >
                      <span className="font-medium text-[var(--text-strong)]">{formatTime(s.timestamp)}</span>
                      <span className="text-[var(--text-muted)]">{s.server || "—"}</span>
                      <span className="text-[var(--text-muted)]">by {s.reporter}</span>
                      {s.backfilled ? (
                        <span className="rounded-full bg-[var(--bg-card)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">Backfilled</span>
                      ) : null}
                      <span className="ml-auto flex items-center gap-3 text-xs">
                        <Count tone="success" value={s.success} label="ok" />
                        <Count tone="danger" value={s.failed} label="failed" />
                        <Count tone="muted" value={s.other} label="other" />
                        <Icon name="chevron-down" size={14} className={cn("transition-transform", expanded && "rotate-180")} />
                      </span>
                    </button>
                    {expanded ? (
                      <div className="border-t border-[var(--border-subtle)] px-4 py-3">
                        {s.attention.length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)]">Nothing needs attention in this run.</p>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {s.attention.map((a) => (
                              <li key={a.job} className="text-sm">
                                <span className="font-medium text-[var(--text-strong)]">{a.job}</span>
                                <span className="ml-2 text-xs text-[var(--state-danger)]">{a.status}</span>
                                {a.folder ? <span className="ml-2 text-xs text-[var(--text-subtle)]">{a.folder}</span> : null}
                                {a.remark ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{a.remark}</p> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  return (
    <div className="glass rounded-[var(--radius-card)] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "success" && "text-[var(--state-success)]",
          tone === "danger" && "text-[var(--state-danger)]",
          !tone && "text-[var(--text-strong)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Count({ value, label, tone }: { value: number; label: string; tone: "success" | "danger" | "muted" }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        tone === "success" && "text-[var(--state-success)]",
        tone === "danger" && "text-[var(--state-danger)]",
        tone === "muted" && "text-[var(--text-subtle)]",
      )}
    >
      {value} {label}
    </span>
  );
}
