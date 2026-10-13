// som-portal-v2/src/ui/shadcn/button.tsx
"use client";

import * as React from "react";
import { cn } from "@/ui/cn";

/**
 * Minimal shadcn-shaped Button stub.
 *
 * Replaced by `pnpm dlx shadcn@latest add button` once dependencies land
 * (see SHADCN.md). The variant surface here mirrors shadcn's default
 * so call-sites don't change.
 */

type Variant = "default" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

const variantClass: Record<Variant, string> = {
  default: "glass-btn glass-btn-primary text-white",
  secondary: "glass-btn glass-btn-secondary",
  ghost: "glass-btn bg-transparent text-[var(--text)] hover:bg-[var(--bg-raised)] shadow-none",
  outline: "glass-btn glass-btn-secondary",
  destructive: "glass-btn glass-btn-danger text-white",
};

const sizeClass: Record<Size, string> = {
  default: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-11 px-6 text-sm",
  icon: "h-9 w-9",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "default", size = "default", type = "button", ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium",
          "transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "active:scale-[0.97]",
          variantClass[variant],
          sizeClass[size],
          className,
        )}
        {...rest}
      />
    );
  },
);
