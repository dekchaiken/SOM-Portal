"use client";
// Template library browser — search + category filter + card grid.
// Cards: icon · name · 2-line summary · "Last used N days ago" (per A2 brief).
import * as React from "react";
import { Icon } from "@/icons";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Button } from "@/ui/shadcn/button";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { Toasts, useToasts } from "./Toasts";
import type { FieldDef, FieldOptionMap, TemplateRow } from "./types";

const ALL = "__all__";

function relativeDays(iso?: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "Last used today";
  if (days === 1) return "Last used yesterday";
  return `Last used ${days} days ago`;
}

export function TemplateBrowser({
  templates,
  categories,
  fieldDefs,
  fieldOptions,
  canManage,
  canCreateIssue,
  warnings,
  team,
}: {
  templates: TemplateRow[];
  categories: { id: string; name: string }[];
  issueTypes: { id: string; name: string }[];
  fieldDefs: FieldDef[];
  fieldOptions: FieldOptionMap;
  canManage: boolean;
  canCreateIssue: boolean;
  warnings: string[];
  team: string;
}) {
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState(ALL);
  const [active, setActive] = React.useState<TemplateRow | null>(null);
  const { items, push, dismiss } = useToasts();

  const catNames = React.useMemo(() => {
    const fromCfg = categories.map((c) => c.name);
    const fromRows = Array.from(new Set(templates.map((t) => t.category).filter(Boolean)));
    return Array.from(new Set([...fromCfg, ...fromRows]));
  }, [categories, templates]);

  const shown = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return templates.filter((t) => {
      if (cat !== ALL && t.category !== cat) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.summary.toLowerCase().includes(needle) ||
        String(t.fields["issuetype"] ?? "").toLowerCase().includes(needle)
      );
    });
  }, [templates, q, cat]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, TemplateRow[]>();
    for (const t of shown) {
      const key = t.category || "Uncategorised";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [shown]);

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-[240px]">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search templates…"
            data-testid="template-search"
            className="w-full rounded-[var(--radius-sm)] border bg-[var(--bg-card)] py-2 pl-9 pr-3 text-[13px]"
            style={{ borderColor: "var(--border)", fontFamily: "inherit" }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[ALL, ...catNames].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              data-testid={`cat-${c}`}
              className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                fontFamily: "inherit",
                borderColor: cat === c ? "var(--accent)" : "var(--border)",
                background:
                  cat === c ? "color-mix(in oklab, var(--accent) 12%, transparent)" : "var(--bg-card)",
                color: cat === c ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {c === ALL ? `All (${templates.length})` : c}
            </button>
          ))}
        </div>
        {!canCreateIssue ? (
          <span className="rounded-full border px-2.5 py-1 text-[11px] text-[var(--text-muted)]" style={{ borderColor: "var(--border)" }}>
            View-only share · team {team}
          </span>
        ) : null}
      </div>

      {warnings.length && canManage ? (
        <div
          className="rounded-[var(--radius-md,8px)] border p-3 text-xs"
          style={{
            borderColor: "var(--state-warning, var(--border))",
            background: "color-mix(in oklab, var(--state-warning, orange) 8%, transparent)",
          }}
          data-testid="drift-warnings"
        >
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <Icon name="alert-triangle" size={13} /> {warnings.length} template field(s) not in the
            Jira field catalog
          </p>
          <ul className="list-inside list-disc text-[var(--text-muted)]">
            {warnings.slice(0, 5).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Cards grouped by category */}
      {grouped.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Icon name="file" size={26} className="text-[var(--text-subtle)]" />
            <p className="text-sm font-medium">No templates match your filter</p>
            <p className="text-xs text-[var(--text-muted)]">
              Try clearing the search or picking another category.
            </p>
          </CardContent>
        </Card>
      ) : (
        grouped.map(([category, rows]) => (
          <section key={category} className="flex flex-col gap-2.5">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {category}
              <span className="rounded-full px-1.5 text-[10px]" style={{ background: "var(--bg-raised)" }}>
                {rows.length}
              </span>
            </h2>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
              {rows.map((t) => {
                const used = relativeDays(t.last_used_at);
                return (
                  <article
                    key={t.id}
                    data-testid="template-card"
                    className="group flex min-w-0 flex-col gap-2.5 rounded-[var(--radius-card,10px)] border p-4 transition-colors hover:border-[var(--accent)]"
                    style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white"
                        style={{
                          background:
                            "linear-gradient(135deg, oklch(0.72 0.18 42), oklch(0.6 0.19 38))",
                        }}
                      >
                        <Icon name="file" size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[13px] font-semibold text-[var(--text-strong)]">
                          {t.name || t.summary}
                        </h3>
                        <p className="text-[11px] text-[var(--text-subtle)]">
                          {String(t.fields["issuetype"] ?? "Task")}
                        </p>
                      </div>
                    </div>
                    <p className="line-clamp-2 min-h-[2.4em] text-xs leading-[1.2rem] text-[var(--text-muted)]">
                      {t.summary}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <span className="truncate text-[11px] text-[var(--text-subtle)]">
                        {used ?? "Never used"}
                      </span>
                      <Button
                        size="sm"
                        variant={canCreateIssue ? "default" : "secondary"}
                        disabled={!canCreateIssue}
                        onClick={() => setActive(t)}
                        data-testid={`use-${t.id}`}
                      >
                        <Icon name="plus" size={13} /> Create
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}

      {active ? (
        <CreateIssueDialog
          template={active}
          fieldDefs={fieldDefs}
          fieldOptions={fieldOptions}
          onClose={() => setActive(null)}
          onCreated={(issue) => {
            setActive(null);
            push({
              tone: "success",
              text: `Issue ${issue.issue_key} created`,
              href: issue.issue_url,
            });
          }}
          onError={(msg) => push({ tone: "error", text: msg })}
        />
      ) : null}

      <Toasts items={items} onDismiss={dismiss} />
    </>
  );
}
