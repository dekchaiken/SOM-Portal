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
      className={cn(
        "flex h-dvh min-h-0 flex-col gap-2 border-r text-sm",
        collapsed ? "w-16" : "w-64",
      )}
      style={{
        background: "var(--nav-bg)",
        borderColor: "var(--nav-border)",
      }}
    >
      <div className="flex h-12 items-center gap-2 px-3">
        <Icon name="activity" size={18} className="text-[var(--accent)]" />
        {collapsed ? null : (
          <span className="truncate font-semibold">SOM Portal</span>
        )}
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => onCollapsedChange(!collapsed)}
          className="ml-auto rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={16} />
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
        {NAV_GROUPS_ORDERED.map((group) => {
          const bucket = byGroup.get(group);
          if (!bucket || bucket.length === 0) return null;
          return (
            <div key={group}>
              {collapsed ? null : (
                <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
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
                          "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5",
                          "text-[color:var(--nav-item-fg)] hover:bg-[var(--bg-raised)] hover:text-[color:var(--nav-item-fg-hover)]",
                          active &&
                            "bg-[color:var(--nav-item-bg-active)] text-[color:var(--nav-item-fg-active)]",
                        )}
                        title={collapsed ? item.label : undefined}
                      >
                        <Icon name={item.icon} size={16} />
                        {collapsed ? null : (
                          <span className="truncate">{item.label}</span>
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
    </aside>
  );
}
