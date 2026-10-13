// CommandCenter — 3-column layout client component with auto-refresh.
'use client';
import * as React from 'react';
import { ServiceList } from './ServiceList';
import { ServiceDetail } from './ServiceDetail';
import { SidePanel } from './SidePanel';
import type { OverviewResponse, ServiceRow, RunwaySnapshot } from '@/service-performance/schema';

export function CommandCenter({
  initialData,
  cacheTtlSeconds,
}: {
  initialData: OverviewResponse;
  cacheTtlSeconds: number;
}) {
  const [data, setData] = React.useState(initialData);
  const [selectedRunway, setSelectedRunway] = React.useState(
    data.runways[0]?.slug ?? '',
  );
  const [selectedServiceKey, setSelectedServiceKey] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');

  // Auto-refresh with visibility pause (matches v1's 30s poll)
  React.useEffect(() => {
    const interval = Math.max(cacheTtlSeconds * 1000, 10_000);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (document.hidden) {
        timer = setTimeout(tick, interval);
        return;
      }
      try {
        const res = await fetch(`/v2/api/service-performance?runway=all`, {
          credentials: 'same-origin',
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setData(json.data as OverviewResponse);
          }
        }
      } catch {
        // Silently retry next tick
      }
      timer = setTimeout(tick, interval);
    };
    timer = setTimeout(tick, interval);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [cacheTtlSeconds]);

  const activeSnap = data.runways.find((r) => r.slug === selectedRunway) ?? data.runways[0] ?? null;
  const selectedService: ServiceRow | null =
    activeSnap?.services.find((s) => s.key === selectedServiceKey) ?? null;

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
      {/* Left column — service list */}
      <div className="overflow-hidden max-lg:order-2">
        <ServiceList
          runways={data.runways}
          selectedRunway={selectedRunway}
          onSelectRunway={(slug) => {
            setSelectedRunway(slug);
            setSelectedServiceKey(null);
          }}
          selectedService={selectedServiceKey}
          onSelectService={setSelectedServiceKey}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      {/* Center column — selected service detail */}
      <div className="overflow-hidden max-lg:order-1">
        <ServiceDetail service={selectedService} runway={activeSnap} />
      </div>

      {/* Right column — summary / top consumers */}
      <div className="overflow-hidden max-lg:order-3">
        <SidePanel overview={data} selectedRunway={selectedRunway} />
      </div>
    </div>
  );
}
