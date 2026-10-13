// ServiceDetail — center column: CPU chart placeholder, Memory chart, Pod count, HPA.
'use client';
import * as React from 'react';
import { ResourceBar } from './ResourceBar';
import type { ServiceRow, RunwaySnapshot } from '@/service-performance/schema';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(1)} ${units[i]}`;
}

function formatCores(cores: number): string {
  if (cores < 1) return `${Math.round(cores * 1000)}m`;
  return `${cores.toFixed(2)} cores`;
}

export function ServiceDetail({
  service,
  runway,
}: {
  service: ServiceRow | null;
  runway: RunwaySnapshot | null;
}) {
  if (!service) {
    return (
      <div className="flex h-full items-center justify-center surface-card">
        <p className="text-sm text-[var(--text-subtle)]">Select a service from the list</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {/* Header */}
      <div className="surface-card p-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{service.service}</h2>
          {runway && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: runway.color + '20', color: runway.color }}
            >
              {runway.name}
            </span>
          )}
        </div>
        {service.namespace && (
          <p className="mt-1 text-xs text-[var(--text-subtle)]">
            namespace: {service.namespace}
          </p>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-3">
        <div className="surface-card p-4">
          <p className="text-xs text-[var(--text-subtle)]">Pods</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {service.pods}
          </p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-[var(--text-subtle)]">CPU Used</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {formatCores(service.cpuCores)}
          </p>
          <p className="text-xs text-[var(--text-subtle)]">
            / {formatCores(service.cpuLimitCores)}
          </p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-[var(--text-subtle)]">Memory Used</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {formatBytes(service.memBytes)}
          </p>
          <p className="text-xs text-[var(--text-subtle)]">
            / {formatBytes(service.memLimitBytes)}
          </p>
        </div>
      </div>

      {/* CPU gauge */}
      <div className="surface-card p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">CPU Utilization</h3>
        <ResourceBar label="CPU" pct={service.cpuPct} />
        <div className="mt-2 flex justify-between text-xs text-[var(--text-subtle)]">
          <span>Used: {formatCores(service.cpuCores)}</span>
          <span>Limit: {formatCores(service.cpuLimitCores)}</span>
        </div>
      </div>

      {/* Memory gauge */}
      <div className="surface-card p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Memory Utilization</h3>
        <ResourceBar label="MEM" pct={service.memPct} />
        <div className="mt-2 flex justify-between text-xs text-[var(--text-subtle)]">
          <span>Used: {formatBytes(service.memBytes)}</span>
          <span>Limit: {formatBytes(service.memLimitBytes)}</span>
        </div>
      </div>

      {/* Inventory metadata */}
      {service.inInventory && (
        <div className="surface-card p-4">
          <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">Service Inventory</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {service.bu && (
              <>
                <span className="text-[var(--text-subtle)]">BU</span>
                <span className="text-[var(--text-primary)]">{service.bu}</span>
              </>
            )}
            {service.team && (
              <>
                <span className="text-[var(--text-subtle)]">Team</span>
                <span className="text-[var(--text-primary)]">{service.team}</span>
              </>
            )}
            {service.severity && (
              <>
                <span className="text-[var(--text-subtle)]">Severity</span>
                <span className="text-[var(--text-primary)]">{service.severity}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
