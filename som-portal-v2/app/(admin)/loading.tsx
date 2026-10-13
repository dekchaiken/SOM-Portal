import { SkeletonToolbar, SkeletonTable } from "@/ui/Skeleton";

export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-5 p-6 animate-in">
      <div className="flex items-center gap-3">
        <div className="skeleton-shimmer h-7 w-40 rounded-[var(--radius-md)]" />
      </div>
      <SkeletonToolbar />
      <SkeletonTable rows={10} />
    </div>
  );
}
