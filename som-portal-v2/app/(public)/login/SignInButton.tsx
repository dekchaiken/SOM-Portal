"use client";

import * as React from "react";
import { Icon } from "@/icons";

type Phase = "idle" | "loading" | "success";

export function SignInButton({ phase }: { phase: Phase }) {
  const label =
    phase === "loading"
      ? "Authenticating…"
      : phase === "success"
        ? "Welcome back!"
        : "Sign in";

  return (
    <button
      type="submit"
      disabled={phase !== "idle"}
      aria-busy={phase === "loading"}
      className="signin-btn group relative isolate flex h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl text-sm font-semibold text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      data-phase={phase}
    >
      {/* base gradient */}
      <span className="signin-base" aria-hidden />

      {/* liquid shimmer during loading */}
      <span className="signin-liquid" aria-hidden />

      {/* orbital dots loading */}
      {phase === "loading" && (
        <span className="signin-dots" aria-hidden>
          <span className="dot dot-1" />
          <span className="dot dot-2" />
          <span className="dot dot-3" />
        </span>
      )}

      {/* success ripple */}
      <span className="signin-success" aria-hidden />

      {/* label */}
      <span className="relative z-10 inline-flex items-center gap-2">
        {phase === "loading" ? (
          <span className="signin-spinner" />
        ) : phase === "success" ? (
          <Icon name="check" size={18} className="pop-icon" />
        ) : (
          <Icon
            name="arrow-right"
            size={16}
            className="transition-transform group-hover:translate-x-0.5"
          />
        )}
        <span className="label-text">{label}</span>
      </span>

      <style jsx>{`
        .signin-btn {
          box-shadow:
            0 4px 20px -6px oklch(0.5 0.18 42 / 0.5),
            0 1px 3px oklch(0 0 0 / 0.15);
        }
        .signin-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow:
            0 8px 30px -6px oklch(0.5 0.18 42 / 0.6),
            0 2px 8px oklch(0 0 0 / 0.12);
        }
        .signin-btn:active:not(:disabled) {
          transform: translateY(0) scale(0.98);
        }

        .signin-base {
          position: absolute;
          inset: 0;
          z-index: 0;
          background: linear-gradient(
            135deg,
            oklch(0.72 0.18 42) 0%,
            oklch(0.60 0.20 30) 50%,
            oklch(0.65 0.19 38) 100%
          );
          background-size: 200% 200%;
          animation: base-shift 4s ease-in-out infinite alternate;
          transition: filter 300ms ease-out;
        }
        .signin-btn:hover:not(:disabled) .signin-base {
          filter: brightness(1.08) saturate(1.1);
        }
        @keyframes base-shift {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }

        .signin-liquid {
          position: absolute;
          inset: -2px;
          z-index: 1;
          border-radius: inherit;
          background: linear-gradient(
            90deg,
            transparent 0%,
            oklch(1 0 0 / 0.0) 30%,
            oklch(1 0 0 / 0.25) 48%,
            oklch(1 0 0 / 0.35) 50%,
            oklch(1 0 0 / 0.25) 52%,
            oklch(1 0 0 / 0.0) 70%,
            transparent 100%
          );
          background-size: 300% 100%;
          opacity: 0;
          transition: opacity 200ms ease-out;
        }
        .signin-btn[data-phase="loading"] .signin-liquid {
          opacity: 1;
          animation: liquid-sweep 1.6s ease-in-out infinite;
        }
        @keyframes liquid-sweep {
          0% { background-position: 150% 0; }
          100% { background-position: -50% 0; }
        }

        .signin-dots {
          position: absolute;
          inset: 0;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .dot {
          position: absolute;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: oklch(1 0 0 / 0.3);
        }
        .dot-1 { animation: orbit 2s ease-in-out infinite; }
        .dot-2 { animation: orbit 2s ease-in-out 0.66s infinite; }
        .dot-3 { animation: orbit 2s ease-in-out 1.33s infinite; }
        @keyframes orbit {
          0%, 100% { transform: translateX(-50px) scale(0.5); opacity: 0.3; }
          50% { transform: translateX(50px) scale(1); opacity: 0.8; }
        }

        .signin-success {
          position: absolute;
          inset: 0;
          z-index: 2;
          background: radial-gradient(
            circle at 50% 50%,
            oklch(0.72 0.18 150) 0%,
            oklch(0.58 0.18 145) 100%
          );
          opacity: 0;
          transform: scale(0.6);
          transition: opacity 400ms ease-out, transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .signin-btn[data-phase="success"] .signin-success {
          opacity: 1;
          transform: scale(1);
        }

        .signin-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid oklch(1 0 0 / 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .pop-icon {
          animation: pop-in 400ms cubic-bezier(0.17, 0.89, 0.32, 1.49) both;
        }
        @keyframes pop-in {
          0% { transform: scale(0) rotate(-90deg); opacity: 0; }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }

        .label-text {
          transition: opacity 200ms ease-out;
        }

        @media (prefers-reduced-motion: reduce) {
          .signin-base { animation: none; }
          .signin-liquid { animation: none; opacity: 0; }
          .signin-spinner { animation: none; }
          .dot { animation: none; }
          .signin-btn:hover:not(:disabled) { transform: none; }
          .pop-icon { animation: none; }
        }
      `}</style>
    </button>
  );
}
