// som-portal-v2/app/(app)/learn/exams/[examId]/attempt/[attemptId]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getAttempt, type AttemptView, type ResultView } from "@/learn/exam-service";
import { PulseHeader } from "@/ui/PulseHeader";
import { Icon } from "@/icons";
import { Chip } from "../../../../_cards";
import { AccessDenied } from "../../../../_shared";
import { TakePanel } from "./TakePanel";
import { ResultPanel } from "./ResultPanel";

export const dynamic = "force-dynamic";

export default async function AttemptPage({ params }: { params: Promise<{ examId: string; attemptId: string }> }) {
  const { examId, attemptId } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/learn/exams/${examId}/attempt/${attemptId}`);

  let view: AttemptView | ResultView;
  try {
    view = await getAttempt(session, attemptId);
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

  if (view.status === "submitted") {
    return (
      <div className="flex flex-col gap-5">
        <PulseHeader
          title={view.exam_title || "Exam"}
          subtitle="Result"
          actions={
            <Link href={`/learn/exams/${examId}`} className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-3.5 text-sm font-medium">
              <Icon name="arrow-left" size={15} />
              Back
            </Link>
          }
        />
        <ResultPanel result={view} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title={view.exam_title}
        subtitle={`Started ${new Date(view.started_at).toLocaleString()}`}
        live
        actions={<Chip icon="file">{view.questions.length} questions</Chip>}
      />
      <TakePanel examId={examId} initial={view} />
    </div>
  );
}
