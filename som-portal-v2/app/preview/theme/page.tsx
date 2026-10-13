// som-portal-v2/app/preview/theme/page.tsx
"use client";

import * as React from "react";
import { useTheme, ALL_THEMES, type ThemeName, type ModeName } from "@/theme";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Badge } from "@/ui/shadcn/badge";
import { Alert, AlertDescription, AlertTitle } from "@/ui/shadcn/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card";
import { KpiCard } from "@/ui/KpiCard";
import { StatusChip } from "@/ui/StatusChip";
import { PulseHeader } from "@/ui/PulseHeader";
import {
  SkeletonKpiRow,
  SkeletonTable,
  SkeletonForm,
  SkeletonChart,
} from "@/ui/Skeleton";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";

/**
 * /preview/theme — visual check target.
 *
 * Hosts every primitive the design system needs to prove, with a live
 * toolbar for theme × mode × GenZ. Playwright screenshots this route
 * once per theme × mode (see playwright/theme-preview.spec.ts).
 */

const TOKEN_SWATCHES: { name: string; variable: string }[] = [
  { name: "bg-page", variable: "--bg-page" },
  { name: "bg-canvas", variable: "--bg-canvas" },
  { name: "bg-card", variable: "--bg-card" },
  { name: "bg-raised", variable: "--bg-raised" },
  { name: "bg-input", variable: "--bg-input" },
  { name: "text", variable: "--text" },
  { name: "text-muted", variable: "--text-muted" },
  { name: "border", variable: "--border" },
  { name: "border-strong", variable: "--border-strong" },
  { name: "accent", variable: "--accent" },
  { name: "accent-subtle", variable: "--accent-subtle" },
  { name: "success", variable: "--state-success" },
  { name: "warning", variable: "--state-warning" },
  { name: "danger", variable: "--state-danger" },
  { name: "info", variable: "--state-info" },
];

