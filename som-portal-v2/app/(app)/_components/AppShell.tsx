// som-portal-v2/app/(app)/_components/AppShell.tsx
"use client";

import * as React from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { NavigationProgress } from "@/ui/NavigationProgress";
import { PageTransition } from "@/ui/PageTransition";
import type { SessionLike } from "@/config/nav";

export interface AppShellProps {
  session: SessionLike | null;
  children: React.ReactNode;
}

export function AppShell({ session, children }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-dvh ambient-mesh">
      <React.Suspense>
        <NavigationProgress />
      </React.Suspense>

      {/* Desktop two-column grid */}
      <div
        className="hidden lg:grid"
        style={{
          gridTemplateColumns: `${collapsed ? "4rem" : "16rem"} minmax(0, 1fr)`,
          transition: "grid-template-columns 280ms cubic-bezier(0.23, 1, 0.32, 1)",
          minHeight: "100dvh",
        }}
      >
        <div className="sticky top-0 h-dvh">
          <Sidebar
            session={session}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <Topbar onMenu={() => setMobileOpen(true)} />
          <main className="min-w-0 flex-1 p-6">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>

      {/* Mobile overlay layout */}
      <div className="flex min-h-dvh flex-col lg:hidden">
        <Topbar onMenu={() => setMobileOpen((v) => !v)} />
        <main className="min-w-0 flex-1 p-4">
          <PageTransition>{children}</PageTransition>
        </main>

        {/* Mobile sidebar overlay */}
        {mobileOpen ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-30"
              style={{
                background: "var(--bg-overlay)",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
                animation: "fade-in-up 200ms ease-out",
              }}
            />
            <div
              className="fixed inset-y-0 left-0 z-40 w-64"
              style={{
                animation: "slide-in-left 280ms cubic-bezier(0.23, 1, 0.32, 1) both",
              }}
            >
              <Sidebar
                session={session}
                collapsed={false}
                onCollapsedChange={() => setMobileOpen(false)}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </>
        ) : null}
      </div>

      <style jsx>{`
        @keyframes slide-in-left {
          from { transform: translateX(-100%); opacity: 0.5; }
          to   { transform: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
