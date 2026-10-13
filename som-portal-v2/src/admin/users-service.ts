// som-portal-v2/src/admin/users-service.ts
//
// Admin user management. Behaviour is ported from v1 `api/users/index.php`
// (GET / POST / PUT / DELETE / PATCH) plus `api/helpers.php` helpers
// (genId, hashPassword, requireRole, logActivity, logSecurity).
//
// MULTI-TEAM CONTRACT (this is the critical part):
//   • `data/users.json` is a GLOBAL file; every record carries `team`.
//   • super_admin / super_viewer  → every team; may narrow with `?team=`.
//   • sm_admin / dev_sm           → own team only, plus the shared `dev` team
//                                   (cross-team external dev users).
//   • sm_user / sm_lead / external→ own team, minimal projection, no writes.
//   • Role grants are capped: only super_admin may grant super_viewer /
//     sm_lead / dev_sm / external; sm_admin is limited to sm_user / sm_admin /
//     dev_user. A non-super_admin can never write outside its own team.
//
// Nothing here ever returns `password` / `password_history` — every response
// goes through `toSafeUser()`.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Session } from '@/auth/session';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { hashPassword } from '@/auth/password';
import { readGlobalFile, mutateGlobalFile } from '@/data/global-store';
import { logActivity } from '@/logging/activity';
import { logSecurity } from '@/logging/security';
import {
  AdminUserSchema,
  UsersFileSchema,
  ASSIGNABLE_ROLES,
  UPDATABLE_ROLES,
  NON_SUPER_ASSIGNABLE_ROLES,
  toSafeUser,
  toScheduleUser,
  type AdminUser,
  type SafeUser,
  type ScheduleUser,
} from './users-schema';

export const ADMIN_ROLES = ['super_admin', 'sm_admin', 'dev_sm'] as const;
export const GLOBAL_READ_ROLES = ['super_admin', 'super_viewer'] as const;
const MINIMAL_READ_ROLES = ['sm_user', 'sm_lead', 'external'] as const;
const TEAM_SLUG_RE = /^[a-z0-9_-]+$/;

// ─── small helpers (v1 parity) ───────────────────────────────────────────────

/** v1 genId(): `<prefix>_` + 12 hex chars. */
export function genId(prefix = 'id'): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** v1 date('c') — ISO-8601 with offset. Node's toISOString() is the UTC form. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * v1 temp password: `SOM_` + 6 chars from an unambiguous alphabet
 * (no I/O/0/1). 10 chars, always ≥1 upper + ≥1 digit, so it also satisfies the
 * v2 password policy.
 */
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'SOM_';
  for (let i = 0; i < 6; i += 1) out += chars[crypto.randomInt(0, chars.length)];
  // Guarantee the policy even on an all-letter / all-digit draw.
  if (!/[A-Z]/.test(out.slice(4))) out = `${out.slice(0, 4)}A${out.slice(5)}`;
  if (!/[0-9]/.test(out.slice(4))) out = `${out.slice(0, 9)}7`;
  return out;
}

/** Brief: min 10 chars, ≥1 uppercase, ≥1 digit. */
export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(pw)) return 'Password must contain a digit';
  return null;
}

/** v1 _maskEmailForDisplay(): warapon@x.com → w*****n@x.com */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return '*'.repeat(local.length) + domain;
  return `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local.slice(-1)}${domain}`;
}

function isEmail(v: string): boolean {
  return z.string().email().safeParse(v).success;
}

export function isSuper(session: Session): boolean {
  return session.role === 'super_admin';
}

function assertAdmin(session: Session): void {
  if (!(ADMIN_ROLES as readonly string[]).includes(session.role)) {
    throw new ForbiddenError('Forbidden: insufficient permissions');
  }
}

/** Not soft-deleted. v1 has no soft delete, so legacy records all pass. */
function isLive(u: AdminUser): boolean {
  return !u.deleted_at;
}

// ─── teams ───────────────────────────────────────────────────────────────────

const TeamSchema = z
  .object({
    id: z.string().optional(),
    slug: z.string(),
    name: z.string().optional(),
    active: z.boolean().optional(),
    color: z.string().optional(),
  })
  .passthrough();
const TeamsFileSchema = z.array(TeamSchema).default([]);
export type TeamOption = { slug: string; name: string; active: boolean; color?: string };

export async function listTeams(): Promise<TeamOption[]> {
  const teams = (await readGlobalFile('teams.json', TeamsFileSchema)) ?? [];
  return teams.map((t) => ({
    slug: t.slug,
    name: t.name ?? t.slug,
    active: Boolean(t.active ?? false),
    color: t.color,
  }));
}

