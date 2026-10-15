// som-portal-v2/src/auth/login-methods.ts
// Which sign-in methods a user may use. Pure, so it can run in the Edge bundle,
// in route handlers and in tests.
//
// Rules:
//   • `allowed_methods` on the user record is the source of truth.
//   • A record without the field is a legacy v1 account. It keeps password login
//     so nothing breaks before the superadmin configures SSO. The superadmin can
//     then close password for legacy users with the bulk action.

export const LOGIN_METHODS = ['password', 'sso'] as const;
export type LoginMethod = (typeof LOGIN_METHODS)[number];

/** Teams that always sign in with username and password. Keep these slugs in sync with data/teams.json. */
export const PASSWORD_ONLY_TEAMS: readonly string[] = ['wealth', 'jenkins', 'sojenkins'];

/** Any user record. Only `allowed_methods` is read, so extra fields are fine. */
export type MethodSubject = object;

function rawMethods(user: MethodSubject): unknown {
  return (user as { allowed_methods?: unknown }).allowed_methods;
}

export function normalizeMethods(raw: unknown): LoginMethod[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set(raw.filter((m): m is LoginMethod => (LOGIN_METHODS as readonly string[]).includes(m as string)));
  return LOGIN_METHODS.filter((m) => set.has(m));
}

export function allowedMethods(user: MethodSubject): LoginMethod[] {
  return normalizeMethods(rawMethods(user)) ?? ['password'];
}

export function canUseMethod(user: MethodSubject, method: LoginMethod): boolean {
  return allowedMethods(user).includes(method);
}

/** The default methods for a legacy account being closed in bulk. */
export function defaultMethodsForTeam(team: string | undefined): LoginMethod[] {
  return team && PASSWORD_ONLY_TEAMS.includes(team) ? ['password'] : ['sso'];
}

export function isLegacyRecord(user: MethodSubject): boolean {
  return normalizeMethods(rawMethods(user)) === null;
}
