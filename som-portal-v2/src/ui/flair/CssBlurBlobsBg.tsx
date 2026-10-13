// som-portal-v2/src/ui/flair/CssBlurBlobsBg.tsx
"use client";

/**
 * Flair option C — pure CSS. Three bold colour fields drift, blurred into
 * each other, with an SVG grain overlay to kill banding. ~2 KB, zero JS deps.
 */
export function CssBlurBlobsBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, oklch(0.96 0.02 260) 0%, oklch(0.92 0.03 220) 50%, oklch(0.94 0.04 180) 100%)",
      }}
    >
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="blob blob-c" />
      <svg className="noise" xmlns="http://www.w3.org/2000/svg">
        <filter id="n">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#n)" />
      </svg>
      <style>{`
        .blob {
          position: absolute;
          width: 55vmax;
          height: 55vmax;
          border-radius: 50%;
          filter: blur(90px) saturate(1.6);
          opacity: 0.9;
          will-change: transform;
        }
        [data-mode="dark"] .blob { opacity: 0.5; mix-blend-mode: screen; }

        .blob-a {
          background: radial-gradient(circle at 30% 30%, oklch(0.78 0.22 25) 0%, oklch(0.78 0.22 25 / 0) 65%);
          top: -22vmax; left: -18vmax;
          animation: drift-a 18s ease-in-out infinite alternate;
        }
        .blob-b {
          background: radial-gradient(circle at 50% 50%, oklch(0.72 0.21 285) 0%, oklch(0.72 0.21 285 / 0) 65%);
          bottom: -22vmax; right: -18vmax;
          animation: drift-b 24s ease-in-out infinite alternate;
        }
        .blob-c {
          background: radial-gradient(circle at 50% 50%, oklch(0.82 0.17 185) 0%, oklch(0.82 0.17 185 / 0) 65%);
          top: 30%; left: 40%;
          width: 42vmax; height: 42vmax;
          opacity: 0.75;
          animation: drift-c 22s ease-in-out infinite alternate;
        }

        .noise {
          position: absolute; inset: 0; width: 100%; height: 100%;
          opacity: 0.18; mix-blend-mode: overlay;
        }

        @keyframes drift-a { to { transform: translate(18vmax, 14vmax) rotate(50deg); } }
        @keyframes drift-b { to { transform: translate(-16vmax, -12vmax) rotate(-45deg); } }
        @keyframes drift-c { to { transform: translate(-26vmax, 16vmax) scale(1.2); } }

        @media (prefers-reduced-motion: reduce) {
          .blob { animation: none; }
        }
      `}</style>
    </div>
  );
}
