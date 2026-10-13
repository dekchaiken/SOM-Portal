// som-portal-v2/app/(public)/login/SignInButton.tsx
"use client";

import * as React from "react";
import { Icon } from "@/icons";

type Phase = "idle" | "loading" | "success";

/**
 * SignInButton — orange brand button with three visual states.
 *   idle    — flat gradient, hover lifts slightly
 *   loading — animated indeterminate shimmer sweeping left→right + spinner
 *   success — flash to full-brand green-tinted and show check icon
 *
 * Pure CSS animations; no extra libraries.
 */
export function SignInButton({ phase }: { phase: Phase }) {
  const label =
    phase === "loading"
      ? "Signing in…"
      : phase === "success"
        ? "Signed in"
        : "Sign in";

  return (
    <button
      type="submit"
      disabled={phase !== "idle"}
      aria-busy={phase === "loading"}
      className="relative isolate flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-md)] text-sm font-semibold text-white transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed"
      data-phase={phase}
    >
      {/* base fill */}
      <span className="btn-base" aria-hidden />
      {/* shimmer during loading */}
      <span className="btn-shimmer" aria-hidden />
      {/* success flash */}
      <span className="btn-success" aria-hidden />

      {/* label row */}
      <span className="relative z-10 inline-flex items-center gap-2">
        {phase === "loading" ? (
          <Icon name="loader" size={16} className="spin" />
        ) : phase === "success" ? (
          <Icon name="check" size={16} className="pop" />
        ) : (
          <Icon name="arrow-right" size={16} />
        )}
        {label}
      </span>

      <style jsx>{`
        button {
          background: transparent;
          box-shadow: 0 8px 24px -14px oklch(0.5 0.15 42 / 0.65);
        }
        button:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .btn-base {
          position: absolute;
          inset: 0;
          z-index: 0;
          background: linear-gradient(
            135deg,
            oklch(0.72 0.18 42) 0%,
            oklch(0.63 0.19 36) 100%
          );
          transition: filter 220ms ease-out;
        }
        button:hover:not(:disabled) .btn-base {
          filter: brightness(1.05);
        }
        button:disabled .btn-base {
          filter: saturate(0.9);
        }

        .btn-shimmer {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(
            100deg,
            transparent 20%,
            oklch(1 0 0 / 0.28) 48%,
            oklch(1 0 0 / 0.44) 50%,
            oklch(1 0 0 / 0.28) 52%,
            transparent 80%
          );
          background-size: 220% 100%;
          background-position: 180% 0;
          opacity: 0;
          transition: opacity 160ms ease-out;
        }
        button[data-phase="loading"] .btn-shimmer {
          opacity: 1;
          animation: shimmer 1.2s linear infinite;
        }
        @keyframes shimmer {
          to { background-position: -80% 0; }
        }

        .btn-success {
          position: absolute;
          inset: 0;
          z-index: 2;
          background: radial-gradient(
            circle at 50% 50%,
            oklch(0.72 0.18 150) 0%,
            oklch(0.56 0.18 150) 100%
          );
          opacity: 0;
          transform: scale(0.95);
          transition: opacity 240ms ease-out, transform 240ms ease-out;
        }
        button[data-phase="success"] .btn-success {
          opacity: 1;
          transform: scale(1);
        }

        .spin {
          animation: spin 0.9s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .pop {
          animation: pop 320ms cubic-bezier(0.17, 0.89, 0.32, 1.49) both;
        }
        @keyframes pop {
          0% { transform: scale(0.4); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .btn-shimmer { animation: none; opacity: 0; }
          .spin, .pop { animation: none; }
          button:hover:not(:disabled) { transform: none; }
        }
      `}</style>
    </button>
  );
}
