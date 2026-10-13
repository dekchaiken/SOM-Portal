// som-portal-v2/src/board/storage.ts
//
// Team-scoped I/O for the board files. Everything funnels through here so no
// call site can accidentally read `data/<file>` (the v1 root) for a file that
// belongs to a team — that's the leak `team_data_path_helper` warns about.
//
// The normal path delegates to `readTeamFile`/`writeTeamFile` (session team).
// When the effective team differs from the session team — the per-user
// `extra_pages` cross-team grant from v1 `applyExtraPageTeam()` — we go through
// the data adapter directly and emit a security log entry, because
// `readTeamFile({team})` is reserved for super_admin.
import type { ZodSchema, ZodType, ZodTypeDef } from 'zod';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { getDataAdapter } from '@/data/json-adapter';
import { logSecurity } from '@/logging/security';
import type { Session } from '@/auth/session';
import {
  BoardCategoriesFileSchema,
  BoardCommentsFileSchema,
  BoardFileSchema,
  BoardServiceTypesFileSchema,
  NotificationsFileSchema,
  StarsFileSchema,
  type BoardCategory,
  type BoardComment,
  type BoardPost,
  type BoardServiceType,
  type Notification,
  type Star,
} from './schema';

export const BOARD_FILE = 'board.json';
export const COMMENTS_FILE = 'board-comments.json';
export const STARS_FILE = 'stars.json';
export const CATEGORIES_FILE = 'board_categories.json';
export const SERVICE_TYPES_FILE = 'board_service_types.json';
export const NOTIFICATIONS_FILE = 'notifications.json';

export interface TeamCtx {
  session: Session;
  team: string;
}

/**
 * Board schemas use `.passthrough()` + per-field defaults, so Zod's input and
 * output types differ. `readTeamFile`/`writeTeamFile` are typed `ZodSchema<T>`
 * (input === output), hence the single cast at this boundary — the parse that
 * actually runs is the same one either way.
 */
type FileSchema<T> = ZodType<T, ZodTypeDef, never[] | unknown>;
const asShared = <T>(schema: FileSchema<T>): ZodSchema<T> => schema as unknown as ZodSchema<T>;

function isCrossTeam(ctx: TeamCtx): boolean {
  return ctx.team !== ctx.session.team;
}

async function readScoped<T>(ctx: TeamCtx, file: string, schema: FileSchema<T>): Promise<T> {
  if (!isCrossTeam(ctx)) {
    // Missing file → adapter returns null → readTeamFile's soft-fail path. We
    // pre-empt it so an absent board.json reads as an empty list, like v1.
    const raw = await getDataAdapter().read<unknown>({ team: ctx.team }, file);
    if (raw === null) return schema.parse([]);
    return readTeamFile(file, asShared(schema));
  }
  await logSecurity({
    user: ctx.session.sub,
    team: ctx.session.team,
    event: 'cross_team_access',
    meta: { requested_team: ctx.team, file, grant: 'extra_pages:board' },
  });
  const raw = await getDataAdapter().read<unknown>({ team: ctx.team }, file);
  const parsed = schema.safeParse(raw ?? []);
  if (parsed.success) return parsed.data;
  console.error(`[board.storage] schema drift: ${ctx.team}/${file}`, parsed.error.flatten());
  return schema.parse([]);
}

async function writeScoped<T>(
  ctx: TeamCtx,
  file: string,
  data: T,
  schema: FileSchema<T>,
): Promise<void> {
  if (!isCrossTeam(ctx)) {
    await writeTeamFile(file, data, asShared(schema));
    return;
  }
  await logSecurity({
    user: ctx.session.sub,
    team: ctx.session.team,
    event: 'cross_team_write',
    meta: { target_team: ctx.team, file, grant: 'extra_pages:board' },
  });
  await getDataAdapter().write({ team: ctx.team }, file, schema.parse(data));
}

export const readPosts = (ctx: TeamCtx): Promise<BoardPost[]> =>
  readScoped(ctx, BOARD_FILE, BoardFileSchema);
export const writePosts = (ctx: TeamCtx, posts: BoardPost[]): Promise<void> =>
  writeScoped(ctx, BOARD_FILE, posts, BoardFileSchema);

export const readComments = (ctx: TeamCtx): Promise<BoardComment[]> =>
  readScoped(ctx, COMMENTS_FILE, BoardCommentsFileSchema);
export const writeComments = (ctx: TeamCtx, rows: BoardComment[]): Promise<void> =>
  writeScoped(ctx, COMMENTS_FILE, rows, BoardCommentsFileSchema);

export const readStars = (ctx: TeamCtx): Promise<Star[]> =>
  readScoped(ctx, STARS_FILE, StarsFileSchema);
export const writeStars = (ctx: TeamCtx, rows: Star[]): Promise<void> =>
  writeScoped(ctx, STARS_FILE, rows, StarsFileSchema);

export const readCategories = (ctx: TeamCtx): Promise<BoardCategory[]> =>
  readScoped(ctx, CATEGORIES_FILE, BoardCategoriesFileSchema);

export const readServiceTypes = (ctx: TeamCtx): Promise<BoardServiceType[]> =>
  readScoped(ctx, SERVICE_TYPES_FILE, BoardServiceTypesFileSchema);

export const readNotifications = (ctx: TeamCtx): Promise<Notification[]> =>
  readScoped(ctx, NOTIFICATIONS_FILE, NotificationsFileSchema);
export const writeNotifications = (ctx: TeamCtx, rows: Notification[]): Promise<void> =>
  writeScoped(ctx, NOTIFICATIONS_FILE, rows, NotificationsFileSchema);
