// som-portal-v2/src/ui/PulseHeader.tsx
import * as React from "react";
import { cn } from "@/ui/cn";

/**
 * PulseHeader — the page banner from service-performance.html (v1).
 * One focal row: title + subtitle + live-dot + right slot (filters, actions).
 *
 * Reference pattern per feedback_service_perf_ui_style.
 */

export interface PulseHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  live?: boolean;
  actions?: React.ReactNode;
}

export function PulseHeader({
  title,
  subtitle,
  live = false,
  actions,
  className,
  ...rest
}: PulseHeaderProps) {
  return (
    <header
      className={cn(
        "relative flex min-w-0 flex-wrap items-center justify-between gap-4 overflow-hidden rounded-[var(--radius-card,10px)] border px-5 py-4",
        className,
      )}
      style={{
        background: "var(--pulse-bg)",
        borderColor: "var(--pulse-border)",
      }}
      {...rest}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(135deg, oklch(from var(--accent) l c h / 0.04) 0%, transparent 60%)",
        }}
      />
      <div className="relative flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          {live ? (
            <span
              aria-hidden
              className="relative inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background: "var(--pulse-dot)",
                boxShadow: "0 0 8px oklch(from var(--pulse-dot) l c h / 0.5)",
              }}
            >
              <span
                className="absolute inset-0 inline-block rounded-full"
                style={{
                  background: "var(--pulse-dot)",
                  animation: "pulse-ping 1.8s cubic-bezier(0,0,.2,1) infinite",
                }}
              />
            </span>
          ) : null}
          <h1 className="truncate text-xl font-semibold text-[var(--text-strong)]">{title}</h1>
        </div>
        {subtitle ? (
          <p className="truncate text-sm text-[var(--text-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="relative flex min-w-0 shrink-0 items-center gap-2">{actions}</div>
      ) : null}
      <style>{`
        @keyframes pulse-ping {
          0%   { transform: scale(1); opacity: 0.65; }
          80%  { transform: scale(2.4); opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </header>
  );
}
