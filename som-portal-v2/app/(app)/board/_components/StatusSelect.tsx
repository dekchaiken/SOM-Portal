"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";
import { setStatus } from "../actions";

/** Status dropdown — the three v1 statuses, nothing else. */
export function StatusSelect({
  postId,
  status,
  disabled,
}: {
  postId: string;
  status: string;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState(status);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setPending(true);
    setError(null);
    const res = await setStatus(postId, next);
    setPending(false);
    if (!res.ok) {
      setValue(prev);
      setError(res.error);
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <select
          value={value}
          disabled={disabled || pending}
          onChange={(e) => change(e.target.value)}
          aria-label="Post status"
          className={cn(
            "h-8 rounded-[var(--radius)] border px-2 text-xs font-medium",
            "border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--input-fg)]",
            "disabled:opacity-60",
          )}
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
        {pending ? <Icon name="loader" size={13} className="animate-spin text-[var(--text-subtle)]" /> : null}
      </span>
      {error ? (
        <span role="alert" className="text-[11px] text-[var(--state-danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
