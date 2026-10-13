// som-portal-v2/src/auth/mask.ts
// Masked names for the password-reset screens (v1 maskName / maskUser).

/** v1 maskName: "Warapon Lea" → "Warapon L." */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]!;
  if (parts.length === 1) return first;
  return `${first} ${[...parts[parts.length - 1]!][0]}.`;
}

/** v1 maskUser: "warapon.lea" → "wa*******ea" */
export function maskUsername(u: string): string {
  const chars = [...u];
  if (chars.length <= 3) return '*'.repeat(chars.length);
  return (
    chars.slice(0, 2).join('') +
    '*'.repeat(Math.max(1, chars.length - 4)) +
    chars.slice(-2).join('')
  );
}
