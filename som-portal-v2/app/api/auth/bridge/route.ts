// som-portal-v2/app/api/auth/bridge/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyToken, SESSION_COOKIE } from '@/auth/session';
import { ok, err } from '@/lib/result';

const Body = z.object({ token: z.string().min(10) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(err('Invalid body', 'validation_error'), { status: 400 });
  }
  try {
    const sess = await verifyToken(parsed.data.token);
    const res = NextResponse.json(ok({ sub: sess.sub, team: sess.team, role: sess.role }));
    const maxAge = sess.exp ? Math.max(0, sess.exp - Math.floor(Date.now() / 1000)) : 8 * 60 * 60;
    res.cookies.set(SESSION_COOKIE, parsed.data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge,
    });
    return res;
  } catch {
    return NextResponse.json(err('Invalid token', 'unauthorized'), { status: 401 });
  }
}
