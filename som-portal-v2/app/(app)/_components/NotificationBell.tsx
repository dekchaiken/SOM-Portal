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
        className="topbar-btn relative rounded-[var(--radius-md)] p-2 text-[var(--text-muted)] transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
      >
        <Icon name="bell" size={16} />
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{
              background: "linear-gradient(135deg, oklch(0.65 0.25 25), oklch(0.60 0.22 15))",
              boxShadow: "0 0 8px oklch(0.65 0.25 25 / 0.5)",
              animation: "pulse-ring 2s ease-out infinite",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-[var(--radius-lg)] border shadow-xl scale-in"
          style={{
            background: "oklch(from var(--bg-card) l c h / 0.92)",
            backdropFilter: "blur(16px) saturate(1.4)",
            WebkitBackdropFilter: "blur(16px) saturate(1.4)",
            borderColor: "oklch(from var(--border) l c h / 0.5)",
            boxShadow: "0 20px 60px -12px oklch(0 0 0 / 0.25), 0 0 30px oklch(from var(--accent) l c h / 0.06)",
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid oklch(from var(--border) l c h / 0.4)" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text-strong)]">Notifications</span>
              {unread > 0 && (
                <span
                  className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
                  style={{ background: "var(--accent)" }}
                >
                  {unread}
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={loading}
                className="btn-press text-xs font-medium text-[var(--accent)] transition-opacity hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10">
                <Icon name="bell" size={28} className="text-[var(--text-subtle)]" />
                <span className="text-sm text-[var(--text-muted)]">All caught up</span>
              </div>
            ) : (
              items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleClick(item)}
                  className="group flex w-full gap-3 px-4 py-3 text-left transition-all hover:bg-[var(--bg-raised)]"
                  style={{
                    borderBottom: i < items.length - 1 ? "1px solid oklch(from var(--border) l c h / 0.3)" : undefined,
                    animation: `fade-in-up 300ms ease-out ${i * 40}ms both`,
                  }}
                >
                  <div className="mt-1 shrink-0">
                    {!item.read ? (
                      <span
                        className="block h-2 w-2 rounded-full"
                        style={{
                          background: "var(--accent)",
                          boxShadow: "0 0 6px oklch(from var(--accent) l c h / 0.5)",
                        }}
                      />
                    ) : (
                      <span className="block h-2 w-2" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${!item.read ? "font-semibold text-[var(--text-strong)]" : "font-medium text-[var(--text)]"}`}>
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
                  <Icon
                    name="chevron-right"
                    size={14}
                    className="mt-1 shrink-0 text-[var(--text-subtle)] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                  />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
