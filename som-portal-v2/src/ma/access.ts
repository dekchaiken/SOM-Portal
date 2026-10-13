// som-portal-v2/src/ma/access.ts
// Who may change MA usecases and cut-offs. These are SM team data: the SM team
// writes, every other team sees them view-only. super_admin may write anywhere.
import { SM_WRITE_SHARED_ROLES, SUPER_ADMIN } from '@/auth/policy';

export const SM_TEAM = 'sm';

export interface MAAccessSession {
  role: string;
  team: string;
}

export function canEditMASharedData(session: MAAccessSession): boolean {
  if (session.role === SUPER_ADMIN) return true;
  return session.team === SM_TEAM && (SM_WRITE_SHARED_ROLES as readonly string[]).includes(session.role);
}
