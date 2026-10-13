"use client";

// Local UI bits for the admin users module. Kept module-local on purpose so no
// shared component file has to change while sibling modules are in flight.
import * as React from "react";
import { Icon, type IconName } from "@/icons";
import { Button } from "@/ui/shadcn/button";
import { cn } from "@/ui/cn";

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  super_viewer: "Super Viewer",
  sm_admin: "Admin",
  dev_sm: "Dev SM",
  sm_lead: "Lead",
  sm_user: "User",
  dev_user: "Dev User",
  external: "External",
};

const ROLE_TONES: Record<string, string> = {
  super_admin: "var(--state-danger)",
  super_viewer: "var(--state-info)",
  sm_admin: "var(--accent)",
  dev_sm: "var(--accent)",
  sm_lead: "var(--state-info)",
  sm_user: "var(--text-muted)",
  dev_user: "var(--state-warning)",
  external: "var(--text-subtle)",
};

export function RoleChip({ role }: { role: string }) {
  const tone = ROLE_TONES[role] ?? "var(--text-muted)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ borderColor: tone, color: tone }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: tone }}
      />
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function initials(name: string, username: string): string {
  const src = (name || username || "?").trim();
  const parts = src.split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  username,
  src,
  size = 34,
}: {
  name: string;
  username: string;
  src?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = React.useState(false);
  const show = src && !broken;
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: show
          ? "var(--bg-raised)"
          : "linear-gradient(135deg, oklch(0.72 0.18 42), oklch(0.58 0.19 36))",
      }}
    >
      {show ? (
        // Avatars are base64 data URIs in v1 — next/image can't optimise those.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initials(name, username)
      )}
    </span>
  );
}

// ─── toast ───────────────────────────────────────────────────────────────────

export type ToastTone = "success" | "error" | "info";
export interface ToastMsg {
  id: number;
  tone: ToastTone;
  text: string;
  detail?: string;
}

export function useToasts() {
  const [toasts, setToasts] = React.useState<ToastMsg[]>([]);
  const push = React.useCallback((tone: ToastTone, text: string, detail?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text, detail }]);
    // Keep password reveals on screen longer — they are shown only once.
    const ttl = detail ? 20000 : 4000;
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);
  const dismiss = React.useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );
  return { toasts, push, dismiss };
}

const TOAST_ICON: Record<ToastTone, IconName> = {
  success: "check-circle",
  error: "alert-triangle",
  info: "info",
};
const TOAST_COLOR: Record<ToastTone, string> = {
  success: "var(--state-success)",
  error: "var(--state-danger)",
  info: "var(--state-info)",
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastMsg[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          className="pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-lg)] border p-3 shadow-lg"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        >
          <Icon
            name={TOAST_ICON[t.tone]}
            size={16}
            className="mt-0.5"
            style={{ color: TOAST_COLOR[t.tone] }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.text}</p>
            {t.detail ? (
              <p className="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">
                {t.detail}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-[var(--text-subtle)] hover:text-[var(--text)]"
            style={{ fontFamily: "inherit" }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── confirm dialog ──────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "danger",
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        style={{ fontFamily: "inherit" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-[min(92vw,26rem)] rounded-[var(--radius-lg)] border p-5 shadow-xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <h2 className="text-base font-semibold text-[var(--text-strong)]">{title}</h2>
        <div className="mt-2 text-sm text-[var(--text-muted)]">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── field primitives ────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-[var(--text-subtle)]">{hint}</span> : null}
    </label>
  );
}

export function Select({
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--radius)] border px-2.5 text-sm",
        "bg-[var(--input-bg)] text-[var(--input-fg)] border-[var(--input-border)]",
        "focus-visible:outline-none focus-visible:border-[var(--input-focus-ring)]",
        className,
      )}
      style={{ fontFamily: "inherit" }}
      {...rest}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm disabled:opacity-50"
      style={{ fontFamily: "inherit" }}
    >
      <span
        className="relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? "var(--accent)" : "var(--border-strong)" }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left]"
          style={{ left: checked ? "1.125rem" : "0.125rem" }}
        />
      </span>
      <span className="text-[var(--text)]">{label}</span>
    </button>
  );
}
