// som-portal-v2/src/perms/schemas.ts
//
// Zod schemas for the three REAL v1 permission files. Field names are 1:1 with
// v1 so the PHP app and v2 can read/write the same files during dual-run.
//
//   data/<team>/menu-permissions.json   (team-scoped — every team has one)
//   data/<team>/nav-groups.json         (team-scoped — only sm has one today)
//   data/teams.json                     (GLOBAL — helpers.php _isGlobalFile())
//   data/users.json                     (GLOBAL — menu_permissions + extra_pages)
//   data/maintenance.json               (GLOBAL — page locks)

import { z } from "zod";
import { DEFAULT_ALWAYS_VISIBLE } from "@/config/menu-catalog";

/** `"*"` or an explicit list of menu ids — exactly v1's union. */
export const RoleMenusSchema = z.union([z.literal("*"), z.array(z.string())]);

export const MenuPermissionsSchema = z
  .object({
    version: z.number().default(1),
    roles: z.record(z.string(), RoleMenusSchema).default({}),
    always_visible: z.array(z.string()).default([...DEFAULT_ALWAYS_VISIBLE]),
    // v1 writes `time()` — a unix timestamp in seconds.
    updated_at: z.number().default(0),
  })
  .default({
    version: 1,
    roles: {},
    always_visible: [...DEFAULT_ALWAYS_VISIBLE],
    updated_at: 0,
  });

export type MenuPermissionsFile = z.infer<typeof MenuPermissionsSchema>;

export const NavGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().default("dashboard"),
  items: z.array(z.string()).default([]),
});

export const NavGroupsSchema = z
  .object({
    groups: z.array(NavGroupSchema).default([]),
    // v1 writes `date('c')` — an ISO-8601 string (NOT a unix timestamp).
    updated_at: z.string().optional(),
    updated_by: z.string().optional(),
    is_default: z.boolean().optional(),
  })
  .default({ groups: [] });

export type NavGroupsFile = z.infer<typeof NavGroupsSchema>;

/** Per-feature page grant plan — v1 `teams.json[].feature_pages[key]`. */
export const FeaturePagePlanSchema = z.object({
  user_pages: z.array(z.string()).default([]),
  admin_pages: z.array(z.string()).default([]),
});

/**
 * PHP serialises an empty associative array as `[]`, so `feature_pages` and
 * `page_modes` arrive as either an object or an empty array. v1's JS coerces
 * (`if (!x || Array.isArray(x)) x = {}`); we do the same in the schema.
 */
const objectOrEmptyArray = <T extends z.ZodTypeAny>(inner: T) =>
  z.union([z.record(z.string(), inner), z.array(z.unknown())]).optional();

export const TeamSchema = z
  .object({
    // `id` is load-bearing — PATCH /api/v1/teams/[id] keys off it and the v1
    // admin UI breaks without it (memory: feedback_new_page_checklist).
    id: z.string(),
    slug: z.string(),
    name: z.string().default(""),
    description: z.string().optional(),
    color: z.string().optional(),
    active: z.boolean().optional(),
    created_at: z.string().optional(),
    created_by: z.string().optional(),
    features: z.array(z.string()).default([]),
    feature_pages: objectOrEmptyArray(FeaturePagePlanSchema.partial()),
    page_modes: objectOrEmptyArray(z.string()),
  })
  .passthrough();

export type TeamRecord = z.infer<typeof TeamSchema>;

export const TeamsFileSchema = z.array(TeamSchema).default([]);

/** Only the fields the permission gate needs out of the global users.json. */
export const PermUserSchema = z
  .object({
    id: z.string(),
    username: z.string().optional(),
    role: z.string().optional(),
    team: z.string().nullable().optional(),
    is_genz: z.boolean().optional(),
    menu_permissions: z
      .object({
        grant: z.array(z.string()).optional(),
        deny: z.array(z.string()).optional(),
      })
      .nullable()
      .optional(),
    extra_pages: z
      .array(z.object({ page: z.string(), source_team: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export const PermUsersFileSchema = z.array(PermUserSchema).default([]);

/** data/maintenance.json — shape varies in v1; we only read page flags. */
export const MaintenanceFileSchema = z
  .object({
    pages: z.record(z.string(), z.unknown()).optional(),
    tools: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .default({});

/** Normalise an object-or-empty-array field into a plain object. */
export function asRecord<T>(v: Record<string, T> | unknown[] | undefined): Record<string, T> {
  if (!v || Array.isArray(v)) return {};
  return v as Record<string, T>;
}

/**
 * Zod `.default()` makes a schema's *input* type partial, and the shared
 * `readTeamFile(file, schema: ZodSchema<T>)` signature requires input === output,
 * so TS infers T as the partial input. This helper pins T to the output type;
 * runtime behaviour (including the defaults) is unchanged.
 */
export function out<S extends z.ZodTypeAny>(schema: S): z.ZodSchema<z.output<S>> {
  return schema as unknown as z.ZodSchema<z.output<S>>;
}
