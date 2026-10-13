// som-portal-v2/src/data/schemas/common.ts
// Base Zod shapes. These are intentionally permissive (`.passthrough()`) so
// stray fields in v1 JSON files don't break reads; feature engineers should
// tighten these per-module. See R-01 (field map) for jira-config specifics.
import { z } from 'zod';

export const ROLES = [
  'super_admin',
  'super_viewer',
  'sm_admin',
  'dev_sm',
  'sm_lead',
  'sm_user',
  'dev_user',
  'external',
] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = z.enum(ROLES);

// TODO(v2): tighten once we have a full user-record audit; currently matches
// the shape in data/sm/users.json circa 2026-10.
export const UserRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    email: z.string().email().or(z.string()),
    role: RoleSchema.or(z.string()),
    password: z.string().optional(),
    first_login: z.boolean().optional(),
    created_at: z.string().optional(),
    created_by: z.string().optional(),
    nickname: z.string().optional(),
    is_genz: z.boolean().optional(),
    dev_subteam: z.string().optional(),
    team: z.string().optional(),
  })
  .passthrough();
export type UserRecord = z.infer<typeof UserRecordSchema>;
export const UsersFileSchema = z.array(UserRecordSchema);

export const TeamRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().optional(),
  })
  .passthrough();
export type TeamRecord = z.infer<typeof TeamRecordSchema>;
export const TeamsFileSchema = z.array(TeamRecordSchema);

export const BoardPostSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string().optional().default(''),
    image_url: z.string().nullable().optional(),
    board_type: z.string().optional(),
    board_type_name: z.string().optional(),
    service_type_id: z.string().optional(),
    service_type_name: z.string().optional(),
    status: z.enum(['open', 'in_progress', 'resolved']).optional(),
    created_at: z.string().optional(),
    created_by: z.string().optional(),
    pinned: z.boolean().optional(),
    deleted_at: z.string().nullable().optional(),
  })
  .passthrough();
export type BoardPost = z.infer<typeof BoardPostSchema>;
export const BoardFileSchema = z.array(BoardPostSchema);

export const JiraCustomFieldSchema = z
  .object({
    id: z.string(),
    field_id: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

export const JiraConfigSchema = z
  .object({
    categories: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()).default([]),
    issue_types: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()).default([]),
    custom_fields: z.array(JiraCustomFieldSchema).default([]),
  })
  .passthrough();
export type JiraConfig = z.infer<typeof JiraConfigSchema>;

// menu-permissions.json: roles → "*" or array of menu keys.
export const MenuPermissionsSchema = z
  .object({
    version: z.number().optional(),
    roles: z.record(z.string(), z.union([z.literal('*'), z.array(z.string())])),
  })
  .passthrough();
export type MenuPermissions = z.infer<typeof MenuPermissionsSchema>;

// nav-groups.json shape differs per team; keep loose.
export const NavGroupItemSchema = z
  .object({
    key: z.string(),
    label: z.string().optional(),
    icon: z.string().optional(),
    href: z.string().optional(),
    children: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const NavGroupSchema = z
  .object({
    id: z.string(),
    label: z.string().optional(),
    items: z.array(NavGroupItemSchema).default([]),
  })
  .passthrough();

export const NavGroupsFileSchema = z.array(NavGroupSchema);
export type NavGroup = z.infer<typeof NavGroupSchema>;
