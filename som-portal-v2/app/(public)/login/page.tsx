"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import { Icon } from "@/icons";
import { HeroPanel } from "./HeroPanel";
import { BrandMark } from "./BrandMark";
import { SignInButton } from "./SignInButton";

const Schema = z.object({
  username: z.string().min(1, "Enter your username").max(80),
  password: z.string().min(1, "Enter your password").max(256),
  remember: z.boolean().optional(),
});
type FormInput = z.infer<typeof Schema>;

interface LoginResponse {
  ok: boolean;
  data?: { user: { id: string; username: string }; first_login: boolean };
  error?: string;
  code?: string;
}

export default function LoginPage() {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "success">("idle");
  const [shakeKey, setShakeKey] = React.useState(0);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({
    resolver: zodResolver(Schema),
    defaultValues: { username: "", password: "", remember: false },
  });

  const nextParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("next") ?? "/v2/dashboard"
      : "/v2/dashboard";

  async function onSubmit(values: FormInput) {
    setServerError(null);
    setPhase("loading");

    try {
      const res = await fetch("/v2/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        credentials: "include",
      });
      const json: LoginResponse = await res.json().catch(() => ({ ok: false }));

      if (!res.ok || !json.ok) {
        setPhase("idle");
        setShakeKey((n) => n + 1);
        setServerError(json.error ?? `Login failed (${res.status})`);
        return;
      }

      setPhase("success");
      setTimeout(() => {
        const dest =
          nextParam && nextParam.startsWith("/v2/") ? nextParam : "/v2/dashboard";
        window.location.assign(dest);
      }, 900);
    } catch (e) {
      setPhase("idle");
      setShakeKey((n) => n + 1);
      setServerError(e instanceof Error ? e.message : "Network error");
    }
  }

  const disabled = isSubmitting || phase !== "idle";

  return (
    <main className="login-page relative grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      {/* LEFT: hero with mascot */}
      <HeroPanel />

      {/* RIGHT: Liquid Glass form */}
      <section className="login-right relative flex min-h-dvh flex-col px-6 py-10 sm:px-10 lg:min-h-full lg:justify-center lg:px-16">
        {/* subtle background gradient for right panel */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: "linear-gradient(180deg, oklch(from var(--bg-page) l c h) 0%, oklch(from var(--bg-page) l c h / 0.95) 50%, oklch(from var(--bg-page) l c h) 100%)",
          }}
        />
        {/* colour blobs behind the glass card so the blur has something to refract */}
        <div aria-hidden className="login-blob login-blob-a" />
        <div aria-hidden className="login-blob login-blob-b" />
        <div aria-hidden className="login-blob login-blob-c" />

        <div className="relative z-10 flex items-center justify-between gap-4 lg:hidden">
          <BrandMark compact />
        </div>

        <div
          key={shakeKey}
          className={`glass-card relative z-10 mx-auto flex w-full max-w-md flex-col gap-6 ${mounted ? "glass-card-in" : ""}`}
          data-phase={phase}
        >
          {/* glass background layer */}
          <div aria-hidden className="glass-bg" />

          {/* success overlay */}
          {phase === "success" && <div className="success-overlay" />}

          <div className="relative z-10 flex flex-col gap-6">
            <header className="flex flex-col gap-2">
              <h2 className="text-[1.65rem] font-semibold tracking-tight text-[var(--text-strong)]">
                Welcome back
              </h2>
              <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
                Sign in with your SM account to continue.
              </p>
            </header>

            {serverError ? (
              <div className="error-shake">
                <Alert variant="destructive" role="alert">
                  <Icon name="alert-triangle" size={16} />
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              </div>
            ) : null}

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
              <GlassField
                label="Username"
                icon="user"
                error={errors.username?.message}
              >
                <input
                  autoComplete="username"
                  autoFocus
                  placeholder="your.name"
                  aria-invalid={!!errors.username}
                  className="glass-input"
                  {...register("username")}
                  disabled={disabled}
                />
              </GlassField>

              <GlassField
                label="Password"
                icon="shield"
                error={errors.password?.message}
                actionHref="/v2/forgot-password"
                actionLabel="Forgot?"
              >
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  className="glass-input"
                  {...register("password")}
                  disabled={disabled}
                />
              </GlassField>

              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  className="glass-checkbox"
                  {...register("remember")}
                  disabled={disabled}
                />
                Keep me signed in for 30 days
              </label>

              <SignInButton phase={phase} />
            </form>

            <footer className="flex flex-col gap-2 pt-4 text-xs text-[var(--text-muted)]" style={{ borderTop: "1px solid oklch(from var(--border) l c h / 0.5)" }}>
              <div className="flex items-center justify-between gap-3">
                <span>Need an account? Ask your SM admin.</span>
                <a
                  href="mailto:som-team@ascendcorp.com"
                  className="inline-flex items-center gap-1 text-[var(--accent)] transition-colors hover:underline"
                >
                  Contact <Icon name="external-link" size={10} />
                </a>
              </div>
              <span className="text-[11px] text-[var(--text-subtle)]">SOM Portal · v2 · internal use only</span>
            </footer>
          </div>
        </div>
      </section>

      <style jsx>{`
        .login-page {
          background: var(--bg-page);
          overflow-x: hidden;
        }

        .glass-card {
          position: relative;
          padding: 2rem 2rem 1.75rem;
          border-radius: 1.25rem;
          overflow: hidden;
          opacity: 0;
          transform: translateY(16px) scale(0.98);
        }
        .glass-card-in {
          animation: glass-entrance 700ms cubic-bezier(0.22, 1, 0.36, 1) 300ms both;
        }
        @keyframes glass-entrance {
          0% { opacity: 0; transform: translateY(16px) scale(0.98); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        .glass-bg {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(160deg, oklch(1 0 0 / 0.14) 0%, oklch(1 0 0 / 0.02) 40%, transparent 70%),
            oklch(from var(--bg-card) l c h / 0.5);
          backdrop-filter: blur(28px) saturate(1.8);
          -webkit-backdrop-filter: blur(28px) saturate(1.8);
          border: 1px solid oklch(1 0 0 / 0.18);
          border-radius: inherit;
          box-shadow:
            0 0 0 1px oklch(1 0 0 / 0.05) inset,
            0 1px 0 0 oklch(1 0 0 / 0.35) inset,
            0 30px 80px -20px oklch(0 0 0 / 0.35),
            0 0 60px oklch(from var(--accent) l c h / 0.12);
        }

        .success-overlay {
          position: absolute;
          inset: 0;
          z-index: 5;
          border-radius: inherit;
          background: radial-gradient(
            circle at 50% 60%,
            oklch(0.72 0.18 150 / 0.15) 0%,
            transparent 70%
          );
          animation: success-fade 600ms ease-out both;
        }
        @keyframes success-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .error-shake {
          animation: shake 400ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }
        @keyframes shake {
          10%, 90% { transform: translateX(-1px); }
          20%, 80% { transform: translateX(2px); }
          30%, 50%, 70% { transform: translateX(-4px); }
          40%, 60% { transform: translateX(4px); }
        }

        .login-blob {
          position: absolute;
          border-radius: 9999px;
          pointer-events: none;
          filter: blur(70px);
          opacity: 0.55;
        }
        .login-blob-a {
          width: 340px; height: 340px; top: 8%; left: -6%;
          background: oklch(from var(--accent) l c h / 0.55);
          animation: login-blob-a 22s ease-in-out infinite alternate;
        }
        .login-blob-b {
          width: 300px; height: 300px; bottom: 4%; right: -4%;
          background: oklch(from var(--state-info) l c h / 0.45);
          animation: login-blob-b 26s ease-in-out infinite alternate;
        }
        .login-blob-c {
          width: 220px; height: 220px; top: 45%; left: 55%;
          background: oklch(0.8 0.15 75 / 0.35);
          animation: login-blob-c 18s ease-in-out infinite alternate;
        }
        @keyframes login-blob-a {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(60px, 40px) scale(1.12); }
        }
        @keyframes login-blob-b {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-50px, -30px) scale(1.08); }
        }
        @keyframes login-blob-c {
          0% { transform: translate(0, 0); }
          100% { transform: translate(-40px, 30px); }
        }

        @media (prefers-reduced-motion: reduce) {
          .glass-card-in { animation: none; opacity: 1; transform: none; }
          .error-shake { animation: none; }
          .success-overlay { animation: none; }
        }
      `}</style>
    </main>
  );
}

