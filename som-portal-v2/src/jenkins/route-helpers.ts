// som-portal-v2/src/jenkins/route-helpers.ts
// Shared error → Result<T> mapping for the jenkins/batch routes.
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, statusFor } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(ok(data), { status });
}

export function jsonErr(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json(err(message, code ?? codeForStatus(status)), { status });
}

function codeForStatus(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'upstream_rejected';
  if (status === 502) return 'upstream_unreachable';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

/**
 * Wrap a route body so AuthError/ForbiddenError/ZodError surface as the right
 * status with a `Result` envelope instead of a Next.js 500 page.
 */
export async function handle<T>(fn: () => Promise<Result<T> | NextResponse>): Promise<NextResponse> {
  try {
    const r = await fn();
    if (r instanceof NextResponse) return r;
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.errors[0];
      return jsonErr(first?.message ?? 'Validation failed', 400, 'validation_error');
    }
    if (e instanceof AppError) {
      return jsonErr(e.message, statusFor(e), e.code);
    }
    console.error('[jenkins route]', e);
    return jsonErr('Unexpected server error', 500);
  }
}
