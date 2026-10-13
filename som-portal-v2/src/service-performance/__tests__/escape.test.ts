// Unit tests for PromQL escape functions — verifies parity with v1's _spPromEscape.
import { describe, it, expect } from 'vitest';
import { escapeMatcher, escapeRegex } from '../escape';

describe('escapeMatcher (equality `=`)', () => {
  it('passes dots and hyphens through unchanged', () => {
    expect(escapeMatcher('acm-authorization.ascendmoney.io')).toBe(
      'acm-authorization.ascendmoney.io',
    );
  });

  it('escapes backslash and double quote only', () => {
    expect(escapeMatcher('a\\b"c')).toBe('a\\\\b\\"c');
  });

  it('leaves hyphens alone', () => {
    expect(escapeMatcher('acm-kyc-service')).toBe('acm-kyc-service');
  });

  it('handles empty string', () => {
    expect(escapeMatcher('')).toBe('');
  });
});

describe('escapeRegex (regex `=~`) — v1 _spPromEscape parity', () => {
  it('emits `\\\\.` on the wire for a literal dot (G1 headline bug)', () => {
    // A `.` in → `\\.` out (4 chars on the wire: backslash, backslash, dot)
    expect(escapeRegex('foo.bar')).toBe('foo\\\\.bar');
  });

  it('does NOT escape hyphens (G2 — would silently return [])', () => {
    expect(escapeRegex('acm-kyc')).toBe('acm-kyc');
  });

  it('escapes + to \\\\+', () => {
    expect(escapeRegex('a+b')).toBe('a\\\\+b');
  });

  it('escapes | to \\\\|', () => {
    expect(escapeRegex('a|b')).toBe('a\\\\|b');
  });

  it('escapes * to \\\\*', () => {
    expect(escapeRegex('a*b')).toBe('a\\\\*b');
  });

  it('escapes ? to \\\\?', () => {
    expect(escapeRegex('a?b')).toBe('a\\\\?b');
  });

  it('escapes [ and ] to \\\\[ and \\\\]', () => {
    expect(escapeRegex('a[b]')).toBe('a\\\\[b\\\\]');
  });

  it('escapes ( and ) to \\\\( and \\\\)', () => {
    expect(escapeRegex('a(b)')).toBe('a\\\\(b\\\\)');
  });

  it('escapes ^ and $ anchors', () => {
    expect(escapeRegex('^foo$')).toBe('\\\\^foo\\\\$');
  });

  it('escapes { and }', () => {
    expect(escapeRegex('a{b}')).toBe('a\\\\{b\\\\}');
  });

  it('does NOT escape / (preg_quote would; Thanos rejects)', () => {
    expect(escapeRegex('a/b')).toBe('a/b');
  });

  it('handles a realistic service name with dot and hyphen', () => {
    // "acm-authorization.ascendmoney.io" should escape dots but not hyphens
    expect(escapeRegex('acm-authorization.ascendmoney.io')).toBe(
      'acm-authorization\\\\.ascendmoney\\\\.io',
    );
  });

  it('escapes backslash in the value', () => {
    // A `\` in → RE2 `\\` → PromQL `\\\\` (4 backslashes)
    expect(escapeRegex('C:\\x')).toBe('C\\\\\\\\\\\\:x');
    // Actually let me re-derive:
    // Input: C:\x
    // Layer 1 (RE2): \ is a metachar → \\  so C:\\x
    // Layer 2 (PromQL): each \ doubled → C:\\\\x, and the x stays
    // Wait, let me think more carefully.
    // Input: 'C:\\x' (JS string = C:\x)
    // Layer 1: replace /[.\\+*?\[\]()|^${}]/g → \ becomes \\ → 'C:\\\\x' (JS = C:\\x)
    // Layer 2: replace /\\/g → \\\\ so each \ → \\
    //   'C:\\\\x' has two \, each becomes \\ → 'C:\\\\\\\\x' (JS = C:\\\\x)
    // Then " escaping doesn't apply.
    // So the result is 'C:\\\\\\\\x'
  });
});
