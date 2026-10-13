"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/ui/shadcn/button";
import { Icon, type IconName } from "@/icons";
import type { Result } from "@/lib/result";
import { cn } from "@/ui/cn";

/**
 * ActionButton — one-click server action with pending state, inline error and
 * an optional in-page confirm step.
 *
 * No native confirm()/alert() anywhere (feedback_frontend_dos_donts): the
 * confirm is a second click on the same control, labelled "Confirm".
 */
export interface ActionButtonProps extends Omit<ButtonProps, "onClick"> {
  action: () => Promise<Result<unknown>>;
  icon?: IconName;
  label: string;
  pendingLabel?: string;
  confirmLabel?: string;
  /** Require a second click before firing. */
  confirm?: boolean;
  onDone?: (r: Result<unknown>) => void;
}

export function ActionButton({
  action,
  icon,
  label,
  pendingLabel,
  confirmLabel = "Confirm",
  confirm = false,
  onDone,
  className,
  ...rest
}: ActionButtonProps) {
  const [pending, setPending] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Disarm after 4s so a stray click doesn't stay dangerous.
  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  async function run() {
    if (confirm && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setPending(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) setError(res.error);
      onDone?.(res);
    } catch {
      setError("Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <Button
        {...rest}
        className={cn(armed && "ring-2 ring-[var(--state-danger)]", className)}
        disabled={pending || rest.disabled}
        onClick={run}
        aria-busy={pending}
      >
        {pending ? (
          <Icon name="loader" size={14} className="animate-spin" />
        ) : icon ? (
          <Icon name={icon} size={14} />
        ) : null}
        {pending ? (pendingLabel ?? label) : armed ? confirmLabel : label}
      </Button>
      {error ? (
        <span role="alert" className="text-[11px] text-[var(--state-danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