/* ---------- GlassField — iOS Liquid Glass style input ---------- */

function GlassField({
  label,
  icon,
  error,
  actionHref,
  actionLabel,
  children,
}: {
  label: string;
  icon: "user" | "shield";
  error?: string;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {label}
        </label>
        {actionHref && actionLabel ? (
          <a
            href={actionHref}
            className="text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
          >
            {actionLabel}
          </a>
        ) : null}
      </div>
      <div className="glass-field-wrap">
        <Icon name={icon} size={14} className="glass-field-icon" />
        {children}
      </div>
      {error ? (
        <span className="error-msg text-[11px] font-medium text-[var(--state-danger)]">{error}</span>
      ) : null}

      <style jsx>{`
        .glass-field-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        :global(.glass-field-wrap > .glass-input) {
          width: 100%;
          height: 48px;
          padding: 0 16px 0 42px;
          border-radius: 0.875rem;
          border: 1px solid oklch(from var(--border) l c h / 0.5);
          background: oklch(from var(--bg-raised) l c h / 0.5);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          color: var(--text);
          font-size: 14px;
          outline: none;
          transition:
            border-color 200ms ease-out,
            box-shadow 200ms ease-out,
            background 200ms ease-out,
            transform 200ms ease-out;
        }
        :global(.glass-field-wrap > .glass-input::placeholder) {
          color: var(--text-subtle);
        }
        :global(.glass-field-wrap > .glass-input:hover) {
          border-color: oklch(from var(--border) l c h / 0.8);
          background: oklch(from var(--bg-raised) l c h / 0.65);
        }
        :global(.glass-field-wrap > .glass-input:focus) {
          border-color: oklch(from var(--accent) l c h / 0.6);
          background: oklch(from var(--bg-raised) l c h / 0.7);
          box-shadow:
            0 0 0 3px oklch(from var(--accent) l c h / 0.12),
            0 0 20px oklch(from var(--accent) l c h / 0.06);
          transform: translateY(-1px);
        }
        :global(.glass-field-wrap > .glass-input[aria-invalid="true"]) {
          border-color: oklch(from var(--state-danger) l c h / 0.6);
          box-shadow: 0 0 0 3px oklch(from var(--state-danger) l c h / 0.12);
        }
        :global(.glass-field-wrap > .glass-field-icon) {
          position: absolute;
          left: 14px;
          color: var(--text-subtle);
          pointer-events: none;
          transition: color 200ms ease-out;
        }
        :global(.glass-field-wrap:focus-within > .glass-field-icon) {
          color: var(--accent);
        }
        .error-msg {
          animation: error-in 300ms ease-out both;
        }
        @keyframes error-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        :global(.glass-checkbox) {
          width: 18px;
          height: 18px;
          accent-color: var(--accent);
          border-radius: 6px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
