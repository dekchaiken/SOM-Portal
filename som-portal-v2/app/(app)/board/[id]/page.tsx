// som-portal-v2/app/(app)/board/[id]/page.tsx
//
// Single board post with its comments. Same gate as /board (requireBoardRead).
// Writes go through the server actions in ../actions.ts, which re-check access.
import Link from "next/link";
import { notFound } from "next/navigation";
import { PulseHeader } from "@/ui/PulseHeader";
import { StatusChip, type ChipStatus } from "@/ui/StatusChip";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { requireBoardRead } from "@/board/access";
import { getPost, listComments } from "@/board/service";
import { listTeamUsers } from "@/board/global-data";
import { ActionButton } from "../_components/ActionButton";
import { CommentComposer } from "../_components/CommentComposer";
import { StatusSelect } from "../_components/StatusSelect";
import { StarToggle } from "../_components/StarToggle";
import { pinPost, softDeletePost, deleteComment } from "../actions";
import type { MentionOption } from "../_components/MentionPicker";

export const metadata = { title: "Board · Post · SOM Portal" };
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function BoardPostPage({ params }: { params: Params }) {
  const { id } = await params;
  return <PostView id={id} />;
}

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function PostView({ id }: { id: string }) {
  let access;
  try {
    access = await requireBoardRead();
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <div className="flex flex-col gap-5">
          <PulseHeader title="Board" subtitle="Access denied" />
          <Card>
            <CardContent className="py-16 text-center text-sm">{e.message}</CardContent>
          </Card>
        </div>
      );
    }
    throw e;
  }

  let post;
  try {
    post = await getPost(access, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const [comments, users] = await Promise.all([
    listComments(access, id),
    listTeamUsers(access.team),
  ]);
  const mentionCandidates: MentionOption[] = users
    .filter((u) => u.id && (u.name || u.username))
    .map((u) => ({ id: u.id!, name: (u.name ?? u.username ?? u.id!) as string }));

  const canWrite = access.canWrite;
  const status = post.status as ChipStatus;

  return (
    <div className="flex flex-col gap-5 stagger-children">
      <PulseHeader
        title={post.title}
        subtitle={`${post.board_type_name ?? "Board"} · ${post.author_name ?? "—"} · ${fmt(post.created_at)}`}
        actions={
          <Link
            href="/board"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            <Icon name="arrow-left" size={12} /> Back to board
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={status} />
              {post.pinned ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  <Icon name="pin" size={12} /> Pinned
                </span>
              ) : null}
              {post.service_type_name ? (
                <span className="text-xs text-[var(--text-muted)]">
                  {post.service_type_name}
                  {post.service_subtype_name ? ` / ${post.service_subtype_name}` : ""}
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
              {post.content || "—"}
            </p>
            {post.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.image_url} alt="" className="max-h-[420px] rounded-xl border border-[var(--border)] object-contain" />
            ) : null}
            <div className="text-[11px] text-[var(--text-subtle)]">
              Updated {fmt(post.updated_at)}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <StarToggle postId={post.id} starred={post.starred} disabled={false} />
              {canWrite ? (
                <>
                  <StatusSelect postId={post.id} status={post.status} />
                  <ActionButton
                    action={pinPost.bind(null, post.id)}
                    icon="pin"
                    label={post.pinned ? "Unpin" : "Pin"}
                    pendingLabel="Updating…"
                  />
                  <ActionButton
                    action={softDeletePost.bind(null, post.id)}
                    icon="trash"
                    label="Move to trash"
                    pendingLabel="Moving…"
                    confirm
                    confirmLabel="Confirm move to trash?"
                    variant="destructive"
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Comments ({comments.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {comments.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No comments yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.map((c) => (
                <li key={c.id} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                    <span className="font-medium text-[var(--text)]">{c.author_name ?? "—"}</span>
                    <span>{fmt(c.created_at)}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm">{c.content}</p>
                  {canWrite ? (
                    <div className="mt-2">
                      <ActionButton
                        action={deleteComment.bind(null, c.id, post.id)}
                        icon="trash"
                        label="Delete"
                        pendingLabel="Deleting…"
                        confirm
                        confirmLabel="Confirm delete?"
                        variant="ghost"
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <CommentComposer postId={post.id} mentionCandidates={mentionCandidates} canWrite={canWrite} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
