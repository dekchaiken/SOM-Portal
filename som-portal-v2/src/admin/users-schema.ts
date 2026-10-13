// som-portal-v2/src/admin/users-schema.ts
//
// Shape of a record in the GLOBAL `data/users.json` (v1 field names, 1:1).
// Deliberately lenient: real production records are inconsistent (one user has
// no `email`, two have no `team`), and a strict schema would make the whole
// file unreadable. Everything is `.passthrough()` so unknown v1 fields
// (`jb_role`, `jp_role`, `soj_role`, `status`, …) survive a v2 write untouched.
import { z } from 'zod';

export const ASSIGNABLE_ROLES = [
  'sm_user',
  'sm_lead',
  'sm_admin',
  'dev_sm',
  'external',
  'super_viewer',
  'dev_user',
] as const;

/** v1 api/users PUT accepts this subset (no super_viewer on update). */
export const UPDATABLE_ROLES = [
  'sm_user',
  'sm_lead',
  'sm_admin',
  'dev_sm',
  'external',
  'dev_user',
] as const;

/** v1: non-super_admin admins (sm_admin / dev_sm) may only grant these. */
export const NON_SUPER_ASSIGNABLE_ROLES = ['sm_user', 'sm_admin', 'dev_user'] as const;

export const ExtraPageSchema = z
  .object({ page: z.string(), source_team: z.string() })
  .passthrough();

export const AdminUserSchema = z
  .object({
    id: z.string(),
    name: z.string().default(''),
    username: z.string(),
    role: z.string(),
    email: z.string().optional(),
    nickname: z.string().optional(),
    team: z.string().nullable().optional(),
    password: z.string().optional(),
    password_history: z.array(z.string()).optional(),
    password_changed_at: z.string().optional(),
    password_expired: z.boolean().optional(),
    must_reset_password: z.boolean().optional(),
    first_login: z.boolean().optional(),
    avatar_url: z.string().nullable().optional(),
    created_at: z.string().optional(),
    created_by: z.string().optional(),
    permissions: z.array(z.string()).optional(),
    schedule_include: z.boolean().optional(),
    course_include: z.boolean().optional(),
    exam_include: z.boolean().optional(),
    dev_subteam: z.string().nullable().optional(),
    is_genz: z.boolean().optional(),
    name_th: z.string().optional(),
    emp_id: z.string().optional(),
    phone: z.string().optional(),
    tmn_id: z.string().optional(),
    net_home: z.string().optional(),
    net_mobile: z.string().optional(),
    extra_pages: z.array(ExtraPageSchema).optional(),
    status: z.string().optional(),
    // v2 soft-delete (see users-service.deleteUser)
    deleted_at: z.string().nullable().optional(),
    deleted_by: z.string().nullable().optional(),
  })
  .passthrough();

export type AdminUser = z.infer<typeof AdminUserSchema>;

export const UsersFileSchema = z.array(AdminUserSchema).default([]);

/**
 * The exact field list v1 returns to super_admin / super_viewer and to
 * sm_admin / dev_sm (api/users/index.php GET). `password` and
 * `password_history` are never included — that is the whole point.
 */
export interface SafeUser {
  id: string;
  name: string;
  nickname: string;
  username: string;
  email: string;
  role: string;
  team: string | null;
  avatar_url: string | null;
  first_login: boolean;
  password_expired: boolean;
  must_reset_password: boolean;
  created_at: string;
  password_changed_at: string;
  permissions: string[];
  schedule_include: boolean;
  course_include: boolean;
  exam_include: boolean;
  name_th: string;
  emp_id: string;
  phone: string;
  tmn_id: string;
  net_home: string;
  net_mobile: string;
  dev_subteam: string | null;
  extra_pages?: { page: string; source_team: string }[];
  is_genz?: boolean;
  deleted_at?: string | null;
}

/** Minimal projection v1 hands to sm_user / sm_lead / external (schedule list). */
export interface ScheduleUser {
  id: string;
  name: string;
  nickname: string;
  role: string;
}

export function toSafeUser(u: AdminUser, opts: { includeExtraPages?: boolean } = {}): SafeUser {
  const safe: SafeUser = {
    id: u.id,
    name: u.name ?? '',
    nickname: u.nickname ?? '',
    username: u.username,
    email: u.email ?? '',
    role: u.role,
    team: u.team ?? null,
    avatar_url: u.avatar_url ?? null,
    first_login: Boolean(u.first_login ?? false),
    password_expired: Boolean(u.password_expired ?? false),
    must_reset_password: Boolean(u.must_reset_password ?? false),
    created_at: u.created_at ?? '',
    password_changed_at: u.password_changed_at ?? '',
    permissions: u.permissions ?? [],
    schedule_include: Boolean(u.schedule_include ?? true),
    course_include: Boolean(u.course_include ?? true),
    exam_include: Boolean(u.exam_include ?? true),
    name_th: u.name_th ?? '',
    emp_id: u.emp_id ?? '',
    phone: u.phone ?? '',
    tmn_id: u.tmn_id ?? '',
    net_home: u.net_home ?? '',
    net_mobile: u.net_mobile ?? '',
    dev_subteam: u.dev_subteam ?? null,
    is_genz: Boolean(u.is_genz ?? false),
    deleted_at: u.deleted_at ?? null,
  };
  if (opts.includeExtraPages) safe.extra_pages = u.extra_pages ?? [];
  return safe;
}

export function toScheduleUser(u: AdminUser): ScheduleUser {
  return { id: u.id, name: u.name ?? '', nickname: u.nickname ?? '', role: u.role };
}
