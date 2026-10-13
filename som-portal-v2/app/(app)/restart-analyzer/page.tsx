import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/auth/session';
import { SkeletonForm } from '@/ui/Skeleton';
import { RestartAnalyzerClient } from './RestartAnalyzerClient';

export const metadata = { title: 'Restart Analyzer · SOM Portal' };
export const dynamic = 'force-dynamic';

export default async function RestartAnalyzerPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/restart-analyzer');

  return (
    <Suspense fallback={<SkeletonForm fields={3} />}>
      <RestartAnalyzerClient />
    </Suspense>
  );
}
