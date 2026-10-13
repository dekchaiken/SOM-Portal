"use client";
// Local modal primitive. Deliberately NOT added to src/ui — sibling agents own
// that barrel; this keeps the Jira module self-contained.
import * as React from "react";
import { Icon } from "@/icons";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = 680,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "Dialog"}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "color-mix(in oklab, black 55%, transparent)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full rounded-[var(--radius-card,10px)] border shadow-2xl"
        style={{
          maxWidth: width,
          // :root tokens only — this is appended at the document level, scoped
          // panel vars would render transparent (feedback_scoped_css_vars).
          background: "var(--bg-card)",
          borderColor: "var(--border)",
          color: "var(--text)",
        }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b px-5 py-3.5"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--text-strong)]">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
            style={{ fontFamily: "inherit" }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div
            className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5"
            style={{ borderColor: "var(--border)" }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
