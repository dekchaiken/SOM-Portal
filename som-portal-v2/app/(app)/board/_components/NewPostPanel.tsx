"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";
import { createPost } from "../actions";
import type { BoardCategory, BoardServiceType } from "@/board/schema";
import { MentionPicker } from "./MentionPicker";

export interface MentionCandidate {
  id: string;
  name: string;
}

const fieldClass =
  "h-9 w-full min-w-0 rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--input-fg)]";

/**
 * Inline composer. Collapsed by default so the list keeps the focal point;
 * expands in place rather than in a modal, because posting is a deliberate,
 * low-frequency action and the context above matters.
 */
export function NewPostPanel({
  categories,
  serviceTypes,
  mentionCandidates,
  canWrite,
}: {
  categories: BoardCategory[];
  serviceTypes: BoardServiceType[];
  mentionCandidates: MentionCandidate[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [serviceTypeId, setServiceTypeId] = React.useState("");
  const [mentions, setMentions] = React.useState<MentionCandidate[]>([]);

  const subtypes =
    serviceTypes.find((t) => t.id === serviceTypeId)?.subtypes ?? [];

  if (!canWrite) {
    return (
      <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)]">
        Your team has read-only access to the board.
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const cat = categories.find((c) => c.id === fd.get("board_type"));
    if (cat) fd.set("board_type_name", cat.name);
    const st = serviceTypes.find((t) => t.id === fd.get("service_type_id"));
    if (st) fd.set("service_type_name", st.name);
    const sub = subtypes.find((s) => s.id === fd.get("service_subtype_id"));
    if (sub) fd.set("service_subtype_name", sub.name);
    fd.set("mentions", JSON.stringify(mentions));

    setPending(true);
    setError(null);
    const res = await createPost(fd);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    form.reset();
    setMentions([]);
    setServiceTypeId("");
    setOpen(false);
    router.push(`/board/${res.data.id}`);
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" className="h-9">
        <Icon name="plus" size={14} /> New Post
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="surface-card w-full min-w-0 p-4"
      aria-label="New board post"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">New post</h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <Icon name="x" size={14} /> Cancel
        </Button>
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Title
          </span>
          <Input name="title" required maxLength={300} placeholder="What happened?" />
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Details
          </span>
          <textarea
            name="content"
            rows={5}
            maxLength={20000}
            placeholder="Impact, timeline, what you tried…"
            className={cn(fieldClass, "h-auto py-2 leading-relaxed")}
          />
        </label>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))]">
          <label className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Category
            </span>
            <select name="board_type" className={fieldClass} defaultValue="">
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Status
            </span>
            <select name="status" className={fieldClass} defaultValue="open">
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Service type
            </span>
            <select
              name="service_type_id"
              className={fieldClass}
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
            >
              <option value="">— none —</option>
              {serviceTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Sub-type
            </span>
            <select name="service_subtype_id" className={fieldClass} disabled={subtypes.length === 0}>
              <option value="">— none —</option>
              {subtypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <MentionPicker
          candidates={mentionCandidates}
          selected={mentions}
          onChange={setMentions}
        />

        {error ? (
          <p role="alert" className="text-xs text-[var(--state-danger)]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="check" size={14} />}
            {pending ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
    </form>
  );
}
