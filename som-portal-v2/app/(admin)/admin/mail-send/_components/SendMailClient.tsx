"use client";

// som-portal-v2/app/(admin)/admin/mail-send/_components/SendMailClient.tsx
import * as React from "react";
import { Icon } from "@/icons";
import { mailCall } from "@/mail/api-client";
import { parseRecipients } from "@/mail/recipients";

interface Template {
  id: string;
  name: string;
  subject: string;
  html: string;
  variables: string[];
}

export function SendMailClient() {
  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [asHtml, setAsHtml] = React.useState(false);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [templateId, setTemplateId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    mailCall<Template[]>("mail/templates").then(setTemplates).catch(() => setTemplates([]));
    mailCall<{ global_cc: string[] }>("mail/config")
      .then((c) => setCc((prev) => prev || c.global_cc.join(", ")))
      .catch(() => {});
  }, []);

  const toSplit = parseRecipients(to);
  const ccSplit = parseRecipients(cc);
  const invalid = [...toSplit.invalid, ...ccSplit.invalid];

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.html);
    setAsHtml(true);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (toSplit.valid.length === 0) return setMessage({ ok: false, text: "Add at least one recipient" });
    if (invalid.length > 0) return setMessage({ ok: false, text: `Check these addresses: ${invalid.join(", ")}` });
    setBusy(true);
    try {
      await mailCall("mail/send", {
        method: "POST",
        body: JSON.stringify({ to: toSplit.valid, cc: ccSplit.valid, subject, body, html: asHtml }),
      });
      setMessage({ ok: true, text: `Sent to ${toSplit.valid.length} recipient(s)` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Send failed" });
    } finally {
      setBusy(false);
    }
  }

  const field = "glass-field h-11 w-full rounded-[0.875rem] px-3.5 text-sm text-[var(--text)]";
  const label = "text-xs font-medium text-[var(--text-muted)]";

  return (
    <form onSubmit={send} className="glass flex max-w-3xl flex-col gap-4 rounded-[var(--radius-card)] p-6">
      <div className="flex flex-col gap-1.5">
        <label className={label} htmlFor="mail-to">To</label>
        <input id="mail-to" className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com, other@company.com" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={label} htmlFor="mail-cc">CC</label>
        <input id="mail-cc" className={field} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" />
      </div>
      {invalid.length > 0 ? (
        <p className="text-xs text-[var(--state-danger)]">Not a valid address: {invalid.join(", ")}</p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label className={label} htmlFor="mail-template">Template</label>
        <select id="mail-template" className={field} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
          <option value="">No template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={label} htmlFor="mail-subject">Subject</label>
        <input id="mail-subject" className={field} value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className={label} htmlFor="mail-body">Body</label>
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input type="checkbox" checked={asHtml} onChange={(e) => setAsHtml(e.target.checked)} className="accent-[var(--accent)]" />
            Body is HTML
          </label>
        </div>
        <textarea id="mail-body" rows={12} className="glass-field w-full rounded-[0.875rem] px-3.5 py-3 font-mono text-sm text-[var(--text)]" value={body} onChange={(e) => setBody(e.target.value)} required />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="glass-btn glass-btn-primary inline-flex h-11 items-center gap-2 rounded-[var(--radius)] px-5 text-sm font-semibold text-white disabled:opacity-50">
          <Icon name={busy ? "loader" : "mail"} size={15} />
          {busy ? "Sending…" : "Send"}
        </button>
        {message ? (
          <span role="status" className={`text-sm ${message.ok ? "text-[var(--state-success)]" : "text-[var(--state-danger)]"}`}>{message.text}</span>
        ) : null}
      </div>
    </form>
  );
}
