"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";

export interface MentionOption {
  id: string;
  name: string;
}

/**
 * Mention picker — matches v1's `mentions: [{id, name}]` payload, including the
 * `__all__` (@allsm) sentinel that fans out to the whole team.
 */
export function MentionPicker({
  candidates,
  selected,
  onChange,
}: {
  candidates: MentionOption[];
  selected: MentionOption[];
  onChange: (next: MentionOption[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const picked = new Set(selected.map((m) => m.id));

  function toggle(option: MentionOption) {
    onChange(
      picked.has(option.id)
        ? selected.filter((m) => m.id !== option.id)
        : [...selected, option],
    );
  }

  const options: MentionOption[] = [
    { id: "__all__", name: "@allsm (everyone on the team)" },
    ...candidates,
  ];

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
      >
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
        Mentions{selected.length > 0 ? ` (${selected.length})` : ""}
      </button>

      {selected.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => toggle(m)}
                className="inline-flex items-center gap-1 rounded-[var(--radius-pill,999px)] bg-[var(--chip-info-bg)] px-2 py-0.5 text-[11px] text-[var(--chip-info-fg)]"
              >
                {m.name}
                <Icon name="x" size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div
          className={cn(
            "mt-2 max-h-48 overflow-auto rounded-[var(--radius)] border p-2",
            "border-[var(--border)] bg-[var(--bg-raised)]",
          )}
        >
          {options.length === 1 ? (
            <p className="px-1 py-2 text-xs text-[var(--text-muted)]">
              No other teammates found.
            </p>
          ) : null}
          <ul className="grid gap-0.5">
            {options.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-sm hover:bg-[var(--bg-card)]">
                  <input
                    type="checkbox"
                    checked={picked.has(o.id)}
                    onChange={() => toggle(o)}
                  />
                  <span className="min-w-0 truncate">{o.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
