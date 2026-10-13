// som-portal-v2/app/api/v1/users/route.ts
// v1 counterpart: api/users/index.php (GET list, POST create).
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/auth/policy';
import { listUsers, createUser, CreateUserInput } from '@/admin/users-service';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    // Team narrowing: explicit ?team=, else the v1 X-Admin-Team context header.
    const header = req.headers.get('X-Admin-Team');
    const team = req.nextUrl.searchParams.get('team') ?? header ?? null;
    const includeDeleted = req.nextUrl.searchParams.get('include_deleted') === '1';
    return okJson(await listUsers(session, { team, includeDeleted }));
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const input = CreateUserInput.parse(await jsonBody(req));
    return okJson(await createUser(session, input), 201);
  } catch (e) {
    return errorJson(e);
  }
}
