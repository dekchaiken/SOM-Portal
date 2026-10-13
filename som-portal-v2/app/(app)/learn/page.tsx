// som-portal-v2/app/(app)/learn/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ForbiddenError } from "@/lib/errors";
import { listCourses } from "@/learn/service";
import { PulseHeader } from "@/ui/PulseHeader";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { AccessDenied, STATUS_LABEL } from "./_shared";
import { CardShell, Chip, CoverBand, ProgressRing, type Tone } from "./_cards";

export const metadata = { title: "Learn · SOM Portal" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, Tone> = {
  completed: "success",
  in_progress: "info",
  not_started: "neutral",
  locked: "warning",
};

export default async function LearnPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/learn");

  let courses;
  try {
    courses = await listCourses(session);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <div className="flex flex-col gap-5">
          <PulseHeader title="Learn" subtitle="Courses for your team" />
          <AccessDenied message="Learning is not enabled for your team." />
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title="Learn"
        subtitle="Courses for your team"
        actions={
          <Link href="/learn/exams" className="glass-btn glass-btn-secondary inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-3.5 text-sm font-medium">
            <Icon name="flag" size={15} />
            Exams
          </Link>
        }
      />
      {courses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">No courses yet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr))]">
          {courses.map((c) => {
            const body = (
              <CardShell className={c.my_locked ? "opacity-70" : undefined}>
                <CoverBand color={c.cover_color} fallbackIcon="book" icon={c.icon} />
                <div className="flex flex-1 flex-col gap-4 px-5 pb-5 pt-9">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-[var(--text-strong)]">{c.title}</h3>
                    {c.subtitle ? <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{c.subtitle}</p> : null}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col items-start gap-2">
                      <Chip icon="layers">{c.phases_count} phases</Chip>
                      <Chip tone={STATUS_TONE[c.my_status] ?? "neutral"} icon={c.my_status === "completed" ? "check" : undefined}>
                        {STATUS_LABEL[c.my_status] ?? c.my_status}
                      </Chip>
                    </div>
                    <ProgressRing percent={c.my_percent} />
                  </div>
                  {c.unmet_prereqs.length > 0 ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-[var(--state-warning)]">
                      <Icon name="info" size={12} className="mt-0.5 shrink-0" />
                      <span>Finish first: {c.unmet_prereqs.map((u) => u.title).join(", ")}</span>
                    </p>
                  ) : null}
                </div>
              </CardShell>
            );
            return c.my_locked ? (
              <div key={c.id} aria-disabled className="block cursor-not-allowed">
                {body}
              </div>
            ) : (
              <Link key={c.id} href={`/learn/${c.id}`} className="block rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                {body}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
