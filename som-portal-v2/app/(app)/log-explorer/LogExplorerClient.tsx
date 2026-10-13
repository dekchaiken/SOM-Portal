"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Icon } from "@/icons";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EndpointInfo {
  id: string;
  name: string;
  default_index_pattern: string;
  index_patterns: string[];
  has_dashboards_url: boolean;
  order: number;
}

interface NormalizedHit {
  id: string;
  index: string;
  timestamp: string | null;
  module: string;
  log_level: string;
  correlation_id: string;
  rest: string;
  status_code: number | null;
  latency_ms: number | null;
  pod: string;
  namespace: string;
  host: string;
  source?: Record<string, unknown>;
}

interface HistogramBucket {
  time: number;
  count: number;
  levels: Array<{ key: string; count: number }>;
}

interface SearchResult {
  endpoint_id: string;
  index_pattern: string;
  time: { gte: number; lte: number; interval: string };
  total: number;
  total_relation: string;
  shards: Record<string, unknown>;
  returned: number;
  took_ms: number;
  summary: {
    status: { ok: number; warn: number; error: number; other: number; unknown: number };
    latency_avg: number | null;
    latency_max: number | null;
    latency_n: number;
  };
  histogram: HistogramBucket[];
  top_pods: Array<{ key: string; count: number }>;
  hits: NormalizedHit[];
}

interface SavedSearch {
  id: string;
  name: string;
  folder_id: string | null;
  params: Record<string, unknown>;
  created_by_name: string;
  created_at: number;
}

interface SavedFolder {
  id: string;
  name: string;
  color: string;
}

const RANGES = [
  { value: "last_5m", label: "5m" },
  { value: "last_15m", label: "15m" },
  { value: "last_30m", label: "30m" },
  { value: "last_1h", label: "1h" },
  { value: "last_4h", label: "4h" },
  { value: "last_12h", label: "12h" },
  { value: "last_24h", label: "24h" },
  { value: "last_3d", label: "3d" },
  { value: "last_7d", label: "7d" },
] as const;

const LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;

