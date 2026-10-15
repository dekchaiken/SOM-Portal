// som-portal-v2/src/auth/nextauth.ts
// Auth.js (NextAuth v5) with the Keycloak provider. Config is built per request from
// data/auth-config.json, so the superadmin can change the issuer, client and on/off
// switch without a redeploy. The provider is only registered when SSO is fully set up.
//
// Keycloak only proves identity. The email must match a portal user, and that user's
// role and team come from data/users.json. Keycloak never creates portal accounts.
//
// Set AUTH_URL to the public Auth.js base, including the /v2 basePath, for example
// https://portal.example/v2/api/auth. Auth.js derives its callback URL from it, so the
// Keycloak redirect URI must be <AUTH_URL>/callback/keycloak.
import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';
import { getSsoRuntime } from './auth-config';
import { canUseSso, emailFromProfile } from './sso-rules';
import { findUserByEmailGlobal } from '@/account/users-store';

/** Public Auth.js path. Includes the /v2 app basePath so redirect URIs are right. */
export const SSO_BASE_PATH = '/v2/api/auth';

export const { handlers, auth } = NextAuth(async () => {
  const sso = await getSsoRuntime();
  return {
    secret: process.env.AUTH_SECRET ?? process.env.JWT_SECRET,
    basePath: SSO_BASE_PATH,
    trustHost: true,
    // The Auth.js cookie only carries the handshake. The portal session is issued in
    // /v2/api/auth/sso/complete, so keep this short.
    session: { strategy: 'jwt', maxAge: 10 * 60 },
    pages: { error: '/v2/login' },
    providers: sso
      ? [
          Keycloak({
            issuer: sso.issuer,
            clientId: sso.clientId,
            clientSecret: sso.clientSecret,
          }),
        ]
      : [],
    callbacks: {
      async signIn({ profile }) {
        const email = emailFromProfile(profile as Record<string, unknown> | undefined);
        if (!email) return false;
        const user = await findUserByEmailGlobal(email);
        if (!user || user.active === false) return false;
        return canUseSso(user);
      },
    },
  };
});
