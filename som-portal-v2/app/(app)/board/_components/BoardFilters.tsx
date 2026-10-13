"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/ui/shadcn/input";
import { Button } from "@/ui/shadcn/button";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
] as const;

/**
 * Search + status + starred filters. Writes to the URL so the RSC list is the
 * single source of truth (back/forward and deep links just work).
 */
export function BoardFilters({ starred }: { starred: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = React.useState(params.get("search") ?? "");

  const push = React.useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(params.toString());
      mutate(sp);
      sp.delete("offset");
      const qs = sp.toString();
      router.push(qs ? `/board?${qs}` : "/board");
    },
    [params, router],
  );

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        push((sp) => (search ? sp.set("search", search) : sp.delete("search")));
      }}
    >
      <label className="relative min-w-0 flex-1 basis-56">
        <span className="sr-only">Search posts</span>
        <Icon
          name="search"
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
        />
        <Input
          name="search"
          value={search}
          placeholder="Search title, content or author"
          className="pl-9"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <label className="min-w-0">
        <span className="sr-only">Filter by status</span>
        <select
          value={params.get("status") ?? ""}
          onChange={(e) => push((sp) => (e.target.value ? sp.set("status", e.target.value) : sp.delete("status")))}
          className={cn(
            "h-9 rounded-[var(--radius)] border px-3 text-sm",
            "border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--input-fg)]",
          )}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <Button
        type="button"
        variant={starred ? "default" : "secondary"}
        size="sm"
        className="h-9"
        aria-pressed={starred}
        onClick={() => push((sp) => (starred ? sp.delete("starred") : sp.set("starred", "1")))}
      >
        <Icon name="star" size={14} /> Starred
      </Button>

      <Button type="submit" size="sm" className="h-9">
        Apply
      </Button>
    </form>
  );
}
