// som-portal-v2/app/(public)/reset-password/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import { Icon } from "@/icons";
import { HeroPanel } from "../login/HeroPanel";
import { BrandMark } from "../login/BrandMark";
import {
  passwordStrength,
  PW_MIN_LENGTH,
  type Strength,
} from "@/account/password-policy";

const Schema = z
  .object({
    new_password: z.string().min(1, "Enter a new password").max(256),
    confirm_password: z.string().min(1, "Confirm your password").max(256),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });
type FormInput = z.infer<typeof Schema>;

interface TokenInfo {
  valid: boolean;
  expires_at?: string;
  user_name_masked?: string;
  username_masked?: string;
}

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [tokenInfo, setTokenInfo] = React.useState<TokenInfo | null>(null);
  const [tokenLoading, setTokenLoading] = React.useState(true);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "success">(
    "idle",
  );
  const [showPw, setShowPw] = React.useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({
    resolver: zodResolver(Schema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  const pwValue = watch("new_password");
  const strength: Strength = React.useMemo(
    () => passwordStrength(pwValue ?? ""),
    [pwValue],
  );

  React.useEffect(() => {
    if (!token) {
      setTokenLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/v2/api/auth/reset-password?token=${encodeURIComponent(token)}`,
        );
        const json = await res.json().catch(() => ({ ok: false }));
        setTokenInfo(json.data ?? json ?? { valid: false });
      } catch {
        setTokenInfo({ valid: false });
      } finally {
        setTokenLoading(false);
      }
    })();
  }, [token]);

  async function onSubmit(values: FormInput) {
    setServerError(null);
    setPhase("loading");
    try {
      const res = await fetch("/v2/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...values }),
      });
      const json = await res.json().catch(() => ({ ok: false }));

      if (!res.ok || !json.ok) {
        setPhase("idle");
        setServerError(json.error ?? `Reset failed (${res.status})`);
        return;
      }
      setPhase("success");
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
          {tokenLoading ? (
            <div className="flex flex-col items-center gap-3 py-12 text-[var(--text-muted)]">
              <Icon name="loader" size={24} className="animate-spin" />
              <span className="text-sm">Verifying reset link...</span>
            </div>
          ) : !token || !tokenInfo?.valid ? (
            <InvalidToken />
          ) : phase === "success" ? (
            <SuccessView />
          ) : (
            <>
              <header className="flex flex-col gap-1.5">
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
                  Set new password
                </h2>
                {tokenInfo.user_name_masked || tokenInfo.username_masked ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Resetting password for{" "}
                    <span className="font-medium text-[var(--text)]">
                      {tokenInfo.user_name_masked || tokenInfo.username_masked}
                    </span>
                  </p>
                ) : null}
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
                    New password
                  </label>
                  <div className="field-wrap">
                    <Icon name="shield" size={14} className="field-icon" />
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      autoFocus
                      placeholder={"Min " + PW_MIN_LENGTH + " chars, uppercase + digit"}
                      aria-invalid={!!errors.new_password}
                      className="field-input"
                      {...register("new_password")}
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 text-[var(--text-muted)] hover:text-[var(--text)]"
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      <Icon name={showPw ? "eye-off" : "eye"} size={16} />
                    </button>
                  </div>
                  {errors.new_password?.message ? (
                    <span className="text-xs text-[var(--state-danger)]">
                      {errors.new_password.message}
                    </span>
                  ) : null}

                  {pwValue ? <StrengthMeter strength={strength} /> : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    Confirm password
                  </label>
                  <div className="field-wrap">
                    <Icon name="shield" size={14} className="field-icon" />
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Re-enter password"
                      aria-invalid={!!errors.confirm_password}
                      className="field-input"
                      {...register("confirm_password")}
                      disabled={disabled}
                    />
                  </div>
                  {errors.confirm_password?.message ? (
                    <span className="text-xs text-[var(--state-danger)]">
                      {errors.confirm_password.message}
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
                      Resetting...
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={16} />
                      Reset password
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

function InvalidToken() {
  return (
    <>
      <header className="flex flex-col gap-1.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--state-danger)]/12 text-[var(--state-danger)]">
          <Icon name="alert-triangle" size={20} />
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
          Invalid or expired link
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">
          This password reset link is no longer valid. It may have already been
          used or expired. Please request a new one.
        </p>
      </header>
      <Link
        href="/forgot-password"
        className="flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        <Icon name="mail" size={16} />
        Request new link
      </Link>
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--accent)]"
      >
        <Icon name="arrow-left" size={14} />
        Back to sign in
      </Link>
    </>
  );
}

function SuccessView() {
  return (
    <>
      <header className="flex flex-col gap-1.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--state-success)]/12 text-[var(--state-success)]">
          <Icon name="check" size={20} />
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
          Password reset
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">
          Your password has been updated. You can now sign in with your new
          password.
        </p>
      </header>
      <Link
        href="/login"
        className="flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        <Icon name="log-in" size={16} />
        Sign in
      </Link>
    </>
  );
}

const STRENGTH_COLORS: Record<string, string> = {
  weak: "var(--state-danger)",
  fair: "var(--state-warning)",
  good: "var(--state-info)",
  strong: "var(--state-success)",
};

function StrengthMeter({ strength }: { strength: Strength }) {
  const color = STRENGTH_COLORS[strength.label] ?? "var(--text-muted)";
  const pct = (strength.score / 5) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span style={{ color }}>
          {strength.label.charAt(0).toUpperCase() + strength.label.slice(1)}
        </span>
        <span className="text-[var(--text-subtle)]">
          {[
            strength.met.length ? null : `${PW_MIN_LENGTH}+ chars`,
            strength.met.upper ? null : "uppercase",
            strength.met.digit ? null : "digit",
          ]
            .filter(Boolean)
            .join(", ") || "All requirements met"}
        </span>
      </div>
    </div>
  );
}
