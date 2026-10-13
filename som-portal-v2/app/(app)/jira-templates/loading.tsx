import { SkeletonToolbar, SkeletonCardGrid } from "@/ui/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-5 stagger-children">
      <div className="skeleton-shimmer h-20 rounded-[var(--radius-card)]" />
      <SkeletonToolbar />
      <SkeletonCardGrid count={4} />
    </div>
  );
}
