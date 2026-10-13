// som-portal-v2/src/learn/sanitize.ts
// Lesson bodies are authored HTML. v1 stored and rendered them unsanitized; v2
// strips active content before rendering. Allow-list is deliberately small.

const DROP_BLOCKS = /<(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_VOID = /<\/?(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|svg|math)\b[^>]*>/gi;
const EVENT_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const BAD_URL_ATTR = /\s+(href|src|xlink:href|action|formaction)\s*=\s*("\s*(javascript|vbscript|data):[^"]*"|'\s*(javascript|vbscript|data):[^']*'|(javascript|vbscript|data):[^\s>]*)/gi;

export function sanitizeLessonHtml(html: string): string {
  let out = html;
  let prev = '';
  // Repeat until stable so nested tricks such as <scr<script>ipt> cannot survive.
  while (out !== prev) {
    prev = out;
    out = out.replace(DROP_BLOCKS, '').replace(DROP_VOID, '').replace(EVENT_ATTR, '').replace(BAD_URL_ATTR, '');
  }
  return out;
}
