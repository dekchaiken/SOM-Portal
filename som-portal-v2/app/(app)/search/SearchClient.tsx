"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";
import { Button } from "@/ui/shadcn/button";
import { StatusChip, type ChipStatus } from "@/ui/StatusChip";

interface SearchResult {
  q: string;
  board: { id: string; title: string; status: string; author: string; created_at: string }[];
  templates: { id: string; name: string; category: string }[];
}

export function SearchClient() {
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SearchResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/v1/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Search failed (${res.status})`);
        setResult(null);
      } else {
        setResult(json.data as SearchResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const empty = result && result.board.length === 0 && result.templates.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Icon name="search" size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search posts and templates"
                aria-label="Search"
                className="pl-10"
                autoFocus
              />
            </div>
            <Button type="submit" disabled={busy || query.trim().length < 2} className="glass-btn sm:w-36">
              {busy ? "Searching…" : "Search"}
            </Button>
          </form>
          {error ? <p role="alert" className="mt-3 text-sm text-[var(--state-danger)]">{error}</p> : null}
        </CardContent>
      </Card>

      {empty ? (
        <p className="text-sm text-[var(--text-muted)]">Nothing matches &quot;{result.q}&quot;.</p>
      ) : null}

      {result && result.board.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Service Board</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {result.board.map((p) => (
                <li key={p.id}>
                  <a href={`/v2/board/${p.id}`} className="flex items-center gap-3 py-3 text-sm transition-colors hover:text-[var(--accent)]">
                    <StatusChip status={p.status as ChipStatus} />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                    <span className="shrink-0 text-xs text-[var(--text-subtle)]">{p.author}</span>
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {result && result.templates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Jira Templates</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {result.templates.map((t) => (
                <li key={t.id}>
                  <a href="/v2/jira-templates" className="flex items-center gap-3 py-3 text-sm transition-colors hover:text-[var(--accent)]">
                    <Icon name="file" size={14} className="text-[var(--text-subtle)]" />
                    <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                    <span className="shrink-0 text-xs text-[var(--text-subtle)]">{t.category}</span>
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
