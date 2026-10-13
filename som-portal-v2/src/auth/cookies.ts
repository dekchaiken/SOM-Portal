// som-portal-v2/src/auth/cookies.ts
// Edge-safe cookie name constants. Keep this file free of node:*, next/headers,
// or env imports so middleware (Edge runtime) can consume it.

export const SESSION_COOKIE = 'som_session_v2';
export const USER_COOKIE = 'som_user'; // non-HttpOnly mirror for client hydration
export const LEGACY_COOKIE = 'som_token'; // v1 compat
