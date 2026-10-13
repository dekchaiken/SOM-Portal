"use client";
import * as React from "react";
import { Icon } from "@/icons";

export interface ToastItem {
  id: number;
  tone: "success" | "error";
  text: string;
  href?: string;
  hrefLabel?: string;
}

export function useToasts() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const push = React.useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 9000);
  }, []);
  const dismiss = React.useCallback(
    (id: number) => setItems((xs) => xs.filter((x) => x.id !== id)),
    [],
  );
  return { items, push, dismiss };
}

export function Toasts({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="flex items-start gap-2.5 rounded-[var(--radius-md,8px)] border p-3 shadow-lg"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        >
          <Icon
            name={t.tone === "success" ? "check-circle" : "alert-triangle"}
            size={16}
            className="mt-0.5 shrink-0"
            style={{
              color: t.tone === "success" ? "var(--state-success)" : "var(--state-danger)",
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">{t.text}</p>
            {t.href ? (
              <a
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                {t.hrefLabel ?? "Open in Jira"} <Icon name="external-link" size={12} />
              </a>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 text-[var(--text-subtle)]"
            style={{ fontFamily: "inherit" }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
