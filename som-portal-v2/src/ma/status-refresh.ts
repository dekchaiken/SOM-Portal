// som-portal-v2/src/ma/status-refresh.ts
// Refreshes the Admin Portal source of the MA status cache and rebuilds the joined
// payload. Other sources keep their last result until their fetchers are ported.
// A failed fetch is recorded on the source (ok=false, error) and never clears data.
import { writeTeamFile, readTeamFile } from '@/team/scope';
import { listServices } from './services-store';
import { listUseCases } from './backoffice-client';
import { backofficeItems, joinStatus, type BackofficeUseCase } from './status-join';
import { MAStatusCacheSchema, type MAStatusCache, type MAStatusSource } from './types';

const CACHE_FILE = 'ma-status-cache.json';

export interface RefreshResult {
  ok: boolean;
  error: string | null;
  summary: { total: number; open: number; closed: number; unknown: number; matched: number } | null;
}

export async function refreshStatus(): Promise<RefreshResult> {
  const now = Math.floor(Date.now() / 1000);
  const prev: MAStatusCache = await readTeamFile(CACHE_FILE, MAStatusCacheSchema);

  const r = await listUseCases();
  const content = (r.data && typeof r.data === 'object' && Array.isArray((r.data as { content?: unknown }).content)
    ? (r.data as { content: BackofficeUseCase[] }).content
    : []) as BackofficeUseCase[];
  const boSource: MAStatusSource = r.ok
    ? { ok: true, fetched_at: now, items: backofficeItems(content) }
    : { ok: false, fetched_at: now, items: prev.payload.sources.tmn_backoffice?.items ?? [], error: r.error ?? 'Admin Portal fetch failed' };

  const services = await listServices();
  const sources: Record<string, MAStatusSource> = { ...prev.payload.sources, tmn_backoffice: boSource };
  const payload = joinStatus(services, sources, now);
  const cache: MAStatusCache = { ts: now, filter: 'all', payload: payload as MAStatusCache['payload'] };
  await writeTeamFile(CACHE_FILE, cache, MAStatusCacheSchema);

  return {
    ok: r.ok,
    error: r.ok ? null : boSource.error ?? 'Admin Portal fetch failed',
    summary: payload.summary,
  };
}
