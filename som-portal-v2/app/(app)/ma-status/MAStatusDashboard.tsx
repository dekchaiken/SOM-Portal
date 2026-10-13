"use client";

// som-portal-v2/app/(app)/ma-status/MAStatusDashboard.tsx
// MA Status Board (v1 ma-status.html): hero, KPIs, source tabs, search and filters,
// then sections for Critical, NANO Products, TMN Jenkins Jobs, Feature Toggles,
// Admin Portal (matched) and Discovered (not yet in the registry).
import * as React from "react";
import { Icon } from "@/icons";

interface Item { name: string; label: string; type: string; status: string; updated_at: string; updated_by: string; category: string; critical?: boolean; link?: string }
interface Service { id: number; service_name: string; service_type: string; tool_type: string; status: string; source?: string | null; matched: boolean; updated_at?: string | null; link?: string | null }
interface Source { ok: boolean; fetched_at: number; items: Item[]; error?: string }
interface Summary { total: number; open: number; closed: number; unknown: number; matched: number; per_source: Record<string, { ok: boolean; count: number; error?: string | null }> }
interface StatusData {
  ts: number;
  summary: Summary | null;
  sources: Record<string, Source>;
  services: Service[];
  unmapped_backoffice: Item[];
}

type Tab = "all" | "nano" | "jenkins" | "features" | "admin";
type Filter = "all" | "open" | "closed" | "unknown" | "critical";

const TABS: { key: Tab; label: string; type?: string }[] = [
  { key: "all", label: "All" },
  { key: "nano", label: "NANO Products", type: "nano" },
  { key: "jenkins", label: "TMN Jenkins", type: "tmn_jenkins" },
  { key: "features", label: "Feature Toggles", type: "features" },
  { key: "admin", label: "Admin Portal", type: "tmn_backoffice" },
];

function sourceMatches(type: string, want?: string): boolean {
  if (!want) return true;
  if (want === "features") return type.includes("feature");
  return type === want;
}

