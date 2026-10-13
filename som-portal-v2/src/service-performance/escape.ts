// som-portal-v2/src/service-performance/escape.ts
//
// PromQL escape primitives — direct port of v1's _spPromEscape (api/service-performance/_lib.php:382-388).
// See research/promql-tag.md §G1-G6 for the full rationale.

/**
 * Escape a value for a PromQL *equality* matcher (`pod="X"`).
 * Only `\` and `"` are special inside a PromQL string literal.
 */
export function escapeMatcher(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Escape a value for use inside a PromQL *regex* matcher (`pod=~"X"`).
 *
 * Two layers applied in order:
 *   1. RE2 metachar escape: `. \ + * ? [ ] ( ) | ^ $ { }` each prefixed with `\`.
 *      Deliberately does NOT escape `-` (G2 — some Thanos versions reject `\-`
 *      and silently return `[]`). Does NOT escape `/` (preg_quote would, Thanos rejects).
 *   2. PromQL string-literal escape: every `\` doubled, every `"` backslashed.
 *      This turns regex-escaped `\.` into `\\.` on the wire (G1 — the headline bug).
 *
 * Matches v1's `_spPromEscape()` output exactly.
 */
export function escapeRegex(s: string): string {
  // Layer 1: RE2 metachars
  const re2 = s.replace(/[.\\+*?\[\]()|^${}]/g, '\\$&');
  // Layer 2: PromQL string literal escaping
  return re2.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
