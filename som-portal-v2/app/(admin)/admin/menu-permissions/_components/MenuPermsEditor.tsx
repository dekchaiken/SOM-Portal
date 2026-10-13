"use client";

// Linear-style role × menu matrix. Vertical role tabs on the left, the menu
// list on the right, a live diff indicator, and one save action.

import * as React from "react";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { PulseHeader } from "@/ui/PulseHeader";
import type { MenuPermissionsFile } from "@/perms/schemas";

type RoleValue = "*" | string[];

export interface MenuPermsEditorProps {
  config: MenuPermissionsFile;
  knownMenus: readonly string[];
  knownRoles: readonly string[];
  subPages: Readonly<Record<string, string>>;
  team: string;
  /** Pages this admin must keep for themselves — surfaced as a locked row. */
  selfRole: string;
}

function isWildcard(v: RoleValue | undefined): boolean {
  return v === "*";
}

function asList(v: RoleValue | undefined): string[] {
  return Array.isArray(v) ? v : [];
}

export function MenuPermsEditor({
  config,
  knownMenus,
  knownRoles,
  subPages,
  team,
  selfRole,
}: MenuPermsEditorProps) {
  const original = React.useRef(config);
  const [roles, setRoles] = React.useState<Record<string, RoleValue>>(
    () => ({ ...(config.roles as Record<string, RoleValue>) }),
  );
  const [alwaysVisible] = React.useState<string[]>(config.always_visible ?? []);
  const [activeRole, setActiveRole] = React.useState<string>(knownRoles[0] ?? "sm_user");
  const [query, setQuery] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const subPageParents = React.useMemo(() => {
    const byParent: Record<string, string[]> = {};
    for (const [sub, parent] of Object.entries(subPages)) {
      (byParent[parent] ??= []).push(sub);
    }
    return byParent;
  }, [subPages]);

  const diffCount = React.useMemo(() => {
    const before = original.current.roles as Record<string, RoleValue>;
    let n = 0;
    for (const role of new Set([...Object.keys(before), ...Object.keys(roles)])) {
      const a = before[role];
      const b = roles[role];
      if (isWildcard(a) !== isWildcard(b)) {
        n += 1;
        continue;
      }
      if (isWildcard(a)) continue;
      const sa = new Set(asList(a));
      const sb = new Set(asList(b));
      for (const m of new Set([...sa, ...sb])) if (sa.has(m) !== sb.has(m)) n += 1;
    }
    return n;
  }, [roles]);

  const current = roles[activeRole];
  const wildcard = isWildcard(current);
  const allowed = React.useMemo(() => new Set(asList(current)), [current]);

  const filtered = React.useMemo(
    () => knownMenus.filter((m) => m.toLowerCase().includes(query.trim().toLowerCase())),
    [knownMenus, query],
  );

  function toggleMenu(menu: string) {
    setRoles((prev) => {
      const val = prev[activeRole];
      if (isWildcard(val)) {
        // Leaving wildcard: materialise the full list minus the clicked item.
        return { ...prev, [activeRole]: knownMenus.filter((m) => m !== menu) };
      }
      const list = asList(val);
      const next = list.includes(menu) ? list.filter((m) => m !== menu) : [...list, menu];
      return { ...prev, [activeRole]: next };
    });
  }

  function setWildcard(on: boolean) {
    setRoles((prev) => ({ ...prev, [activeRole]: on ? "*" : [...knownMenus] }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/v2/api/v1/menu-permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles, always_visible: alwaysVisible, team }),
      });
      const json = (await res.json()) as
        | { ok: true; data: MenuPermissionsFile }
        | { ok: false; error: string };
      if (!json.ok) {
        setMessage({ kind: "error", text: json.error });
      } else {
        original.current = json.data;
        setMessage({ kind: "ok", text: "Menu permissions saved." });
      }
    } catch {
      setMessage({ kind: "error", text: "Network error while saving." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PulseHeader
        title="Menu Permissions"
        subtitle={`Role × page visibility for team ${team} · data/${team}/menu-permissions.json`}
        actions={
          <>
            <span
              data-testid="diff-indicator"
              className={cn(
                "rounded-[var(--radius-sm)] px-2 py-1 text-xs",
                diffCount > 0 ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
              )}
              style={{ background: "var(--bg-raised)" }}
            >
              {diffCount > 0 ? `${diffCount} unsaved change${diffCount === 1 ? "" : "s"}` : "No changes"}
            </span>
            <Button onClick={save} disabled={saving || diffCount === 0} data-testid="save-menu-perms">
              <Icon name={saving ? "loader" : "check"} size={14} className={saving ? "animate-spin" : ""} />
              Save
            </Button>
          </>
        }
      />

      {message ? (
        <div
          data-testid="save-message"
          className="rounded-[var(--radius-card,10px)] border px-4 py-2.5 text-sm"
          style={{
            background: "var(--bg-card)",
            borderColor: message.kind === "ok" ? "var(--accent)" : "var(--border)",
          }}
        >
          {message.text}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:[grid-template-columns:13rem_minmax(0,1fr)]">
        {/* Vertical role tabs */}
        <nav
          className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card,10px)] border p-2"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          aria-label="Roles"
        >
          {knownRoles.map((role) => {
            const v = roles[role];
            const count = isWildcard(v) ? knownMenus.length : asList(v).length;
            return (
              <button
                key={role}
                type="button"
                onClick={() => setActiveRole(role)}
                data-testid={`role-tab-${role}`}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm",
                  "font-[inherit] hover:bg-[var(--bg-raised)]",
                  activeRole === role && "bg-[var(--bg-raised)] font-medium",
                )}
              >
                <span className="truncate">{role}</span>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  {isWildcard(v) ? "all" : count}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Menu matrix for the active role */}
        <section
          className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card,10px)] border p-4"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wildcard}
                onChange={(e) => setWildcard(e.target.checked)}
                data-testid="wildcard-toggle"
              />
              <span>
                Full access <code className="text-xs text-[var(--text-muted)]">&quot;*&quot;</code>
              </span>
            </label>
            <div className="min-w-[12rem] flex-1">
              <Input
                placeholder="Filter pages…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter pages"
              />
            </div>
          </div>

          {wildcard ? (
            <p className="text-sm text-[var(--text-muted)]">
              <strong>{activeRole}</strong> sees every page. Uncheck &quot;Full access&quot; to pick
              pages individually.
            </p>
          ) : null}

          <ul className="grid gap-1 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
            {filtered.map((menu) => {
              const on = wildcard || allowed.has(menu);
              const always = alwaysVisible.includes(menu);
              const children = subPageParents[menu] ?? [];
              return (
                <li key={menu}>
                  <label
                    className={cn(
                      "flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm",
                      "hover:bg-[var(--bg-raised)]",
                      wildcard && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={wildcard}
                      onChange={() => toggleMenu(menu)}
                      data-testid={`menu-${activeRole}-${menu}`}
                    />
                    <Icon
                      name={on ? "check-circle" : "circle-dot"}
                      size={14}
                      className={on ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}
                    />
                    <span className="truncate">{menu}</span>
                    {always ? (
                      <span className="ml-auto shrink-0 text-[10px] uppercase text-[var(--text-muted)]">
                        always
                      </span>
                    ) : null}
                    {children.length > 0 ? (
                      <span
                        className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]"
                        title={`Also unlocks: ${children.join(", ")}`}
                      >
                        +{children.length}
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>

          {selfRole === activeRole ? (
            <p className="text-xs text-[var(--text-muted)]">
              You are editing your own role ({selfRole}). The server refuses any save that would
              remove your access to the admin surface.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
