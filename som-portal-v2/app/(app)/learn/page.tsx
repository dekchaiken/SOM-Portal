// som-portal-v2/app/(app)/learn/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { ForbiddenError } from "@/lib/errors";
import { listCourses } from "@/learn/service";
import { PulseHeader } from "@/ui/PulseHeader";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { AccessDenied, ProgressBar, STATUS_LABEL } from "./_shared";

export const metadata = { title: "Learn · SOM Portal" };
export const dynamic = "force-dynamic";

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
      <PulseHeader title="Learn" subtitle="Courses for your team" />
      {courses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">No courses yet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {courses.map((c) => {
            const body = (
              <div className="glass flex h-full flex-col gap-4 rounded-[var(--radius-card)] p-5 transition-transform duration-200 hover:-translate-y-0.5">
                <div className="flex items-start gap-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] text-white"
                    style={{ background: c.cover_color || "#f26419" }}
                  >
                    <Icon name="book" size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-[var(--text-strong)]">{c.title}</h3>
                    {c.subtitle ? <p className="line-clamp-2 text-xs text-[var(--text-muted)]">{c.subtitle}</p> : null}
                  </div>
                </div>
                <div className="mt-auto flex flex-col gap-2">
                  <ProgressBar percent={c.my_percent} />
                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                    <span>{c.phases_count} phases · {c.my_percent}%</span>
                    <span className="font-medium text-[var(--text)]">{STATUS_LABEL[c.my_status]}</span>
                  </div>
                  {c.unmet_prereqs.length > 0 ? (
                    <p className="text-[11px] text-[var(--state-warning)]">
                      Finish first: {c.unmet_prereqs.map((u) => u.title).join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            );
            return c.my_locked ? (
              <div key={c.id} aria-disabled className="opacity-60">
                {body}
              </div>
            ) : (
              <Link key={c.id} href={`/learn/${c.id}`} className="block">
                {body}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
