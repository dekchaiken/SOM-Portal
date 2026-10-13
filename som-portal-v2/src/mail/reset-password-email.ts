// som-portal-v2/src/mail/reset-password-email.ts
//
// v2 port of v1 `api/mail/_templates.php::buildResetPasswordEmail()`.
// Keeps v1's user-visible contract: Thai copy, a 24-hour expiry notice, a CTA
// button, and the raw URL as a copy/paste fallback. The elaborate `_bd*`
// branded-email builders stay in PHP; this renders the same information in a
// self-contained table layout that email clients handle.

import { v1Strtotime } from '@/lib/v1-date';

export interface ResetEmail {
  subject: string;
  html: string;
}

const BRAND = '#F26419';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** v1 formatted expiry as `d M Y, H:i (Asia/Bangkok)`. */
function formatExpiry(expiresAt: string): string {
  const sec = v1Strtotime(expiresAt) || Math.floor(Date.now() / 1000) + 86400;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(sec * 1000));
  return `${fmt.replace(/,? (\d{2}:\d{2})$/, ', $1')} (Asia/Bangkok)`;
}

export function buildResetPasswordEmail(
  name: string,
  resetUrl: string,
  expiresAt: string,
  reason: 'forgot' | 'admin' = 'forgot',
  appName = 'SOM-Portal',
): ResetEmail {
  const typeTag = reason === 'forgot' ? 'FORGOT PASSWORD' : 'ADMIN RESET';
  const subject =
    reason === 'forgot'
      ? `[${appName}] รีเซ็ตรหัสผ่านของคุณ`
      : `[${appName}] ผู้ดูแลระบบรีเซ็ตรหัสผ่านของคุณ`;
  const url = esc(resetUrl);
  const exp = esc(formatExpiry(expiresAt));
  const who = esc(name || 'ผู้ใช้งาน');

  const html = `<!doctype html>
<html lang="th"><body style="margin:0;background:#f4f1eb;padding:24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0">
  <tr><td style="padding:28px 44px 8px;border-top:4px solid ${BRAND};font-family:Arial,Helvetica,sans-serif">
    <div style="font-size:11px;letter-spacing:.14em;color:#94a3b8">01 · RESET · ${esc(typeTag)}</div>
    <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;color:#0f172a">รีเซ็ตรหัสผ่าน</h1>
  </td></tr>
  <tr><td style="padding:16px 44px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#334155;line-height:1.7">
    สวัสดีคุณ <strong>${who}</strong><br>
    เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชี ${esc(appName)} ของคุณ
  </td></tr>
  <tr><td style="padding:22px 44px 0;font-family:Arial,Helvetica,sans-serif">
    <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 14px;font-size:12px;color:#78350f;line-height:1.7">
      <strong>LINK EXPIRES IN 24 HOURS</strong><br>
      หมดอายุ: <strong>${exp}</strong><br>หากเลยกำหนด กรุณาขอลิงก์ใหม่จากหน้าเข้าสู่ระบบ
    </div>
  </td></tr>
  <tr><td align="center" style="padding:26px 44px 6px">
    <a href="${url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;padding:14px 30px">ตั้งรหัสผ่านใหม่</a>
  </td></tr>
  <tr><td style="padding:10px 44px 32px;font-family:monospace">
    <div style="font-size:11px;letter-spacing:.05em;color:#888;margin-bottom:8px">// คัดลอกลิงก์ไปวางในเบราว์เซอร์ได้ถ้าปุ่มใช้ไม่ได้</div>
    <div style="font-size:12px;color:#475569;word-break:break-all;background:#f4f1eb;padding:12px 14px;border-left:3px solid ${BRAND}">${url}</div>
    <div style="font-size:11px;color:#94a3b8;line-height:1.65;margin-top:22px;border-top:1px solid #e2e8f0;padding-top:16px;font-family:Arial,Helvetica,sans-serif">
      หากคุณไม่ได้เป็นคนขอรีเซ็ตรหัสผ่าน สามารถละเลยอีเมลฉบับนี้ได้ — รหัสผ่านของคุณจะไม่ถูกเปลี่ยน
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html };
}
