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
        "glass-field flex h-11 w-full min-w-0 rounded-[0.875rem] px-3.5 text-sm text-[var(--text)]",
        "placeholder:text-[var(--text-subtle)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...rest}
    />
  );
});
