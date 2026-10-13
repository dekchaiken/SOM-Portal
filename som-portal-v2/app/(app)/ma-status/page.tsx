// som-portal-v2/app/(app)/ma-status/page.tsx
// MA Status Dashboard — server component with client-side auto-refresh.
// Reads cached status from ma-status-cache.json (shared, written by v1 poller).
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/auth/session';
import { SkeletonList } from '@/ui/Skeleton';
import { MAStatusDashboard } from './MAStatusDashboard';

export const metadata = { title: 'MA Status · SOM Portal' };
export const dynamic = 'force-dynamic';

export default async function MAStatusPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/ma-status');

  return (
    <Suspense fallback={<SkeletonList rows={8} />}>
      <MAStatusDashboard />
    </Suspense>
  );
}
