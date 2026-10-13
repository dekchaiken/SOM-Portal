// GET /api/v1/ma-services/types — list MA service types with counts
// POST — add type, PUT — update/rename, DELETE — remove
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import {
  listServiceTypes,
  addServiceType,
  updateServiceType,
  deleteServiceType,
} from '@/ma/types-store';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    const types = await listServiceTypes();
    return jsonOk(types);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const body = await req.json();
    await addServiceType(body);
    return jsonOk({ created: true });
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const body = await req.json();
    const result = await updateServiceType(body);
    return jsonOk(result);
  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const name = new URL(req.url).searchParams.get('name') ?? '';
    await deleteServiceType(name);
    return jsonOk({ deleted: true });
  });
}
