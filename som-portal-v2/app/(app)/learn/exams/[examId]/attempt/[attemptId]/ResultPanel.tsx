// som-portal-v2/app/(app)/learn/exams/[examId]/attempt/[attemptId]/ResultPanel.tsx
import type { ResultView } from "@/learn/exam-service";
import { Icon } from "@/icons";
import { CardShell, Chip, ProgressRing } from "../../../../_cards";

export function ResultPanel({ result }: { result: ResultView }) {
  if (!result.visible) {
    return (
      <CardShell>
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Icon name="check" size={28} className="text-[var(--state-success)]" />
          <h2 className="text-base font-semibold text-[var(--text-strong)]">Submitted</h2>
          <p className="max-w-md text-sm text-[var(--text-muted)]">
            Your answers are in. Results are not available yet.
          </p>
        </div>
      </CardShell>
    );
  }

  const passed = result.passed === true;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <CardShell>
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <ProgressRing percent={result.score ?? 0} size={132} stroke={10} />
          <Chip tone={passed ? "success" : "danger"} icon={passed ? "check" : "x"}>
            {passed ? "Passed" : "Not passed"} · pass at {result.pass_score}%
          </Chip>
          <p className="text-sm text-[var(--text-muted)]">
            {result.correct_count ?? 0} of {result.total_count} correct
            {result.penalty > 0 ? ` · penalty −${result.penalty}%` : ""}
          </p>
          {result.auto_submitted ? <p className="text-xs text-[var(--state-warning)]">Submitted automatically (time or proctoring rule)</p> : null}
        </div>
      </CardShell>
      <CardShell>
        <div className="flex flex-col gap-3 p-6">
          <h2 className="text-sm font-semibold text-[var(--text-strong)]">Questions</h2>
          {(result.summary ?? []).length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No question breakdown.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {(result.summary ?? []).map((s, i) => (
                <li key={s.q_id} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-white ${s.correct ? "bg-[var(--state-success)]" : "bg-[var(--state-danger)]"}`}
                    >
                      <Icon name={s.correct ? "check" : "x"} size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-strong)]">
                        {i + 1}. {s.prompt || "Question"}
                      </p>
                      {s.answer ? <p className="mt-1 text-xs text-[var(--text-muted)]">Correct answer: {s.answer}</p> : null}
                      {s.explain ? <p className="mt-1 text-xs text-[var(--text-muted)]">{s.explain}</p> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardShell>
    </div>
  );
}
