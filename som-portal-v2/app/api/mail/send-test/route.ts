// POST: send test email
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { sendTestEmail } from '@/mail/mail-admin';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SendTestSchema = z.object({ to: z.string().email() });

export async function POST(req: NextRequest) {
  try {
    const body = await jsonBody(req);
    const { to } = SendTestSchema.parse(body);
    const result = await sendTestEmail(to);
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}
