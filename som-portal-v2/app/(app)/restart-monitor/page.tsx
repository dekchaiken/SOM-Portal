import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/auth/session';
import { SkeletonTable, SkeletonKpiRow } from '@/ui/Skeleton';
import { RestartMonitorClient } from './RestartMonitorClient';

export const metadata = { title: 'Restart Monitor · SOM Portal' };
export const dynamic = 'force-dynamic';

export default async function RestartMonitorPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/restart-monitor');

  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-4">
          <SkeletonKpiRow />
          <SkeletonTable rows={10} />
        </div>
      }
    >
      <RestartMonitorClient />
    </Suspense>
  );
}
