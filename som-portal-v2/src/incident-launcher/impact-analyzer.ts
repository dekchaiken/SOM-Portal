// som-portal-v2/src/incident-launcher/impact-analyzer.ts
// Port of api/incident-launcher/impact.php — multi-layer health check.
// In v2, this is a thin proxy to the v1 endpoint during dual-run.
// The full Prometheus query logic is complex (4 layers, 12+ PromQL queries)
// and tightly coupled to Grafana datasource config. We delegate to v1 for now
// and provide a typed interface for the frontend.

import type { ImpactResult, ImpactSeverity } from "./types";

/** Compute overall severity from counters (used in tests and fallback). */
export function computeSeverity(
  total5xx: number,
  totalRestarts: number,
  totalBankErrors: number,
  hasGateway = false,
): ImpactSeverity {
  if (hasGateway || totalBankErrors > 500 || total5xx > 500) return "critical";
  if (total5xx > 100 || totalBankErrors > 50) return "high";
  if (total5xx > 10 || totalRestarts > 3) return "medium";
  return "low";
}

/** Severity color mapping for the UI. */
export function severityColor(sev: ImpactSeverity): string {
  switch (sev) {
    case "critical":
      return "#ef4444";
    case "high":
      return "#f97316";
    case "medium":
      return "#eab308";
    case "low":
      return "#22c55e";
  }
}

/** Empty impact result for error/fallback cases. */
export function emptyImpactResult(from: string, to: string): ImpactResult {
  return {
    from,
    to,
    range_seconds: 0,
    severity: "low",
    summary: {
      total_http_5xx: 0,
      total_restarts: 0,
      total_bank_errors: 0,
      services_count: 0,
      banks_count: 0,
      unknown_apps: 0,
    },
    layers: {
      infrastructure: [],
      http_errors: [],
      performance: [],
      banking: [],
      business_ops: [],
    },
    business_impact: [],
    unknown_apps: [],
    source_count: 0,
  };
}
