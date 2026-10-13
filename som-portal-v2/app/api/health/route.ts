// som-portal-v2/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { ok } from '@/lib/result';

const BUILD = process.env.BUILD_SHA ?? 'dev';
const STARTED_AT = Date.now();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    ok({
      uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
      build: BUILD,
    }),
  );
}
