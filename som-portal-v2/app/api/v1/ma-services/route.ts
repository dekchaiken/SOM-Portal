// GET /api/v1/ma-services — list all MA services
// POST /api/v1/ma-services — create new MA service
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { listServices, createService } from '@/ma/services-store';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    const services = await listServices();
    return jsonOk(services);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const body = await req.json();
    const svc = await createService(body);
    return jsonOk(svc);
  });
}
