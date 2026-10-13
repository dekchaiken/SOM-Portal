"use client";
// som-portal-v2/app/(app)/incident-launcher/IncidentLauncherClient.tsx
// 5-Step Incident Wizard — Identify, Investigate, MA Toggle, Notify, Summary.

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Badge } from "@/ui/shadcn/badge";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";
import type {
  IncidentConfig,
  JiraIssueInfo,
  TransitionInfo,
  Channel,
  MaJob,
  BoConfigEntry,
  ImpactSeverity,
} from "@/incident-launcher/types";

const API = "/v2/api/incident-launcher";

// ── Types ─────────────────────────────────────────────────────────────────
interface TimelineEntry {
  step: number;
  label: string;
  detail: string;
  ts: string;
  status: "success" | "error" | "skipped";
}

interface WizardState {
  step: number;
  issueKey: string;
  issue: JiraIssueInfo | null;
  transitions: TransitionInfo[];
  selectedTransition: string;
  transitionFields: Record<string, string>;
  maToggles: Record<string, boolean>;
  selectedChannels: string[];
  notifyMessage: string;
  timeline: TimelineEntry[];
  severity: ImpactSeverity;
}

const STEPS = [
  { num: 1, label: "Identify", icon: "search" as const },
  { num: 2, label: "Investigate", icon: "activity" as const },
  { num: 3, label: "MA Toggle", icon: "settings" as const },
  { num: 4, label: "Notify", icon: "message" as const },
  { num: 5, label: "Summary", icon: "check" as const },
];

// ── API helpers ───────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "API error");
  return json.data as T;
}

