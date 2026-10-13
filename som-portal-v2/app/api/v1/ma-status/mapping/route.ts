// GET/POST /api/v1/ma-status/mapping — MA-to-service mapping (backoffice use_case_id)
// Port of api/ma-status/mapping.php
import { type NextRequest } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { readServicesFile, writeServicesFile } from '@/ma/services-store';
import { logActivity } from '@/logging/activity';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MappingInput = z.object({
  service_id: z.number().min(1, 'service_id is required'),
  use_case_id: z.number().positive('use_case_id must be a positive integer').nullable(),
});

export async function GET(): Promise<Response> {
  return handle(async () => {
    await requireRole(...ADMIN_ROLES);

    const data = await readServicesFile();
    // Return a simplified mapping: service_id -> use_case_id
    const mappings = data.services.map((svc) => ({
      service_id: svc.id,
      service_name: svc.service_name,
      use_case_id: svc.backoffice_use_case_id,
    }));

    return jsonOk({ mappings });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const session = await requireRole(...ADMIN_ROLES);

    const body = await req.json();
    const parsed = MappingInput.safeParse(body);
    if (!parsed.success) {
      return jsonErr(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    }
    const { service_id, use_case_id } = parsed.data;

    const data = await readServicesFile();
    const idx = data.services.findIndex((s) => s.id === service_id);
    if (idx < 0) {
      return jsonErr('service_id not found in ma-services.json', 404);
    }

    const svc = data.services[idx]!;
    if (use_case_id === null) {
      svc.backoffice_use_case_id = null;
    } else {
      svc.backoffice_use_case_id = use_case_id;
    }
    svc.updated_at = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').slice(0, 19);

    data.services[idx] = svc;
    await writeServicesFile(data);

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'ma_status_mapping',
      meta: { service_id, use_case_id },
    });

    return jsonOk({ service_id, use_case_id });
  });
}
