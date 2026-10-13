// som-portal-v2/src/scheduler/lock.ts
// One scheduler tick at a time across processes sharing the data folder.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dataDirAbsolute } from '@/lib/env';

const LOCK_FILE = '.scheduler.lock';
const STALE_MS = 5 * 60_000;

export async function acquireTickLock(): Promise<(() => Promise<void>) | null> {
  const file = path.join(dataDirAbsolute(), LOCK_FILE);
  try {
    const handle = await fs.open(file, 'wx');
    await handle.close();
  } catch {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs < STALE_MS) return null;
    await fs.unlink(file).catch(() => undefined);
    return acquireTickLock();
  }
  return async () => {
    await fs.unlink(file).catch(() => undefined);
  };
}
