// som-portal-v2/src/ui/Skeleton.tsx
import * as React from "react";
import { cn } from "@/ui/cn";
import { Skeleton as Base } from "@/ui/shadcn/skeleton";

/**
 * Skeleton library — 10 shaped patterns ported from v1's global-loading plan
 * (project_global_loading_plan memory). Each pattern mirrors a common page
 * composition so the loading shimmer matches the final layout.
 */

export { Base as Skeleton };

export function SkeletonLine({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return <Base className={cn("h-3 w-full", className)} {...rest} />;
}

export function SkeletonCircle({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Base
      className={cn("rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** 1. KPI row — 4 metric cards. */
export function SkeletonKpiRow() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="surface-card p-4">
          <Base className="h-3 w-20" />
          <Base className="mt-3 h-7 w-24" />
          <Base className="mt-3 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** 2. Table — rows of cells. */
export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="surface-card overflow-hidden p-0">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <Base className="h-3 w-32" />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <SkeletonCircle size={28} />
            <Base className="h-3 flex-1" />
            <Base className="h-3 w-20" />
            <Base className="h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 3. List — vertical rows of title + meta. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="surface-card flex items-center gap-3 p-3"
        >
          <SkeletonCircle size={32} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Base className="h-3 w-1/2" />
            <Base className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 4. Chart — large block + axis strip. */
export function SkeletonChart({ height = 220 }: { height?: number }) {
  return (
    <div className="surface-card p-4">
      <Base className="h-3 w-32" />
      <Base className="mt-3 w-full" style={{ height }} />
      <div className="mt-3 flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Base key={i} className="h-2 w-12" />
        ))}
      </div>
    </div>
  );
}

/** 5. Form — stacked label+field pairs. */
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="surface-card flex flex-col gap-4 p-5">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Base className="h-2.5 w-24" />
          <Base className="h-9 w-full" />
        </div>
      ))}
      <Base className="mt-2 h-9 w-28 self-end" />
    </div>
  );
}

/** 6. Card grid — 6 equal cards. */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="surface-card p-4">
          <Base className="h-3 w-24" />
          <Base className="mt-2 h-3 w-full" />
          <Base className="mt-2 h-3 w-5/6" />
          <Base className="mt-4 h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

/** 7. Three-column Command Center — sidebar + main + side panel. */
export function SkeletonCommandCenter() {
  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)_320px] gap-4">
      <div className="surface-card flex flex-col gap-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Base key={i} className="h-6 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <SkeletonKpiRow />
        <SkeletonChart />
      </div>
      <div className="surface-card flex flex-col gap-3 p-3">
        <Base className="h-3 w-24" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Base key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

/** 8. Detail — title + meta + 3 content blocks. */
export function SkeletonDetail() {
  return (
    <div className="surface-card flex flex-col gap-4 p-5">
      <Base className="h-5 w-2/3" />
      <div className="flex gap-2">
        <Base className="h-5 w-16" />
        <Base className="h-5 w-20" />
      </div>
      <div className="flex flex-col gap-2">
        <Base className="h-3 w-full" />
        <Base className="h-3 w-11/12" />
        <Base className="h-3 w-10/12" />
      </div>
      <Base className="h-32 w-full" />
    </div>
  );
}

/** 9. Avatar strip — row of circles + names. */
export function SkeletonAvatarStrip({ count = 6 }: { count?: number }) {
  return (
    <div className="flex items-center gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5">
          <SkeletonCircle size={40} />
          <Base className="h-2.5 w-14" />
        </div>
      ))}
    </div>
  );
}

/** 10. Toolbar — search + filter chips + action buttons. */
export function SkeletonToolbar() {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Base className="h-9 w-56" />
      <Base className="h-7 w-16" />
      <Base className="h-7 w-20" />
      <Base className="h-7 w-24" />
      <span className="flex-1" />
      <Base className="h-9 w-24" />
    </div>
  );
}
