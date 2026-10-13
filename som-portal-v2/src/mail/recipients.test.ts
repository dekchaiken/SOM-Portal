import { describe, expect, it } from 'vitest';
import { parseRecipients } from './recipients';

describe('parseRecipients', () => {
  it('splits on commas, semicolons and spaces', () => {
    expect(parseRecipients('a@x.com, b@y.com;c@z.com  d@w.com').valid).toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com']);
  });
  it('drops duplicates regardless of case', () => {
    expect(parseRecipients(['A@x.com', 'a@x.com']).valid).toEqual(['A@x.com']);
  });
  it('reports addresses that do not look like email', () => {
    expect(parseRecipients('ok@x.com, not-an-email').invalid).toEqual(['not-an-email']);
  });
});
