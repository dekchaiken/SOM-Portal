// som-portal-v2/src/auth/sso-rules.ts
// Pure rules for SSO sign-in. Kept separate from the Auth.js wiring so they can be unit tested.
import { canUseMethod, isLegacyRecord, type MethodSubject } from './login-methods';

/**
 * SSO is allowed for a legacy account (no allowed_methods yet), so existing users can
 * move to Keycloak before the superadmin closes their password. Otherwise the user
 * needs 'sso' in allowed_methods.
 */
export function canUseSso(user: MethodSubject): boolean {
  return isLegacyRecord(user) || canUseMethod(user, 'sso');
}

/** Returns the lower-cased email only when Keycloak says it is verified. */
export function emailFromProfile(profile: Record<string, unknown> | undefined): string | null {
  if (!profile) return null;
  const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return null;
  if (profile.email_verified !== true) return null;
  return email;
}
