// som-portal-v2/src/board/service.ts
//
// Board business logic, ported line-for-line from v1:
//   api/board/index.php         — list / create / update / pin / soft-delete
//   api/board/trash.php         — trash list / restore / hard-delete / purge
//   api/board-comments/index.php— comment list / counts / create / edit / delete
//   api/stars/index.php         — personal bookmarks
//   api/board-config/index.php  — categories + service-type taxonomy (read)
//
// Every function takes the `BoardAccess` produced by `src/board/access.ts`
// (session + effective team + write mode) — never a global.
import { randomBytes } from 'node:crypto';
import {
  NotFoundError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { logActivity } from '@/logging/activity';
import { getRateLimitBackend } from '@/lib/rate-limit';
import {
  BOARD_STATUSES,
  BoardStatusSchema,
  CreateCommentInput,
  CreatePostInput,
  UpdatePostInput,
  type BoardCategory,
  type BoardComment,
  type BoardListQuery,
  type BoardListRow,
  type BoardPost,
  type BoardServiceType,
  type Mention,
} from './schema';
import { canMutateOwn, isAdmin, isLead, type BoardAccess } from './access';
import { readSystemSettings } from './global-data';
import * as store from './storage';

// ── primitives matching v1 helpers ───────────────────────────────────────────

/** v1 `genId('post')` → `post_` + bin2hex(random_bytes(6)). */
export function genId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/** v1 `date('c')` → ISO 8601 with an explicit offset (existing rows use +00:00). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function ctx(access: BoardAccess): store.TeamCtx {
  return { session: access.session, team: access.team };
}

/** v1 `apiRateLimit($sub, $group)` — 120 req / 60 s per user per group. */
async function rateLimit(access: BoardAccess, group: string): Promise<void> {
  const settings = await readSystemSettings();
  const res = await getRateLimitBackend().check(
    `api:${access.session.sub}:${group}`,
    settings.api_rate_limit_requests,
    settings.api_rate_limit_window_seconds,
  );
  if (!res.ok) throw new RateLimitError(res.retryAfterMs);
}

function activity(
  access: BoardAccess,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  return logActivity({ user: access.session.sub, team: access.team, action, meta });
}

// ── list ─────────────────────────────────────────────────────────────────────

export interface BoardListResult {
  items: BoardListRow[];
  total: number;
}

/**
 * GET /api/board — v1 filter order: drop soft-deleted → board_type → status →
 * author_id → search (title/content/author_name, case-insensitive) → starred,
 * then sort pinned-first + created_at desc, then paginate, then enrich
 * `starred`. v2 adds `comment_count` (v1 fetches it from a second endpoint).
 */
export async function listPosts(
  access: BoardAccess,
  query: BoardListQuery,
): Promise<BoardListResult> {
  await rateLimit(access, 'board');
  const c = ctx(access);
  const [all, stars, comments] = await Promise.all([
    store.readPosts(c),
    store.readStars(c),
    store.readComments(c),
  ]);

  const myStars = new Set(
    stars.filter((s) => s.user_id === access.session.sub).map((s) => s.post_id),
  );

  let posts = all.filter((p) => !p.deleted_at);
  if (query.board_type) posts = posts.filter((p) => p.board_type === query.board_type);
  if (query.status && BOARD_STATUSES.includes(query.status)) {
    posts = posts.filter((p) => (p.status ?? 'open') === query.status);
  }
  if (query.author_id) posts = posts.filter((p) => p.author_id === query.author_id);
  if (query.search) {
    const needle = query.search.toLowerCase();
    posts = posts.filter(
      (p) =>
        p.title.toLowerCase().includes(needle) ||
        (p.content ?? '').toLowerCase().includes(needle) ||
        (p.author_name ?? '').toLowerCase().includes(needle),
    );
    await activity(access, 'board_search', {
      query: query.search,
      board_type: query.board_type,
      status: query.status ?? '',
    });
  }
  if (query.starred) posts = posts.filter((p) => myStars.has(p.id));

  posts.sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });

  const total = posts.length;
  const paged = posts.slice(query.offset, query.offset + query.limit);

  const counts = new Map<string, number>();
  for (const cm of comments) {
    if (cm.deleted_at) continue;
    counts.set(cm.post_id, (counts.get(cm.post_id) ?? 0) + 1);
  }

  return {
    total,
    items: paged.map((p) => ({
      ...p,
      starred: myStars.has(p.id),
      comment_count: counts.get(p.id) ?? 0,
    })),
  };
}

