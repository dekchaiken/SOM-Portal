// som-portal-v2/src/auth/login-methods.test.ts
import { describe, expect, it } from 'vitest';
import {
  allowedMethods,
  canUseMethod,
  defaultMethodsForTeam,
  isLegacyRecord,
  normalizeMethods,
} from './login-methods';
import { canUseSso, emailFromProfile } from './sso-rules';
import { findDuplicate, legacyCloseMethods, suggestUsername, toAccessUserView, violatesBreakGlass } from './user-admin';

describe('login methods', () => {
  it('treats a record without allowed_methods as a legacy password account', () => {
    expect(isLegacyRecord({})).toBe(true);
    expect(allowedMethods({})).toEqual(['password']);
    expect(canUseMethod({}, 'password')).toBe(true);
    expect(canUseMethod({}, 'sso')).toBe(false);
  });

  it('keeps only known methods, in a stable order', () => {
    expect(normalizeMethods(['sso', 'password', 'otp', 'sso'])).toEqual(['password', 'sso']);
    expect(normalizeMethods('sso')).toBeNull();
  });

  it('respects an explicit SSO-only record', () => {
    const u = { allowed_methods: ['sso'] };
    expect(isLegacyRecord(u)).toBe(false);
    expect(canUseMethod(u, 'sso')).toBe(true);
    expect(canUseMethod(u, 'password')).toBe(false);
  });

  it('gives the three password-only teams password and everyone else SSO', () => {
    expect(defaultMethodsForTeam('wealth')).toEqual(['password']);
    expect(defaultMethodsForTeam('jenkins')).toEqual(['password']);
    expect(defaultMethodsForTeam('sojenkins')).toEqual(['password']);
    expect(defaultMethodsForTeam('sm')).toEqual(['sso']);
    expect(defaultMethodsForTeam(undefined)).toEqual(['sso']);
  });
});

describe('sso rules', () => {
  it('lets legacy accounts use SSO so they can move before password is closed', () => {
    expect(canUseSso({})).toBe(true);
  });

  it('allows SSO only when sso is granted', () => {
    expect(canUseSso({ allowed_methods: ['sso'] })).toBe(true);
    expect(canUseSso({ allowed_methods: ['password'] })).toBe(false);
    expect(canUseSso({ allowed_methods: ['sso', 'password'] })).toBe(true);
  });

  it('accepts only a verified email from the profile', () => {
    expect(emailFromProfile({ email: 'Ann@Example.com', email_verified: true })).toBe('ann@example.com');
    expect(emailFromProfile({ email: 'ann@example.com', email_verified: false })).toBeNull();
    expect(emailFromProfile({ email: 'ann@example.com' })).toBeNull();
    expect(emailFromProfile({ email: 'not-an-email', email_verified: true })).toBeNull();
    expect(emailFromProfile(undefined)).toBeNull();
  });
});

describe('user admin helpers', () => {
  const users = [
    { id: 'usr_1', username: 'ann.s', email: 'ann@example.com' },
    { id: 'usr_2', username: 'bob', email: 'bob@example.com' },
  ];

  it('detects duplicate email and username case-insensitively', () => {
    expect(findDuplicate(users, 'ANN@example.com', 'new.user')).toBe('email');
    expect(findDuplicate(users, 'new@example.com', 'BOB')).toBe('username');
    expect(findDuplicate(users, 'new@example.com', 'new.user')).toBeNull();
  });

  it('suggests a username from the email and avoids collisions', () => {
    expect(suggestUsername('Somchai.K@example.com', new Set())).toBe('somchai.k');
    expect(suggestUsername('ann@example.com', new Set(['ann']))).toBe('ann2');
  });

  it('keeps password on super_admin accounts, both on edit and on bulk close', () => {
    expect(violatesBreakGlass('super_admin', ['sso'])).toBe(true);
    expect(violatesBreakGlass('super_admin', ['password', 'sso'])).toBe(false);
    expect(violatesBreakGlass('sm_user', ['sso'])).toBe(false);
    expect(legacyCloseMethods('super_admin', 'sm')).toEqual(['password', 'sso']);
    expect(legacyCloseMethods('sm_user', 'wealth')).toEqual(['password']);
    expect(legacyCloseMethods('sm_user', 'sm')).toEqual(['sso']);
  });

  it('never exposes the password hash in the access view', () => {
    const view = toAccessUserView({
      id: 'usr_9',
      username: 'x',
      role: 'sm_user',
      team: 'sm',
      password: '$2b$10$secret',
    });
    expect(view).toEqual({
      id: 'usr_9',
      username: 'x',
      name: '',
      email: '',
      team: 'sm',
      role: 'sm_user',
      allowed_methods: ['password'],
      legacy: true,
      has_password: true,
    });
    expect(JSON.stringify(view)).not.toContain('$2b$');
  });
});
