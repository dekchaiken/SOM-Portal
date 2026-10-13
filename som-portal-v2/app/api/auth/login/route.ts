// som-portal-v2/app/api/auth/login/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { signSession, SESSION_COOKIE, USER_COOKIE } from "@/auth/session";
import { verifyPassword } from "@/auth/password";
import { findUserByUsername } from "@/auth/user-lookup";
import { getRateLimitBackend } from "@/lib/rate-limit";
import { logActivity } from "@/logging/activity";
import { logSecurity } from "@/logging/security";
import { err, ok } from "@/lib/result";
import { readSystemSettings } from "@/board/global-data";

// Node runtime: this route reads disk (users.json) and uses bcrypt.
export const runtime = "nodejs";

const LoginSchema = z.object({
  username: z.string().min(1).max(80).trim(),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional().default(false),
});

const STD_TTL = 8 * 60 * 60; // 8 h
const REMEMBER_TTL = 30 * 24 * 60 * 60; // 30 d
const COOKIE_PATH = "/v2";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req);

  // Rate limit before touching disk. 5 attempts / 15 min / ip. Matches v1.
  const limit = await getRateLimitBackend().check(`login:${ip}`, 5, 15 * 60);
  if (!limit.ok) {
    await logSecurity({
      user: null,
      team: null,
      event: "login.rate_limited",
      ip,
      meta: { retryAfterMs: limit.retryAfterMs },
    });
    return NextResponse.json(
      err("Too many attempts. Please wait a few minutes.", "rate_limited"),
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  // Parse body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(err("Invalid request body", "bad_request"), { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err("Missing username or password", "validation"), { status: 400 });
  }
  const { username, password, remember } = parsed.data;

  // Find user across teams.
  const hit = await findUserByUsername(username);
  if (!hit || !hit.user.password) {
    await logSecurity({ user: null, team: null, event: "login.failed", ip, meta: { username, reason: "no_user" } });
    return NextResponse.json(err("Incorrect username or password", "invalid_credentials"), { status: 401 });
  }

  const valid = await verifyPassword(password, hit.user.password);
  if (!valid) {
    await logSecurity({
      user: hit.user.id,
      team: hit.team,
      event: "login.failed",
      ip,
      meta: { username, reason: "bad_password" },
    });
    return NextResponse.json(err("Incorrect username or password", "invalid_credentials"), { status: 401 });
  }

  const settings = await readSystemSettings();
  const expiryDays = Number(settings.password_expiry_days ?? 60);
  const changedAt = hit.user.password_changed_at ?? hit.user.created_at;
  const ageDays = changedAt ? (Date.now() - new Date(changedAt).getTime()) / 86_400_000 : 0;
  const pwChangeRequired =
    !!hit.user.first_login ||
    !!hit.user.must_reset_password ||
    !!hit.user.password_expired ||
    (!hit.user.first_login && ageDays >= expiryDays);

  // v1 signs the user in and forces the change page; v2 does the same via the
  // pw_change_required claim, enforced in middleware until change-password succeeds.
  const ttl = remember ? REMEMBER_TTL : STD_TTL;
  const token = await signSession(
    {
      sub: hit.user.id,
      username: hit.user.username,
      role: hit.user.role,
      team: hit.team,
      is_genz: hit.user.is_genz,
      dev_subteam: hit.user.dev_subteam,
      pw_change_required: pwChangeRequired,
    },
    ttl,
  );

  const expires = new Date(Date.now() + ttl * 1000);

  // Set HttpOnly session cookie + a public mirror for client hydration.
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_PATH,
    expires,
  });
  jar.set(
    USER_COOKIE,
    JSON.stringify({
      id: hit.user.id,
      username: hit.user.username,
      role: hit.user.role,
      team: hit.team,
      name: hit.user.name,
      nickname: hit.user.nickname,
      is_genz: hit.user.is_genz ?? false,
      avatar_url: hit.user.avatar_url,
    }),
    {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      expires,
    },
  );

  await logActivity({
    user: hit.user.id,
    team: hit.team,
    action: "login",
    meta: { ip, remember, ttl },
  });

  return NextResponse.json(
    ok({
      user: {
        id: hit.user.id,
        username: hit.user.username,
        role: hit.user.role,
        team: hit.team,
        name: hit.user.name,
        nickname: hit.user.nickname,
      },
      first_login: hit.user.first_login ?? false,
      pw_change_required: pwChangeRequired,
    }),
  );
}
