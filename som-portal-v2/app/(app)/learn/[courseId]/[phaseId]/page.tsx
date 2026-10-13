// som-portal-v2/app/(app)/learn/[courseId]/[phaseId]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getPhaseLessons } from "@/learn/service";
import { PulseHeader } from "@/ui/PulseHeader";
import { Card, CardContent } from "@/ui/shadcn/card";
import { AccessDenied } from "../../_shared";

export const metadata = { title: "Lesson · SOM Portal" };
export const dynamic = "force-dynamic";

export default async function PhasePage({
  params,
}: {
  params: Promise<{ courseId: string; phaseId: string }>;
}) {
  const { courseId, phaseId } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/learn/${courseId}/${phaseId}`);

  let data;
  try {
    data = await getPhaseLessons(session, phaseId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return <AccessDenied message={e.message} />;
    throw e;
  }
  const { phase, lessons } = data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href={`/learn/${courseId}`} className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)]">
          Back to course
        </Link>
        <PulseHeader title={`Phase ${phase.order}: ${phase.title}`} subtitle={phase.subtitle || undefined} />
      </div>

      {lessons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">This phase has no lessons yet.</CardContent>
        </Card>
      ) : (
        lessons.map((l, i) => (
          <Card key={l.id}>
            <CardContent className="flex flex-col gap-3 pt-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-subtle)]">
                Lesson {i + 1}
              </p>
              <h2 className="text-lg font-semibold tracking-tight text-[var(--text-strong)]">{l.title}</h2>
              <div
                className="prose-learn text-sm leading-relaxed text-[var(--text)]"
                dangerouslySetInnerHTML={{ __html: l.content_html }}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
