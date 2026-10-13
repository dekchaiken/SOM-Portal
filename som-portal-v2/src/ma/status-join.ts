// som-portal-v2/src/ma/status-join.ts
// Joins MA usecases with the live status sources and builds the status payload.
// Port of api/ma-status/index.php (join, discovery, summary). Pure functions, no I/O.
//
// Matching order per usecase (same as v1):
//   1. backoffice_use_case_id set and found in the Admin Portal source
//   2. tool_type "Admin Portal" and the normalised name matches an Admin Portal label
//   3. tool_type "Jenkins" and the name matches a Jenkins job label
//   4. the name matches a NANO CDN product label
import type { MAStatusItem, MAStatusSource } from './types';

/** v1 ma_norm_name: strip a leading "disable", lower-case, keep letters and digits. */
export function normName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .trim()
    .replace(/^disable\s+/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface BackofficeUseCase {
  use_case_id?: number | string | null;
  use_case_name?: string | null;
  ma_enable?: boolean | null;
  updated_at?: string | null;
  updated_by?: string | null;
  use_case_type?: string | null;
}

/** v1 ma_fetch_backoffice: one row per upstream use case. ma_enable true means closed. */
export function backofficeItems(content: BackofficeUseCase[]): MAStatusItem[] {
  return content.map((r) => ({
    name: `bo:${r.use_case_id ?? ''}`,
    label: r.use_case_name ?? '',
    use_case_id: r.use_case_id == null ? undefined : Number(r.use_case_id),
    type: 'tmn_backoffice',
    status: r.ma_enable ? 'closed' : 'open',
    updated_at: r.updated_at ?? '',
    updated_by: r.updated_by ?? '',
    category: r.use_case_type ?? '',
  }));
}

export interface UsecaseRow {
  id: number;
  service_name: string;
  service_type: string;
  tool_type: string;
  backoffice_use_case_id?: number | null;
  direct_link?: string;
}

export interface JoinedRow {
  id: number;
  service_name: string;
  service_type: string;
  tool_type: string;
  status: 'open' | 'closed' | 'unknown';
  source: string | null;
  matched: boolean;
  upstream_ref?: string;
  updated_at: string | null;
  link: string | null;
}

export interface StatusPayload {
  sources: Record<string, MAStatusSource>;
  services: JoinedRow[];
  unmapped_backoffice: MAStatusItem[];
  summary: {
    total: number;
    open: number;
    closed: number;
    unknown: number;
    matched: number;
    per_source: Record<string, { ok: boolean; count: number; fetched_at: number; error: string | null }>;
  };
}

export function joinStatus(
  services: UsecaseRow[],
  sources: Record<string, MAStatusSource>,
  now: number = Math.floor(Date.now() / 1000),
): StatusPayload {
  const bo: MAStatusItem[] = sources.tmn_backoffice?.items ?? [];
  const boByName = new Map<string, MAStatusItem>();
  const boById = new Map<number, MAStatusItem>();
  for (const it of bo) {
    const key = normName(it.label);
    if (key) boByName.set(key, it);
    if (it.use_case_id) boById.set(Number(it.use_case_id), it);
  }
  const jenkinsByLabel = new Map<string, MAStatusItem>();
  for (const it of sources.tmn_jenkins?.items ?? []) jenkinsByLabel.set(normName(it.label), it);
  const nanoByLabel = new Map<string, MAStatusItem>();
  for (const it of sources.nano?.items ?? []) nanoByLabel.set(normName(it.label), it);

  const mappedBo = new Set<number>();
  const joined: JoinedRow[] = services.map((svc) => {
    const row: JoinedRow = {
      id: svc.id,
      service_name: svc.service_name,
      service_type: svc.service_type,
      tool_type: svc.tool_type,
      status: 'unknown',
      source: null,
      matched: false,
      updated_at: null,
      link: svc.direct_link ?? null,
    };
    const key = normName(svc.service_name);
    const keyStripped = key.replace(/^disable\s+/, '');

    const explicit = svc.backoffice_use_case_id ? boById.get(Number(svc.backoffice_use_case_id)) : undefined;
    const byName = svc.tool_type === 'Admin Portal' ? (boByName.get(key) ?? boByName.get(keyStripped)) : undefined;
    const jenkins = svc.tool_type === 'Jenkins' ? jenkinsByLabel.get(key) : undefined;
    const nano = nanoByLabel.get(key);

    if (explicit) {
      Object.assign(row, { status: explicit.status, source: 'tmn_backoffice', upstream_ref: `use_case_id=${explicit.use_case_id}`, updated_at: explicit.updated_at || null, matched: true });
      mappedBo.add(Number(svc.backoffice_use_case_id));
    } else if (byName) {
      Object.assign(row, { status: byName.status, source: 'tmn_backoffice', upstream_ref: `use_case_id=${byName.use_case_id}`, updated_at: byName.updated_at || null, matched: true });
      if (byName.use_case_id) mappedBo.add(Number(byName.use_case_id));
    } else if (jenkins) {
      Object.assign(row, { status: jenkins.status, source: 'tmn_jenkins', upstream_ref: jenkins.name, updated_at: jenkins.updated_at || null, link: jenkins.link ?? row.link, matched: true });
    } else if (nano) {
      Object.assign(row, { status: nano.status, source: 'nano', upstream_ref: nano.name, matched: true });
    }
    return row;
  });

  const unmapped = bo.filter((it: MAStatusItem) => {
    const id = Number(it.use_case_id ?? 0);
    return id !== 0 && !mappedBo.has(id);
  });

  const summary = { total: joined.length, open: 0, closed: 0, unknown: 0, matched: 0, per_source: {} as StatusPayload['summary']['per_source'] };
  for (const r of joined) {
    summary[r.status] += 1;
    if (r.matched) summary.matched += 1;
  }
  for (const [k, s] of Object.entries(sources)) {
    summary.per_source[k] = { ok: !!s.ok, count: s.items?.length ?? 0, fetched_at: s.fetched_at ?? now, error: s.error ?? null };
  }
  return { sources, services: joined, unmapped_backoffice: unmapped, summary };
}