/** GET /api/board?since=ISO — poll for new posts. */
export async function listPostsSince(
  access: BoardAccess,
  since: string,
): Promise<{ count: number; posts: BoardPost[] }> {
  const posts = (await store.readPosts(ctx(access))).filter(
    (p) => !p.deleted_at && (p.created_at ?? '') > since,
  );
  return { count: posts.length, posts };
}

export async function getPost(access: BoardAccess, id: string): Promise<BoardListRow> {
  const c = ctx(access);
  const [posts, stars, comments] = await Promise.all([
    store.readPosts(c),
    store.readStars(c),
    store.readComments(c),
  ]);
  const post = posts.find((p) => p.id === id && !p.deleted_at);
  if (!post) throw new NotFoundError('Post not found');
  return {
    ...post,
    starred: stars.some((s) => s.user_id === access.session.sub && s.post_id === id),
    comment_count: comments.filter((cm) => cm.post_id === id && !cm.deleted_at).length,
  };
}

// ── create ───────────────────────────────────────────────────────────────────

export async function createPost(
  access: BoardAccess,
  input: unknown,
): Promise<BoardPost> {
  await rateLimit(access, 'board');
  const parsed = CreatePostInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'Invalid post',
    );
  }
  const body = parsed.data;
  const ts = nowIso();
  const post: BoardPost = {
    id: genId('post'),
    title: body.title,
    content: body.content,
    mentions: body.mentions,
    status: body.status,
    image_url: body.image_url ?? null,
    board_type: body.board_type,
    board_type_name: body.board_type_name,
    service_type_id: body.service_type_id,
    service_type_name: body.service_type_name,
    service_subtype_id: body.service_subtype_id,
    service_subtype_name: body.service_subtype_name,
    pinned: false,
    edit_history: [],
    author_id: access.session.sub,
    author_name: access.actorName,
    author_role: access.session.role,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    deleted_by: null,
    deleted_by_name: null,
  };

  const c = ctx(access);
  const posts = await store.readPosts(c);
  posts.push(post);
  await store.writePosts(c, posts);

  if (body.mentions.length > 0) {
    await notifyMentions(access, body.mentions, {
      post_id: post.id,
      post_title: post.title,
      body: post.content,
      allTitle: `${access.actorName} mentioned @allsm in a post`,
      oneTitle: `${access.actorName} mentioned you in a post`,
    });
  }

  await activity(access, 'board_create', {
    post_id: post.id,
    title: post.title,
    board_type: post.board_type_name,
    status: post.status,
  });
  return post;
}

// ── update (PUT) ─────────────────────────────────────────────────────────────

export async function updatePost(
  access: BoardAccess,
  id: string,
  input: unknown,
): Promise<BoardPost> {
  if (!id) throw new ValidationError('Post ID required');
  const parsed = UpdatePostInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid update');
  }
  const body = parsed.data;

  const c = ctx(access);
  const posts = await store.readPosts(c);
  const idx = posts.findIndex((p) => p.id === id);
  if (idx < 0) throw new NotFoundError('Post not found');
  const post = posts[idx]!;

  if (!canMutateOwn(access.session.role, access.session.sub, post.author_id)) {
    throw new ForbiddenError('Not authorized to edit this post');
  }

  // Snapshot BEFORE mutating, newest-first, capped at 20 (v1 array_slice).
  const oldStatus = post.status ?? 'open';
  const history = [
    {
      edited_at: nowIso(),
      editor_id: access.session.sub,
      editor_name: access.actorName,
      old_title: post.title,
      old_content: post.content ?? '',
      old_status: oldStatus,
    },
    ...(post.edit_history ?? []),
  ].slice(0, 20);

  const next: BoardPost = { ...post, edit_history: history };
  if (body.title !== undefined) next.title = body.title;
  if (body.content !== undefined) next.content = body.content;
  if (body.image_url !== undefined) next.image_url = body.image_url ?? null;
  if (body.board_type !== undefined) next.board_type = body.board_type;
  if (body.board_type_name !== undefined) next.board_type_name = body.board_type_name;
  if (body.service_type_id !== undefined) next.service_type_id = body.service_type_id;
  if (body.service_type_name !== undefined) next.service_type_name = body.service_type_name;
  if (body.service_subtype_id !== undefined) next.service_subtype_id = body.service_subtype_id;
  if (body.service_subtype_name !== undefined) {
    next.service_subtype_name = body.service_subtype_name;
  }
  if (body.status !== undefined) next.status = body.status;
  next.updated_at = nowIso();

  posts[idx] = next;
  await store.writePosts(c, posts);

  if (body.status !== undefined && body.status !== oldStatus) {
    await activity(access, 'board_status_change', {
      post_id: id,
      title: next.title,
      from: oldStatus,
      to: body.status,
    });
  }
  await activity(access, 'board_update', { post_id: id, title: next.title });
  return next;
}

