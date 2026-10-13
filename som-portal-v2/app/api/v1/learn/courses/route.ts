// som-portal-v2/app/api/v1/learn/courses/route.ts
import { requireAuth } from '@/auth/policy';
import { listCourses } from '@/learn/service';
import { handle, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    return jsonOk(await listCourses(session));
  });
}
