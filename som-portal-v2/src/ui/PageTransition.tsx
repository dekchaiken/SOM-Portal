"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [show, setShow] = React.useState(false);
  const prevPath = React.useRef(pathname);

  React.useEffect(() => {
    if (pathname !== prevPath.current) {
      setShow(false);
      prevPath.current = pathname;
    }
    const raf = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  return (
    <div
      className="page-transition"
      data-visible={show ? "" : undefined}
    >
      {children}
    </div>
  );
}
