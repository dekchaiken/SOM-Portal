// som-portal-v2/app/(public)/login/BrandMark.tsx
"use client";

/**
 * BrandMark — "SOM Portal" wordmark with a stylized orange chevron glyph.
 * Pure SVG, uses brand token so themes swap it automatically.
 */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2.5">
      <span
        aria-hidden
        className="relative grid place-items-center"
        style={{
          width: compact ? 28 : 36,
          height: compact ? 28 : 36,
        }}
      >
        <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden>
          <defs>
            <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FFB07A" />
              <stop offset="100%" stopColor="#E05510" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx="9" fill="url(#bm-g)" />
          <path
            d="M11 15 L20 24 L29 15"
            fill="none"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M11 23 L20 32 L29 23"
            fill="none"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.55"
          />
        </svg>
      </span>
      <span className={`font-semibold tracking-tight ${compact ? "text-base" : "text-lg"}`}>
        SOM Portal
      </span>
    </div>
  );
}
