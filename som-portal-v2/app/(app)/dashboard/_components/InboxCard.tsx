"use client";

// som-portal-v2/app/(app)/dashboard/_components/InboxCard.tsx
// Dashboard card for the team inbox. A message opens in a dialog here, not on another page.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { MessageReader } from "../../inbox/_components/MessageReader";

export interface InboxItem { uid: number; subject: string; from: string; date: string; seen: boolean }
export interface InboxSummary {
  configured: boolean;
  unread: number;
  items: InboxItem[];
  error: string | null;
}

export function InboxCard({ inbox }: { inbox: InboxSummary }) {
  const router = useRouter();
  const [openUid, setOpenUid] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (openUid === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenUid(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openUid]);

  return (
    <Card className="card-hover">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Team Inbox</CardTitle>
          <CardDescription>{inbox.configured && !inbox.error ? `${inbox.unread} unread` : "Mailbox"}</CardDescription>
        </div>
        <Link href="/inbox" className="glass-btn glass-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] px-3 text-xs font-medium">
          Open inbox
          <Icon name="external-link" size={12} />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!inbox.configured ? (
          <p className="text-sm text-[var(--text-muted)]">This team has no mailbox yet. A team admin can set it up under Mail Config.</p>
        ) : inbox.error ? (
          <p className="text-sm text-[var(--state-danger)]">{inbox.error}</p>
        ) : inbox.items.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No messages.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {inbox.items.map((m) => (
              <li key={m.uid}>
                <button type="button" onClick={() => setOpenUid(m.uid)} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${m.seen ? "bg-transparent" : "bg-[var(--accent)]"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${m.seen ? "text-[var(--text)]" : "font-semibold text-[var(--text-strong)]"}`}>{m.subject}</span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">{m.from}</span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-subtle)]">
                    {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {openUid !== null ? (
        <div role="dialog" aria-modal="true" aria-label="Message" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" onClick={() => setOpenUid(null)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="glass relative flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] p-6">
            <div className="flex justify-end">
              <button type="button" onClick={() => setOpenUid(null)} aria-label="Close message" className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <Icon name="x" size={16} />
              </button>
            </div>
            <MessageReader
              key={openUid}
              folder="INBOX"
              uid={openUid}
              onChanged={() => router.refresh()}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}
