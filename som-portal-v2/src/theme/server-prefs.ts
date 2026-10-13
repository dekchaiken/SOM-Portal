// som-portal-v2/src/theme/server-prefs.ts
// Server-only: resolve the theme the first paint should use, so a reload lands
// on the persisted theme with no flash. Safe on public pages (no session →
// defaults). Never throws.

import type { ThemePrefs } from './ThemeProvider';
import { DEFAULT_MODE, DEFAULT_THEME } from './ThemeProvider';

export const FALLBACK_THEME_PREFS: ThemePrefs = {
  theme: DEFAULT_THEME,
  mode: DEFAULT_MODE,
  isGenz: false,
};

export async function loadInitialThemePrefs(): Promise<ThemePrefs> {
  try {
    const { getSession } = await import('@/auth/session');
    const sess = await getSession();
    if (!sess) return FALLBACK_THEME_PREFS;

    const { readUserPrefs } = await import('@/account/user-prefs');
    const prefs = await readUserPrefs(sess.sub);
    return {
      theme: prefs.theme,
      mode: prefs.mode,
      // The GenZ overlay needs BOTH the admin-granted flag and the user's opt-in.
      isGenz: Boolean(sess.is_genz) && prefs.genz_overlay,
    };
  } catch {
    return FALLBACK_THEME_PREFS;
  }
}
