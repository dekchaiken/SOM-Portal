"use client";

import * as React from "react";
import { SomSomMascot } from "./SomSomMascot";
import { BrandMark } from "./BrandMark";
import { Icon } from "@/icons";

export function HeroPanel() {
  return (
    <section className="hero-panel relative isolate flex min-h-[380px] flex-col justify-between overflow-hidden p-8 text-white lg:min-h-full lg:p-14">
      {/* gradient background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, oklch(0.30 0.10 42) 0%, oklch(0.16 0.06 42) 50%, oklch(0.09 0.03 42) 100%)",
        }}
      />

      {/* soft glow behind mascot */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 55%, oklch(0.45 0.16 42 / 0.4) 0%, transparent 50%)",
        }}
      />

      {/* top brand */}
      <div className="relative z-10 flex items-center justify-between gap-4">
        <BrandMark />
        <span className="hidden text-xs uppercase tracking-[0.18em] text-white/55 lg:inline-flex">
          Service Operations · TrueMoney
        </span>
      </div>

      {/* center mascot */}
      <div className="relative z-10 mx-auto flex w-full max-w-sm flex-col items-center gap-4 lg:max-w-md">
        <div className="mascot-entrance h-[220px] w-[220px] lg:h-[280px] lg:w-[280px]">
          <SomSomMascot />
        </div>
        <div className="mascot-label text-center">
          <p className="text-lg font-bold tracking-tight text-white/95 lg:text-xl">
            สวัสดีครับ!
          </p>
          <p className="mt-1 text-sm text-white/60">
            น้องส้มส้มพร้อมดูแลคุณแล้ว
          </p>
        </div>
      </div>

      {/* bottom info */}
      <div className="relative z-10">
        <ul className="mb-4 flex flex-wrap justify-center gap-2 text-xs text-white">
          {[
            { icon: "shield" as const, label: "Secure" },
            { icon: "activity" as const, label: "Live monitoring" },
            { icon: "layers" as const, label: "Multi-team" },
          ].map((p) => (
            <li
              key={p.label}
              className="chip-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
            >
              <Icon name={p.icon} size={12} /> {p.label}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-4 text-[11px] text-white/40">
          <span>© {new Date().getFullYear()} TrueMoney · SM Team</span>
          <a
            href="https://truemoney.atlassian.net"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-white/70"
          >
            Status <Icon name="external-link" size={11} />
          </a>
        </div>
      </div>

      <style jsx>{`
        .chip-glass {
          background: oklch(1 0 0 / 0.08);
          border: 1px solid oklch(1 0 0 / 0.12);
          backdrop-filter: blur(12px) saturate(1.2);
          -webkit-backdrop-filter: blur(12px) saturate(1.2);
        }
        .mascot-entrance {
          animation: mascot-bounce-in 800ms cubic-bezier(0.34, 1.56, 0.64, 1) 200ms both;
        }
        .mascot-label {
          animation: fade-up 600ms ease-out 600ms both;
        }
        @keyframes mascot-bounce-in {
          0% { opacity: 0; transform: scale(0.3) translateY(40px); }
          60% { opacity: 1; transform: scale(1.08) translateY(-5px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mascot-entrance, .mascot-label { animation: none; }
        }
      `}</style>
    </section>
  );
}