// ── Component ─────────────────────────────────────────────────────────────
export function IncidentLauncherClient() {
  const [config, setConfig] = useState<IncidentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [wiz, setWiz] = useState<WizardState>({
    step: 1,
    issueKey: "",
    issue: null,
    transitions: [],
    selectedTransition: "",
    transitionFields: {},
    maToggles: {},
    selectedChannels: [],
    notifyMessage: "",
    timeline: [],
    severity: "low",
  });

  // Load config on mount
  useEffect(() => {
    apiFetch<{ config: IncidentConfig }>("/config")
      .then((d) => setConfig(d.config))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const addTimeline = useCallback(
    (step: number, label: string, detail: string, status: TimelineEntry["status"]) => {
      setWiz((prev) => ({
        ...prev,
        timeline: [
          ...prev.timeline,
          { step, label, detail, ts: new Date().toISOString(), status },
        ],
      }));
    },
    [],
  );

  // ── Step 1: Identify ──────────────────────────────────────────────────
  const lookupIssue = useCallback(async () => {
    if (!wiz.issueKey.match(/^[A-Z]+-\d+$/)) {
      setError("Enter a valid Jira key (e.g. SMC-1234)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await apiFetch<{ issue: JiraIssueInfo }>(`/jira/issue?key=${wiz.issueKey}`);
      setWiz((prev) => ({ ...prev, issue: d.issue }));
      addTimeline(1, "Issue Found", `${d.issue.key}: ${d.issue.summary}`, "success");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [wiz.issueKey, addTimeline]);

  // ── Step 2: Get transitions ───────────────────────────────────────────
  const loadTransitions = useCallback(async () => {
    if (!wiz.issue) return;
    setBusy(true);
    try {
      const d = await apiFetch<{ transitions: TransitionInfo[] }>(
        `/jira/transitions?key=${wiz.issue.key}`,
      );
      setWiz((prev) => ({ ...prev, transitions: d.transitions }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [wiz.issue]);

  useEffect(() => {
    if (wiz.step === 2 && wiz.issue) loadTransitions();
  }, [wiz.step, wiz.issue, loadTransitions]);

  const doTransition = useCallback(async () => {
    if (!wiz.issue || !wiz.selectedTransition) return;
    setBusy(true);
    try {
      await apiFetch("/jira/transition", {
        method: "POST",
        body: JSON.stringify({
          key: wiz.issue.key,
          transition_id: wiz.selectedTransition,
          fields: wiz.transitionFields,
        }),
      });
      const name = wiz.transitions.find((t) => t.id === wiz.selectedTransition)?.name ?? "";
      addTimeline(2, "Transition", `${wiz.issue.key} -> ${name}`, "success");
      // Refresh issue status
      const d = await apiFetch<{ issue: JiraIssueInfo }>(`/jira/issue?key=${wiz.issue.key}`);
      setWiz((prev) => ({ ...prev, issue: d.issue }));
    } catch (e) {
      addTimeline(2, "Transition Failed", (e as Error).message, "error");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [wiz, addTimeline]);

  // ── Step 3: MA Toggle ─────────────────────────────────────────────────
  const toggleBo = useCallback(
    async (entry: BoConfigEntry, newValue: string) => {
      setBusy(true);
      try {
        await apiFetch("/bo/update", {
          method: "POST",
          body: JSON.stringify({
            application: entry.application,
            key: entry.key,
            value: newValue,
            environment: entry.environment,
            profile: entry.profile,
          }),
        });
        setWiz((prev) => ({
          ...prev,
          maToggles: { ...prev.maToggles, [`${entry.application}:${entry.key}`]: true },
        }));
        addTimeline(3, "BO Config Updated", `${entry.application} / ${entry.key}`, "success");
      } catch (e) {
        addTimeline(3, "BO Update Failed", (e as Error).message, "error");
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [addTimeline],
  );

  // ── Step 4: Notify ────────────────────────────────────────────────────
  const sendNotification = useCallback(async () => {
    if (!wiz.notifyMessage.trim()) {
      setError("Enter a notification message");
      return;
    }
    setBusy(true);
    let sent = 0;
    for (const chId of wiz.selectedChannels) {
      try {
        await apiFetch("/notify", {
          method: "POST",
          body: JSON.stringify({
            channel_id: chId,
            message: wiz.notifyMessage,
          }),
        });
        const chName = config?.channels.find((c) => c.id === chId)?.name ?? chId;
        addTimeline(4, "Notified", chName, "success");
        sent++;
      } catch (e) {
        addTimeline(4, "Notify Failed", (e as Error).message, "error");
      }
    }
    if (sent > 0) {
      addTimeline(4, "Notifications Sent", `${sent}/${wiz.selectedChannels.length} channels`, "success");
    }
    setBusy(false);
  }, [wiz.notifyMessage, wiz.selectedChannels, config, addTimeline]);

  // ── Navigation ────────────────────────────────────────────────────────
  const goTo = useCallback((step: number) => {
    setWiz((prev) => ({ ...prev, step: Math.max(1, Math.min(5, step)) }));
    setError("");
  }, []);

  const canAdvance = useCallback(() => {
    switch (wiz.step) {
      case 1:
        return !!wiz.issue;
      case 2:
        return true; // transitions are optional
      case 3:
        return true; // MA toggle is optional
      case 4:
        return true; // notify is optional
      default:
        return false;
    }
  }, [wiz.step, wiz.issue]);

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Icon name="loader" size={20} className="animate-spin text-[var(--text-muted)]" />
          <span className="ml-2 text-sm text-[var(--text-muted)]">Loading config...</span>
        </CardContent>
      </Card>
    );
  }

  if (!config) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Icon name="alert-triangle" size={24} className="text-[var(--state-danger)]" />
          <p className="text-sm">{error || "Failed to load Incident Launcher config."}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      {/* ── Step Indicator ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--card-bg,var(--bg-secondary))] p-3">
        {STEPS.map((s, i) => (
          <button
            key={s.num}
            onClick={() => goTo(s.num)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors",
              wiz.step === s.num
                ? "bg-[var(--accent)] text-white"
                : wiz.step > s.num
                  ? "text-[var(--state-success)]"
                  : "text-[var(--text-muted)]",
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border text-xs">
              {wiz.step > s.num ? (
                <Icon name="check" size={14} />
              ) : (
                s.num
              )}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      {/* ── Error banner ───────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--state-danger)] bg-red-50 px-4 py-2 text-sm text-[var(--state-danger)] dark:bg-red-950/20">
          <Icon name="alert-triangle" size={16} />
          {error}
          <button onClick={() => setError("")} className="ml-auto">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* ── Step Content ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6">
          {wiz.step === 1 && (
            <Step1Identify
              wiz={wiz}
              setWiz={setWiz}
              onLookup={lookupIssue}
              busy={busy}
            />
          )}
          {wiz.step === 2 && (
            <Step2Investigate
              wiz={wiz}
              setWiz={setWiz}
              onTransition={doTransition}
              busy={busy}
            />
          )}
          {wiz.step === 3 && (
            <Step3MaToggle
              config={config}
              wiz={wiz}
              onToggle={toggleBo}
              busy={busy}
            />
          )}
          {wiz.step === 4 && (
            <Step4Notify
              config={config}
              wiz={wiz}
              setWiz={setWiz}
              onSend={sendNotification}
              busy={busy}
            />
          )}
          {wiz.step === 5 && (
            <Step5Summary wiz={wiz} />
          )}
        </CardContent>
      </Card>

      {/* ── Navigation buttons ─────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => goTo(wiz.step - 1)}
          disabled={wiz.step === 1}
        >
          <Icon name="chevron-left" size={16} className="mr-1" />
          Back
        </Button>
        <div className="flex gap-2">
          {wiz.step < 5 && wiz.step > 1 && (
            <Button
              variant="ghost"
              onClick={() => {
                addTimeline(wiz.step, STEPS[wiz.step - 1].label, "Skipped", "skipped");
                goTo(wiz.step + 1);
              }}
            >
              Skip
            </Button>
          )}
          {wiz.step < 5 && (
            <Button
              onClick={() => goTo(wiz.step + 1)}
              disabled={!canAdvance()}
            >
              Next
              <Icon name="chevron-right" size={16} className="ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Step Components
// ═══════════════════════════════════════════════════════════════════════════

function Step1Identify({
  wiz,
  setWiz,
  onLookup,
  busy,
}: {
  wiz: WizardState;
  setWiz: React.Dispatch<React.SetStateAction<WizardState>>;
  onLookup: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 1: Identify Incident</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Enter a Jira issue key to look up the incident details.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="SMC-1234"
          value={wiz.issueKey}
          onChange={(e) =>
            setWiz((prev) => ({ ...prev, issueKey: e.target.value.toUpperCase() }))
          }
          onKeyDown={(e) => e.key === "Enter" && onLookup()}
          className="max-w-xs font-mono"
        />
        <Button onClick={onLookup} disabled={busy || !wiz.issueKey}>
          {busy ? (
            <Icon name="loader" size={16} className="animate-spin" />
          ) : (
            <Icon name="search" size={16} />
          )}
          <span className="ml-1">Lookup</span>
        </Button>
      </div>

      {wiz.issue && (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-[var(--accent)]">
              {wiz.issue.key}
            </span>
            <Badge variant="outline">{wiz.issue.status}</Badge>
            <Badge variant="secondary">{wiz.issue.priority}</Badge>
          </div>
          <p className="text-sm">{wiz.issue.summary}</p>
          {wiz.issue.assignee && (
            <p className="text-xs text-[var(--text-muted)]">
              Assignee: {wiz.issue.assignee}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Step2Investigate({
  wiz,
  setWiz,
  onTransition,
  busy,
}: {
  wiz: WizardState;
  setWiz: React.Dispatch<React.SetStateAction<WizardState>>;
  onTransition: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 2: Investigate</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Transition the issue to a new status (e.g., Investigating).
        </p>
      </div>

      {wiz.issue && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono font-semibold">{wiz.issue.key}</span>
          <Badge variant="outline">{wiz.issue.status}</Badge>
        </div>
      )}

      {wiz.transitions.length === 0 && !busy && (
        <p className="text-sm text-[var(--text-muted)]">No transitions available.</p>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Icon name="loader" size={16} className="animate-spin" />
          Loading transitions...
        </div>
      )}

      {wiz.transitions.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Available transitions:</p>
          <div className="flex flex-wrap gap-2">
            {wiz.transitions.map((t) => (
              <Button
                key={t.id}
                variant={wiz.selectedTransition === t.id ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setWiz((prev) => ({ ...prev, selectedTransition: t.id }))
                }
              >
                {t.name}
              </Button>
            ))}
          </div>

          {/* Dynamic fields for selected transition */}
          {wiz.selectedTransition && (() => {
            const trans = wiz.transitions.find((t) => t.id === wiz.selectedTransition);
            const fields = Object.entries(trans?.fields ?? {});
            if (!fields.length) return null;
            return (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-medium text-[var(--text-muted)]">
                  Transition fields:
                </p>
                {fields.map(([key, f]) => (
                  <div key={key}>
                    <label className="text-xs font-medium">
                      {f.name}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    {f.allowedValues.length > 0 ? (
                      <select
                        className="mt-1 block w-full rounded border px-2 py-1 text-sm bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        value={wiz.transitionFields[key] ?? ""}
                        onChange={(e) =>
                          setWiz((prev) => ({
                            ...prev,
                            transitionFields: { ...prev.transitionFields, [key]: e.target.value },
                          }))
                        }
                      >
                        <option value="">Select...</option>
                        {f.allowedValues.map((av) => (
                          <option key={av.id} value={av.id}>
                            {av.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        className="mt-1"
                        value={wiz.transitionFields[key] ?? ""}
                        onChange={(e) =>
                          setWiz((prev) => ({
                            ...prev,
                            transitionFields: { ...prev.transitionFields, [key]: e.target.value },
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          <Button onClick={onTransition} disabled={busy || !wiz.selectedTransition}>
            {busy ? (
              <Icon name="loader" size={16} className="animate-spin mr-1" />
            ) : (
              <Icon name="play" size={16} className="mr-1" />
            )}
            Execute Transition
          </Button>
        </div>
      )}
    </div>
  );
}

function Step3MaToggle({
  config,
  wiz,
  onToggle,
  busy,
}: {
  config: IncidentConfig;
  wiz: WizardState;
  onToggle: (entry: BoConfigEntry, value: string) => void;
  busy: boolean;
}) {
  const maJobs = config.ma_jobs.filter((j) => j.enabled);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 3: MA Toggle</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Toggle BO config keys for maintenance mode.
        </p>
      </div>

      {maJobs.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          No MA jobs configured. You can skip this step.
        </p>
      )}

      {maJobs.map((job) => (
        <div key={job.id} className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{job.name}</span>
            <Badge variant="secondary">{job.type}</Badge>
          </div>

          {job.bo_configs.length > 0 && (
            <div className="space-y-2">
              {job.bo_configs.map((bc, i) => {
                const toggled = wiz.maToggles[`${bc.application}:${bc.key}`];
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-mono text-xs">{bc.label || bc.key}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {bc.application} / {bc.environment}
                      </p>
                    </div>
                    {bc.editable && (
                      <Button
                        size="sm"
                        variant={toggled ? "default" : "outline"}
                        disabled={busy || toggled}
                        onClick={() => onToggle(bc, "true")}
                      >
                        {toggled ? (
                          <>
                            <Icon name="check" size={14} className="mr-1" />
                            Done
                          </>
                        ) : (
                          "Toggle"
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Step4Notify({
  config,
  wiz,
  setWiz,
  onSend,
  busy,
}: {
  config: IncidentConfig;
  wiz: WizardState;
  setWiz: React.Dispatch<React.SetStateAction<WizardState>>;
  onSend: () => void;
  busy: boolean;
}) {
  const channels = config.channels.filter((c) => c.enabled);

  // Initialize message from first channel template if empty
  useEffect(() => {
    if (!wiz.notifyMessage && channels.length > 0) {
      const tpl = channels[0].template_alert || "";
      const msg = tpl
        .replace(/\{\{key\}\}/g, wiz.issue?.key ?? "")
        .replace(/\{\{summary\}\}/g, wiz.issue?.summary ?? "")
        .replace(/\{\{severity\}\}/g, wiz.severity)
        .replace(/\{\{timestamp\}\}/g, new Date().toLocaleString());
      if (msg) setWiz((prev) => ({ ...prev, notifyMessage: msg }));
    }
  }, [wiz.step]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 4: Notify</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Send notifications to selected channels.
        </p>
      </div>

      {channels.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          No notification channels configured. You can skip this step.
        </p>
      )}

      {/* Channel selector */}
      {channels.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Select channels:</p>
          <div className="flex flex-wrap gap-2">
            {channels.map((ch) => (
              <label
                key={ch.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                  wiz.selectedChannels.includes(ch.id)
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "hover:border-[var(--text-subtle)]",
                )}
              >
                <input
                  type="checkbox"
                  checked={wiz.selectedChannels.includes(ch.id)}
                  onChange={(e) => {
                    setWiz((prev) => ({
                      ...prev,
                      selectedChannels: e.target.checked
                        ? [...prev.selectedChannels, ch.id]
                        : prev.selectedChannels.filter((id) => id !== ch.id),
                    }));
                  }}
                  className="rounded"
                />
                <span>{ch.name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {ch.platform}
                </Badge>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Message input */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Message:</p>
        <textarea
          className="w-full rounded-lg border px-3 py-2 text-sm bg-[var(--bg-primary)] text-[var(--text-primary)] min-h-[100px]"
          value={wiz.notifyMessage}
          onChange={(e) =>
            setWiz((prev) => ({ ...prev, notifyMessage: e.target.value }))
          }
          placeholder="Notification message..."
        />
      </div>

      {/* Preview */}
      {wiz.notifyMessage && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--text-muted)]">Preview:</p>
          <div className="rounded-lg bg-[var(--bg-secondary)] p-3 text-sm whitespace-pre-wrap">
            {wiz.notifyMessage}
          </div>
        </div>
      )}

      <Button
        onClick={onSend}
        disabled={busy || wiz.selectedChannels.length === 0 || !wiz.notifyMessage.trim()}
      >
        {busy ? (
          <Icon name="loader" size={16} className="animate-spin mr-1" />
        ) : (
          <Icon name="message" size={16} className="mr-1" />
        )}
        Send to {wiz.selectedChannels.length} channel(s)
      </Button>
    </div>
  );
}

function Step5Summary({ wiz }: { wiz: WizardState }) {
  const jiraUrl = wiz.issue ? `https://truemoney.atlassian.net/browse/${wiz.issue.key}` : "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 5: Summary</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Review all actions taken during this incident.
        </p>
      </div>

      {/* Issue card */}
      {wiz.issue && (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-[var(--accent)]">
              {wiz.issue.key}
            </span>
            <Badge variant="outline">{wiz.issue.status}</Badge>
          </div>
          <p className="text-sm">{wiz.issue.summary}</p>
          {jiraUrl && (
            <a
              href={jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              <Icon name="external-link" size={12} />
              Open in Jira
            </a>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-1">
        <p className="text-sm font-medium">Activity Timeline:</p>
        {wiz.timeline.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No actions recorded yet.</p>
        )}
        <div className="relative ml-3 border-l-2 border-[var(--border-primary)] pl-4 space-y-3">
          {wiz.timeline.map((entry, i) => (
            <div key={i} className="relative">
              <span
                className={cn(
                  "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-primary)]",
                  entry.status === "success"
                    ? "bg-[var(--state-success)]"
                    : entry.status === "error"
                      ? "bg-[var(--state-danger)]"
                      : "bg-[var(--text-subtle)]",
                )}
              />
              <div>
                <p className="text-sm font-medium">
                  {entry.label}
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    Step {entry.step}
                  </span>
                </p>
                <p className="text-xs text-[var(--text-muted)]">{entry.detail}</p>
                <p className="text-[10px] text-[var(--text-subtle)]">
                  {new Date(entry.ts).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
