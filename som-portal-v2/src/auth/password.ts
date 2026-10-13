// som-portal-v2/src/auth/password.ts
// bcrypt with v1-compatible `$2b$` → `$2y$` normalisation. v1 docs:
// "The `$2b$` → `$2y$` prefix normalization in verifyPassword() exists for
// compatibility with legacy Python-generated hashes."
import bcrypt from 'bcryptjs';

export async function hashPassword(plain: string, rounds = 10): Promise<string> {
  return bcrypt.hash(plain, rounds);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const normalised = stored.startsWith('$2y$') ? '$2a$' + stored.slice(4) : stored;
  // bcryptjs recognises `$2a$`/`$2b$` natively; `$2y$` is PHP's variant.
  try {
    return await bcrypt.compare(plain, normalised);
  } catch {
    return false;
  }
}
