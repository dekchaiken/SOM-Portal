"use client";

// som-portal-v2/app/(admin)/admin/nav-groups/_components/NavGroupsEditor.tsx
//
// CRUD surface for the per-team nav groups file.
//
//   data/<team>/nav-groups.json  —  { groups: [{ id, label, icon, items[] }], ... }
//
// Mirrors v1 assets/js/nav-groups.js: add/remove groups, rename label/icon,
// drag-free "move up/down", add/remove items from a free-text slug input backed
// by the known-menus catalog.

import * as React from "react";
import { Icon, type IconName } from "@/icons";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import type { NavGroupsFile } from "@/perms/schemas";

interface GroupRow {
  id: string;
  label: string;
  icon: string;
  items: string[];
}

export interface NavGroupsEditorProps {
  initial: NavGroupsFile;
  knownMenus: readonly string[];
  team: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function NavGroupsEditor({ initial, knownMenus, team }: NavGroupsEditorProps) {
  const original = React.useRef<GroupRow[]>(initial.groups.map(normalise));
  const [groups, setGroups] = React.useState<GroupRow[]>(() =>
    initial.groups.map(normalise),
  );
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [newItem, setNewItem] = React.useState("");

  function normalise(g: { id: string; label: string; icon?: string; items?: string[] }): GroupRow {
    return {
      id: g.id,
      label: g.label,
      icon: g.icon ?? "dashboard",
      items: Array.isArray(g.items) ? [...g.items] : [],
    };
  }

  const diffCount = React.useMemo(() => {
    return JSON.stringify(groups) === JSON.stringify(original.current) ? 0 : 1;
  }, [groups]);

  const active = groups[activeIdx];
  const unusedMenus = React.useMemo(() => {
    const assigned = new Set(groups.flatMap((g) => g.items));
    return knownMenus.filter((m) => !assigned.has(m));
  }, [groups, knownMenus]);

  function updateActive(patch: Partial<GroupRow>) {
    setGroups((prev) =>
      prev.map((g, i) => (i === activeIdx ? { ...g, ...patch } : g)),
    );
  }

  function addGroup() {
    const base = { id: `group-${groups.length + 1}`, label: "New group", icon: "layers", items: [] };
    setGroups((prev) => [...prev, base]);
    setActiveIdx(groups.length);
  }

  function removeGroup(idx: number) {
    setGroups((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((cur) => Math.max(0, cur - (idx <= cur ? 1 : 0)));
  }

  function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= groups.length) return;
    setGroups((prev) => {
      const copy = [...prev];
      const [cur, other] = [copy[idx]!, copy[next]!];
      copy[idx] = other;
      copy[next] = cur;
      return copy;
    });
    if (activeIdx === idx) setActiveIdx(next);
    else if (activeIdx === next) setActiveIdx(idx);
  }

  function addItem(raw: string) {
    const id = slug(raw);
    if (!id || !active) return;
    if (active.items.includes(id)) return;
    updateActive({ items: [...active.items, id] });
    setNewItem("");
  }

  function removeItem(id: string) {
    if (!active) return;
    updateActive({ items: active.items.filter((i) => i !== id) });
  }

  function moveItem(id: string, dir: -1 | 1) {
    if (!active) return;
    const idx = active.items.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= active.items.length) return;
    const items = [...active.items];
    const cur = items[idx]!;
    const other = items[next]!;
    items[idx] = other;
    items[next] = cur;
    updateActive({ items });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/v2/api/v1/nav-groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ groups, team }),
      });
      const json = (await res.json()) as { ok: boolean; data?: NavGroupsFile; error?: string };
      if (!json.ok) {
        setMessage({ kind: "error", text: json.error ?? `Failed (${res.status})` });
      } else if (json.data) {
        original.current = json.data.groups.map(normalise);
        setGroups(json.data.groups.map(normalise));
        setMessage({ kind: "ok", text: "Nav groups saved." });
      }
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--text-strong)]">Nav Groups</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Sidebar grouping for team <span className="font-medium text-[var(--text)]">{team}</span>
            {" · "}
            <code className="text-xs">data/{team}/nav-groups.json</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="nav-groups-diff"
            className={cn(
              "rounded-[var(--radius-sm)] px-2 py-1 text-xs",
              diffCount > 0 ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
            )}
            style={{ background: "var(--bg-raised)" }}
          >
            {diffCount > 0 ? "Unsaved changes" : "No changes"}
          </span>
          <Button onClick={save} disabled={saving || diffCount === 0} data-testid="save-nav-groups">
            <Icon name={saving ? "loader" : "check"} size={14} className={saving ? "animate-spin" : ""} />
            Save
          </Button>
        </div>
      </header>

      {message ? (
        <Alert
          variant={message.kind === "error" ? "destructive" : "default"}
          role="alert"
          data-testid="nav-groups-message"
        >
          <Icon name={message.kind === "error" ? "alert-triangle" : "check"} size={15} />
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:[grid-template-columns:16rem_minmax(0,1fr)]">
        {/* LEFT: group list */}
        <nav
          className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card,10px)] border p-2"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          aria-label="Groups"
        >
          {groups.map((g, i) => (
            <div key={`${g.id}-${i}`} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveIdx(i)}
                data-testid={`group-tab-${g.id}`}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-raised)]",
                  activeIdx === i && "bg-[var(--bg-raised)] font-medium",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon name={g.icon as IconName} size={14} />
                  <span className="truncate">{g.label || g.id}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">{g.items.length}</span>
              </button>
              <button
                type="button"
                aria-label="Move up"
                onClick={() => move(i, -1)}
                className="rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
              >
                <Icon name="chevron-up" size={12} />
              </button>
              <button
                type="button"
                aria-label="Move down"
                onClick={() => move(i, 1)}
                className="rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
              >
                <Icon name="chevron-down" size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addGroup}
            data-testid="add-group"
            className="mt-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
          >
            <Icon name="plus" size={14} /> Add group
          </button>
        </nav>

        {/* RIGHT: active group editor */}
        {active ? (
          <section
            className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-card,10px)] border p-4"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                <span>Slug (id)</span>
                <Input
                  value={active.id}
                  onChange={(e) => updateActive({ id: slug(e.target.value) })}
                  data-testid="group-id"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                <span>Label</span>
                <Input
                  value={active.label}
                  onChange={(e) => updateActive({ label: e.target.value.slice(0, 32) })}
                  data-testid="group-label"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                <span>Icon</span>
                <Input
                  value={active.icon}
                  onChange={(e) => updateActive({ icon: slug(e.target.value) })}
                  data-testid="group-icon"
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Input
                list="known-menus-dl"
                placeholder="Add page id (e.g. dashboard)…"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem(newItem);
                  }
                }}
                data-testid="new-item-input"
              />
              <datalist id="known-menus-dl">
                {unusedMenus.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <Button variant="secondary" onClick={() => addItem(newItem)} data-testid="add-item">
                <Icon name="plus" size={13} /> Add
              </Button>
            </div>

            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {active.items.map((id) => {
                const known = knownMenus.includes(id);
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 py-1.5"
                    data-testid={`item-row-${id}`}
                  >
                    <Icon
                      name={known ? "check-circle" : "alert-triangle"}
                      size={13}
                      className={
                        known ? "text-[var(--accent)]" : "text-[color:var(--warn, #d97706)]"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{id}</span>
                    {!known ? (
                      <span className="text-[10px] uppercase text-[var(--text-muted)]">
                        unknown
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Move up"
                      onClick={() => moveItem(id, -1)}
                      className="rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="chevron-up" size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      onClick={() => moveItem(id, 1)}
                      className="rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="chevron-down" size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => removeItem(id)}
                      className="rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
                      data-testid={`remove-${id}`}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                );
              })}
              {active.items.length === 0 ? (
                <li className="py-2 text-sm text-[var(--text-muted)]">No pages yet.</li>
              ) : null}
            </ul>

            <div className="flex justify-end">
              <Button
                variant="ghost"
                onClick={() => removeGroup(activeIdx)}
                data-testid="delete-group"
                className="text-[color:var(--danger, #dc2626)]"
              >
                <Icon name="trash" size={13} /> Delete group
              </Button>
            </div>
          </section>
        ) : (
          <section
            className="rounded-[var(--radius-card,10px)] border p-6 text-sm text-[var(--text-muted)]"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          >
            No group selected. Add one on the left to begin.
          </section>
        )}
      </div>
    </div>
  );
}
