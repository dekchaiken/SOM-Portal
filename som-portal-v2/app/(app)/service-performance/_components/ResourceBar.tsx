// ResourceBar — color-coded CPU/MEM bar: green < 60%, yellow 60-80%, red > 80%.
'use client';
import * as React from 'react';
import { cn } from '@/ui/cn';

export function ResourceBar({
  label,
  pct,
  className,
}: {
  label: string;
  pct: number | null;
  className?: string;
}) {
  const value = pct ?? 0;
  const color =
    value >= 80
      ? 'var(--state-danger)'
      : value >= 60
        ? 'var(--state-warning)'
        : 'var(--state-success)';

  return (
    <div className={cn('flex items-center gap-2 text-xs', className)}>
      <span className="w-10 shrink-0 text-[var(--text-subtle)]">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-raised)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(value, 100)}%`, background: color }}
        />
      </div>
      <span className="w-12 text-right tabular-nums" style={{ color }}>
        {pct !== null ? `${pct}%` : '--'}
      </span>
    </div>
  );
}
