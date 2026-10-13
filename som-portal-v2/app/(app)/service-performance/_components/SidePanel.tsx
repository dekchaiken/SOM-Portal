// SidePanel — right column: summary, dependency list placeholder, suggestions.
'use client';
import * as React from 'react';
import type { OverviewResponse, RunwaySnapshot } from '@/service-performance/schema';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function SidePanel({
  overview,
  selectedRunway,
}: {
  overview: OverviewResponse | null;
  selectedRunway: string;
}) {
  if (!overview) {
    return (
      <div className="surface-card p-4">
        <p className="text-sm text-[var(--text-subtle)]">Loading...</p>
      </div>
    );
  }

  const snap = overview.runways.find((r) => r.slug === selectedRunway) ?? overview.runways[0];

  // Aggregate totals across all runways
  const allTotals = overview.runways.reduce(
    (acc, r) => ({
      services: acc.services + r.totals.services,
      pods: acc.pods + r.totals.pods,
      cpuHotspots: acc.cpuHotspots + r.totals.cpuHotspots,
      memHotspots: acc.memHotspots + r.totals.memHotspots,
    }),
    { services: 0, pods: 0, cpuHotspots: 0, memHotspots: 0 },
  );

  // Top CPU consumers from selected runway
  const topCpu = [...(snap?.services ?? [])]
    .filter((s) => s.cpuPct !== null)
    .sort((a, b) => (b.cpuPct ?? 0) - (a.cpuPct ?? 0))
    .slice(0, 5);

  // Top MEM consumers
  const topMem = [...(snap?.services ?? [])]
    .filter((s) => s.memPct !== null)
    .sort((a, b) => (b.memPct ?? 0) - (a.memPct ?? 0))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto">
      {/* Overall summary */}
      <div className="surface-card p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Overall Summary</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <span className="text-[var(--text-subtle)]">Runways</span>
          <span className="text-[var(--text-primary)]">{overview.runways.length}</span>
          <span className="text-[var(--text-subtle)]">Total Services</span>
          <span className="text-[var(--text-primary)]">{allTotals.services}</span>
          <span className="text-[var(--text-subtle)]">Total Pods</span>
          <span className="text-[var(--text-primary)]">{allTotals.pods}</span>
          <span className="text-[var(--text-subtle)]">CPU Hotspots</span>
          <span className={allTotals.cpuHotspots > 0 ? 'text-[var(--state-danger)]' : 'text-[var(--text-primary)]'}>
            {allTotals.cpuHotspots}
          </span>
          <span className="text-[var(--text-subtle)]">MEM Hotspots</span>
          <span className={allTotals.memHotspots > 0 ? 'text-[var(--state-danger)]' : 'text-[var(--text-primary)]'}>
            {allTotals.memHotspots}
          </span>
        </div>
        {overview.cacheTtlSeconds > 0 && (
          <p className="mt-2 text-[10px] text-[var(--text-subtle)]">
            Cache TTL: {overview.cacheTtlSeconds}s
          </p>
        )}
      </div>

      {/* Top CPU consumers */}
      {topCpu.length > 0 && (
        <div className="surface-card p-4">
          <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">Top CPU Usage</h3>
          <div className="flex flex-col gap-1.5">
            {topCpu.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-xs">
                <span className="min-w-0 truncate text-[var(--text-primary)]">{s.service}</span>
                <span
                  className="shrink-0 tabular-nums"
                  style={{
                    color:
                      (s.cpuPct ?? 0) >= 80
                        ? 'var(--state-danger)'
                        : (s.cpuPct ?? 0) >= 60
                          ? 'var(--state-warning)'
                          : 'var(--state-success)',
                  }}
                >
                  {s.cpuPct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top MEM consumers */}
      {topMem.length > 0 && (
        <div className="surface-card p-4">
          <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">Top Memory Usage</h3>
          <div className="flex flex-col gap-1.5">
            {topMem.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-xs">
                <span className="min-w-0 truncate text-[var(--text-primary)]">{s.service}</span>
                <span
                  className="shrink-0 tabular-nums"
                  style={{
                    color:
                      (s.memPct ?? 0) >= 80
                        ? 'var(--state-danger)'
                        : (s.memPct ?? 0) >= 60
                          ? 'var(--state-warning)'
                          : 'var(--state-success)',
                  }}
                >
                  {s.memPct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sheet links */}
      {overview.sheetEmbedUrl && (
        <div className="surface-card p-4">
          <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">Service Inventory</h3>
          <a
            href={overview.sheetOpenUrl || overview.sheetEmbedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--link)] hover:underline"
          >
            Open in Google Sheets
          </a>
        </div>
      )}
    </div>
  );
}
