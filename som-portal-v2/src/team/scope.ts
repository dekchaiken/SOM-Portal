// som-portal-v2/src/team/scope.ts
// T-05 exact API. Session is pulled automatically from `getSession()` so pages
// never prop-drill. Cross-team access requires `super_admin`; writes to SM-shared
// files require `sm_*`. All cross-team reads emit a security log entry.
import type { ZodSchema } from 'zod';
import { getSession, type Session } from '@/auth/session';
import {
  SM_WRITE_SHARED_ROLES,
  SUPER_ADMIN,
  assertSmForShared,
  isSuperAdmin,
} from '@/auth/policy';
import { AuthError, ForbiddenError } from '@/lib/errors';
import { getDataAdapter } from '@/data/json-adapter';
import { SHARED_TEAM, type TeamScope } from '@/data/adapter';
import { logSecurity } from '@/logging/security';

export interface Scope {
  /** Override the team claim. Only honoured if the current session is super_admin. */
  team?: string;
}

async function session(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthError();
  return s;
}

async function resolveTeam(scope: Scope | undefined): Promise<{ team: string; sess: Session }> {
  const sess = await session();
  if (scope?.team && scope.team !== sess.team) {
    if (!isSuperAdmin(sess)) {
      throw new ForbiddenError('Cross-team access requires super_admin');
    }
    await logSecurity({
      user: sess.sub,
      team: sess.team,
      event: 'cross_team_access',
      meta: { requested_team: scope.team },
    });
    return { team: scope.team, sess };
  }
  return { team: sess.team, sess };
}

export async function readTeamFile<T>(
  file: string,
  schema: ZodSchema<T>,
  scope?: Scope,
): Promise<T> {
  const { team } = await resolveTeam(scope);
  const adapter = getDataAdapter();
  const raw = await adapter.read<unknown>({ team }, file);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Soft-fail per T-05: log drift, return a safe default by parsing `undefined`
    // so schemas with defaults produce an empty-but-valid value. If that fails,
    // re-throw.
    if (raw != null) console.error(`[team.readTeamFile] schema drift: ${file}`, parsed.error.flatten());
    const undef = schema.safeParse(undefined);
    const fallback = undef.success ? undef : schema.safeParse({});
    if (fallback.success) return fallback.data;
    throw new Error(`Schema validation failed for ${file}`);
  }
  return parsed.data;
}

export async function writeTeamFile<T>(
  file: string,
  data: T,
  schema: ZodSchema<T>,
  scope?: Scope,
): Promise<void> {
  const { team, sess } = await resolveTeam(scope);
  const parsed = schema.parse(data); // throws on write
  const adapter = getDataAdapter();
  await adapter.write({ team }, file, parsed);
  if (scope?.team && scope.team !== sess.team) {
    await logSecurity({
      user: sess.sub,
      team: sess.team,
      event: 'cross_team_write',
      meta: { target_team: team, file },
    });
  }
}

export async function readSharedFile<T>(file: string, schema: ZodSchema<T>): Promise<T> {
  const adapter = getDataAdapter();
  const raw = await adapter.read<unknown>({ team: SHARED_TEAM }, file);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    if (raw != null) console.error(`[team.readSharedFile] schema drift: ${file}`, parsed.error.flatten());
    const undef = schema.safeParse(undefined);
    const fallback = undef.success ? undef : schema.safeParse({});
    if (fallback.success) return fallback.data;
    throw new Error(`Schema validation failed for ${file}`);
  }
  return parsed.data;
}

export async function writeSharedFile<T>(
  file: string,
  data: T,
  schema: ZodSchema<T>,
): Promise<void> {
  const sess = await session();
  const allowed: readonly string[] = SM_WRITE_SHARED_ROLES;
  if (!allowed.includes(sess.role)) {
    throw new ForbiddenError('writeSharedFile requires an sm_* role');
  }
  assertSmForShared(sess);
  const parsed = schema.parse(data);
  const adapter = getDataAdapter();
  const scope: TeamScope = { team: SHARED_TEAM };
  await adapter.write(scope, file, parsed);
  await logSecurity({
    user: sess.sub,
    team: sess.team,
    event: 'shared_file_write',
    meta: { file },
  });
}

export async function readSectionScopedFile<T, K extends keyof T>(
  file: string,
  section: K,
  schema: ZodSchema<T>,
): Promise<T[K]> {
  const whole = await readSharedFile(file, schema);
  return whole[section];
}

export { SHARED_TEAM, SUPER_ADMIN };
