// app/api/restart-monitor/webhooks/route.ts
// GET/POST: manage webhook config (admin only)
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ADMIN_ROLES, ALL_STAFF_ROLES } from '@/auth/policy';
import { readWebhooks, writeWebhooks } from '@/restart-monitor/webhooks';
import { WebhookConfig } from '@/restart-monitor/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireRole(...ALL_STAFF_ROLES);
    const config = await readWebhooks();
    return NextResponse.json({ success: true, data: config });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const session = await requireRole(...ADMIN_ROLES);
    const body = await req.json();
    const parsed = WebhookConfig.parse({
      ...body,
      updatedAt: new Date().toISOString(),
      updatedBy: session.username,
    });
    await writeWebhooks(parsed);
    return NextResponse.json({ success: true, data: parsed });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
