// som-portal-v2/src/lib/result.test.ts
import { describe, it, expect } from 'vitest';
import { ok, err, isOk, type Result } from './result';

describe('Result', () => {
  it('ok() produces success envelope', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, data: 42 });
    expect(isOk(r)).toBe(true);
  });

  it('err() without code omits code field', () => {
    const r = err('boom');
    expect(r).toEqual({ ok: false, error: 'boom' });
  });

  it('err() with code includes code', () => {
    const r = err('nope', 'validation_error');
    expect(r).toEqual({ ok: false, error: 'nope', code: 'validation_error' });
  });

  it('narrows via isOk', () => {
    const r: Result<string> = ok('hi');
    if (isOk(r)) {
      expect(r.data.length).toBe(2);
    }
  });
});