// ─── read ────────────────────────────────────────────────────────────────────

export interface ListUsersResult {
  users: SafeUser[] | ScheduleUser[];
  /** Which team the list is scoped to; `null` = all teams (super_admin only). */
  team: string | null;
  /** Teams this session may switch to. Single entry for a team admin. */
  teams: TeamOption[];
  /** Roles this session may assign (drives the UI dropdown). */
  assignable_roles: string[];
  /** false for the minimal sm_user/sm_lead projection. */
  can_manage: boolean;
}

export function assignableRoles(session: Session): string[] {
  if (isSuper(session)) return [...ASSIGNABLE_ROLES];
  if ((ADMIN_ROLES as readonly string[]).includes(session.role)) {
    return [...NON_SUPER_ASSIGNABLE_ROLES];
  }
  return [];
}

export async function listUsers(
  session: Session,
  opts: { team?: string | null; includeDeleted?: boolean } = {},
): Promise<ListUsersResult> {
  const all = ((await readGlobalFile('users.json', UsersFileSchema)) ?? []) as AdminUser[];
  const requested =
    opts.team && TEAM_SLUG_RE.test(opts.team) ? opts.team : null;
  const live = opts.includeDeleted ? all : all.filter(isLive);

  // super_admin / super_viewer — every team, optionally narrowed by ?team=.
  if ((GLOBAL_READ_ROLES as readonly string[]).includes(session.role)) {
    const rows = requested ? live.filter((u) => (u.team ?? '') === requested) : live;
    return {
      users: rows.map((u) => toSafeUser(u, { includeExtraPages: true })),
      team: requested,
      teams: await listTeams(),
      assignable_roles: assignableRoles(session),
      can_manage: session.role === 'super_admin',
    };
  }

  // sm_admin / dev_sm — own team, or explicitly the shared `dev` team.
  if ((ADMIN_ROLES as readonly string[]).includes(session.role)) {
    const target = requested === 'dev' ? 'dev' : session.team;
    if (requested && requested !== 'dev' && requested !== session.team) {
      await logSecurity({
        user: session.sub,
        team: session.team,
        event: 'users.cross_team_denied',
        meta: { requested_team: requested },
      });
      throw new ForbiddenError('Cross-team user access requires super_admin');
    }
    const rows = live.filter((u) => (u.team ?? '') === target);
    const teams = (await listTeams()).filter(
      (t) => t.slug === session.team || t.slug === 'dev',
    );
    return {
      users: rows.map((u) => toSafeUser(u)),
      team: target,
      teams,
      assignable_roles: assignableRoles(session),
      can_manage: true,
    };
  }

  // sm_user / sm_lead / external — minimal projection of own team, for the
  // schedule picker. No `email`, no flags, no writes.
  if ((MINIMAL_READ_ROLES as readonly string[]).includes(session.role)) {
    const rows = live.filter(
      (u) =>
        u.role !== 'external' &&
        (u.team ?? '') === session.team &&
        (u.schedule_include ?? true),
    );
    return {
      users: rows.map(toScheduleUser),
      team: session.team,
      teams: [],
      assignable_roles: [],
      can_manage: false,
    };
  }

  throw new ForbiddenError('Forbidden: insufficient permissions');
}

/** The raw record, for internal use only. Never hand this to a response. */
async function findRaw(id: string): Promise<AdminUser | null> {
  const all = ((await readGlobalFile('users.json', UsersFileSchema)) ?? []) as AdminUser[];
  return all.find((u) => u.id === id) ?? null;
}

/**
 * A non-super_admin may only touch users in its own team (or the shared `dev`
 * team, matching the read rule). Mutating anybody else is a security event.
 */
async function assertCanManage(session: Session, target: AdminUser): Promise<void> {
  assertAdmin(session);
  if (isSuper(session)) return;
  const targetTeam = target.team ?? '';
  if (targetTeam === session.team || targetTeam === 'dev') return;
  await logSecurity({
    user: session.sub,
    team: session.team,
    event: 'users.cross_team_write_denied',
    meta: { target_id: target.id, target_team: targetTeam },
  });
  throw new ForbiddenError('You can only manage users in your own team');
}

function assertCanAssignRole(session: Session, role: string, allowed: readonly string[]): void {
  if (!allowed.includes(role)) throw new ValidationError('Invalid role');
  if (role === 'super_viewer' && !isSuper(session)) {
    throw new ForbiddenError('Only super_admin can create super_viewer users');
  }
  if (
    !isSuper(session) &&
    !(NON_SUPER_ASSIGNABLE_ROLES as readonly string[]).includes(role)
  ) {
    throw new ForbiddenError('You can only assign the User, Admin, or Dev User role');
  }
}

