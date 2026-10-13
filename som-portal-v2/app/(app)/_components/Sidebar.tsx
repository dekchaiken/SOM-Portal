// som-portal-v2/app/(app)/_components/Sidebar.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getVisibleNav,
  GROUP_META,
  NAV_GROUPS_ORDERED,
  type NavItem,
  type SessionLike,
} from "@/config/nav";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";

export interface SidebarProps {
  session: SessionLike | null;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  onNavigate?: () => void;
}

export function Sidebar({
  session,
  collapsed,
  onCollapsedChange,
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const items = React.useMemo(() => getVisibleNav(session), [session]);
  const byGroup = React.useMemo(() => {
    const grouped = new Map<string, NavItem[]>();
    for (const item of items) {
      const bucket = grouped.get(item.group) ?? [];
      bucket.push(item);
      grouped.set(item.group, bucket);
    }
    return grouped;
  }, [items]);

  return (
    <aside
      aria-label="Primary"
      className="sidebar-root flex h-dvh min-h-0 flex-col gap-2 border-r text-sm"
      style={{
        width: collapsed ? "4rem" : "16rem",
        transition: "width 280ms cubic-bezier(0.23, 1, 0.32, 1)",
        background: "var(--nav-bg)",
        borderColor: "var(--nav-border)",
      }}
    >
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 px-3">
        <div className="sidebar-brand-icon flex items-center justify-center rounded-[var(--radius-md)] p-1.5"
          style={{
            background: "linear-gradient(135deg, var(--accent), var(--p-brand-400))",
          }}
        >
          <Icon name="activity" size={16} className="text-white" />
        </div>
        {collapsed ? null : (
          <span className="truncate font-semibold tracking-tight text-[var(--text-strong)]"
            style={{
              opacity: collapsed ? 0 : 1,
              transition: "opacity 200ms",
            }}
          >
            SOM Portal
          </span>
        )}
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => onCollapsedChange(!collapsed)}
          className="ml-auto rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
        </button>
      </div>

      {/* Nav groups */}
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {NAV_GROUPS_ORDERED.map((group) => {
          const bucket = byGroup.get(group);
          if (!bucket || bucket.length === 0) return null;
          return (
            <div key={group}>
              {collapsed ? null : (
                <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                  {GROUP_META[group].label}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {bucket.map((item) => {
                  const href = item.path.startsWith("/") ? item.path : `/${item.path}`;
                  const active =
                    pathname === href || pathname?.startsWith(`${href}/`);
                  return (
                    <li key={item.id}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        className={cn(
                          "sidebar-nav-item group relative flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2",
                          "text-[color:var(--nav-item-fg)] transition-all",
                          !active && "hover:bg-[var(--bg-raised)] hover:text-[color:var(--nav-item-fg-hover)]",
                          active && "sidebar-nav-active",
                        )}
                        title={collapsed ? item.label : undefined}
                      >
                        {/* Active indicator bar */}
                        {active && (
                          <span
                            className="sidebar-active-indicator"
                            aria-hidden
                          />
                        )}
                        <Icon
                          name={item.icon}
                          size={16}
                          className={cn(
                            "shrink-0 transition-transform",
                            !active && "group-hover:scale-110",
                          )}
                        />
                        {collapsed ? null : (
                          <span className="truncate text-[13px]">{item.label}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <style jsx>{`
        .sidebar-nav-active {
          background: var(--nav-item-bg-active);
          color: var(--nav-item-fg-active);
          font-weight: 500;
        }
        .sidebar-active-indicator {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          border-radius: 0 3px 3px 0;
          background: linear-gradient(180deg, var(--accent), var(--p-brand-400));
          box-shadow: 0 0 8px oklch(from var(--accent) l c h / 0.4);
          animation: scale-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @keyframes scale-in {
          from { opacity: 0; transform: translateY(-50%) scaleY(0.3); }
          to   { opacity: 1; transform: translateY(-50%) scaleY(1); }
        }
        .sidebar-nav-item::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          opacity: 0;
          background: radial-gradient(
            circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
            oklch(from var(--accent) l c h / 0.08),
            transparent 60%
          );
          transition: opacity 200ms;
          pointer-events: none;
        }
        .sidebar-nav-item:hover::before {
          opacity: 1;
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 4px;
        }
      `}</style>
    </aside>
  );
}
