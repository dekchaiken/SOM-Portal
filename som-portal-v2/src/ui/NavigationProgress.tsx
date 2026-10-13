"use client";

// som-portal-v2/src/ui/NavigationProgress.tsx
// Shows feedback as soon as an internal link is clicked, not after the new page
// has rendered. The bar and a small glass pill stay until the route changes, or
// until a safety timeout, so a slow or failed navigation never leaves them stuck.
import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/icons";

const SAFETY_MS = 12_000;

function isInternalNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return false;
  return true;
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = React.useState(false);
  const key = `${pathname}?${searchParams}`;
  const startKey = React.useRef(key);

  // Route changed: navigation finished.
  React.useEffect(() => {
    if (key !== startKey.current) {
      startKey.current = key;
      setPending(false);
    }
  }, [key]);

  // Click on an internal link: show feedback at once.
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!isInternalNavigation(e)) return;
      startKey.current = `${window.location.pathname}?${window.location.search.replace(/^\?/, "")}`;
      setPending(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  React.useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), SAFETY_MS);
    return () => clearTimeout(t);
  }, [pending]);

  if (!pending) return null;

  return (
    <>
      <div aria-hidden className="nav-progress-track">
        <div className="nav-progress-bar nav-progress-indeterminate" />
      </div>
      <div
        role="status"
        aria-live="polite"
        className="glass fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-[var(--radius-md)] px-4 py-2.5 text-sm font-medium text-[var(--text-strong)] shadow-lg"
      >
        <Icon name="loader" size={16} className="animate-spin text-[var(--accent)]" />
        Loading…
      </div>
    </>
  );
}