const LEVEL_COLORS: Record<string, string> = {
  TRACE: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  DEBUG: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  INFO: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  WARN: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  ERROR: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  FATAL: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  UNKNOWN: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const HISTOGRAM_LEVEL_COLORS: Record<string, string> = {
  TRACE: "#9ca3af",
  DEBUG: "#3b82f6",
  INFO: "#22c55e",
  WARN: "#eab308",
  ERROR: "#f97316",
  FATAL: "#ef4444",
  UNKNOWN: "#6b7280",
};

// ─── API helpers ────────────────────────────────────────────────────────────

async function apiPost(action: string, body: Record<string, unknown>) {
  const res = await fetch(`/v2/api/opensearch/proxy?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path: string) {
  const res = await fetch(`/v2/api/opensearch/${path}`);
  return res.json();
}

async function apiCreds(method: string, body?: Record<string, unknown>, params?: string) {
  const url = `/v2/api/opensearch/user-creds${params ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LogExplorerClient() {
  // State
  const [endpoints, setEndpoints] = useState<EndpointInfo[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [indexPattern, setIndexPattern] = useState("");
  const [range, setRange] = useState("last_15m");
  const [module, setModule] = useState("");
  const [logLevel, setLogLevel] = useState("");
  const [query, setQuery] = useState("");
  const [regexpRest, setRegexpRest] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const [size, setSize] = useState(200);
  const [from, setFrom] = useState(0);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Credential state
  const [credStatus, setCredStatus] = useState<Record<string, boolean>>({});
  const [showCredModal, setShowCredModal] = useState(false);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credTesting, setCredTesting] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credSuccess, setCredSuccess] = useState(false);

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savedFolders, setSavedFolders] = useState<SavedFolder[]>([]);
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [saveName, setSaveName] = useState("");

  // Load endpoints on mount
  useEffect(() => {
    apiGet("proxy?action=list-endpoints").then((r) => {
      if (r.ok && r.data?.endpoints) {
        setEndpoints(r.data.endpoints);
        if (r.data.endpoints.length > 0) {
          setSelectedEndpoint(r.data.endpoints[0].id);
          setIndexPattern(r.data.endpoints[0].default_index_pattern ?? "");
        }
      }
    });
    apiCreds("GET").then((r) => {
      if (r.ok && r.data?.endpoints) {
        const map: Record<string, boolean> = {};
        for (const ep of r.data.endpoints) {
          map[ep.endpoint_id] = ep.has_creds;
        }
        setCredStatus(map);
      }
    });
    loadSavedSearches();
  }, []);

  function loadSavedSearches() {
    apiGet("saved-searches").then((r) => {
      if (r.ok && r.data?.searches) setSavedSearches(r.data.searches);
    });
    apiGet("saved-folders").then((r) => {
      if (r.ok && r.data?.folders) setSavedFolders(r.data.folders);
    });
  }

  // Select endpoint
  const onEndpointChange = useCallback(
    (id: string) => {
      setSelectedEndpoint(id);
      const ep = endpoints.find((e) => e.id === id);
      if (ep) setIndexPattern(ep.default_index_pattern ?? "");
      setResult(null);
      setError(null);
    },
    [endpoints],
  );

  // Search
  const doSearch = useCallback(async () => {
    if (!selectedEndpoint) return;
    setLoading(true);
    setError(null);
    setExpandedRows(new Set());
    try {
      const body: Record<string, unknown> = {
        endpoint_id: selectedEndpoint,
        index_pattern: indexPattern,
        range,
        size,
        from,
      };
      if (module) body.module = module;
      if (logLevel) body.log_level = logLevel;
      if (query) body.q = query;
      if (regexpRest) body.regexp_rest = regexpRest;
      if (correlationId) body.correlation_id = correlationId;

      const r = await apiPost("search", body);
      if (!r.ok) {
        if (r.message === "no_user_creds") {
          setShowCredModal(true);
          setError(null);
        } else {
          setError(r.error ?? r.message ?? "Search failed");
        }
        setResult(null);
      } else {
        setResult(r.data);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedEndpoint, indexPattern, range, module, logLevel, query, regexpRest, correlationId, size, from]);

  // Trace
  const doTrace = useCallback(async () => {
    if (!selectedEndpoint || !correlationId) return;
    setLoading(true);
    setError(null);
    setExpandedRows(new Set());
    try {
      const body: Record<string, unknown> = {
        endpoint_id: selectedEndpoint,
        index_pattern: indexPattern,
        range,
        correlation_id: correlationId,
        size: 500,
      };
      const r = await apiPost("trace", body);
      if (!r.ok) {
        if (r.message === "no_user_creds") {
          setShowCredModal(true);
        } else {
          setError(r.error ?? r.message ?? "Trace failed");
        }
      } else {
        // Convert trace result to SearchResult-like for display
        setResult({
          endpoint_id: selectedEndpoint,
          index_pattern: indexPattern,
          time: { gte: 0, lte: 0, interval: "" },
          total: r.data.total,
          total_relation: r.data.total_relation,
          shards: r.data.shards,
          returned: r.data.returned,
          took_ms: r.data.took_ms,
          summary: { status: { ok: 0, warn: 0, error: 0, other: 0, unknown: 0 }, latency_avg: null, latency_max: null, latency_n: 0 },
          histogram: [],
          top_pods: [],
          hits: r.data.hits,
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedEndpoint, indexPattern, range, correlationId]);

  // Save credentials
  const saveCreds = useCallback(async () => {
    setCredTesting(true);
    setCredError(null);
    setCredSuccess(false);
    try {
      // Test first
      const test = await apiPost("test-creds", {
        endpoint_id: selectedEndpoint,
        username: credUsername,
        password: credPassword,
      });
      if (!test.ok) {
        setCredError(test.error ?? "Connection test failed");
        return;
      }
      // Save
      const save = await apiCreds("POST", {
        endpoint_id: selectedEndpoint,
        username: credUsername,
        password: credPassword,
      });
      if (!save.ok) {
        setCredError(save.error ?? "Save failed");
        return;
      }
      setCredSuccess(true);
      setCredStatus((prev) => ({ ...prev, [selectedEndpoint]: true }));
      setTimeout(() => {
        setShowCredModal(false);
        setCredUsername("");
        setCredPassword("");
        setCredSuccess(false);
      }, 1000);
    } catch (e) {
      setCredError(String(e));
    } finally {
      setCredTesting(false);
    }
  }, [selectedEndpoint, credUsername, credPassword]);

  // Clear credentials
  const clearCreds = useCallback(async () => {
    if (!selectedEndpoint) return;
    await apiCreds("DELETE", undefined, `endpoint_id=${selectedEndpoint}`);
    setCredStatus((prev) => ({ ...prev, [selectedEndpoint]: false }));
  }, [selectedEndpoint]);

  // Save search
  const saveSearch = useCallback(async () => {
    if (!saveName.trim()) return;
    const params: Record<string, unknown> = {
      endpoint_id: selectedEndpoint,
      index_pattern: indexPattern,
      range,
    };
    if (module) params.module = module;
    if (logLevel) params.log_level = logLevel;
    if (query) params.q = query;
    if (regexpRest) params.regexp_rest = regexpRest;
    if (correlationId) params.correlation_id = correlationId;
    if (size !== 200) params.size = size;

    const res = await fetch("/v2/api/opensearch/saved-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: saveName, params }),
    });
    const r = await res.json();
    if (r.ok) {
      setSaveName("");
      loadSavedSearches();
    }
  }, [saveName, selectedEndpoint, indexPattern, range, module, logLevel, query, regexpRest, correlationId, size]);

  // Load saved search params
  const loadSavedSearch = useCallback(
    (s: SavedSearch) => {
      const p = s.params;
      if (p.endpoint_id) setSelectedEndpoint(String(p.endpoint_id));
      if (p.index_pattern) setIndexPattern(String(p.index_pattern));
      if (p.range) setRange(String(p.range));
      if (p.module) setModule(String(p.module)); else setModule("");
      if (p.log_level) setLogLevel(String(p.log_level)); else setLogLevel("");
      if (p.q) setQuery(String(p.q)); else setQuery("");
      if (p.regexp_rest) setRegexpRest(String(p.regexp_rest)); else setRegexpRest("");
      if (p.correlation_id) setCorrelationId(String(p.correlation_id)); else setCorrelationId("");
      if (p.size) setSize(Number(p.size)); else setSize(200);
      setFrom(0);
      setShowSavedPanel(false);
    },
    [],
  );

  // Delete saved search
  const deleteSaved = useCallback(async (id: string) => {
    await fetch(`/v2/api/opensearch/saved-searches?id=${id}`, { method: "DELETE" });
    loadSavedSearches();
  }, []);

  // Toggle row expand
  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon name="database" size={24} />
          <h1 className="text-xl font-semibold">Log Explorer</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSavedPanel(!showSavedPanel)}
          >
            <Icon name="star" size={14} className="mr-1" />
            Saved
          </Button>
          {credStatus[selectedEndpoint] ? (
            <span className="flex items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-300">
              <Icon name="check" size={12} />
              Creds saved
            </span>
          ) : selectedEndpoint ? (
            <Button variant="outline" size="sm" onClick={() => setShowCredModal(true)}>
              <Icon name="shield" size={14} className="mr-1" />
              Set Credentials
            </Button>
          ) : null}
        </div>
      </div>

      {/* Search form */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          {/* Endpoint + Index */}
          <div className="flex flex-wrap gap-3">
            <select
              className="rounded-md border bg-[var(--bg-surface)] px-3 py-2 text-sm"
              value={selectedEndpoint}
              onChange={(e) => onEndpointChange(e.target.value)}
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.name}</option>
              ))}
            </select>
            <Input
              className="min-w-[200px] flex-1"
              placeholder="Index pattern"
              value={indexPattern}
              onChange={(e) => setIndexPattern(e.target.value)}
            />
          </div>

          {/* Time range */}
          <div className="flex flex-wrap gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.value}
                variant={range === r.value ? "default" : "outline"}
                size="sm"
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <Input
              className="w-48"
              placeholder="Module"
              value={module}
              onChange={(e) => setModule(e.target.value)}
            />
            <select
              className="rounded-md border bg-[var(--bg-surface)] px-3 py-2 text-sm"
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
            >
              <option value="">All Levels</option>
              {LOG_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <Input
              className="min-w-[200px] flex-1"
              placeholder="Free text query (q)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Input
              className="w-64"
              placeholder="Regex on REST field"
              value={regexpRest}
              onChange={(e) => setRegexpRest(e.target.value)}
            />
            <Input
              className="min-w-[200px] flex-1"
              placeholder="Correlation ID"
              value={correlationId}
              onChange={(e) => setCorrelationId(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button onClick={doSearch} disabled={loading || !selectedEndpoint}>
              {loading ? "Searching..." : "Search"}
            </Button>
            <Button
              variant="outline"
              onClick={doTrace}
              disabled={loading || !selectedEndpoint || !correlationId}
            >
              Trace
            </Button>
            {credStatus[selectedEndpoint] && (
              <Button variant="ghost" size="sm" className="ml-auto text-xs text-[var(--text-muted)]" onClick={clearCreds}>
                Clear Credentials
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--text-muted)]">
            <span>
              <strong>{result.total.toLocaleString()}</strong>
              {result.total_relation === "gte" ? "+" : ""} hits
            </span>
            <span>{result.returned} returned</span>
            <span>{result.took_ms}ms</span>
            {result.summary.latency_avg !== null && (
              <span>avg latency {result.summary.latency_avg}ms</span>
            )}
            {result.summary.status.error > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {result.summary.status.error} errors
              </span>
            )}
          </div>

          {/* Histogram */}
          {result.histogram.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex h-24 items-end gap-[1px]">
                  {result.histogram.map((b, i) => {
                    const maxCount = Math.max(...result.histogram.map((h) => h.count), 1);
                    const height = Math.max(1, (b.count / maxCount) * 100);
                    // Get dominant level for color
                    const topLevel = b.levels.sort((a, c) => c.count - a.count)[0];
                    const color = topLevel ? (HISTOGRAM_LEVEL_COLORS[topLevel.key] ?? "#6b7280") : "#6b7280";
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm transition-all hover:opacity-80"
                        style={{ height: `${height}%`, backgroundColor: color, minWidth: 2 }}
                        title={`${new Date(b.time).toLocaleTimeString()} - ${b.count} logs`}
                      />
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top pods */}
          {result.top_pods.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {result.top_pods.map((p) => (
                <span key={p.key} className="rounded-md bg-[var(--bg-surface)] px-2 py-1 text-xs">
                  {p.key} ({p.count})
                </span>
              ))}
            </div>
          )}

          {/* Hits table */}
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-[var(--text-muted)]">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Level</th>
                    <th className="px-3 py-2 font-medium">Module</th>
                    <th className="px-3 py-2 font-medium">REST / Message</th>
                    <th className="px-3 py-2 font-medium">CID</th>
                  </tr>
                </thead>
                <tbody>
                  {result.hits.map((hit) => (
                    <React.Fragment key={hit.id}>
                      <tr
                        className="cursor-pointer border-b transition-colors hover:bg-[var(--bg-surface)]"
                        onClick={() => toggleRow(hit.id)}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[10px]">
                          {hit.timestamp
                            ? new Date(hit.timestamp).toLocaleString("en-US", {
                                hour12: false,
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                fractionalSecondDigits: 3,
                              })
                            : "-"}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_COLORS[hit.log_level] ?? LEVEL_COLORS.UNKNOWN}`}>
                            {hit.log_level || "?"}
                          </span>
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-1.5">{hit.module}</td>
                        <td className="max-w-[500px] truncate px-3 py-1.5 font-mono">{hit.rest}</td>
                        <td className="max-w-[120px] truncate px-3 py-1.5 font-mono text-[10px]">
                          {hit.correlation_id && (
                            <button
                              className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCorrelationId(hit.correlation_id);
                              }}
                            >
                              {hit.correlation_id.slice(0, 12)}...
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedRows.has(hit.id) && (
                        <tr>
                          <td colSpan={5} className="bg-[var(--bg-surface)] p-3">
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] font-mono leading-relaxed">
                              {JSON.stringify(hit.source, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span>Show</span>
              <select
                className="rounded border bg-[var(--bg-surface)] px-2 py-1 text-sm"
                value={size}
                onChange={(e) => { setSize(Number(e.target.value)); setFrom(0); }}
              >
                {[50, 100, 200, 500].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span>per page</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={from === 0}
                onClick={() => setFrom(Math.max(0, from - size))}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={result.returned < size}
                onClick={() => setFrom(from + size)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Credential modal */}
      {showCredModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon name="shield" size={18} />
                OpenSearch Credentials
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                Enter your OpenSearch credentials for {endpoints.find((e) => e.id === selectedEndpoint)?.name ?? "this endpoint"}.
              </p>
              <Input
                placeholder="Username"
                value={credUsername}
                onChange={(e) => setCredUsername(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Password"
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
              />
              {credError && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <Icon name="x" size={14} />
                  {credError}
                </div>
              )}
              {credSuccess && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Icon name="check" size={14} />
                  Credentials verified and saved
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={saveCreds} disabled={credTesting || !credUsername || !credPassword}>
                  {credTesting ? "Testing..." : "Test & Save"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCredModal(false);
                    setCredError(null);
                    setCredSuccess(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Saved searches panel */}
      {showSavedPanel && (
        <div className="fixed inset-y-0 right-0 z-40 w-80 overflow-y-auto border-l bg-[var(--bg-base)] p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Saved Searches</h2>
            <Button variant="ghost" size="sm" onClick={() => setShowSavedPanel(false)}>
              <Icon name="x" size={16} />
            </Button>
          </div>

          {/* Save current */}
          <div className="mb-4 flex gap-2">
            <Input
              className="flex-1"
              placeholder="Save current search as..."
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <Button size="sm" onClick={saveSearch} disabled={!saveName.trim()}>
              Save
            </Button>
          </div>

          {/* Folder list */}
          {savedFolders.map((folder) => {
            const folderSearches = savedSearches.filter((s) => s.folder_id === folder.id);
            if (folderSearches.length === 0) return null;
            return (
              <div key={folder.id} className="mb-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                  <Icon name="layers" size={12} />
                  {folder.name}
                </div>
                {folderSearches.map((s) => (
                  <SavedSearchItem key={s.id} search={s} onLoad={loadSavedSearch} onDelete={deleteSaved} />
                ))}
              </div>
            );
          })}

          {/* Unfiled searches */}
          {savedSearches
            .filter((s) => !s.folder_id)
            .map((s) => (
              <SavedSearchItem key={s.id} search={s} onLoad={loadSavedSearch} onDelete={deleteSaved} />
            ))}

          {savedSearches.length === 0 && (
            <p className="text-center text-sm text-[var(--text-muted)]">No saved searches yet</p>
          )}
        </div>
      )}
    </div>
  );
}

function SavedSearchItem({
  search,
  onLoad,
  onDelete,
}: {
  search: SavedSearch;
  onLoad: (s: SavedSearch) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors hover:bg-[var(--bg-surface)]">
      <button className="flex-1 text-left" onClick={() => onLoad(search)}>
        <span className="font-medium">{search.name}</span>
        <span className="ml-2 text-xs text-[var(--text-muted)]">
          by {search.created_by_name}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-[var(--text-muted)] hover:text-red-500"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(search.id);
        }}
      >
        <Icon name="trash" size={12} />
      </Button>
    </div>
  );
}
