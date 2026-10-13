// som-portal-v2/app/(public)/forgot-password/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import { Icon } from "@/icons";
import { HeroPanel } from "../login/HeroPanel";
import { BrandMark } from "../login/BrandMark";

const Schema = z.object({
  username: z.string().min(1, "Enter your username or email").max(120),
});
type FormInput = z.infer<typeof Schema>;

export default function ForgotPasswordPage() {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "sent">(
    "idle",
  );
  const [message, setMessage] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({
    resolver: zodResolver(Schema),
    defaultValues: { username: "" },
  });

  async function onSubmit(values: FormInput) {
    setServerError(null);
    setPhase("loading");

    try {
      const res = await fetch("/v2/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: values.username }),
      });
      const json = await res.json().catch(() => ({ ok: false }));

      if (res.status === 429) {
        setPhase("idle");
        setServerError(
          json.error ?? "Too many requests. Please wait and try again.",
        );
        return;
      }

      if (!res.ok && !json.ok) {
        setPhase("idle");
        setServerError(json.error ?? `Request failed (${res.status})`);
        return;
      }

      setMessage(json.data?.message ?? json.message ?? "Check your email.");
      setPhase("sent");
    } catch (e) {
      setPhase("idle");
      setServerError(e instanceof Error ? e.message : "Network error");
    }
  }

  const disabled = isSubmitting || phase !== "idle";

  return (
    <main className="relative grid min-h-dvh grid-cols-1 bg-[var(--bg-page)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <HeroPanel />

      <section className="flex min-h-dvh flex-col px-6 py-10 sm:px-10 lg:min-h-full lg:justify-center lg:px-14">
        <div className="flex items-center justify-between gap-4 lg:hidden">
          <BrandMark compact />
        </div>

        <div className="form-card mx-auto flex w-full max-w-md flex-col gap-6">
          {phase === "sent" ? (
            <>
              <header className="flex flex-col gap-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--state-success)]/12 text-[var(--state-success)]">
                  <Icon name="check" size={20} />
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
                  Check your email
                </h2>
                <p className="text-sm leading-relaxed text-[var(--text-muted)]">
                  {message}
                </p>
              </header>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline"
              >
                <Icon name="arrow-left" size={14} />
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <header className="flex flex-col gap-1.5">
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
                  Forgot password
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Enter your username or email and we&apos;ll send a password
                  reset link.
                </p>
              </header>

              {serverError ? (
                <Alert variant="destructive" role="alert">
                  <Icon name="alert-triangle" size={16} />
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              ) : null}

              <form
                onSubmit={handleSubmit(onSubmit)}
                noValidate
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    Username or email
                  </label>
                  <div className="field-wrap">
                    <Icon name="user" size={14} className="field-icon" />
                    <input
                      autoComplete="username"
                      autoFocus
                      placeholder="your.name or your@email.com"
                      aria-invalid={!!errors.username}
                      className="field-input"
                      {...register("username")}
                      disabled={disabled}
                    />
                  </div>
                  {errors.username?.message ? (
                    <span className="text-xs text-[var(--state-danger)]">
                      {errors.username.message}
                    </span>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={disabled}
                  className="flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {phase === "loading" ? (
                    <>
                      <Icon
                        name="loader"
                        size={16}
                        className="animate-spin"
                      />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Icon name="mail" size={16} />
                      Send reset link
                    </>
                  )}
                </button>
              </form>

              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--accent)]"
              >
                <Icon name="arrow-left" size={14} />
                Back to sign in
              </Link>
            </>
          )}

          <footer className="border-t border-[var(--border)] pt-5 text-xs text-[var(--text-muted)]">
            SM team Portal · v2 · internal use only
          </footer>
        </div>
      </section>

      <style jsx>{`
        .form-card {
          animation: card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) 80ms both;
        }
        @keyframes card-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .form-card {
            animation: none;
          }
        }
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
    </main>
  );
}
