// som-portal-v2/app/(app)/_components/AppShell.tsx
"use client";

import * as React from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { SessionLike } from "@/config/nav";
import { cn } from "@/ui/cn";

/**
 * AppShell — hard-left collapsible sidebar + topbar + main.
 *
 * Desktop:  grid [sidebar, main]
 * Mobile:   sidebar becomes an overlay opened via Topbar's menu button.
 *
 * Grid uses `minmax(0, 1fr)` for the main column so wide tables / charts can
 * overflow horizontally without blowing the layout (per
 * jakubkrehel/better-layout).
 */

export interface AppShellProps {
  session: SessionLike | null;
  children: React.ReactNode;
}

export function AppShell({ session, children }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-dvh">
      {/* Desktop two-column grid */}
      <div
        className="hidden lg:grid"
        style={{
          gridTemplateColumns: `${collapsed ? "4rem" : "16rem"} minmax(0, 1fr)`,
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
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>

      {/* Mobile overlay layout */}
      <div className="flex min-h-dvh flex-col lg:hidden">
        <Topbar onMenu={() => setMobileOpen((v) => !v)} />
        <main className="min-w-0 flex-1 p-4">{children}</main>
        {mobileOpen ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-30 bg-[var(--bg-overlay)]"
            />
            <div className="fixed inset-y-0 left-0 z-40 w-64">
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

      <span className={cn("sr-only")}>SOM Portal v2 app shell</span>
    </div>
  );
}
