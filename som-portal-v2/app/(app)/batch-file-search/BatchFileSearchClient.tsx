"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";
import { Button } from "@/ui/shadcn/button";
import { cn } from "@/ui/cn";

interface Match {
  pattern: string;
  confidence: "exact" | "partial" | "fuzzy";
  score?: number;
  entry: {
    server_display: string;
    job_name: string;
    job_path: string;
    job_url: string;
    last_seen_at?: string;
    last_seen_build?: number;
  };
  batch_meta?: { dev_owner: string; sm_rerun: string; manual_url: string; category: string; note: string };
}

interface LookupResult {
  filename: string;
  total: number;
  tier: string | null;
  matches: Match[];
  index_size: number;
  index_generated: string | null;
}

const CONFIDENCE_LABEL: Record<Match["confidence"], string> = {
  exact: "Exact",
  partial: "Partial",
  fuzzy: "Similar",
};

export function BatchFileSearchClient() {
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<LookupResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/v1/batch-file-index/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Lookup failed (${res.status})`);
        setResult(null);
      } else {
        setResult(json.data as LookupResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filename</CardTitle>
          <CardDescription>Paste the file name exactly as it appears in the batch output.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. TMN_BILLING_20261012.csv"
              aria-label="Filename"
              autoFocus
            />
            <Button type="submit" disabled={busy || !query.trim()} className="glass-btn sm:w-40">
              <Icon name="search" size={14} />
              {busy ? "Searching…" : "Find job"}
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-[var(--state-danger)]">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {result.total === 0
                ? "No job found"
                : `${result.total} match${result.total === 1 ? "" : "es"} for "${result.filename}"`}
            </CardTitle>
            <CardDescription>
              Index: {result.index_size} patterns
              {result.index_generated ? ` · generated ${new Date(result.index_generated).toLocaleString("en-GB")}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.total === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No batch job produces this file. Check the spelling, or ask SM to re-index.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {result.matches.map((m, i) => (
                  <li key={`${m.entry.job_path}-${i}`} className="glass-chip rounded-[var(--radius-md)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-strong)]">{m.entry.job_name || m.entry.job_path}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", m.confidence === "exact" ? "bg-[var(--state-success)] text-white" : "bg-[var(--bg-card)] text-[var(--text-muted)]")}>
                        {CONFIDENCE_LABEL[m.confidence]}
                      </span>
                      <span className="text-xs text-[var(--text-subtle)]">{m.entry.server_display}</span>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-[var(--text-muted)] sm:grid-cols-2">
                      <div>Path: <span className="text-[var(--text)]">{m.entry.job_path || "—"}</span></div>
                      <div>Last seen: <span className="text-[var(--text)]">{m.entry.last_seen_at ? new Date(m.entry.last_seen_at).toLocaleString("en-GB") : "—"}</span></div>
                      {m.batch_meta?.dev_owner ? <div>Dev owner: <span className="text-[var(--text)]">{m.batch_meta.dev_owner}</span></div> : null}
                      {m.batch_meta?.sm_rerun ? <div>SM rerun: <span className="text-[var(--text)]">{m.batch_meta.sm_rerun}</span></div> : null}
                    </dl>
                    {m.entry.job_url ? (
                      <a href={m.entry.job_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline">
                        Open job <Icon name="external-link" size={11} />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
