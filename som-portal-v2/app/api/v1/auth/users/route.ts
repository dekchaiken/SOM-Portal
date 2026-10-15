// som-portal-v2/app/api/v1/auth/users/route.ts
// Superadmin: list login access for every user, and create an SSO user by email.
import { type NextRequest } from 'next/server';
import { readUsers } from '@/account/users-store';
import { createSsoUser, CreateSsoUserSchema, toAccessUserView } from '@/auth/user-admin';
import { jsonErr, jsonOk, readJsonBody } from '@/account/http';
import { requireSuperAdmin, mapAuthAdminError } from '../_shared';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    await requireSuperAdmin();
    const users = (await readUsers()).map(toAccessUserView);
    users.sort((a, b) => a.team.localeCompare(b.team) || a.username.localeCompare(b.username));
    return jsonOk({ users });
  } catch (e) {
    return mapAuthAdminError(e);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const sess = await requireSuperAdmin();
    const parsed = CreateSsoUserSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return jsonErr(parsed.error.issues[0]?.message ?? 'Invalid input', 400, 'validation');
    const user = await createSsoUser(parsed.data, sess.sub);
    return jsonOk({ user }, { status: 201 });
  } catch (e) {
    return mapAuthAdminError(e);
  }
}
