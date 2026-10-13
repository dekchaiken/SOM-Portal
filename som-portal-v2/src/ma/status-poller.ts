// som-portal-v2/src/ma/status-poller.ts
// Reads cached MA status from ma-status-cache.json.
// Port of api/ma-status/_lib.php + the polling endpoint.
// The actual polling is done by v1 (PHP cron); v2 reads the shared cache file.
import { readTeamFile, writeTeamFile, type Scope } from '@/team/scope';
import {
  MAStatusCacheSchema,
  MAStatusHiddenSchema,
  type MAStatusCache,
  type MAStatusHidden,
  type MAStatusItem,
} from './types';

const CACHE_FILE = 'ma-status-cache.json';
const HIDDEN_FILE = 'ma-status-hidden.json';

/** Read the shared status cache (written by v1 poller). */
export async function readStatusCache(scope?: Scope): Promise<MAStatusCache> {
  return readTeamFile(CACHE_FILE, MAStatusCacheSchema, scope);
}

/** Read user-hidden items map. */
export async function readHidden(scope?: Scope): Promise<MAStatusHidden> {
  return readTeamFile(HIDDEN_FILE, MAStatusHiddenSchema, scope);
}

/** Write user-hidden items map. */
export async function writeHidden(data: MAStatusHidden, scope?: Scope): Promise<void> {
  return writeTeamFile(HIDDEN_FILE, data, MAStatusHiddenSchema, scope);
}

/** Flatten all status items from all sources. */
export function flattenStatusItems(cache: MAStatusCache): MAStatusItem[] {
  const items: MAStatusItem[] = [];
  for (const src of Object.values(cache.payload.sources)) {
    if (src.ok) items.push(...src.items);
  }
  return items;
}

/** Filter items by source, removing user-hidden entries. */
export function filterItems(
  cache: MAStatusCache,
  hidden: MAStatusHidden,
  sourceFilter?: string,
): MAStatusItem[] {
  const items = flattenStatusItems(cache);
  const filtered = sourceFilter
    ? items.filter((i) => i.type === sourceFilter)
    : items;
  // Remove hidden items per source
  return filtered.filter((item) => {
    const hiddenNames = hidden[item.type];
    if (!hiddenNames || hiddenNames.length === 0) return true;
    return !hiddenNames.includes(item.name);
  });
}
