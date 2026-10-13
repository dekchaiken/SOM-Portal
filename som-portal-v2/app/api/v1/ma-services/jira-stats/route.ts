// GET /api/v1/ma-services/jira-stats?year=2026 — Jira issue counts per MA service
import { requireAuth } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { readJiraStats } from '@/ma/jira-stats';
import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    await requireAuth();
    const year = Number(new URL(req.url).searchParams.get('year') ?? new Date().getFullYear());
    if (year < 2020 || year > 2099) return jsonErr('Invalid year', 400);
    const stats = await readJiraStats(year);
    return jsonOk(stats);
  });
}
