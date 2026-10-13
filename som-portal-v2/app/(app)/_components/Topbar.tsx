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
    const parent = NAV.find((n) =>
      stripped.startsWith(`${n.path}/`) && n.path !== "/",
    );
    return parent?.label ?? "SOM Portal";
  }, [pathname]);

  return (
    <header
      className="topbar sticky top-0 z-20 flex h-13 items-center gap-3 border-b px-4"
      style={{
        background: "oklch(from var(--bg-canvas) l c h / 0.85)",
        backdropFilter: "blur(12px) saturate(1.5)",
        WebkitBackdropFilter: "blur(12px) saturate(1.5)",
        borderColor: "oklch(from var(--border) l c h / 0.6)",
      }}
    >
      <button
        type="button"
        onClick={onMenu}
        aria-label="Toggle menu"
        className="topbar-btn rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text)] lg:hidden"
      >
        <Icon name="menu" size={18} />
      </button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
        >
          Home
        </Link>
        <Icon name="chevron-right" size={14} className="text-[var(--text-subtle)]" />
        <span className="truncate font-medium text-[var(--text-strong)]">{crumb}</span>
      </nav>

      <span className="flex-1" />

      <div className="flex items-center gap-1">
        <NotificationBell />
        <button
          type="button"
          onClick={toggleMode}
          aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
          className="topbar-btn rounded-[var(--radius-md)] p-2 text-[var(--text-muted)] transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
          title={`Theme: ${theme} · ${mode}`}
        >
          <Icon name={mode === "dark" ? "sun" : "moon"} size={16} />
        </button>
        <Link
          href="/settings"
          aria-label="Settings"
          className="topbar-btn rounded-[var(--radius-md)] p-2 text-[var(--text-muted)] transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
        >
          <Icon name="settings" size={16} />
        </Link>
      </div>

      <style jsx>{`
        .topbar-btn {
          position: relative;
        }
        .topbar-btn:hover {
          transform: translateY(-1px);
        }
        .topbar-btn:active {
          transform: scale(0.95);
        }
      `}</style>
    </header>
  );
}
