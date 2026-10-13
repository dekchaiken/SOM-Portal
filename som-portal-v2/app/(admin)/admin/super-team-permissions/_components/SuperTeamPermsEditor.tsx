"use client";

// som-portal-v2/app/(admin)/admin/super-team-permissions/_components/SuperTeamPermsEditor.tsx
//
// super_admin matrix: left rail is teams, right pane is the feature catalogue.
// Each feature can be toggled on/off (DEFAULT_FEATURES are locked-on).
// Features that unlock pages let you narrow the grant via feature_pages +
// optional per-page mode (full/read) from PAGE_MODES.
//
// Writes go to `PATCH /v2/api/v1/teams/[id]` which the server double-gates to
// super_admin.

import * as React from "react";
import { Icon, type IconName } from "@/icons";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import { Badge } from "@/ui/shadcn/badge";
import type { TeamRecord } from "@/perms/schemas";
import type {
  FeatureCatalogueEntry,
  PageModeEntry,
} from "@/config/menu-catalog";

type FeaturePages = Record<string, { user_pages?: string[]; admin_pages?: string[] }>;
type PageModes = Record<string, string>;

interface Draft {
  features: string[];
  feature_pages: FeaturePages;
  page_modes: PageModes;
}

export interface SuperTeamPermsEditorProps {
  teams: TeamRecord[];
  defaultFeatures: readonly string[];
  featureCatalogue: Readonly<Record<string, FeatureCatalogueEntry>>;
  pageModes: readonly PageModeEntry[];
}

function asObj<T>(v: unknown): Record<string, T> {
  if (!v || Array.isArray(v) || typeof v !== "object") return {};
  return v as Record<string, T>;
}

