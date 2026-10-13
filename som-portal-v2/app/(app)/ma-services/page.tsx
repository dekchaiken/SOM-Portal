// som-portal-v2/app/(app)/ma-services/page.tsx
// MA Services landing (MA Overview). Usecases and Cut-off are linked from here.
import { redirect } from 'next/navigation';
import { getSession } from '@/auth/session';
import { PulseHeader } from '@/ui/PulseHeader';
import { MAOverviewClient } from './_components/MAOverviewClient';

export const metadata = { title: 'MA Overview · SOM Portal' };
export const dynamic = 'force-dynamic';

export default async function MAServicesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/ma-services');
  return (
    <div className="flex flex-col gap-5">
      <PulseHeader title="MA Services" subtitle="Manual action services and cut-off services for the year" />
      <MAOverviewClient />
    </div>
  );
}
