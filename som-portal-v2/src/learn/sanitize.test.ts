import { describe, expect, it } from 'vitest';
import { sanitizeLessonHtml } from './sanitize';

describe('sanitizeLessonHtml', () => {
  it('keeps ordinary lesson markup', () => {
    const html = '<h2>หัวข้อ</h2><p>ข้อความ <strong>หนา</strong></p><ul><li>a</li></ul>';
    expect(sanitizeLessonHtml(html)).toBe(html);
  });

  it('removes script blocks', () => {
    expect(sanitizeLessonHtml('<p>x</p><script>alert(1)</script>')).toBe('<p>x</p>');
  });

  it('removes event handler attributes', () => {
    expect(sanitizeLessonHtml('<img src="a.png" onerror="alert(1)">')).toBe('<img src="a.png">');
  });

  it('removes javascript URLs', () => {
    expect(sanitizeLessonHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('handles nested tag tricks', () => {
    expect(sanitizeLessonHtml('<scr<script>x</script>ipt>alert(1)</script>')).not.toMatch(/<script/i);
  });
});
