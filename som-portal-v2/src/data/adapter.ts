// som-portal-v2/src/data/adapter.ts

export interface TeamScope {
  /** Team id (`sm`, `dev`, ...). Pass `__shared__` for SM-shared files. */
  team: string;
}

export const SHARED_TEAM = '__shared__' as const;
/** v1 layout: files written without a team claim land under `__no_team__/`. */
export const NO_TEAM = '__no_team__' as const;

export interface DataAdapter {
  /** Raw read — returns parsed JSON or `null` if the file does not exist. */
  read<T = unknown>(scope: TeamScope, file: string): Promise<T | null>;

  /** Atomic write via lock + temp file rename. */
  write<T = unknown>(scope: TeamScope, file: string, data: T): Promise<void>;

  /** Run `fn` with an exclusive lock on the file. */
  withLock<T>(scope: TeamScope, file: string, fn: () => Promise<T>): Promise<T>;

  /** Absolute path for a given scope+file. */
  resolvePath(scope: TeamScope, file: string): string;
}
