"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/icons";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  type: string;
  created_at: string;
}

interface ApiResult {
  ok: boolean;
  data?: { notifications: Notification[]; unread: number };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const POLL_MS = 60_000;
const MAX_VISIBLE = 5;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  /* ---------- fetch ------------------------------------------------ */

  const fetchNotifications = React.useCallback(async () => {
    try {
      const res = await fetch("/v2/api/notifications");
      if (!res.ok) return;
      const json: ApiResult = await res.json();
      if (json.ok && json.data) {
        setNotifications(json.data.notifications.slice(0, MAX_VISIBLE));
        setUnread(json.data.unread);
      }
    } catch {
      /* swallow network errors silently */
    }
  }, []);

  React.useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, POLL_MS);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  /* ---------- mark-read helpers ------------------------------------ */

  const markOne = React.useCallback(
    async (notif: Notification) => {
      if (!notif.read) {
        try {
          await fetch("/v2/api/notifications/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: notif.id }),
          });
        } catch {
          /* best-effort */
        }
      }
      setOpen(false);
      if (notif.link) {
        router.push(notif.link);
      }
      // Refresh list in background
      fetchNotifications();
    },
    [router, fetchNotifications],
  );

  const markAllRead = React.useCallback(async () => {
    try {
      await fetch("/v2/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "all" }),
      });
    } catch {
      /* best-effort */
    }
    fetchNotifications();
  }, [fetchNotifications]);

  /* ---------- outside-click & escape ------------------------------- */

  React.useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  /* ---------- render ----------------------------------------------- */

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 6,
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
        }}
      >
        <Icon name="bell" size={20} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 999,
              backgroundColor: "var(--accent, #ef4444)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: "16px",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 340,
            maxHeight: 420,
            overflowY: "auto",
            backgroundColor: "var(--bg-card, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            zIndex: 100,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--border, #e5e7eb)",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: "var(--text, #111)",
              }}
            >
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--accent, #3b82f6)",
                  padding: 0,
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* List */}
          {notifications.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                color: "var(--text-muted, #9ca3af)",
                fontSize: 13,
              }}
            >
              No notifications
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => markOne(n)}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      width: "100%",
                      padding: "10px 16px",
                      background: n.read
                        ? "transparent"
                        : "var(--bg-accent-subtle, rgba(59,130,246,0.06))",
                      border: "none",
                      borderBottom: "1px solid var(--border, #e5e7eb)",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--text, #111)",
                    }}
                  >
                    {/* Unread dot */}
                    <span
                      aria-hidden
                      style={{
                        flexShrink: 0,
                        width: 8,
                        height: 8,
                        marginTop: 5,
                        borderRadius: "50%",
                        backgroundColor: n.read
                          ? "transparent"
                          : "var(--accent, #3b82f6)",
                      }}
                    />
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: n.read ? 400 : 600,
                          fontSize: 13,
                          lineHeight: 1.4,
                        }}
                      >
                        {n.title}
                      </div>
                      {n.body && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text-muted, #6b7280)",
                            marginTop: 2,
                            lineHeight: 1.35,
                          }}
                        >
                          {truncate(n.body, 80)}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted, #9ca3af)",
                          marginTop: 3,
                        }}
                      >
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
