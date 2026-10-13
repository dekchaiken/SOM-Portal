"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";
import { Button } from "@/ui/shadcn/button";
import { cn } from "@/ui/cn";

interface AdminView {
  id: string;
  display: string;
  base_url: string;
  auth_mode: "token" | "cookie";
  auth_user: string;
  has_token: boolean;
  has_cookie: boolean;
  enabled: boolean;
  order: number;
  ip_override: string;
}

interface Draft {
  id?: string;
  display: string;
  base_url: string;
  auth_mode: "token" | "cookie";
  auth_user: string;
  auth_token: string;
  auth_cookie: string;
  ip_override: string;
  enabled: boolean;
}

const EMPTY: Draft = {
  display: "",
  base_url: "",
  auth_mode: "token",
  auth_user: "",
  auth_token: "",
  auth_cookie: "",
  ip_override: "",
  enabled: true,
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/v2/api/v1/jenkins-servers${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? json.message ?? `Request failed (${res.status})`);
  return json.data as T;
}

export function JenkinsServersClient() {
  const [rows, setRows] = React.useState<AdminView[] | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setRows(await api<AdminView[]>(""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function edit(row: AdminView) {
    setDraft({
      id: row.id,
      display: row.display,
      base_url: row.base_url,
      auth_mode: row.auth_mode,
      auth_user: row.auth_user,
      auth_token: "",
      auth_cookie: "",
      ip_override: row.ip_override,
      enabled: row.enabled,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        display: draft.display,
        base_url: draft.base_url,
        auth_mode: draft.auth_mode,
        auth_user: draft.auth_user,
        ip_override: draft.ip_override,
        enabled: draft.enabled,
      };
      // Credentials are write-only: an empty field keeps the stored value.
      if (draft.auth_token) body.auth_token = draft.auth_token;
      if (draft.auth_cookie) body.auth_cookie = draft.auth_cookie;
      if (draft.id) {
        await api<null>(`?id=${encodeURIComponent(draft.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api<AdminView>("", { method: "POST", body: JSON.stringify(body) });
      }
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: AdminView) {
    setError(null);
    try {
      await api<null>(`?id=${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(row: AdminView) {
    if (!window.confirm(`Delete server "${row.display}"?`)) return;
    setError(null);
    try {
      await api<null>(`?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" className="glass-chip rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--state-danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={() => setDraft({ ...EMPTY })} className="glass-btn">
          <Icon name="plus" size={14} /> Add server
        </Button>
      </div>

      {rows === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">No Jenkins servers yet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
          {rows.map((row) => (
            <Card key={row.id} className="flex flex-col gap-3">
              <CardHeader className="mb-0">
                <div className="flex items-center gap-2">
                  <Icon name="server" size={16} className="text-[var(--accent)]" />
                  <CardTitle className="text-sm">{row.display}</CardTitle>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
                      row.enabled ? "bg-[var(--state-success)] text-white" : "bg-[var(--bg-raised)] text-[var(--text-muted)]",
                    )}
                  >
                    {row.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <CardDescription className="truncate">{row.base_url}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-0">
                <p className="text-xs text-[var(--text-muted)]">
                  Auth: {row.auth_mode}
                  {row.auth_user ? ` · ${row.auth_user}` : ""}
                  {" · "}
                  {row.auth_mode === "token" ? (row.has_token ? "token saved" : "no token") : row.has_cookie ? "cookie saved" : "no cookie"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => edit(row)}>
                    <Icon name="pencil" size={13} /> Edit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => toggle(row)}>
                    <Icon name={row.enabled ? "x" : "check"} size={13} /> {row.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(row)}>
                    <Icon name="trash" size={13} /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <form onSubmit={save} className="glass w-full max-w-lg rounded-[var(--radius-xl)] p-6">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">{draft.id ? "Edit server" : "Add server"}</h2>
            <div className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                Display name
                <Input required value={draft.display} onChange={(e) => setDraft({ ...draft, display: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                Base URL
                <Input required value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} placeholder="https://jenkins.example.com" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  Auth mode
                  <select
                    className="glass-field h-11 rounded-[0.875rem] px-3 text-sm text-[var(--text)]"
                    value={draft.auth_mode}
                    onChange={(e) => setDraft({ ...draft, auth_mode: e.target.value as "token" | "cookie" })}
                  >
                    <option value="token">Token</option>
                    <option value="cookie">Cookie</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  User
                  <Input value={draft.auth_user} onChange={(e) => setDraft({ ...draft, auth_user: e.target.value })} />
                </label>
              </div>
              {draft.auth_mode === "token" ? (
                <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  API token {draft.id ? "(leave blank to keep the saved token)" : ""}
                  <Input type="password" autoComplete="off" value={draft.auth_token} onChange={(e) => setDraft({ ...draft, auth_token: e.target.value })} />
                </label>
              ) : (
                <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  Session cookie {draft.id ? "(leave blank to keep the saved cookie)" : ""}
                  <Input type="password" autoComplete="off" value={draft.auth_cookie} onChange={(e) => setDraft({ ...draft, auth_cookie: e.target.value })} />
                </label>
              )}
              <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                IP override (optional)
                <Input value={draft.ip_override} onChange={(e) => setDraft({ ...draft, ip_override: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                Enabled
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
