// som-portal-v2/src/ui/KpiCard.tsx
import * as React from "react";
import { cn } from "@/ui/cn";
import { Icon, type IconName } from "@/icons";

/**
 * KpiCard — service-performance-dashboard-style single-metric card.
 *
 * Hierarchy: label (muted, small, uppercase) → value (large, strong) → delta.
 * Weight + color do the hierarchy work, not size alone (per
 * dammyjay93/interface-design).
 */

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  icon?: IconName;
  deltaPct?: number | null;
  deltaLabel?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
}

const toneClass: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  neutral: "text-[var(--text-strong)]",
  success: "text-[var(--state-success)]",
  warning: "text-[var(--state-warning)]",
  danger: "text-[var(--state-danger)]",
};

export function KpiCard({
  label,
  value,
  unit,
  icon,
  deltaPct,
  deltaLabel,
  tone = "neutral",
  className,
}: KpiCardProps) {
  const deltaKnown = typeof deltaPct === "number" && !Number.isNaN(deltaPct);
  const deltaUp = deltaKnown && deltaPct! > 0;
  const deltaDown = deltaKnown && deltaPct! < 0;

  return (
    <div className={cn("surface-card p-4 min-w-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--stat-card-label-fg)]">
          {label}
        </span>
        {icon ? (
          <Icon
            name={icon}
            size={16}
            className="text-[var(--text-subtle)]"
          />
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={cn("text-[26px] font-semibold leading-none", toneClass[tone])}
          data-numeric
        >
          {value}
        </span>
        {unit ? (
          <span className="text-xs font-medium text-[var(--text-muted)]">
            {unit}
          </span>
        ) : null}
      </div>
      {deltaKnown || deltaLabel ? (
        <div className="mt-3 flex items-center gap-1 text-xs">
          {deltaKnown ? (
            <>
              <Icon
                name={deltaUp ? "trending-up" : deltaDown ? "trending-down" : "arrow-right"}
                size={12}
                className={cn(
                  deltaUp && "text-[var(--state-success)]",
                  deltaDown && "text-[var(--state-danger)]",
                  !deltaUp && !deltaDown && "text-[var(--text-subtle)]",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  deltaUp && "text-[var(--state-success)]",
                  deltaDown && "text-[var(--state-danger)]",
                  !deltaUp && !deltaDown && "text-[var(--text-muted)]",
                )}
                data-numeric
              >
                {deltaPct! > 0 ? "+" : ""}
                {deltaPct!.toFixed(1)}%
              </span>
            </>
          ) : null}
          {deltaLabel ? (
            <span className="text-[var(--text-subtle)]">{deltaLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