// ─── create ──────────────────────────────────────────────────────────────────

export const CreateUserInput = z.object({
  name: z.string().trim().min(1, 'Name and username are required'),
  username: z
    .string()
    .trim()
    .min(1, 'Name and username are required')
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/, 'Username may only contain letters, digits, . _ -'),
  email: z.string().trim(),
  role: z.string().default('sm_user'),
  team: z.string().trim().optional(),
  nickname: z.string().trim().optional(),
  password: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  schedule_include: z.boolean().optional(),
  course_include: z.boolean().optional(),
  exam_include: z.boolean().optional(),
  dev_subteam: z.string().optional(),
  name_th: z.string().optional(),
  emp_id: z.string().optional(),
  phone: z.string().optional(),
  tmn_id: z.string().optional(),
  net_home: z.string().optional(),
  net_mobile: z.string().optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

export interface CreateUserResult {
  user: SafeUser;
  /** Returned exactly once — v1 mails this instead. */
  temp_password: string;
  /** Whether `temp_password` was generated (vs. supplied by the admin). */
  generated: boolean;
}

export async function createUser(
  session: Session,
  input: CreateUserInput,
): Promise<CreateUserResult> {
  assertAdmin(session);
  const { name, username, role } = input;
  const email = input.email.trim();

  if (!email || !isEmail(email)) {
    throw new ValidationError(
      'A valid email is required — the temporary password will be sent to this address',
    );
  }
  assertCanAssignRole(session, role, ASSIGNABLE_ROLES);

  // v1 team resolution, verbatim.
  let team: string | null;
  if (role === 'super_viewer') {
    team = null; // platform-level oversight role — no team
  } else if (role === 'dev_user') {
    team = 'dev'; // dev_user always belongs to the dev team
  } else if (isSuper(session)) {
    team = (input.team ?? '').trim();
    if (!team) throw new ValidationError('team is required when creating users as super_admin');
    const teams = await listTeams();
    if (!teams.some((t) => t.slug === team && t.active)) {
      throw new ValidationError(`Team '${team}' not found or inactive`);
    }
  } else {
    team = session.team; // sm_admin always creates in its own team
  }

  const supplied = input.password?.trim();
  if (supplied) {
    const problem = validatePasswordPolicy(supplied);
    if (problem) throw new ValidationError(problem);
  }
  const tempPassword = supplied || generateTempPassword();
  const isExternalish = role === 'external' || role === 'dev_user';

  const newUser: AdminUser = AdminUserSchema.parse({
    id: genId('usr'),
    name,
    nickname: input.nickname ?? '',
    username,
    email,
    role,
    team,
    password: await hashPassword(tempPassword),
    password_history: [],
    password_changed_at: nowIso(),
    first_login: true,
    must_reset_password: true,
    created_at: nowIso(),
    created_by: session.sub,
    permissions: role === 'external' ? (input.permissions ?? []) : [],
    schedule_include: isExternalish ? false : (input.schedule_include ?? true),
    course_include: isExternalish ? false : (input.course_include ?? true),
    exam_include: isExternalish ? false : (input.exam_include ?? true),
    dev_subteam: role === 'dev_user' ? (input.dev_subteam ?? '').trim() : null,
    name_th: (input.name_th ?? '').trim(),
    emp_id: (input.emp_id ?? '').trim(),
    phone: (input.phone ?? '').trim(),
    tmn_id: (input.tmn_id ?? '').trim(),
    net_home: (input.net_home ?? '').trim(),
    net_mobile: (input.net_mobile ?? '').trim(),
  });

  let clash = false;
  await mutateGlobalFile('users.json', UsersFileSchema, (usersIn) => {
    const users = (usersIn ?? []) as AdminUser[];
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      clash = true;
      return users;
    }
    return [...users, newUser];
  });
  if (clash) throw new ValidationError('Username already exists');

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'user_create',
    meta: { target_id: newUser.id, username, role, team, sent_to: maskEmail(email) },
  });

  return { user: toSafeUser(newUser), temp_password: tempPassword, generated: !supplied };
}

// ─── update ──────────────────────────────────────────────────────────────────

