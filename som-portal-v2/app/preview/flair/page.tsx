// som-portal-v2/app/preview/flair/page.tsx
"use client";

import * as React from "react";
import { CssBlurBlobsBg } from "@/ui/flair/CssBlurBlobsBg";
import { ShaderGradientBg } from "@/ui/flair/ShaderGradientBg";
import { ThreeParticlesBg } from "@/ui/flair/ThreeParticlesBg";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";
import { Button } from "@/ui/shadcn/button";
import { Icon } from "@/icons";

type Variant = "a" | "b" | "c";

const META: Record<Variant, { label: string; sub: string; bundle: string }> = {
  a: { label: "Option A", sub: "Three.js — ~5000 drifting particles", bundle: "+500 KB" },
  b: { label: "Option B", sub: "WebGL mesh gradient (Stripe-style)", bundle: "+3 KB" },
  c: { label: "Option C", sub: "CSS blur blobs + SVG noise", bundle: "0 KB" },
};

function LoginCard() {
  return (
    <Card className="w-full max-w-sm shadow-xl">
      <CardHeader>
        <CardTitle className="text-lg">Sign in</CardTitle>
        <CardDescription>SOM Portal v2</CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--text-muted)]">Username</span>
          <Input placeholder="your.name" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--text-muted)]">Password</span>
          <Input type="password" placeholder="••••••••" autoComplete="off" />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <input type="checkbox" />
          Keep me signed in for 30 days
        </label>
      </CardContent>
      <CardFooter>
        <Button type="button" className="w-full">
          <Icon name="arrow-right" size={16} /> Sign in
        </Button>
      </CardFooter>
    </Card>
  );
}

function Panel({ v }: { v: Variant }) {
  return (
    <section className="relative isolate overflow-hidden rounded-[var(--radius-lg)] border">
      {v === "a" ? <ThreeParticlesBg /> : null}
      {v === "b" ? <ShaderGradientBg /> : null}
      {v === "c" ? <CssBlurBlobsBg /> : null}
      <div className="relative flex min-h-[520px] items-center justify-center p-6">
        <LoginCard />
      </div>
      <div className="relative flex items-center justify-between gap-3 border-t bg-[var(--bg-card)] px-4 py-3 text-xs">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{META[v].label}</span>
          <span className="text-[var(--text-muted)]">{META[v].sub}</span>
        </div>
        <span className="rounded-[var(--radius-sm)] border bg-[var(--bg-raised)] px-2 py-1 font-mono text-[11px]">
          {META[v].bundle}
        </span>
      </div>
    </section>
  );
}

export default function FlairPreviewPage() {
  const [solo, setSolo] = React.useState<Variant | null>(null);

  return (
    <main className="mx-auto flex max-w-screen-2xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Login flair — pick one</h1>
          <p className="text-sm text-[var(--text-muted)]">
            All three react to the active theme. Try switching theme/mode at{" "}
            <a className="underline" href="/v2/preview/theme">/v2/preview/theme</a> then come back.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--text-muted)]">View:</span>
          {(["a", "b", "c"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSolo((s) => (s === k ? null : k))}
              className={`rounded-[var(--radius-sm)] border px-2.5 py-1 ${
                solo === k ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-raised)]"
              }`}
            >
              {k.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSolo(null)}
            className="rounded-[var(--radius-sm)] border bg-[var(--bg-raised)] px-2.5 py-1"
          >
            All
          </button>
        </div>
      </header>

      {solo ? (
        <Panel v={solo} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel v="a" />
          <Panel v="b" />
          <Panel v="c" />
        </div>
      )}
    </main>
  );
}
