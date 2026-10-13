"use client";

// som-portal-v2/app/(app)/learn/exams/[examId]/attempt/[attemptId]/TakePanel.tsx
// Taking screen. Answers autosave (debounced). A heartbeat keeps the server clock
// in step and closes the attempt at time-out. Proctoring events are sent as they happen.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/icons";
import { Chip } from "../../../../_cards";

interface LearnerQuestion {
  id: string;
  type: "single" | "multi" | "truefalse" | "short";
  prompt: string;
  image: string;
  category: string;
  choices: string[];
}

interface View {
  id: string;
  remaining_seconds: number | null;
  questions: LearnerQuestion[];
  answers: Record<string, unknown>;
  violations: { tab_switch: number; blur: number; fullscreen_exit: number; paste: number; copy: number };
  config: { tab_detection: boolean; fullscreen_lock: boolean; disable_copy_paste: boolean };
}

type Value = number | number[] | boolean | string | undefined;

const SAVE_DELAY_MS = 700;
const HEARTBEAT_MS = 20_000;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

function answered(q: LearnerQuestion, v: Value): boolean {
  if (v === undefined) return false;
  if (q.type === "multi") return Array.isArray(v) && v.length > 0;
  if (q.type === "short") return typeof v === "string" && v.trim() !== "";
  return true;
}

