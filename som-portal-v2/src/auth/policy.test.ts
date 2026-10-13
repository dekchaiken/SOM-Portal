// som-portal-v2/src/auth/policy.test.ts
import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLES,
  LEAD_ROLES,
  ALL_STAFF_ROLES,
  SUPER_ADMIN_ONLY,
  hasRole,
  isSuperAdmin,
} from './policy';
import type { Session } from './session';

const sess = (role: string): Session => ({
  sub: 'u',
  username: 'u',
  role,
  team: 'sm',
});

describe('policy role sets', () => {
  it('ADMIN_ROLES excludes sm_lead', () => {
    const roles: readonly string[] = ADMIN_ROLES;
    expect(roles.includes('sm_lead')).toBe(false);
    expect(roles.includes('sm_admin')).toBe(true);
  });

  it('LEAD_ROLES includes sm_lead', () => {
    const roles: readonly string[] = LEAD_ROLES;
    expect(roles.includes('sm_lead')).toBe(true);
  });

  it('ALL_STAFF_ROLES has 8 entries', () => {
    expect(ALL_STAFF_ROLES.length).toBe(8);
  });

  it('SUPER_ADMIN_ONLY has only super_admin', () => {
    expect(SUPER_ADMIN_ONLY).toEqual(['super_admin']);
  });

  it('hasRole / isSuperAdmin', () => {
    expect(hasRole(sess('sm_admin'), ADMIN_ROLES)).toBe(true);
    expect(hasRole(sess('sm_user'), ADMIN_ROLES)).toBe(false);
    expect(isSuperAdmin(sess('super_admin'))).toBe(true);
    expect(isSuperAdmin(sess('sm_admin'))).toBe(false);
  });
});