function initDraft(t: TeamRecord): Draft {
  return {
    features: Array.isArray(t.features) ? [...t.features] : [],
    feature_pages: asObj<{ user_pages?: string[]; admin_pages?: string[] }>(t.feature_pages),
    page_modes: asObj<string>(t.page_modes),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SuperTeamPermsEditor({
  teams,
  defaultFeatures,
  featureCatalogue,
  pageModes,
}: SuperTeamPermsEditorProps) {
  const [list, setList] = React.useState<TeamRecord[]>(teams);
  const [activeId, setActiveId] = React.useState<string>(teams[0]?.id ?? "");
  const [draft, setDraft] = React.useState<Draft>(() =>
    teams[0] ? initDraft(teams[0]) : { features: [], feature_pages: {}, page_modes: {} },
  );
  const [original, setOriginal] = React.useState<Draft>(() =>
    teams[0] ? initDraft(teams[0]) : { features: [], feature_pages: {}, page_modes: {} },
  );
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [query, setQuery] = React.useState("");

  const active = list.find((t) => t.id === activeId) ?? null;
  const dirty = !sameDraft(draft, original);

  React.useEffect(() => {
    if (!active) return;
    const d = initDraft(active);
    setDraft(d);
    setOriginal(d);
    setMessage(null);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleFeature(key: string, on: boolean) {
    if (defaultFeatures.includes(key)) return; // locked-on
    setDraft((d) => {
      const set = new Set(d.features);
      if (on) set.add(key);
      else set.delete(key);
      const feature_pages = { ...d.feature_pages };
      if (!on) delete feature_pages[key];
      return { ...d, features: [...set], feature_pages };
    });
  }

  function toggleFeaturePage(
    featureKey: string,
    page: string,
    which: "user_pages" | "admin_pages",
    on: boolean,
  ) {
    setDraft((d) => {
      const entry = { ...(d.feature_pages[featureKey] ?? {}) };
      const list = new Set([...(entry[which] ?? [])]);
      if (on) list.add(page);
      else list.delete(page);
      entry[which] = [...list];
      return { ...d, feature_pages: { ...d.feature_pages, [featureKey]: entry } };
    });
  }

  function setPageMode(pageId: string, mode: string) {
    setDraft((d) => {
      const next = { ...d.page_modes };
      if (mode === "full") delete next[pageId];
      else next[pageId] = mode;
      return { ...d, page_modes: next };
    });
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/v2/api/v1/teams/${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          features: draft.features,
          feature_pages: draft.feature_pages,
          page_modes: draft.page_modes,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { team: TeamRecord };
        error?: string;
      };
      if (!json.ok || !json.data) {
        setMessage({ kind: "error", text: json.error ?? `Failed (${res.status})` });
      } else {
        const saved = json.data.team;
        setList((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
        const d = initDraft(saved);
        setOriginal(d);
        setDraft(d);
        setMessage({ kind: "ok", text: `Saved · ${saved.slug}` });
      }
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }

  const filteredTeams = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) => t.slug.toLowerCase().includes(q) || (t.name ?? "").toLowerCase().includes(q),
    );
  }, [list, query]);

  const catalogueKeys = React.useMemo(() => Object.keys(featureCatalogue), [featureCatalogue]);
  const pageModeByFeature = React.useMemo(() => {
    const by: Record<string, PageModeEntry[]> = {};
    for (const pm of pageModes) (by[pm.feature] ??= []).push(pm);
    return by;
  }, [pageModes]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--text-strong)]">Super Team Permissions</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Which team gets which feature, and (for feature-page grants) which pages.
            {" "}
            <code className="text-xs">data/teams.json</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            data-testid="super-perms-diff"
            variant={dirty ? "info" : "neutral"}
          >
            {dirty ? "Unsaved changes" : "No changes"}
          </Badge>
          <Button onClick={save} disabled={!dirty || saving || !active} data-testid="save-super-perms">
            <Icon name={saving ? "loader" : "check"} size={14} className={saving ? "animate-spin" : ""} />
            Save team
          </Button>
        </div>
      </header>

      {message ? (
        <Alert
          variant={message.kind === "error" ? "destructive" : "default"}
          role="alert"
          data-testid="super-perms-message"
        >
          <Icon name={message.kind === "error" ? "alert-triangle" : "check"} size={15} />
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:[grid-template-columns:16rem_minmax(0,1fr)]">
        {/* LEFT: team list */}
        <aside
          className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-card,10px)] border p-2"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          aria-label="Teams"
        >
          <Input
            placeholder="Filter teams…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav className="flex min-w-0 flex-col gap-1">
            {filteredTeams.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                data-testid={`team-tab-${t.slug}`}
                className={cn(
                  "flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-raised)]",
                  activeId === t.id && "bg-[var(--bg-raised)] font-medium",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: t.color ?? "var(--border)" }}
                  />
                  <span className="truncate">{t.name || t.slug}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  {(t.features ?? []).length}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {/* RIGHT: feature matrix */}
        {active ? (
          <section
            className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card,10px)] border p-4"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[var(--text-strong)]">
                  {active.name || active.slug}
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  slug <code>{active.slug}</code> · id <code>{active.id}</code>
                </p>
              </div>
            </div>

            <ul className="flex flex-col gap-2">
              {catalogueKeys.map((fkey) => {
                const meta = featureCatalogue[fkey]!;
                const forced = defaultFeatures.includes(fkey);
                const enabled = forced || draft.features.includes(fkey);
                const grantPlan = draft.feature_pages[fkey] ?? {};
                const modes = pageModeByFeature[fkey] ?? [];
                return (
                  <li
                    key={fkey}
                    data-testid={`feature-row-${fkey}`}
                    className="rounded-[var(--radius-sm)] border p-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={forced}
                          onChange={(e) => toggleFeature(fkey, e.target.checked)}
                          data-testid={`feature-toggle-${fkey}`}
                        />
                        <Icon name={meta.icon as IconName} size={14} />
                        <span className="font-medium">{meta.label}</span>
                        <code className="text-xs text-[var(--text-muted)]">{fkey}</code>
                        {forced ? (
                          <Badge variant="neutral" className="text-[10px]">
                            default
                          </Badge>
                        ) : null}
                      </label>
                    </div>

                    {enabled && (meta.user_pages.length > 0 || meta.admin_pages.length > 0) ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {meta.user_pages.length > 0 ? (
                          <PagesPicker
                            title="User pages"
                            pages={meta.user_pages}
                            selected={grantPlan.user_pages ?? []}
                            onToggle={(p, on) => toggleFeaturePage(fkey, p, "user_pages", on)}
                          />
                        ) : null}
                        {meta.admin_pages.length > 0 ? (
                          <PagesPicker
                            title="Admin pages"
                            pages={meta.admin_pages}
                            selected={grantPlan.admin_pages ?? []}
                            onToggle={(p, on) => toggleFeaturePage(fkey, p, "admin_pages", on)}
                          />
                        ) : null}
                      </div>
                    ) : null}

                    {enabled && modes.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
                        <span className="text-xs text-[var(--text-muted)]">Access mode:</span>
                        {modes.map((pm) => {
                          const current = draft.page_modes[pm.id] ?? "full";
                          return (
                            <label
                              key={pm.id}
                              className="flex items-center gap-1 text-xs"
                              data-testid={`page-mode-${pm.id}`}
                            >
                              <span>{pm.label}</span>
                              <select
                                value={current}
                                onChange={(e) => setPageMode(pm.id, e.target.value)}
                                className="rounded-[var(--radius-sm)] border bg-transparent px-1 py-0.5 text-xs"
                                style={{ borderColor: "var(--border)" }}
                              >
                                <option value="full">full</option>
                                <option value="read">read-only</option>
                              </select>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <section
            className="rounded-[var(--radius-card,10px)] border p-6 text-sm text-[var(--text-muted)]"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          >
            No teams found.
          </section>
        )}
      </div>
    </div>
  );
}

function PagesPicker({
  title,
  pages,
  selected,
  onToggle,
}: {
  title: string;
  pages: readonly string[];
  selected: string[];
  onToggle: (page: string, on: boolean) => void;
}) {
  const sel = new Set(selected);
  const allOn = selected.length === 0; // v1 convention: empty = all pages granted
  return (
    <div
      className="rounded-[var(--radius-sm)] border p-2"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-muted)]">{title}</span>
        {allOn ? (
          <span className="text-[10px] uppercase text-[var(--text-muted)]">all</span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5">
        {pages.map((p) => (
          <li key={p}>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={allOn || sel.has(p)}
                onChange={(e) => onToggle(p, e.target.checked)}
              />
              <span>{p}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
