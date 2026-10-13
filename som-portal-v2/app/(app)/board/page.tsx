// som-portal-v2/app/(app)/board/page.tsx
//
// Server component. All access/write gates ran server-side via
// requireBoardRead(); the client components only submit back through the
// server actions in ./actions.ts, which re-run requireBoardWrite().
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { canSeePage } from "@/config/permissions";
import type { Role } from "@/config/nav";
import { PulseHeader } from "@/ui/PulseHeader";
import { StatusChip, type ChipStatus } from "@/ui/StatusChip";
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
import { listPosts, getBoardConfig } from "@/board/service";
import { listTeamUsers } from "@/board/global-data";
import { BoardFilters } from "./_components/BoardFilters";
import { NewPostPanel, type MentionCandidate } from "./_components/NewPostPanel";
import { StarToggle } from "./_components/StarToggle";

export const metadata = { title: "Board · SOM Portal" };
export const dynamic = "force-dynamic";

function statusToChip(status: string | null | undefined): ChipStatus {
  switch (status) {
    case "resolved":
      return "success";
    case "in_progress":
      return "in_progress";
    case "open":
      return "open";
    default:
      return "unknown";
  }
}

function AccessDenied({ team, reason }: { team: string; reason: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="Service Board" subtitle="Multi-team incident & announcement board" />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
          <p className="text-sm font-medium">
            Your team ({team}) cannot access the board.
          </p>
          <p className="max-w-md text-xs text-[var(--text-muted)]">{reason}</p>
        </CardContent>
      </Card>
    </div>
  );
}

interface SearchParams {
  search?: string;
  status?: string;
  board_type?: string;
  starred?: string;
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/board");

  // Nav/role gate first for a friendly early return without hitting storage.
  const navAllowed = canSeePage("board", {
    role: session.role as Role,
    team: session.team,
    isGenz: session.is_genz,
  });
  if (!navAllowed) {
    return <AccessDenied team={session.team} reason="Nav permission denied for your role." />;
  }

  return (
    <Suspense fallback={<SkeletonList rows={6} />}>
      <BoardList sp={await searchParams} />
    </Suspense>
  );
}

async function BoardList({ sp }: { sp: SearchParams }) {
  // Full board gate — teams.json feature + menu-permissions + page_mode.
  let access;
  try {
    access = await requireBoardRead();
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return <AccessDenied team="your team" reason={e.message} />;
    }
    throw e;
  }

  const query = {
    search: sp.search ?? "",
    status: sp.status as "open" | "in_progress" | "resolved" | undefined,
    board_type: sp.board_type ?? "",
    author_id: "",
    starred: sp.starred === "1",
    limit: 50,
    offset: 0,
  };

  const [{ items, total }, cfg, users] = await Promise.all([
    listPosts(access, query),
    getBoardConfig(access),
    listTeamUsers(access.team),
  ]);

  const mentionCandidates: MentionCandidate[] = users
    .filter((u) => u.id && (u.name || u.username))
    .map((u) => ({ id: u.id!, name: (u.name ?? u.username ?? u.id!) as string }));

  const canWrite = access.canWrite;

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title="Service Board"
        subtitle={`${total} ${total === 1 ? "post" : "posts"} · team ${access.team}`}
        live
      />

      <NewPostPanel
        categories={cfg.categories}
        serviceTypes={cfg.service_types}
        mentionCandidates={mentionCandidates}
        canWrite={canWrite}
      />

      <BoardFilters starred={query.starred} />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-[var(--text-muted)]">
            <Icon name="file" size={24} />
            <p>No posts match the current filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Posts</CardTitle>
            <CardDescription>Pinned items first, then most-recent.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--border)]">
              {items.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <StatusChip status={statusToChip(row.status)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {row.pinned ? (
                        <Icon
                          name="flag"
                          size={12}
                          className="text-[var(--accent)]"
                        />
                      ) : null}
                      <a
                        href={`/v2/board/${row.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {row.title}
                      </a>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
                      {row.content ?? ""}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-subtle)]">
                      <span>{row.author_name ?? row.author_id}</span>
                      {row.board_type_name ? <span>· {row.board_type_name}</span> : null}
                      {row.service_type_name ? <span>· {row.service_type_name}</span> : null}
                      {row.comment_count > 0 ? (
                        <span>· {row.comment_count} comments</span>
                      ) : null}
                    </div>
                  </div>
                  <StarToggle postId={row.id} starred={row.starred} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
