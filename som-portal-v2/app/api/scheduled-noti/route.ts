// GET/POST: scheduled notification jobs
import { type NextRequest } from 'next/server';
import { requireAuth, hasRole, ADMIN_ROLES } from '@/auth/policy';
import { listJobs, createJob } from '@/scheduled-noti/store';
import { CreateScheduledJobSchema } from '@/scheduled-noti/types';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const url = new URL(req.url);
    const isAdmin = hasRole(session, [...ADMIN_ROLES]);
    const showAll = isAdmin && url.searchParams.get('all') === '1';
    const items = await listJobs({ all: showAll, isAdmin });
    return okJson(items);
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await jsonBody(req);
    const parsed = CreateScheduledJobSchema.parse(body);
    const result = await createJob(parsed);
    return okJson(result, 201);
  } catch (e) {
    return errorJson(e);
  }
}
