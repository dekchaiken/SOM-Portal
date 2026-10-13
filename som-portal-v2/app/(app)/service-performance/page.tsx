// app/(app)/service-performance/page.tsx
//
// Service Performance — 3-column command center.
// RSC loads overview snapshot, client component handles interactivity + polling.

import * as React from 'react';
import { Suspense } from 'react';
import { requireRole, ALL_STAFF_ROLES } from '@/auth/policy';
import { getOverview } from '@/service-performance/service';
import { SkeletonCommandCenter } from '@/ui/Skeleton';
import { CommandCenter } from './_components/CommandCenter';

export const metadata = {
  title: 'Service Performance',
};

async function ServicePerformanceContent() {
  const session = await requireRole(...ALL_STAFF_ROLES);
  const overview = await getOverview({ runway: 'all', showAll: false });

  return (
    <CommandCenter
      initialData={overview}
      cacheTtlSeconds={overview.cacheTtlSeconds}
    />
  );
}

export default function ServicePerformancePage() {
  return (
    <div className="p-4">
      <Suspense fallback={<SkeletonCommandCenter />}>
        <ServicePerformanceContent />
      </Suspense>
    </div>
  );
}
