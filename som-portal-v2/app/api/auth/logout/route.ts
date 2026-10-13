// som-portal-v2/app/api/auth/logout/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, USER_COOKIE, LEGACY_COOKIE, getSession } from "@/auth/session";
import { logActivity } from "@/logging/activity";
import { ok } from "@/lib/result";

export const runtime = "nodejs";

const COOKIE_PATH = "/v2";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const jar = await cookies();
  const expires = new Date(0);

  for (const name of [SESSION_COOKIE, USER_COOKIE, LEGACY_COOKIE]) {
    jar.set(name, "", {
      httpOnly: name !== USER_COOKIE,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      expires,
    });
  }

  if (session) {
    await logActivity({
      user: session.sub,
      team: session.team,
      action: "logout",
    });
  }

  return NextResponse.json(ok({ ok: true }));
}
