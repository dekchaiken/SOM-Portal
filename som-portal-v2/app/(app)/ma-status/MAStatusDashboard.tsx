'use client';
// MA Status Dashboard — client component with auto-refresh polling.
// Fetches /api/v1/ma-status every 30s (configurable).
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Icon } from '@/icons';

interface StatusItem {
  name: string;
  label: string;
  use_case_id?: number;
  type: string;
  status: string;
  updated_at: string;
  updated_by: string;
  category: string;
}

interface StatusData {
  ts: number;
  sources: string[];
  items: StatusItem[];
  total: number;
}

const POLL_INTERVAL = 30_000;

export function MAStatusDashboard() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const q = sourceFilter ? `?source=${encodeURIComponent(sourceFilter)}` : '';
      const res = await fetch(`/v2/api/v1/ma-status${q}`);
      const json = await res.json();
      if (json.ok) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error ?? 'Failed to load');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(() => {
      if (!document.hidden) fetchStatus();
    }, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const filteredItems = data?.items.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.updated_by.toLowerCase().includes(q)
    );
  }) ?? [];

  const activeCount = filteredItems.filter((i) => i.status === 'open').length;
  const normalCount = filteredItems.filter((i) => i.status !== 'open').length;

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-xl font-semibold">MA Status Dashboard</h1>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-24" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">MA Status Dashboard</h1>
          {data && (
            <p className="text-xs text-[var(--text-muted)]">
              Last polled: {new Date(data.ts * 1000).toLocaleString()} | {data.total} items
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="danger">{activeCount} MA Active</Badge>
          <Badge variant="success">{normalCount} Normal</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
            disabled={loading}
          >
            <Icon name="refresh-cw" size={14} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-[var(--chip-danger-bg)] p-3 text-sm text-[var(--chip-danger-fg)]">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search services..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm"
        >
          <option value="">All Sources</option>
          {data?.sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Status Cards Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredItems.map((item) => (
          <StatusCard key={item.name} item={item} />
        ))}
      </div>

      {filteredItems.length === 0 && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            No MA status items found.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusCard({ item }: { item: StatusItem }) {
  const isActive = item.status === 'open';

  return (
    <Card
      className={
        isActive
          ? 'border-l-4 border-l-[var(--chip-danger-fg)]'
          : 'border-l-4 border-l-[var(--chip-success-fg)]'
      }
    >
      <CardHeader className="mb-1 pb-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-tight">{item.label}</CardTitle>
          <Badge variant={isActive ? 'danger' : 'success'} className="shrink-0">
            {isActive ? 'MA ON' : 'OFF'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        <p className="text-xs text-[var(--text-muted)]">
          <span className="font-medium">Source:</span> {item.type}
          {item.category && ` / ${item.category}`}
        </p>
        {item.updated_at && (
          <p className="text-xs text-[var(--text-muted)]">
            <span className="font-medium">Updated:</span> {item.updated_at}
          </p>
        )}
        {item.updated_by && (
          <p className="text-xs text-[var(--text-muted)]">
            <span className="font-medium">By:</span> {item.updated_by}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
