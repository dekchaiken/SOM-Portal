// som-portal-v2/src/auth/user-admin.ts
// Superadmin operations on login access: create an SSO user, change allowed sign-in
// methods, issue a password-setup link, and close password login for legacy accounts.
//
// All writes go to the global data/users.json under a file lock. Callers must check
// `super_admin` before calling these functions (see app/api/v1/auth/*).
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { updateGlobalFile } from '@/data/global-scope';
import { USERS_FILE, type V1User } from '@/account/users-store';
import { createResetToken } from '@/account/reset-tokens';
import { logSecurity } from '@/logging/security';
import { v1Date } from '@/lib/v1-date';
import {
  LOGIN_METHODS,
  defaultMethodsForTeam,
  isLegacyRecord,
  normalizeMethods,
  type LoginMethod,
} from './login-methods';

const ROLE_VALUES = ['super_admin', 'super_viewer', 'sm_admin', 'dev_sm', 'sm_lead', 'sm_user', 'dev_user', 'external'] as const;

export const CreateSsoUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,60}$/, 'username: a-z, 0-9, dot, dash, underscore')
    .optional(),
  team: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/),
  role: z.enum(ROLE_VALUES),
});
export type CreateSsoUserInput = z.infer<typeof CreateSsoUserSchema>;

export const MethodsPatchSchema = z.object({
  allowed_methods: z.array(z.enum(LOGIN_METHODS)).max(2),
});

export interface AccessUserView {
  id: string;
  username: string;
  name: string;
  email: string;
  team: string;
  role: string;
  allowed_methods: LoginMethod[];
  legacy: boolean;
  has_password: boolean;
}

export function toAccessUserView(u: V1User): AccessUserView {
  return {
    id: u.id,
    username: u.username,
    name: u.name ?? '',
    email: u.email ?? '',
    team: u.team ?? 'sm',
    role: u.role,
    allowed_methods: normalizeMethods(u.allowed_methods) ?? ['password'],
    legacy: isLegacyRecord(u),
    has_password: Boolean(u.password),
  };
}

/** Pure check used before writing, so tests can cover it without the file system. */
export function findDuplicate(
  users: readonly { email?: string; username?: string }[],
  email: string,
  username: string,
): 'email' | 'username' | null {
  const e = email.toLowerCase();
  const n = username.toLowerCase();
  if (users.some((u) => (u.email ?? '').toLowerCase() === e)) return 'email';
  if (users.some((u) => (u.username ?? '').toLowerCase() === n)) return 'username';
  return null;
}

