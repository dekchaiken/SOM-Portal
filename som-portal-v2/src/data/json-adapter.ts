// som-portal-v2/src/data/json-adapter.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { dataDirAbsolute } from '@/lib/env';
import { type DataAdapter, type TeamScope, SHARED_TEAM } from './adapter';

export class JsonAdapter implements DataAdapter {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? dataDirAbsolute();
  }

  resolvePath(scope: TeamScope, file: string): string {
    // sm-shared files live under <baseDir>/sm/<file>. Per-team files live
    // under <baseDir>/<team>/<file>. v1 compat.
    const safeFile = file.replace(/^\/+/, '');
    if (scope.team === SHARED_TEAM) {
      return path.join(this.baseDir, 'sm', safeFile);
    }
    return path.join(this.baseDir, scope.team, safeFile);
  }

  async read<T = unknown>(scope: TeamScope, file: string): Promise<T | null> {
    const full = this.resolvePath(scope, file);
    try {
      const raw = await fs.readFile(full, 'utf8');
      return JSON.parse(raw) as T;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw e;
    }
  }

  async write<T = unknown>(scope: TeamScope, file: string, data: T): Promise<void> {
    const full = this.resolvePath(scope, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // Ensure file exists for lockfile.
    try {
      await fs.access(full);
    } catch {
      await fs.writeFile(full, '{}', 'utf8');
    }
    const release = await lockfile.lock(full, {
      retries: { retries: 5, minTimeout: 20, maxTimeout: 200 },
      stale: 5000,
    });
    try {
      const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, full);
    } finally {
      await release();
    }
  }

  async update<T = unknown>(scope: TeamScope, file: string, fn: (current: T | null) => T | Promise<T>): Promise<T> {
    const full = this.resolvePath(scope, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    try {
      await fs.access(full);
    } catch {
      await fs.writeFile(full, 'null', 'utf8');
    }
    const release = await lockfile.lock(full, {
      retries: { retries: 10, minTimeout: 20, maxTimeout: 200 },
      stale: 5000,
    });
    try {
      const raw = await fs.readFile(full, 'utf8').catch(() => 'null');
      let current: T | null = null;
      try {
        current = JSON.parse(raw) as T | null;
      } catch {
        current = null;
      }
      const next = await fn(current);
      const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(tmp, full);
      return next;
    } finally {
      await release();
    }
  }

  async withLock<T>(scope: TeamScope, file: string, fn: () => Promise<T>): Promise<T> {
    const full = this.resolvePath(scope, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    try {
      await fs.access(full);
    } catch {
      await fs.writeFile(full, '{}', 'utf8');
    }
    const release = await lockfile.lock(full, {
      retries: { retries: 5, minTimeout: 20, maxTimeout: 200 },
      stale: 5000,
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}

let defaultAdapter: DataAdapter | null = null;
export function getDataAdapter(): DataAdapter {
  if (!defaultAdapter) defaultAdapter = new JsonAdapter();
  return defaultAdapter;
}

export function __setDataAdapter(a: DataAdapter | null): void {
  defaultAdapter = a;
}
