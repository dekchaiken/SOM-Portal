// som-portal-v2/src/ui/shadcn/badge.tsx
import * as React from "react";
import { cn } from "@/ui/cn";

type Variant = "neutral" | "default" | "success" | "warning" | "danger" | "info";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variantClass: Record<Variant, string> = {
  default: "bg-[var(--chip-neutral-bg)] text-[var(--chip-neutral-fg)]",
  neutral: "bg-[var(--chip-neutral-bg)] text-[var(--chip-neutral-fg)]",
  success: "bg-[var(--chip-success-bg)] text-[var(--chip-success-fg)]",
  warning: "bg-[var(--chip-warning-bg)] text-[var(--chip-warning-fg)]",
  danger: "bg-[var(--chip-danger-bg)] text-[var(--chip-danger-fg)]",
  info: "bg-[var(--chip-info-bg)] text-[var(--chip-info-fg)]",
};

/** Minimal Badge stub — replaced by shadcn CLI output. */
export function Badge({ className, variant = "neutral", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-pill,999px)] px-2 py-0.5 text-xs font-medium",
        variantClass[variant],
        className,
      )}
      {...rest}
    />
  );
}
