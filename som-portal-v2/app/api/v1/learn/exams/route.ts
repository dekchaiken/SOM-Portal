// som-portal-v2/app/api/v1/learn/exams/route.ts
import { requireAuth } from '@/auth/policy';
import { listExams } from '@/learn/exam-service';
import { handle, jsonOk } from '@/jenkins/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const session = await requireAuth();
    return jsonOk(await listExams(session));
  });
}
