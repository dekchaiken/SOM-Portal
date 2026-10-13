// som-portal-v2/src/data/global-store.ts
//
// Global (platform-wide) data files — the v2 counterpart of v1's
// `_isGlobalFile()` in api/helpers.php.
//
// v1 rule (api/helpers.php :: _teamDataPath):
//   • Global files    → DATA_DIR/{file}        (always, regardless of team)
//   • SM-shared files → DATA_DIR/sm/{file}
//   • per-team        → DATA_DIR/{team}/{file}
//
// `users.json` and `system-settings.json` are GLOBAL in v1: there is exactly one
// users file for the whole platform and every record carries a `team` field.
// Multi-team isolation for users is therefore enforced *in the endpoint* (filter
// by `team`, role gates), NOT by directory. Reading `data/sm/users.json` would
// read a stale pre-migration snapshot (it exists but is no longer written to),
// so team-scoped reads are wrong for this file. See the comment block in
// api/users/index.php.
//
// Keep this list in sync with api/helpers.php :: _isGlobalFile().
import type { ZodSchema } from 'zod';
import { getDataAdapter } from './json-adapter';
import type { TeamScope } from './adapter';

export const GLOBAL_FILES = [
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
] as const;

export type GlobalFile = (typeof GLOBAL_FILES)[number];

export function isGlobalFile(file: string): boolean {
  return (GLOBAL_FILES as readonly string[]).includes(file);
}

/**
 * `{ team: '' }` makes JsonAdapter.resolvePath() emit `<DATA_DIR>/<file>`
 * (path.join drops the empty segment) — exactly v1's global path.
 */
const GLOBAL_SCOPE: TeamScope = { team: '' };

function assertGlobal(file: string): void {
  if (!isGlobalFile(file)) {
    throw new Error(
      `[global-store] ${file} is not a global file — use readTeamFile/readSharedFile`,
    );
  }
}

export async function readGlobalFile<T>(file: GlobalFile, schema: ZodSchema<T>): Promise<T> {
  assertGlobal(file);
  const raw = await getDataAdapter().read<unknown>(GLOBAL_SCOPE, file);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Soft-fail like readTeamFile: log drift, fall back to the schema default.
  console.error(`[global-store.read] schema drift: ${file}`, parsed.error.flatten());
  const fallback = schema.safeParse(undefined);
  if (fallback.success) return fallback.data;
  throw new Error(`Schema validation failed for ${file}`);
}

export async function writeGlobalFile<T>(
  file: GlobalFile,
  data: T,
  schema: ZodSchema<T>,
): Promise<void> {
  assertGlobal(file);
  const parsed = schema.parse(data); // throws on write — never persist garbage
  await getDataAdapter().write(GLOBAL_SCOPE, file, parsed);
}

/**
 * Read-modify-write a global file under an exclusive lock. Mirrors v1's
 * flock(LOCK_EX) around readJson/writeJson for compare-and-set mutations such
 * as "add a user if the username is free".
 */
let mutexChain: Promise<unknown> = Promise.resolve();

export async function mutateGlobalFile<T>(
  file: GlobalFile,
  schema: ZodSchema<T>,
  fn: (current: T) => Promise<T> | T,
): Promise<T> {
  assertGlobal(file);
  // In-process serialisation: adapter.write() takes the on-disk lock itself, so
  // nesting adapter.withLock() around it would deadlock on the same lockfile.
  // The chain closes the read-modify-write race for concurrent requests in this
  // Node process; the adapter's flock still protects against the PHP v1 writer.
  const run = mutexChain.then(async () => {
    const current = await readGlobalFile(file, schema);
    const next = await fn(current);
    await writeGlobalFile(file, next, schema);
    return next;
  });
  mutexChain = run.catch(() => undefined);
  return run;
}
