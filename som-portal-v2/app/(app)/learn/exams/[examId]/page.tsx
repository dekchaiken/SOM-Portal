// som-portal-v2/app/(app)/learn/exams/[examId]/page.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getExamDetail } from "@/learn/exam-service";
import { PulseHeader } from "@/ui/PulseHeader";
import { Icon } from "@/icons";
import { CardShell, Chip, CoverBand } from "../../_cards";
import { AccessDenied } from "../../_shared";
import { StartButton } from "./StartButton";

export const dynamic = "force-dynamic";

const SHOW_RESULTS: Record<string, string> = {
  after_submit: "Shown right after you submit",
  after_window: "Shown after the exam window closes",
  never: "Not shown to learners",
};

function Rule({ icon, label, value }: { icon: "clock" | "refresh" | "check" | "shield" | "eye" | "flag"; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] py-3 text-sm last:border-0">
      <span className="flex items-center gap-2 text-[var(--text-muted)]">
        <Icon name={icon} size={15} />
        {label}
      </span>
      <span className="text-right font-medium text-[var(--text-strong)]">{value}</span>
    </div>
  );
}

export default async function ExamStartPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/learn/exams/${examId}`);

  let detail;
  try {
    detail = await getExamDetail(session, examId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) {
      return (
        <div className="flex flex-col gap-5">
          <PulseHeader title="Exam" subtitle="Assessments for your team" />
          <AccessDenied message="Learning is not enabled for your team." />
        </div>
      );
    }
    throw e;
  }
  const { exam, attempts, blocked, in_progress_id, unmet_prereqs } = detail;
  const r = exam.rules;

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title={exam.title}
        subtitle={exam.subtitle || "Exam"}
        actions={
          <Link href="/learn/exams" className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-3.5 text-sm font-medium">
            <Icon name="arrow-left" size={15} />
            Exams
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <CardShell>
          <CoverBand color={exam.cover_color} fallbackIcon="flag" icon={exam.icon} />
          <div className="flex flex-col gap-5 px-6 pb-6 pt-9">
            <div className="flex flex-wrap gap-1.5">
              <Chip icon="file">{exam.question_count} questions</Chip>
              {r.time_limit_minutes !== null ? <Chip icon="clock">{r.time_limit_minutes} minutes</Chip> : null}
              <Chip icon="check">Pass at {exam.pass_score}%</Chip>
              {exam.status !== "published" ? <Chip tone="warning">Draft · only admins can see it</Chip> : null}
            </div>
            {exam.description ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text)]">{exam.description}</p>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Read each question carefully. Your answers save as you go.</p>
            )}
            <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-4">
              <Rule icon="refresh" label="Attempts" value={r.attempts_max !== null ? `${attempts.filter((a) => a.status === "submitted").length} of ${r.attempts_max} used` : "Unlimited"} />
              {r.cooldown_minutes > 0 ? <Rule icon="clock" label="Wait between attempts" value={`${r.cooldown_minutes} min`} /> : null}
              {r.window ? (
                <Rule
                  icon="flag"
                  label="Open window"
                  value={`${r.window.start ? new Date(r.window.start).toLocaleString() : "now"} – ${r.window.end ? new Date(r.window.end).toLocaleString() : "no end"}`}
                />
              ) : null}
              <Rule icon="eye" label="Results" value={SHOW_RESULTS[r.show_results] ?? r.show_results} />
              {r.tab_detection || r.fullscreen_lock || r.disable_copy_paste ? (
                <Rule
                  icon="shield"
                  label="Proctoring"
                  value={[r.tab_detection && "tab switches", r.fullscreen_lock && "fullscreen", r.disable_copy_paste && "copy/paste blocked"].filter(Boolean).join(", ")}
                />
              ) : null}
            </div>
          </div>
        </CardShell>

        <div className="flex flex-col gap-5">
          <CardShell>
            <div className="flex flex-col gap-4 p-6">
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Start</h2>
              <StartButton examId={exam.id} inProgressId={in_progress_id} blocked={blocked} />
              {unmet_prereqs.length > 0 ? (
                <p className="text-xs text-[var(--state-warning)]">Finish first: {unmet_prereqs.join(", ")}</p>
              ) : null}
            </div>
          </CardShell>
          <CardShell>
            <div className="flex flex-col gap-3 p-6">
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Your attempts</h2>
              {attempts.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No attempts yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  {attempts.map((a, i) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="text-[var(--text-muted)]">
                        #{attempts.length - i} · {new Date(a.started_at).toLocaleString()}
                      </span>
                      {a.status === "in_progress" ? (
                        <Chip tone="info">Open</Chip>
                      ) : a.score === null ? (
                        <Chip>Submitted</Chip>
                      ) : (
                        <Chip tone={a.passed ? "success" : "danger"}>
                          {a.score}% · {a.passed ? "Passed" : "Failed"}
                        </Chip>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardShell>
        </div>
      </div>
    </div>
  );
}
