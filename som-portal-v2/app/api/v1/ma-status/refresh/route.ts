// POST: refresh the MA status cache from the Admin Portal (v1: ?refresh=1)
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk } from '@/jenkins/route-helpers';
import { refreshStatus } from '@/ma/status-refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    return jsonOk(await refreshStatus());
  });
}
