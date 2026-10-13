// som-portal-v2/src/opensearch/endpoints.ts
// Reads opensearch_config.json, lists + validates endpoint_id.
import { readTeamFile } from '@/team/scope';
import { OpenSearchConfigSchema, type OpenSearchConfig, type Endpoint } from './schema';

const CONFIG_FILE = 'opensearch_config.json';

export async function loadConfig(): Promise<OpenSearchConfig> {
  return readTeamFile<OpenSearchConfig>(CONFIG_FILE, OpenSearchConfigSchema);
}

export async function listEndpoints(): Promise<Endpoint[]> {
  const cfg = await loadConfig();
  return cfg.endpoints
    .filter((e) => e.enabled !== false)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

export async function getEndpoint(endpointId: string): Promise<Endpoint | null> {
  const cfg = await loadConfig();
  const ep = cfg.endpoints.find((e) => e.id === endpointId);
  if (!ep) return null;
  if (ep.enabled === false) return null;
  return ep;
}

export async function getValidEndpointIds(): Promise<string[]> {
  const cfg = await loadConfig();
  return cfg.endpoints.map((e) => e.id);
}

/**
 * Redact admin credentials from endpoint data for list-endpoints proxy response.
 */
export function redactEndpoint(ep: Endpoint): Record<string, unknown> {
  return {
    id: ep.id,
    name: ep.name,
    default_index_pattern: ep.default_index_pattern,
    index_patterns: ep.index_patterns,
    has_dashboards_url: !!ep.dashboards_url,
    order: ep.order,
  };
}
