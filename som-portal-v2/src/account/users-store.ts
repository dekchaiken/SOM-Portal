// som-portal-v2/src/account/users-store.ts
//
// Read/write access to the REAL v1 `data/users.json`.
//
// v1 facts this module encodes (see api/helpers.php + api/auth/*.php):
//   • `users.json` is a GLOBAL file (`_isGlobalFile`), so it lives at
//     `data/users.json` — NOT `data/<team>/users.json`.
//   • Multi-team isolation is therefore a RECORD-level concern: every user row
//     carries a `team` field. `requireOwnRecord()` only ever matches the
//     session's own id AND asserts the row's team matches the session team, so
//     one team can never mutate another team's user row.
//   • Password history: `password_history` keeps the previous N hashes where
//     N = system-settings `password_history_count` (PW_HIST_COUNT, default 5).
//   • A successful password set clears `first_login`, `password_expired` and
//     `must_reset_password`, and stamps `password_changed_at` with `date('c')`.

import { readGlobalFile, updateGlobalFile } from '@/data/global-scope';
import { hashPassword, verifyPassword } from '@/auth/password';
import { v1Date } from '@/lib/v1-date';

export const USERS_FILE = 'users.json';
export const SYSTEM_SETTINGS_FILE = 'system-settings.json';

/** v1 default: `password_history_count` => 5 (api/config.php:47). */
export const PW_HIST_COUNT_DEFAULT = 5;

export interface V1User {
  id: string;
  username: string;
  name?: string;
  nickname?: string;
  email?: string;
  role: string;
  team?: string;
  password?: string;
  password_history?: string[];
  password_changed_at?: string;
  password_expired?: boolean;
  must_reset_password?: boolean;
  first_login?: boolean;
  avatar_url?: string;
  name_th?: string;
  emp_id?: string;
  phone?: string;
  tmn_id?: string;
  net_home?: string;
  net_mobile?: string;
  is_genz?: boolean;
  dev_subteam?: string;
  [extra: string]: unknown;
}

export async function readUsers(): Promise<V1User[]> {
  const raw = await readGlobalFile<unknown>(USERS_FILE, []);
  return Array.isArray(raw) ? (raw as V1User[]) : [];
}

export async function passwordHistoryCount(): Promise<number> {
  const settings = await readGlobalFile<Record<string, unknown>>(SYSTEM_SETTINGS_FILE, {});
  const n = Number(settings['password_history_count']);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : PW_HIST_COUNT_DEFAULT;
}

export async function findUserById(id: string): Promise<V1User | null> {
  if (!id) return null;
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

/** v1 forgot-password matched on username, case-insensitively. */
export async function findUserByUsernameGlobal(username: string): Promise<V1User | null> {
  const needle = username.trim().toLowerCase();
  if (!needle) return null;
  const users = await readUsers();
  return users.find((u) => (u.username ?? '').toLowerCase() === needle) ?? null;
}

/** Convenience for the forgot flow when the user types their email instead. */
export async function findUserByEmailGlobal(email: string): Promise<V1User | null> {
  const needle = email.trim().toLowerCase();
  if (!needle || !needle.includes('@')) return null;
  const users = await readUsers();
  return users.find((u) => (u.email ?? '').toLowerCase() === needle) ?? null;
}

/**
 * Team guard for the global users file. `super_admin` is the only role allowed
 * to touch a record outside its own team (v1 behaviour via requireRole).
 */
export function sameTeam(user: V1User, team: string, role?: string): boolean {
  if (role === 'super_admin') return true;
  // Legacy rows without a `team` field are treated as SM (v1 pre-migration default).
  return (user.team ?? 'sm') === team;
}

export type PasswordSetFailure =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'wrong_team' }
  | { ok: false; reason: 'current_required' }
  | { ok: false; reason: 'current_incorrect' }
  | { ok: false; reason: 'same_as_current' }
  | { ok: false; reason: 'reused'; historyCount: number };

export type PasswordSetResult =
  | { ok: true; user: V1User }
  | PasswordSetFailure;

export interface SetPasswordOptions {
  userId: string;
  newPassword: string;
  /** Required unless the record is flagged first_login / must_reset_password. */
  currentPassword?: string;
  /** Skip the current-password check entirely (token-based reset). */
  skipCurrentCheck?: boolean;
  /** Team of the acting session — enforced against the record's `team`. */
  team?: string;
  role?: string;
}

/**
 * Apply a password change to `data/users.json` under an exclusive lock,
 * reproducing v1's change-password.php / reset-password.php logic exactly.
 */
