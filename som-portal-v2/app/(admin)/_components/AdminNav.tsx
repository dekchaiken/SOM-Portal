// som-portal-v2/app/(admin)/_components/AdminNav.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_BY_GROUP } from "@/config/nav";
import { Icon } from "@/icons";
import { cn } from "@/ui/cn";

export function AdminNav() {
  const pathname = usePathname();
  const items = NAV_BY_GROUP.admin;
  return (
    <aside
      className="flex h-dvh min-h-0 w-60 flex-col border-r text-sm"
      style={{
        background: "var(--nav-bg)",
        borderColor: "var(--nav-border)",
      }}
    >
      <div className="flex h-12 items-center gap-2 px-3">
        <Icon name="shield" size={16} className="text-[var(--accent)]" />
        <span className="font-semibold">Admin</span>
        <Link
          href="/dashboard"
          className="ml-auto rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
          aria-label="Exit admin"
        >
          <Icon name="x" size={14} />
        </Link>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {items.map((item) => {
          const href = `/v2${item.path}`;
          const active =
            pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <Link
              key={item.id}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5",
                "text-[color:var(--nav-item-fg)] hover:bg-[var(--bg-raised)] hover:text-[color:var(--nav-item-fg-hover)]",
                active &&
                  "bg-[color:var(--nav-item-bg-active)] text-[color:var(--nav-item-fg-active)]",
              )}
            >
              <Icon name={item.icon} size={16} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
