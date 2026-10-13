// som-portal-v2/src/service-performance/sources.ts
//
// Read service-performance-sources.json and resolve Grafana auth.
// SM-shared file — all teams read from data/sm/.

import { readSharedFile } from '@/team/scope';
import { env } from '@/lib/env';
import { SourcesFileSchema, type SourceConfig, type SourcesFile } from './schema';
import type { ThanosSource } from './thanos-client';

/** Load the sources config (SM-shared). */
export async function loadSourcesConfig(): Promise<SourcesFile> {
  return readSharedFile('service-performance-sources.json', SourcesFileSchema);
}

/** Get enabled sources, optionally filtered by slug. */
export async function getEnabledSources(slug?: string): Promise<SourceConfig[]> {
  const cfg = await loadSourcesConfig();
  let sources = cfg.sources.filter((s) => s.enabled);
  if (slug && slug !== 'all') {
    sources = sources.filter((s) => s.slug === slug);
  }
  return sources;
}

/** Build a ThanosSource for the HTTP client from a SourceConfig. */
export function toThanosSource(src: SourceConfig): ThanosSource {
  const grafanaUrl = src.grafanaUrl.replace(/\/$/, '');

  if (src.authMode === 'token') {
    return {
      grafanaUrl,
      dsUid: src.dsUid,
      orgId: src.orgId,
      auth: { kind: 'token', token: src.token },
    };
  }

  // Basic auth from env (cross-org master credential)
  const e = env();
  const user = process.env['GRAFANA_BASIC_USER'] ?? '';
  const pass = process.env['GRAFANA_BASIC_PASS'] ?? '';
  return {
    grafanaUrl,
    dsUid: src.dsUid,
    orgId: src.orgId,
    auth: { kind: 'basic', user, pass },
  };
}

/**
 * Public source info — strips tokens/secrets before returning to the client.
 * Matches v1's spSourcePublic().
 */
export function sourcePublic(src: SourceConfig) {
  return {
    slug: src.slug,
    name: src.name,
    orgId: src.orgId,
    color: src.color,
    labelScheme: src.labelScheme,
    grafanaUrl: src.grafanaUrl.replace(/\/$/, ''),
    dashboardUid: src.dashboardUid,
    dashboardVarName: src.dashboardVarName,
    dsUid: src.dsUid,
    jvmDsUid: src.jvmDsUid,
    cluster: src.cluster,
    namespaceRegex: src.namespaceRegex,
    enabled: src.enabled,
  };
}