/** Username from an email local part, made unique with a numeric suffix when needed. */
export function suggestUsername(email: string, taken: ReadonlySet<string>): string {
  const base = (email.split('@')[0] ?? 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 50) || 'user';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${randomBytes(3).toString('hex')}`;
}

/** super_admin keeps password as break-glass, so a superadmin can always get in if Keycloak is down. */
export const BREAK_GLASS_ROLE = 'super_admin';
export const BREAK_GLASS_MESSAGE = 'Super admin accounts must keep password sign-in as a break-glass login.';

/** True when a change would take password away from a break-glass account. */
export function violatesBreakGlass(role: string, methods: readonly LoginMethod[]): boolean {
  return role === BREAK_GLASS_ROLE && !methods.includes('password');
}

/** Methods for one legacy record during the bulk close. */
export function legacyCloseMethods(role: string, team: string | undefined): LoginMethod[] {
  return role === BREAK_GLASS_ROLE ? [...LOGIN_METHODS] : defaultMethodsForTeam(team);
}

export class UserAdminError extends Error {
  constructor(
    message: string,
    public readonly code: 'duplicate_email' | 'duplicate_username' | 'not_found' | 'invalid',
  ) {
    super(message);
  }
}

export async function createSsoUser(input: CreateSsoUserInput, actorId: string): Promise<AccessUserView> {
  const data = CreateSsoUserSchema.parse(input);
  let created: V1User | null = null;
  let duplicate: 'email' | 'username' | null = null;

  await updateGlobalFile<V1User[]>(USERS_FILE, [], (current) => {
    const users = Array.isArray(current) ? current : [];
    const taken = new Set(users.map((u) => (u.username ?? '').toLowerCase()));
    const username = data.username ?? suggestUsername(data.email, taken);
    duplicate = findDuplicate(users, data.email, username);
    if (duplicate) return users;
    const now = new Date();
    created = {
      id: `usr_${randomBytes(6).toString('hex')}`,
      username,
      name: data.name,
      email: data.email,
      role: data.role,
      team: data.team,
      allowed_methods: ['sso'],
      first_login: false,
      created_at: v1Date(now),
      created_by: actorId,
    };
    return [...users, created];
  });

  if (duplicate) {
    throw new UserAdminError(
      duplicate === 'email' ? 'This email already has an account.' : 'This username is already taken.',
      duplicate === 'email' ? 'duplicate_email' : 'duplicate_username',
    );
  }
  const user = created as V1User | null;
  if (!user) throw new UserAdminError('Could not create the user.', 'invalid');
  await logSecurity({ user: actorId, team: null, event: 'auth.user_created', meta: { target: user.id, team: user.team, role: user.role } });
  return toAccessUserView(user);
}

export interface SetMethodsResult {
  user: AccessUserView;
  /** Set when password was granted and the user has no password yet. */
  setup_token: string | null;
  setup_expires_at: string | null;
}

export async function setAllowedMethods(userId: string, methods: LoginMethod[], actorId: string): Promise<SetMethodsResult> {
  const clean = LOGIN_METHODS.filter((m) => methods.includes(m));
  if (clean.length === 0) throw new UserAdminError('Pick at least one sign-in method.', 'invalid');

  let updated: V1User | null = null;
  await updateGlobalFile<V1User[]>(USERS_FILE, [], (current) => {
    const users = Array.isArray(current) ? current : [];
    return users.map((u) => {
      if (u.id !== userId) return u;
      if (violatesBreakGlass(u.role, clean)) {
        throw new UserAdminError(BREAK_GLASS_MESSAGE, 'invalid');
      }
      updated = { ...u, allowed_methods: clean };
      return updated;
    });
  });
  const user = updated as V1User | null;
  if (!user) throw new UserAdminError('User not found.', 'not_found');

  let setupToken: string | null = null;
  let setupExpires: string | null = null;
  if (clean.includes('password') && !user.password) {
    const entry = await createResetToken(user.id, 24);
    setupToken = entry.token;
    setupExpires = entry.expires_at;
  }

  await logSecurity({
    user: actorId,
    team: null,
    event: 'auth.methods_changed',
    meta: { target: user.id, allowed_methods: clean, setup_link_issued: Boolean(setupToken) },
  });
  return { user: toAccessUserView(user), setup_token: setupToken, setup_expires_at: setupExpires };
}

export interface CloseLegacyResult {
  closed: number;
  kept_password: number;
  changed: { id: string; team: string; allowed_methods: LoginMethod[] }[];
}

/**
 * Give every legacy account (no allowed_methods yet) its team default: SSO for most
 * teams, password only for Wealth BU, Jenkins Portal and SO Jenkins. Already-set
 * records are left alone.
 */
export async function closeLegacyPasswordAccess(actorId: string): Promise<CloseLegacyResult> {
  const changed: CloseLegacyResult['changed'] = [];
  await updateGlobalFile<V1User[]>(USERS_FILE, [], (current) => {
    const users = Array.isArray(current) ? current : [];
    return users.map((u) => {
      if (!isLegacyRecord(u)) return u;
      const team = u.team ?? 'sm';
      const methods = legacyCloseMethods(u.role, team);
      changed.push({ id: u.id, team, allowed_methods: methods });
      return { ...u, allowed_methods: methods };
    });
  });
  const closed = changed.filter((c) => c.allowed_methods.includes('sso') && !c.allowed_methods.includes('password')).length;
  await logSecurity({
    user: actorId,
    team: null,
    event: 'auth.legacy_closed',
    meta: { changed: changed.length, closed },
  });
  return { closed, kept_password: changed.length - closed, changed };
}
