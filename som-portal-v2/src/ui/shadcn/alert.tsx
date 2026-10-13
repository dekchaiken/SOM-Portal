// som-portal-v2/src/ui/shadcn/alert.tsx
import * as React from "react";
import { cn } from "@/ui/cn";

type Variant = "default" | "destructive" | "warning" | "success";

const variantClass: Record<Variant, string> = {
  default: "bg-[var(--bg-raised)] border-[var(--border)] text-[var(--text)]",
  destructive:
    "bg-[var(--chip-danger-bg)] border-[var(--state-danger)] text-[var(--chip-danger-fg)]",
  warning:
    "bg-[var(--chip-warning-bg)] border-[var(--state-warning)] text-[var(--chip-warning-fg)]",
  success:
    "bg-[var(--chip-success-bg)] border-[var(--state-success)] text-[var(--chip-success-fg)]",
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

/** Minimal Alert stub — replaced by shadcn CLI output. */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, variant = "default", ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "flex gap-3 rounded-[var(--radius)] border p-3 text-sm",
        variantClass[variant],
        className,
      )}
      {...rest}
    />
  );
});

export function AlertTitle({
  className,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h4 className={cn("font-semibold leading-tight", className)} {...rest} />;
}

export function AlertDescription({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm opacity-90", className)} {...rest} />;
}
