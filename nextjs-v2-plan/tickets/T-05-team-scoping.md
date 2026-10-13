# T-05 — Team scoping module: shape of `teamDataPath` equivalent in TypeScript

> Type: `decision` · HITL · Blocked by: T-01 · Owner: unclaimed · Blocks: all feature engineer tickets

## Question

What is the exact API surface of the team-scoping module in v2?

## Context

- v1 has `teamDataPath()` and SM-shared / section-scoped helpers (see memories `team_data_path_helper`, `sm_shared_files_pattern`, `section_scoped_sm_share`).
- Every feature-engineer file in v2 will import this; we must get the shape right or we eat it 71 pages later.
- Blocked by T-01 because the signatures differ for JSON vs PG.

## Proposed API

```ts
// src/team/scope.ts (JSON adapter)
export async function readTeamFile<T>(file: string, schema: z.ZodSchema<T>, session?: Session): Promise<T>;
export async function writeTeamFile<T>(file: string, data: T, schema: z.ZodSchema<T>, session?: Session): Promise<void>;
export async function readSharedFile<T>(file: string, schema: z.ZodSchema<T>): Promise<T>;
export async function writeSharedFile<T>(file: string, data: T, schema: z.ZodSchema<T>, session: Session): Promise<void>;
export async function readSectionScopedFile<T, K extends keyof T>(file: string, section: K, schema: z.ZodSchema<T>, session: Session): Promise<T[K]>;
```

- Session argument defaults to the current request session (via `getSession()` from `src/auth`).
- `writeSharedFile` throws if the caller isn't an SM role.
- Zod schema runs on both read + write. Read failures log + return a safe default from the schema; write failures throw.

## Open questions

1. Do we expose an escape hatch to read another team's file (`super_admin` view-as)? Signature would be `readTeamFile(file, schema, { team: 'other' })`.
2. Where do activity + security logs live in the type hierarchy — in `src/team/scope.ts` or `src/logging/`?

## Resolution

**Decision:** Lock the proposed API with the cross-team `view-as` escape hatch for `super_admin`. Final shape:

```ts
// src/team/scope.ts
import type { ZodSchema } from 'zod';
import type { Session } from '@/auth/session';

interface Scope {
  /** Override the team claim. Only honoured if the current session is super_admin. */
  team?: string;
}

export async function readTeamFile<T>(
  file: string,
  schema: ZodSchema<T>,
  scope?: Scope,
): Promise<T>;

export async function writeTeamFile<T>(
  file: string,
  data: T,
  schema: ZodSchema<T>,
  scope?: Scope,
): Promise<void>;

export async function readSharedFile<T>(
  file: string,
  schema: ZodSchema<T>,
): Promise<T>;

export async function writeSharedFile<T>(
  file: string,
  data: T,
  schema: ZodSchema<T>,
): Promise<void>;  // requires sm_* role; throws otherwise

export async function readSectionScopedFile<T, K extends keyof T>(
  file: string,
  section: K,
  schema: ZodSchema<T>,
): Promise<T[K]>;
```

Rules:
1. Session fetched automatically via `getSession()` from `src/auth`. No prop drilling.
2. `scope.team` is honoured only when `requireRole(SUPER_ADMIN)` passes; otherwise throws 403.
3. `writeSharedFile` runs `requireRole(sm_admin, sm_lead, dev_sm, super_admin)` + logs to audit log.
4. Reads log on schema drift (stderr), never throw — same soft-fail behaviour as v1 to keep pages up.
5. Writes throw on schema violation and are rolled back by `proper-lockfile` on error.
6. Activity + security logs live under `src/logging/`, not here. This module calls them.

**Why cross-team escape hatch:** v1 ships this (super_admin's view-as). Removing it would break the super-admin dashboard. Making super_admin drop to raw `DataAdapter` leaks the file-path convention into every super-admin page — worse than one typed opt-in.

**Follow-ups:**
- Foundation Engineer implements this in the scaffold PR with Zod + Vitest contract tests (readTeamFile → correct dir, writeTeamFile → cross-team denied for non-super_admin, writeSharedFile → requires sm_*).
- `super_admin` auditing: every cross-team read emits a `security.cross_team_access` log entry.

**Owner:** Chief Architect
**Date:** 2026-10-11
