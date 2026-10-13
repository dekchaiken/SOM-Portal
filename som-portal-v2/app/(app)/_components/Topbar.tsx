// som-portal-v2/app/(app)/_components/Topbar.tsx
"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/icons";
import { getNavByPath, NAV } from "@/config/nav";
import { useTheme } from "@/theme";
import { NotificationBell } from "./NotificationBell";

export interface TopbarProps {
  onMenu?: () => void;
}

export function Topbar({ onMenu }: TopbarProps) {
  const pathname = usePathname();
  const { mode, toggleMode, theme } = useTheme();

  const crumb = React.useMemo(() => {
    if (!pathname) return null;
    const stripped = pathname.replace(/^\/v2/, "") || "/";
    const direct = getNavByPath(stripped);
    if (direct) return direct.label;
    // detail routes: /board/abc → find /board
    const parent = NAV.find((n) =>
      stripped.startsWith(`${n.path}/`) && n.path !== "/",
    );
    return parent?.label ?? "SOM Portal";
  }, [pathname]);

  return (
    <header
      className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-[var(--bg-canvas)]/95 px-4 backdrop-blur"
      style={{ borderColor: "var(--border)" }}
    >
      <button
        type="button"
        onClick={onMenu}
        aria-label="Toggle menu"
        className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)] lg:hidden"
      >
        <Icon name="menu" size={18} />
      </button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Home
        </Link>
        <Icon name="chevron-right" size={14} className="text-[var(--text-subtle)]" />
        <span className="truncate font-medium">{crumb}</span>
      </nav>
      <span className="flex-1" />
      <NotificationBell />
      <button
        type="button"
        onClick={toggleMode}
        aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
        className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
        title={`Theme: ${theme} · ${mode}`}
      >
        <Icon name={mode === "dark" ? "sun" : "moon"} size={16} />
      </button>
      <Link
        href="/settings"
        aria-label="Settings"
        className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
      >
        <Icon name="settings" size={16} />
      </Link>
    </header>
  );
}
