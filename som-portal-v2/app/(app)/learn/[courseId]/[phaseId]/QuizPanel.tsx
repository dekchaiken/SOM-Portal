"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/shadcn/card";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { ProgressBar } from "../../_shared";
import { Icon } from "@/icons";

interface LearnerQuestion {
  id: string;
  type: "single" | "multi" | "truefalse" | "short";
  question: string;
  choices: string[];
}

interface QuizData {
  quiz: { id: string; title: string; description: string; questions: LearnerQuestion[] };
  pass_score: number;
}

interface Result {
  score: number;
  best_score: number;
  pass_score: number;
  passed: boolean;
  attempts: number;
  correct_count: number;
  total_count: number;
  summary: { q_id: string; correct: boolean }[];
}

type Value = number | number[] | boolean | string | undefined;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

export function QuizPanel({ phaseId, alreadyPassed }: { phaseId: string; alreadyPassed: boolean }) {
  const router = useRouter();
  const [data, setData] = React.useState<QuizData | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, Value>>({});
  const [result, setResult] = React.useState<Result | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setData(await call<QuizData>(`/v2/api/v1/learn/phases/${phaseId}/quiz`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the quiz");
    }
  }, [phaseId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function setAnswer(id: string, v: Value) {
    setAnswers((a) => ({ ...a, [id]: v }));
  }

  function toggleMulti(id: string, index: number) {
    const current = Array.isArray(answers[id]) ? (answers[id] as number[]) : [];
    setAnswer(id, current.includes(index) ? current.filter((i) => i !== index) : [...current, index]);
  }

  async function submit() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await call<Result>(`/v2/api/v1/learn/phases/${phaseId}/quiz/submit`, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      setResult(res);
      if (res.passed) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setResult(null);
    setAnswers({});
    void load();
  }

  if (error && !data) {
    return <p role="alert" className="glass-chip rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--state-danger)]">{error}</p>;
  }
  if (!data) return <p className="text-sm text-[var(--text-muted)]">Loading quiz…</p>;

  const total = data.quiz.questions.length;
  const answered = data.quiz.questions.filter((q) => {
    const v = answers[q.id];
    if (q.type === "multi") return Array.isArray(v) && v.length > 0;
    if (q.type === "short") return typeof v === "string" && v.trim() !== "";
    return v !== undefined;
  }).length;

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{result.passed ? "Passed" : "Not passed yet"}</CardTitle>
          <CardDescription>
            Score {result.score}% · best {result.best_score}% · pass at {result.pass_score}% · attempt {result.attempts}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProgressBar percent={result.score} />
          <p className="text-sm text-[var(--text-muted)]">
            {result.correct_count} of {result.total_count} correct. Correct answers are not shown.
          </p>
          <ul className="flex flex-wrap gap-2 text-xs">
            {result.summary.map((s, i) => (
              <li key={s.q_id} className="glass-chip flex items-center gap-1.5 rounded-full px-3 py-1">
                <Icon name={s.correct ? "check" : "x"} size={12} className={s.correct ? "text-[var(--state-success)]" : "text-[var(--state-danger)]"} />
                Q{i + 1}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {!result.passed ? (
              <Button onClick={retry} className="glass-btn">Try again</Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{data.quiz.title || "Quiz"}</CardTitle>
        <CardDescription>
          {data.quiz.description || `${total} questions · pass at ${data.pass_score}%`}
          {alreadyPassed ? " · already passed, your best score is kept" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {data.quiz.questions.map((q, i) => (
          <fieldset key={q.id} className="flex flex-col gap-2.5">
            <legend className="mb-1 text-sm font-medium text-[var(--text-strong)]">
              {i + 1}. {q.question}
              {q.type === "multi" ? <span className="ml-2 text-xs text-[var(--text-subtle)]">choose all that apply</span> : null}
            </legend>
            {q.type === "single" || q.type === "multi"
              ? q.choices.map((c, ci) => (
                  <label key={ci} className="glass-chip flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm">
                    <input
                      type={q.type === "single" ? "radio" : "checkbox"}
                      name={q.id}
                      checked={q.type === "single" ? answers[q.id] === ci : Array.isArray(answers[q.id]) && (answers[q.id] as number[]).includes(ci)}
                      onChange={() => (q.type === "single" ? setAnswer(q.id, ci) : toggleMulti(q.id, ci))}
                    />
                    {c}
                  </label>
                ))
              : null}
            {q.type === "truefalse"
              ? [true, false].map((v) => (
                  <label key={String(v)} className="glass-chip flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm">
                    <input type="radio" name={q.id} checked={answers[q.id] === v} onChange={() => setAnswer(q.id, v)} />
                    {v ? "True" : "False"}
                  </label>
                ))
              : null}
            {q.type === "short" ? (
              <Input
                value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Type your answer"
                aria-label={q.question}
              />
            ) : null}
          </fieldset>
        ))}

        {error ? <p role="alert" className="text-sm text-[var(--state-danger)]">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={busy || total === 0} className="glass-btn">
            {busy ? "Submitting…" : "Submit answers"}
          </Button>
          <span className="text-xs text-[var(--text-subtle)]">
            {answered} of {total} answered
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