export default function ThemePreviewPage() {
  const { theme, mode, isGenz, setTheme, setMode } = useTheme();
  // Local genz override purely for the preview toolbar; the real flag lives on
  // the user record. We flip the body attribute directly so the overlay layer
  // tints without touching persisted prefs.
  const [previewGenz, setPreviewGenz] = React.useState(isGenz);
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (previewGenz) document.body.setAttribute("data-user-genz", "true");
    else if (!isGenz) document.body.removeAttribute("data-user-genz");
  }, [previewGenz, isGenz]);

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-6 p-6">
      <Toolbar
        theme={theme}
        mode={mode}
        isGenz={previewGenz}
        onTheme={setTheme}
        onMode={setMode}
        onGenz={setPreviewGenz}
      />

      <Section title="Primitive & semantic swatches" muted="Token-swatch grid">
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))]">
          {TOKEN_SWATCHES.map((s) => (
            <Swatch key={s.variable} name={s.name} variable={s.variable} />
          ))}
        </div>
      </Section>

      <Section title="Typography" muted="Inter display → body → micro · mono">
        <div
          className="surface-card flex flex-col gap-2 p-5"
        >
          <div className="text-4xl font-semibold tracking-tight">Display · 36px / 600</div>
          <div className="text-2xl font-semibold">Heading 1 · 24px / 600</div>
          <div className="text-xl font-semibold">Heading 2 · 20px / 600</div>
          <div className="text-base font-semibold">Heading 3 · 16px / 600</div>
          <div className="text-sm">
            Body · 14px / 400. The quick brown fox jumps over the lazy dog.
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Micro · 12px / 400 · muted
          </div>
          <code className="rounded-[var(--radius-sm)] bg-[var(--bg-raised)] p-2 font-mono text-[13px]">
            JetBrains Mono · const latency = p99 as number;
          </code>
        </div>
      </Section>

      <Section title="Buttons" muted="Primary · Secondary · Ghost · Outline · Destructive · Icon">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Settings">
            <Icon name="settings" size={16} />
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Status chips" muted="One color, one meaning">
        <div className="flex flex-wrap gap-2">
          {(["open", "in_progress", "resolved", "pending", "success", "warning", "danger", "unknown"] as const).map(
            (s) => (
              <StatusChip key={s} status={s} />
            ),
          )}
          <Badge variant="info">Info badge</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
        </div>
      </Section>

      <Section title="KPI cards" muted="Service-performance pattern">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
          <KpiCard label="Throughput" value="12.4k" unit="rps" icon="activity" tone="success" deltaPct={4.2} />
          <KpiCard label="Error rate" value="0.42" unit="%" icon="alert-triangle" tone="warning" deltaPct={-1.1} />
          <KpiCard label="p99 latency" value="187" unit="ms" icon="gauge" deltaPct={0.0} />
          <KpiCard label="Open incidents" value="3" icon="life-buoy" tone="danger" deltaPct={50} />
        </div>
      </Section>

      <Section title="Pulse header" muted="service-performance.html port">
        <PulseHeader
          title="wallet-api · prod"
          subtitle="Thanos aggregates · last 15 minutes"
          live
          actions={
            <>
              <Button size="sm" variant="secondary">
                <Icon name="refresh" size={14} /> Refresh
              </Button>
              <Button size="sm">
                <Icon name="external-link" size={14} /> Grafana
              </Button>
            </>
          }
        />
      </Section>

      <Section title="Alerts" muted="default · destructive · warning · success">
        <div className="flex flex-col gap-2">
          <Alert>
            <Icon name="info" size={16} />
            <div>
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>Scheduled MA window Thursday 02:00.</AlertDescription>
            </div>
          </Alert>
          <Alert variant="destructive">
            <Icon name="alert-circle" size={16} />
            <div>
              <AlertTitle>Deploy failed</AlertTitle>
              <AlertDescription>wallet-api v2.14.1 rolled back.</AlertDescription>
            </div>
          </Alert>
          <Alert variant="warning">
            <Icon name="alert-triangle" size={16} />
            <div>
              <AlertTitle>SLA at risk</AlertTitle>
              <AlertDescription>payment-gateway p99 trending up.</AlertDescription>
            </div>
          </Alert>
          <Alert variant="success">
            <Icon name="check-circle" size={16} />
            <div>
              <AlertTitle>Mitigated</AlertTitle>
              <AlertDescription>user-service restart loop resolved.</AlertDescription>
            </div>
          </Alert>
        </div>
      </Section>

      <Section title="Inputs" muted="Keyboard focus visible">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Default</span>
            <Input placeholder="service name" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Disabled</span>
            <Input placeholder="disabled" disabled defaultValue="read-only" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Required</span>
            <Input placeholder="required" required />
          </label>
        </div>
      </Section>

      <Section title="Cards" muted="surface-card helper">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Default card</CardTitle>
              <CardDescription>Surface uses theme-aware tokens.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                Elevation is subtle on light, border-first on dark.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Metric</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-semibold" data-numeric>
                  187
                </span>
                <span className="text-sm text-[var(--text-muted)]">ms</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Skeletons" muted="10 shapes, 4 shown">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
          <SkeletonKpiRow />
          <SkeletonForm fields={3} />
          <SkeletonTable rows={4} />
          <SkeletonChart height={160} />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  muted,
  children,
}: {
  title: string;
  muted?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {title}
        </h2>
        {muted ? (
          <span className="text-xs text-[var(--text-subtle)]">{muted}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, variable }: { name: string; variable: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-[var(--radius)] border p-2"
      style={{ borderColor: "var(--border)" }}
    >
      <span
        className="inline-block h-8 w-8 shrink-0 rounded-[var(--radius-sm)] border"
        style={{
          background: `var(${variable})`,
          borderColor: "var(--border)",
        }}
      />
      <div className="flex min-w-0 flex-col text-xs">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
          {variable}
        </span>
      </div>
    </div>
  );
}

function Toolbar({
  theme,
  mode,
  isGenz,
  onTheme,
  onMode,
  onGenz,
}: {
  theme: ThemeName;
  mode: ModeName;
  isGenz: boolean;
  onTheme: (t: ThemeName) => void;
  onMode: (m: ModeName) => void;
  onGenz: (v: boolean) => void;
}) {
  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border p-2 backdrop-blur"
      style={{
        background: "color-mix(in oklab, var(--bg-canvas) 85%, transparent)",
        borderColor: "var(--border)",
      }}
      data-testid="preview-toolbar"
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Preview
      </span>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Theme">
        {ALL_THEMES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === theme}
            onClick={() => onTheme(t)}
            data-testid={`theme-${t}`}
            className={cn(
              "rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs capitalize",
              t === theme
                ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-raised)]",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Mode">
        {(["light", "dark"] as const).map((m) => {
          const forced = theme === "console" && m === "light";
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              aria-disabled={forced}
              onClick={() => !forced && onMode(m)}
              data-testid={`mode-${m}`}
              className={cn(
                "rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs capitalize",
                m === mode
                  ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-raised)]",
                forced && "cursor-not-allowed opacity-50",
              )}
            >
              {m}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={isGenz}
          onChange={(e) => onGenz(e.target.checked)}
          data-testid="toggle-genz"
        />
        GenZ overlay
      </label>
    </div>
  );
}
