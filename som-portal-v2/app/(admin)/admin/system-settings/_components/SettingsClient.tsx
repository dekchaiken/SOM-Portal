"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import type { Result } from "@/lib/result";
import {
  Field,
  ToastStack,
  Toggle,
  useToasts,
} from "../../users/_components/bits";

const API = "/v2/api/v1/system-settings";

type Settings = Record<string, unknown>;

interface Group {
  title: string;
  description: string;
  icon: "shield" | "gauge" | "settings" | "bell";
  fields: {
    key: string;
    label: string;
    kind: "string" | "int" | "bool" | "urls";
    hint?: string;
    unit?: string;
  }[];
}

const GROUPS: Group[] = [
  {
    title: "Identity",
    description: "What the portal calls itself on the login screen and in emails.",
    icon: "settings",
    fields: [
      { key: "site_name", label: "Site name", kind: "string" },
      { key: "site_tagline", label: "Tagline", kind: "string" },
      {
        key: "enable_markdown",
        label: "Enable markdown in posts",
        kind: "bool",
        hint: "Applies to board posts and comments",
      },
    ],
  },
  {
    title: "Sessions & passwords",
    description: "Platform-wide session policy. Changing these signs users out sooner.",
    icon: "shield",
    fields: [
      { key: "session_timeout_hours", label: "Session timeout", kind: "int", unit: "hours" },
      { key: "remember_me_days", label: "Remember me", kind: "int", unit: "days" },
      { key: "password_expiry_days", label: "Password expiry", kind: "int", unit: "days" },
      { key: "password_history_count", label: "Password history kept", kind: "int", unit: "entries" },
    ],
  },
  {
    title: "Rate limits",
    description: "Login lockout and API throttling, shared by every team.",
    icon: "gauge",
    fields: [
      { key: "max_login_attempts", label: "Max login attempts", kind: "int", unit: "tries" },
      { key: "lockout_minutes", label: "Lockout duration", kind: "int", unit: "minutes" },
      { key: "api_rate_limit_requests", label: "API requests allowed", kind: "int", unit: "requests" },
      {
        key: "api_rate_limit_window_seconds",
        label: "API window",
        kind: "int",
        unit: "seconds",
      },
      { key: "trash_retention_days", label: "Trash retention", kind: "int", unit: "days" },
    ],
  },
  {
    title: "Notifications",
    description: "Google Chat webhooks. Only chat.googleapis.com URLs are accepted.",
    icon: "bell",
    fields: [
      { key: "email_noti_chat_webhooks", label: "Broadcast webhooks", kind: "urls" },
      { key: "exam_reminder_chat_webhooks", label: "Exam reminder webhooks", kind: "urls" },
    ],
  },
];

