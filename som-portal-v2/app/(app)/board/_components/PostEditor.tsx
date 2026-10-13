"use client";

import * as React from "react";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";
import { updatePost } from "../actions";

/**
 * Inline title + body editor on the detail page. Read mode is the default;
 * "Edit" swaps the same block into inputs so the content never moves.
 */
export function PostEditor({
  postId,
  title,
  content,
  canEdit,
  renderedBody,
}: {
  postId: string;
  title: string;
  content: string;
  canEdit: boolean;
  renderedBody: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState(title);
  const [draftContent, setDraftContent] = React.useState(content);

  React.useEffect(() => {
    setDraftTitle(title);
    setDraftContent(content);
  }, [title, content]);

  async function save() {
    setPending(true);
    setError(null);
    const res = await updatePost(postId, { title: draftTitle, content: draftContent });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h1 className="min-w-0 text-xl font-semibold leading-snug text-[var(--text-strong)] [text-wrap:balance]">
            {title}
          </h1>
          {canEdit ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={14} /> Edit
            </Button>
          ) : null}
        </div>
        <div className="mt-4 min-w-0">{renderedBody}</div>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      <label className="grid gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Title
        </span>
        <Input
          value={draftTitle}
          maxLength={300}
          onChange={(e) => setDraftTitle(e.target.value)}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Details
        </span>
        <textarea
          value={draftContent}
          rows={10}
          maxLength={20000}
          onChange={(e) => setDraftContent(e.target.value)}
          className={cn(
            "w-full min-w-0 rounded-[var(--radius)] border px-3 py-2 text-sm leading-relaxed",
            "border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--input-fg)]",
          )}
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-[var(--state-danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending} aria-busy={pending}>
          {pending ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="check" size={14} />}
          Save
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
