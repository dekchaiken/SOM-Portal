// som-portal-v2/src/service-performance/promql.ts
//
// Tagged template for PromQL queries — prevents bare string interpolation.
// See research/promql-tag.md for the full design rationale.

import { escapeMatcher, escapeRegex } from './escape';

// ─── Branded output type ────────────────────────────────────────────────────
declare const __promql: unique symbol;
export type PromQLQuery = string & { readonly [__promql]: true };

// ─── Interpolation markers ──────────────────────────────────────────────────
type Interp =
  | { kind: 'str'; value: string }
  | { kind: 're'; value: string }
  | { kind: 'raw'; value: string };

/** Equality matcher value — escapes `\` and `"`. */
export const str = (value: string): Interp => ({ kind: 'str', value });

/** Regex matcher value — escapes RE2 metachars + PromQL string escaping. */
export const re = (value: string): Interp => ({ kind: 're', value });

/** Raw label name, duration, or number — validated, not escaped. */
export const raw = (value: string | number): Interp => ({ kind: 'raw', value: String(value) });

// ─── Raw validation ─────────────────────────────────────────────────────────
const RAW_LABEL_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const RAW_DURATION_RE = /^[0-9]+(ms|s|m|h|d|w)$/;
const RAW_NUMBER_RE = /^-?[0-9]+(\.[0-9]+)?$/;

export function validateRaw(v: string): string {
  if (RAW_LABEL_RE.test(v)) return v;
  if (RAW_DURATION_RE.test(v)) return v;
  if (RAW_NUMBER_RE.test(v)) return v;
  throw new Error(`promql: raw(${JSON.stringify(v)}) is not a safe label/duration/number`);
}

// ─── Tagged template ────────────────────────────────────────────────────────
export function promql(strings: TemplateStringsArray, ...values: unknown[]): PromQLQuery {
  const parts: string[] = [];
  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]!);
    if (i >= values.length) continue;
    const v = values[i];
    if (v == null || typeof v !== 'object' || !('kind' in (v as object))) {
      throw new Error(
        `promql: bare interpolation at slot ${i}; wrap values in str()/re()/raw()`,
      );
    }
    const slot = v as Interp;
    switch (slot.kind) {
      case 'str':
        parts.push(`"${escapeMatcher(slot.value)}"`);
        break;
      case 're':
        parts.push(`"${escapeRegex(slot.value)}"`);
        break;
      case 'raw':
        parts.push(validateRaw(slot.value));
        break;
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim() as PromQLQuery;
}