function when(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

function StatusChip({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = s === "open" ? "text-[var(--state-danger)] bg-[oklch(from_var(--state-danger)_l_c_h_/_0.12)]" : s === "closed" ? "text-[var(--state-success)] bg-[oklch(from_var(--state-success)_l_c_h_/_0.12)]" : "text-[var(--state-warning)] bg-[oklch(from_var(--state-warning)_l_c_h_/_0.12)]";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{s === "open" ? "Maintenance" : s === "closed" ? "Operational" : "Unknown"}</span>;
}

function ItemCard({ name, label, status, updated, by, link, critical }: { name: string; label: string; status: string; updated: string; by?: string; link?: string; critical?: boolean }) {
  return (
    <div className="glass flex flex-col gap-3 rounded-[var(--radius-card)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text-strong)]">{label || name}</div>
          <div className="truncate font-mono text-[11px] text-[var(--text-subtle)]">{name}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {critical ? <span className="rounded-full bg-[oklch(from_var(--state-warning)_l_c_h_/_0.15)] px-2 py-0.5 text-[10px] font-bold text-[var(--state-warning)]">CRIT</span> : null}
          <StatusChip status={status} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span className="truncate">{updated}{by ? ` · ${by}` : ""}</span>
        {link ? <a href={link} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--accent)]">open ↗</a> : null}
      </div>
    </div>
  );
}

function Section({ title, count, meta, children, empty }: { title: string; count: number; meta?: string; children: React.ReactNode; empty: string }) {
  return (
    <section className="glass flex flex-col gap-4 rounded-[var(--radius-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
          {title}
          <span className="rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-xs tabular-nums">{count}</span>
        </h2>
        {meta ? <span className="text-xs text-[var(--text-subtle)]">{meta}</span> : null}
      </div>
      {count === 0 ? <p className="py-6 text-center text-sm text-[var(--text-muted)]">{empty}</p> : <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">{children}</div>}
    </section>
  );
}

export function MAStatusDashboard() {
  const [data, setData] = React.useState<StatusData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>("all");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [q, setQ] = React.useState("");
  const [auto, setAuto] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/v2/api/v1/ma-status", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "Could not load MA status");
      setData(json.data as StatusData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load MA status");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [auto, load]);

  const sources = data?.sources ?? {};
  const allItems = Object.values(sources).flatMap((s) => (s.ok ? s.items : []));
  const services = data?.services ?? [];
  const s = data?.summary;

  const q2 = q.trim().toLowerCase();
  const passText = (...vals: (string | undefined)[]) => !q2 || vals.some((v) => (v ?? "").toLowerCase().includes(q2));
  const passFilter = (status: string, critical?: boolean) =>
    filter === "all" ? true : filter === "critical" ? !!critical : status.toLowerCase() === filter;

  const tabInfo = TABS.find((t) => t.key === tab)!;
  const inTab = (type: string) => tab === "all" || sourceMatches(type, tabInfo.type);

  const itemsFor = (type: string) =>
    allItems.filter((i) => sourceMatches(i.type, type) && inTab(i.type) && passFilter(i.status, i.critical) && passText(i.name, i.label));
  const critical = allItems.filter((i) => i.critical && passFilter(i.status, true) && passText(i.name, i.label));
  const nano = itemsFor("nano");
  const jenkins = itemsFor("tmn_jenkins");
  const features = allItems.filter((i) => i.type.includes("feature") && passFilter(i.status, i.critical) && passText(i.name, i.label));
  const adminMatched = services.filter((sv) => sv.matched && sv.source === "tmn_backoffice" && (tab === "all" || tab === "admin") && passFilter(sv.status) && passText(sv.service_name, sv.tool_type));
  const discovered = (data?.unmapped_backoffice ?? []).filter((i) => (tab === "all" || tab === "admin") && passFilter(i.status) && passText(i.name, i.label));

  const count = (type?: string) => (type ? allItems.filter((i) => sourceMatches(i.type, type)).length : allItems.length);
  const tabCount: Record<Tab, number> = {
    all: count(),
    nano: count("nano"),
    jenkins: count("tmn_jenkins"),
    features: count("features"),
    admin: services.filter((sv) => sv.matched && sv.source === "tmn_backoffice").length,
  };

  const inMaint = s?.open ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className={`glass flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border-l-4 p-5 ${inMaint > 0 ? "border-l-[var(--state-danger)]" : "border-l-[var(--state-success)]"}`}>
        <div className="min-w-0">
          <div className={`text-[11px] font-bold uppercase tracking-[0.14em] ${inMaint > 0 ? "text-[var(--state-danger)]" : "text-[var(--state-success)]"}`}>
            {inMaint > 0 ? `${inMaint} services in maintenance` : "All systems operational"}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">MA Status Board</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {data ? `Last fetched ${when(data.ts)} · auto-refresh ${auto ? "every 30 s" : "off"}` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3.5 text-xs font-medium">
            <Icon name="refresh" size={13} /> Refresh
          </button>
          <button type="button" onClick={() => setAuto((v) => !v)} aria-pressed={auto} className={`inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3.5 text-xs font-medium ${auto ? "bg-[var(--accent)] text-white" : "glass-chip text-[var(--text-muted)]"}`}>
            Auto 30 s
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-[var(--state-danger)]">{error}</p> : null}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        <Kpi label="Operational" value={s?.closed ?? 0} hint="services running normally" tone="success" icon="check" />
        <Kpi label="In maintenance" value={s?.open ?? 0} hint="services need attention" tone="danger" icon="alert-triangle" />
        <Kpi label="Unknown" value={s?.unknown ?? 0} hint="not matched or not fetched" tone="warning" icon="info" />
        <Kpi label="Monitored" value={s?.matched ?? 0} hint={`${s?.matched ?? 0} matched · ${s?.total ?? 0} total`} tone="neutral" icon="activity" />
      </div>

      <div className="glass flex flex-wrap gap-2 rounded-[var(--radius-card)] p-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key} className={`inline-flex h-10 items-center gap-2 rounded-[var(--radius)] px-4 text-sm font-medium transition-colors ${tab === t.key ? "bg-[var(--text-strong)] text-[var(--bg-card)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"}`}>
            {t.label} <span className="tabular-nums text-xs opacity-75">{tabCount[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input aria-label="Search MA status" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…" className="glass-field h-10 w-full rounded-[0.875rem] pl-9 pr-3 text-sm text-[var(--text)]" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "open", "closed", "unknown", "critical"] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize ${filter === f ? "bg-[var(--accent)] text-white" : "glass-chip text-[var(--text-muted)]"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(s?.per_source ?? {}).map(([k, v]) => (
          <span key={k} className={`glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${v.ok ? "text-[var(--text)]" : "text-[var(--state-danger)]"}`} title={v.error ?? undefined}>
            <span className={`h-1.5 w-1.5 rounded-full ${v.ok ? "bg-[var(--state-success)]" : "bg-[var(--state-danger)]"}`} />
            {k}: <b className="tabular-nums">{v.count}</b>{v.ok ? "" : " · failed"}
          </span>
        ))}
      </div>

      {data ? (
        <>
          {critical.length > 0 || tab === "all" ? (
            <Section title="Critical Services" count={critical.length} meta="flagged critical for wallet operation" empty="No critical services right now">
              {critical.map((i) => <ItemCard key={`c-${i.type}-${i.name}`} name={i.name} label={i.label} status={i.status} updated={when(i.updated_at)} by={i.updated_by} link={i.link} critical />)}
            </Section>
          ) : null}
          {tab === "all" || tab === "nano" ? (
            <Section title="NANO Products" count={nano.length} meta={sources.nano ? (sources.nano.ok ? "CDN · public" : `failed: ${sources.nano.error ?? ""}`) : "source not fetched"} empty={sources.nano?.ok === false ? `NANO source failed: ${sources.nano.error ?? "unknown error"}` : "No NANO products match"}>
              {nano.map((i) => <ItemCard key={`n-${i.name}`} name={i.name} label={i.label} status={i.status} updated={when(i.updated_at)} by={i.updated_by} link={i.link} />)}
            </Section>
          ) : null}
          {tab === "all" || tab === "jenkins" ? (
            <Section title="TMN Jenkins Jobs" count={jenkins.length} meta={sources.tmn_jenkins ? (sources.tmn_jenkins.ok ? "Basic auth" : `failed: ${sources.tmn_jenkins.error ?? ""}`) : "source not fetched"} empty={sources.tmn_jenkins?.ok === false ? `Jenkins source failed: ${sources.tmn_jenkins.error ?? "unknown error"}` : "No Jenkins jobs match"}>
              {jenkins.map((i) => <ItemCard key={`j-${i.name}`} name={i.name} label={i.label} status={i.status} updated={when(i.updated_at)} by={i.updated_by} link={i.link} />)}
            </Section>
          ) : null}
          {tab === "all" || tab === "features" ? (
            <Section title="Mobile Gateway Feature Toggles" count={features.length} meta="from Jenkins log" empty="No feature toggles reported">
              {features.map((i) => <ItemCard key={`f-${i.name}`} name={i.name} label={i.label} status={i.status} updated={when(i.updated_at)} by={i.updated_by} link={i.link} />)}
            </Section>
          ) : null}
          {tab === "all" || tab === "admin" ? (
            <Section title="Admin Portal (matched)" count={adminMatched.length} meta="OAuth" empty="No matched Admin Portal services">
              {adminMatched.map((sv) => <ItemCard key={`a-${sv.id}`} name={sv.tool_type} label={sv.service_name} status={sv.status} updated={when(sv.updated_at)} link={sv.link ?? undefined} />)}
            </Section>
          ) : null}
          {tab === "all" || tab === "admin" ? (
            <details className="glass rounded-[var(--radius-card)] p-5">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--text-strong)]">Discovered in Admin Portal ({discovered.length})</summary>
              <p className="mt-2 text-xs text-[var(--text-muted)]">Items the Admin Portal reports but the MA registry does not list yet.</p>
              <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
                {discovered.slice(0, 100).map((i) => <ItemCard key={`d-${i.name}`} name={i.name} label={i.label} status={i.status} updated={i.updated_at} by={i.updated_by} />)}
              </div>
              {discovered.length > 100 ? <p className="mt-3 text-xs text-[var(--text-subtle)]">Showing 100 of {discovered.length}</p> : null}
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint, tone, icon }: { label: string; value: number; hint: string; tone: "success" | "danger" | "warning" | "neutral"; icon: "check" | "alert-triangle" | "info" | "activity" }) {
  const color = tone === "success" ? "var(--state-success)" : tone === "danger" ? "var(--state-danger)" : tone === "warning" ? "var(--state-warning)" : "var(--text-strong)";
  return (
    <div className="glass flex items-center gap-4 rounded-[var(--radius-card)] p-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">{label}</div>
        <div className="text-3xl font-semibold tabular-nums" style={{ color }}>{value}</div>
        <div className="truncate text-xs text-[var(--text-muted)]">{hint}</div>
      </div>
    </div>
  );
}