export function TakePanel({ examId, initial }: { examId: string; initial: View }) {
  const router = useRouter();
  const base = `/v2/api/v1/learn/exams/attempt/${initial.id}`;
  const [answers, setAnswers] = React.useState<Record<string, Value>>(() => initial.answers as Record<string, Value>);
  const [remaining, setRemaining] = React.useState<number | null>(initial.remaining_seconds);
  const [violations, setViolations] = React.useState(initial.violations);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [fullscreen, setFullscreen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const closedRef = React.useRef(false);
  const latest = React.useRef(answers);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfg = initial.config;

  const close = React.useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    router.refresh();
  }, [router]);

  const save = React.useCallback(async () => {
    setSaving("saving");
    try {
      const data = await call<{ remaining_seconds: number | null; closed: boolean }>(`${base}/answers`, {
        method: "PUT",
        body: JSON.stringify({ answers: latest.current }),
      });
      setSaving("saved");
      if (data.closed) close();
    } catch {
      setSaving("error");
    }
  }, [base, close]);

  const queueSave = React.useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  const post = React.useCallback(
    async (type: string) => {
      try {
        const data = await call<{ violations: View["violations"]; closed: boolean; remaining_seconds: number | null }>(`${base}/events`, {
          method: "POST",
          body: JSON.stringify({ type }),
        });
        setViolations(data.violations);
        if (data.remaining_seconds !== null && !closedRef.current) setRemaining(data.remaining_seconds);
        if (data.closed) close();
        return data;
      } catch {
        return null;
      }
    },
    [base, close],
  );

  const submit = React.useCallback(async () => {
    if (closedRef.current) return;
    setBusy(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await call(`${base}/answers`, { method: "PUT", body: JSON.stringify({ answers: latest.current }) });
      await call(`${base}/submit`, { method: "POST" });
      close();
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Could not submit");
      setBusy(false);
    }
  }, [base, close]);

  // Countdown. Reaching zero submits; the server closes the attempt on its own clock too.
  React.useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      void submit();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining, submit]);

  React.useEffect(() => {
    const t = setInterval(() => void post("heartbeat"), HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [post]);

  React.useEffect(() => {
    if (!cfg.tab_detection) return;
    const onVis = () => {
      if (document.hidden) {
        void post("tab_switch");
        setWarning("Tab switch recorded. Stay on this page during the exam.");
      }
    };
    const onBlur = () => void post("blur");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
    };
  }, [cfg.tab_detection, post]);

  React.useEffect(() => {
    if (!cfg.fullscreen_lock) return;
    const onFs = () => {
      const on = !!document.fullscreenElement;
      setFullscreen(on);
      if (!on) {
        void post("fullscreen_exit");
        setWarning("You left fullscreen. Return to fullscreen to continue.");
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [cfg.fullscreen_lock, post]);

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function setAnswer(qid: string, value: Value) {
    const next = { ...latest.current, [qid]: value };
    latest.current = next;
    setAnswers(next);
    queueSave();
  }

  function onCopyLike(type: "copy" | "paste") {
    return (e: React.ClipboardEvent) => {
      if (!cfg.disable_copy_paste) return;
      e.preventDefault();
      void post(type);
      setWarning(type === "paste" ? "Pasting is turned off for this exam." : "Copying is turned off for this exam.");
    };
  }

  const total = initial.questions.length;
  const done = initial.questions.filter((q) => answered(q, answers[q.id])).length;
  const low = remaining !== null && remaining <= 300;
  const proctored = cfg.tab_detection || cfg.fullscreen_lock;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]" onCopy={onCopyLike("copy")} onCut={onCopyLike("copy")} onPaste={onCopyLike("paste")} onContextMenu={(e) => cfg.disable_copy_paste && e.preventDefault()}>
      <div className="flex min-w-0 flex-col gap-4">
        {warning ? (
          <div role="alert" className="glass flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--state-warning)] px-4 py-3 text-sm text-[var(--text-strong)]">
            <Icon name="info" size={16} className="mt-0.5 shrink-0 text-[var(--state-warning)]" />
            <span className="flex-1">{warning}</span>
            <button type="button" onClick={() => setWarning(null)} className="text-[var(--text-muted)]" aria-label="Dismiss">
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : null}
        {cfg.fullscreen_lock && !fullscreen ? (
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            className="glass-btn glass-btn-secondary inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius)] text-sm font-medium"
          >
            <Icon name="shield" size={15} />
            Enter fullscreen
          </button>
        ) : null}

        {initial.questions.map((q, i) => (
          <section
            key={q.id}
            id={`q-${q.id}`}
            className="glass scroll-mt-24 flex flex-col gap-4 rounded-[var(--radius-card)] p-5"
            style={{ userSelect: cfg.disable_copy_paste ? "none" : undefined }}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-full bg-[var(--bg-raised)] px-1.5 text-xs font-semibold text-[var(--text-strong)]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line text-sm font-medium leading-relaxed text-[var(--text-strong)]">{q.prompt}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {q.category ? <Chip>{q.category}</Chip> : null}
                  {q.type === "multi" ? <Chip>Select all that apply</Chip> : null}
                </div>
              </div>
            </div>
            {q.image ? <img src={q.image} alt="" className="max-h-72 self-start rounded-[var(--radius-md)] object-contain" /> : null}

            {q.type === "single" || q.type === "multi" ? (
              <div className="flex flex-col gap-2">
                {q.choices.map((choice, ci) => {
                  const v = answers[q.id];
                  const on = q.type === "single" ? v === ci : Array.isArray(v) && v.includes(ci);
                  return (
                    <label
                      key={ci}
                      className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-sm transition-colors hover:bg-[var(--bg-raised)] ${on ? "border-[var(--accent)] bg-[var(--bg-raised)]" : "border-[var(--border-subtle)]"}`}
                    >
                      <input
                        type={q.type === "single" ? "radio" : "checkbox"}
                        name={q.id}
                        checked={on}
                        onChange={() => {
                          if (q.type === "single") {
                            setAnswer(q.id, ci);
                          } else {
                            const cur = Array.isArray(v) ? (v as number[]) : [];
                            setAnswer(q.id, cur.includes(ci) ? cur.filter((x) => x !== ci) : [...cur, ci].sort((a, b) => a - b));
                          }
                        }}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="text-[var(--text)]">{choice}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}

            {q.type === "truefalse" ? (
              <div className="grid grid-cols-2 gap-2">
                {[true, false].map((val) => {
                  const on = answers[q.id] === val;
                  return (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setAnswer(q.id, val)}
                      className={`h-11 rounded-[var(--radius-md)] border text-sm font-medium transition-colors ${on ? "border-[var(--accent)] bg-[var(--bg-raised)] text-[var(--text-strong)]" : "border-[var(--border-subtle)] text-[var(--text-muted)]"}`}
                    >
                      {val ? "True" : "False"}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {q.type === "short" ? (
              <input
                type="text"
                value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Type your answer"
                className="glass-field h-11 w-full rounded-[0.875rem] px-3.5 text-sm text-[var(--text)]"
              />
            ) : null}
          </section>
        ))}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="glass flex flex-col gap-3 rounded-[var(--radius-card)] p-5">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Time left</span>
          {remaining !== null ? (
            <span className={`font-mono text-3xl font-semibold tabular-nums ${low ? "text-[var(--state-danger)]" : "text-[var(--text-strong)]"}`} aria-live="polite">
              {clock(remaining)}
            </span>
          ) : (
            <span className="text-sm text-[var(--text-muted)]">No time limit</span>
          )}
          <div className="flex items-center justify-between text-sm text-[var(--text)]">
            <span>Answered</span>
            <span className="font-semibold tabular-nums">
              {done} / {total}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Icon name={saving === "error" ? "x" : "check"} size={12} />
            {saving === "saving" ? "Saving…" : saving === "error" ? "Not saved. Retrying on next change." : saving === "saved" ? "Saved" : "Answers save as you go"}
          </div>
        </div>

        {proctored ? (
          <div className="glass flex flex-col gap-2 rounded-[var(--radius-card)] p-5 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Proctoring</span>
            {cfg.tab_detection ? (
              <div className="flex items-center justify-between">
                <span className="text-[var(--text)]">Tab switches</span>
                <span className="font-semibold tabular-nums">{violations.tab_switch}</span>
              </div>
            ) : null}
            {cfg.fullscreen_lock ? (
              <div className="flex items-center justify-between">
                <span className="text-[var(--text)]">Fullscreen exits</span>
                <span className="font-semibold tabular-nums">{violations.fullscreen_exit}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="glass flex flex-col gap-3 rounded-[var(--radius-card)] p-5">
          <button
            type="button"
            onClick={() => {
              const left = total - done;
              const msg = left > 0 ? `${left} question(s) are still unanswered. Submit anyway?` : "Submit your answers now? You cannot change them after.";
              if (window.confirm(msg)) void submit();
            }}
            disabled={busy}
            className="glass-btn glass-btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] text-sm font-semibold text-white disabled:opacity-50"
          >
            <Icon name={busy ? "loader" : "check"} size={15} />
            {busy ? "Submitting…" : "Submit exam"}
          </button>
          <button type="button" onClick={() => router.push(`/learn/exams/${examId}`)} className="text-xs text-[var(--text-muted)] underline-offset-2 hover:underline">
            Back to exam info
          </button>
        </div>
      </aside>
    </div>
  );
}