export async function setUserPassword(opts: SetPasswordOptions): Promise<PasswordSetResult> {
  const histCount = await passwordHistoryCount();
  let outcome: PasswordSetResult = { ok: false, reason: 'not_found' };

  await updateGlobalFile<V1User[]>(USERS_FILE, [], async (users) => {
    const list = Array.isArray(users) ? users : [];
    const idx = list.findIndex((u) => u.id === opts.userId);
    if (idx === -1) {
      outcome = { ok: false, reason: 'not_found' };
      return list;
    }
    const u = list[idx]!;

    if (opts.team && !sameTeam(u, opts.team, opts.role)) {
      outcome = { ok: false, reason: 'wrong_team' };
      return list;
    }

    const forced = Boolean(u.first_login) || Boolean(u.must_reset_password);
    if (!opts.skipCurrentCheck && !forced) {
      if (!opts.currentPassword) {
        outcome = { ok: false, reason: 'current_required' };
        return list;
      }
      const okCurrent = await verifyPassword(opts.currentPassword, u.password ?? '');
      if (!okCurrent) {
        outcome = { ok: false, reason: 'current_incorrect' };
        return list;
      }
    }

    if (u.password && (await verifyPassword(opts.newPassword, u.password))) {
      outcome = { ok: false, reason: 'same_as_current' };
      return list;
    }

    const history = Array.isArray(u.password_history) ? u.password_history : [];
    for (const old of history) {
      if (old && (await verifyPassword(opts.newPassword, old))) {
        outcome = { ok: false, reason: 'reused', historyCount: histCount };
        return list;
      }
    }

    const nextHistory = [u.password ?? '', ...history].filter(Boolean).slice(0, histCount);
    const updated: V1User = {
      ...u,
      password_history: nextHistory,
      password: await hashPassword(opts.newPassword),
      password_changed_at: v1Date(),
      first_login: false,
      password_expired: false,
      must_reset_password: false,
    };
    list[idx] = updated;
    outcome = { ok: true, user: updated };
    return list;
  });

  return outcome;
}

/** Fields a user may edit on their OWN record (v1 api/auth/profile.php PATCH). */
export const PROFILE_TEXT_CAPS: Readonly<Record<string, number>> = {
  name_th: 80,
  emp_id: 20,
  phone: 20,
  tmn_id: 20,
  net_home: 100,
  net_mobile: 50,
};

export interface ProfilePatch {
  name?: string;
  nickname?: string;
  email?: string;
  avatar_url?: string;
  name_th?: string;
  emp_id?: string;
  phone?: string;
  tmn_id?: string;
  net_home?: string;
  net_mobile?: string;
}

export type ProfileUpdateResult =
  | { ok: true; user: V1User; changed: string[] }
  | { ok: false; error: string; status: number };

const AVATAR_RE = /^(data:image\/(png|jpeg|gif|webp);base64,|https?:\/\/)/;
/** v1: `strlen($avatar) > 280000` → "max ~200 KB". */
export const AVATAR_MAX_CHARS = 280_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateOwnProfile(
  userId: string,
  patch: ProfilePatch,
  team: string,
  role?: string,
): Promise<ProfileUpdateResult> {
  let outcome: ProfileUpdateResult = { ok: false, error: 'User not found', status: 404 };

  await updateGlobalFile<V1User[]>(USERS_FILE, [], (users) => {
    const list = Array.isArray(users) ? users : [];
    const idx = list.findIndex((u) => u.id === userId);
    if (idx === -1) return list;
    const u = list[idx]!;
    if (!sameTeam(u, team, role)) {
      outcome = { ok: false, error: 'Forbidden', status: 403 };
      return list;
    }

    const next: V1User = { ...u };
    const changed: string[] = [];

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length < 1 || name.length > 60) {
        outcome = { ok: false, error: 'Name must be 1–60 characters', status: 400 };
        return list;
      }
      next.name = name;
      changed.push('name');
    }

    if (patch.nickname !== undefined) {
      const nn = patch.nickname.trim();
      if (nn.length > 30) {
        outcome = { ok: false, error: 'Nickname must be 30 characters or less', status: 400 };
        return list;
      }
      next.nickname = nn;
      changed.push('nickname');
    }

    if (patch.avatar_url !== undefined) {
      const avatar = patch.avatar_url ?? '';
      if (avatar !== '' && !AVATAR_RE.test(avatar)) {
        outcome = {
          ok: false,
          error: 'Invalid avatar format. Use data URI or https URL.',
          status: 400,
        };
        return list;
      }
      if (avatar.length > AVATAR_MAX_CHARS) {
        outcome = { ok: false, error: 'Avatar too large (max ~200 KB)', status: 400 };
        return list;
      }
      next.avatar_url = avatar;
      changed.push('avatar');
    }

    for (const [key, max] of Object.entries(PROFILE_TEXT_CAPS)) {
      const raw = (patch as Record<string, unknown>)[key];
      if (raw === undefined) continue;
      const value = String(raw).trim();
      if ([...value].length > max) {
        outcome = {
          ok: false,
          error: `${key.replace(/_/g, ' ')} too long (max ${max} chars)`,
          status: 400,
        };
        return list;
      }
      (next as Record<string, unknown>)[key] = value;
      changed.push(key);
    }

    if (patch.email !== undefined) {
      const email = patch.email.trim();
      if (email !== '' && !EMAIL_RE.test(email)) {
        outcome = { ok: false, error: 'Invalid email format', status: 400 };
        return list;
      }
      if (email !== '') {
        const dup = list.some(
          (o) => o.id !== userId && (o.email ?? '').toLowerCase() === email.toLowerCase(),
        );
        if (dup) {
          outcome = { ok: false, error: 'Email already in use', status: 400 };
          return list;
        }
      }
      next.email = email;
      changed.push('email');
    }

    list[idx] = next;
    outcome = { ok: true, user: next, changed };
    return list;
  });

  return outcome;
}

/** The exact public profile shape v1 api/auth/profile.php returns. */
export function toProfileDto(u: V1User) {
  return {
    id: u.id,
    name: u.name ?? '',
    nickname: u.nickname ?? '',
    username: u.username,
    email: u.email ?? '',
    role: u.role,
    avatar_url: u.avatar_url ?? '',
    name_th: u.name_th ?? '',
    emp_id: u.emp_id ?? '',
    phone: u.phone ?? '',
    tmn_id: u.tmn_id ?? '',
    net_home: u.net_home ?? '',
    net_mobile: u.net_mobile ?? '',
  };
}
