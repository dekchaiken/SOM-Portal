// som-portal-v2/app/(app)/learn/_shared.tsx
import * as React from "react";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";

export function AccessDenied({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
        <p className="text-sm font-medium">{message}</p>
      </CardContent>
    </Card>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  in_progress: "In progress",
  not_started: "Not started",
  locked: "Locked",
  passed: "Passed",
  unlocked: "Ready",
};

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-raised)]">
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}
