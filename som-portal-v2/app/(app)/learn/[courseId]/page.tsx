// som-portal-v2/app/(app)/learn/[courseId]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getCourseDetail } from "@/learn/service";
import { PulseHeader } from "@/ui/PulseHeader";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { AccessDenied, ProgressBar, STATUS_LABEL } from "../_shared";

export const metadata = { title: "Course · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/learn/${courseId}`);

  let detail;
  try {
    detail = await getCourseDetail(session, courseId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <AccessDenied message={e.message} />;
    throw e;
  }
  const { course, phases } = detail;

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title={course.title} subtitle={course.subtitle || course.description} />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--text-muted)]">Your progress</span>
            <span className="font-semibold text-[var(--text-strong)]">{course.my_percent}%</span>
          </div>
          <ProgressBar percent={course.my_percent} />
        </CardContent>
      </Card>

      {phases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">This course has no phases yet.</CardContent>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {phases.map((p) => {
            const open = p.my_status !== "locked";
            const row = (
              <div className="glass flex items-center gap-4 rounded-[var(--radius-card)] p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--bg-raised)] text-sm font-semibold text-[var(--text-strong)]">
                  {p.order}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--text-strong)]">{p.title}</div>
                  {p.subtitle ? <div className="truncate text-xs text-[var(--text-muted)]">{p.subtitle}</div> : null}
                  <div className="mt-1 text-[11px] text-[var(--text-subtle)]">
                    {p.estimated_minutes} min · pass {p.pass_score}%
                  </div>
                </div>
                <span className="shrink-0 text-xs font-medium text-[var(--text)]">{STATUS_LABEL[p.my_status]}</span>
                {!open ? <Icon name="shield" size={14} className="shrink-0 text-[var(--text-subtle)]" /> : null}
              </div>
            );
            return (
              <li key={p.id}>
                {open ? (
                  <Link href={`/learn/${course.id}/${p.id}`} className="block transition-transform duration-200 hover:-translate-y-0.5">
                    {row}
                  </Link>
                ) : (
                  <div aria-disabled className="opacity-60">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
