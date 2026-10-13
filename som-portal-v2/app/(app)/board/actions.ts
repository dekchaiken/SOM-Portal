// som-portal-v2/app/(app)/board/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireBoardRead, requireBoardWrite } from "@/board/access";
import * as board from "@/board/service";
import { err, ok, type Result } from "@/lib/result";
import { AppError } from "@/lib/errors";
import type { BoardPost, BoardComment, Mention } from "@/board/schema";

/**
 * Server Actions for the Board module. Each one re-runs the full access gate
 * server-side (`requireBoardWrite` = auth + extra_pages team + team feature +
 * menu-permissions + page_modes), so a client that forges a payload still
 * can't reach another team's data.
 */

function fail<T>(e: unknown): Result<T> {
  if (e instanceof AppError) return err<T>(e.message, e.code);
  console.error("[board.action]", e);
  return err<T>("Unexpected error", "internal_error");
}

function refresh(postId?: string): void {
  revalidatePath("/board");
  revalidatePath("/board/trash");
  if (postId) revalidatePath(`/board/${postId}`);
}

function parseMentions(raw: FormDataEntryValue | null): Mention[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((m) =>
      m && typeof m === "object" && "id" in m
        ? [{ id: String((m as { id: unknown }).id), name: String((m as { name?: unknown }).name ?? "") }]
        : [],
    );
  } catch {
    return [];
  }
}

export async function createPost(fd: FormData): Promise<Result<BoardPost>> {
  try {
    const access = await requireBoardWrite();
    const post = await board.createPost(access, {
      title: fd.get("title"),
      content: fd.get("content") ?? "",
      status: fd.get("status") || "open",
      board_type: fd.get("board_type") ?? "",
      board_type_name: fd.get("board_type_name") ?? "",
      service_type_id: fd.get("service_type_id") ?? "",
      service_type_name: fd.get("service_type_name") ?? "",
      service_subtype_id: fd.get("service_subtype_id") ?? "",
      service_subtype_name: fd.get("service_subtype_name") ?? "",
      mentions: parseMentions(fd.get("mentions")),
    });
    refresh(post.id);
    return ok(post);
  } catch (e) {
    return fail<BoardPost>(e);
  }
}

export async function updatePost(
  id: string,
  patch: Record<string, unknown>,
): Promise<Result<BoardPost>> {
  try {
    const access = await requireBoardWrite();
    const post = await board.updatePost(access, id, patch);
    refresh(id);
    return ok(post);
  } catch (e) {
    return fail<BoardPost>(e);
  }
}

export async function setStatus(id: string, status: string): Promise<Result<BoardPost>> {
  try {
    const access = await requireBoardWrite();
    const post = await board.setPostStatus(access, id, status);
    refresh(id);
    return ok(post);
  } catch (e) {
    return fail<BoardPost>(e);
  }
}

export async function pinPost(id: string): Promise<Result<{ pinned: boolean }>> {
  try {
    const access = await requireBoardWrite();
    const pinned = await board.togglePin(access, id);
    refresh(id);
    return ok({ pinned });
  } catch (e) {
    return fail<{ pinned: boolean }>(e);
  }
}

export async function softDeletePost(id: string): Promise<Result<null>> {
  try {
    const access = await requireBoardWrite();
    await board.softDeletePost(access, id);
    refresh(id);
    return ok(null);
  } catch (e) {
    return fail<null>(e);
  }
}

export async function restorePost(id: string): Promise<Result<null>> {
  try {
    const access = await requireBoardWrite();
    await board.restorePost(access, id);
    refresh(id);
    return ok(null);
  } catch (e) {
    return fail<null>(e);
  }
}

export async function restoreComment(id: string): Promise<Result<null>> {
  try {
    const access = await requireBoardWrite();
    await board.restoreComment(access, id);
    refresh();
    return ok(null);
  } catch (e) {
    return fail<null>(e);
  }
}

export async function hardDelete(
  entity: "post" | "comment",
  id: string,
): Promise<Result<null>> {
  try {
    const access = await requireBoardWrite();
    await board.hardDelete(access, entity, id);
    refresh();
    return ok(null);
  } catch (e) {
    return fail<null>(e);
  }
}

export async function addComment(fd: FormData): Promise<Result<BoardComment>> {
  try {
    const access = await requireBoardWrite();
    const postId = String(fd.get("post_id") ?? "");
    const comment = await board.addComment(access, {
      post_id: postId,
      content: fd.get("content"),
      mentions: parseMentions(fd.get("mentions")),
    });
    refresh(postId);
    return ok(comment);
  } catch (e) {
    return fail<BoardComment>(e);
  }
}

export async function deleteComment(
  id: string,
  postId: string,
): Promise<Result<null>> {
  try {
    const access = await requireBoardWrite();
    await board.deleteComment(access, id);
    refresh(postId);
    return ok(null);
  } catch (e) {
    return fail<null>(e);
  }
}

export async function starPost(id: string): Promise<Result<null>> {
  try {
    const access = await requireBoardWrite();
    await board.starPost(access, id);
    refresh(id);
    return ok(null);
  } catch (e) {
    return fail<null>(e);
  }
}

export async function unstarPost(id: string): Promise<Result<null>> {
  try {
    const access = await requireBoardWrite();
    await board.unstarPost(access, id);
    refresh(id);
    return ok(null);
  } catch (e) {
    return fail<null>(e);
  }
}

/** Used by the trash page's purge button (admin only). */
export async function purgeTrash(): Promise<
  Result<{ posts_purged: number; comments_purged: number }>
> {
  try {
    const access = await requireBoardWrite();
    const res = await board.purgeTrash(access);
    refresh();
    return ok(res);
  } catch (e) {
    return fail<{ posts_purged: number; comments_purged: number }>(e);
  }
}

/** Star list for client-side optimistic UI (not used by RSC paths). */
export async function listStars(): Promise<Result<string[]>> {
  try {
    const access = await requireBoardRead();
    return ok(await board.listStars(access));
  } catch (e) {
    return fail<string[]>(e);
  }
}
