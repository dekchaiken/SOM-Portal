// som-portal-v2/src/admin/route-helpers.ts
// Shared plumbing for the admin route handlers: Result envelope + error mapping.
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, statusFor } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

export function okJson<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(ok(data) satisfies Result<T>, { status });
}

export function errorJson(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    const first = e.errors[0];
    return NextResponse.json(
      err(first?.message ?? 'Validation failed', 'validation_error'),
      { status: 400 },
    );
  }
  if (e instanceof AppError) {
    return NextResponse.json(err(e.message, e.code), { status: statusFor(e) });
  }
  console.error('[admin route] unhandled', e);
  return NextResponse.json(err('Internal error', 'internal'), { status: 500 });
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
