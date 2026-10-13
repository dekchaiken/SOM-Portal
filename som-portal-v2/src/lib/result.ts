// som-portal-v2/src/lib/result.ts
// Wire envelope matching PHP v1 — see D-02.

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err<T = never>(error: string, code?: string): Result<T> {
  return code === undefined ? { ok: false, error } : { ok: false, error, code };
}

export function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
  return r.ok === true;
}
