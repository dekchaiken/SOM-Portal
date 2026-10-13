// som-portal-v2/src/account/http.ts
// Small route helpers local to the account/settings module (A6) so no shared
// file needs editing. Envelope is the project-standard Result<T> (D-02).

import { NextResponse, type NextRequest } from 'next/server';
import { err, ok } from '@/lib/result';
import { AppError, statusFor } from '@/lib/errors';

/** Mirrors v1 `_getClientIp()` header precedence (api/helpers.php:1177). */
export function clientIp(req: NextRequest): string {
  for (const h of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip']) {
    const v = req.headers.get(h);
    if (v) return v.split(',')[0]!.trim();
  }
  return '0.0.0.0';
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(ok(data), init);
}

export function jsonErr(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json(err(message, code), { status });
}

export function jsonFromError(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json(err(e.message, e.code), { status: e.status });
  }
  console.error('[account] unhandled route error', e);
  return NextResponse.json(err('Internal error', 'internal'), { status: statusFor(e) });
}

export async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
