// som-portal-v2/app/api/v1/auth/_shared.ts
// Shared guard and error mapping for the superadmin login-access API.
import { NextResponse } from 'next/server';
import { requireRole, SUPER_ADMIN } from '@/auth/policy';
import { UserAdminError } from '@/auth/user-admin';
import { jsonErr, jsonFromError } from '@/account/http';
import type { Session } from '@/auth/session';

/** Every route in this folder is superadmin only. Throws AuthError or ForbiddenError otherwise. */
export function requireSuperAdmin(): Promise<Session> {
  return requireRole(SUPER_ADMIN);
}

const STATUS: Record<UserAdminError['code'], number> = {
  duplicate_email: 409,
  duplicate_username: 409,
  not_found: 404,
  invalid: 400,
};

/** Maps UserAdminError to a 4xx response and everything else to the shared error mapper. */
export function mapAuthAdminError(e: unknown): NextResponse {
  if (e instanceof UserAdminError) return jsonErr(e.message, STATUS[e.code], e.code);
  if (e instanceof Error && e.message.startsWith('MAIL_CREDS_KEY')) return jsonErr(e.message, 400, 'key_missing');
  return jsonFromError(e);
}
