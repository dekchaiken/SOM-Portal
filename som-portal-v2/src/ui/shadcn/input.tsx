// som-portal-v2/src/ui/shadcn/input.tsx
import * as React from "react";
import { cn } from "@/ui/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** Minimal Input stub — replaced by shadcn CLI output. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full min-w-0 rounded-[var(--radius)] px-3 text-sm",
        "bg-[var(--input-bg)] text-[var(--input-fg)] border border-[var(--input-border)]",
        "placeholder:text-[var(--input-placeholder)]",
        "focus-visible:outline-none focus-visible:border-[var(--input-focus-ring)] focus-visible:ring-2 focus-visible:ring-[var(--input-focus-ring)]/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...rest}
    />
  );
});
