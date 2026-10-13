"use client";

// som-portal-v2/app/(app)/ma-services/_components/CutoffClient.tsx
// Cut-off services: tabs by site type, search, and the table. SM team edits; others view.
import * as React from "react";
import Link from "next/link";
import { Icon } from "@/icons";

interface Cutoff {
  id: number;
  site_type: string;
  service_name: string;
  service_group: string;
  channel: string;
  bank_name: string;
  bank_certificate: string;
  tmn_certificate: string;
  comcode: string;
  cutoff_day: string;
  cutoff_time: string;
  ma_page: string;
  remark: string;
}

const API = "/v2/api/v1/ma/cutoff";
const FIELDS: (keyof Cutoff)[] = ["service_name", "site_type", "service_group", "channel", "bank_name", "comcode", "cutoff_day", "cutoff_time", "ma_page", "bank_certificate", "tmn_certificate", "remark"];
const LABEL: Partial<Record<keyof Cutoff, string>> = {
  service_name: "Service name",
  site_type: "Site type",
  service_group: "Service group",
  channel: "Channel",
  bank_name: "Bank name",
  comcode: "Comcode",
  cutoff_day: "Cut-off day",
  cutoff_time: "Cut-off time",
  ma_page: "MA page",
  bank_certificate: "Bank certificate",
  tmn_certificate: "TMN certificate",
  remark: "Remark",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

const EMPTY: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f, ""]));
const field = "glass-field h-10 w-full rounded-[0.875rem] px-3.5 text-sm text-[var(--text)]";