/** Convenience wrapper used by the detail page's status dropdown. */
export function setPostStatus(
  access: BoardAccess,
  id: string,
  status: unknown,
): Promise<BoardPost> {
  const parsed = BoardStatusSchema.safeParse(status);
  if (!parsed.success) throw new ValidationError('Invalid status');
  return updatePost(access, id, { status: parsed.data });
}

// ── pin (PATCH) — lead+ only ─────────────────────────────────────────────────

export async function togglePin(access: BoardAccess, id: string): Promise<boolean> {
  if (!id) throw new ValidationError('Post ID required');
  if (!isLead(access.session.role)) {
    throw new ForbiddenError('Forbidden: insufficient permissions');
  }
  const c = ctx(access);
  const posts = await store.readPosts(c);
  const idx = posts.findIndex((p) => p.id === id);
  if (idx < 0) throw new NotFoundError('Post not found');
  const pinned = !(posts[idx]!.pinned ?? false);
  posts[idx] = { ...posts[idx]!, pinned };
  await store.writePosts(c, posts);
  await activity(access, 'board_pin', { post_id: id, pinned });
  return pinned;
}

// ── soft-delete (DELETE) ─────────────────────────────────────────────────────

export async function softDeletePost(access: BoardAccess, id: string): Promise<void> {
  if (!id) throw new ValidationError('Post ID required');
  const c = ctx(access);
  const posts = await store.readPosts(c);
  const idx = posts.findIndex((p) => p.id === id);
  if (idx < 0) throw new NotFoundError('Post not found');
  const post = posts[idx]!;
  if (post.deleted_at) throw new NotFoundError('Post already deleted');
  if (!canMutateOwn(access.session.role, access.session.sub, post.author_id)) {
    throw new ForbiddenError('Not authorized to delete this post');
  }
  posts[idx] = {
    ...post,
    deleted_at: nowIso(),
    deleted_by: access.session.sub,
    deleted_by_name: access.actorName,
  };
  await store.writePosts(c, posts);
  await activity(access, 'board_delete', { post_id: id, title: post.title, soft: true });
}

// ── trash (api/board/trash.php) — lead+ only ─────────────────────────────────

export interface TrashRow {
  entity: 'post' | 'comment';
  days_left: number;
}
export type TrashPost = BoardPost & TrashRow;
export type TrashComment = BoardComment & TrashRow;