async function patchSettings(patch: Settings): Promise<Settings> {
  const res = await fetch(API, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = (await res.json().catch(() => null)) as Result<{
    settings: Settings;
    changed: string[];
  }> | null;
  if (!body) throw new Error(`Request failed (${res.status})`);
  if (!body.ok) throw new Error(body.error);
  return body.data.settings;
}

export function SettingsClient({
  initial,
  lockedKeys,
  ranges,
  isSuperAdmin,
}: {
  initial: Settings;
  lockedKeys: string[];
  ranges: Record<string, [number, number]>;
  isSuperAdmin: boolean;
}) {
  const [values, setValues] = React.useState<Settings>(initial);
  const [saved, setSaved] = React.useState<Settings>(initial);
  const [saving, setSaving] = React.useState(false);
  const { toasts, push, dismiss } = useToasts();
  const locked = React.useCallback((k: string) => lockedKeys.includes(k), [lockedKeys]);

  const dirtyKeys = React.useMemo(
    () =>
      Object.keys(values).filter(
        (k) => JSON.stringify(values[k]) !== JSON.stringify(saved[k]),
      ),
    [values, saved],
  );

  const flush = React.useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      setSaving(true);
      try {
        const patch: Settings = {};
        for (const k of keys) patch[k] = values[k];
        const next = await patchSettings(patch);
        setValues(next);
        setSaved(next);
        push("success", `Saved ${keys.join(", ")}`);
      } catch (e) {
        push("error", (e as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [values, push],
  );

  // Debounced inline save — 900 ms after the last keystroke.
  React.useEffect(() => {
    if (dirtyKeys.length === 0) return;
    const t = setTimeout(() => void flush(dirtyKeys), 900);
    return () => clearTimeout(t);
    // `flush` closes over `values`; dirtyKeys identity changes with it.
  }, [dirtyKeys, flush]);

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  function stepper(key: string, delta: number) {
    const [lo, hi] = ranges[key] ?? [1, 100000];
    const cur = Number(values[key] ?? lo);
    const next = Math.min(hi, Math.max(lo, cur + delta));
    set(key, next);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Administration
          </p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-[var(--text-strong)]">
            System Settings
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Platform-wide — one copy shared by every team.
            {isSuperAdmin ? "" : " Security policy fields are super_admin only."}
          </p>
        </div>
        <div
          className="flex items-center gap-2 text-xs"
          data-testid="save-state"
          style={{ color: "var(--text-muted)" }}
        >
          {saving ? (
            <>
              <Icon name="loader" size={13} className="animate-spin" /> Saving…
            </>
          ) : dirtyKeys.length > 0 ? (
            <>
              <Icon name="clock" size={13} /> Unsaved: {dirtyKeys.length}
            </>
          ) : (
            <>
              <Icon name="check-circle" size={13} style={{ color: "var(--state-success)" }} />
              All changes saved
            </>
          )}
        </div>
      </header>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))]">
        {GROUPS.map((g) => (
          <section
            key={g.title}
            className="flex flex-col gap-3 rounded-[var(--radius-lg)] border p-4"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          >
            <header className="flex items-start gap-2.5">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)]"
                style={{ background: "var(--bg-raised)", color: "var(--accent)" }}
              >
                <Icon name={g.icon} size={15} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--text-strong)]">{g.title}</h2>
                <p className="text-xs text-[var(--text-muted)]">{g.description}</p>
              </div>
            </header>

            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]">
              {g.fields.map((f) => {
                const isLocked = locked(f.key);
                if (f.kind === "bool") {
                  return (
                    <div key={f.key} className="col-span-full pt-1">
                      <Toggle
                        label={f.label}
                        checked={Boolean(values[f.key])}
                        disabled={isLocked}
                        onChange={(v) => set(f.key, v)}
                      />
                      {f.hint ? (
                        <p className="mt-1 text-[11px] text-[var(--text-subtle)]">{f.hint}</p>
                      ) : null}
                    </div>
                  );
                }
                if (f.kind === "urls") {
                  const list = Array.isArray(values[f.key])
                    ? (values[f.key] as string[])
                    : [];
                  return (
                    <Field
                      key={f.key}
                      label={f.label}
                      hint={`${list.length} configured · one URL per line`}
                      className="col-span-full"
                    >
                      <textarea
                        value={list.join("\n")}
                        disabled={isLocked}
                        onChange={(e) =>
                          set(
                            f.key,
                            e.target.value
                              .split("\n")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          )
                        }
                        rows={3}
                        spellCheck={false}
                        className="w-full rounded-[var(--radius)] border bg-[var(--input-bg)] p-2 font-mono text-[11px] text-[var(--input-fg)]"
                        style={{ borderColor: "var(--input-border)", fontFamily: "var(--font-mono)" }}
                      />
                    </Field>
                  );
                }
                if (f.kind === "int") {
                  const [lo, hi] = ranges[f.key] ?? [1, 100000];
                  return (
                    <Field
                      key={f.key}
                      label={f.label}
                      hint={isLocked ? "super_admin only" : `${lo}–${hi} ${f.unit ?? ""}`}
                    >
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label={`Decrease ${f.label}`}
                          disabled={isLocked}
                          onClick={() => stepper(f.key, -1)}
                          className="h-9 w-8"
                        >
                          <Icon name="chevron-down" size={14} />
                        </Button>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={lo}
                          max={hi}
                          disabled={isLocked}
                          value={String(values[f.key] ?? "")}
                          onChange={(e) => set(f.key, Number(e.target.value))}
                          className="text-center"
                          data-testid={`setting-${f.key}`}
                        />
                        <Button
                          variant="secondary"
                          size="icon"
                          aria-label={`Increase ${f.label}`}
                          disabled={isLocked}
                          onClick={() => stepper(f.key, 1)}
                          className="h-9 w-8"
                        >
                          <Icon name="chevron-up" size={14} />
                        </Button>
                      </div>
                    </Field>
                  );
                }
                return (
                  <Field
                    key={f.key}
                    label={f.label}
                    hint={isLocked ? "super_admin only" : f.hint}
                    className="col-span-full"
                  >
                    <Input
                      value={String(values[f.key] ?? "")}
                      disabled={isLocked}
                      onChange={(e) => set(f.key, e.target.value)}
                      data-testid={`setting-${f.key}`}
                    />
                  </Field>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
