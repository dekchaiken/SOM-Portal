"use client";

import * as React from "react";
import { Button } from "@/ui/shadcn/button";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";
import { addComment } from "../actions";
import { MentionPicker, type MentionOption } from "./MentionPicker";

/** Comment box — max 5,000 chars, same limit as v1. */
export function CommentComposer({
  postId,
  mentionCandidates,
  canWrite,
}: {
  postId: string;
  mentionCandidates: MentionOption[];
  canWrite: boolean;
}) {
  const [value, setValue] = React.useState("");
  const [mentions, setMentions] = React.useState<MentionOption[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!canWrite) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Commenting is disabled — your team has read-only access to this page.
      </p>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("post_id", postId);
    fd.set("content", value);
    fd.set("mentions", JSON.stringify(mentions));
    setPending(true);
    setError(null);
    const res = await addComment(fd);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setValue("");
    setMentions([]);
  }

  return (
    <form onSubmit={submit} className="grid gap-2" aria-label="Add a comment">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        maxLength={5000}
        required
        placeholder="Add a comment…"
        className={cn(
          "w-full min-w-0 rounded-[var(--radius)] border px-3 py-2 text-sm leading-relaxed",
          "border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--input-fg)]",
        )}
      />
      <MentionPicker candidates={mentionCandidates} selected={mentions} onChange={setMentions} />
      {error ? (
        <p role="alert" className="text-xs text-[var(--state-danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--text-subtle)]">
          {value.length}/5000
        </span>
        <Button type="submit" size="sm" disabled={pending || value.trim() === ""} aria-busy={pending}>
          {pending ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="message" size={14} />}
          Comment
        </Button>
      </div>
    </form>
  );
}
