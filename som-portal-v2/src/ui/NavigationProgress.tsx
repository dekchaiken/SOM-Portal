"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = React.useState<"idle" | "running" | "done">("idle");
  const [width, setWidth] = React.useState(0);
  const prevKey = React.useRef(`${pathname}?${searchParams}`);

  React.useEffect(() => {
    const key = `${pathname}?${searchParams}`;
    if (key === prevKey.current) return;
    prevKey.current = key;

    setState("running");
    setWidth(15);

    const t1 = setTimeout(() => setWidth(45), 80);
    const t2 = setTimeout(() => setWidth(75), 250);
    const t3 = setTimeout(() => setWidth(90), 500);
    const t4 = setTimeout(() => {
      setWidth(100);
      setState("done");
    }, 600);
    const t5 = setTimeout(() => {
      setState("idle");
      setWidth(0);
    }, 850);

    return () => {
      [t1, t2, t3, t4, t5].forEach(clearTimeout);
    };
  }, [pathname, searchParams]);

  if (state === "idle") return null;

  return (
    <div
      aria-hidden
      className="nav-progress-track"
      style={{ opacity: state === "done" ? 0 : 1 }}
    >
      <div className="nav-progress-bar" style={{ width: `${width}%` }} />
    </div>
  );
}
