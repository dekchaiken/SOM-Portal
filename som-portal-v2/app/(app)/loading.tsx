import { SkeletonKpiRow, SkeletonToolbar, SkeletonTable } from "@/ui/Skeleton";

export default function AppLoading() {
  return (
    <div className="flex flex-col gap-5 animate-in">
      <div className="flex items-center gap-3">
        <div className="skeleton-shimmer h-8 w-48 rounded-[var(--radius-md)]" />
        <div className="skeleton-shimmer h-5 w-32 rounded-[var(--radius-sm)]" />
      </div>
      <SkeletonKpiRow />
      <SkeletonToolbar />
      <SkeletonTable rows={8} />
    </div>
  );
}
