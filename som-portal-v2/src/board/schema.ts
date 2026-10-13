// som-portal-v2/src/board/schema.ts
//
// Zod schemas for the Board module. Field names mirror v1 1:1 so the PHP app
// and v2 can dual-run against the same `data/<team>/board.json`,
// `board-comments.json`, `stars.json`, `board_categories.json` and
// `board_service_types.json`.
//
// v1 source of truth: api/board/index.php, api/board/trash.php,
// api/board-comments/index.php, api/board-config/index.php, api/stars/index.php
import { z } from 'zod';

export const BOARD_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export const BoardStatusSchema = z.enum(BOARD_STATUSES);
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** v1 stores mentions as `[{ id, name }]`. `__all__` is the @allsm sentinel. */
export const MentionSchema = z
  .object({ id: z.string().default(''), name: z.string().default('') })
  .passthrough();
export type Mention = z.infer<typeof MentionSchema>;

export const EditHistoryEntrySchema = z
  .object({
    edited_at: z.string(),
    editor_id: z.string().default(''),
    editor_name: z.string().default(''),
    old_title: z.string().default(''),
    old_content: z.string().default(''),
    old_status: z.string().default('open'),
  })
  .passthrough();
export type EditHistoryEntry = z.infer<typeof EditHistoryEntrySchema>;

/**
 * A board post exactly as v1 writes it. Reads stay permissive (`.passthrough()`,
 * optional/defaulted fields) because rows written by older PHP versions are
 * missing keys (e.g. the first posts have no `mentions`).
 */
export const BoardPostSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string().nullish().transform((v) => v ?? ''),
    mentions: z.array(MentionSchema).optional().default([]),
    status: BoardStatusSchema.catch('open').optional().default('open'),
    image_url: z.string().nullish().default(null),
    board_type: z.string().nullish().transform((v) => v ?? ''),
    board_type_name: z.string().nullish().transform((v) => v ?? ''),
    service_type_id: z.string().nullish().transform((v) => v ?? ''),
    service_type_name: z.string().nullish().transform((v) => v ?? ''),
    service_subtype_id: z.string().nullish().transform((v) => v ?? ''),
    service_subtype_name: z.string().nullish().transform((v) => v ?? ''),
    pinned: z.boolean().optional().default(false),
    edit_history: z.array(EditHistoryEntrySchema).optional().default([]),
    author_id: z.string().default(''),
    author_name: z.string().default(''),
    author_role: z.string().optional().default(''),
    created_at: z.string().default(''),
    updated_at: z.string().optional().default(''),
    deleted_at: z.string().nullish().default(null),
    deleted_by: z.string().nullish().default(null),
    deleted_by_name: z.string().nullish().default(null),
  })
  .passthrough();
export type BoardPost = z.infer<typeof BoardPostSchema>;

export const BoardFileSchema = z.array(BoardPostSchema);

/** List row shipped to the client — adds the per-user `starred` flag (v1 does
 *  the same enrichment in api/board/index.php) plus a comment count. */
export interface BoardListRow extends BoardPost {
  starred: boolean;
  comment_count: number;
}

export const BoardCommentSchema = z
  .object({
    id: z.string(),
    post_id: z.string(),
    content: z.string().default(''),
    mentions: z.array(MentionSchema).optional().default([]),
    author_id: z.string().default(''),
    author_name: z.string().default(''),
    created_at: z.string().default(''),
    updated_at: z.string().optional(),
    deleted_at: z.string().nullish().default(null),
    deleted_by: z.string().nullish().default(null),
    deleted_by_name: z.string().nullish().default(null),
  })
  .passthrough();
export type BoardComment = z.infer<typeof BoardCommentSchema>;
export const BoardCommentsFileSchema = z.array(BoardCommentSchema);

export const StarSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    post_id: z.string(),
    starred_at: z.string().optional().default(''),
  })
  .passthrough();
export type Star = z.infer<typeof StarSchema>;
export const StarsFileSchema = z.array(StarSchema);

// ── board-config (categories / service types) ────────────────────────────────
export const BoardCategorySchema = z
  .object({ id: z.string(), name: z.string(), order: z.number().optional().default(0) })
  .passthrough();
export type BoardCategory = z.infer<typeof BoardCategorySchema>;
export const BoardCategoriesFileSchema = z.array(BoardCategorySchema);

export const BoardSubtypeSchema = z
  .object({ id: z.string(), name: z.string(), order: z.number().optional().default(0) })
  .passthrough();

export const BoardServiceTypeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    order: z.number().optional().default(0),
    subtypes: z.array(BoardSubtypeSchema).optional().default([]),
  })
  .passthrough();
export type BoardServiceType = z.infer<typeof BoardServiceTypeSchema>;
export const BoardServiceTypesFileSchema = z.array(BoardServiceTypeSchema);

// ── notifications (v1 writes these on mention / comment) ─────────────────────
export const NotificationSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    type: z.string(),
    title: z.string().default(''),
    body: z.string().default(''),
    post_id: z.string().optional().default(''),
    post_title: z.string().optional().default(''),
    read: z.boolean().optional().default(false),
    from_user_id: z.string().optional().default(''),
    from_user_name: z.string().optional().default(''),
    created_at: z.string().default(''),
  })
  .passthrough();
export type Notification = z.infer<typeof NotificationSchema>;
export const NotificationsFileSchema = z.array(NotificationSchema);

// ── write payloads ───────────────────────────────────────────────────────────
// v1 limits: title <= 300, content <= 20000, comment <= 5000.
export const CreatePostInput = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300, 'Title too long (max 300 chars)'),
  content: z.string().max(20_000, 'Content too long (max 20,000 chars)').optional().default(''),
  status: BoardStatusSchema.optional().default('open'),
  board_type: z.string().optional().default(''),
  board_type_name: z.string().optional().default(''),
  service_type_id: z.string().optional().default(''),
  service_type_name: z.string().optional().default(''),
  service_subtype_id: z.string().optional().default(''),
  service_subtype_name: z.string().optional().default(''),
  image_url: z.string().nullish().default(null),
  mentions: z.array(MentionSchema).optional().default([]),
});
export type CreatePostInput = z.infer<typeof CreatePostInput>;

/** PUT /api/board — every field optional; only provided keys are applied. */
export const UpdatePostInput = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().max(20_000).optional(),
  status: BoardStatusSchema.optional(),
  board_type: z.string().optional(),
  board_type_name: z.string().optional(),
  service_type_id: z.string().optional(),
  service_type_name: z.string().optional(),
  service_subtype_id: z.string().optional(),
  service_subtype_name: z.string().optional(),
  image_url: z.string().nullish(),
});
export type UpdatePostInput = z.infer<typeof UpdatePostInput>;

export const CreateCommentInput = z.object({
  post_id: z.string().min(1, 'post_id required'),
  content: z.string().trim().min(1, 'Content required').max(5_000, 'Comment too long (max 5,000 chars)'),
  mentions: z.array(MentionSchema).optional().default([]),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const UpdateCommentInput = z.object({
  content: z.string().trim().min(1, 'Content required').max(5_000, 'Comment too long (max 5,000 chars)'),
});

/** Query shape for the list page / GET /api/v1/board. */
export const BoardListQuery = z.object({
  search: z.string().trim().optional().default(''),
  board_type: z.string().optional().default(''),
  status: BoardStatusSchema.optional(),
  author_id: z.string().optional().default(''),
  starred: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === '1' || v === 'true'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type BoardListQuery = z.infer<typeof BoardListQuery>;
