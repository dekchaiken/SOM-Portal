// som-portal-v2/app/(app)/learn/exams/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ForbiddenError } from "@/lib/errors";
import { listExams, type ExamListItem } from "@/learn/exam-service";
import { PulseHeader } from "@/ui/PulseHeader";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { AccessDenied } from "../_shared";
import { CardShell, Chip, CoverBand, ProgressRing } from "../_cards";

export const metadata = { title: "Exams · SOM Portal" };
export const dynamic = "force-dynamic";

function examFooter(e: ExamListItem) {
  if (e.my_in_progress) return { tone: "info" as const, text: "Attempt open · resume", icon: "play" as const };
  if (e.my_passed) return { tone: "success" as const, text: "Passed", icon: "check" as const };
  if (e.blocked) return { tone: "warning" as const, text: e.blocked, icon: "info" as const };
  if (e.my_submitted > 0) return { tone: "neutral" as const, text: "Failed · you can try again", icon: "refresh" as const };
  return { tone: "neutral" as const, text: "Not started", icon: "play" as const };
}

export default async function ExamsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/learn/exams");

  let exams: ExamListItem[];
  try {
    exams = await listExams(session);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <div className="flex flex-col gap-5">
          <PulseHeader title="Exams" subtitle="Assessments for your team" />
          <AccessDenied message="Learning is not enabled for your team." />
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title="Exams"
        subtitle="Assessments for your team"
        actions={
          <Link href="/learn" className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-3.5 text-sm font-medium">
            <Icon name="arrow-left" size={15} />
            Courses
          </Link>
        }
      />
      {exams.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">No exams yet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr))]">
          {exams.map((e) => {
            const foot = examFooter(e);
            const body = (
              <CardShell className={e.blocked && !e.my_in_progress ? "opacity-75" : undefined}>
                <CoverBand color={e.cover_color} fallbackIcon="flag" icon={e.icon} />
                <div className="flex flex-1 flex-col gap-4 px-5 pb-5 pt-9">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-[var(--text-strong)]">{e.title}</h3>
                      {e.subtitle ? <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{e.subtitle}</p> : null}
                    </div>
                    {e.my_best !== null ? (
                      <ProgressRing percent={e.my_best} label={`${e.my_best}`} />
                    ) : (
                      <span className="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-full border border-dashed border-[var(--border-strong)] text-[11px] text-[var(--text-subtle)]">
                        —
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip icon="file">{e.question_count} questions</Chip>
                    {e.time_limit_minutes !== null ? <Chip icon="clock">{e.time_limit_minutes} min</Chip> : null}
                    <Chip icon="check">Pass {e.pass_score}%</Chip>
                    {e.attempts_max !== null ? (
                      <Chip icon="refresh">
                        {e.my_submitted}/{e.attempts_max} attempts
                      </Chip>
                    ) : null}
                    {e.status !== "published" ? <Chip tone="warning">Draft</Chip> : null}
                  </div>
                  <div className="mt-auto flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3 text-xs">
                    <Icon name={foot.icon} size={13} className={foot.tone === "neutral" ? "text-[var(--text-muted)]" : undefined} />
                    <span className={foot.tone === "success" ? "text-[var(--state-success)]" : foot.tone === "warning" ? "text-[var(--state-warning)]" : foot.tone === "info" ? "text-[var(--state-info)]" : "text-[var(--text-muted)]"}>
                      {foot.text}
                    </span>
                  </div>
                </div>
              </CardShell>
            );
            return (
              <Link key={e.id} href={`/learn/exams/${e.id}`} className="block rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                {body}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
