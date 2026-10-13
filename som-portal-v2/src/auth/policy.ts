// som-portal-v2/src/auth/policy.ts
import { AuthError, ForbiddenError } from '@/lib/errors';
import { getSession, type Session } from './session';

export const SUPER_ADMIN = 'super_admin' as const;
export const SUPER_VIEWER = 'super_viewer' as const;
export const SM_ADMIN = 'sm_admin' as const;
export const DEV_SM = 'dev_sm' as const;
export const SM_LEAD = 'sm_lead' as const;
export const SM_USER = 'sm_user' as const;
export const DEV_USER = 'dev_user' as const;
export const EXTERNAL = 'external' as const;

export const ADMIN_ROLES = [SUPER_ADMIN, SM_ADMIN, DEV_SM] as const;
export const LEAD_ROLES = [SUPER_ADMIN, SM_ADMIN, DEV_SM, SM_LEAD] as const;
export const ALL_STAFF_ROLES = [
  SUPER_ADMIN,
  SUPER_VIEWER,
  SM_ADMIN,
  DEV_SM,
  SM_LEAD,
  SM_USER,
  DEV_USER,
  EXTERNAL,
] as const;
export const SUPER_ADMIN_ONLY = [SUPER_ADMIN] as const;
export const GLOBAL_READ_ROLES = [SUPER_ADMIN, SUPER_VIEWER] as const;
export const SM_WRITE_SHARED_ROLES = [SUPER_ADMIN, SM_ADMIN, DEV_SM, SM_LEAD] as const;

export async function requireAuth(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthError();
  return s;
}

export async function requireRole(...roles: readonly string[]): Promise<Session> {
  const s = await requireAuth();
  if (!roles.includes(s.role)) {
    throw new ForbiddenError(`Requires one of: ${roles.join(', ')}`);
  }
  return s;
}

/** v1 requireSmForShared(): data the SM team owns is view-only for every other team. */
export function assertSmForShared(session: Session): void {
  if (session.role === SUPER_ADMIN) return;
  if (session.team !== 'sm') {
    throw new ForbiddenError(
      `This resource is managed by the SM team and is view-only for team "${session.team}"`,
    );
  }
}

export async function requireSmWrite(...roles: readonly string[]): Promise<Session> {
  const s = await requireRole(...roles);
  assertSmForShared(s);
  return s;
}

export function hasRole(session: Session, roles: readonly string[]): boolean {
  return roles.includes(session.role);
}

export function isSuperAdmin(session: Session): boolean {
  return session.role === SUPER_ADMIN;
}
