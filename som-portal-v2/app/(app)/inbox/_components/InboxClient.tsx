"use client";

// som-portal-v2/app/(app)/inbox/_components/InboxClient.tsx
// Team inbox page: folder, unread filter and list on the left, the reader on the right.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/icons";
import { MessageReader, inboxCall, type Folder } from "./MessageReader";

interface Item { uid: number; subject: string; from: string; date: string; seen: boolean; flagged: boolean; answered: boolean }
interface ListData { total: number; unread: number; items: Item[] }

export function InboxClient({ initialUid }: { initialUid: number | null }) {
  const router = useRouter();
  const [folders, setFolders] = React.useState<Folder[]>([{ path: "INBOX", name: "INBOX" }]);
  const [folder, setFolder] = React.useState("INBOX");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [list, setList] = React.useState<ListData | null>(null);
  const [openUid, setOpenUid] = React.useState<number | null>(initialUid);
  const [error, setError] = React.useState<string | null>(null);

  const loadList = React.useCallback(async () => {
    try {
      const qs = new URLSearchParams({ folder, limit: "25", filter: unreadOnly ? "unread" : "all" });
      setList(await inboxCall<ListData>(`list?${qs.toString()}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the inbox");
    }
  }, [folder, unreadOnly]);

  React.useEffect(() => {
    inboxCall<Folder[]>("folders").then((f) => f.length && setFolders(f)).catch(() => {});
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  const field = "glass-field h-10 rounded-[0.875rem] px-3 text-sm text-[var(--text)]";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="glass flex min-h-[420px] flex-col gap-3 rounded-[var(--radius-card)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Folder" className={`${field} flex-1`} value={folder} onChange={(e) => { setFolder(e.target.value); setOpenUid(null); }}>
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
              <button type="button" onClick={() => setOpenUid(m.uid)} className={`flex w-full items-start gap-3 rounded-[var(--radius-md)] px-2 py-3 text-left transition-colors hover:bg-[var(--bg-raised)] ${openUid === m.uid ? "bg-[var(--bg-raised)]" : ""}`}>
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

      <section className="glass flex min-h-[420px] flex-col rounded-[var(--radius-card)] p-5">
        {openUid === null ? (
          <p className="my-auto text-center text-sm text-[var(--text-muted)]">Choose a message to read it here</p>
        ) : (
          <MessageReader
            key={`${folder}:${openUid}`}
            folder={folder}
            uid={openUid}
            onChanged={() => {
              void loadList();
              router.refresh();
            }}
          />
        )}
      </section>
    </div>
  );
}
