// som-portal-v2/src/jira/http.ts
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(ok(data), init);
}

/** Map thrown AppErrors (and anything else) onto the Result envelope. */
export function jsonError(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json(err(e.message, e.code), { status: e.status });
  }
  console.error("[jira] unhandled", e);
  return NextResponse.json(err("Internal error", "internal"), { status: 500 });
}

export type { Result };
