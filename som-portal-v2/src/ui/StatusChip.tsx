// som-portal-v2/src/ui/StatusChip.tsx
import * as React from "react";
import { cn } from "@/ui/cn";

/**
 * StatusChip — unified pill for board statuses, MA states, Jenkins builds, etc.
 *
 * One color = one meaning (per jakubkrehel/better-colors). A dot + label makes
 * state readable even when color is desaturated or user has reduced contrast.
 */

export type ChipStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "pending"
  | "success"
  | "warning"
  | "danger"
  | "unknown";

const map: Record<
  ChipStatus,
  { label: string; bg: string; fg: string; dot: string }
> = {
  open: {
    label: "Open",
    bg: "var(--chip-info-bg)",
    fg: "var(--chip-info-fg)",
    dot: "var(--state-info)",
  },
  in_progress: {
    label: "In Progress",
    bg: "var(--chip-warning-bg)",
    fg: "var(--chip-warning-fg)",
    dot: "var(--state-warning)",
  },
  resolved: {
    label: "Resolved",
    bg: "var(--chip-success-bg)",
    fg: "var(--chip-success-fg)",
    dot: "var(--state-success)",
  },
  pending: {
    label: "Pending",
    bg: "var(--chip-neutral-bg)",
    fg: "var(--chip-neutral-fg)",
    dot: "var(--text-subtle)",
  },
  success: {
    label: "Success",
    bg: "var(--chip-success-bg)",
    fg: "var(--chip-success-fg)",
    dot: "var(--state-success)",
  },
  warning: {
    label: "Warning",
    bg: "var(--chip-warning-bg)",
    fg: "var(--chip-warning-fg)",
    dot: "var(--state-warning)",
  },
  danger: {
    label: "Danger",
    bg: "var(--chip-danger-bg)",
    fg: "var(--chip-danger-fg)",
    dot: "var(--state-danger)",
  },
  unknown: {
    label: "Unknown",
    bg: "var(--chip-neutral-bg)",
    fg: "var(--chip-neutral-fg)",
    dot: "var(--text-subtle)",
  },
};

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: ChipStatus;
  label?: string;
  dot?: boolean;
}

export function StatusChip({
  status,
  label,
  dot = true,
  className,
  style,
  ...rest
}: StatusChipProps) {
  const cfg = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill,999px)] px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{
        background: cfg.bg,
        color: cfg.fg,
        ...style,
      }}
      {...rest}
    >
      {dot ? (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: cfg.dot }}
        />
      ) : null}
      {label ?? cfg.label}
    </span>
  );
}
