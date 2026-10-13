// POST: test SMTP connection
import { testConnection } from '@/mail/mail-admin';
import { errorJson, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await testConnection();
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}
