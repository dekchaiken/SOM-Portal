// som-portal-v2/src/lib/errors.ts

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code = 'app_error', status = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', code = 'unauthorized') {
    super(message, code, 401);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'forbidden') {
    super(message, code, 403);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', code = 'validation_error') {
    super(message, code, 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'not_found') {
    super(message, code, 404);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message = 'Rate limit exceeded', code = 'rate_limited') {
    super(message, code, 429);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export function statusFor(e: unknown): number {
  if (e instanceof AppError) return e.status;
  return 500;
}
