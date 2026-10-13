// som-portal-v2/app/(app)/ma-services/page.tsx
// MA Services Registry — CRUD table for maintenance services.
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/auth/session';
import { SkeletonList } from '@/ui/Skeleton';
import { MAServicesClient } from './MAServicesClient';

export const metadata = { title: 'MA Services · SOM Portal' };
export const dynamic = 'force-dynamic';

export default async function MAServicesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/ma-services');

  return (
    <Suspense fallback={<SkeletonList rows={10} />}>
      <MAServicesClient />
    </Suspense>
  );
}
