// GET/PUT: SMTP config (admin only)
import { type NextRequest } from 'next/server';
import { getMailConfig, updateMailConfig, UpdateMailConfigSchema } from '@/mail/mail-admin';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await getMailConfig();
    return okJson(config);
  } catch (e) {
    return errorJson(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await jsonBody(req);
    const parsed = UpdateMailConfigSchema.parse(body);
    const result = await updateMailConfig(parsed);
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}
