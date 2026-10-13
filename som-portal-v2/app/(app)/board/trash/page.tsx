// som-portal-v2/app/(app)/board/trash/page.tsx
//
// Lead-only view of soft-deleted board posts + comments, with restore and
// permanent delete. Same gate as /board plus requireTrashAccess (lead-level).
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { PulseHeader } from "@/ui/PulseHeader";
import { SkeletonList } from "@/ui/Skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { ForbiddenError } from "@/lib/errors";
import { requireBoardRead } from "@/board/access";
import { listTrash } from "@/board/service";
import { restorePost, restoreComment, hardDelete } from "../actions";
import { ActionButton } from "../_components/ActionButton";

export const metadata = { title: "Board · Trash · SOM Portal" };
export const dynamic = "force-dynamic";

function AccessDenied({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="Board · Trash" subtitle="Soft-deleted posts and comments" />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
          <p className="text-sm font-medium">Trash is not available.</p>
          <p className="max-w-md text-xs text-[var(--text-muted)]">{reason}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function BoardTrashPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/board/trash");

  const navAllowed = canSeePage("board", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!navAllowed) {
    return <AccessDenied reason="Nav permission denied for your role." />;
  }

  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <TrashList />
    </Suspense>
  );
}

async function TrashList() {
  let access;
  try {
    access = await requireBoardRead();
  } catch (e) {
    if (e instanceof ForbiddenError) return <AccessDenied reason={e.message} />;
    throw e;
  }

  let data;
  try {
    data = await listTrash(access);
  } catch (e) {
    if (e instanceof ForbiddenError) return <AccessDenied reason={e.message} />;
    throw e;
  }

  const { posts, comments, retention_days } = data;

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title="Board · Trash"
        subtitle={`${posts.length} posts · ${comments.length} comments · retained ${retention_days} days`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Deleted posts</CardTitle>
          <CardDescription>
            Restore to put a post back on the board, or permanently delete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {posts.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing to show.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {posts.map((p) => (
                <li key={p.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-subtle)]">
                      Deleted by {p.deleted_by_name ?? p.deleted_by ?? "unknown"} · {p.days_left} days left
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ActionButton
                      action={restorePost.bind(null, p.id)}
                      icon="refresh"
                      label="Restore"
                      pendingLabel="Restoring…"
                      size="sm"
                      variant="secondary"
                    />
                    <ActionButton
                      action={hardDelete.bind(null, "post", p.id)}
                      icon="trash"
                      label="Delete permanently"
                      pendingLabel="Deleting…"
                      confirm
                      size="sm"
                      variant="ghost"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Deleted comments</CardTitle>
        </CardHeader>
        <CardContent>
          {comments.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing to show.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.content}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-subtle)]">
                      Post {c.post_id} · {c.days_left} days left
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ActionButton
                      action={restoreComment.bind(null, c.id)}
                      icon="refresh"
                      label="Restore"
                      pendingLabel="Restoring…"
                      size="sm"
                      variant="secondary"
                    />
                    <ActionButton
                      action={hardDelete.bind(null, "comment", c.id)}
                      icon="trash"
                      label="Delete permanently"
                      pendingLabel="Deleting…"
                      confirm
                      size="sm"
                      variant="ghost"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
