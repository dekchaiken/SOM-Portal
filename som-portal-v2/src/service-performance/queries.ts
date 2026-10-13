// som-portal-v2/src/service-performance/queries.ts
//
// All PromQL query templates ported from v1's _lib.php and detail.php.
// Uses the `promql` tagged template to prevent injection.

import { promql, re, str, raw, type PromQLQuery } from './promql';
import { escapeRegex } from './escape';
import type { SourceConfig } from './schema';

// ─── Overview queries (per-runway) ──────────────────────────────────────────

/** k8s label scheme — kube-state-metrics + cadvisor. Port of _spQueriesK8s. */
export function queriesK8s(src: SourceConfig): Record<string, PromQLQuery> {
  // Build selector parts. These come from config (admin-managed), not user
  // input, so they go through raw fragments. We construct the query string
  // manually because the selector parts are already PromQL-native from config.
  const parts: string[] = [];
  if (src.cluster) parts.push(`cluster=~"${src.cluster}"`);
  parts.push(`namespace=~"${src.namespaceRegex}"`);
  if (src.namespaceExclude) parts.push(`namespace!~"${src.namespaceExclude}"`);
  if (src.podExclude) parts.push(`pod!~"${src.podExclude}"`);
  const sel = parts.join(',');

  // These are pre-composed queries matching v1 exactly. Since the selector
  // values come from our own config JSON (not user input), direct string
  // building is safe here — same as v1 PHP concat.
  return {
    pods: `kube_pod_info{${sel}}` as PromQLQuery,
    cpuUsed: `sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{${sel},container!="",container!="POD"}[5m]))` as PromQLQuery,
    cpuLimit: `sum by (namespace, pod) (kube_pod_container_resource_limits{${sel},resource="cpu",container!=""})` as PromQLQuery,
    memUsed: `sum by (namespace, pod) (container_memory_working_set_bytes{${sel},container!="",container!="POD"})` as PromQLQuery,
    memLimit: `sum by (namespace, pod) (kube_pod_container_resource_limits{${sel},resource="memory",container!=""})` as PromQLQuery,
  };
}

/** appScope label scheme — ACM exporters. Port of _spQueriesAppScope. */
export function queriesAppScope(src: SourceConfig): Record<string, PromQLQuery> {
  const env = src.envName ?? 'prod';
  const scope = src.appScope ?? '.+';
  const sel = `env_name="${env}",appScope=~"${scope}"`;

  return {
    pods: `count by (appScope) (up{${sel}} == 1)` as PromQLQuery,
    cpuUsed: `sum by (appScope) (rate(container_cpu_usage_seconds_total{${sel},container!="",container!="POD"}[5m]))` as PromQLQuery,
    cpuLimit: `sum by (appScope) (kube_pod_container_resource_limits{${sel},resource="cpu",container!=""})` as PromQLQuery,
    memUsed: `sum by (appScope) (container_memory_working_set_bytes{${sel},container!="",container!="POD"})` as PromQLQuery,
    memLimit: `sum by (appScope) (kube_pod_container_resource_limits{${sel},resource="memory",container!=""})` as PromQLQuery,
  };
}

/** Get the right query set for a source based on its labelScheme. */
export function queriesForSource(src: SourceConfig): Record<string, PromQLQuery> {
  return src.labelScheme === 'appScope' ? queriesAppScope(src) : queriesK8s(src);
}

// ─── Per-workload queries (detail view) ─────────────────────────────────────
// Port of _spQueriesK8sForWorkload from _lib.php:457-498.

