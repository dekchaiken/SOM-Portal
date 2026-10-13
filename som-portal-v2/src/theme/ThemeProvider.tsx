// som-portal-v2/src/theme/ThemeProvider.tsx
"use client";

/**
 * ThemeProvider — client-side theme + mode resolver.
 *
 * Responsibilities:
 *  - resolve the active theme + mode from (user prefs → prefers-color-scheme → default)
 *  - set `data-theme` + `data-mode` on <html>, `data-user-genz` on <body>
 *  - enforce "Console is always dark" (overrides to dark + logs a warning)
 *  - expose a context so useTheme() can change the mode/theme live
 *
 * It does NOT fetch user prefs from the server; the parent (RootLayout or a
 * server component) passes resolved `initial` values so the first paint matches
 * the final state (no FOUC). Live changes persist via onPersist callback
 * (wired to /v2/api/user-prefs by the Settings page once Agent A ships it).
 */

import * as React from "react";

export type ThemeName = "glass" | "enterprise" | "console" | "warm";
export type ModeName = "light" | "dark";

export interface ThemePrefs {
  theme: ThemeName;
  mode: ModeName;
  isGenz: boolean;
}

interface ThemeContextValue extends ThemePrefs {
  setTheme: (t: ThemeName) => void;
  setMode: (m: ModeName) => void;
  toggleMode: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export const DEFAULT_THEME: ThemeName = "glass";
export const DEFAULT_MODE: ModeName = "light";
/** One design language for the whole portal: Liquid Glass. */
export const ALL_THEMES: readonly ThemeName[] = ["glass"];

/** Console is always dark — enforced here. */
function resolveMode(theme: ThemeName, mode: ModeName): ModeName {
  if (theme === "console" && mode !== "dark") {
    if (typeof console !== "undefined") {
      console.warn(
        "[ThemeProvider] Console theme forces dark mode; ignoring light request.",
      );
    }
    return "dark";
  }
  return mode;
}

function applyToDom(prefs: ThemePrefs): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute("data-theme", prefs.theme);
  html.setAttribute("data-mode", prefs.mode);
  html.style.colorScheme = prefs.mode;
  const body = document.body;
  if (body) {
    if (prefs.isGenz) body.setAttribute("data-user-genz", "true");
    else body.removeAttribute("data-user-genz");
  }
}

interface ThemeProviderProps {
  initial?: Partial<ThemePrefs>;
  onPersist?: (prefs: ThemePrefs) => void;
  children: React.ReactNode;
}

export function ThemeProvider({
  initial,
  onPersist,
  children,
}: ThemeProviderProps): React.ReactElement {
  const [theme, setThemeState] = React.useState<ThemeName>(
    DEFAULT_THEME,
  );
  const [mode, setModeState] = React.useState<ModeName>(
    resolveMode(DEFAULT_THEME, initial?.mode ?? DEFAULT_MODE),
  );
  const [isGenz, setGenz] = React.useState<boolean>(initial?.isGenz ?? false);

  // First mount: if there was no persisted mode, honor prefers-color-scheme
  // (only when the theme isn't Console, which is always dark).
  React.useEffect(() => {
    if (initial?.mode) return;
    if (theme === "console") return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const next: ModeName = mq.matches ? "dark" : "light";
    setModeState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep genz state in sync with external changes (super_admin toggle, etc.).
  React.useEffect(() => {
    if (initial?.isGenz !== undefined) setGenz(initial.isGenz);
  }, [initial?.isGenz]);

  const resolvedMode = resolveMode(theme, mode);

  React.useEffect(() => {
    applyToDom({ theme, mode: resolvedMode, isGenz });
  }, [theme, resolvedMode, isGenz]);

  const persist = React.useCallback(
    (next: ThemePrefs) => {
      onPersist?.(next);
    },
    [onPersist],
  );

  const setTheme = React.useCallback(
    (t: ThemeName) => {
      setThemeState(t);
      const nextMode = resolveMode(t, mode);
      if (nextMode !== mode) setModeState(nextMode);
      persist({ theme: t, mode: nextMode, isGenz });
    },
    [mode, isGenz, persist],
  );

  const setMode = React.useCallback(
    (m: ModeName) => {
      const nextMode = resolveMode(theme, m);
      setModeState(nextMode);
      persist({ theme, mode: nextMode, isGenz });
    },
    [theme, isGenz, persist],
  );

  const toggleMode = React.useCallback(() => {
    setMode(resolvedMode === "dark" ? "light" : "dark");
  }, [resolvedMode, setMode]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      mode: resolvedMode,
      isGenz,
      setTheme,
      setMode,
      toggleMode,
    }),
    [theme, resolvedMode, isGenz, setTheme, setMode, toggleMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
