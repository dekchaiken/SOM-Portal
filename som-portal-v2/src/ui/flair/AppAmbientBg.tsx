"use client";

import * as React from "react";

export function AppAmbientBg() {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!mq.matches) setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: 0.4 }}
    >
      <div className="app-blob app-blob-a" />
      <div className="app-blob app-blob-b" />
      <div className="app-blob app-blob-c" />
      <style>{`
        .app-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          will-change: transform;
        }
        .app-blob-a {
          width: 40vmax; height: 40vmax;
          background: oklch(from var(--accent) l c h / 0.15);
          top: -15vmax; right: -10vmax;
          animation: app-drift-a 30s ease-in-out infinite alternate;
        }
        .app-blob-b {
          width: 35vmax; height: 35vmax;
          background: oklch(from var(--state-info) l c h / 0.1);
          bottom: -10vmax; left: -12vmax;
          animation: app-drift-b 36s ease-in-out infinite alternate;
        }
        .app-blob-c {
          width: 28vmax; height: 28vmax;
          background: oklch(from var(--state-success) l c h / 0.08);
          top: 45%; left: 50%;
          animation: app-drift-c 28s ease-in-out infinite alternate;
        }
        @keyframes app-drift-a { to { transform: translate(-12vmax, 10vmax) rotate(30deg); } }
        @keyframes app-drift-b { to { transform: translate(10vmax, -8vmax) rotate(-20deg); } }
        @keyframes app-drift-c { to { transform: translate(-18vmax, 8vmax) scale(1.15); } }
        @media (prefers-reduced-motion: reduce) {
          .app-blob { animation: none; }
        }
      `}</style>
    </div>
  );
}