export function CutoffClient({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = React.useState<Cutoff[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("ALL");
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Cutoff | "new" | null>(null);
  const [form, setForm] = React.useState<Record<string, string>>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      setRows(await api<Cutoff[]>(API));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load cut-off services");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const all = rows ?? [];
  const types = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) {
      const k = r.site_type?.trim() || "Unknown";
      c[k] = (c[k] ?? 0) + 1;
    }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [all]);
  const shown = all.filter((r) => {
    if (tab !== "ALL" && (r.site_type?.trim() || "Unknown") !== tab) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return FIELDS.some((f) => String(r[f] ?? "").toLowerCase().includes(s));
  });

  function open(row: Cutoff | "new") {
    setNotice(null);
    setEditing(row);
    setForm(row === "new" ? EMPTY : Object.fromEntries(FIELDS.map((f) => [f, String(row[f] ?? "")])));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing === "new") await api(API, { method: "POST", body: JSON.stringify(form) });
      else if (editing) await api(`${API}/${editing.id}`, { method: "PUT", body: JSON.stringify(form) });
      setEditing(null);
      setNotice({ ok: true, text: "Saved" });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Cutoff) {
    if (!window.confirm(`Delete "${row.service_name}"?`)) return;
    try {
      await api(`${API}/${row.id}`, { method: "DELETE" });
      setNotice({ ok: true, text: "Deleted" });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Delete failed" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="glass flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] px-5 py-3">
        <Link href="/ma-services" className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3 text-xs font-medium">
          <Icon name="arrow-left" size={13} /> MA Overview
        </Link>
        <span className="text-sm font-semibold text-[var(--text-strong)]">Cut-off Services</span>
        <span className="text-xs text-[var(--text-subtle)]">Cut-off time services that follow a timeline</span>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-[var(--text-muted)]">Showing <b className="text-[var(--text-strong)]">{shown.length}</b></span>
          <span className="text-[var(--text-muted)]">Total <b className="text-[var(--text-strong)]">{all.length}</b></span>
          {canEdit ? (
            <button type="button" onClick={() => open("new")} className="glass-btn glass-btn-primary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3.5 text-xs font-semibold text-white">
              <Icon name="plus" size={13} /> Add cut-off
            </button>
          ) : null}
        </div>
      </div>

      {!canEdit ? (
        <div className="glass flex items-center gap-2 rounded-[var(--radius-card)] px-4 py-2.5 text-xs text-[var(--text-muted)]">
          <Icon name="shield" size={14} className="text-[var(--accent)]" />
          View only. Cut-off services are managed by the SM team.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {[["ALL", all.length] as [string, number], ...types].map(([t, n]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${tab === t ? "bg-[var(--accent)] text-white" : "glass-chip text-[var(--text-muted)]"}`}
          >
            {t} <span className="ml-1 tabular-nums opacity-80">{n}</span>
          </button>
        ))}
      </div>

      <div className="glass flex items-center gap-3 rounded-[var(--radius-card)] p-4">
        <div className="relative flex-1">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input aria-label="Search cut-off services" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search service, bank, comcode, remark" className={`${field} pl-9`} />
        </div>
      </div>

      {notice ? <p role="status" className={`text-sm ${notice.ok ? "text-[var(--state-success)]" : "text-[var(--state-danger)]"}`}>{notice.text}</p> : null}
      {error ? <p className="text-sm text-[var(--state-danger)]">{error}</p> : null}
      {!rows && !error ? <p className="py-16 text-center text-sm text-[var(--text-muted)]">Loading cut-off services…</p> : null}

      {rows ? (
        <div className="glass overflow-x-auto rounded-[var(--radius-card)]">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-subtle)]">
              <tr>
                <th className="px-4 py-3 font-semibold">ID</th>
                <th className="px-4 py-3 font-semibold">Service name</th>
                <th className="px-4 py-3 font-semibold">Site</th>
                <th className="px-4 py-3 font-semibold">Group</th>
                <th className="px-4 py-3 font-semibold">Channel</th>
                <th className="px-4 py-3 font-semibold">Cut-off</th>
                <th className="px-4 py-3 font-semibold">Bank / Comcode</th>
                <th className="px-4 py-3 font-semibold">Certificates</th>
                <th className="px-4 py-3 font-semibold">Remark</th>
                {canEdit ? <th className="px-4 py-3 text-right font-semibold">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border-subtle)] align-top hover:bg-[var(--bg-raised)]">
                  <td className="px-4 py-3 tabular-nums text-[var(--text-subtle)]">{r.id}</td>
                  <td className="px-4 py-3 font-medium text-[var(--text-strong)]">{r.service_name}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-[var(--bg-raised)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text)]">{r.site_type || "—"}</span></td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{r.service_group || "—"}</td>
                  <td className="max-w-[200px] px-4 py-3 text-[var(--text-muted)]">{r.channel || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="text-[var(--text)]">{r.cutoff_time || "—"}</div>
                    <div className="text-xs text-[var(--text-subtle)]">{r.cutoff_day}</div>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    <div>{r.bank_name || "—"}</div>
                    <div className="text-xs">{r.comcode}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {r.tmn_certificate ? <div>TMN: {r.tmn_certificate}</div> : null}
                    {r.bank_certificate ? <div>Bank: {r.bank_certificate}</div> : null}
                    {!r.tmn_certificate && !r.bank_certificate ? "—" : null}
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-[var(--text-muted)]">{r.remark || "—"}</td>
                  {canEdit ? (
                    <td className="px-4 py-3 text-right">
                      <button type="button" aria-label={`Edit ${r.service_name}`} onClick={() => open(r)} className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]">
                        <Icon name="pencil" size={14} />
                      </button>
                      <button type="button" aria-label={`Delete ${r.service_name}`} onClick={() => remove(r)} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--state-danger)]">
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {shown.length === 0 ? <tr><td colSpan={canEdit ? 10 : 9} className="px-4 py-12 text-center text-[var(--text-muted)]">No cut-off services match</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing !== null ? (
        <div role="dialog" aria-modal="true" aria-label={editing === "new" ? "Add cut-off" : "Edit cut-off"} className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" onClick={() => setEditing(null)} className="absolute inset-0 bg-[oklch(0.15_0.01_262/0.55)] backdrop-blur-md" />
          <form onSubmit={save} className="relative flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">{editing === "new" ? "Add cut-off service" : "Edit cut-off service"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f} className={`flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)] ${f === "service_name" || f === "remark" ? "sm:col-span-2" : ""}`}>
                  {LABEL[f]}
                  {f === "remark" ? (
                    <textarea rows={3} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} className="glass-field w-full rounded-[0.875rem] px-3.5 py-2.5 text-sm text-[var(--text)]" />
                  ) : (
                    <input required={f === "service_name"} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} className={field} />
                  )}
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