export const UpdateUserInput = z
  .object({
    name: z.string().trim().min(1).optional(),
    nickname: z.string().trim().optional(),
    email: z.string().trim().optional(),
    avatar_url: z.string().optional(),
    role: z.string().optional(),
    dev_subteam: z.string().optional(),
    permissions: z.array(z.string()).optional(),
    schedule_include: z.boolean().optional(),
    course_include: z.boolean().optional(),
    exam_include: z.boolean().optional(),
    must_reset_password: z.boolean().optional(),
    name_th: z.string().optional(),
    emp_id: z.string().optional(),
    phone: z.string().optional(),
    tmn_id: z.string().optional(),
    net_home: z.string().optional(),
    net_mobile: z.string().optional(),
    extra_pages: z.array(z.object({ page: z.string(), source_team: z.string() })).optional(),
    is_genz: z.boolean().optional(),
  })
  .strict();
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

/** v1 contact-field length caps. */
const CONTACT_CAPS: Record<string, number> = {
  name_th: 80,
  emp_id: 20,
  phone: 20,
  tmn_id: 20,
  net_home: 100,
  net_mobile: 50,
};

export async function updateUser(
  session: Session,
  id: string,
  patch: UpdateUserInput,
): Promise<SafeUser> {
  const existing = await findRaw(id);
  if (!existing || !isLive(existing)) throw new NotFoundError('User not found');
  await assertCanManage(session, existing);

  // Validate before mutating so a rejected request changes nothing.
  if (patch.email !== undefined && patch.email !== '' && !isEmail(patch.email)) {
    throw new ValidationError('A valid email is required');
  }
  if (patch.avatar_url !== undefined && patch.avatar_url !== '') {
    if (!/^(data:image\/(png|jpeg|gif|webp);base64,|https?:\/\/)/.test(patch.avatar_url)) {
      throw new ValidationError('Invalid avatar format. Use data URI or https URL.');
    }
    if (patch.avatar_url.length > 280000) {
      throw new ValidationError('Avatar too large (max ~200 KB)');
    }
  }
  if (patch.role !== undefined && patch.role !== existing.role) {
    // v1: you cannot demote yourself out of admin.
    if (existing.id === session.sub && !(ADMIN_ROLES as readonly string[]).includes(patch.role)) {
      throw new ValidationError('Cannot change your own role');
    }
    assertCanAssignRole(session, patch.role, UPDATABLE_ROLES);
  }
  for (const [key, cap] of Object.entries(CONTACT_CAPS)) {
    const v = patch[key as keyof UpdateUserInput];
    if (typeof v === 'string' && v.trim().length > cap) {
      throw new ValidationError(
        `${key.replace(/_/g, ' ')} too long (max ${cap} chars)`,
      );
    }
  }
  if (patch.extra_pages !== undefined && !isSuper(session)) {
    throw new ForbiddenError('Only super_admin can set cross-team extra pages');
  }

  let updated: AdminUser | null = null;
  await mutateGlobalFile('users.json', UsersFileSchema, (usersIn) =>
    ((usersIn ?? []) as AdminUser[]).map((u) => {
      if (u.id !== id) return u;
      const next: AdminUser = { ...u };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.nickname !== undefined) next.nickname = patch.nickname;
      if (patch.email !== undefined) next.email = patch.email;
      if (patch.avatar_url !== undefined) next.avatar_url = patch.avatar_url;
      if (patch.role !== undefined) {
        next.role = patch.role;
        // v1: switching to dev_user re-homes the user to the dev team.
        if (patch.role === 'dev_user') next.team = 'dev';
      }
      if (patch.dev_subteam !== undefined) {
        next.dev_subteam = next.role === 'dev_user' ? patch.dev_subteam.trim() : null;
      }
      if (patch.permissions !== undefined && next.role === 'external') {
        next.permissions = patch.permissions;
      }
      if (patch.schedule_include !== undefined && next.role !== 'external') {
        next.schedule_include = patch.schedule_include;
      }
      if (patch.course_include !== undefined && next.role !== 'external') {
        next.course_include = patch.course_include;
      }
      if (patch.exam_include !== undefined && next.role !== 'external') {
        next.exam_include = patch.exam_include;
      }
      if (patch.must_reset_password !== undefined) {
        next.must_reset_password = patch.must_reset_password;
      }
      if (patch.is_genz !== undefined) next.is_genz = patch.is_genz;
      for (const key of Object.keys(CONTACT_CAPS)) {
        const v = patch[key as keyof UpdateUserInput];
        if (typeof v === 'string') {
          (next as Record<string, unknown>)[key] = v.trim();
        }
      }
      if (patch.extra_pages !== undefined && isSuper(session)) {
        next.extra_pages = patch.extra_pages.filter(
          (p) => p.page && p.source_team && TEAM_SLUG_RE.test(p.source_team),
        );
      }
      updated = next;
      return next;
    }),
  );

  if (!updated) throw new NotFoundError('User not found');
  const finalUser: AdminUser = updated;
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'user_update',
    meta: { target_id: id, changed: Object.keys(patch) },
  });
  if (patch.role !== undefined && patch.role !== existing.role) {
    await logSecurity({
      user: session.sub,
      team: session.team,
      event: 'user_role_change',
      meta: { target_id: id, from: existing.role, to: patch.role },
    });
  }
  if (patch.must_reset_password) {
    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'user_force_password_reset',
      meta: { target_id: id, target_name: finalUser.name },
    });
  }
  return toSafeUser(finalUser, { includeExtraPages: isSuper(session) });
}

