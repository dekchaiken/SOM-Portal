// som-portal-v2/src/ui/shadcn/skeleton.tsx
import * as React from "react";
import { cn } from "@/ui/cn";

/** Minimal Skeleton stub — replaced by shadcn CLI output. */
export function Skeleton({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-raised)]",
        className,
      )}
      {...rest}
    />
  );
}
