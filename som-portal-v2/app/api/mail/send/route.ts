// POST: send arbitrary email (admin only)
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '@/auth/policy';
import { sendMail } from '@/mail/mailer';
import { logActivity } from '@/logging/activity';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SendMailSchema = z.object({
  to: z.array(z.string().email()).min(1, 'At least one recipient required'),
  cc: z.array(z.string().email()).optional().default([]),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  html: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(...ADMIN_ROLES);
    const raw = await jsonBody(req);
    const { to, cc, subject, body, html } = SendMailSchema.parse(raw);

    const result = await sendMail({
      to,
      cc,
      team: session.team,
      subject,
      html: html ? body : `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(body)}</pre>`,
      sent_by: session.sub,
      sent_by_name: session.username,
      log_type: 'admin_send',
    });

    await logActivity({
      user: session.sub,
      team: session.team ?? null,
      action: 'mail.send',
      meta: { to, cc, subject, ok: result.ok, error: result.error },
    });

    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
