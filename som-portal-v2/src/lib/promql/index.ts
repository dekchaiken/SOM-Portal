// src/lib/promql/index.ts
// Tagged-template PromQL builder following research/promql-tag.md.
// Prevents injection by requiring every interpolation to pass through a marker helper.

/** Opaque branded string so ThanosClient can enforce promql-only input. */
export type PromQLQuery = string & { readonly __brand: 'PromQLQuery' };

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

interface Marker {
  readonly __promql_marker: true;
  readonly value: string;
}

function isMarker(v: unknown): v is Marker {
  return typeof v === 'object' && v !== null && '__promql_marker' in v;
}

/** Equality matcher value — escapes `\` and `"` only (string literal). */
export function str(value: string | number): Marker {
  const s = String(value);
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return { __promql_marker: true, value: escaped };
}

/**
 * Regex matcher value — escapes regex metachars then PromQL string-literal chars.
 * Does NOT escape `-` (G2 from promql-tag.md).
 */
export function re(value: string): Marker {
  // Step 1: escape RE2 metachars (not `-`)
  const reEscaped = value.replace(/[.\\+*?\[\]()|^${}]/g, '\\$&');
  // Step 2: PromQL string-literal escape — double all backslashes, escape quotes
  const promEscaped = reEscaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return { __promql_marker: true, value: promEscaped };
}

/** Raw safe value — only allows label names, durations, numbers. */
export function raw(value: string | number): Marker {
  const s = String(value);
  if (
    !/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(s) &&
    !/^[0-9]+(\.[0-9]+)?(ms|s|m|h|d|w|y)?$/.test(s)
  ) {
    throw new Error(`promql.raw() rejects unsafe value: ${s}`);
  }
  return { __promql_marker: true, value: s };
}

/** Duration value — validates format. */
export function duration(value: string): Marker {
  if (!/^[0-9]+(ms|s|m|h|d|w|y)$/.test(value)) {
    throw new Error(`promql.duration() rejects: ${value}`);
  }
  return { __promql_marker: true, value };
}

// ---------------------------------------------------------------------------
// Tagged template
// ---------------------------------------------------------------------------

export function promql(
  strings: TemplateStringsArray,
  ...values: Marker[]
): PromQLQuery {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (!isMarker(v)) {
        throw new Error(
          `promql template: every interpolation must use str(), re(), raw(), or duration(). Got: ${typeof v}`,
        );
      }
      result += v.value;
    }
  }
  return result.trim() as PromQLQuery;
}

// ---------------------------------------------------------------------------
// Escape helpers (for non-tagged-template use, e.g. building selectors)
// ---------------------------------------------------------------------------

/** Escape a string for use in a PromQL =~ regex matcher (on the wire). */
export function escapeRegex(s: string): string {
  const reEscaped = s.replace(/[.\\+*?\[\]()|^${}]/g, '\\$&');
  return reEscaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape a string for use in a PromQL = equality matcher. */
export function escapeMatcher(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
