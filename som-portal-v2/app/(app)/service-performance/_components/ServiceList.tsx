// ServiceList — left column: runway tabs + service list with CPU/MEM mini bars.
'use client';
import * as React from 'react';
import { cn } from '@/ui/cn';
import { ResourceBar } from './ResourceBar';
import type { ServiceRow, RunwaySnapshot } from '@/service-performance/schema';

function healthStatus(s: ServiceRow): 'healthy' | 'warning' | 'critical' {
  const cpu = s.cpuPct ?? 0;
  const mem = s.memPct ?? 0;
  if (cpu >= 80 || mem >= 80) return 'critical';
  if (cpu >= 60 || mem >= 60) return 'warning';
  return 'healthy';
}

const statusDot: Record<string, string> = {
  healthy: 'var(--state-success)',
  warning: 'var(--state-warning)',
  critical: 'var(--state-danger)',
};

export function ServiceList({
  runways,
  selectedRunway,
  onSelectRunway,
  selectedService,
  onSelectService,
  searchQuery,
  onSearchChange,
}: {
  runways: RunwaySnapshot[];
  selectedRunway: string;
  onSelectRunway: (slug: string) => void;
  selectedService: string | null;
  onSelectService: (key: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  const activeSnap = runways.find((r) => r.slug === selectedRunway) ?? runways[0];
  const services = activeSnap?.services ?? [];
  const filtered = searchQuery
    ? services.filter((s) => s.service.toLowerCase().includes(searchQuery.toLowerCase()))
    : services;

  return (
    <div className="flex h-full flex-col overflow-hidden surface-card">
      {/* Runway tabs */}
      <div className="flex gap-0.5 border-b border-[var(--border)] px-2 pt-2">
        {runways.map((r) => (
          <button
            key={r.slug}
            onClick={() => onSelectRunway(r.slug)}
            className={cn(
              'rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors',
              r.slug === selectedRunway
                ? 'bg-[var(--surface-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-subtle)] hover:text-[var(--text-primary)]',
            )}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ background: r.color }}
            />
            {r.name}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Filter services..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
        />
      </div>

      {/* Totals */}
      {activeSnap && (
        <div className="flex gap-3 border-b border-[var(--border)] px-3 pb-2 text-xs text-[var(--text-subtle)]">
          <span>{activeSnap.totals.services} services</span>
          <span>{activeSnap.totals.pods} pods</span>
          {activeSnap.totals.cpuHotspots > 0 && (
            <span className="text-[var(--state-danger)]">
              {activeSnap.totals.cpuHotspots} CPU hot
            </span>
          )}
          {activeSnap.totals.memHotspots > 0 && (
            <span className="text-[var(--state-danger)]">
              {activeSnap.totals.memHotspots} MEM hot
            </span>
          )}
        </div>
      )}

      {/* Service rows */}
      <div className="flex-1 overflow-y-auto">
        {activeSnap?.error && (
          <div className="px-3 py-4 text-xs text-[var(--state-danger)]">
            Error: {activeSnap.error}
          </div>
        )}
        {filtered.map((s) => {
          const status = healthStatus(s);
          return (
            <button
              key={s.key}
              onClick={() => onSelectService(s.key)}
              className={cn(
                'flex w-full flex-col gap-1 border-b border-[var(--border)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-raised)]',
                selectedService === s.key && 'bg-[var(--surface-raised)]',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: statusDot[status] }}
                />
                <span className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">
                  {s.service}
                </span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-[var(--text-subtle)]">
                  {s.pods} pod{s.pods !== 1 ? 's' : ''}
                </span>
              </div>
              <ResourceBar label="CPU" pct={s.cpuPct} />
              <ResourceBar label="MEM" pct={s.memPct} />
            </button>
          );
        })}
        {filtered.length === 0 && !activeSnap?.error && (
          <div className="px-3 py-4 text-xs text-[var(--text-subtle)]">No services found</div>
        )}
      </div>
    </div>
  );
}
