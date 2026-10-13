// som-portal-v2/src/theme/useTheme.ts
"use client";

import { useThemeContext } from "./ThemeProvider";

/**
 * useTheme — ergonomic hook over the ThemeProvider context.
 * Returns the resolved theme/mode/genz flag plus setters.
 */
export function useTheme() {
  return useThemeContext();
}
