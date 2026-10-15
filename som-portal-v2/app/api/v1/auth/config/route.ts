// som-portal-v2/app/api/v1/auth/config/route.ts
// Superadmin: read and update Keycloak SSO settings. The client secret is write-only.
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicAuthConfig, saveAuthConfig } from '@/auth/auth-config';
import { jsonErr, jsonOk, readJsonBody, jsonFromError } from '@/account/http';
import { requireSuperAdmin, mapAuthAdminError } from '../_shared';
import { logSecurity } from '@/logging/security';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({
    sso_enabled: z.boolean().optional(),
    sso_label: z.string().max(80).optional(),
    issuer: z.string().url().max(300).or(z.literal('')).optional(),
    client_id: z.string().max(200).optional(),
    client_secret: z.string().max(500).optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  try {
    await requireSuperAdmin();
    return jsonOk(await getPublicAuthConfig());
  } catch (e) {
    return jsonFromError(e);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  try {
    const sess = await requireSuperAdmin();
    const parsed = PatchSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return jsonErr('Invalid settings', 400, 'validation');
    const data = parsed.data;
    if (data.sso_enabled === true) {
      const current = await getPublicAuthConfig();
      const issuer = data.issuer ?? current.issuer;
      const clientId = data.client_id ?? current.client_id;
      const hasSecret = Boolean(data.client_secret) || current.client_secret_set;
      if (!issuer || !clientId || !hasSecret) {
        return jsonErr('Fill in issuer, client ID and client secret before turning SSO on.', 400, 'incomplete');
      }
    }
    const result = await saveAuthConfig(data, sess.sub);
    await logSecurity({
      user: sess.sub,
      team: sess.team,
      event: 'auth.config_changed',
      meta: { sso_enabled: result.sso_enabled, secret_changed: Boolean(data.client_secret) },
    });
    return jsonOk(result);
  } catch (e) {
    return mapAuthAdminError(e);
  }
}
