// som-portal-v2/app/api/auth/methods/route.ts
// Public. Tells the login page whether the Keycloak button should show. Reveals no config.
import { NextResponse } from 'next/server';
import { getSsoRuntime, readAuthConfig } from '@/auth/auth-config';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const [runtimeCfg, cfg] = await Promise.all([getSsoRuntime(), readAuthConfig()]);
  return NextResponse.json({
    ok: true,
    data: {
      password: true,
      sso: runtimeCfg !== null,
      sso_label: cfg.sso_label,
    },
  });
}
