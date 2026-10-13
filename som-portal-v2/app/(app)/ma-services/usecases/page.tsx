// som-portal-v2/app/(app)/ma-services/usecases/page.tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/auth/session';
import { UsecasesClient } from '../_components/UsecasesClient';
import { canEditMASharedData } from '@/ma/access';

export const metadata = { title: 'MA Usecases · SOM Portal' };
export const dynamic = 'force-dynamic';

export default async function UsecasesPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/ma-services/usecases');
  const { domain } = await searchParams;
  return <UsecasesClient initialDomain={domain ?? 'TMN'} canEdit={canEditMASharedData(session)} />;
}
