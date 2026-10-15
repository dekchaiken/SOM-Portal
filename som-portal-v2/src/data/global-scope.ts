// som-portal-v2/src/data/global-scope.ts
//
// v1 parity layer for GLOBAL data files.
//
// v1 `api/helpers.php::_isGlobalFile()` short-circuits team scoping for a fixed
// list of platform-wide files — they ALWAYS resolve to `data/<file>`, never
// `data/<team>/<file>`. `users.json`, `forgot_rate_limit.json` and
// `password_reset_tokens.json` are on that list, so the auth flows in v2 must
// read/write the same paths or the PHP ↔ v2 dual-run drifts.
//
// Everything NOT on this list stays team-scoped — use readTeamFile/writeTeamFile
// from `@/team/scope`. Multi-team isolation for global files is enforced by the
// record's own `team` field (see `@/account/users-store`), not by the path.

import { getDataAdapter } from '@/data/json-adapter';
import type { TeamScope } from '@/data/adapter';

/** Exact mirror of v1 `_isGlobalFile()` (api/helpers.php:141). */
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
  'auth-config.json',
] as const;

export function isGlobalFile(file: string): boolean {
  return GLOBAL_FILES.includes(file);
}

/**
 * `{ team: '.' }` makes JsonAdapter.resolvePath() produce `<dataDir>/<file>`
 * (path.join collapses the '.' segment) — i.e. exactly v1's global path.
 */
const GLOBAL_SCOPE: TeamScope = { team: '.' };

/**
 * PHP's JSON_PRETTY_PRINT indents with 4 spaces. Matching it keeps rewrites of
 * the live v1 files (data/users.json is ~340 KB) from producing a whole-file
 * reformat diff on every password change.
 */
export const V1_JSON_INDENT = 4;

function assertGlobal(file: string): void {
  if (!isGlobalFile(file)) {
    throw new Error(
      `[global-scope] "${file}" is not a v1 global file — use readTeamFile/writeTeamFile instead.`,
    );
  }
}

export async function readGlobalFile<T>(file: string, fallback: T): Promise<T> {
  assertGlobal(file);
  const raw = await getDataAdapter().read<T>(GLOBAL_SCOPE, file);
  return raw === null ? fallback : raw;
}

export async function writeGlobalFile<T>(file: string, data: T): Promise<void> {
  assertGlobal(file);
  await updateGlobalFile<T>(file, data, () => data);
}

/** Read-modify-write under an exclusive lock (v1 used flock(LOCK_EX)). */
export async function updateGlobalFile<T>(
  file: string,
  fallback: T,
  mutate: (current: T) => Promise<T> | T,
): Promise<T> {
  assertGlobal(file);
  const adapter = getDataAdapter();
  return adapter.withLock(GLOBAL_SCOPE, file, async () => {
    const current = (await adapter.read<T>(GLOBAL_SCOPE, file)) ?? fallback;
    const next = await mutate(current);
    // Re-using adapter.write() would deadlock on the same lockfile, so write raw.
    const fs = await import('node:fs/promises');
    const full = adapter.resolvePath(GLOBAL_SCOPE, file);
    const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(next, null, V1_JSON_INDENT), 'utf8');
    await fs.rename(tmp, full);
    return next;
  });
}

export function globalFilePath(file: string): string {
  assertGlobal(file);
  return getDataAdapter().resolvePath(GLOBAL_SCOPE, file);
}
