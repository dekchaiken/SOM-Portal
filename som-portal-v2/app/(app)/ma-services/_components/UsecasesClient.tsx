"use client";

// som-portal-v2/app/(app)/ma-services/_components/UsecasesClient.tsx
// MA Usecases: one table per domain (TMN, NANO, WEALTH, VB, ALL), with search, tool
// filter and links. SM team members can add, edit and delete (the server enforces it).
import * as React from "react";
import Link from "next/link";
import { Icon } from "@/icons";

interface Usecase {
  id: number;
  service_name: string;
  service_type: string;
  tool_type: string;
  can_change_text: string;
  remark: string;
  link_manual: string;
  direct_link: string;
  grafana_link: string;
  opensearch_url: string;
  custom_url: string;
  images: string[];
  jenkins_job_path: string;
}

const API = "/v2/api/v1/ma-services";
const DOMAINS = ["TMN", "NANO", "WEALTH", "VB"] as const;
const TYPE_STYLE: Record<string, string> = {
  TMN: "#F26419",
  NANO: "#6366f1",
  WEALTH: "#16a34a",
  VB: "#a855f7",
};

function domainOf(t: string): string {
  const u = (t || "").trim().toUpperCase();
  return u === "WELTH" || u === "WEALTH" ? "WEALTH" : u || "OTHER";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

const EMPTY = { service_name: "", service_type: "TMN", tool_type: "", can_change_text: "NO", remark: "", link_manual: "", direct_link: "", grafana_link: "", opensearch_url: "", custom_url: "" };

export function UsecasesClient({ initialDomain, canEdit }: { initialDomain: string; canEdit: boolean }) {
  const [rows, setRows] = React.useState<Usecase[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [domain, setDomain] = React.useState(initialDomain.toUpperCase());
  const [q, setQ] = React.useState("");
  const [tool, setTool] = React.useState("");
  const [editing, setEditing] = React.useState<Usecase | "new" | null>(null);
  const [form, setForm] = React.useState<typeof EMPTY>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      setRows(await api<Usecase[]>(API));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load MA usecases");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const all = rows ?? [];
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { ALL: all.length };
    for (const r of all) c[domainOf(r.service_type)] = (c[domainOf(r.service_type)] ?? 0) + 1;
    return c;
  }, [all]);
  const tools = React.useMemo(() => Array.from(new Set(all.map((r) => r.tool_type).filter(Boolean))).sort(), [all]);
  const shown = all.filter((r) => {
    if (domain !== "ALL" && domainOf(r.service_type) !== domain) return false;
    if (tool && r.tool_type !== tool) return false;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      return [r.service_name, r.tool_type, r.remark].some((v) => (v ?? "").toLowerCase().includes(s));
    }
    return true;
  });

  function open(row: Usecase | "new") {
    setNotice(null);
    setEditing(row);
    setForm(row === "new" ? EMPTY : {
      service_name: row.service_name,
      service_type: row.service_type,
      tool_type: row.tool_type,
      can_change_text: row.can_change_text,
      remark: row.remark,
      link_manual: row.link_manual,
      direct_link: row.direct_link,
      grafana_link: row.grafana_link,
      opensearch_url: row.opensearch_url,
      custom_url: row.custom_url,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing === "new") await api(API, { method: "POST", body: JSON.stringify(form) });
      else if (editing) await api(`${API}/${editing.id}`, { method: "PUT", body: JSON.stringify({ ...form, id: editing.id }) });
      setEditing(null);
      setNotice({ ok: true, text: "Saved" });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Usecase) {
    if (!window.confirm(`Delete "${row.service_name}"?`)) return;
    try {
      await api(`${API}/${row.id}`, { method: "DELETE" });
      setNotice({ ok: true, text: "Deleted" });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Delete failed" });
    }
  }

  const field = "glass-field h-10 w-full rounded-[0.875rem] px-3.5 text-sm text-[var(--text)]";
  const chip = (active: boolean, color?: string) =>
    `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? "text-white" : "glass-chip text-[var(--text-muted)]"}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="glass flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] px-5 py-3">
        <Link href="/ma-services" className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3 text-xs font-medium">
          <Icon name="arrow-left" size={13} /> MA Overview
        </Link>
        <span className="text-sm font-semibold text-[var(--text-strong)]">MA Usecases</span>
        <span className="text-xs text-[var(--text-subtle)]">Manual action services that must be executed by process</span>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-[var(--text-muted)]">Showing <b className="text-[var(--text-strong)]">{shown.length}</b></span>
          <span className="text-[var(--text-muted)]">Total <b className="text-[var(--text-strong)]">{counts.ALL ?? 0}</b></span>
          {canEdit ? (
            <button type="button" onClick={() => open("new")} className="glass-btn glass-btn-primary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3.5 text-xs font-semibold text-white">
              <Icon name="plus" size={13} /> Add usecase
            </button>
          ) : null}
        </div>
      </div>

      {!canEdit ? (
        <div className="glass flex items-center gap-2 rounded-[var(--radius-card)] px-4 py-2.5 text-xs text-[var(--text-muted)]">
          <Icon name="shield" size={14} className="text-[var(--accent)]" />
          View only. MA usecases are managed by the SM team. Other teams can view them but cannot change them.
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {(["ALL", ...DOMAINS] as string[]).map((d) => {
          const active = domain === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDomain(d)}
              className={chip(active)}
              style={active ? { background: TYPE_STYLE[d] ?? "var(--accent)" } : undefined}
            >
              {d} <span className="ml-1 tabular-nums opacity-80">{counts[d] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="glass flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] p-4">
        <div className="relative min-w-[240px] flex-1">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input aria-label="Search usecases" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search service name, tool, remark" className={`${field} pl-9`} />
        </div>
        <select aria-label="Tool" value={tool} onChange={(e) => setTool(e.target.value)} className={`${field} w-auto min-w-[160px]`}>
          <option value="">All tools</option>
          {tools.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {notice ? <p role="status" className={`text-sm ${notice.ok ? "text-[var(--state-success)]" : "text-[var(--state-danger)]"}`}>{notice.text}</p> : null}
      {error ? <p className="text-sm text-[var(--state-danger)]">{error}</p> : null}
      {!rows && !error ? <p className="py-16 text-center text-sm text-[var(--text-muted)]">Loading usecases…</p> : null}

      {rows ? (
        <div className="glass overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="sticky top-0 bg-[var(--bg-card)] text-[11px] uppercase tracking-[0.12em] text-[var(--text-subtle)]">
              <tr>
                <th className="px-4 py-3 font-semibold">ID</th>
                <th className="px-4 py-3 font-semibold">Service name</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Tool</th>
                <th className="px-4 py-3 font-semibold">Change message</th>
                <th className="px-4 py-3 font-semibold">Remark</th>
                <th className="px-4 py-3 font-semibold">Links</th>
                <th className="px-4 py-3 font-semibold">Images</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const dom = domainOf(r.service_type);
                const links = [
                  r.link_manual && ["doc", r.link_manual],
                  r.direct_link && ["link", r.direct_link],
                  r.grafana_link && ["graph", r.grafana_link],
                  r.opensearch_url && ["os", r.opensearch_url],
                  r.custom_url && ["url", r.custom_url],
                ].filter(Boolean) as [string, string][];
                return (
                  <tr key={r.id} className="border-t border-[var(--border-subtle)] align-top hover:bg-[var(--bg-raised)]">
                    <td className="px-4 py-3 tabular-nums text-[var(--text-subtle)]">{r.id}</td>
                    <td className="px-4 py-3 font-medium text-[var(--text-strong)]">{r.service_name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: TYPE_STYLE[dom] ?? "var(--text-subtle)" }}>{dom}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text)]">{r.tool_type}</td>
                    <td className="px-4 py-3">
                      <span className={r.can_change_text === "YES" ? "font-semibold text-[var(--state-success)]" : "text-[var(--text-subtle)]"}>{r.can_change_text || "NO"}</span>
                    </td>
                    <td className="max-w-[320px] px-4 py-3 text-[var(--text-muted)]">{r.remark}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {links.map(([label, href]) => (
                          <a key={label} href={href} target="_blank" rel="noreferrer" className="glass-chip rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">{label}</a>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-muted)]">{r.images.length ? `${r.images.length} img` : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {canEdit ? (
                        <>
                      <button type="button" aria-label={`Edit ${r.service_name}`} onClick={() => open(r)} className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]">
                        <Icon name="pencil" size={14} />
                      </button>
                      <button type="button" aria-label={`Delete ${r.service_name}`} onClick={() => remove(r)} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--state-danger)]">
                        <Icon name="trash" size={14} />
                      </button>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--text-subtle)]">View only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 ? <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">No usecases match</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing !== null ? (
        <div role="dialog" aria-modal="true" aria-label={editing === "new" ? "Add usecase" : "Edit usecase"} className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" onClick={() => setEditing(null)} className="absolute inset-0 bg-[oklch(0.15_0.01_262/0.55)] backdrop-blur-md" />
          <form onSubmit={save} className="relative flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">{editing === "new" ? "Add usecase" : "Edit usecase"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 sm:col-span-2 text-xs font-medium text-[var(--text-muted)]">Service name
                <input required value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">Domain
                <select value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} className={field}>
                  {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">Tool
                <input required value={form.tool_type} onChange={(e) => setForm({ ...form, tool_type: e.target.value })} list="tool-options" className={field} />
                <datalist id="tool-options">{tools.map((t) => <option key={t} value={t} />)}</datalist>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">Change message
                <select value={form.can_change_text} onChange={(e) => setForm({ ...form, can_change_text: e.target.value })} className={field}>
                  <option value="NO">NO</option>
                  <option value="YES">YES</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2 text-xs font-medium text-[var(--text-muted)]">Remark
                <textarea rows={3} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className="glass-field w-full rounded-[0.875rem] px-3.5 py-2.5 text-sm text-[var(--text)]" />
              </label>
              {(["link_manual", "direct_link", "grafana_link", "opensearch_url", "custom_url"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1 sm:col-span-2 text-xs font-medium text-[var(--text-muted)]">{k.replace(/_/g, " ")}
                  <input type="url" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={field} placeholder="https://" />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="glass-btn glass-btn-secondary h-10 rounded-[var(--radius)] px-4 text-sm">Cancel</button>
              <button type="submit" disabled={busy} className="glass-btn glass-btn-primary h-10 rounded-[var(--radius)] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
