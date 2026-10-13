"use client";

// som-portal-v2/app/(admin)/admin/mail-logs/_components/MailLogsClient.tsx
import * as React from "react";
import { Icon } from "@/icons";
import { mailCall } from "@/mail/api-client";

interface LogRow {
  id: string;
  sent_at: string;
  to: string[];
  cc: string[];
  subject: string;
  status: string;
  error: string;
  sent_by_name: string;
}

interface LogsPage {
  logs: LogRow[];
  total: number;
  today: number;
  failed: number;
  limit: number;
  offset: number;
}

const PAGE = 50;

export function MailLogsClient() {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [data, setData] = React.useState<LogsPage | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (search.trim()) qs.set("search", search.trim());
    if (status) qs.set("status", status);
    try {
      setData(await mailCall<LogsPage>(`mail/logs?${qs.toString()}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load logs");
    }
  }, [search, status, offset]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const field = "glass-field h-10 rounded-[0.875rem] px-3 text-sm text-[var(--text)]";
  const from = data && data.total > 0 ? data.offset + 1 : 0;
  const to = data ? Math.min(data.offset + PAGE, data.total) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total" value={data?.total ?? "–"} />
        <Stat label="Today" value={data?.today ?? "–"} />
        <Stat label="Failed" value={data?.failed ?? "–"} tone="danger" />
      </div>

      <div className="glass flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] p-4">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input
            aria-label="Search logs"
            className={`${field} w-full pl-9`}
            placeholder="Search subject, recipient or sender"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <select aria-label="Status" className={field} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {error ? <p className="text-sm text-[var(--state-danger)]">{error}</p> : null}

      <div className="glass overflow-x-auto rounded-[var(--radius-card)]">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Sent at</th>
              <th className="px-4 py-3 font-medium">To</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Sent by</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.logs ?? []).map((l) => (
              <tr key={l.id} className="border-t border-[var(--border-subtle)] align-top">
                <td className="whitespace-nowrap px-4 py-3 text-[var(--text-muted)]">{new Date(l.sent_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  {l.to.join(", ")}
                  {l.cc.length > 0 ? <div className="text-xs text-[var(--text-muted)]">CC {l.cc.join(", ")}</div> : null}
                </td>
                <td className="px-4 py-3">{l.subject}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{l.sent_by_name || "–"}</td>
                <td className="px-4 py-3">
                  <span className={l.status === "failed" ? "text-[var(--state-danger)]" : "text-[var(--state-success)]"}>{l.status}</span>
                  {l.error ? <div className="text-xs text-[var(--text-muted)]">{l.error}</div> : null}
                </td>
              </tr>
            ))}
            {data && data.logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[var(--text-muted)]">No mail matches</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
        <span>{from}–{to} of {data?.total ?? 0}</span>
        <div className="flex gap-2">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="glass-btn glass-btn-secondary h-9 rounded-[var(--radius)] px-3 text-sm disabled:opacity-40">Previous</button>
          <button type="button" disabled={!data || offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)} className="glass-btn glass-btn-secondary h-9 rounded-[var(--radius)] px-3 text-sm disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "danger" }) {
  return (
    <div className="glass rounded-[var(--radius-card)] p-4">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "danger" ? "text-[var(--state-danger)]" : "text-[var(--text-strong)]"}`}>{value}</div>
    </div>
  );
}
