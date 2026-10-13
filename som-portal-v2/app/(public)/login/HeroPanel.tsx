// som-portal-v2/app/(public)/login/HeroPanel.tsx
"use client";

import * as React from "react";
import { AmbientOrbBg } from "@/ui/flair/AmbientOrbBg";
import { BrandMark } from "./BrandMark";
import { Icon } from "@/icons";

/**
 * Hero panel — occupies the left half of the login shell on >=lg,
 * stacks above the form on smaller screens. Contains the ambient
 * 3D orb, brand mark, value prop, and three "what you get" chips.
 */
export function HeroPanel() {
  return (
    <section className="relative isolate flex min-h-[320px] flex-col justify-between overflow-hidden p-8 text-white lg:min-h-full lg:p-14">
      <AmbientOrbBg />

      {/* top brand */}
      <div className="relative z-10 flex items-center justify-between gap-4">
        <BrandMark />
        <span className="hidden text-xs uppercase tracking-[0.18em] text-white/55 lg:inline-flex">
          Service Operations · TrueMoney
        </span>
      </div>

      {/* middle copy */}
      <div className="relative z-10 flex max-w-lg flex-col gap-6">
        <h1 className="hero-headline text-[2rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[2.6rem] lg:text-[3rem]">
          <span className="block">One console.</span>
          <span className="block">
            Every <span className="brand-underline">SM operation</span>.
          </span>
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-white/80 sm:text-[15px]">
          Service board, Jira templates, Jenkins builds, MA status, and
          Grafana — everything your team touches during an incident,
          in one secure session.
        </p>

        <ul className="mt-1 flex flex-wrap gap-2 text-xs text-white">
          {[
            { icon: "shield" as const, label: "SSO-ready" },
            { icon: "activity" as const, label: "Live service health" },
            { icon: "layers" as const, label: "Multi-team" },
          ].map((p) => (
            <li
              key={p.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 backdrop-blur-md"
              style={{ backdropFilter: "blur(10px) saturate(1.1)" }}
            >
              <Icon name={p.icon} size={13} /> {p.label}
            </li>
          ))}
        </ul>
      </div>

      {/* footer */}
      <div className="relative z-10 flex items-center justify-between gap-4 text-[11px] text-white/45">
        <span>© {new Date().getFullYear()} TrueMoney · SM Team</span>
        <a
          href="https://truemoney.atlassian.net"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-white/80"
        >
          Status <Icon name="external-link" size={11} />
        </a>
      </div>

      <style jsx>{`
        .brand-underline {
          background: linear-gradient(120deg, #ffd5a3 0%, #ff8a4d 60%, #f26419 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          filter: drop-shadow(0 2px 24px oklch(0.6 0.19 42 / 0.5));
        }
        .hero-headline {
          color: rgb(255 255 255 / 0.97);
          text-shadow: 0 1px 2px oklch(0 0 0 / 0.4),
            0 10px 42px oklch(0 0 0 / 0.35);
          animation: hero-in 700ms cubic-bezier(0.22, 1, 0.36, 1) 60ms both;
        }
        @keyframes hero-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-headline { animation: none; }
        }
      `}</style>
    </section>
  );
}
