// som-portal-v2/src/board/access.ts
//
// Multi-team / per-role access gate for the Board module.
//
// Ports the four v1 checks that decide whether a user may touch board data, in
// the same order api/helpers.php applies them:
//
//   1. requireAuth()                  — valid session
//   2. applyExtraPageTeam()           — per-user cross-team page grant, which
//                                       switches the data team BEFORE any read
//   3. requireTeamFeature('board')    — teams.json `features` (super_admin
//                                       bypasses; `board` is a default feature)
//   4. resolveUserMenus()             — menu-permissions.json role allow-list
//                                       plus the per-user grant/deny override,
//                                       and requirePagePermission() for the
//                                       `external` role (user.permissions)
//
// Writes additionally honour requirePageMode(): a team whose
// `page_modes.board === 'read'` may look but not change anything.
//
// Nothing here is bypassable from the client: every page and route handler
// calls `requireBoardRead()` / `requireBoardWrite()` server-side.
import { ForbiddenError } from '@/lib/errors';
import { requireAuth } from '@/auth/policy';
import type { Session } from '@/auth/session';
import { logSecurity } from '@/logging/security';
import { canSeePage } from '@/config/permissions';
import type { Role, SessionLike } from '@/config/nav';
import { findTeam, findUserById, type GlobalUser } from './global-data';

export const BOARD_PAGE_ID = 'board';
export const BOARD_FEATURE = 'board';

/** `defaultFeatures()` in api/helpers.php — granted to every team implicitly. */
export const DEFAULT_FEATURES = [
  'dashboard',
  'board',
  'team-docs',
  'sabai',
  'schedule',
  'learning',
] as const;

export interface BoardAccess {
  session: Session;
  /** Display name used for author_name / deleted_by_name (v1 JWT `name`). */
  actorName: string;
  /**
   * The team whose `data/<team>/board.json` this request reads and writes.
   * Equals `session.team` unless an admin granted the user an `extra_pages`
   * entry for `board` pointing at another team (v1 applyExtraPageTeam).
   */
  team: string;
  /** False when teams.json sets `page_modes.board = 'read'` for the team. */
  canWrite: boolean;
  user: GlobalUser | null;
}

const GLOBAL_READ_ROLES = ['super_admin', 'super_viewer'] as const;

function isGlobalReadRole(role: string): boolean {
  return (GLOBAL_READ_ROLES as readonly string[]).includes(role);
}

/** v1 applyExtraPageTeam(): per-user cross-team page grant. */
function resolveEffectiveTeam(session: Session, user: GlobalUser | null): string {
  const home = session.team;
  if (isGlobalReadRole(session.role)) return home;
  for (const ep of user?.extra_pages ?? []) {
    if (ep.page === BOARD_PAGE_ID && ep.source_team) return ep.source_team;
  }
  return home;
}

/** v1 requireTeamFeature(): teams.json `features` ∪ defaultFeatures(). */
async function assertTeamFeature(session: Session, team: string): Promise<void> {
  if (session.role === 'super_admin') return;
  const record = await findTeam(team);
  if (!record) {
    await logSecurity({
      user: session.sub,
      team,
      event: 'board.unknown_team',
      meta: { role: session.role },
    });
    throw new ForbiddenError('Forbidden: unknown team');
  }
  const features = new Set<string>([...DEFAULT_FEATURES, ...record.features]);
  if (!features.has(BOARD_FEATURE)) {
    await logSecurity({
      user: session.sub,
      team,
      event: 'feature_forbidden',
      meta: { feature: BOARD_FEATURE },
    });
    throw new ForbiddenError(
      `Your team does not have access to this feature (${BOARD_FEATURE})`,
    );
  }
}

/**
 * v1 resolveUserMenus() restricted to the single `board` id, plus
 * requirePagePermission() for the `external` role.
 */
