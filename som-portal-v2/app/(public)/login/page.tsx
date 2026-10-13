// som-portal-v2/app/(public)/login/page.tsx
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
      }, 650);
    } catch (e) {
      setPhase("idle");
      setShakeKey((n) => n + 1);
      setServerError(e instanceof Error ? e.message : "Network error");
    }
  }

  const disabled = isSubmitting || phase !== "idle";

  return (
    <main className="relative grid min-h-dvh grid-cols-1 bg-[var(--bg-page)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      {/* LEFT: hero */}
      <HeroPanel />

      {/* RIGHT: form */}
      <section className="flex min-h-dvh flex-col px-6 py-10 sm:px-10 lg:min-h-full lg:justify-center lg:px-14">
        <div className="flex items-center justify-between gap-4 lg:hidden">
          <BrandMark compact />
        </div>

        <div
          key={shakeKey}
          className="form-card mx-auto flex w-full max-w-md flex-col gap-6"
        >
          <header className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
              Welcome back
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Sign in with your SM account to continue.
            </p>
          </header>

          {serverError ? (
            <Alert variant="destructive" role="alert">
              <Icon name="alert-triangle" size={16} />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <Field
              label="Username"
              icon="user"
              error={errors.username?.message}
            >
              <input
                autoComplete="username"
                autoFocus
                placeholder="your.name"
                aria-invalid={!!errors.username}
                className="field-input"
                {...register("username")}
                disabled={disabled}
              />
            </Field>

            <Field
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
                className="field-input"
                {...register("password")}
                disabled={disabled}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                {...register("remember")}
                disabled={disabled}
              />
              Keep me signed in for 30 days
            </label>

            <SignInButton phase={phase} />
          </form>

          <footer className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-5 text-xs text-[var(--text-muted)]">
            <div className="flex items-center justify-between gap-3">
              <span>Need an account? Ask your SM admin.</span>
              <a
                href="mailto:som-team@ascendcorp.com"
                className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
              >
                Contact support <Icon name="external-link" size={11} />
              </a>
            </div>
            <span>SM team Portal · v2 · internal use only</span>
          </footer>
        </div>
      </section>

      <style jsx>{`
        .form-card {
          animation: card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) 80ms both;
        }
        @keyframes card-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .form-card[data-shake="1"],
        .form-card {
          /* key-based remount drives shake */
        }
        @media (prefers-reduced-motion: reduce) {
          .form-card { animation: none; }
        }
      `}</style>
    </main>
  );
}

/* ---------- Field ---------- */

function Field({
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
        <label className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </label>
        {actionHref && actionLabel ? (
          <a
            href={actionHref}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            {actionLabel}
          </a>
        ) : null}
      </div>
      <div className="field-wrap">
        <Icon name={icon} size={14} className="field-icon" />
        {children}
      </div>
      {error ? (
        <span className="text-xs text-[var(--state-danger)]">{error}</span>
      ) : null}

      <style jsx>{`
        .field-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        :global(.field-wrap > .field-input) {
          width: 100%;
          height: 44px;
          padding: 0 14px 0 38px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
          background: var(--bg-raised, var(--bg-card));
          color: var(--text);
          font-size: 14px;
          outline: none;
          transition: border-color 160ms ease-out, box-shadow 160ms ease-out,
            background 160ms ease-out;
        }
        :global(.field-wrap > .field-input::placeholder) {
          color: var(--text-subtle);
        }
        :global(.field-wrap > .field-input:hover) {
          border-color: var(--border-strong);
        }
        :global(.field-wrap > .field-input:focus) {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px oklch(0.685 0.175 42 / 0.18);
        }
        :global(.field-wrap > .field-input[aria-invalid="true"]) {
          border-color: var(--state-danger);
          box-shadow: 0 0 0 3px oklch(0.67 0.21 25 / 0.14);
        }
        :global(.field-wrap > .field-icon) {
          position: absolute;
          left: 14px;
          color: var(--text-muted);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
