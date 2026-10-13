// som-portal-v2/app/api/v1/system-settings/route.ts
// v1 counterpart: api/system-settings/index.php (GET any auth user, PUT admin).
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import {
  getSettings,
  updateSettings,
  SUPER_ADMIN_ONLY_KEYS,
  INT_KEYS,
} from '@/admin/system-settings-service';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireAuth();
    return okJson({
      settings: await getSettings(),
      // Drives the UI: which fields to lock for a non-super_admin, and the
      // clamp ranges for the number steppers.
      locked_keys: session.role === 'super_admin' ? [] : [...SUPER_ADMIN_ONLY_KEYS],
      ranges: INT_KEYS,
      role: session.role,
    });
  } catch (e) {
    return errorJson(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth();
    const result = await updateSettings(session, await jsonBody(req));
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}

export const PUT = PATCH;
