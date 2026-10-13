// som-portal-v2/tailwind.config.ts
import type { Config } from "tailwindcss";

/**
 * Tailwind v4 content/dark-mode shim.
 *
 * v4 moves most config into CSS (`@theme` in `app/globals.css`).
 * This file remains to:
 *   - tell editors/plugins where class strings live, and
 *   - lock dark-mode selector to `[data-mode="dark"]` so themes own the switch.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./src/**/*.{ts,tsx,mdx}",
    "./config/**/*.{ts,tsx}",
  ],
  darkMode: ["selector", '[data-mode="dark"]'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
