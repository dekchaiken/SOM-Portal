// GET /api/v1/ma-services/backoffice?use_case_id=X — fetch backoffice use case detail
// Port of api/ma-services/backoffice-get.php
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { getUseCase } from '@/ma/backoffice-client';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    const useCaseId = Number(new URL(req.url).searchParams.get('use_case_id') ?? 0);
    if (useCaseId <= 0) return jsonErr('Missing use_case_id', 400);

    const { ok, useCase, error } = await getUseCase(useCaseId);
    if (!ok || !useCase) return jsonErr(error ?? 'Not found', 404);

    return jsonOk(useCase);
  });
}
