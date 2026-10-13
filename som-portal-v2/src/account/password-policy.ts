// som-portal-v2/src/account/password-policy.ts
//
// v1 only enforced `mb_strlen >= 8` at the endpoint. The A6 brief tightens this
// to "min 10, upper + digit", which is a strict superset — every v2-accepted
// password is also accepted by v1, so dual-run stays compatible.

export const PW_MIN_LENGTH = 10;
/** v1's floor, kept for reference / leniency checks. */
export const PW_V1_MIN_LENGTH = 8;
export const PW_MAX_LENGTH = 256;

export interface PolicyResult {
  ok: boolean;
  errors: string[];
}

export function checkPasswordPolicy(password: string): PolicyResult {
  const errors: string[] = [];
  const len = [...(password ?? '')].length;

  if (len < PW_MIN_LENGTH) {
    errors.push(`Password must be at least ${PW_MIN_LENGTH} characters`);
  }
  if (len > PW_MAX_LENGTH) {
    errors.push(`Password must be at most ${PW_MAX_LENGTH} characters`);
  }
  if (!/[A-Z]/.test(password ?? '')) {
    errors.push('Password must contain an uppercase letter');
  }
  if (!/[0-9]/.test(password ?? '')) {
    errors.push('Password must contain a digit');
  }

  return { ok: errors.length === 0, errors };
}

export type StrengthLabel = 'weak' | 'fair' | 'good' | 'strong';

export interface Strength {
  /** 0–4 */
  score: number;
  label: StrengthLabel;
  met: {
    length: boolean;
    upper: boolean;
    digit: boolean;
    symbol: boolean;
    long: boolean;
  };
}

/** Deterministic strength meter used by the reset + settings forms. */
export function passwordStrength(password: string): Strength {
  const pw = password ?? '';
  const len = [...pw].length;
  const met = {
    length: len >= PW_MIN_LENGTH,
    upper: /[A-Z]/.test(pw),
    digit: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
    long: len >= 16,
  };
  const score = Object.values(met).filter(Boolean).length;
  const label: StrengthLabel =
    score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';
  return { score, label, met };
}
