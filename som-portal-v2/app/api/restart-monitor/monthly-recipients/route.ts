// app/api/restart-monitor/monthly-recipients/route.ts
// GET/POST: manage monthly report email recipients (admin only)
// Matches v1 api/restart-monitor/monthly-recipients.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, requireSmWrite, ADMIN_ROLES, ALL_STAFF_ROLES } from '@/auth/policy';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { MonthlyRecipients } from '@/restart-monitor/types';
import { logActivity } from '@/logging/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE = 'restart-monitor-recipients.json';

export async function GET(): Promise<Response> {
  try {
    await requireRole(...ALL_STAFF_ROLES);
    const data = await readTeamFile(FILE, MonthlyRecipients);
    return NextResponse.json({ success: true, data });
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
    const session = await requireSmWrite(...ADMIN_ROLES);
    const body = await req.json();
    const parsed = MonthlyRecipients.parse({
      ...body,
      updatedAt: new Date().toISOString(),
      updatedBy: session.username,
    });
    await writeTeamFile(FILE, parsed, MonthlyRecipients);

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'restart_monitor_recipients_update',
      meta: {
        recipientCount: parsed.recipients.length,
        updatedBy: session.username,
      },
    });

    return NextResponse.json({ success: true, data: parsed });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
