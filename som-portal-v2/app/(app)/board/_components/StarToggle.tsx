"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";
import { starPost, unstarPost } from "../actions";

/** Personal bookmark toggle — writes data/<team>/stars.json like v1. */
export function StarToggle({
  postId,
  starred,
  disabled,
}: {
  postId: string;
  starred: boolean;
  disabled?: boolean;
}) {
  const [on, setOn] = React.useState(starred);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => setOn(starred), [starred]);

  async function toggle() {
    const next = !on;
    setOn(next);
    setPending(true);
    const res = next ? await starPost(postId) : await unstarPost(postId);
    setPending(false);
    if (!res.ok) setOn(!next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || pending}
      aria-pressed={on}
      aria-label={on ? "Remove star" : "Star this post"}
      title={on ? "Starred" : "Star this post"}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] transition-colors",
        "hover:bg-[var(--bg-raised)] disabled:opacity-50",
        on ? "text-[var(--state-warning)]" : "text-[var(--text-subtle)]",
      )}
    >
      <Icon name="star" size={15} strokeWidth={on ? 2.4 : 1.75} />
    </button>
  );
}
