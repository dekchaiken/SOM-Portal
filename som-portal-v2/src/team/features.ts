// som-portal-v2/src/team/features.ts
//
// Global (cross-team) data files + the per-team feature gate.
//
// v1 parity: `api/helpers.php::_isGlobalFile()` routes a small set of files to
// DATA_DIR root rather than DATA_DIR/<team>/. `teams.json` is one of them, and
// it carries each team's granted `features` array — the backend half of the
// sidebar visibility rule enforced by `requireTeamFeature($payload, $key)`.
//
// This module is deliberately read-only: granting/revoking features is
// super_admin territory (admin/super-team-permissions) and owned elsewhere.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { dataDirAbsolute } from '@/lib/env';
import { ForbiddenError } from '@/lib/errors';
import { logSecurity } from '@/logging/security';
import type { Session } from '@/auth/session';
import { SUPER_ADMIN } from '@/auth/policy';

/** Mirrors `_isGlobalFile()` in api/helpers.php (2026-10). */
export const GLOBAL_FILES: readonly string[] = [
  'users.json',
  'teams.json',
  'feature_requests.json',
  'system-settings.json',
  'rate_limit.json',
  'api_rate_limit.json',
  'forgot_rate_limit.json',
  'password_reset_tokens.json',
  'metrics.json',
  'server_metrics.json',
  'n8n_oncall_config.json',
  'n8n_severity_config.json',
  'maintenance.json',
  'requests.json',
];

export function isGlobalFile(file: string): boolean {
  return GLOBAL_FILES.includes(file);
}

/** Absolute path of a global data file (DATA_DIR root — never team-scoped). */
export function globalFilePath(file: string): string {
  return path.join(dataDirAbsolute(), file.replace(/^\/+/, ''));
}

/** Read a global data file, validating with `schema`. Missing file → schema default. */
export async function readGlobalFile<T>(file: string, schema: z.ZodSchema<T>): Promise<T> {
  let raw: unknown = undefined;
  try {
    raw = JSON.parse(await fs.readFile(globalFilePath(file), 'utf8'));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // v1 surfaces parse failures in the error log but still renders the page.
      console.error(`[readGlobalFile] read/parse failed for ${file}`, e);
    }
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fallback = schema.safeParse(undefined);
  if (fallback.success) return fallback.data;
  throw new Error(`Schema validation failed for ${file}`);
}

// ─── teams.json ──────────────────────────────────────────────────────────────
export const TeamConfigSchema = z
  .object({
    // `id` is load-bearing: PATCH on admin/super-team-permissions keys off it.
    id: z.string().optional(),
    slug: z.string(),
    name: z.string().optional(),
    features: z.array(z.string()).default([]),
    page_modes: z.union([z.record(z.string(), z.string()), z.array(z.unknown())]).optional(),
  })
  .passthrough();
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

export const TeamsFileSchema = z.array(TeamConfigSchema).default([]);

export async function loadTeams(): Promise<TeamConfig[]> {
  return ((await readGlobalFile('teams.json', TeamsFileSchema)) ?? []) as TeamConfig[];
}

export async function getTeamConfig(slug: string): Promise<TeamConfig | null> {
  const teams = await loadTeams();
  return teams.find((t) => t.slug === slug) ?? null;
}

/** Granted feature keys for a team slug. Unknown team → []. */
export async function teamFeatures(slug: string): Promise<string[]> {
  return (await getTeamConfig(slug))?.features ?? [];
}

/**
 * True when `session`'s team has `featureKey` granted. super_admin always
 * passes (v1: `requireTeamFeature` returns early for super_admin).
 */
export async function hasTeamFeature(session: Session, featureKey: string): Promise<boolean> {
  if (session.role === SUPER_ADMIN) return true;
  if (!session.team) return false;
  const team = await getTeamConfig(session.team);
  if (!team) return false;
  return team.features.includes(featureKey);
}

/** Throwing variant — direct port of `requireTeamFeature()`. */
export async function requireTeamFeature(session: Session, featureKey: string): Promise<void> {
  if (session.role === SUPER_ADMIN) return;
  if (!session.team) throw new ForbiddenError('Forbidden: no team context');
  const team = await getTeamConfig(session.team);
  if (!team) throw new ForbiddenError('Forbidden: unknown team');
  if (team.features.includes(featureKey)) return;
  await logSecurity({
    user: session.sub,
    team: session.team,
    event: 'feature_forbidden',
    meta: { feature: featureKey },
  });
  throw new ForbiddenError(
    `Your team does not have access to this feature (${featureKey})`,
  );
}

/**
 * Port of `requirePageMode()` — a team can be downgraded to read-only on a
 * given page id via `teams.json.page_modes`. Writes must call this.
 */
export async function requirePageMode(
  session: Session,
  pageId: string,
  requiredMode: 'full' | 'read' = 'full',
): Promise<void> {
  if (session.role === SUPER_ADMIN) return;
  if (requiredMode !== 'full') return;
  if (!session.team) return; // no team context = SM (full access) in v1
  const team = await getTeamConfig(session.team);
  if (!team) return;
  const modes = team.page_modes;
  const mode = Array.isArray(modes) ? undefined : modes?.[pageId];
  if (mode === 'read') {
    await logSecurity({
      user: session.sub,
      team: session.team,
      event: 'page_mode_forbidden',
      meta: { page: pageId, mode: 'read' },
    });
    throw new ForbiddenError('This page is read-only for your team');
  }
}

/**
 * Port of `isSmCoverageAdmin()` — cross-team ops surfaces (batch Coverage /
 * backfill) are SM-owned and must not leak to another team's admin.
 */
export function isSmCoverageAdmin(session: Session): boolean {
  if (session.role === SUPER_ADMIN) return true;
  if (!['sm_admin', 'dev_sm'].includes(session.role)) return false;
  return session.team === 'sm';
}

export async function requireSmCoverageAdmin(
  session: Session,
  resource = 'this resource',
): Promise<void> {
  if (isSmCoverageAdmin(session)) return;
  await logSecurity({
    user: session.sub,
    team: session.team,
    event: 'sm_coverage_denied',
    meta: { resource, role: session.role },
  });
  throw new ForbiddenError('เฉพาะ admin ของทีม sm เท่านั้น');
}
