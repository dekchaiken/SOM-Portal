"use client";

// som-portal-v2/app/(app)/inbox/_components/MessageReader.tsx
// One message: header, action bar (Reply, Reply All, Forward, Star, Mark unread,
// Archive, Delete), body in a sandboxed frame, and the reply / forward forms.
// Used on the Team Inbox page and in the dashboard dialog.
import * as React from "react";
import { Icon } from "@/icons";

export interface Folder { path: string; name: string }
export interface Message {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  to: string[];
  cc: string[];
  text: string;
  html_safe: string;
  attachments: { filename: string; size: number }[];
}

export async function inboxCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/v2/api/inbox/${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

function frameDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;margin:16px}img{max-width:100%}</style></head><body>${html}</body></html>`;
}

const BTN = "glass-btn glass-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3 text-xs font-medium disabled:opacity-40";
const PRIMARY = "glass-btn glass-btn-primary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3 text-xs font-semibold text-white disabled:opacity-40";

export function MessageReader({
  folder,
  uid,
  onChanged,
}: {
  folder: string;
  uid: number;
  /** Called after a change that affects the list (read, flag, move, reply, forward). */
  onChanged?: () => void;
}) {
  const [folders, setFolders] = React.useState<Folder[]>([{ path: "INBOX", name: "INBOX" }]);
  const [msg, setMsg] = React.useState<Message | null>(null);
  const [mode, setMode] = React.useState<"reply" | "replyAll" | "forward" | null>(null);
  const [draft, setDraft] = React.useState("");
  const [forwardTo, setForwardTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [gone, setGone] = React.useState<string | null>(null);

  React.useEffect(() => {
    inboxCall<Folder[]>("folders").then((f) => f.length && setFolders(f)).catch(() => {});
  }, []);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setGone(null);
    setNotice(null);
    setMode(null);
    setDraft("");
    inboxCall<Message>(`message?folder=${encodeURIComponent(folder)}&uid=${uid}`)
      .then((m) => alive && setMsg(m))
      .catch((e) => alive && (setMsg(null), setNotice({ ok: false, text: e instanceof Error ? e.message : "Could not open the message" })))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [folder, uid]);

  async function act(fn: () => Promise<void>, failText: string) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : failText });
    } finally {
      setBusy(false);
    }
  }

  const toggleFlag = (flag: "flagged" | "seen", on: boolean) =>
    act(async () => {
      if (!msg) return;
      await inboxCall("flag", { method: "POST", body: JSON.stringify({ folder, uid: msg.uid, flag, on }) });
      setMsg({ ...msg, [flag]: on });
      onChanged?.();
    }, "Could not change the flag");

  const moveTo = (target: "archive" | "trash", label: string) =>
    act(async () => {
      if (!msg) return;
      await inboxCall("move", { method: "POST", body: JSON.stringify({ folder, uid: msg.uid, target }) });
      setGone(`Moved to ${label}`);
      setMsg(null);
      onChanged?.();
    }, `Could not move to ${label}`);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!msg || !draft.trim() || !mode) return;
    await act(async () => {
      if (mode === "forward") {
        const r = await inboxCall<{ ok: boolean; error: string | null }>("forward", {
          method: "POST",
          body: JSON.stringify({ folder, uid: msg.uid, to: forwardTo, body: draft }),
        });
        if (!r.ok) throw new Error(r.error ?? "Forward failed");
        setNotice({ ok: true, text: `Forwarded to ${forwardTo}` });
      } else {
        const r = await inboxCall<{ ok: boolean; error: string | null }>("reply", {
          method: "POST",
          body: JSON.stringify({ folder, uid: msg.uid, body: draft, all: mode === "replyAll" }),
        });
        if (!r.ok) throw new Error(r.error ?? "Reply failed");
        setNotice({ ok: true, text: mode === "replyAll" ? "Reply sent to everyone" : `Reply sent to ${msg.from}` });
        setMsg({ ...msg, answered: true });
      }
      setDraft("");
      setMode(null);
      onChanged?.();
    }, "Send failed");
  }

  if (loading) return <p className="my-auto py-16 text-center text-sm text-[var(--text-muted)]">Loading message…</p>;
  if (!msg) {
    return (
      <div className="py-16 text-center text-sm">
        {gone ? <p className="text-[var(--text-muted)]">{gone}</p> : null}
        {notice ? <p role="status" className="text-[var(--state-danger)]">{notice.text}</p> : null}
      </div>
    );
  }

  const everyone = [...msg.to, ...msg.cc].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-[var(--text-strong)]">{msg.subject}</h2>
        <dl className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-[var(--text-subtle)]">From</dt>
          <dd className="truncate text-[var(--text)]">{msg.from}</dd>
          <dt className="text-[var(--text-subtle)]">Date</dt>
          <dd className="text-[var(--text)]">{new Date(msg.date).toLocaleString()}</dd>
          <dt className="text-[var(--text-subtle)]">To</dt>
          <dd className="truncate text-[var(--text)]">{msg.to.join(", ") || "—"}</dd>
          {msg.cc.length ? (
            <>
              <dt className="text-[var(--text-subtle)]">CC</dt>
              <dd className="truncate text-[var(--text)]">{msg.cc.join(", ")}</dd>
            </>
          ) : null}
        </dl>
        {msg.attachments.length ? (
          <div className="flex flex-wrap gap-1.5">
            {msg.attachments.map((a) => (
              <span key={a.filename} className="glass-chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                <Icon name="file" size={11} />
                {a.filename}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-[var(--border-subtle)] py-3">
        <button type="button" disabled={busy} onClick={() => { setMode("reply"); setNotice(null); }} className={PRIMARY}>
          <Icon name="refresh" size={13} /> Reply
        </button>
        <button type="button" disabled={busy || everyone.length === 0} onClick={() => { setMode("replyAll"); setNotice(null); }} className={BTN}>
          Reply All
        </button>
        <button type="button" disabled={busy} onClick={() => { setMode("forward"); setNotice(null); }} className={BTN}>
          <Icon name="external-link" size={13} /> Forward
        </button>
        <span className="mx-1 h-5 w-px bg-[var(--border-subtle)]" aria-hidden />
        <button type="button" disabled={busy} onClick={() => toggleFlag("flagged", !msg.flagged)} aria-pressed={msg.flagged} className={BTN}>
          <Icon name="star" size={13} className={msg.flagged ? "text-[var(--state-warning)]" : undefined} /> {msg.flagged ? "Starred" : "Star"}
        </button>
        <button type="button" disabled={busy} onClick={() => toggleFlag("seen", false)} className={BTN}>
          Mark unread
        </button>
        <button type="button" disabled={busy} onClick={() => moveTo("archive", "Archive")} className={BTN}>
          Archive
        </button>
        <button type="button" disabled={busy} onClick={() => moveTo("trash", "Trash")} className={BTN}>
          <Icon name="trash" size={13} /> Delete
        </button>
      </div>

      <iframe
        title="Message body"
        sandbox=""
        srcDoc={msg.html_safe ? frameDoc(msg.html_safe) : frameDoc(`<pre style="white-space:pre-wrap;font-family:inherit">${msg.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`)}
        className="min-h-[420px] w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-white"
      />

      {mode ? (
        <form onSubmit={send} className="glass flex flex-col gap-2 rounded-[var(--radius-md)] p-4">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-muted)]">
            <span>
              {mode === "forward" ? "Forward" : mode === "replyAll" ? `Reply to everyone (${everyone.length})` : `Reply to ${msg.from}`}
            </span>
            <button type="button" onClick={() => setMode(null)} className="text-[var(--text-subtle)] hover:text-[var(--text)]" aria-label="Cancel">
              <Icon name="x" size={13} />
            </button>
          </div>
          {mode === "forward" ? (
            <input aria-label="Forward to" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="name@company.com, other@company.com" className="glass-field h-10 rounded-[0.875rem] px-3.5 text-sm text-[var(--text)]" />
          ) : null}
          {mode === "replyAll" ? <p className="text-xs text-[var(--text-subtle)]">{everyone.join(", ")}</p> : null}
          <textarea aria-label="Message" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} className="glass-field w-full rounded-[0.875rem] px-3.5 py-3 text-sm text-[var(--text)]" placeholder="Write your message" />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !draft.trim() || (mode === "forward" && !forwardTo.trim())} className={`${PRIMARY} h-10 px-5 text-sm`}>
              <Icon name={busy ? "loader" : "mail"} size={14} />
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      ) : null}

      {notice ? <p role="status" className={`text-sm ${notice.ok ? "text-[var(--state-success)]" : "text-[var(--state-danger)]"}`}>{notice.text}</p> : null}
    </div>
  );
}
