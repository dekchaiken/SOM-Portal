"use client";

import * as React from "react";
import { Icon } from "@/icons";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const fetchNotifications = React.useCallback(async () => {
    try {
      const res = await fetch("/v2/api/notifications");
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) {
        setItems((json.data.notifications ?? []).slice(0, 10));
        setUnread(json.data.unread ?? 0);
      }
    } catch {
      // silent
    }
  }, []);

  // Poll every 30s
  React.useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function markAllRead() {
    setLoading(true);
    try {
      await fetch("/v2/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "all" }),
      });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function markOneRead(id: string) {
    try {
      await fetch("/v2/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnread((prev) => Math.max(0, prev - 1));
    } catch {
      // silent
    }
  }

  function handleClick(item: NotificationItem) {
    if (!item.read) markOneRead(item.id);
    if (item.link) {
      window.location.href = item.link.startsWith("/v2")
        ? item.link
        : `/v2${item.link}`;
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className="relative rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
      >
        <Icon name="bell" size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={loading}
                className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                No notifications
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleClick(item)}
                  className={`flex w-full gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-raised)] ${
                    !item.read ? "bg-[var(--bg-raised)]/50" : ""
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {!item.read && (
                      <span className="block h-2 w-2 rounded-full bg-[var(--accent)]" />
                    )}
                    {item.read && <span className="block h-2 w-2" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {item.title}
                    </div>
                    {item.body && (
                      <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                        {item.body}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-[var(--text-subtle)]">
                      {timeAgo(item.created_at)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
