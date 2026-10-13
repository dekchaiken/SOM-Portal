// som-portal-v2/src/learn/rows.ts
// Learn files are shared with v1, which may hold rows this schema does not accept.
// A write must never drop them, so unreadable rows are carried through untouched.
/** Any schema with a safeParse that yields the output type. */
interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export function splitRows<T>(raw: unknown, schema: Parser<T>): { valid: T[]; invalid: unknown[] } {
  const valid: T[] = [];
  const invalid: unknown[] = [];
  if (!Array.isArray(raw)) return { valid, invalid };
  for (const row of raw) {
    const parsed = schema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
    else invalid.push(row);
  }
  return { valid, invalid };
}