async function assertMenuPermission(
  session: Session,
  user: GlobalUser | null,
  menu: { roles: Record<string, '*' | string[]>; always_visible: string[] },
): Promise<void> {
  if (session.role === 'super_admin') return;

  // `external` users carry their own per-page allow-list (v1
  // requirePagePermission — the only check api/board/index.php itself runs).
  if (session.role === 'external') {
    const perms = user?.permissions ?? [];
    if (!perms.includes(BOARD_PAGE_ID)) {
      await logSecurity({
        user: session.sub,
        team: session.team,
        event: 'forbidden_page',
        meta: { page: BOARD_PAGE_ID, user_role: 'external' },
      });
      throw new ForbiddenError('Forbidden: no permission for this page');
    }
  }

  const roleCfg = menu.roles[session.role] ?? '*';
  let allowed: boolean = roleCfg === '*' || roleCfg.includes(BOARD_PAGE_ID);

  const override = user?.menu_permissions;
  if (override?.grant?.includes(BOARD_PAGE_ID)) allowed = true;
  if (override?.deny?.includes(BOARD_PAGE_ID)) allowed = false;
  if (menu.always_visible.includes(BOARD_PAGE_ID)) allowed = true;

  if (!allowed) {
    await logSecurity({
      user: session.sub,
      team: session.team,
      event: 'menu_forbidden',
      meta: { page: BOARD_PAGE_ID, role: session.role },
    });
    throw new ForbiddenError('Forbidden: menu not available for your role');
  }
}

/** v1 requirePageMode(): `page_modes.board === 'read'` blocks every write. */
async function resolveWriteMode(session: Session, team: string): Promise<boolean> {
  if (session.role === 'super_admin') return true;
  const record = await findTeam(team);
  const mode = record?.page_modes?.[BOARD_PAGE_ID] ?? 'full';
  return mode !== 'read';
}

/**
 * Read gate. Resolves the effective team and the actor's display name so every
 * caller works from one object instead of re-deriving session facts.
 */
export async function requireBoardRead(): Promise<BoardAccess> {
  const session = await requireAuth();
  const user = await findUserById(session.sub);
  const team = resolveEffectiveTeam(session, user);

  await assertTeamFeature(session, team);

  const { readMenuPermissions } = await import('./global-data');
  const menu = await readMenuPermissions();
  await assertMenuPermission(session, user, {
    roles: menu.roles as Record<string, '*' | string[]>,
    always_visible: menu.always_visible,
  });

  // Nav-registry gate (config/permissions.ts). Features come from teams.json so
  // the superadmin feature config drives this too — never bypassed.
  const record = await findTeam(team);
  const features: Record<string, boolean> = {};
  for (const f of [...DEFAULT_FEATURES, ...(record?.features ?? [])]) features[f] = true;
  const navSession: SessionLike = {
    role: session.role as Role,
    team,
    isGenz: session.is_genz ?? false,
    features,
  };
  if (!canSeePage(BOARD_PAGE_ID, navSession)) {
    await logSecurity({
      user: session.sub,
      team,
      event: 'nav_forbidden',
      meta: { page: BOARD_PAGE_ID, role: session.role },
    });
    throw new ForbiddenError('Forbidden: page not available');
  }

  const canWrite = await resolveWriteMode(session, team);
  const name = user?.name?.trim();
  return {
    session,
    actorName: name && name.length > 0 ? name : session.username,
    team,
    canWrite,
    user,
  };
}

/** Write gate — read gate plus the team's page mode. */
export async function requireBoardWrite(): Promise<BoardAccess> {
  const access = await requireBoardRead();
  if (!access.canWrite) {
    await logSecurity({
      user: access.session.sub,
      team: access.team,
      event: 'page_mode_forbidden',
      meta: { page: BOARD_PAGE_ID, mode: 'read' },
    });
    throw new ForbiddenError('This page is read-only for your team');
  }
  return access;
}

// ── per-row authorisation (v1 inline checks in api/board/index.php) ──────────
export const LEAD_ROLES = ['super_admin', 'sm_admin', 'dev_sm', 'sm_lead'] as const;
export const ADMIN_ROLES = ['super_admin', 'sm_admin', 'dev_sm'] as const;

export function isLead(role: string): boolean {
  return (LEAD_ROLES as readonly string[]).includes(role);
}

export function isAdmin(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/** Author or lead+ — matches `$canEdit` / `$canDelete` in v1. */
export function canMutateOwn(role: string, userId: string, authorId: string): boolean {
  return authorId === userId || isLead(role);
}