// ─── delete ──────────────────────────────────────────────────────────────────

/**
 * Soft delete (brief): stamp `deleted_at` / `deleted_by` and park the account
 * so it cannot sign in anywhere. v1 hard-deletes the record, so we also set
 * `password_expired` + `status: 'deleted'` — the v1 PHP login path refuses an
 * expired password, which keeps a soft-deleted user locked out during dual-run.
 * `hard: true` (super_admin only) reproduces the v1 purge exactly.
 */
export async function deleteUser(
  session: Session,
  id: string,
  opts: { hard?: boolean } = {},
): Promise<{ id: string; mode: 'soft' | 'hard' }> {
  const existing = await findRaw(id);
  if (!existing) throw new NotFoundError('User not found');
  await assertCanManage(session, existing);
  if (id === session.sub) throw new ValidationError('Cannot delete your own account');
  if (opts.hard && !isSuper(session)) {
    throw new ForbiddenError('Only super_admin can permanently delete a user');
  }

  await mutateGlobalFile('users.json', UsersFileSchema, (usersIn) => {
    const users = (usersIn ?? []) as AdminUser[];
    return opts.hard
      ? users.filter((u) => u.id !== id)
      : users.map((u) =>
          u.id === id
            ? {
                ...u,
                deleted_at: nowIso(),
                deleted_by: session.sub,
                status: 'deleted',
                password_expired: true,
              }
            : u,
        );
  });

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'user_delete',
    meta: { target_id: id, username: existing.username, mode: opts.hard ? 'hard' : 'soft' },
  });
  await logSecurity({
    user: session.sub,
    team: session.team,
    event: 'user_delete',
    meta: {
      target_id: id,
      username: existing.username,
      target_team: existing.team ?? null,
      mode: opts.hard ? 'hard' : 'soft',
    },
  });
  return { id, mode: opts.hard ? 'hard' : 'soft' };
}

// ─── reset password ──────────────────────────────────────────────────────────

export interface ResetPasswordResult {
  temp_password: string;
  masked_email: string;
  must_reset_password: true;
}

/**
 * Admin-triggered reset. v1 mails a 24 h reset link and leaves the old password
 * valid; the brief asks for a temp password returned once. We do the latter and
 * keep the v1 record semantics: the old hash is pushed onto `password_history`
 * (capped by `password_history_count`), `password_changed_at` is stamped and
 * `must_reset_password` forces a change at next sign-in.
 */
export async function resetUserPassword(
  session: Session,
  id: string,
  historyCount = 5,
): Promise<ResetPasswordResult> {
  const existing = await findRaw(id);
  if (!existing || !isLive(existing)) throw new NotFoundError('User not found');
  await assertCanManage(session, existing);

  const temp = generateTempPassword();
  const hash = await hashPassword(temp);

  await mutateGlobalFile('users.json', UsersFileSchema, (usersIn) =>
    ((usersIn ?? []) as AdminUser[]).map((u) => {
      if (u.id !== id) return u;
      const history = [...(u.password_history ?? [])];
      if (u.password) history.unshift(u.password);
      return {
        ...u,
        password: hash,
        password_history: history.slice(0, Math.max(1, historyCount)),
        password_changed_at: nowIso(),
        password_expired: false,
        must_reset_password: true,
        first_login: true,
      };
    }),
  );

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'user_reset_password',
    meta: {
      target_id: id,
      username: existing.username,
      method: 'temp_password',
      sent_to: maskEmail(existing.email ?? ''),
    },
  });
  await logSecurity({
    user: session.sub,
    team: session.team,
    event: 'user_reset_password',
    meta: { target_id: id, username: existing.username, target_team: existing.team ?? null },
  });

  return {
    temp_password: temp,
    masked_email: maskEmail(existing.email ?? ''),
    must_reset_password: true,
  };
}
