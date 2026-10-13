"use client";

// som-portal-v2/app/(app)/inbox/_components/InboxClient.tsx
// Team inbox: folder and filter, message list, reader (sandboxed frame), flag, move, reply.
import * as React from "react";
import { Icon } from "@/icons";

interface Folder { path: string; name: string }
interface Item { uid: number; subject: string; from: string; date: string; seen: boolean; flagged: boolean; answered: boolean }
interface ListData { total: number; unread: number; items: Item[] }
interface Message extends Item { to: string[]; cc: string[]; text: string; html_safe: string; attachments: { filename: string; size: number }[] }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/v2/api/inbox/${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

function Chip({ children, tone, icon }: { children: React.ReactNode; tone?: "success"; icon?: "check" | "file" }) {
  return (
    <span className={`glass-chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tone === "success" ? "text-[var(--state-success)]" : "text-[var(--text-muted)]"}`}>
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

function frameDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;margin:12px}img{max-width:100%}</style></head><body>${html}</body></html>`;
}

export function InboxClient({ initialUid }: { initialUid: number | null }) {
  const [folders, setFolders] = React.useState<Folder[]>([{ path: "INBOX", name: "INBOX" }]);
  const [folder, setFolder] = React.useState("INBOX");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [list, setList] = React.useState<ListData | null>(null);
  const [openUid, setOpenUid] = React.useState<number | null>(initialUid);
  const [msg, setMsg] = React.useState<Message | null>(null);
  const [reply, setReply] = React.useState("");
  const [moveTo, setMoveTo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadList = React.useCallback(async () => {
    try {
      const qs = new URLSearchParams({ folder, limit: "25", filter: unreadOnly ? "unread" : "all" });
      setList(await call<ListData>(`list?${qs.toString()}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the inbox");
    }
  }, [folder, unreadOnly]);

  React.useEffect(() => {
    call<Folder[]>("folders").then((f) => f.length && setFolders(f)).catch(() => {});
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  const openMessage = React.useCallback(
    async (uid: number) => {
      setOpenUid(uid);
      setNotice(null);
      setReply("");
      try {
        setMsg(await call<Message>(`message?folder=${encodeURIComponent(folder)}&uid=${uid}`));
        void loadList();
      } catch (e) {
        setMsg(null);
        setNotice({ ok: false, text: e instanceof Error ? e.message : "Could not open the message" });
      }
    },
    [folder, loadList],
  );

  React.useEffect(() => {
    if (openUid !== null) void openMessage(openUid);
    // Open once for the uid in the URL; later opens come from clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(flag: "flagged" | "seen", on: boolean) {
    if (!msg) return;
    setBusy(true);
    try {
      await call("flag", { method: "POST", body: JSON.stringify({ folder, uid: msg.uid, flag, on }) });
      setMsg({ ...msg, [flag]: on });
      void loadList();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Could not change the flag" });
    } finally {
      setBusy(false);
    }
  }

  async function move() {
    if (!msg || !moveTo) return;
    setBusy(true);
    try {
      await call("move", { method: "POST", body: JSON.stringify({ folder, uid: msg.uid, target: moveTo }) });
      setMsg(null);
      setOpenUid(null);
      setMoveTo("");
      void loadList();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Could not move the message" });
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!msg || !reply.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await call<{ ok: boolean; error: string | null }>("reply", {
        method: "POST",
        body: JSON.stringify({ folder, uid: msg.uid, body: reply }),
      });
      if (r.ok) {
        setNotice({ ok: true, text: `Reply sent to ${msg.from}` });
        setReply("");
        setMsg({ ...msg, answered: true });
      } else {
        setNotice({ ok: false, text: r.error ?? "Reply failed" });
      }
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Reply failed" });
    } finally {
      setBusy(false);
    }
  }

  const field = "glass-field h-10 rounded-[0.875rem] px-3 text-sm text-[var(--text)]";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="glass flex min-h-[420px] flex-col gap-3 rounded-[var(--radius-card)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Folder" className={`${field} flex-1`} value={folder} onChange={(e) => { setFolder(e.target.value); setOpenUid(null); setMsg(null); }}>
            {folders.map((f) => (
              <option key={f.path} value={f.path}>{f.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => setUnreadOnly((v) => !v)} className={`glass-chip h-10 rounded-full px-3 text-xs font-medium ${unreadOnly ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`} aria-pressed={unreadOnly}>
            Unread only
          </button>
        </div>
        {list ? <p className="text-xs text-[var(--text-muted)]">{list.unread} unread · {list.total} total</p> : null}
        {error ? <p className="text-sm text-[var(--state-danger)]">{error}</p> : null}
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)] overflow-y-auto">
          {(list?.items ?? []).map((m) => (
            <li key={m.uid}>
              <button type="button" onClick={() => openMessage(m.uid)} className={`flex w-full items-start gap-3 rounded-[var(--radius-md)] px-2 py-3 text-left transition-colors hover:bg-[var(--bg-raised)] ${openUid === m.uid ? "bg-[var(--bg-raised)]" : ""}`}>
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.seen ? "bg-transparent" : "bg-[var(--accent)]"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${m.seen ? "text-[var(--text)]" : "font-semibold text-[var(--text-strong)]"}`}>{m.subject}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">{m.from}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-[var(--text-subtle)]">
                  {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {m.flagged ? <Icon name="star" size={12} className="text-[var(--state-warning)]" /> : null}
                </span>
              </button>
            </li>
          ))}
          {list && list.items.length === 0 ? <li className="py-10 text-center text-sm text-[var(--text-muted)]">No messages</li> : null}
        </ul>
      </section>

      <section className="glass flex min-h-[420px] flex-col gap-4 rounded-[var(--radius-card)] p-5">
        {!msg ? (
          <p className="my-auto text-center text-sm text-[var(--text-muted)]">Choose a message to read it here</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-[var(--text-strong)]">{msg.subject}</h2>
              <p className="text-sm text-[var(--text-muted)]">From {msg.from}</p>
              <p className="text-xs text-[var(--text-subtle)]">{new Date(msg.date).toLocaleString()}{msg.to.length ? ` · To ${msg.to.join(", ")}` : ""}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {msg.answered ? <Chip icon="check" tone="success">Replied</Chip> : null}
                {msg.attachments.map((a) => <Chip key={a.filename} icon="file">{a.filename}</Chip>)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={() => toggle("flagged", !msg.flagged)} className="glass-btn glass-btn-secondary h-9 rounded-[var(--radius)] px-3 text-xs font-medium">
                <Icon name="star" size={13} /> {msg.flagged ? "Unflag" : "Flag"}
              </button>
              <button type="button" disabled={busy} onClick={() => toggle("seen", false)} className="glass-btn glass-btn-secondary h-9 rounded-[var(--radius)] px-3 text-xs font-medium">
                Mark unread
              </button>
              <select aria-label="Move to" className={`${field} h-9`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Move to…</option>
                {folders.filter((f) => f.path !== folder).map((f) => <option key={f.path} value={f.path}>{f.name}</option>)}
              </select>
              <button type="button" disabled={busy || !moveTo} onClick={move} className="glass-btn glass-btn-secondary h-9 rounded-[var(--radius)] px-3 text-xs font-medium disabled:opacity-40">Move</button>
            </div>

            <iframe title="Message body" sandbox="" srcDoc={msg.html_safe ? frameDoc(msg.html_safe) : frameDoc(`<pre style="white-space:pre-wrap;font-family:inherit">${msg.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`)} className="h-[360px] w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-white" />

            <form onSubmit={sendReply} className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
              <label htmlFor="inbox-reply" className="text-xs font-medium text-[var(--text-muted)]">Reply to {msg.from}</label>
              <textarea id="inbox-reply" rows={5} value={reply} onChange={(e) => setReply(e.target.value)} className="glass-field w-full rounded-[0.875rem] px-3.5 py-3 text-sm text-[var(--text)]" placeholder="Write your reply" />
              <div className="flex items-center gap-3">
                <button type="submit" disabled={busy || !reply.trim()} className="glass-btn glass-btn-primary inline-flex h-10 items-center gap-2 rounded-[var(--radius)] px-5 text-sm font-semibold text-white disabled:opacity-50">
                  <Icon name={busy ? "loader" : "mail"} size={14} />
                  {busy ? "Sending…" : "Send reply"}
                </button>
              </div>
            </form>
          </>
        )}
        {notice ? <p role="status" className={`text-sm ${notice.ok ? "text-[var(--state-success)]" : "text-[var(--state-danger)]"}`}>{notice.text}</p> : null}
      </section>
    </div>
  );
}
