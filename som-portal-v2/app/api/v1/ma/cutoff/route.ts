// GET: cut-off services (every signed-in user). POST: add one (SM team only)
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { createCutoff, listCutoffs } from '@/ma/cutoff-store';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAuth();
    return okJson(await listCutoffs());
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    return okJson(await createCutoff(await jsonBody(req)), 201);
  } catch (e) {
    return errorJson(e);
  }
}