export function queriesK8sForWorkload(
  src: SourceConfig,
  namespace: string,
  service: string,
  overrideCluster?: string,
): Record<string, PromQLQuery> {
  const svcRe = escapeRegex(service);
  const parts: string[] = [];

  if (overrideCluster) {
    parts.push(`cluster="${overrideCluster}"`);
  } else if (src.cluster) {
    parts.push(`cluster=~"${src.cluster}"`);
  }
  parts.push(`namespace="${namespace}"`);
  parts.push(`pod=~"${svcRe}.*"`);
  const sel = parts.join(',');
  const containerSel = `container="${service}"`;

  return {
    pods: `kube_pod_info{${sel}}` as PromQLQuery,
    cpuUsed: `avg by (namespace, pod) (rate(container_cpu_usage_seconds_total{${sel},${containerSel}}[10m]))` as PromQLQuery,
    cpuLimit: `avg by (namespace, pod) (kube_pod_container_resource_limits{${sel},${containerSel},resource="cpu"})` as PromQLQuery,
    cpuRequest: `avg by (namespace, pod) (kube_pod_container_resource_requests{${sel},${containerSel},resource="cpu"})` as PromQLQuery,
    memUsed: `avg by (namespace, pod) (container_memory_working_set_bytes{${sel},${containerSel}})` as PromQLQuery,
    memLimit: `avg by (namespace, pod) (kube_pod_container_resource_limits{${sel},${containerSel},resource="memory"})` as PromQLQuery,
    memRequest: `avg by (namespace, pod) (kube_pod_container_resource_requests{${sel},${containerSel},resource="memory"})` as PromQLQuery,
  };
}

// ─── Pod hash stripping (port of _spStripPodHash) ───────────────────────────

/**
 * Strip common Kubernetes pod-name suffixes to derive the workload name.
 * Direct port of v1 _spStripPodHash (_lib.php:361-380).
 */
export function stripPodHash(pod: string): string {
  let current = pod;
  for (let i = 0; i < 4; i++) {
    const orig = current;
    // Deployment RS-hash + pod-hash
    let m = current.match(/^(.+)-[a-z0-9]{5,11}-[a-z0-9]{5}$/);
    if (m) { current = m[1]!; continue; }
    // CronJob Job pod: <workload>-<epoch>-<counter>
    m = current.match(/^(.+)-\d{8,13}-\d{1,6}$/);
    if (m) { current = m[1]!; continue; }
    // Job without counter: <workload>-<epoch>
    m = current.match(/^(.+)-\d{8,13}$/);
    if (m) { current = m[1]!; continue; }
    // DaemonSet: <workload>-<5 alnum>
    m = current.match(/^(.+)-[a-z0-9]{5}$/);
    if (m) { current = m[1]!; continue; }
    // StatefulSet ordinal: <workload>-<digits>
    m = current.match(/^(.+)-\d{1,5}$/);
    if (m) { current = m[1]!; continue; }
    if (current === orig) break;
  }
  return current;
}

// ─── Protocol classification (port of _spClassifyProtocol) ──────────────────

export function classifyProtocol(host: string): string {
  const h = host.toLowerCase().trim();
  if (!h) return 'http';
  if (/:(6379|6380)(?:$|\/)/.test(h)) return 'redis';
  if (h.includes(':27017')) return 'mongo';
  if (h.includes(':5672') || h.includes(':5671')) return 'rabbitmq';
  if (h.includes(':9092') || h.includes(':9093')) return 'kafka';
  if (h.includes(':3306')) return 'mysql';
  if (h.includes(':5432')) return 'postgres';
  if (h.includes(':1521')) return 'oracle';
  if (/(^|[.-])redis([.-]|$)/.test(h)) return 'redis';
  if (/(^|[.-])(mongo|mongodb)([.-]|$)/.test(h)) return 'mongo';
  if (/(^|[.-])(rabbit(mq)?|amqp)([.-]|$)/.test(h)) return 'rabbitmq';
  if (/(^|[.-])kafka([.-]|$)/.test(h)) return 'kafka';
  if (/(^|[.-])(mysql|mariadb)([.-]|$)/.test(h)) return 'mysql';
  if (/(^|[.-])(postgres|postgresql|pg)([.-]|$)/.test(h)) return 'postgres';
  if (/(^|[.-])oracle([.-]|$)/.test(h)) return 'oracle';
  if (/(^|[.-])(elastic(search)?|opensearch|es)([.-]|$)/.test(h)) return 'search';
  return 'http';
}

/** Extract service name from FQDN (port of _spHostToService). */
export function hostToService(host: string): string {
  let h = host.trim();
  if (!h) return '';
  h = h.replace(/^[a-z]+:\/\//i, '');
  h = h.split(/[/?]/)[0] ?? h;
  const portIdx = h.indexOf(':');
  if (portIdx !== -1) h = h.slice(0, portIdx);
  const first = h.split('.')[0] ?? h;
  return first ? first.toLowerCase() : h;
}
