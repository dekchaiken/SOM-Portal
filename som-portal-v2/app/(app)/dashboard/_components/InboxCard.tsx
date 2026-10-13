// som-portal-v2/app/(app)/dashboard/_components/InboxCard.tsx
// Dashboard card for the team inbox (v1 showed it on the home page too).
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import type { DashboardInbox } from "@/inbox/service";

export function InboxCard({ inbox }: { inbox: DashboardInbox }) {
  return (
    <Card className="card-hover">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Team Inbox</CardTitle>
          <CardDescription>
            {inbox.configured && !inbox.error ? `${inbox.unread} unread` : "Mailbox"}
          </CardDescription>
        </div>
        <Link href="/inbox" className="glass-btn glass-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] px-3 text-xs font-medium">
          Open inbox
          <Icon name="external-link" size={12} />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!inbox.configured ? (
          <p className="text-sm text-[var(--text-muted)]">
            This team has no mailbox yet. A team admin can set it up under Mail Config.
          </p>
        ) : inbox.error ? (
          <p className="text-sm text-[var(--state-danger)]">{inbox.error}</p>
        ) : inbox.items.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No messages.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {inbox.items.map((m) => (
              <li key={m.uid}>
                <Link href={`/inbox?uid=${m.uid}`} className="flex items-center gap-3 py-2.5">
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${m.seen ? "bg-transparent" : "bg-[var(--accent)]"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${m.seen ? "text-[var(--text)]" : "font-semibold text-[var(--text-strong)]"}`}>
                      {m.subject}
                    </span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">{m.from}</span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-subtle)]">
                    {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
