// som-portal-v2/app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/theme";
import { loadInitialThemePrefs } from "@/theme/server-prefs";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "SOM Portal",
  description: "Centralised Service Operations Management portal.",
  applicationName: "SOM Portal",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // A6: read the signed-in user's persisted theme server-side so the first
  // paint already matches it (no flash). Falls back to Enterprise/light for
  // public pages and any read failure.
  const initialTheme = await loadInitialThemePrefs();
  return (
    <html
      lang="en"
      data-theme={initialTheme.theme}
      data-mode={initialTheme.mode}
      className={`${inter.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-[var(--bg-page)] text-[var(--text)] antialiased">
        <ThemeProvider initial={initialTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
