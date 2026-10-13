"use client";

// som-portal-v2/app/(admin)/admin/mail-templates/_components/MailTemplatesClient.tsx
import * as React from "react";
import { Icon } from "@/icons";
import { mailCall } from "@/mail/api-client";

interface Template {
  id: string;
  name: string;
  subject: string;
  html: string;
  variables: string[];
}

const EMPTY: Omit<Template, "id"> = { name: "", subject: "", html: "", variables: [] };

export function MailTemplatesClient() {
  const [list, setList] = React.useState<Template[]>([]);
  const [editing, setEditing] = React.useState<Template | "new" | null>(null);
  const [form, setForm] = React.useState<Omit<Template, "id">>(EMPTY);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setList(await mailCall<Template[]>("mail/templates"));
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not load templates" });
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  function open(t: Template | "new") {
    setMessage(null);
    setEditing(t);
    setForm(t === "new" ? EMPTY : { name: t.name, subject: t.subject, html: t.html, variables: t.variables });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const variables = form.variables;
    try {
      if (editing === "new") {
        await mailCall("mail/templates", { method: "POST", body: JSON.stringify({ ...form, variables }) });
      } else if (editing) {
        await mailCall("mail/templates", { method: "PUT", body: JSON.stringify({ id: editing.id, ...form, variables }) });
      }
      setEditing(null);
      setMessage({ ok: true, text: "Template saved" });
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Template) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await mailCall(`mail/templates?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
      setMessage({ ok: true, text: "Template deleted" });
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Delete failed" });
    }
  }

  const field = "glass-field w-full rounded-[0.875rem] px-3.5 py-2.5 text-sm text-[var(--text)]";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="glass flex flex-col gap-2 rounded-[var(--radius-card)] p-4">
        <button type="button" onClick={() => open("new")} className="glass-btn glass-btn-primary mb-2 inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius)] text-sm font-semibold text-white">
          <Icon name="plus" size={14} />
          New template
        </button>
        {list.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 hover:bg-[var(--bg-raised)]">
            <button type="button" onClick={() => open(t)} className="min-w-0 flex-1 text-left text-sm font-medium text-[var(--text-strong)]">
              <span className="block truncate">{t.name}</span>
              <span className="block truncate text-xs text-[var(--text-muted)]">{t.subject}</span>
            </button>
            <button type="button" aria-label={`Delete ${t.name}`} onClick={() => remove(t)} className="text-[var(--text-subtle)] hover:text-[var(--state-danger)]">
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        {list.length === 0 ? <p className="px-2 py-4 text-sm text-[var(--text-muted)]">No templates yet</p> : null}
        {message ? <p role="status" className={`px-2 text-xs ${message.ok ? "text-[var(--state-success)]" : "text-[var(--state-danger)]"}`}>{message.text}</p> : null}
      </div>

      <div className="glass rounded-[var(--radius-card)] p-6">
        {editing === null ? (
          <p className="text-sm text-[var(--text-muted)]">Select a template or create one. Use {"{{name}}"}-style variables in the body and list them below.</p>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-4">
            <input aria-label="Template name" className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input aria-label="Subject" className={field} placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            <textarea aria-label="HTML body" rows={14} className={`${field} font-mono`} placeholder="HTML body" value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} required />
            <input
              aria-label="Variables"
              className={field}
              placeholder="Variables, comma separated (e.g. name, ticket_id)"
              value={form.variables.join(", ")}
              onChange={(e) => setForm({ ...form, variables: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="glass-btn glass-btn-primary h-10 rounded-[var(--radius)] px-5 text-sm font-semibold text-white disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setEditing(null)} className="glass-btn glass-btn-secondary h-10 rounded-[var(--radius)] px-5 text-sm">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