function daysLeft(deletedAt: string, retentionDays: number): number {
  const daysAgo = (Date.now() - new Date(deletedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(retentionDays - daysAgo));
}

export function requireTrashAccess(access: BoardAccess): void {
  if (!isLead(access.session.role)) {
    throw new ForbiddenError('Forbidden: insufficient permissions');
  }
}

export async function listTrash(
  access: BoardAccess,
): Promise<{ posts: TrashPost[]; comments: TrashComment[]; retention_days: number }> {
  requireTrashAccess(access);
  const c = ctx(access);
  const settings = await readSystemSettings();
  const retention = settings.trash_retention_days;
  const [posts, comments] = await Promise.all([store.readPosts(c), store.readComments(c)]);

  const deletedPosts = posts
    .filter((p): p is BoardPost & { deleted_at: string } => Boolean(p.deleted_at))
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
    .map((p) => ({ ...p, days_left: daysLeft(p.deleted_at, retention), entity: 'post' as const }));

  const deletedComments = comments
    .filter((cm): cm is BoardComment & { deleted_at: string } => Boolean(cm.deleted_at))
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
    .map((cm) => ({
      ...cm,
      days_left: daysLeft(cm.deleted_at, retention),
      entity: 'comment' as const,
    }));

  return { posts: deletedPosts, comments: deletedComments, retention_days: retention };
}

export async function restorePost(access: BoardAccess, id: string): Promise<void> {
  requireTrashAccess(access);
  if (!id) throw new ValidationError('ID required');
  const c = ctx(access);
  const posts = await store.readPosts(c);
  const idx = posts.findIndex((p) => p.id === id && Boolean(p.deleted_at));
  if (idx < 0) throw new NotFoundError('Post not found in trash');
  posts[idx] = { ...posts[idx]!, deleted_at: null, deleted_by: null, deleted_by_name: null };
  await store.writePosts(c, posts);
  await activity(access, 'board_restore', { post_id: id });
}

export async function restoreComment(access: BoardAccess, id: string): Promise<void> {
  requireTrashAccess(access);
  if (!id) throw new ValidationError('ID required');
  const c = ctx(access);
  const rows = await store.readComments(c);
  const idx = rows.findIndex((cm) => cm.id === id && Boolean(cm.deleted_at));
  if (idx < 0) throw new NotFoundError('Comment not found in trash');
  rows[idx] = { ...rows[idx]!, deleted_at: null, deleted_by: null, deleted_by_name: null };
  await store.writeComments(c, rows);
  await activity(access, 'comment_restore', { comment_id: id });
}

/** Hard delete — admin only (v1 requireRole ADMIN_ROLES in trash.php DELETE). */
export async function hardDelete(
  access: BoardAccess,
  entity: 'post' | 'comment',
  id: string,
): Promise<void> {
  if (!isAdmin(access.session.role)) {
    throw new ForbiddenError('Forbidden: insufficient permissions');
  }
  if (!id) throw new ValidationError('ID required');
  const c = ctx(access);
  if (entity === 'comment') {
    const rows = await store.readComments(c);
    const filtered = rows.filter((cm) => cm.id !== id);
    if (filtered.length === rows.length) throw new NotFoundError('Comment not found');
    await store.writeComments(c, filtered);
  } else {
    const rows = await store.readPosts(c);
    const filtered = rows.filter((p) => p.id !== id);
    if (filtered.length === rows.length) throw new NotFoundError('Post not found');
    await store.writePosts(c, filtered);
  }
  await activity(access, 'board_hard_delete', { entity, id });
}

/** Purge everything past the retention window — admin only. */
export async function purgeTrash(
  access: BoardAccess,
): Promise<{ posts_purged: number; comments_purged: number }> {
  if (!isAdmin(access.session.role)) {
    throw new ForbiddenError('Forbidden: insufficient permissions');
  }
  const c = ctx(access);
  const settings = await readSystemSettings();
  const cutoff = Date.now() - settings.trash_retention_days * 86_400_000;
  const [posts, comments] = await Promise.all([store.readPosts(c), store.readComments(c)]);

  const keptPosts = posts.filter(
    (p) => !p.deleted_at || new Date(p.deleted_at).getTime() > cutoff,
  );
  const keptComments = comments.filter(
    (cm) => !cm.deleted_at || new Date(cm.deleted_at).getTime() > cutoff,
  );
  const posts_purged = posts.length - keptPosts.length;
  const comments_purged = comments.length - keptComments.length;

  await store.writePosts(c, keptPosts);
  await store.writeComments(c, keptComments);
  await activity(access, 'board_auto_purge', {
    posts_purged,
    comments_purged,
    retention_days: settings.trash_retention_days,
  });
  return { posts_purged, comments_purged };
}

// ── comments ─────────────────────────────────────────────────────────────────

export async function listComments(
  access: BoardAccess,
  postId: string,
): Promise<BoardComment[]> {
  if (!postId) throw new ValidationError('post_id required');
  const rows = await store.readComments(ctx(access));
  return rows
    .filter((cm) => cm.post_id === postId && !cm.deleted_at)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

export async function commentCounts(
  access: BoardAccess,
  postIds: string[],
): Promise<Record<string, number>> {
  const rows = await store.readComments(ctx(access));
  const out: Record<string, number> = {};
  for (const id of postIds) {
    out[id] = rows.filter((cm) => cm.post_id === id && !cm.deleted_at).length;
  }
  return out;
}

export async function addComment(
  access: BoardAccess,
  input: unknown,
): Promise<BoardComment> {
  const parsed = CreateCommentInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid comment');
  }
  await rateLimit(access, 'comments');
  const body = parsed.data;
  const c = ctx(access);

  const posts = await store.readPosts(c);
  const post = posts.find((p) => p.id === body.post_id);
  if (!post) throw new NotFoundError('Post not found');

  const comment: BoardComment = {
    id: genId('cmt'),
    post_id: body.post_id,
    content: body.content,
    mentions: body.mentions,
    author_id: access.session.sub,
    author_name: access.actorName,
    created_at: nowIso(),
    deleted_at: null,
    deleted_by: null,
    deleted_by_name: null,
  };

  const rows = await store.readComments(c);
  rows.push(comment);
  await store.writeComments(c, rows);

  const notified = await notifyMentions(access, body.mentions, {
    post_id: body.post_id,
    post_title: post.title,
    body: body.content,
    allTitle: `${access.actorName} mentioned @allsm`,
    oneTitle: `${access.actorName} mentioned you`,
  });

  // Notify the post author too, unless self or already mentioned (v1 parity).
  if (post.author_id && post.author_id !== access.session.sub && !notified.has(post.author_id)) {
    await appendNotifications(access, [
      buildNotification({
        user_id: post.author_id,
        type: 'comment',
        title: `${access.actorName} commented on your post`,
        body: body.content,
        post_id: body.post_id,
        post_title: post.title,
        from_user_id: access.session.sub,
        from_user_name: access.actorName,
      }),
    ]);
  }

  await activity(access, 'board_comment', {
    post_id: body.post_id,
    comment_id: comment.id,
    mentions: body.mentions.length,
  });
  return comment;
}

export async function updateComment(
  access: BoardAccess,
  id: string,
  content: string,
): Promise<BoardComment> {
  if (!id) throw new ValidationError('Comment ID required');
  const trimmed = content.trim();
  if (!trimmed) throw new ValidationError('Content required');
  if (trimmed.length > 5_000) throw new ValidationError('Comment too long (max 5,000 chars)');

  const c = ctx(access);
  const rows = await store.readComments(c);
  const idx = rows.findIndex((cm) => cm.id === id);
  if (idx < 0) throw new NotFoundError('Comment not found');
  const row = rows[idx]!;
  if (row.deleted_at) throw new NotFoundError('Comment deleted');
  if (row.author_id !== access.session.sub) throw new ForbiddenError('Forbidden');

  rows[idx] = { ...row, content: trimmed, updated_at: nowIso() };
  await store.writeComments(c, rows);
  await activity(access, 'comment_edit', { comment_id: id });
  return rows[idx]!;
}

export async function deleteComment(access: BoardAccess, id: string): Promise<void> {
  if (!id) throw new ValidationError('Comment ID required');
  const c = ctx(access);
  const rows = await store.readComments(c);
  const idx = rows.findIndex((cm) => cm.id === id);
  if (idx < 0) throw new NotFoundError('Comment not found');
  const row = rows[idx]!;
  if (row.deleted_at) throw new NotFoundError('Comment already deleted');
  if (!canMutateOwn(access.session.role, access.session.sub, row.author_id)) {
    throw new ForbiddenError('Forbidden');
  }
  rows[idx] = {
    ...row,
    deleted_at: nowIso(),
    deleted_by: access.session.sub,
    deleted_by_name: access.actorName,
  };
  await store.writeComments(c, rows);
  await activity(access, 'comment_delete', { comment_id: id, soft: true });
}

// ── stars (personal bookmarks) ───────────────────────────────────────────────

export async function listStars(access: BoardAccess): Promise<string[]> {
  const rows = await store.readStars(ctx(access));
  return rows.filter((s) => s.user_id === access.session.sub).map((s) => s.post_id);
}

/** Idempotent, like v1. Returns true when a new star row was written. */
export async function starPost(access: BoardAccess, postId: string): Promise<boolean> {
  if (!postId) throw new ValidationError('post_id required');
  await rateLimit(access, 'stars');
  const c = ctx(access);
  const posts = await store.readPosts(c);
  if (!posts.some((p) => p.id === postId && !p.deleted_at)) {
    throw new NotFoundError('Post not found');
  }
  const rows = await store.readStars(c);
  if (rows.some((s) => s.user_id === access.session.sub && s.post_id === postId)) {
    return false;
  }
  rows.push({
    id: genId('star'),
    user_id: access.session.sub,
    post_id: postId,
    starred_at: nowIso(),
  });
  await store.writeStars(c, rows);
  await activity(access, 'board_star', { post_id: postId });
  return true;
}

export async function unstarPost(access: BoardAccess, postId: string): Promise<void> {
  if (!postId) throw new ValidationError('post_id required');
  const c = ctx(access);
  const rows = await store.readStars(c);
  const filtered = rows.filter(
    (s) => !(s.user_id === access.session.sub && s.post_id === postId),
  );
  await store.writeStars(c, filtered);
  await activity(access, 'board_unstar', { post_id: postId });
}

// ── board-config (read-only here; admin CRUD stays in v1 for now) ────────────

export async function getBoardConfig(
  access: BoardAccess,
): Promise<{ categories: BoardCategory[]; service_types: BoardServiceType[] }> {
  const c = ctx(access);
  const [categories, service_types] = await Promise.all([
    store.readCategories(c),
    store.readServiceTypes(c),
  ]);
  return {
    categories: [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    service_types: [...service_types].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  };
}

// ── notifications ────────────────────────────────────────────────────────────

interface NotificationSeed {
  user_id: string;
  type: string;
  title: string;
  body: string;
  post_id: string;
  post_title: string;
  from_user_id: string;
  from_user_name: string;
}

function buildNotification(seed: NotificationSeed) {
  return {
    id: genId('notif'),
    user_id: seed.user_id,
    type: seed.type,
    title: seed.title,
    body: seed.body.slice(0, 120),
    post_id: seed.post_id,
    post_title: seed.post_title,
    read: false,
    from_user_id: seed.from_user_id,
    from_user_name: seed.from_user_name,
    created_at: nowIso(),
  };
}

async function appendNotifications(
  access: BoardAccess,
  rows: ReturnType<typeof buildNotification>[],
): Promise<void> {
  if (rows.length === 0) return;
  const c = ctx(access);
  const existing = await store.readNotifications(c);
  await store.writeNotifications(c, [...existing, ...rows]);
}

/**
 * v1 mention fan-out. `__all__` (the @allsm sentinel) expands to every user —
 * scoped to the effective team in v2, because notifications.json is per-team
 * and cross-team ids could never read them anyway.
 */
async function notifyMentions(
  access: BoardAccess,
  mentions: Mention[],
  meta: {
    post_id: string;
    post_title: string;
    body: string;
    allTitle: string;
    oneTitle: string;
  },
): Promise<Set<string>> {
  const notified = new Set<string>();
  if (mentions.length === 0) return notified;

  const hasAll = mentions.some((m) => m.id === '__all__');
  const seeds: ReturnType<typeof buildNotification>[] = [];

  if (hasAll) {
    const { listTeamUsers } = await import('./global-data');
    const users = await listTeamUsers(access.team);
    for (const u of users) {
      if (u.id === access.session.sub) continue;
      notified.add(u.id);
      seeds.push(
        buildNotification({
          user_id: u.id,
          type: 'mention',
          title: meta.allTitle,
          body: meta.body,
          post_id: meta.post_id,
          post_title: meta.post_title,
          from_user_id: access.session.sub,
          from_user_name: access.actorName,
        }),
      );
    }
  } else {
    for (const m of mentions) {
      if (!m.id || m.id === access.session.sub || notified.has(m.id)) continue;
      notified.add(m.id);
      seeds.push(
        buildNotification({
          user_id: m.id,
          type: 'mention',
          title: meta.oneTitle,
          body: meta.body,
          post_id: meta.post_id,
          post_title: meta.post_title,
          from_user_id: access.session.sub,
          from_user_name: access.actorName,
        }),
      );
    }
  }

  await appendNotifications(access, seeds);
  return notified;
}
