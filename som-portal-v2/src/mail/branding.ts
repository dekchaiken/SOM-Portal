// som-portal-v2/src/mail/branding.ts
// HTML email wrapper — v2 port of v1's api/mail/_branding.php
// Provides a branded email wrapper with header, footer, and consistent styling.

const BRAND_PRIMARY = '#F26419';
const BG_CANVAS = '#f4f1eb';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface BrandingOpts {
  appName?: string;
  brandColor?: string;
  /** Shown under the app name in the header. */
  headerText?: string;
  /** Footer lines, separated by newlines. */
  footerText?: string;
}

/**
 * Wraps email body content in a branded HTML template.
 */
export function wrapEmailHtml(
  body: string,
  subject: string,
  opts: BrandingOpts = {},
): string {
  const appName = opts.appName ?? 'SOM-Portal';
  const color = opts.brandColor ?? BRAND_PRIMARY;
  const footer = opts.footerText?.trim() ? opts.footerText : `${appName} - Service Operations Management`;
  const header = opts.headerText?.trim() ?? '';
  const footerHtml = footer.split(/\r?\n/).map((l) => esc(l)).join('<br>');

  return `<!doctype html>
<html lang="th"><body style="margin:0;background:${BG_CANVAS};padding:24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0">
  <tr><td style="padding:20px 40px 12px;border-top:4px solid ${color};font-family:Arial,Helvetica,sans-serif">
    <div style="font-size:11px;letter-spacing:.14em;color:#94a3b8;text-transform:uppercase">${esc(appName)}${header ? ` · ${esc(header)}` : ''}</div>
    <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#0f172a">${esc(subject)}</h1>
  </td></tr>
  <tr><td style="padding:16px 40px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#334155;line-height:1.7">
    ${body}
  </td></tr>
  <tr><td style="padding:16px 40px 20px;font-family:Arial,Helvetica,sans-serif;border-top:1px solid #e2e8f0">
    <div style="font-size:12px;color:#334155;line-height:1.6">${footerHtml}</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
